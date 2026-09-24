# Pi + planner-only 第二场运行：优化审计与后续工作总表

Date: 2026-09-11

Status: analysis-complete; implementation-pending

Source baseline: `7544cc3cd63135827ee6545cf2c4f77b38cb8527`（package 0.4.1）

Repository: `/public/pi/pi-planner-only`

## 1. 结论

本场确实交付了七票修复，但还不能据此认定运行可靠性已完整闭环。最需要优化的是：**身份创建、事件适配、证据归属与恢复动作的确定性**。继续增加 prompt 警告只能缓解部分合同错误，不能解决这些状态链路问题。

建议先执行已有 [Task 身份与 TaskSpec 修复保真 Spec](./runtime-identity-and-spec-repair-2026-09-11-spec.md)，同时把本场新增的“多身份报告修正误路由”纳入身份链路验收。随后完成原 RR-02/04/06 的宿主接线，再处理并发证据归属、独立验证完整性和成本优化。

主要判断：

1. **IS-01 仍是 P0，且本场有新增现场证据。** 新修正执行在 L330 被登记为已有 T-001，而正文明确要求修正 T-011。
2. **RR-02/RR-06 仍有真实接线缺口。** 40 次 `bg_wait` 中 34 次输出“terminal but saved output could not be delivered”；末尾 L607 的报告在当前解析器可解析，L623 又正式通过，不能把这些等待文案全部当作报告合同失败。
3. **RR-04 仍未实现无损下发。** 当前 `prepareRoleDelegation()` 仍用序列化 spec 替代正文；离线哨兵复现确认 spec 外指令丢失。
4. **本场新增高价值优化项：** Idle 下合法 Supervisor 回复无法送达、并发只读任务被要求声明别人的修改、Oracle 的 missing 模式遗漏独立检查、报告修正多 ID 歧义，以及实际轨迹与验收统计的口径不一致。
5. **模型 registry 缺席告警已经修复。** `7544cc3` 决定 unverified-and-continue 并增加一次性告警；旧 progress 的待决项已经过时。真实 registry 接缝和其他宿主模式仍需验证。

本文是综合审计与实施入口，不替代已有 IS/RR 验收定义。原身份 Spec 保持为独立待实施任务；下文新增项使用 O 编号，旧问题沿用原编号，避免重复立项。

## 2. 证据与统计口径

### 2.1 实际日志位置

本场 Root 日志实际是同名目录旁的 JSONL，**不是该目录内的 `session.jsonl`**：

```text
/home/tcuni/.pi/agent/sessions/--public-pi-pi-planner-only--/
  2026-09-11T07-57-37-223Z_01a08f78-da46-74bd-a6c4-d22b6e2cdb47.jsonl
```

下文 `L<n>` 指该文件物理行号，本次读取共 628 行。子会话根记为 S：

```text
S = /home/tcuni/.pi/agent/sessions/--public-pi-pi-planner-only--/
    2026-09-11T07-57-37-223Z_01a08f78-da46-74bd-a6c4-d22b6e2cdb47/
```

检查了 S 下全部 32 份 `*/run-0/session.jsonl` 的输入、最终文本和工具错误，并深入核对关键执行。**宿主 runId 与子会话目录 UUID 不相同**，必须使用 completion 的 `results[].sessionFile` 关联。例如：

| 宿主 runId | 子会话目录 UUID | 用途 |
|---|---|---|
| `fb580126-aaef-4b49-9919-edc675986066` | `21fea952-7594-458e-beb2-b9ee843b6d9b` | Supervisor ask / 中断 |
| `c324058d-c911-49be-aceb-8e87a299cfb1` | `41fdf69b-b8cc-46f4-acdb-5fdd6a716140` | T-011 修正被登记为 T-001 |
| `94203cb9-9eed-4759-9704-f67e84b8196b` | `4c0fbf76-630d-430f-ae99-4dd630ff3548` | RR-07 Oracle missing 模式 |
| `38066ebd-bc51-4b3f-958f-4970877487c2` | `0ed79cfc-c8b1-4fc1-8057-696f1ee25a46` | 最后提交/推送任务 |

