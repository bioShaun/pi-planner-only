# Planner-only 运行可靠性修复 Spec

Status: ready-for-implementation
Version: 1
Date: 2026-09-11
Baseline: `a9167a6a8ddb9a231b54d7776c726c4ea76e645d` / pi-planner-only 0.4.1
Source: [runtime-audit-2026-09-11.md](./runtime-audit-2026-09-11.md)

## 1. 目标与完成定义

修复 2026-09-11 运行暴露的任务正文丢失、异步输出无法摄取、旧通知错配和 resume 未登记问题，使每个执行的启动、结果摄取、报告修订、审查与用量都有可追踪且可恢复的关联。

本文 MUST/必须为验收要求；建议为可替换的实现方式。接口草案规定语义，实施者可按现有命名与模块边界调整字段名，但必须保留对应不变量和测试。

完成分两道门：

- **M1：运行可靠性**，完成 RR-01～RR-08，真实故障 fixture 可离线回放，已有合法报告无需再次调用模型即可进入审查流程。
- **M2：数据任务适配与诊断**，完成 RR-09～RR-10，非 Git、大文件、共享路径任务有明确的验证与导出契约。

M1 可独立发布；M1 发布说明必须列明 M2 未完成项，不能宣称已支持完整生信任务验收。全 Spec 完成要求 M1、M2 均通过。

### 1.1 不变量

1. `process complete` 不代表报告已记录，也不代表 Task 验收通过。
2. 一个 execution 的收据只能影响其绑定 Task；明确身份冲突不得降级为 agent 名匹配。
3. 同一执行、同一输出经多个通道重复到达，只产生一次报告修订和一次对应子执行用量归属。
4. 输出暂不可读是基础设施问题，不增加 `reportCorrections`。
5. Root 本次委派中的指令、已知事实与产物引用不得静默丢失。
6. writer 释放依据是执行已确认停止；摄取确认依据是结果已持久化，两者独立。
7. 已有证据新鲜度、Task 身份、scope、审查与验收限制继续适用；本 Spec 不自动给历史任务补 pass。

## 2. 故障与需求追踪

审计中的 L 指主会话物理行号，完整路径见源审计。

| 证据 | 需求 | 优先级 | 验收用例 |
|---|---|---|---|
| L19/L28/L76：outputState=present 却报 no output | RR-02 输出定位与状态拆分 | P0 | C01～C05 |
| T-004/T-008 收到 T-001 身份 | RR-03 身份匹配与重放 | P0 | C06～C09 |
| L79/L106 正文未进入子会话 | RR-04 TaskPacket | P0 | C10～C12 |
| L129～L137：resume 后仍无报告 | RR-05 resume 生命周期 | P1 | C13～C16 |
| 四次 verdict 拒绝、wait 指引冲突 | RR-06 恢复与等待 | P1 | C17～C19 |
| L103/L143 未知模型 | RR-07 模型预检 | P1 | C20～C21 |
| completed_with_limits、矛盾示例 | RR-08 报告合同 | P2 | C22～C23 |
| 非 Git、scope 空、外部环境和大文件 | RR-09 数据证据 | P2 | C24～C27 |
| 状态、产物和版本散落多个目录 | RR-10 导出 | P2 | C28～C29 |

## 3. 架构与接口契约

### 3.1 宿主适配与公共摄取入口

`index.ts` 负责将 sync result、bg_wait completion、native notification、显式恢复以及 resume receipt 转为统一事件；Orchestration 负责身份、生命周期、预算和持久化。报告 JSON 解析仍由 `report.ts` 负责。

建议新增 `completion.ts` 负责收据规范化和输出定位，避免继续扩大 `orchestrate.ts`；`notify.ts` 保留宿主通知解析和旧格式兼容。新增可发布模块时同步 `package.json.files`。

