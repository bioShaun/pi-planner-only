# Planner-only 轮次可靠性、费用控制与节费效果验证

Status: ready-for-agent

本版整合两份材料：原「费用控制与节费效果验证」规格（见 git `bc7bb4e` 的本文件），以及 2026-09-07 Kimi 单票探测的分析（`.scratch/kimi-timing-probe/run-2026-09-07.md`、`analysis-2026-09-07.md`）。探测证明原规格的前提「流水线本身正确、只差限额」不成立，因此本版把「先让一张票稳定跑完」作为第一阶段，费用策略按阶段其后。

## Problem Statement

使用者希望让费用较高的模型承担 Root 的规划和审核，让费用较低的模型承担 Worker 的执行，从而降低完成任务的总费用，同时保持结果质量。v0.3.3（`9027d8f`）已建立角色能力隔离、WorkerReport 规范化、Evidence 新鲜度检查与 Usage 记录，但这些机制还不能确保实际模型分工、限制整项 Task 的累计支出，或证明节费效果。

2026-09-07 用 Kimi（Root `k3-256k`，子进程 `kimi-for-coding`，pi-subagents 0.65.1，headless print 模式）跑一张 +9 行的票，25 分钟未产生 `planner_verdict`，被人工杀掉。子进程费用约 $1.23，其中约 $0.98 是一个纠偏 Worker 死循环；Root 费用未知。逐项对照会话 JSONL 与源码，失败由以下问题叠加造成，按损失排序：

1. **前台同步 Validator 结果被误判为异步启动回执。** 三次 `async:false` 的 Oracle 都在父进程阻塞 30–49 秒后正常返回，details 有 `runId`、没有 `asyncId`。`orchestrate.ts` 的 `isAsyncLaunchReceipt()` 对非 WorkerReport 的散文输出走标记启发式；pi-subagents 0.65.1 的前台结果文本自带 `Run fan-out:` 首行（`runs/foreground/subagent-executor.ts`）和 `Mission: <id> (completed)` 尾行（`missions/lifecycle.ts`），两条标记命中即判为异步。插件随后回复「Async delegation has started」且**不带 runId**，Root 只能无 id 地 `bg_wait`，宿主报「No active async runs」。Root 因此连开四次 Oracle 并自行补核验，约 5 分钟与 $0.046 白费。任何返回散文的前台角色（Validator、Explorer）都会稳定触发。
2. **异步 Reviewer 的完成通知被当 WorkerReport 解析。** `handleAsyncNotify()` 只分流了 validator，reviewer 落到 `handleWorkerResult()`，报「is not a valid WorkerReport」。ReviewResult 未经身份与版本绑定检查，也未推进审核状态机；Root 只能从通知原文自行理解 `request_changes`。宿主 asyncByDefault 时 Root 只要省略 `async` 字段就必中。
3. **Root 嵌入的 TaskSpec 被静默丢弃。** Root 写了 `title` 没写 `objective`，`extractTaskSpec()` 不认，插件静默创建占位 Task「(unspecified — parent did not embed a TaskSpec)」并分配 canonical id。连锁后果：Worker 按 Root 自造的 id 回报被身份检查拒绝，多一轮报告修正并吃掉一个 review round；Reviewer packet 的 objective 与 acceptanceCriteria 为空；`packetSpec.budget` 不存在，任何 usageBudget 都没有下传；`validation.required` 未知。原规格所有预算与验证条款都挂在 TaskSpec 上，TaskSpec 静默失效等于整套机制被绕过。
4. **Worker 为跑测试执行 `npm install`，lockfile 漂移未纳入报告。** 新鲜度检查与 Reviewer 正确地判定 evidence stale 并 `request_changes`；问题在 Worker 合同没有禁止副作用，且纠偏由 Worker 自行决定 revert 还是 commit。
5. **纠偏 Worker 死循环 210 轮、同一条测试命令跑了 207 次，零护栏触发。** 插件没有给纠偏、报告修正、Validator 这类有界委派任何默认 `toolBudget` 或 `usageBudget`；pi-subagents 支持两者但插件一个没用。原规格明确不给未配置预算的 Task 设上限，因此即使实施原规格，这一笔也不会被拦住。
6. **Worker 与 Validator 的 thinking 落到 `:off`。** settings 的 `agentOverrides` 给 worker=high、oracle=medium、reviewer=high；实测 fork 上下文（默认）的六个孩子全部 `:off`，只有 fresh 的两个（一次 `context:fresh` 的 Oracle 得到 `:medium`，被插件强制 fresh 的 Reviewer 得到 `:high`）拿到 override。原规格的模型策略只谈「模型」，未把 thinking 纳入 requested/actual 对比，且 Worker 默认 fresh 未覆盖 Validator。
7. **Root 模型无费率。** `k3-256k` 不在使用者的 `pricing.json`，Usage 记录 `costUnknown`；Root 35 轮、93 万 cacheRead 的费用只在供应商账单上。当前没有任何位置提醒使用者 Root 模型无费率。
8. **Oracle 合同与 Root 任务正文冲突。** bounded 合同要求「read/grep 确认测试存在」，Root 正文要求「运行 named test suite」，四次 Oracle 都执行了测试文件。合同是前缀、任务是正文，模型服从正文。