当前持久目录存在 `ledger/`、`run-state/`、`usage.jsonl`，未找到用户列举的 `planner-only/runs/`。这是当前文件系统事实，不证明历史上从未导出 usage record。`completion.ts` 的生命周期 RunRecord 与 `usage.ts` 的费用对照 RunRecord 是不同类型，审计导出需要明确区分。

### 2.2 Root 工具统计

仅统计 Root `message.role=toolResult`，不把自定义通知、模型思考或源码引用计作工具失败：

| 工具 | 返回次数 | `isError=true` |
|---|---:|---:|
| subagent | 36 | 3 |
| bg_wait | 40 | 1 |
| planner_verdict | 20 | 0 |
| git_audit | 25 | 2 |
| read | 20 | 0 |
| bash | 7 | 7 |
| subagent_supervisor | 2 | 2 |
| 合计 | 150 | 15 |

- 34 次 `bg_wait` 返回上述无法交付文案，是**返回次数**，不是 34 个独立失败任务。
- 20 次 verdict 返回中：13 次 accept、3 次 blocked、1 次 unknown task、3 次 already completed。后四次拒绝的日志 `isError` 仍为 false。
- Root 的 `bash`/Idle Git 拒绝及 L59 的 120000ms 等待超限符合现行 policy；部分调用属于主动探针，不能把 15 次错误全部计为插件缺陷。
- 32 份子会话共观察到 **27 次 tool-budget hard-limit 拒绝，涉及 7 份子会话**；这些也不等于 27 次独立任务失败。
- 会话包含 148 条 root-turn、50 条 child、42 条 injected、43 条 leak 用量 custom entries。它们是账本事件数，不能直接当作唯一执行数或可节省费用。

### 2.3 版本与证据边界

本场是在修复插件自身的长会话中执行。源码 HEAD、已安装 clone、当前进程加载的模块可能不同；本次没有完整逐次 reload/加载哈希证明，不能把每一行运行结果都等同于 `7544cc3` 的行为。

本文分别使用：原日志证明现场症状、当前源码证明实现缺口、离线复现证明当前行为。Root 的 verdict summary 是裁决内容，不自动等于独立验证事实；当前 ledger 可能已被后续会话更新，历史归属优先采用原始收据和子会话。

## 3. 已落地修复与仍需完成的旧需求

| 项目 | 本次审计判断 | 后续处理 |
|---|---|---|
| `02a886c`：输出解析/执行状态/resume 等基础设施 | 已有模块和测试，不能等同于全部宿主入口接通 | 继续 RR-01/02/03/05 的端到端验收 |
| `87f0f7c`：canonical 下发及合同 | 修复占位 id 未下发这一层；不修复全局 Task ID 冲突 | 保留回归，IS-01 优先实施 |
| `4bdf2a0`：枚举与规范化 | 已实现精确别名与 `not-run + 0` 清理；真实 null 样本仍拒绝 | RR-08 补验，见 O-05 |
| `d17e4d9`：planner_recover | Root 工具、绑定检查已存在；并不意味着 bg_wait/native/reload 全链路通过 | RR-06 继续验收 |
| `3ede155`、`7544cc3`：模型预检/缺席告警 | unverified-and-continue 决策已落地，告警在源码存在 | 更新状态记录；真实 registry 能力仍标 unverified |
| `6adfada`：进度文档 | 文档尚未反映最后一票的决策 | 以后按验收矩阵更新，不沿用旧 open item |
| IS-01 / IS-02 | 当前代码仍有序号重置、create 返回旧记录和修复保真问题 | 原身份 Spec 全部保持待实施 |
| RR-04 TaskPacket | 当前源码仍丢 spec 外正文 | 按原 C10～C12 实施，不能标完成 |
| RR-09 / RR-10 | 本场不是数据任务适配验收；导出也尚未形成统一入口 | 保留 M2 范围，O-07 是导出的补充要求 |