```ts
interface CompletionReceipt {
  version: 1;
  source: "sync" | "bg-wait" | "notify" | "reconcile";
  runId?: string;                 // 缺少时只允许按 §5 的严格规则恢复身份
  executionId?: string;
  taskIdHint?: string;
  agent?: string;
  observedAt: string;
  terminal?: { state: string; exitCode?: number };
  outputState: "present" | "absent" | "unknown";
  outputRef?: { outputPath?: string; archivePath?: string };
  inlineOutput?: string;
}

type OutputResolution =
  | { kind: "loaded"; text: string; digest: string; source: string }
  | { kind: "pending"; code: string; attempted: string[] }
  | { kind: "unavailable"; code: string; attempted: string[] };
```

Receipt 是宿主数据的规范化视图，不是 Worker 可以自行提供的授权。结构化 completion 数组必须逐项处理，不能将多个 child 输出拼成一个报告。

### 3.2 持久化 RunRecord

每个执行至少记录：

```ts
interface RunRecord {
  version: 1;
  sessionId: string;
  workspaceId: string;
  taskId: string;
  executionId: string;
  runId?: string;
  previousRunId?: string;
  agent: string;
  role: string;
  executionState: "launching" | "running" | "terminal" | "launch-failed";
  ingestionState: "waiting" | "output-pending" | "loaded" |
    "report-invalid" | "recorded" | "unavailable";
  terminalReason?: string;
  outputRef?: CompletionReceipt["outputRef"];
  outputDigest?: string;
  reportRevision?: number;
  lastError?: { code: string; message: string };
}
```

- `runId` 在启动回执前可缺失，executionId 在准入时生成；启动确认后建立唯一索引。
- taskId 必须使用 canonical id；alias 只用于兼容输入解析。
- run 与 Task 快照的持久化采用可恢复提交：可以写入同一原子快照，或使用 journal + 幂等提交标识。不能只依赖内存 Set。
- 幂等键包含 session/workspace/execution/run 身份；输出 digest 用于检测同一 run 的内容冲突，不得把同一 run 的不同 digest 自动视为新执行。
- 旧 ledger 缺少 run 字段时可加载为未知摄取状态。不得从“最近 Task/同名 agent”猜测 run 归属。

## 4. RR-02：可靠输出定位与消费

### 4.1 解析顺序

对已绑定执行，按以下顺序尝试：

1. 宿主明确标记为完整最终输出的 inline payload。
2. completion 的 `artifactPaths.outputPath` 对应文件。
3. completion 的 `archivePath` 中按确切 run/child 身份选择的最终输出。
4. 已登记产物目录和对应 run/agent 的确定性文件名。
5. 已支持旧版本的明确产物格式兼容解析。

不得再以目录内“最大文件”作为报告身份依据；多个候选无法确定身份时返回 `OUTPUT_AMBIGUOUS`。通知 preview 有截断标志时不能充当完整最终输出。

宿主路径必须与登记 run 和已知 session/async 产物根关联，使用有限大小读取与格式检查；Worker JSON 中的路径不得作为宿主输出定位授权。文件不存在、暂不可读、超限、archive 格式不支持应分别记录诊断，不能全部转换为空报告。

### 4.2 状态转换

| 输入/条件 | executionState | ingestionState | 副作用 |
|---|---|---|---|
| 启动成功 | running | waiting | 登记 run；保留预算预留与 writer 所有权 |
| 确认 terminal，文件尚未就绪 | terminal | output-pending | 可按既有规则释放 writer；保留结果恢复登记 |
| 正文读取成功 | terminal 或宿主已证实的终态 | loaded | 保存正文引用、digest 与收据 |
| 完整正文为非法报告 | terminal | report-invalid | 每个 execution 只计一次合同失败；进入既有修复流程 |
| 报告身份和 schema 合法 | terminal | recorded | 记录报告与 evidence，按既有 review loop 推进 |
| 恢复次数耗尽 | terminal/unknown | unavailable | 明确阻塞原因，保留人工/显式重新摄取能力 |
| 相同结果再次到达 | 不变 | 不变 | 返回已保存的处理结果，不再次计费或追加报告 |

终态判断不得仅依据字符串“done”、等待窗口结束或 attention。未知执行是否停止时保留 writer 限制。

### 4.3 重试与崩溃恢复