原规格核查过的现状仍然成立：角色映射不按角色强制选模型；Reviewer 强制 fresh，Worker 沿用调用方上下文；TaskSpec 可选预算仅在调用方未提供 usageBudget 时下传；`lastWorkerValidationPassed()` 在没有报告或 validation 为空且状态不是 failed 时返回 true，让 Validator 落到 bounded 模式，只检查 Git 状态和测试文件存在；费用展示把子进程用量按 Root 费率换价称为 upper bound。Usage 已记录 Root 和子进程费用、未知费用及审核开销提示，不应把现状描述成完全没有费用观测。

## Solution

分五个阶段，前一阶段的验收是后一阶段的前提。

**阶段 A：一张票稳定跑完。** 修正回执分类、异步 Reviewer 分流、TaskSpec 静默失效三处编排错误；Worker 与 Validator 默认 fresh；有界委派带默认工具与用量地板；Worker 合同禁止依赖安装副作用；Root 模型无费率时启动即警告。验收是用同一张探测票（`.scratch/oracle-status-line/`）重跑一次得到 PASS，且不出现问题 1–5 中的任何一条。

**阶段 B：角色模型策略与诚实展示。** 让「贵模型规划与审核、便宜模型执行」成为显式、可检查的角色策略，requested/resolved/actual 三者都记录并包含 thinking level；换价结果改口为同 token 用量换价估算。

**阶段 C：验证可信性。** 验证强度由 TaskSpec 的要求和完整、可信的验证结果决定，不能因报告缺失而降低；没有报告或空结果不再落到 bounded 快速路径。

**阶段 D：Task 累计预算。** 把 Task 预算作为累计约束，计入 Root、Worker、Explorer、Validator、Reviewer 和所有重试，分配额度时扣除已发生费用和在途预留；展示哪些限制可在启动前执行、哪些只能事后观测；宿主无法阻断 Root 下一次模型调用时不宣称绝对硬上限。阶段 A 的默认地板与本阶段的累计余额取更严者。

**阶段 E：节费效果验证。** 保留默认由 Root 审核以及已有独立 Reviewer 路径；提供同类任务、同等质量要求下的费用对照方案，依据成功完成 Task 的总费用、通过率、返工次数和耗时判断效果。

本次发布规格，不实施产品代码，也不运行真实模型费用实验。

## User Stories

阶段 A：轮次可靠性