### 3.1 RR-02/RR-06：Completion 存在，但 bg_wait 未交给摄取器（P0）

**证据：** L17/L33/L79/L334/L607 的 `details.completions[]` 包含外层 runId、`results[].outputState=present`、`results[].artifactPaths.outputPath` 和外层 archivePath。L607 对应当前磁盘报告可解析为 T-021 completed，L610 再次等待仍返回同一句失败提示，L623 正式 accept。

**当前源码：** `index.ts:1067–1080` 只为 usage 读取 bg_wait 结果，然后把 `event.input` 和 cwd 传给 `recoverPendingRun()`；没有传递 `event.details`。`orchestrate.ts:2935–2959` 通过旧登记/meta 路径恢复，失败时仍建议 inspect/re-delegate。当前启动文案 `orchestrate.ts:3223` 仍统一要求 `bg_wait`，不是按宿主通知能力选择动作。

**要求：** 复用统一 receipt 入口，逐项处理 `completions[].results[]`，保留外层 run 身份与内层 outputRef；对已记录结果返回缓存状态。`output-pending` 应优先给绑定的 `planner_recover`，不能把启动新模型当作默认恢复。native 模式返回控制权；detached/unknown 的有界等待按原 C19 验收。

**回归：** 使用 L607 的精简真实形状，经过 index 的实际 tool_result handler，断言报告追加一次、同 run 重复等待稳定、无新模型执行；覆盖 native 通知先到/后到、文件迟到及 reload。不能仅调用 OutputResolver 的单元测试替代。

### 3.2 RR-04：正文保真缺口仍在（P0）

`roles.ts:690–707` 用 `JSON.stringify(packetSpec)` 构建 packetBody；只有少量插件生成的 correction lead 被加入。当前离线输入“spec 外哨兵 + 合法 TaskSpec”，调用 `prepareRoleDelegation()` 后哨兵消失。

本场具体后果见 O-02：L309 要求修正 changedFiles，但实际子会话 `S/9eb06a3c-98c4-46a4-8dcd-fbacf2ae29ef/run-0/session.jsonl:5,24` 收到原提交目标与通用修正提示，最终仍返回 `changedFiles:[]`。后续实现应把本次修正要求与原始任务 spec 分开保留，沿用 RR-04 的字段权威及超限拒绝规则。

### 3.3 RR-01：Fixture 已存在，但发布门禁没有覆盖它（P1）

- `package.json:54–57` 的标准测试/发布链未包含 `tests/runtime-reliability-2026-09-11.test.mjs`；根测试文件中也未找到对它的导入。
- 该测试的 L103–108 用测试内部的字符串相等模拟路由，没有调用真实 Orchestration；L122–126 比较预制 expectedChildPacket 与 fixture 自身，没有调用最终 launch 转换。
- 当前实际 `prepareRoleDelegation()` 丢正文，但该 fixture 测试仍 PASS，证明 fixture 完整性验证不能替代实现验收。

接入标准测试只是第一步。需要让 C01/C06/C10 等直接执行宿主适配、状态变更和最终 payload 路径；按原 Spec 补时序全排列和故障注入。修复前至少一条现场回归应能真实失败。

## 4. 本场新增优化项

### O-01（P1）：Supervisor 控制通道与 Idle 状态冲突

**现场：** L45 请求回复已知 ask `b1021482-f25b-49dd-bb67-e48e14889eb8`，L46 被 Idle guard 拒绝；L49 改走 steer，L50 宿主明确表示存在 pending supervisor ask，必须显式 reply；L52–53 查询 pending 也被拒，最后 L55 interrupt。子会话 `S/21fea952-7594-458e-beb2-b9ee843b6d9b/run-0/session.jsonl:31` 记录 `Supervisor request cancelled`。

**当前实现：** `policy.ts:158–174` 的 Idle allowlist 不含已绑定 ask 的 reply；只在 live 分支整体允许 supervisor。离线 `decidePolicy(liveTask:false, toolName:subagent_supervisor, action:reply)` 仍拒绝。canonical id 下发修复避免了本次“问 id”的诱因，但合法澄清、依赖决策仍可能走此通道。