- 每次事件触发最多执行一次有界定位，不在事件 handler 内 sleep/poll。
- 默认自动重试上限 3 次，由后续同 run 收据、一次性 reconcile 或下一次明确恢复触发；新产物引用到达可触发一次新的解析尝试。
- 重复历史 context 消息不得自行消耗重试额度。
- 超限置 unavailable 并给出 `planner_recover` 动作；显式恢复允许重新尝试，不启动模型。
- 持久化失败必须保持可重试，不能先加入 processed 集合后丢失结果。恢复需覆盖“正文已读但报告未提交”和“报告已提交但 ack 未写”两个崩溃点。
- `reportCorrections` 只在成功读取完整最终输出、确认合同失败后按 execution 幂等增加。

## 5. RR-03：通知身份与重放规则

按顺序匹配：

1. 已知结构化 runId → 登记执行。runId 与 taskIdHint 冲突时返回 `FOREIGN_RECEIPT`，不修改任何候选 Task。
2. 没有 runId，有 taskIdHint → canonical/alias 解析后，必须只有一个对应的待摄取执行。
3. 没有任何身份字段的旧格式通知 → agent 名只能用来定位可能的登记记录；必须读取该登记 run 的可信产物并验证身份后才能摄取。不能直接把无身份 preview 绑定过去。
4. 未知、已消费或冲突的明确身份 → 保存 orphan/late receipt 诊断，绝不退回其他 Task 的 agent 匹配。

`message_end`、`context`、`bg_wait`、verdict 前 reconcile 使用同一入口和幂等状态。context 重放优先返回缓存的渲染结果；同一通知不能在新 Task 出现后改变归属。

旧执行在新报告修订后迟到，只能登记为历史/过期收据，不回退当前报告。多 child 通知逐项路由，各自返回处理结果；不能只保留最后一个 outcome。

## 6. RR-04：无损 TaskPacket

```ts
interface TaskPacket {
  version: 1;
  spec: TaskSpec;          // canonical taskId；约束权威
  instructions: string;  // 本次委派正文，不是 Root 全历史
  knownFacts: string[];
  artifactRefs: string[];
}
```

### 6.1 兼容现有调用

- 现有“正文 + 内嵌 TaskSpec”调用仍可用。适配器提取 spec，但必须保留当前任务正文，不依赖模型重新总结。
- 可将提取后的正文存入 instructions；只允许机械移除已提取的 TaskSpec 块和插件生成的重复 wrapper。无法可靠分离时保留原文并标注内嵌 spec/alias 为原始请求。
- 原始任务正文、规范化 TaskPacket 和最终 child prompt 各保存 digest，供审计比较。
- 超过现有角色 packet 预算时在启动前返回 `TASK_PACKET_TOO_LARGE`，包含实际大小、上限和可精简字段；不静默截断 instructions/knownFacts。
- 同一个 canonical id 应用于下发 spec 和 WorkerReport 示例；alias 保留在独立说明中。
- Worker 保留执行细节；Reviewer 继续使用隔离的 ReviewRequest，不引入 Root 历史。Validator 仅接收相关验证命令、约束与必要事实。
- 自然语言与结构化 scope 冲突时 spec 为权威；发现冲突应明确提示，不得用正文扩大工具或写入权限。

### 6.2 真实任务保真验收

Step 2 fixture 必须在实际 child launch payload 中保留安装版本、环境路径、软链要求、建库命令和冒烟步骤。交接 fixture 必须保留文档路径、已验证数字、全量 SNP+INDEL 注释范围、用户确认参数和暂停后的下一步。

## 7. RR-05：resume 与补报告