1. As an Root, I want `async:false` 的 Validator 或 Explorer 返回时直接得到其完成结果, so that 不会为同一次验证反复委派。
2. As an Root, I want 真正的异步回执带上 runId 和 `bg_wait id=<runId>` 指引, so that headless 会话能等到插件自己启动的 run。
3. As an Root, I want 异步 Reviewer 的完成通知按 ReviewResult 处理, so that 审核状态机推进、身份与版本绑定检查执行，而不是收到「不是合法 WorkerReport」。
4. As an Root, I want 嵌入的 TaskSpec 不合法时得到具体原因而不是占位 Task, so that Worker 不会因为我自造的 taskId 被拒绝，Reviewer 不会拿到空目标。
5. As an Root, I want 插件分配的 canonical taskId 在委派返回时明确告知, so that 后续所有委派与报告都用同一个 id。
6. As an Worker, I want 合同明确禁止 `npm install` 等依赖安装副作用并说明替代做法, so that 我不会因为跑测试而让 lockfile 漂移导致 evidence stale。
7. As an Root, I want 纠偏、报告修正与 Validator 委派自带默认工具调用与用量上限, so that 一次纠偏不会在已通过的测试上无限循环。
8. As an 使用者, I want Worker 和 Validator 默认 fresh 上下文, so that settings 里给它们配置的 thinking 实际生效，且不重复携带 Root 历史。
9. As an 使用者, I want Root 模型没有费率时在启动或状态里得到警告, so that 「Root $0」不会被误读为免费。
10. As an Validator, I want Oracle 合同与 Root 任务正文对是否运行 named test 的要求一致, so that 我不必在两条指令间自行取舍。

阶段 B：角色模型策略与诚实展示

11. As an 使用者, I want 显式指定 Root 的规划和审核模型, so that 高费用模型用于需要其判断力的工作。
12. As an 使用者, I want 显式指定 Reviewer 模型, so that 独立审核也符合高质量审核策略。
13. As an 使用者, I want 为 Worker 指定较低费用模型, so that 执行不会意外继承 Root 的高费用配置。
14. As an 使用者, I want 为 Explorer 和 Validator 分别指定较低费用模型, so that 搜索与机械验证也有清晰成本边界。
15. As an 使用者, I want 模型策略缺失或模型不可用时在启动前得到具体原因, so that 配置失败不会静默回退到高费用模型。
16. As an 使用者, I want 看到请求模型与宿主实际模型的区别，包括 thinking level, so that 我能核查模型路由与推理等级是否生效。
17. As an 使用者, I want 无法观测的实际模型明确显示未知, so that 配置值不会冒充执行事实。
18. As an Worker, I want 独立上下文仍包含 TaskSpec、仓库约束和必要文件线索, so that 节省上下文不会让我失去正确执行的条件。
19. As an Root, I want 显式复用同一 Task 的修正上下文, so that 有价值的执行经验不必每轮重新获取。
20. As an 使用者, I want 上下文复用受 Task 身份和范围限制, so that 不会把其他 Task 或 Root 的历史带入修正执行。
21. As an 使用者, I want 换价结果标为同 token 用量换价估算, so that 不把估算当作 Root 单独执行的严格上界。

阶段 C：验证可信性

22. As an Root, I want 没有 WorkerReport 时验证状态保持未知, so that 尚未获得结果不会触发验证已通过的快速路径。
23. As an Root, I want 空 validation 不被判定为通过, so that Worker 没有提供检查结果时仍会补齐必要验证。
24. As an Validator, I want TaskSpec 的 required、commands 和 expected 决定必需检查, so that 验证针对验收要求而不是机械重跑全部测试。
25. As an Reviewer, I want failed、not-run、缺项或相互矛盾的验证结果阻止必需验证通过, so that 成功状态文字不能掩盖实际失败。
26. As an 使用者, I want 不要求验证的 Task 显示无需验证及理由, so that 不运行检查不会被冒称为检查通过。
27. As an Root, I want 已完成且与当前 Evidence 匹配的必需验证允许有界复核, so that 在可靠性不下降时减少重复验证费用。

阶段 D：Task 累计预算