**建议契约：** 将“无 live Task”与“存在待处理控制请求”分开。只允许回复宿主证明绑定到当前 session/workspace/run 的 pending ask；replyTo 不存在、跨 workspace、重复已关闭请求返回具体错误。控制回复不创建 Task、不释放 writer、不计作执行终态。提示按状态给出 reply 或 recover，而不是通用新委派模板。

**验收：** Idle + 已登记非终态 Explorer ask 可回复并完成；伪造/外部 ask 拒绝；ask 与 terminal/reload 交错时幂等；不靠禁止 child 向 Supervisor 提问来通过测试。

### O-02（P0，与 IS-01 联动）：报告修正多 ID 歧义落入新建任务

**现场：** L329 的修正要求明确目标 T-011，正文又引用变更所有者 T-010；L330 却返回“Placeholder task T-001 created”。L334 的 completion 关联子会话 `41fdf69b…`，其最终报告仍写 T-011。L339–357 又为误路由的 T-001追加修正/验证，最后因 already completed 被拒。L360 使用内嵌 TaskSpec 后，L372 才验收 T-011。

**根因分层：**

1. `roles.ts:409–417` 仅当正文恰有一个 Task ID 时才做命名绑定。当前用 L329 原参数复现得到 `namedTaskIds=[T-011,T-010]`，没有目标 taskId。
2. `isUnnamedDelegationTarget()` 不允许把这种歧义请求 fallback 到 active，这个限制本身合理；缺失的是**歧义必须拒绝**，而不是继续新建占位执行。
3. 占位任务随后复用 T-001 是 IS-01 的 create/allocator 问题。修复分配只能让误派变成新的无关任务，不能解决修正绑定。
4. 单一目标绑定成功后，RR-04 的正文丢失仍可让具体修正指令消失。

**要求：** reportOnly 必须有可验证的明确目标（结构化 taskId/TaskSpec 或无歧义旧兼容入口），多 ID/未知 ID 返回例如 `REPORT_TARGET_AMBIGUOUS` / `RUN_UNBOUND`，并给出含 canonical taskId、execution/revision 的可复制修正动作。不得新建 placeholder，也不得猜测最新任务；身份错误不得消耗 worker 修正次数。结构化字段优先于正文中的引用 ID。

**验收：** 回放 L329；目标 T-011、引用 T-010 时拒绝或精确绑定 T-011；T-001/T-010 全状态及费用不变；任务总数不增长。结合 IS I01～I08 校验全局创建，再校验最终 prompt 含本次修正内容与只读能力。

### O-03（P1）：证据窗口变化不等于执行者修改

**现场：** L315/L329 明确说 T-011 是只读研究，10 个文件属于并发 T-010 提交，但要求将它们填进 changedFiles 才能消除 undeclared。L358 仍 blocked，L360 补齐声明后 L372 显示 attributed 10 paths 并通过。

这不是正常的“补全漏报文件”：输出契约迫使只读任务申报别人的修改。`CONTEXT.md:42` 与执行 truth 比较建立的是时间窗口 diff；同 worktree 内 Explorer 可与 writer 重叠，时间差分本身不能证明作者身份。

提交类任务还有独立语义：L227 的 T-008 因 over-declared 被阻塞，L244 用 [] 通过；T-012 的 [] 又造成 under-reported，L327 才通过。后续 T-014/T-016 采用声明提交文件成功，只能证明该场景约定可用，不能证明统一规定“commit 必须全声明”适合所有窗口。

**建议设计：**

- 分列执行修改、提交产物及外部观察变化（如 executionChangedPaths / committedPaths / observedExternalPaths；具体命名可沿用现有类型）。
- 保留 Root 独立采样，以已绑定执行、提交范围和能力信息辅助归属；无法确定时标 unknown，需要核对，不能按 Worker 自述直接排除。
- 对只读 Task：外部变化影响已读证据新鲜度，必要时重读/重验，但不应通过虚报 changedFiles 解除。
- 对 commit-only Task：保留 A_run 的 HEAD/index/worktree 状态，验证提交范围与内容；不把“把既存 dirty 内容提交”误作当前执行的新编辑，也不丢失提交产物。
- reportOnly 延续原变更窗口与 finding 归属；不能通过修正时 clean 快照清空旧证据。