- 将宿主 action 分类为 read-only management、控制操作、创建执行操作。`resume` 属创建执行操作；不能因带 action 就统一跳过准入。
- resume 准入必须从旧 run 的持久化关联恢复 Task，生成新 executionId，检查 workspace writer 冲突和预算，再调用宿主。
- 宿主回执绑定 newRunId/previousRunId；无新 run 的启动失败必须清理该次预留，不标记旧 run 成功。
- 对身份不可恢复的 run 返回 `RUN_UNBOUND`，要求提供可验证的旧执行记录，不能猜测当前 active Task。
- 用户要求补报告时先本地解析原产物；合法则无需模型调用。确需修复使用显式 reportOnly packet。
- reportOnly 执行必须使用无文件写入能力的工具配置。若宿主原生 resume 不能收紧旧 worker 工具，改用绑定同 Task 的 fresh 只读修复执行，并解释模式选择。
- resume 与 fresh 修复都要进入相同预算、usage、摄取和 evidence 路径；旧 run 成本不重复记入新执行。宿主若返回累计会话 usage，须按已确认宿主契约计算增量并保留原始口径。
- `interrupt requested` 只是控制确认，不是进程终态。writer 释放等待宿主终态证据；stop 后产物报告仍按同一入口摄取。

## 8. RR-06：诊断、恢复与等待

增加 Root 工具 `planner_recover`：

```json
{"taskId":"T-20260911-007","runId":"<完整 run UUID>"}
```

该工具只读取已绑定 run 的收据与产物并重新摄取，不启动子进程、不接受任意路径。加入 Policy 的 Root 工具集合；Idle 下也必须验证 exact id、workspace 和持久化关联。支持对 unavailable/旧错误消费记录重新解析，但只在历史关联可信时执行。

统一错误结果至少包含：

```ts
{ code: string; taskId?: string; runId?: string;
  executionState?: string; ingestionState?: string;
  retryable: boolean; nextAction?: object; message: string }
```

错误码至少包括 `OUTPUT_PENDING`、`OUTPUT_UNAVAILABLE`、`OUTPUT_AMBIGUOUS`、`FOREIGN_RECEIPT`、`RUN_UNBOUND`、`REPORT_SCHEMA_INVALID`、`MODEL_UNAVAILABLE`、`TASK_PACKET_TOO_LARGE`、`EVIDENCE_UNAVAILABLE`。

- verdict 前继续 reconcile，但复用新入口。相同状态下重复 verdict 返回相同原因和可复制恢复动作，不增加修复计数。
- 失败拒绝返回结构化 details 和一致错误标记；普通 pending 用状态表示，不伪装成 worker 合同错误。
- 宿主明确支持 native notification 时启动提示要求返回控制权；需要主动等待的模式才提示 exact-id bounded wait。使用现有 Idle ≤60s 限制，不生成与 Policy 冲突的示例。
- attention 与 execution terminal 分开展示，不建议循环 status；宿主能力未知时仅提供一次性状态查询和有界恢复选项。
- 启动失败后重试成功，更新当前 stateReason；原失败保留为历史事件。

## 9. RR-07：模型预检

- 在有成本的启动前通过宿主公开模型解析/registry 契约得到 effective provider/model/thinking 和来源：显式输入、角色策略、agent override、默认配置。
- 不重写既有角色模型优先级；预检必须针对最终实际启动模型，不能只验证 Root 输入。
- 未知模型返回 `MODEL_UNAVAILABLE`，列出有界候选和配置来源。默认不静默换模型；仅在配置已有显式 fallback 时按其顺序选择并记录原因。
- registry 不可读时返回预检不可用，不能宣称模型已验证。若保留现有允许宿主自行校验的兼容路径，结果必须标记 unverified。
- 此次失败可记录 launch attempt，但不得遗留 writer 锁或未释放预算预留。
- 宿主契约需验证当前 0.67.0；对声明范围中的其他版本按 §13 管理，不能用版本号代替能力检测。

## 10. RR-08：WorkerReport 提示与规范化

- 实际发送给所有返回 WorkerReport 的角色的 prompt 必须包含 status 枚举 `completed/partial/blocked/failed`，以及 validation type/status 的合法值。
- 增加精确别名 `completed_with_limits → partial`，保留原始值与 repair 记录；不增加任意模糊成功映射。保留已有 risks/unresolved，不虚构缺失内容。
- 通用报告示例使用 `validation: []`；另给领域中性的 not-run 示例，省略 exitCode。禁止 `not-run + exitCode=0` 的矛盾组合。
- 规范化幂等；合法 partial 进入既有 review loop，不因别名修复自动完成 Task。