28. As an 使用者, I want 给 Task 设置累计 token 和费用预算, so that 控制的是完整完成过程的支出。
29. As an 使用者, I want Root 的规划与审核用量计入 Task, so that 不能只降低 Worker 费用而忽略主要成本。
30. As an 使用者, I want 所有子进程与返工都消耗同一 Task 剩余额度, so that 重试不会重新得到完整预算。
31. As an Root, I want 正在执行的调用占用预留额度, so that 多个允许并发的调用不能重复花费同一余额。
32. As an 使用者, I want 调用方已有 usageBudget、阶段 A 默认地板与 Task 剩余额度取最严格限制, so that 已有参数不能绕开累计预算，累计预算也不能放松单次地板。
33. As an 使用者, I want 未知用量与未知价格显式阻止声称预算充足, so that 缺失信息不会被按零费用处理。
34. As an 使用者, I want 异步结果和重复通知只结算一次, so that Usage 与剩余额度不会重复扣减。
35. As an 使用者, I want 启动失败、取消和延迟结算有明确预留处理, so that 活跃调用不会提前释放可用额度。
36. As an Root, I want 预算不足时拒绝新的付费 Delegation 并说明余额与原因, so that 不继续无界重试。
37. As an 使用者, I want 预算停止仍允许查看状态、记录非通过 Verdict 和处理已完成结果, so that Task 不会因额度不足而失去收尾能力。
38. As an 使用者, I want 重启和恢复 Task 后保留累计费用与待结算状态, so that 恢复执行不能重置预算。
39. As an 使用者, I want 看到 Root 调用能否被宿主预先限制, so that 我理解预算保证的真实范围。

阶段 E：节费效果验证

40. As an 使用者, I want 费用对照包含失败与返工的支出, so that 不能只挑成功的一次执行宣称节省。
41. As an 使用者, I want 在一致验收标准下比较成功完成成本、通过率、返工次数和耗时, so that 节省费用不会掩盖质量下降。
42. As an Root, I want 保留默认由 Root 审核和可选独立 Reviewer, so that 费用优化不会强制改变已选择的审核路径。
43. As an 使用者, I want Evidence 接受门槛和 WorkerReport 规范化保持有效, so that 节费功能不会绕过已有可靠性约束。

## Implementation Decisions

- 以下是本规格提出的产品决策，不声称已实现或逐项获得用户口头认可。用户已确认测试接缝采用公开生命周期与真实宿主契约，不新增测试专用接口。
- 在现有 Policy、Delegation、Orchestration、Task 和 Usage 职责边界内扩展。Root 继续只规划、委派、只读检查和审核；不为节费赋予其编辑或通用 shell 能力。保持每个 cwd 至多一个有写能力的活动 Delegation，不借预算预留引入新并发执行路径。

阶段 A：轮次可靠性