**验收：** Explorer 与 writer 重叠、提交已有 dirty 文件、新编辑后提交、跨报告修正及真实外部未归属修改五类场景；分别断言作者归属、新鲜度、finding 与最终 verdict。该项修复前避免同时在同 worktree 做独立 gather 和提交验收，是运行规避手段而非完成定义。

### O-04（P1）：Oracle 的命令去重吞掉独立验收义务

**现场：** `S/4c0fbf76-630d-430f-ae99-4dd630ff3548/run-0/session.jsonl:5` 要求检查 HEAD/status、预检调用顺序、registry 接线、C21 断言等六组内容，但顶部被包装为：

```text
ORACLE_SUITE=missing. Run only the missing TaskSpec validation commands:
node --test role-models.test.mjs. Do not re-run commands that already passed.
```

最终 L8 仅报告跑了该测试，其余列 not-run；没有完成所要求的源码证据检查。Root L494 已披露只跑一项，但仍不能将这轮算作完整独立验收。

**当前实现：** `roles.ts:669–683` 根据缺失 commands 子集和 freshness 选择 missing；`wrapOracleContract():111–117` 将限制写成全局 “Run only”，把降低重复测试成本与非命令检查混为一谈。

**要求：** 将 validationCommands 的去重与 inspectionChecks/acceptanceCriteria 的覆盖独立处理。missing 只约束重复执行哪些命令，必须继续完成指定源码检查；复用 Worker 验证与 Oracle 独立验证分别标记来源。返回每项 checked / reused / not-run / failed，不能用“一个测试过了”代表整项 checked。

**验收：** 重放上述六组要求，只跑一个缺失测试时仍完成指定只读检查；缺失任一 mandatory check 则明确 incomplete。与 RR-04 联测，保证检查项进入最终 child payload。

### O-05（P1，RR-08 补充）：合法枚举不等于报告合同已经可用

**真实样本重新解析结果：**

| Root 收据 | 当前 extractWorkerReport 结果 | 含义 |
|---|---|---|
| L17 / e5a1d6cf | validation[3].status 非法 | 合同错误，不是缺少文件 |
| L33 / 9fa959b5 | 结构可解析，taskId=T-pending | 仍需身份校验 |
| L69 / cd827d52 | 无 WorkerReport object | 不能通过修枚举挽救 |
| L79 / 4d642dc7 | 顶层 status=gathered 非法 | 既有 Root summary 仅说“迟到 park”不完整 |
| L485 / 94203cb9 | 3 个 not-run 条目的 exitCode=null 非法 | RR-08 后仍有真实合同缺口 |
| L607 / 38066ebd | T-021 completed，可解析 | 其 wait 失败提示不能归因于 schema |

`report.ts:250–252` 只清理 `not-run + exitCode=0`，不清理 null。`workerReportShapeReminder():464–465` 仍生成 `not-run + exitCode=0`，与原 RR-08 的自洽示例要求不符。现有 report 测试通过并未覆盖该现场 null 报告。

**要求：** 先让所有实际 report-returning prompt 与示例明确 not-run 省略 exitCode，示例本身须自洽而不依赖 parser 修复。对于 `not-run + null`，可做明确、保守、带 repair note 的删除并验证幂等；不据此改变 status、不制造成功验证。失败码/其他矛盾按合同诊断。解析、身份、必需验证覆盖和正式 pass 四个阶段分别显示。

**验收：** 上表六个精简 fixture；合法 id 的 null 报告按约定修复或给出准确可执行错误；非法 gathered 仍拒绝，缺少报告仍保持缺失，不映射为成功。

### O-06（P2）：预算耗尽后的收尾能力与任务粒度