## 11. RR-09：数据任务证据契约（M2）

此项解决审计揭示的适配缺口，不声称它已导致本次 no-report 错误。先通过测试明确当前非 Git 判定，再按以下契约实现。

### 11.1 TaskSpec 扩展

复用现有 scope、acceptanceCriteria、validation.commands、expectedEvidence；新增可选 `dependsOn: string[]` 与明确的 evidence mode/产物声明。设计阶段应先检查 `types.ts` 的现有字段，避免重复语义。

- dependsOn 使用 canonical Task id，必须已 completed 才允许依赖执行；不能根据 Root 自然语言“已验收”满足前置条件。
- 新的 artifact evidence 模式下必须声明输出路径和至少一项可执行验证命令或结构化人工检查要求。
- `validation.required=true` 却无任何验证定义，在 artifact 模式准入时返回缺失字段；旧任务读取保持兼容，不能静默补齐验收条件。

### 11.2 Artifact evidence

- 显式区分 Git evidence 和 artifact evidence。非 Git 不应被伪造为 Git clean；证据缺失保持 unknown，不能 pass。
- 产物声明包含路径、类型、用途（输入/输出/环境）、验证方式与内容身份。内容身份必须由 Root 受限采样器或独立 Validator 取得并标明来源，不能仅采信 Worker 声明。
- 大文件使用流式 hash，受文件数、总读取字节、时间预算约束；默认不把整个基因组读入内存。超预算返回 unknown，并允许使用可信的已绑定内容清单/独立验证结果，不能用 mtime+size 代替内容身份。
- symlink 同时记录 link target 和授权目标身份；只有显式声明的外部路径可验证，不做递归扫盘。共享目录和 mamba 环境只采集指定产物/版本命令证据。
- artifact 模式的 pass 验证声明输出、必需验证结果、依赖状态和证据新鲜度；与 Git 模式共用 review 决策，不绕过 review。
- reportOnly 修复沿用原 execution 的变更证据归属，不能以修复时快照覆盖原执行基线。

## 12. RR-10：可携带诊断导出（M2）

增加操作员命令 `/planner-only export <directory>`。明确指定输出目录后生成：

```text
manifest.json       # 导出格式版本、插件/宿主版本与能力、时间、session/workspace
tasks.json          # Task 状态、报告/审查修订、依赖
runs.json           # run/execution/task 映射、模型来源、预算与 usage 口径
events.jsonl        # 启动、控制、收据、读取、规范化、摄取、verdict 时间线
outputs/           # 仅相关最终报告与必要收据；文件名由插件生成
summary.md         # 人类可读的状态与恢复建议
```

- 默认不导出模型凭证、环境变量全集、完整 thinking 或大体积业务数据。
- 保存与故障相关的最终报告和路径引用，复制后计算 digest；源产物已丢失必须在 manifest 标记 missing，不能导出成功却省略说明。
- 脱敏替换保持 task/run 关联一致，导出结果须可离线重放，不依赖原 `/tmp` 路径。
- 业务完成描述和正式 verdict 分列，不能把磁盘产物存在展示为 completed Task。

## 13. RR-01：回归 fixture 与测试矩阵

在 `tests/fixtures/runtime-2026-09-11/` 建立精简 fixture；若仓库实施时已有约定位置则沿用。fixture 中使用可替换路径占位符，在测试临时目录生成文件。不得依赖用户目录、真实生信结果或在线模型。

至少保留：L19/L76 completion 结构、c8e08f46→873bcc27 resume 回执、同名 agent 的旧 task 通知、Step 2/交接原始委派正文与预期 child packet。真实报告可脱敏精简，但必须保留触发故障的身份和 schema 特征。