- 委派结果分类以宿主 details 为准，不再以结果文本猜测。details 带 `asyncId` 才是异步回执；details 带 `runId` 且带完成证据（结果条目的退出码或输出状态、mission 状态为已完成）即为已完成的前台结果，按角色分流处理。调用方显式 `async:false` 时禁止任何散文启发式。散文启发式若保留，只能使用具有唯一语义的标记（如「detached and running in the background」）；`Mission:` 与 `Run fan-out:` 在前台完成结果中同样出现，必须从标记列表移除。
- 异步回执文案必须包含 runId 与等待方式（`bg_wait id=<runId>`），并提示无 id 的 `bg_wait` 在启动后短时间内可能报空。
- 异步完成通知按 Delegation 记录的角色分流：reviewer 走 ReviewResult 处理路径并执行身份、报告版本与工作区摘要绑定检查；validator 走 Validator 路径；其余走 Worker 路径。同步与异步两条路径对同一角色的处理结果必须一致。
- 嵌入 TaskSpec 的解析失败必须显式。JSON 候选具有 `taskId`、`acceptanceCriteria`、`scope` 等 TaskSpec 特征字段但校验失败时，委派前返回具体原因（缺哪个字段、哪个字段类型错），不创建占位 Task；可以接受 `title` 作为 `objective` 的别名，但必须在结果中说明采用了别名。完全没有 TaskSpec 特征的委派才允许占位 Task，且占位事实要在委派结果首行告知。委派结果必须回显 canonical taskId，说明 Root 自造 id 只作别名保留。
- Worker 与 Validator 默认 `context: "fresh"`，传入有界执行包：TaskSpec、适用仓库规则及领域约束、必要文件线索、验收要求和可定位 Evidence；只传与执行相关的内容，不复制完整 Root 历史。上下文复用必须显式请求、绑定同一 Task 和允许复用的执行上下文；失效或无法验证身份时回到 fresh 并解释原因。Reviewer 既有 fresh 隔离保持不变。
- 报告修正、纠偏、Validator、Explorer 委派带默认地板：`toolBudget.hard` 与 `usageBudget`（token 与费用）的具体数值由实现者在配置中给出并允许覆盖，但不允许为空；调用方或 TaskSpec 已有更严限制时取更严者。实现 Worker 首轮不设默认工具上限，但必须有默认用量上限。地板生效与否要在委派结果中可见。
- Worker 合同增加：不得运行 `npm install`、`pnpm install` 等会修改 lockfile 的命令，除非 TaskSpec 明确要求；需要安装依赖时使用 lockfile 只读的安装方式，并把任何被迫修改的 lockfile 写进 changedFiles。Root 对 undeclared 文件的纠偏优先 revert，且纠偏委派要写明目标状态（干净树或指定提交），不让 Worker 自行选择。
- Oracle 合同与 Root 任务正文一致化：bounded 模式允许运行 WorkerReport 中点名的测试文件，禁止全量套件；合同措辞据此修改。若 Root 正文要求全量套件而模式是 bounded，委派前给出冲突警告。
- Root 模型在 pricing 表中没有费率时，扩展启动与 `/planner-only status` 都显示警告，Usage 记录继续标记未知。
- 阶段 A 验收：用 `.scratch/oracle-status-line/` 同一张票、同一 Root prompt 重跑，得到 PASS；Validator 至多一次；Reviewer 结果被记录为 ReviewResult；无占位 Task；无 lockfile 漂移；无任何委派超过默认地板。参考目标是规划约 40 秒、实现约 2 分钟、Validator 约 30–50 秒、Reviewer 约 70 秒、子进程约 $0.19；这是探测中已观测到的分段数字之和，不是承诺。

阶段 B：角色模型策略与诚实展示

- 引入可明确开启的角色模型策略，分别表达 Root、Reviewer、Worker、Explorer、Validator 的模型与 thinking level。Root 和 Reviewer 支持配置高能力模型，执行角色支持配置低费用模型；不硬编码供应商、模型名称、固定价格或价格排名。策略未启用的兼容模式必须明确显示没有模型成本保证；策略启用后，相关角色缺失配置、模型无法解析或调用参数冲突时，在启动前拒绝并给出具体原因，不能静默继承 Root 模型或自动升级。
- 请求模型、解析后的配置模型、宿主可观测的实际模型分别记录，thinking level 是其中一部分。对宿主控制的 Root 配置进行可用能力范围内的校验，不能伪称已切换 Root。实际模型不可观测时记录未知；实际模型或 thinking 违反策略时记录不匹配并停止后续受控启动，不能追溯性地声称已阻止发生的费用。工具能力继续由角色策略控制，模型选择不能扩大能力。
- 将现有 upper bound 文案替换为「同 token 用量换价估算」，说明假设为子进程用量保持不变、仅替换费率；不称其为实测 Root-only 成本或已实现节省。缺少必要用量或费率时显示不可估算。保留费用来源、未知部分和可审计的分项展示。

阶段 C：验证可信性

- 验证状态至少区分通过、失败、未运行、未知和无需验证。TaskSpec 的 validation.required 为真时，命令与预期结果必须被完整覆盖；缺少可执行或可判断的要求时返回需补充验证定义的原因，不能自行认定通过。没有报告、空列表、缺项、not-run、失败或状态与退出码矛盾，均不能满足必需验证。无需验证必须来自 TaskSpec 明确不要求验证，而不是来自空结果。
- 有界复核只接受完整且对应当前报告版本与 Evidence 的必需验证结果；否则由 Validator 执行 TaskSpec 要求的缺失或不可信检查。优先补齐相关检查，显式要求完整测试套件时遵循该要求。测试文件存在与 Git 状态检查不能替代必需测试的实际结果。Worker 自报通过不能替代已有接受边界的 Evidence 检查，也不能直接产生通过 Verdict。