**现场：** 27 次 hard-limit 拒绝集中在 7 个 child；例如 `S/30671e10…/run-0/session.jsonl:30–38` 连续 9 次读被拒；`S/f7e1e081…/run-0/session.jsonl:31–34` 被拒后没有最终 JSON。这些与前五次反复 gather 相互放大。

本场初始 gather 要求同时搜索 .scratch、三份长文档、Git 历史并审阅源码，却使用 20 次工具预算。直接把 hard cap 普遍调大未必降低成本。

**建议：** 在 packet 中明确剩余工具预算与收尾要求，软阈值提示保留报告输出，硬阈值后进入 finalization-only；工具预算不足时输出有来源的 partial，而不是反复尝试同一被禁工具。为 known docs 给定路径/章节，将宽范围探索与针对性源码核验分开。收尾行为需适配宿主能力，不能假定插件已能控制所有 child turn。

**验收/指标：** 收尾仍产出可解析 partial；预算终止后的无效工具调用数、schema 失败率、每个被接受目标的总运行数与总成本，包含所有失败重试和修正，不只统计成功 run。子执行内正常 TDD 红灯/编辑失败单列，不笼统归为插件故障。

### O-07（P1，RR-10 补充）：运行身份、错误语义和验证账本可观测性

**已确认现象：**

- L5/L9/L12 的 Root 用量归到 T-003 executing，但 L7/L8 policy 表示当前 cwd Idle。当前 `index.ts:1134–1137` 用全局 `store.active()` 计费，policy 使用 workspace 视图；`TaskStore.active():783–786` 不限制 cwd。记录归属不一致成立，具体历史 T-003 所属工作区需结合当时快照，不能仅凭此断言跨项目污染。
- L262/L357/L523/L527 的拒绝在原 JSONL 中 `isError=false`，而当前 `index.ts:925–949` 已设置 true。需要检查宿主序列化或实际加载版本，不能重复“修”一个当前源码已有的字段。
- 当前源码和七票提交都保留 package 0.4.1，单独记录 package 版本不足以证明正在运行哪一版；Root run 与 child session 的 UUID 也不同。
- 进度文件把终态重复拒绝算 C17 pass，但原 C17 要求重复故障 verdict 的稳定原因、恢复动作及 corrections 不增长。L523/L527 只覆盖已完成任务，不足以替代无报告/输出 pending 的四次回放。

**要求：**

1. 会话启动/reload 导出 source path、已加载源码 digest/commit（可得时）、宿主/子代理版本、capability、session/workspace；source tree HEAD 与 loaded build 分列。
2. 同一导出内记录 host runId、child sessionFile、toolCallId、executionId、canonical taskId、alias、reportRevision，并区分 usage record 与生命周期 RunRecord。
3. Root 用量按本轮明确操作目标和 workspace 归属；无法唯一归属时进 session/unattributed 桶，不默认挂全局最新任务。保留原始账本，不自动迁移历史混合记录。
4. 结构化事件标明 policy-rejection / host-error / ingestion-error / lifecycle-refusal / accepted；统一 code、retryable、nextAction。回归断言最终宿主 JSONL，而非仅工具 execute 返回值。
5. 验收矩阵区分 implemented / unit-verified / host-verified / unproven；每项关联测试或原收据。当前 C17 应记“终态子场景有证据，原完整条件待验”，C19 继续 partial，C20 的 absent-registry 已决策但 real-registry 接缝未证明。

本项并入 RR-10 导出，而不是再引入一个无法与原始收据对齐的独立统计系统。

## 5. 建议实施顺序与验收门

用户追加并确认的性能需求：**默认最大并行数 3，命令可调，Root 在安全时主动并行**。独立规格见 [默认安全并行策略](./default-safe-concurrency-2026-09-11-spec.md)（CP-01～CP-06）。身份与 completion 生命周期先过门，第一阶段开放独立只读/隔离 worktree；同 worktree 读写混合并行等待 O-03 修复及专项验收。

