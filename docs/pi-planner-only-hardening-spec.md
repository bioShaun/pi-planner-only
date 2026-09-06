# pi-planner-only 可靠性加固规格说明

- 状态：Draft / 已更新问题状态，设计待评审
- 初稿日期：2026-09-05
- 状态复核日期：2026-09-06
- 目标仓库：https://github.com/bioShaun/pi-planner-only
- 初稿参考版本：所读取 main 分支的 package.json 为 0.2.3；当时未固定 commit
- 本次复核基线：本地 HEAD [76f022b](https://github.com/bioShaun/pi-planner-only/commit/76f022b0f022accdb79ad07c1bded91d524bda98)，package.json 为 0.3.2；不据此推断远端 main 状态
- 文档范围：证据有效性、委派边界、任务写锁、审查上下文、工具集合恢复与质量门禁

> 初稿基于局部静态审查及本地 Git 最小实验。本次对当前任务、报告、审查、委派、证据与工具管理相关实现进行了源码核查，并直接调用现有函数完成不落盘的定向复现；未运行完整测试、真实 Git 回归矩阵或上游端到端契约验证。本次仅更新文档，没有修改实现。本文中的新增接口、字段和行为仍为设计要求，不是现有实现描述；“已修复 / 已具备”表示当前源码已有对应机制，不代表本次已通过完整验收。

## 1. 背景与目标

pi-planner-only 的核心价值是让 Root 专注规划、委派、检查与裁决，将文件变更和执行交给子代理。现有实现已有工具白名单、结构化任务与报告、审查循环和 Git 证据采样。

本轮不扩展为通用 agent framework，而是加强三个承诺：

1. 接受任务时，验证证据必须对应当前被验收的内容。
2. 每个委派入口都必须经过同一套角色、身份和可写能力检查。
3. 生命周期失败或扩展开关不能静默削弱约束或改变用户工具偏好。

### 1.1 成功标准

- 修改已 dirty 文件或未跟踪文件的内容，可以使旧证据失效。
- Git 探测错误、证据字段缺失和快照不稳定不会被解释为 fresh。
- 不支持的批量或链式委派在子代理启动前明确拒绝。
- 无结构化任务和具备 bash 能力的 validator 不能绕过写入协调。
- Reviewer 可以获得与确定基线和快照绑定的受控差异证据。
- 开启再关闭扩展不会无意启用用户原先禁用的工具。

### 1.2 非目标

- 通用调度队列、多机任务编排、遥测平台。
- 完整持久化和自动跨会话恢复。
- 把工具白名单或进程内锁宣称为操作系统安全沙箱。
- 仅依靠模型自述证明测试真实执行。
- 默认向 Root 或 reviewer 注入全仓库无限量 diff。

## 2. 审查依据与不确定性

### 2.1 当前问题状态

状态定义：**仍存在**表示当前实现有明确缺口；**已修复 / 已具备**表示旧判断不再适用于所列范围；**部分完成**表示已有机制但未满足完整目标；**待验证**表示不能仅凭本次证据认定实际失败。

| 事项 | 当前状态 | 证据与复核结论 |
| --- | --- | --- |
| 内容新鲜度与 PASS 绑定 | 仍存在；函数级复现 | 已有 dirtyPathHashes 和已提交路径归因，不再是完全没有内容哈希；但哈希只用于委派基线 A 到当前 C 的变更归因，未绑定验证时内容。报告后内容哈希改变、路径/HEAD/status 不变时，compareEvidence 仍可返回 fresh，decideReview 在 PASS 下仍返回 accept |
| 探测失败与字段缺失 | 仍存在；函数级复现 | probeGit 将 status 非零退出折叠为空输出，仍返回 available=true 和空状态哈希；缺少可选证据字段也可得到 fresh。明确 gitAvailable=false 的路径已有 revalidate 门禁，不能概括为所有 Git 失败都会放行 |
| tasks/chain 批量执行入口 | 已修复；源码核查及函数调用 | compositeWorkflowBlockReason 已拒绝非空 tasks/chain，并覆盖 workflowScript 等复合执行输入；index.ts 在角色准备与 beginDelegation 前拦截。带 action 的管理调用另走分支，其上游契约仍需验证 |
| reviewer 重绑定原 TaskSpec | 已修复；源码核查 | beginDelegation 的 reviewer 分支独立记录 invocation，不创建、重绑定或迁移原 Task；保留回归要求 |
| 审查结果绑定报告版本/快照 | 仍存在；源码核查 | validateReviewResultIdentity 只核对 taskId，没有 reportRevision/workspaceDigest；同任务旧审查结果与新报告之间缺少可靠版本边界 |
| 异步启动回执与完成关联 | 部分完成；源码核查 | 已有回执识别、完成通知关联及 runId 去重，不能再概括为未处理异步回执；取消、迟到通知及各角色完整路径仍需宿主契约验证 |
| 非结构化委派写锁 | 仍存在；源码核查 | beginDelegation 对无 spec 路径明确跳过冲突检查；warn 模式不满足统一写入协调 |
| validator 可写能力 | 仍存在；源码核查 | validator 工具配置含 bash，且委派提前返回、未进入写锁检查；没有 edit/write 不等于只读 |
| 写锁身份、工作树范围与过期 | 仍存在；源码核查 | findWriterConflict 排除同 taskId，只比较 resolve(cwd) 相等，并排除 isExecutingStale 的 holder；不确认旧进程退出就允许过期 holder 不再阻挡新 writer |
| reviewer 差异证据 | 仍存在，已有部分归因能力；源码核查 | packet 有变更路径、归因路径及 diff stat，但无 patch；packet 的 diff check 只覆盖 unstaged 且丢弃退出码/stderr。不能把归因已提交路径等同于提供已提交改动的可审查 diff |
| 自动激活全部安全工具 | 已修复；源码核查 | filterPlannerTools 当前只过滤 activeTools，不再把全部已注册安全工具加入激活集合 |
| 工具恢复与配置反馈 | 部分完成；源码核查 | 已跟踪 suppressedTools，但恢复时直接合并，未区分期间用户/其他扩展关闭意图；status 已显示有效状态和来源，但环境变量强制 off 时执行 on 仍提示 enabled |
| 类型检查与运行环境声明 | 部分完成；源码核查 | 已有 tsc --noEmit、tsconfig、Node >=22.6.0、pi-subagents >=0.65 <0.70 声明和锁文件；Pi 宿主依赖仍为 *，本次未验证类型检查是否通过 |
| 上游契约与发布门禁 | 部分完成 / 待验证 | 已有独立 E2E 脚本，但缺依赖或版本不符会 SKIP 并退出 0；尚未确认发布环境是否另有强制门禁，不能宣称发布流程已经实际放行 |

### 2.2 本次复现与证据边界

- 直接调用 compareEvidence：基线无 dirty 路径，报告和当前样本均声明同一变更路径、HEAD 和 status 哈希，但其文件内容哈希不同，结果仍为 verifiable=true、fresh=true；再把该比较结果和 PASS 传入 decideReview，结果为 accept。这是函数级组合复现，不是一次真实宿主任务的端到端误验收。
- 向 probeGit 注入 status 退出码 128 的模拟 runner，其余探测成功，得到 available=true、changedPaths=[] 和空状态哈希；没有保留 status 的失败语义。
- 在基线和当前样本无变更的输入下，报告缺少 HEAD/status hash 等可选证据字段时，compareEvidence 仍返回 fresh；不能据此宣称所有缺字段报告都必然通过。
- 调用 compositeWorkflowBlockReason 验证非空 tasks 被拒绝，并核对 index.ts 的拦截顺序；未验证所有上游输入形态。

后续仍需运行完整测试、真实 Git 场景和上游启动/等待/取消/重载契约验证。已修复项保留为回归目标，不再安排重复实现；未核实风险不得写成已复现漏洞。全量快照范围、非 Git 文件快照模式及具体字段结构属于待评审设计选择，不是缺陷成立后的唯一实现方案。

## 3. 核心不变量

- INV-01：fresh 必须意味着必要证据完整，且所验证内容与当前验收快照一致。
- INV-02：stale、unknown 不得自动完成任务。
- INV-03：任务身份、执行身份、报告版本和验证快照必须明确绑定。
- INV-04：所有可写 invocation 都必须经过相同的写锁规则。
- INV-05：unsupported 输入不能部分解析后继续执行。
- INV-06：子代理报告及仓库文件属于待验证内容，不是可改变策略的指令来源。
- INV-07：外部进程仍可修改工作区；进程内锁不等同于文件系统隔离。
- INV-08：扩展只恢复自己造成且仍可安全恢复的工具集合变化。

## 4. FR-01 内容级证据快照（最高优先级）

### 4.1 当前问题

**状态：核心问题仍存在，已有部分内容归因能力。** 当前 captureEvidence 已对 dirty 路径采集 hash-object 结果，并通过基线到当前 HEAD 的差异补充已提交路径。compareEvidence 将这些信息用于 A→C 的变更归因，而非验证快照与验收快照的内容相等判断。

HEAD、changed paths 与 porcelain 哈希仍不足以区分同一 dirty 文件的两份内容。即便当前记录含内容哈希，只要不比较验证时与验收时的哈希，重复采样也不能保证 PASS 边界可信。实现时应复用已有采样与归因机制，同时补齐验证绑定，不能把本问题简化为“增加一个文件哈希字段”。

### 4.2 目标设计

新增版本化 WorkspaceSnapshot。以下为逻辑字段，具体命名可由实现统一调整：

```ts
type EvidenceState = "fresh" | "stale" | "unknown";

type SnapshotEntry = {
  path: string;                 // 相对工作区规范路径
  kind: "file" | "symlink" | "missing";
  contentHash?: string;         // 普通文件原始字节 SHA-256
  linkTarget?: string;          // 符号链接本身的目标文本
  executable?: boolean;
};

type WorkspaceSnapshot = {
  version: 1;
  taskId: string;
  invocationId: string;
  workspaceId: string;
  scopeDigest: string;
  digest: string;
  capturedAt: string;
  entries: SnapshotEntry[];
};
```

要求：

1. digest 基于规范化、排序后的清单与内容哈希计算，不依赖 mtime、文件长度或 status 哈希替代内容。
2. 捕获修改、新增、删除和纳入范围的未跟踪文件。
3. 文件类型、符号链接目标及会影响执行的权限变化应纳入比较。
4. 明确区分任务允许写入范围与验证输入范围；依赖、配置、锁文件等可影响测试结果的输入应纳入后者。
5. 默认验证输入范围可保守覆盖仓库跟踪文件及非忽略未跟踪文件；显式收窄必须写入范围策略和 digest。
6. ignored 文件默认不全量扫描；若属于验证输入，必须显式声明。不能声称未覆盖输入具有新鲜度保证。
7. 超出文件数、字节数或采样时间预算必须返回 unknown 和原因，不得截断清单后仍返回 fresh。
8. 符号链接不默认向工作区外递归读取。外部输入要显式登记；不支持的输入返回 unknown。
9. Git 子模块等特殊输入必须明示支持策略，不得默默省略后认定完整。

### 4.3 验证与快照绑定

验证记录至少包含：taskId、invocationId、reportRevision、workspaceDigest、命令、cwd、开始/结束时间、退出码及日志引用。

- 报告 JSON 格式正确不代表执行记录可信。
- 执行事实应尽可能来自受信任的执行适配器或宿主事件，而非只接受模型自述。
- 如果当前上游不能提供可信命令结果，标记 provenance 为 self-reported，禁止把它描述为机器已独立验证。
- 验证前后采样并检测验证输入变化。测试生成物只能依据明确的排除规则排除，不能泛化忽略变化。

### 4.4 PASS 边界

1. 验证最新报告与任务、执行身份匹配。
2. 检查必要验证记录和来源策略。
3. 在持有任务验收互斥保护的情况下重新采样。
4. 比较被验证 digest、被审查 digest 与当前 digest。
5. 必要证据不完整为 unknown；内容不一致为 stale；全部一致才为 fresh。
6. 只有 fresh 且满足既有验收准则时才可自动 completed。

限制：普通工作区采样无法消除外部并发修改的全部竞态。应检测采样不稳定并有限重试；需要更强保证时采用不可变快照或隔离 worktree。不得宣称绝对原子验收。

## 5. FR-02 探测错误与未知证据（高优先级）

**状态：仍存在。** status 非零退出被空值化、可选证据字段缺失时跳过比较已在函数级复现；gitAvailable=false 已触发重新验证，需保留该机制。特殊路径、无提交仓库和采样不稳定场景尚未在本次逐项运行。

### 5.1 探测状态

每项探测保留命令类型、退出码、stdout、stderr、超时状态以及失败原因。空输出只有在对应命令成功时才是有效的空结果。

必须区分：

- 非 Git 目录：进入文件快照模式。
- 尚无提交的 Git 仓库：HEAD 缺失为已知状态，不伪装成普通提交。
- Git 命令失败或超时：unknown。
- 文件无法读取、采样不稳定：unknown。
- 旧版报告缺少必要字段：unknown，并请求重新生成证据。

### 5.2 路径解析

- 优先使用机器可解析的 NUL 分隔输出，避免按空格、换行解析路径。
- 覆盖空格、中文、制表符、换行、重命名、删除和冲突路径。
- 明确路径基准为仓库根目录还是任务 cwd，解析和比较使用同一基准。
- scope 的目录、精确路径和 glob 语义必须明确定义；若第一版只支持精确路径，应拒绝其他形式而不是猜测。

### 5.3 人工覆盖

如保留人工覆盖，必须记录原始 evidence state、操作者来源、原因、时间与目标快照。覆盖不应把 unknown 或 stale 改写为 fresh；完成记录应保留 overridden 标记。

## 6. FR-03 委派输入与身份边界（高优先级）

**状态：部分完成。** 普通复合执行入口拦截、reviewer 不重绑定原任务、异步回执识别已有实现；缺少报告版本/快照绑定及完整宿主契约验证。以下要求中已具备的行为作为回归约束保留。

### 6.1 本轮决策：仅支持单任务委派

保留当前对带非空 tasks 或 chain 的执行委派（包括与 task 混用）的明确拒绝，以及 workflowScript 等复合执行输入的拦截。拒绝发生在启动子代理、建立执行锁和写入执行中状态之前。带 action 的管理调用不属于当前这条拦截规则，需通过上游契约确认其不会成为未经检查的执行入口。

不能通过拼接多个提示词选取一个 TaskSpec 来代表整次批量调用。

后续若支持批量模式，必须先规范化为独立 invocation 数组，并逐项执行角色重写、身份校验、锁获取及结果关联。批量支持不属于本轮交付。

### 6.2 单任务要求

- 明确区分 worker、reviewer、explorer、validator invocation 和 Task 的原始定义。
- reviewer 不得重绑定原任务 spec。
- 同一个 taskId 可以有多次执行，但每次必须有独立 invocationId 和报告版本。
- 审查结果绑定 taskId、被审查 reportRevision 和 workspaceDigest，防止旧 reviewer 结果作用于新一轮工作。
- 未知 taskId 或不匹配身份应拒绝记录结果，不得猜测关联。
- 异步启动回执不是完成报告；若上游有后台模式，必须通过真实完成事件关联结果，不支持时拒绝该模式。

### 6.3 兼容模式

保留 warn/strict 配置以降低迁移成本：strict 拒绝不完整的可写委派；warn 可生成兼容 invocation，但必须显示未验证的契约状态，且不能跳过写锁。

## 7. FR-04 可写能力与生命周期（高优先级）

**状态：仍存在，优先补齐写入协调。** 当前锁依赖 Task 的 worker 角色及 executing 状态；无 spec、validator、同 taskId、不同 cwd 别名存在覆盖缺口。过期 executing holder 被排除属于明确源码行为；启动失败、取消、迟到结果和重载的实际进程语义仍需验证，不能把这些场景统称为已复现绕过。

### 7.1 写锁模型

锁依据实际可写能力而不是角色名称。拥有通用 bash 的 validator 视为可写，除非存在受验证的只读隔离。

- 规范化 workspace identity，至少处理相对路径、子目录与符号链接别名。
- 默认对同一工作树串行化可写 invocation；独立 worktree 的共享 Git 元数据操作另行约束。
- 未结构化 invocation 和同 taskId 的重复调用也必须参与冲突检测。
- 锁检查和获取必须原子化，不能在异步采样之间留下竞争窗口。
- 锁属于 invocation，而非仅由 task.state 推导。

### 7.2 失败路径

必须覆盖启动失败、用户取消、超时、子进程异常、报告解析失败、重复结果、迟到结果和插件开关。

- 子进程确认结束前，不因报告错误或请求取消而贸然释放执行锁。
- 完成回调、清理及释放须幂等。
- 超时不等于进程已退出；无法确认退出时进入显式阻塞/待核对状态。当前 findWriterConflict 会排除 isExecutingStale 的 holder，应移除这种未经进程对账的自动放行语义，并补充“旧任务过期但仍在运行”的回归场景。
- 报告修正若承诺不修改文件，需要实际限制或继续按可写任务协调，不能仅凭提示词免锁。

### 7.3 重载策略

本轮不要求自动恢复，但必须采取明确策略：有活跃 invocation 时拒绝不安全重载，或恢复后将状态置为 unknown 并完成对账前禁止新可写任务。不得因内存状态丢失而宣称原工作已完成。

## 8. FR-05 Reviewer 的受控差异证据（中高优先级）

**状态：仍存在，已有部分基础能力。** 当前已有 bounded packet、归因路径和包括 staged 的 diff HEAD --stat，但没有基于明确任务基线的 patch；packet 的 diff --check 未覆盖 staged 且未保留退出码/stderr。此处针对 reviewer packet，不应误写为 git_audit 工具完全不支持 staged 检查。证据不足构成审查盲区，不等于每次审查结论必然错误。

### 8.1 Review packet

包含任务验收条件、reportRevision、基线引用/快照、目标 digest、变更清单、验证摘要和证据完整性标记。

提供按文件读取 patch 的受控机制，可以由 Root 生成差异后注入 packet，不要求立即给子代理注册新扩展工具。

### 8.2 差异覆盖

- staged、unstaged、新增、删除、重命名以及已提交的任务改动。
- 基线不一定是当前 HEAD；应使用任务开始时的明确基线。
- 二进制变化保留内容指纹和类型，不伪造文本 diff。
- 对已有 dirty 工作区明确记录初始状态，避免把所有历史修改归因于当前任务。

### 8.3 输出边界

- 限制文件数、单文件字节数和总字节数。
- 截断时提供 omittedPaths、truncated、total/returned 等完整性信息。
- 必要证据遗漏时，reviewer 必须请求补充或返回无法完成审查，不得当作完整审查 PASS。
- diff check 保留退出码、stdout、stderr；覆盖 staged 与 unstaged，必要时分别执行。
- Git 只读调用禁用非必要外部 diff/textconv 等机制，并审查配置触发外部执行的风险；固定 argv 不应被表述为绝对无副作用。

## 9. FR-06 工具集合管理（中优先级）

**状态：默认过滤已修复，恢复和配置反馈部分完成。** 当前 filterPlannerTools 已只取激活集合与允许集合的交集；后续重点是恢复冲突策略，以及 on/off 消息与有效状态一致，而非重新实现过滤器。

### 9.1 默认规则

保留已实现的 activeTools ∩ allowedTools，不从全部已注册工具中自动激活全部安全项。

本扩展拥有的 git_audit 如需自动启用，应作为明确例外单独跟踪。

### 9.2 恢复规则

区分 suppressedByThisExtension 和 activatedByThisExtension：

- off/shutdown 时仅恢复本扩展移除且仍已注册的工具。
- 对本扩展新增激活的工具执行对称清理，同时尊重期间用户的显式更改。
- 不恢复其他扩展或用户期间明确关闭的工具。
- 若宿主缺乏工具变更来源信息，采用保守冲突策略并记录限制，不能声称完美恢复所有并发修改。

### 9.3 配置可观察性

status 输出有效状态及来源：环境变量、持久标记或会话设置。环境变量强制关闭时，执行 on 不得显示实际已启用的误导信息。

headless 模式必须有可读取的状态/错误结果，不能仅通过 UI 通知体现关键拒绝。

## 10. FR-07 工程质量门禁

**状态：部分完成。** 已有类型检查脚本、Node 下限、pi-subagents 范围、锁文件及 E2E 脚本；本次只确认存在，未运行这些检查。Pi 宿主兼容范围与发布环境的强制契约测试仍待补齐或确认。

### 10.1 类型与运行环境

- 保留并运行现有 TypeScript 无输出类型检查，核对宿主 API 类型；不重复新增同类脚本。
- 核验已声明的 Node 最低版本与 pi-subagents 兼容范围，补齐 Pi 宿主兼容范围（当前为 *）。
- 明确 TypeScript 直接执行和发布产物的运行条件。
- 保留已有锁文件，确认发布门禁使用锁定依赖和固定测试环境。

### 10.2 测试层次

1. 纯单元：digest、状态分类、路径规范化、身份校验。
2. 临时真实 Git 仓库：内容变化、暂存、提交、特殊路径、非 Git 和异常状态。
3. 宿主适配集成：启动、取消、异步完成、重载、工具集合变化。
4. pi-subagents 契约：真实参数形态、角色工具限制、fresh context、完成事件关联。

本地可以在未安装上游依赖时跳过契约测试，但发布 CI 必须安装受支持版本并实际运行；skip 不算通过。

## 11. 验收测试矩阵

下表保留目标行为，不表示本次已执行测试。当前分组状态如下：

- **仍有明确缺口：** E01/E02、E06/E07、D02—D06、D09、R01—R04、T03/T04；其中 E01/E02 的共同机制仅做了合成样本的函数级复现，真实 dirty/未跟踪文件场景仍需分别测试；R03 已有提交路径归因，但尚无所要求的审查 patch。
- **已有实现，保留回归：** D01、T01；上游入口与宿主工具集合行为仍需集成验证。
- **部分完成或待端到端验证：** D07/D08/D10、T02、C01。D07 中过期 holder 自动不再阻挡新 writer 的行为已由源码确认；D10 已有回执识别，不能标为完全未实现；C01 已确认 E2E 可 SKIP 退出 0，但实际发布门禁尚未核实。
- **目标设计 / 本次未逐项验证：** E03—E05、E08—E11。尤其非 Git 模式当前已有不可验证门禁，文件快照回退属于新增设计，不能将尚未实现回退等同于当前会错误放行。

| ID | 场景 | 预期结果 |
| --- | --- | --- |
| E01 | dirty 文件再次修改，status 不变 | 旧证据 stale |
| E02 | 未跟踪文件内容改变 | 旧证据 stale |
| E03 | 内容不变但 mtime 改变 | 内容快照不误判 stale |
| E04 | 范围内文件新增或删除 | digest 变化 |
| E05 | 符号链接目标改变 | digest 变化或明确 unsupported/unknown |
| E06 | Git status 返回非零或超时 | unknown，不伪装为空工作区 |
| E07 | 报告缺少必要 digest | unknown，请求重新验证 |
| E08 | 非 Git 工作目录 | 文件快照可用；不可用时 unknown |
| E09 | 采样中持续有文件变化 | 有限重试后 unknown |
| E10 | scope 外输入影响测试 | 必须纳入验证输入或显式披露未覆盖 |
| E11 | 特殊路径、重命名、冲突 | 正确解析或显式拒绝，不静默漏项 |
| D01 | tasks/chain 批量输入 | 启动前拒绝，未产生执行状态 |
| D02 | 两个同工作树可写调用并发 | 仅一个获得锁 |
| D03 | 同任务重复可写调用 | 仍执行 invocation 级冲突检测 |
| D04 | 无 TaskSpec 的 warn 委派 | 可警告兼容，但仍加锁 |
| D05 | validator 拥有 bash | 按可写能力协调 |
| D06 | cwd 的相对路径/符号链接别名 | 识别同一工作树冲突 |
| D07 | 启动失败、取消、超时，以及过期任务仍在运行 | 按进程真实状态安全清理；未确认退出时继续阻挡冲突写入 |
| D08 | 重复或迟到完成事件 | 幂等且不污染新一轮任务 |
| D09 | 旧 reviewer 对新报告返回 PASS | 拒绝版本/快照不匹配结果 |
| D10 | 异步启动回执 | 不被当成完成报告 |
| R01 | 仅 staged 变更含空白错误 | diff check 可发现并保留退出码 |
| R02 | 删除关键校验代码 | reviewer 能看到删除 patch |
| R03 | Worker 已提交任务变更 | 相对任务基线仍可审查 |
| R04 | patch 超过预算 | 明确标注遗漏，不假装完整 |
| T01 | 开启前用户禁用了安全工具 | 插件不会自动启用该工具 |
| T02 | on/off/on 往返 | 保持可解释的工具集合变化 |
| T03 | 期间另一扩展关闭工具 | 不被本扩展无条件恢复 |
| T04 | 环境变量强制 off 后执行 on | 明确反馈仍被环境变量关闭 |
| C01 | 发布环境缺少上游契约依赖 | 发布门禁失败，而非跳过成功 |

## 12. 实施顺序

### 阶段 0：确认基线

- 已记录本次源码复核 commit；实施前确认是否发生基线变化，并固定实际使用的上游版本和运行环境。
- 基于第 2 节复核结果继续核验任务、报告、审查与生命周期契约，尤其宿主事件行为；已具备项不重复实现。
- 运行现有测试并保存基线。
- 将函数级内容新鲜度、探测失败复现转为回归测试，并在真实 Git 仓库中分别复现 E01/E02。

### 阶段 1：证据正确性

交付内容级快照、三态证据、探测错误建模和 PASS 边界绑定。旧报告不能因缺新字段而默认通过。

退出条件：E01—E11 及相关既有测试通过。

### 阶段 2：委派与生命周期

保留并回归验证现有单任务输入限制、reviewer 独立分支和异步回执识别；重点交付 invocation/报告版本绑定、统一写锁、过期进程对账及失败路径清理。

退出条件：D01—D10 通过，上游真实契约测试执行成功。

### 阶段 3：审查与工具恢复

交付受控 patch、证据完整性标记、工具恢复冲突策略和准确的配置反馈；保留当前工具集合交集过滤与 status 来源显示。

退出条件：R01—R04、T01—T04 通过。

### 阶段 4：发布加固

运行现有类型检查与 E2E，补齐兼容范围和发布强制门禁，交付升级说明和文档同步；不将脚本存在或 SKIP 退出 0 当作验证通过。

退出条件：C01 满足，所有适用测试通过，已知限制明确列出。

## 13. 兼容与迁移

- 新证据格式必须版本化，不默默改变旧字段含义。
- 旧证据允许读取用于解释和迁移，但不足以自动 PASS。
- README 明示本版本仅支持单任务委派；不支持的旧模式给出可操作错误信息。
- warn 模式仍保留，但不再意味着跳过写锁或证据检查。
- 更强的写锁可能降低并行度，这是正确性取舍；后续可通过独立 worktree 恢复安全并行。
- 不在本轮承诺透明跨会话恢复，重载期间的活跃任务应显式对账。

## 14. 风险与待确认事项

1. 宿主是否提供可靠的启动、结束、取消、工具执行结果事件？决定 invocation 清理和验证 provenance 的实现方式。
2. 上游是否支持在工具调用拦截阶段可靠修改 payload？需真实契约测试，不仅依赖 mock。
3. 大仓库快照成本：先保证完整性；优化不得退化成仅比较 mtime/size。
4. 全工作树默认输入范围可能过宽；收窄需明确验证依赖和保证边界。
5. 符号链接、子模块、工作区外依赖的支持级别需要在实现前定稿。
6. 人工 override 是否允许完成 unknown/stale 任务？若允许，必须保持原证据状态并记录例外，不得冒充普通通过。
7. 安全 Git 调用仍受仓库与用户配置影响，需要审查具体外部执行面，不能只靠禁 shell 元字符宣称安全。
8. 本轮中的缺陷判定必须针对固定的新基线重验，避免重复修复已在后续提交解决的问题。

## 15. 完成定义（Definition of Done）

- [ ] 所有核心不变量已落实到实现或明确可测试的边界。
- [ ] 已固定并记录实施基线 commit、上游版本和运行环境。
- [ ] 已为实际发现的问题添加先失败后通过的回归测试。
- [ ] 全部适用验收矩阵通过，无未解释 skip。
- [ ] 发布环境类型检查、单元、集成及上游契约测试通过。
- [ ] 文档同步说明支持范围、证据来源与隔离限制。
- [ ] 旧报告迁移、失败/取消/重载行为有明确用户反馈。
- [ ] 未增加与本轮可靠性目标无关的框架功能。

## 16. 参考源码

以下链接固定到本次本地复核基线，不再引用可移动的 main。证据来自本地文件读取，未另行核验这些远端页面的可访问性。

- [evidence.ts：采样、比较与 reviewer packet](https://github.com/bioShaun/pi-planner-only/blob/76f022b0f022accdb79ad07c1bded91d524bda98/evidence.ts)
- [orchestrate.ts：委派与结果处理](https://github.com/bioShaun/pi-planner-only/blob/76f022b0f022accdb79ad07c1bded91d524bda98/orchestrate.ts)
- [task.ts：写锁与任务状态](https://github.com/bioShaun/pi-planner-only/blob/76f022b0f022accdb79ad07c1bded91d524bda98/task.ts)
- [review.ts：审查身份与验收决策](https://github.com/bioShaun/pi-planner-only/blob/76f022b0f022accdb79ad07c1bded91d524bda98/review.ts)
- [report.ts：报告校验与证据字段修正](https://github.com/bioShaun/pi-planner-only/blob/76f022b0f022accdb79ad07c1bded91d524bda98/report.ts)
- [roles.ts：角色工具能力](https://github.com/bioShaun/pi-planner-only/blob/76f022b0f022accdb79ad07c1bded91d524bda98/roles.ts)
- [git-audit.ts：Git 命令与 staged 支持](https://github.com/bioShaun/pi-planner-only/blob/76f022b0f022accdb79ad07c1bded91d524bda98/git-audit.ts)
- [index.ts：宿主入口、工具过滤与开关](https://github.com/bioShaun/pi-planner-only/blob/76f022b0f022accdb79ad07c1bded91d524bda98/index.ts)
- [package.json：脚本与兼容声明](https://github.com/bioShaun/pi-planner-only/blob/76f022b0f022accdb79ad07c1bded91d524bda98/package.json)
- [tsconfig.json：类型检查配置](https://github.com/bioShaun/pi-planner-only/blob/76f022b0f022accdb79ad07c1bded91d524bda98/tsconfig.json)
- [e2e.pi-subagents.test.mjs：契约测试与 SKIP 行为](https://github.com/bioShaun/pi-planner-only/blob/76f022b0f022accdb79ad07c1bded91d524bda98/e2e.pi-subagents.test.mjs)