阶段 D：Task 累计预算

- 保留既有 TaskSpec budget 的每次 Delegation 兼容语义，另增独立的 Task 累计预算，不能静默改变旧配置含义。累计 token 和费用两个维度独立限制，任一已配置维度不足即拒绝新的受控启动。未配置累计预算的 Task 保留可运行能力，但状态必须显示未设置累计上限，不能展示虚构余额；阶段 A 的单次默认地板在此情况下仍然有效。有效调用额度同时受原有单次限制、默认地板与新增累计余额约束。
- Usage 继续负责用量事实，Orchestration 在启动边界协调预算检查、预留和结算；不建立第二套互相独立的计费数据。每次执行按稳定调用或 run 身份记录，Root 按可证明的 Task 与阶段归属，子进程按实际角色归属。Task 创建前的 Root 规划和其他无法归属的用量保留会话级未归属项，不能任意归入最后 active Task。费用对照同时记录整段会话成本，避免未归属规划费用从总成本消失。
- 启动前原子检查并预留该调用可花额度。有效下传额度不得超过 Task 剩余额度，且不得放松调用方已有的更严格 usageBudget；重试和审核不能重置累计值。并发预留使用同一 Task 账本，允许并发的不同调用不能各自拿到全额余额。缺乏可执行的有限调用额度时，不宣称预留具备硬限制效果。
- 已完成调用以宿主 Usage 结算并释放未消费预留；重复 result、notify 或恢复事件必须幂等。确认从未启动才可释放全额预留。取消请求、超时或丢失通知不是停止证明，不能立即释放仍可能产生费用的预留。未知 Usage 保持待结算或未知负债；未知价格不等于零，已配置费用上限时不能仅凭可见小计继续放行。可用的 token 约束仍独立有效。
- 复用现有 Usage 持久化与重放机制恢复累计消耗和必要预留身份，不能因 reload 得到一份新预算，不另建通用恢复平台。无法恢复关键数据时明确拒绝声称余额可信。额度不足或不可确定时，给出 Task、已知消耗、预留、未知项与拒绝原因，停止新的付费 Delegation；仍处理已有结果并允许只读状态查询和合法非通过 Verdict，不为预算停止绕过现有生命周期规则。
- Root 费用纳入累计统计，但硬阻断取决于宿主是否提供下一次模型调用前的可执行控制。若只有调用后 Usage，明确标记该部分是事后累计与后续 Delegation 限制，披露在途调用和 Root 继续调用造成的超额；不能把软提示包装成整项 Task 绝对硬上限。预算约束不得通过新增 Root 编辑能力实现。

阶段 E：节费效果验证

- 保留默认 Root 审核；独立 Reviewer 仍接收有界 ReviewRequest，由 Root 接收 ReviewResult 并执行接受检查。减少重复读取和审核可通过现有 Usage、注入字节与审核读取指标观测，本规格不强制所有 Task 改用独立 Reviewer，也不自动把 Reviewer 降级为低费用模型。
- 建立可复现费用对照记录规范，覆盖同一初始仓库状态、Task 目标、验收要求、模型与配置、定价来源和时间、缓存条件、所有调用费用、完成状态、返工次数与耗时。高费用模型独立执行是独立隔离基线，不解除产品中 Root 的 Policy。保持验收标准一致，纳入失败运行及其成本，报告样本量和质量差异；不预设节省百分比。2026-09-07 探测不是合格样本（票不同、未跑完、被 kill、Root 费用未知），只作为阶段 A 的回归基线。
- 现有 Evidence 新鲜度、报告版本绑定、WorkspaceSnapshot 接受门槛、有界审核包完整性、WorkerReport 规范化及写锁规则全部保留。旧加固规格中的事项继续由其原有议题管理，本规格不重开或复制它们。

## Testing Decisions