| 批次 | 工作 | 完成门 |
|---|---|---|
| A：身份 | 原 IS-01/IS-02 + O-02 歧义绑定 | 原 I01～I08/S01～S07；L329 不创建/复用错误 Task；修正目标和最终角色/正文一致 |
| B：运行通道 | RR-02/03/04/06 的实际入口 + O-01 | 真实 nested completion 可摄取；notify/wait/recover 一次记录；绑定 ask 可回复；正文完整；崩溃/reload 可恢复 |
| C：证据与验收 | O-03/O-04/O-05 | 只读任务不虚报他人修改；commit/repair 归属稳定；Oracle 检查覆盖完整；真实报告可分类处理 |
| CP：默认安全并行 | 身份/运行通道过门后实施 CP-01～CP-06 | 默认 3、命令可调；独立任务主动并行及完成补位；容量、writer、资源、依赖和预算联测通过 |
| D：门禁与诊断 | RR-01 + O-07；O-06 按统计优化 | 现场回归接入 release；错误/版本/身份可导出；发布结论可追溯 |
| M2 | RR-09 / RR-10 剩余数据适配 | 保留原 C24～C29，不用本场代码任务结果替代数据任务验收 |

测试入口改造应从 A 开始同步进行；D 是发布前汇总门，不是等最后才写回归。实施票按仓库约定拆到 `.scratch/<feature>/issues/`，每票引用本页 O 编号及原 Spec 验收 ID。

优先回归集合：

- **R-A**：共享 ledger 多进程唯一身份 + L329 多身份修正拒绝/精确绑定。
- **R-B**：L607 nested completion → 实际 index handler → 一份报告；重复到达/reload 不重新计费。
- **R-C**：spec 外指令及 reportOnly 指令经过最终 launch 后仍完整。
- **R-D**：Idle 且已绑定 ask 的回复/取消/terminal 交错。
- **R-E**：只读 gather 与提交重叠，不要求申报外部作者修改；证据不新鲜仍需重验。
- **R-F**：Oracle missing commands + 必需源码检查均覆盖；null/not-run 合同规范化幂等。
- **R-G**：连续四次同一 output-pending verdict 返回同一恢复动作且 corrections 不变；另测 completed 拒绝。
- **R-H**：真实宿主记录的错误标记、source/loaded build、run/task/session 关联及非归属费用桶正确。

每批定向检查后按原 Spec 执行 `npm run typecheck`、`npm test`、`PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e`、`git diff --check`。已有 unit PASS 不作为缺少 host replay 的替代证据。

## 6. 本次审计实际完成的验证

- 原 Root 628 行逐条结构化提取工具调用/返回、拒绝、completion 与 verdict；32 份子会话输入/最终输出/工具错误汇总及关键会话细读。
- 对照 `a9167a6..7544cc3` 七票 diff、现有 RR/IS Spec 与 progress；核对当前实现入口和发布测试清单。
- 当前代码离线复现：Idle Supervisor reply 拒绝、L329 多 ID 目标未绑定、spec 外哨兵丢失。
- 当前 `extractWorkerReport()` 直接检查六份真实磁盘输出，结果见 O-05。
- 实际执行且通过：

```text
node --experimental-strip-types tests/runtime-reliability-2026-09-11.test.mjs
node --experimental-strip-types completion.test.mjs
node --experimental-strip-types report.test.mjs
```

这些 PASS 用于确认现有测试行为，并不消除本文发现的接线与覆盖缺口。本次产物为分析文档，未实施插件修复，也未执行在线模型、完整 release 测试或变更历史 session/ledger。

## 7. 相关文档

- [用户确认：默认安全并行策略（默认上限 3）](./default-safe-concurrency-2026-09-11-spec.md)
- [尚未处理：Task 身份与 TaskSpec 修复保真](./runtime-identity-and-spec-repair-2026-09-11-spec.md)
- [原运行可靠性 Spec（RR-01～RR-10）](./runtime-reliability-2026-09-11-spec.md)
- [首场运行审计](./runtime-audit-2026-09-11.md)
- [现有进度交接（注意末票之后的状态校正）](./runtime-reliability-2026-09-11-progress.md)