| ID | 场景 | 必须断言 |
|---|---|---|
| C01 | completion 仅有 outputPath，旧目录不存在 | 正文摄取成功；报告追加一次 |
| C02 | 只有 archivePath | 按 run/child 正确取最终输出 |
| C03 | terminal 早于文件写入 | output-pending；corrections 不变；后续恢复成功 |
| C04 | 路径不存在/不可读/超限/歧义 | 分类诊断；不伪造空 WorkerReport |
| C05 | 加载与提交之间、提交与 ack 之间崩溃 | reload 后可恢复且仅一份报告 |
| C06 | A 消费后 B 同名 agent，A 通知迟到 | B 状态、登记、预算、报告完全不变 |
| C07 | 已知 runId 与 taskIdHint 冲突 | FOREIGN_RECEIPT；不退回弱匹配 |
| C08 | notify/bg_wait/context 任意顺序重复 | 一份报告、一份子执行用量；渲染稳定 |
| C09 | 多 child 通知、无身份旧通知 | 逐项正确路由；无法证明归属则不消费 |
| C10 | TaskSpec 外关键正文 | 最终启动 payload 保留所有必需细节 |
| C11 | packet 超预算、wrapper 重复、alias | 启动前报错/幂等包装/canonical id 一致 |
| C12 | Reviewer/Validator packet | 保留角色隔离与必需验证上下文 |
| C13 | resume 返回新 run | 新 execution、原 Task、previousRun 关联完整 |
| C14 | resume 失败/预算不足/writer 冲突 | 正确拒绝与清理，不损坏旧记录 |
| C15 | 新报告先到、旧报告后到 | 当前报告不回退；费用不重复 |
| C16 | reportOnly、interrupt 仅请求成功 | 修复无写入能力；未知终态不释放 writer |
| C17 | 连续四次相同 verdict | 稳定错误码和恢复动作；corrections 不增长 |
| C18 | planner_recover、旧 ledger、跨 workspace | 只恢复可证明绑定的 run；拒绝猜测归属 |
| C19 | native/detached/unknown 宿主模式 | 提示与能力、Policy 一致；无长阻塞循环 |
| C20 | 显式/默认/角色来源未知模型 | 预检最终模型并显示准确来源 |
| C21 | fallback 与启动重试 | 仅配置允许时切换；成功后当前原因更新 |
| C22 | completed_with_limits 与未知 status | 前者 partial + repair；后者明确合同失败 |
| C23 | 所有角色的实际合同提示 | 枚举可见；示例合法自洽 |
| C24 | 非 Git 声明产物 | 有证据可审查；证据未知拒绝 pass |
| C25 | 大文件预算/修改/权限错误 | 有界内存；unknown 不冒充 fresh |
| C26 | 外部 symlink 与环境证据 | 只验证声明目标；变化使旧证据失效 |
| C27 | required 验证缺失、未完成依赖 | 准入失败，返回具体缺失项 |
| C28 | 导出后移除源临时文件 | 离线重放摄取路径仍可用 |
| C29 | 缺失产物与脱敏 | 缺失显式呈现；关联完整、无凭证 |

C08 对三个通道至少覆盖全部 6 种顺序，并加入重复和 reload。C05 必须通过故障注入验证，不得仅测试正常 JSON 序列化。C10 必须检查宿主最终 launch payload，不能只测试中间 TaskSpec。

### 13.1 宿主兼容性

当前安装 0.67.0 在声明范围内，但已有旧产物路径依赖失效。实施必须：

1. 使用宿主公开契约或冻结的版本 fixture 验证 completion/archive/resume/usage 形状。
2. 至少对当前 0.67.0 和实际保留的旧兼容格式运行契约测试。
3. 声明范围内无法验证的路径记录为 unverified；发布前补覆盖或收窄范围，不能把 SKIP 当 PASS。
4. E2E 增加异步收据与摄取契约，不仅验证工具能力和模型启动参数。

## 14. 实施任务与依赖

下表为实施分解，不是已完成清单。若转为本地 issue，遵循 `.scratch/<feature>/issues/NN-*.md` 一任务一文件的仓库约定。