- 用户已确认主接缝：复用 Pi 扩展注册的公开 hook、工具和命令，驱动 Task 创建、Delegation、返回结果或通知、Usage、审核与 Verdict 的完整生命周期；另用真实 pi-subagents 契约检查宿主行为。不新增测试专用接口，不以私有 map 或内部函数调用次数证明产品行为。
- 优先扩展现有扩展集成测试：其已覆盖公开事件、任务身份、同步与异步结果、Usage 命令、模型信息、未知费用和费用提示。纯函数测试只补难以通过该入口覆盖的预算算术、边界解析和状态冲突分支。
- 回执分类场景（阶段 A）：用 pi-subagents 0.65.1 真实前台结果文本（含 `Run fan-out:` 首行与 `Mission: … (completed)` 尾行，details 含 `runId` 无 `asyncId`）分别以 validator、explorer、worker 三种角色返回，断言走完成路径；用真实异步回执（details 含 `asyncId`）断言回执文案含 runId 与 `bg_wait id=` 指引。2026-09-07 的探测发现应固化为回归夹具，因为它只有真实宿主输出才能暴露。
- 异步分流场景：Reviewer 以异步方式返回 ReviewResult，断言 review round 推进、身份与版本绑定检查执行、通知文案不出现 WorkerReport 错误；同步路径结果与之一致。
- TaskSpec 场景：嵌入缺 `objective`、类型错误、使用 `title` 别名、完全无 TaskSpec 四种输入，断言前两种在委派前被拒绝并给出字段级原因，别名被采用并说明，无 TaskSpec 时占位事实出现在结果首行；Worker 回报 Root 自造 id 时被解析为别名并回显 canonical id。
- 地板场景：报告修正、纠偏、Validator 委派在调用方未提供任何预算时，观察宿主实际启动参数带有默认 `toolBudget` 与 `usageBudget`；调用方或 TaskSpec 有更严限制时取更严者；结果中可见地板是否生效。
- 上下文场景：Worker 与 Validator 默认 fresh，给 Root 历史加入与 Task 无关的标记，确认执行包包含必要仓库约束且不包含该标记；观察宿主 meta 中实际 thinking 与 settings 配置一致。同 Task 显式复用保留必要修正上下文，跨 Task、身份失效或误请求 Root 历史不能复用。Reviewer 隔离保持原有行为。
- Worker 合同与 Oracle 合同场景：断言合同文本包含依赖安装禁令与替代做法；bounded 模式下 Root 正文要求全量套件时出现冲突警告。
- 阶段 A 端到端验收：真实模型重跑 `.scratch/oracle-status-line/` 票一次，记录分段墙钟、每次委派的 turns 与费用、Validator 次数、是否 PASS；不达标不进入后续阶段。
- 模型场景（阶段 B）：为五种角色设置不同模型与 thinking，观察实际启动参数和状态；测试缺失配置、解析失败、调用方冲突、实际模型或 thinking 未知及不匹配，确认不会静默回退。兼容模式明确不提供模型成本保证，工具能力不随模型改变。
- 验证场景（阶段 C）：必需验证分别遇到无报告、空列表、缺命令、failed、not-run、矛盾退出码、过期 Evidence 和完整通过；观察 Validator 所要求的检查及最终接受结果。无需验证显示为无需验证；完整可信结果允许有界复核，文件存在不能让缺失的必需验证变成通过。
- 预算场景（阶段 D）：一项 Task 依次发生 Root 规划、Worker 执行、Validator 检查、Reviewer 审核、Root Verdict 和 Worker 修正，确认全部消耗同一额度；测试更严格已有 usageBudget、默认地板、token 与费用任一耗尽、未知费用、无预算兼容、在途预留、并发争用、失败启动、延迟通知、重复结果、取消未停止及恢复会话，观察是否发生新启动和状态中余额是否可信。
- 宿主限制场景：分别验证有预调用控制与仅有事后 Usage 的环境能力；后者必须如实显示限制范围与已发生超额，不能通过测试文字假装阻断 Root。预算停止后，状态查询、合法非通过 Verdict 和已有结果结算仍然可用。
- 展示场景：Usage 输出中估算假设明确，不再出现 upper bound 或将换价结果称为已测节省；未知值不变成零，失败尝试成本仍可见，分项合计与已知覆盖范围一致；Root 无费率时出现警告。
- 真实契约先例是独立的 pi-subagents 契约测试：真实导入已安装包的公开 child-tool-plan 入口并核查内置角色能力，且不发起模型调用。目前该测试不能证明实际模型解析、上下文传递、thinking 传递和 usageBudget/toolBudget 执行效果。实现时必须通过受支持的真实公开宿主入口扩展这些验证，可使用受控本地提供方或可确定的宿主事件；不得仅断言本插件已写入字段就声称宿主生效，也不得依赖未导出的内部接口。
- 缺少受支持宿主版本或公开能力时明确标记相应契约未验证。沿用发布门槛中契约跳过不等于通过的规则；无法证明的能力不得列为交付保证。涉及 Evidence 的回归继续使用既有临时真实 Git 仓库先例。
- 真实模型费用对照属于阶段 E 验收方案：在明确记录的样本与预算下运行隔离基线和模型分工方案，比较通过率、成功完成成本、总支出、返工与耗时。可用确定性数据验证汇总逻辑，但不能替代真实费用实验或据此承诺节省比例。本次规格写作不运行这些实验。

## Out of Scope

- 本次直接实施代码、生成独立实施 issues、提交或发布新版本。
- 修改 pi-subagents：fork 上下文丢失 thinking override、无 id `bg_wait` 在启动后短时报空、long-running guard 未对重复命令触发，都是宿主行为；本规格只要求插件在这些行为下仍然正确，不要求或等待宿主修复。
- 更改 Root 的只读 Policy、解除写锁、削弱 Evidence 接受规则、删除报告规范化，或重新处理已有加固议题。
- 自动为使用者选择供应商、固定模型、购买额度或根据未经测量的价格排名自动降级审核模型。
- 将默认审核路径改为强制独立 Reviewer，或增加多轮互相重复审核。
- 在宿主没有相应控制能力时声称拥有 Root 模型调用的绝对费用硬上限。
- 无限制反复基准测试、在本次规格发布中调用真实模型，或预先承诺具体节费百分比。
- 探测分支上的功能提交 `1b103f6`（status 打印 oracle suite）去留，随 `kimi-timing-probe` 分支处理。

## Further Notes

- 本规格基于 v0.3.3 源码核查、2026-09-07 探测的会话 JSONL 与子进程 artifacts、以及已有对话。探测数据与本规格的对应关系写在 `.scratch/kimi-timing-probe/analysis-2026-09-07.md`；其中 fork 上下文丢失 thinking 只做了 4/4 数据关联和 fresh 路径的源码确认，未逐行追到宿主丢失点；纠偏 Worker 开始时树已干净的原因未追。
- 原规格的核心问题得到确认，但「没有验证通过会自动通过最终审核」以及「当前没有任何费用统计」都不是本规格的结论。原规格未覆盖问题 1–5 与 8，部分覆盖 5、6；本版补入阶段 A，并在模型策略中纳入 thinking、在预算中纳入默认地板、在 TaskSpec 上要求显式失败。
- 阶段顺序是本版的明确要求，不再是建议：阶段 A 未通过同票重跑验收前，不进入 B–E。理由是原规格的所有预算与验证机制都以 TaskSpec 被正确解析、委派结果被正确分类为前提，而探测证明这两个前提在 v0.3.3 上不成立。
- 仓库使用根 CONTEXT 领域术语；本次未发现 ADR 目录，也未发现本规格目录适用的额外 AGENTS 规则。
- 关联现有规格：[可靠性加固](../planner-only-hardening/spec.md)、[调用锁与快照接受](../planner-only-hardening-gaps/spec.md)、探测票 [oracle-status-line](../oracle-status-line/spec.md)。本规格新增轮次可靠性与成本控制要求，保留这些规格的可靠性契约。
- 发布仅形成此独立规格，状态为 ready-for-agent；测试接缝已获用户确认，其余具体配置、默认地板数值与接口语法留给实现者在上述行为约束下确定。