| ID | 交付物 | 主要文件 | 依赖 |
|---|---|---|---|
| RR-01 | fixture、失败回放、契约形状说明 | 新 fixture/测试、e2e.pi-subagents.test.mjs | 无 |
| RR-02 | CompletionReceipt、OutputResolver、RunRecord、可恢复提交 | notify.ts、orchestrate.ts、index.ts、ledger-store.ts、types.ts；可新增 completion.ts | RR-01 |
| RR-03 | 严格身份、幂等重放、多结果处理 | orchestrate.ts、index.ts、notify.ts、ledger-store.ts | RR-02 |
| RR-04 | TaskPacket 与实际 payload 保真 | roles.ts、task.ts、types.ts、相关测试 | RR-01 |
| RR-05 | resume/repair 执行登记与费用口径 | orchestrate.ts、index.ts、roles.ts、usage.ts、reservations.ts | RR-02、RR-03、RR-04 |
| RR-06 | 结构化诊断、planner_recover、等待指引 | index.ts、policy.ts、orchestrate.ts、README* | RR-02、RR-03 |
| RR-07 | 最终模型预检与重试原因更新 | role-models.ts、orchestrate.ts、宿主 adapter | RR-01 |
| RR-08 | 合同提示和精确别名规范化 | report.ts、roles.ts、相关测试 | RR-04 |
| RR-09 | 非 Git artifact evidence 与 TaskSpec 条件 | types.ts、task.ts、evidence.ts、workspace-snapshot.ts、review.ts | M1 |
| RR-10 | 可携带导出与离线重放 | index.ts、ledger-store.ts、usage.ts、导出模块、README* | RR-02、RR-03、RR-06；最终验收含 RR-09 |

RR-02/03 应作为同一发布批次交付：单独改输出路径而保留过早消费/弱匹配，不能关闭该故障。RR-04 可独立实施，但 M1 必须包含。

## 15. 验证命令与发布门槛

实施时新增测试必须接入 `npm test` 或 `test:release`，避免只有手工调用才验证。定向测试后执行：

```bash
npm run typecheck
npm test
PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e
git diff --check
```

也可用仓库已有 `npm run test:release` 执行前三项。未安装依赖时按仓库锁文件安装，不能因环境缺失将 typecheck/E2E 写成通过。在线模型运行不是离线回归的替代；发布可增加小型受控宿主 smoke，但不能重新执行真实生信任务作为测试。

### M1 验收清单

- [ ] C01～C23 通过，所有新增测试已加入标准命令。
- [ ] 六份原本可解析的真实报告在精简回放中进入正确 Task 的报告记录流程；正式 pass 仍由证据与审查决定。
- [ ] T-004/T-008 类旧身份错配复现不再修改新 Task。
- [ ] 两份任务包关键正文出现在最终 child launch payload。
- [ ] resume 新 run 可恢复、计费、摄取；补报告没有写入能力。
- [ ] 摄取成功、失败、超限、重复、reload 各路径均有持久化断言。
- [ ] 版本兼容范围与已验证宿主能力一致，发布契约检查无 SKIP。
- [ ] README/README.zh-CN/CHANGELOG 更新用户可见行为和恢复命令。

### M2 验收清单

- [ ] C24～C29 通过；artifact evidence 的未知状态无法 pass。
- [ ] 默认资源预算保持有界，11 GB 场景不需要把全文件载入内存。
- [ ] 导出可脱离原 `/tmp` 离线回放，缺失源产物有明确记录。
- [ ] 文档区分 execution terminal、报告记录、业务产物、正式 verdict。

## 16. 历史数据与发布后恢复

- 不批量重跑原任务、不自动修改原 session JSONL。
- 历史 ledger 可以按新格式读取；缺少 execution/run 关联时通过导入的原始启动收据建立可验证关联，否则保持 RUN_UNBOUND。
- 历史报告重新摄取必须保留原执行身份和产物 digest；若原执行 evidence 已缺失，允许记录报告并显示 evidence unknown，但不得自动 pass。
- 回滚代码前先导出新格式 ledger。旧版本不认识的新字段/格式必须可检测，不能悄悄丢弃摄取记录。
- 实施结束提交验证摘要：完成的 RR、通过的 C、实际宿主版本/能力、运行命令和结果、未完成项。只有满足相应门槛才能将 M1/M2 标为完成。
