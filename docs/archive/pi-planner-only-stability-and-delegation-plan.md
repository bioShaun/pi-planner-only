# pi-planner-only 稳定性与委派演进计划

状态：路线图，2026-09-20 更新。P0 已在 `85bdd2a` 完成并提交；P1–P3 按用户授权继续实施。本文保留 2026-09-19 的调查依据与原始提案，下文“已确认的当前事实”是当时基线 `3991c5c` 的历史快照，不代表 P0 修复后的现状。

[P0 验收记录](../.scratch/request-stop-p0-20260919/evidence/acceptance.md)保留基线的 release、真实 CLI 与 strict delta review 证据及 launcher 124 限制。后续工作树已加入新 agent_start 的 abort 重申，SDK 队列场景额外调用为 0；本轮 release、Kimi Root / Luna child 真实路由 smoke 和真实 TUI 到期停止场景也已通过。独立只读父进程下的严格代码审查与后续验收核验均返回 PASS，但外层 launcher 三次均在 240 秒退出 124，完整自动门禁尚未闭环。当前结论见[后续验收记录](../.scratch/stability-next-20260920/acceptance.md)，launcher 问题单独记入[工单 06](../.scratch/stability-next-20260920/issues/06-strict-launcher-relay-timeout.md)。P1-B 和完整 P3 保持待办，不把已测场景外推到所有续跑模式，也不据单个 smoke 宣称节省。

## 目标与优先级

本插件的目标按以下顺序排序：

1. **稳定结束**：每个用户请求都必须能在有限的自动尝试后结束，并真实停止后续模型与 child 请求。
2. **降低成功结果的成本**：优先减少昂贵 Root 的输入、输出和推理负担，同时统计所有失败与重试，不能只看最终一次成功执行。
3. **增加能力**：只有在停止、归因和兼容性已有证据后，才引入模型路由、复用上游控制能力或更灵活的工作流。

这里的“降低 Root token”与“降低总费用”是两个指标。委派可把检索细节隔离在 child 中，只把摘要交回 Root；但如果 child 多次失败、使用相同昂贵模型，或者 Root 反复恢复，总费用仍可能上升。

## 已确认的当前事实

### 1. 当前缺口是“整个用户请求”没有停止边界

基线源码为 `3991c5c762584cbbc235576359734259f69931ce`。确定性集成 fixture 加载真实 `index.ts`，经过 `tool_call`、已注册工具的 `execute`、宿主事件 adapter、生命周期和磁盘 ledger；注入的是宿主事件总线、Git 返回值和 child 事件源，没有调用真实模型、网络或子进程。完整方法与证据见 [整个请求的无进展停止验证](../.scratch/request-loop-verification-20260919/REPORT.md)。

| 场景 | 可重复观察 |
|---|---|
| 同一不存在 Task 的完全相同 verdict 调用 12 次 | 前 3 次进入 execute 后拒绝，后 9 次由 hook 拦截；Root abort 为 0 |
| 仅逐次改变 `summary` 的同类调用 12 次 | 12 次全部进入 execute 后拒绝；Root abort 为 0 |
| 同一 Task 的 child 超限、取消、再恢复 | 12 次启动、12 次 CANCEL、停止均确认；`reports=0`、`reviewRound=0`、`recoveryHistory=11`、`recovery.required=true` |
| 恢复时只改变 `reason`，复用已消费的 `evidenceRefs` | 正确拒绝等价 recovery，没有启动第 13 个 child |

普通复现脚本当前 exit 0，说明它成功重现旧行为；带 `--assert-request-stop` 时 exit 1，并报 `REQUEST_STOP_MISSING`。修复后的测试必须断言实际 halt，且 halt 后没有模型或 child 请求。不能直接把现有普通脚本改成“应当全绿”，因为它首先断言的正是旧行为。

这份证据只证明插件入口存在有限复现的缺口，不证明所有真实模型都会无限循环。12 次是 fixture 的人为停止点。现有保护各自覆盖不同范围：重复拒绝器按工具名和完整参数 hash，`MAX_REVIEW_ROUNDS` 只覆盖审核纠正轮，envelope 取消单次 child。另有两条必须分开的恢复路径：

| 恢复路径 | 状态与保护 | 当前限制 |
|---|---|---|
| Review loop 驱动的证据重新验证 | `MAX_RECOVERY_ATTEMPTS = 3`（[types.ts](../types.ts)）；[review.ts](../review.ts) 比较 `recoveryAttempts`，并检查 `recoveryStates` 是否已有相同证据状态 | 该次数上限的唯一递增方法 `recordRecoveryAttempt`（[task.ts](../task.ts)）在当前生产 TypeScript 中没有调用方；不能仅因常量存在就宣称次数限制已生效 |
| Root 通过 `planner_redelegate.recovery` 发起的异常执行恢复 | `recoveryHistory` 保存已消费决定；[delegate.ts](../delegate.ts) 按 `action`、`worktreeDecision`、规范化的 `evidenceRefs` 去重 | 不使用上述 `recoveryAttempts` 次数上限，也没有独立的累计恢复次数上限 |

`executionId` 用于匹配当前待恢复的异常执行，不直接参与恢复去重。场景三每轮把最新执行引用写入 `evidenceRefs`，因而形成不同去重依据；仅改变 `executionId`、保持相同恢复依据，仍会被等价决定检查拒绝。这解释了 12 次执行可以产生 11 条已消费 recovery，而 `reviewRound` 始终为 0。

`recordRecoveryAttempt` 未接线是静态检查发现，尚未单独做 review revalidation 路径的动态复现；它不影响本次 runaway 路径的结论，但应列入 P0 的计数器接线清点。其直接后果是 `recoveryAttempts` 恒为 0，[review.ts](../review.ts) 中的 `attemptsLeft` 恒为真，review 驱动的自动恢复目前只剩 `recoveryStates` 按证据状态去重；换言之，两条恢复路径当前都是“只去重、无累计次数上限”，与场景三属于同一类缺口。上述保护都不是请求级停止边界。

### 2. 现有域模型和 ADR 是实现约束

- TaskSpec 是不可变的下行契约；纠正或恢复不能覆盖已存 TaskSpec。
- `planner_delegate` 只创建 Task，`planner_redelegate` 只按 canonical `taskId` 重入现有 Task，见 [ADR-0002](adr/0002-split-delegation-creation-from-rebinding.md)。
- 异常执行的放弃由专用 `planner_abort` 表达，不再塞进 verdict 或 recovery 联合字段，见 [ADR-0003](adr/0003-abort-is-its-own-tool-surface.md)。
- child 不声明 `workerRunId`；Root 在报告准入时盖印 launcher 已知的执行身份，见 [ADR-0004](adr/0004-run-identity-is-root-stamped.md)。
- Root/child 契约必须走 typed data，不从 prompt 或 transcript 猜测；当前也不能直接 import `pi-subagents` 发布包中的 raw TypeScript，应继续通过本项目版本化的事件契约 adapter 集成，见 [ADR-0001](adr/0001-typed-delegation-contract.md)。
- 请求级状态是未来的新概念，范围大于 Task。它不能偷换为 Task 的新字段含义，也不能以“修复循环”为由合并上述工具接口。

### 3. 历史真实宿主样本证明链路可用，也暴露成本风险

[Root-stamped identity 真实宿主报告](../.scratch/root-stamped-run-identity/evidence/REPORT.md)记录的是历史环境：插件 `0.8.0`、源码 `84cced4`、Pi host `0.85.1`、`pi-subagents 0.68.0`。一个 10 词读取任务前两次因 Root 自选 envelope 过低而取消，三次 child 分别使用 `8072 + 17027 + 17085 = 42184` 个 input/output token；另有总计 `15360` 个 cache-read token（后两次各 `7680`），上述数字均不含 Root。第三次完成，流程没有无限运行。

这组样本证明当时的真实 launcher、取消、恢复、报告准入和 Root 盖印身份链路能走通；它也说明“最终完成”不能替代总成本统计。该样本中的 child 实际仍用了与 Root 相同的模型。这不是路由接线失败：0.8.0 的 explorer 模型路由已在 `4fa55e3` 回退，配置中的 scout override 当时没有任何代码路径可以生效，属于功能缺席而非路由错误。

本机当前安装的 `pi-subagents` 是 `0.69.0`。本文没有运行新的真实宿主兼容性验收，因此不能把 `0.68.0` 的历史通过结论外推到 `0.69.0`。

## 外部框架的可迁移经验

### LangChain 与 LangGraph：停止要有调用级范围和明确结果

LangChain 的 `modelCallLimitMiddleware` 分开定义单次 invocation 的 `runLimit` 与跨 invocation 的 `threadLimit`，达到上限时可以 `end` 或抛错。其 tool call limit 的默认行为却是 `continue`：阻止超额 tool，但允许模型继续运行；只有特定配置能立即 `error`，而 `end` 还受单工具场景限制。这个差别与当前插件缺口高度相关：返回另一条拒绝文字不等于停止 Root 请求。[LangChain middleware 文档](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in#model-call-limit)

LangChain 的 retry middleware 也区分 transient failure 与不可重试错误，并用有限 `maxRetries`；重试耗尽后的 `continue` 与 `error` 是不同控制流。可借鉴的是“失败分类 + 有限重试 + 明确终止”，不是引入整套 middleware。[LangChain retry 文档](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in#tool-retry)

LangGraph 的 `recursionLimit` 限制单次 graph execution 的 super-step 数，超限抛 `GraphRecursionError`。官方仍建议设计显式 `END` 条件，并把 recursion limit 当安全网。super-step 不是 token、模型调用或 tool 调用，因此不能把一个图步数上限直接当成本上限。[LangGraph recursion limit](https://docs.langchain.com/oss/javascript/langgraph/graph-api#recursion-limit)

对本项目的含义：需要插件自己定义共享的请求生命周期，正常路径到达明确终态，异常路径有独立 failsafe。不能声称某个上游 run/tree 上限自动覆盖 Root 在同一用户请求内发起的所有新 Task。

### PydanticAI：共享 usage 与取消树，但预算有观测时差

PydanticAI 的委派示例把 `ctx.usage` 传给 delegate，使 child usage 计入 parent；`UsageLimits` 可限制 request、token、tool call 和 cost。共享 `CancellationToken` 能取消整棵 run tree，而 child 自己取消默认只作为失败的 tool return 返回给 parent，不会自动取消 parent。[PydanticAI multi-agent 文档](https://pydantic.dev/docs/ai/guides/multi-agent-applications/)

这提供两个可迁移原则：所有委派共享同一个请求级账本；请求停止信号必须传播到 Root 和正在运行的 child。它是 Python 概念参考，不是建议增加 Python 或 PydanticAI 依赖。

预算也不是精确的预付费闸门。PydanticAI 文档明确说明 token 数通常在响应后获得，因此累计 token 上限在每个响应后检查；取消 stream 的 usage 可能不完整且依赖 provider，某些 provider 甚至可能在本地停止读取后继续生成。成本估算缺少定价数据时也不是硬账单保证。[UsageLimits](https://pydantic.dev/docs/ai/api/pydantic-ai/usage/)、[取消与 usage](https://pydantic.dev/docs/ai/core-concepts/agent/#usage-tracking-for-cancelled-streams)

因此本插件应优先使用可在请求前精确计数的次数边界，并把 token/cost 作为补充保护和测量数据。不能承诺 provider 不支持时仍有不可超出的 token 或美元硬上限。

### Deep Agents：委派的价值是隔离细节，不是默认多一层流程

Deep Agents 把 subagent 的主要收益定义为 context quarantine：child 消化文件、搜索和工具细节，parent 只接收最终结果。官方同时明确不建议对简单单步任务使用 subagent，也建议返回短摘要而不是原始数据。[Deep Agents subagents](https://docs.langchain.com/oss/javascript/deepagents/subagents)

这与本插件的成本目标一致：用 WorkerReport、ReviewResult 和紧凑证据引用控制回传，而不是把 child transcript 注入 Root。是否委派应由任务复杂度、上下文污染和模型价差决定，不能自动把每个工作都扩成 worker → validator → reviewer 的强制链。

## Pi 插件的可迁移经验

### 小接口与隔离

`mjakl/pi-subagent` 提供一个统一委派入口，默认 fresh context，也允许命名 session；它有 inactivity watchdog、深度限制和按 agent 名称阻止递归环。命名 session 适合真正需要多轮上下文的专项工作，fresh context 适合一次性任务。[项目 README](https://github.com/mjakl/pi-subagent)

这些机制可帮助简化 Root 的参数和上下文，但 watchdog、depth/cycle guard 解决的是静默 child 与嵌套递归，不证明 Root 顺序发起新 Task 或 recovery 会终止。不能据 README 对本插件作成熟度或兼容性背书。

Pi 官方仓库的 subagent example 使用隔离 subprocess、只向 parent 展示最终 Markdown，并把 Ctrl+C 传播到 child。它证明 Pi 扩展接口可以实现隔离、摘要和取消传播；仓库明确将其称为 example，不能据此宣称生产可靠性。[Pi subagent example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent)

`LukasParke/pi-subagent` 的 README 描述了两项值得验证的细节：预算触发时先给 child 有界的 `graceTurns` 生成 partial result，再终止；transient failure 才做有限 `maxRetries`，并累计各次 usage，任务质量失败、取消和预算停止不自动重试。结构化结果无效时只修复一次，仍失败则保留 raw text 并标成 partial。[项目 README](https://github.com/LukasParke/pi-subagent)

这些是社区项目声明，本文没有独立运行其代码，不能照搬“production-grade”标签。可借鉴的是有界 partial reporting、一次格式修复、重试分类和跨尝试 usage 累计；它们不能替代本插件的 Task 证据、writer hold、typed contract 或请求级停止。

### 当前已安装 `pi-subagents 0.69.0` 的上限

本地一手文档与源码显示：

- `maxSubagentSpawnsPerSession` 统计成功、失败和完成的 child；默认 unlimited，compaction 不重置 session 计数。
- `maxSubagentSpawnsPerRun` 默认 64，覆盖一个 top-level run tree，claim 不退还；retained-child resume 复用原 claim。
- tool budget 可阻止指定 child tool，run tree budget 可阻止新的 child admission。

来源：[上游配置文档](https://github.com/nicobailon/pi-subagents/blob/main/docs/configuration.md#maxsubagentspawnspersession)、[session 启动预算实现](https://github.com/nicobailon/pi-subagents/blob/main/src/runs/shared/spawn-budget.ts)、[run tree 预算实现](https://github.com/nicobailon/pi-subagents/blob/main/src/runs/shared/run-fanout-budget.ts)。上述观察以本机安装目录 `~/.pi/agent/npm/node_modules/pi-subagents/` 的 `0.69.0` 文件为准，链接中的 `main` 会变化；实施前应固定实际版本。

这些能力适合作为 launcher 层第二道保护，但 session scope 可能跨多个用户请求，一个 run tree 也未必覆盖 Root 在同一请求中的多次独立委派。它们都不是当前缺失的请求级 Root abort。若未来复用，必须通过现有版本化事件 adapter 和兼容性测试接入，不能直接 import 上游 raw TypeScript，也不能让插件与 launcher 同时拥有同一个计数器或 timeout 的最终裁决权。

## Root 是否必须完全禁止处理任务

先澄清现状：Root 在 Task live 期间**今天就已经可以读取**。[policy.ts](../policy.ts) 的 live allowlist 包含 `read`、`grep`、`find`、`ls` 和固定的安全 Git 命令；只有 Idle-for-gather 阶段拒绝这些工具。因此本节提案实际改动的只是 Idle 阶段的读取规则，比“改变 Root 不读文件的原则”小得多。这也意味着下文警告的“为了解锁先创建一个空 Task”不是假想风险，而是当前唯一的解锁路径：建一个 Task 就进入 live，读取随即放开。

建议不把“Root 绝对不执行任何任务”作为唯一工作方式。目标是降低昂贵 Root 的上下文与推理成本；强制委派只是手段，若增加了拒绝、任务包装、恢复和验收轮次，就可能抵消节省。已有样本说明这种风险存在，但尚未证明放开读取一定更便宜。

建议的产品原则是：**Root 负责决策和整合，默认委派需要大量上下文或多步执行的工作；允许有界的直接读取，并由程序统一控制预算、并发和终止。**

以下是待验证的职责划分，不代表当前 Policy 已改变：

| 工作 | 建议的默认处理方式 | 目的与限制 |
|---|---|---|
| 理解需求、决定范围、回答用户、整合结论 | Root | 复用已有对话，避免不必要的交接 |
| 查询少量明确的信息，如版本、配置项、几行代码 | 允许 Root 在预算内直接读取 | 避免为很小的信息需求付出较大的委派成本；不扩展到通用 shell |
| 广泛搜索、阅读大量代码或日志、跨文件调查 | Explorer | 把检索过程和大量中间结果留在 child，只回传有界结论 |
| 实现功能、修改文件、运行测试 | 默认委派 Worker / Validator | 隔离执行上下文，核实实际 child 模型与预期一致 |
| 独立审查 | 按风险和项目要求选择 Reviewer | 保留必要独立性，不把额外审核变成每个简单任务的固定步骤 |
| 生成运行身份、累计额度、比较模型身份、校验参数、执行停止 | 程序 | 避免让 Root 或 child 维护可以确定性处理的流程信息 |

live 阶段的读取已有两层控制，提案应在其上延伸而不是另起一套：

- 单次 `read` 有 `ROOT_READ_CEILING_LINES = 200` 行上限（[index.ts](../index.ts)），未指定范围时自动加上，超出请求被 hook 拦截；`grep`、`find`、`ls` 没有单次上限。
- 读取返回的字节按 Task 记入 `reviewLeakBytes`（[usage.ts](../usage.ts)），目前只用于 Root 成本占比告警，没有累计上限。

直接读取的限制应覆盖单次返回内容大小、请求内累计读取量和连续探索次数，而不只限制 tool 调用次数或行数。一个调用也可能返回大量内容，并在后续模型轮次中反复占用输入。缺少准确 token 计数时可用字节数等可观测量约束输出，明确它不是精确 token 额度。大结果应在进入 Root 上下文前截断或转为引用。累计读取量以 `reviewLeakBytes` 的采集点为数据来源，由请求生命周期 module 独占裁决；不新建平行计数器，也不由 Task 记录各自持有一份额度。

读取预算必须是跨 live 与 Idle 两个阶段的同一份请求级额度。若只给 Idle 设预算，模型在 Idle 额度耗尽后创建一个 Task 进入 live，就能重新开始读取；这正是当前的解锁路径，提案不能保留它。读取达到边界后，应给出一次明确的 Explorer 交接路径，并继续受请求级预算与停止机制约束。拆成小片、改变搜索措辞、反复被拒绝或新建 Task 都不能重置累计读取量。正常读取不应为了“解锁”先创建一个无实际工作的 Task。

第一阶段只评估有界只读能力，继续把修改文件、通用 shell 和测试执行交给 child；极小修改是否允许 Root 直接完成，留作后续独立决策。若将来放开 Root 写入，Root 必须作为正式 writer 参加同一套独占控制，不能在 Worker 运行期间直接改文件。

可以保留严格 planner-only 模式，作为需要明确职责隔离的可选政策。是否把允许有界读取的方式设为默认，须由对照测量决定；模式选择应由用户配置控制，Root 不能自行切换政策来绕过预算或请求封锁。两种模式共用 P0 的停止机制，严格模式也不能靠拒绝文字代替终止。

这项提案会改变 [CONTEXT.md](../CONTEXT.md) 中 Policy 的 Idle 读取规则，但首阶段不改变 Root 不写文件、不运行通用 shell 的职责约束。实施时须显式更新域文档及相关设计决策，保留现有 typed contract、独立放弃入口、不可变 TaskSpec 和 Root-stamped identity。

## 建议的目标形态

新增一个请求生命周期 module，放在 Root 事件/controller 与现有 Orchestration 之间。其 interface 应保持很小：

```ts
type RequestControlEvent =
  | { kind: "tool_attempt"; tool: RootTool; control: StableControlFields }
  | { kind: "tool_result"; tool: RootTool; bytes: number; truncated: boolean }
  | { kind: "child_terminal"; taskId: string; outcome: ChildOutcome }
  | { kind: "progress"; taskId?: string; evidence: ProgressEvidence }
  | { kind: "host_boundary"; boundary: HostBoundary };

type RequestDecision =
  | { kind: "allow"; remaining: RequestAllowance }
  | { kind: "stop"; reason: RequestStopReason; cancelActiveChildren: true }
  | { kind: "admission_closed"; reason: string; rootStop: "unsupported" };
```

调用方只需提交语义稳定的事件并执行决定。参数归一、连续无进展判断、有限纠正额度、跨 Task/redelegate/recovery 的共享预算、持久化和停止原因都藏在 implementation 内。这样形成一个深 module：Root、工具 hook 和测试共用同一 interface，避免每个工具各自拼一套计数。

`tool_result` 是执行后事件，专为读取预算而设：返回字节数只有在工具跑完才知道，仅靠执行前的 `tool_attempt` 无法累计。它由现有 `reviewLeakBytes` 采集点触发，`RootTool` 在此处需扩展为包含 `read`、`grep`、`find`、`ls` 等只读工具。没有这个事件，读取预算就只能放在 module 之外，违反单 owner 原则。

`StableControlFields` 只包含决定控制流的字段，例如 tool、canonical task/execution、action、worktree decision 和失败类别；不应把 `summary`、`reason` 的措辞或字段顺序当作新进展。task/execution ID 用于关联记录，不作为请求级额度重置依据；局部去重与请求级连续无进展判断要分开。真正修复缺失/非法参数可消耗一份有限纠正额度；一旦参数已满足结构要求，换句解释不能重置计数。

请求范围必须由真实宿主事件定义并验证，而不是从 prompt 文本猜测。候选范围是“一次新用户输入开始，到 Root 最终响应或宿主确认 abort 为止”，并覆盖该范围内的 `planner_delegate`、`planner_redelegate`、新 Task、recovery、plugin hook scheduled message 和 autocontinue。下一次独立用户输入是否开启新范围，必须以宿主事件证据决定。

## 分阶段路线图

### P0：请求级封锁与停止，并行核对模型身份

候选改动集中在 `index.ts` 的 Root hook/controller、一个新的请求生命周期 module，以及对应的 focused test/fixture。请求级计数与封锁状态只有新 module 一个 owner；`delegate.ts` 保留现有单次 child 取消、停止确认以及基于 `recoveryHistory` 的局部去重检查，继续配合现有 writer hold 生命周期。局部去重是更严格的附加准入条件，不拥有请求级计数，也不能重置请求级额度。

实现要求：

- 所有 delegate、redelegate、recovery 和同请求内新 Task 共享不可由模型提高的请求级上限。
- 允许有限的、结构上确实修复了参数的纠正；按稳定字段聚合同类无进展，不受 summary/reason 改写影响。
- transient provider/transport retry 单独分类并有限；确定性契约错误和任务质量失败不自动无限重试。
- 触发停止时先阻止新模型/tool/child admission，再取消活动 child；只有确认停止后才释放 writer reservation。未确认停止继续保留 writer hold。
- 实测 Pi 的 `ctx.abort` 及相关宿主行为，覆盖 plugin hook、scheduled message、autocontinue 和下一次新用户输入。
- 即使宿主不支持 Root hard cancel，最低交付也必须是持久到该请求结束的准入封锁：关闭所有新 delegate、redelegate 和 child admission；更换参数、新建 Task、恢复、计划消息或自动续跑都不能重新开放。封锁同时检查模型工具入口和最终 child 启动入口，不能只匹配某一种调用参数。
- 只有可信宿主事件确认请求结束并进入新的独立请求，才允许重置封锁；无法判定边界时保持封锁，等待明确的用户恢复操作，不能靠模型自报完成或文本指令解锁。该恢复操作必须是 operator-only 入口（例如与 `/planner-only review` 同类的斜杠命令），不注册为 Root 可调用的工具，也不接受来自 tool call 或 child 报告的解锁请求；否则封锁就多了一个模型能触达的出口。
- 报告必须分别说明“新委派已封锁”“活动 child 是否已停止”“Root 是否已停止”。若缺少 hard cancel，明确披露 Root 仍可能继续消耗 token；这属于有实际防护的受限交付，不能称为完整请求停止。
- 清点所有上限的定义、读取、递增、重置和实际 dispatch 接线，特别是 `MAX_RECOVERY_ATTEMPTS`/`recordRecoveryAttempt`；为有疑点的路径补动态验证，避免保留只在文档或常量里存在的保护。

P0 的保底交付条件：

- 请求封锁触发后，无论是否有 `ctx.abort`，所有入口后续 child launch 均为 0；有限故障 fixture 证明换参数、跨 Task 和恢复都不能解锁。
- 活动 child 停止状态与 writer hold 被如实保留，Root hard cancel 缺失时有明确提示。
- 宿主边界或明确用户恢复能合法解除封锁；普通错误重试、hook 消息与自动续跑不能解除。

P0 的完整停止验收条件：

- 更新 fixture，使同参数、改 summary、跨 recovery/new Task 三类路径都在已批准的有限边界结束。
- 断言 halt 后没有后续模型请求、child launch 或自动续跑，而不仅是最后一次 tool 返回错误。
- 活动 writer 的 cancellation confirmation 与 writer hold 路径均有确定性证据。
- 真实 Pi 验收确认 Root 结束语义；在此之前不宣称 hard stop 可用。

P0 并行小项：模型路由身份核验。

- 不等待 transport acceptance，先读取已有 ledger/terminal/meta，关联有效配置、配置优先级与实际 child 模型身份。
- 输出“匹配／不匹配／身份未知”，缺少定价时不推断实际费用；历史 `0.8.0` 样本记为“无路由能力”而非“路由错误”，因为当时 explorer 路由已回退。核验结论若同样是“无路由能力”，后续是否恢复该功能属于单独决策并需独立验收，不在核验项内完成。
- 核验所需数据已存在：ledger 的 `usage.children[].model` 由 [delegate.ts](../delegate.ts) 从 child terminal 写入，`0.8.0` 验收报告正是据此判定实际模型；不需要新数据源。
- 区分核验与修复：本阶段可以先完成只读核验和问题定位；涉及新的路由参数、注册 agent 或 launcher 变更，仍须做相应兼容性验收。
- 验收以实际模型身份为准，不用配置意图或模型自述替代。可先复用现有记录，无需为核验本身额外发起付费运行。

### P1：减少普通路径的模型决策负担

在 P0 稳定后，减少模型需要填写的运行参数，普通路径由插件生成 canonical ID，并根据测量选择默认 envelope。重入时由程序读取不可变 TaskSpec，减少要求模型重复填写的字段；不能覆盖原契约，也不能为了简化接口而新增不必要的参数拒绝。失败结果按 contract、transient、budget、task-quality、environment、stop-unconfirmed 分类，让 Root 只选择可表达且有意义的下一步。

Worker 在预算停止前可得到一次有界的 partial-report 机会；结构化报告格式错误最多做一次有界 repair，仍失败则保留原始结果和明确状态，不能丢掉已付费工作。原始文本只能用于诊断和人工查看，不能解析为控制字段、冒充有效 WorkerReport 或据此 PASS；partial 报告仍须通过既有 typed contract。收尾时间和消耗计入请求级上限，不能借 grace 重置或延长全局界限。高风险写入仍保留 Evidence、Root-stamped identity、writer isolation 和独立复核能力。

按“Root 是否必须完全禁止处理任务”一节评估有界只读 gather。它与“把读取成本从昂贵 Root 移到 child”的核心目标存在张力，不能仅凭少启动一个 child 就判定更省。评估必须在同样任务与质量要求下比较“Root 自读”和“实际路由到廉价模型的 child 读取”，同时统计 Root token、双方总费用、完成率、失败重试及延迟。若只有启动延迟收益而 Root 成本上升，应明确展示取舍。这会改变当前 Idle policy，必须作为未来政策变更单独决策、更新 `CONTEXT.md`/ADR。默认是否审核同样是未来政策决定：不能在本文中把 Reviewer 从可选变成默认，也不能自动强制 worker-validator-reviewer 链。

P1 退出条件：代表性普通任务的 Root 工具参数减少，immutable-field refusal 和无意义 repair 次数下降；高风险路径的证据与写入隔离没有退化。若试行直接读取，必须证明单次与累计输出受限、切片不能绕过额度、转交 Explorer 不产生新的拒绝循环；修改和通用 shell 仍受原限制。具体默认值与阈值由测量后另行批准。

### P2：有选择地复用上游能力

先对 `pi-subagents 0.69.0` 做 transport-level acceptance：事件名、request/terminal 关联、CANCEL、partial result、usage、run/session spawn budget。模型身份的只读核验已在 P0 并行开展；本阶段只针对新增或改变的路由接线验证实际模型身份。验证通过后才决定哪些能力由 launcher 负责，哪些由本插件负责。

每一种 counter、timeout、cancel token 只能有一个最终 owner；另一层只观察或设置更严格的局部限制。继续维护本项目的版本化事件 contract，避免直接 import raw TypeScript。模型路由必须从实际 child terminal/usage 证据验证，不能根据配置文件推断已经生效。

P2 退出条件：固定版本 compatibility matrix 通过，owner 表没有重复裁决，降级/缺失能力会显式失败；Root 只接收紧凑报告和证据引用。

### P3：固定版本的真实宿主对照测量

在不付费做无依据的大规模实验的前提下，固定插件、Pi host、launcher、provider 和模型版本，对代表性任务与强制失败场景做重复运行。至少记录：

- 完成率、hang/人工中断率、端到端延迟；
- Root input/output/cache/reasoning token（provider 可得时）；
- 全部 child 与失败尝试的 input/output/cache/reasoning token；
- 总费用（定价可得时）、recovery/redelegate/review/format-repair 次数；
- 实际运行模型与配置意图是否一致。

对照至少包括直接 Root、当前委派、P0/P1 后委派。对读取政策另设固定小任务组，比较严格委派与允许有界 Root 读取两种模式；child 模型必须已核实为预期的廉价模型，避免拿失效路由作为支持 Root 自读的依据。完整 Root 执行基线放在隔离实验环境，不通过关闭实际用户工作区的保护来获得。

结果按中位数与尾部风险呈现，不预设节省比例，也不只挑最终成功样本。历史 `0.8.0 + pi-subagents 0.68.0` 数据只能作旧基线，不能与新版本混称同一实验。

## 验收矩阵

| 风险 | 必须观察的输入 | 通过条件 |
|---|---|---|
| 相同拒绝循环 | 同 tool、相同稳定字段，多次调用 | 有限纠正后 Root 请求 halt；无后续模型/tool 请求 |
| 文案绕过 | 仅修改 `summary`/`reason` | 仍归为同类无进展，不重置请求预算 |
| 跨 Task 绕过 | 同请求内连续 mint 新 Task | 共享请求额度，不能靠新 `taskId` 归零 |
| recovery runaway | 每轮使用最新 execution ref，但失败性质未变 | 有限恢复后停止；`reviewRound` 不是唯一保护 |
| 合法参数修复 | 从缺字段改为结构正确值 | 允许有限继续，并记录“结构进展”证据 |
| transient failure | 可识别的 provider/transport 暂态错误 | 只做有限 retry，usage 累计且最终状态明确 |
| child 正在写入时停止 | 请求上限触发且 writer 活跃 | 先 cancel，确认后释放；未确认则持久化 writer hold |
| 宿主不支持 hard cancel | `ctx.abort` 缺失或不生效，封锁后继续尝试各类委派 | 请求内后续 child launch 为 0；封锁持续到可信边界；明确 Root 未获停止保证 |
| 恢复计数器未接线 | 实际 review revalidation dispatch，而非直接调用计数方法 | 有效派发递增一次，拒绝及重复派发不误计；达到限制后不能继续派发 |
| scheduled/autocontinue | hook 安排后触发请求停止 | halt 后不会由计划消息重新启动自动循环 |
| 新用户输入 | 上一个请求已正常或异常结束 | 由宿主边界开启新请求；旧计数不误伤新输入 |
| 模型路由（P0 并行） | 配置廉价 child 模型，读取现有执行记录 | 配置与实际身份有匹配结论；不匹配或未知明确列出；改接线再补兼容性验收 |
| Idle gather 成本取舍 | 同任务的 Root 自读与廉价 child 读取 | 同时比较 Root token 和包含失败重试的总费用，不只比较 child 启动开销 |
| Root 读取范围扩大 | 单次大结果、连续小片读取、改变查询措辞、Idle 额度耗尽后新建 Task 进入 live | 断言累计返回字节而不只是调用次数；live 与 Idle 共用同一请求额度，新建 Task 不归零；达到边界后有界转交，不靠新参数归零 |
| 政策切换绕过 | 请求封锁后试图换严格／有界读取模式 | Root 无权自行切换；政策切换不重置同请求的预算与封锁 |
| partial report | child 达到预算但仍可响应 | 有界 grace 后接纳 partial 或明确终止，不无限延长 |

## 明确不做的事

- 不引入 LangChain、LangGraph、PydanticAI 或另一个 Pi subagent 插件作为新框架依赖。
- 不重写整个 Orchestration，也不合并 `planner_delegate`/`planner_redelegate`/`planner_abort`。
- 不从 prompt、summary 或 transcript 恢复控制字段。
- 不自动提高请求级全局界限；模型只能在允许范围内选择单次 child envelope。
- 不承诺宿主或 provider 没有提供的 hard cancel、精确 token 预付费上限或完整取消后 usage。
- 不因为“成本优化”删除 Evidence、Root-stamped identity、writer hold 或高风险路径的复核能力。
- 不把本文提案静默写进 canonical domain。实现决策落定后，再单独更新 `CONTEXT.md` 和相关 ADR。

## 资料日期与限制

资料核对日期为 2026-09-19。外部结论均来自官方文档或项目源仓库；社区 Pi 插件部分只总结其 README/源码声明，没有做独立兼容性、可靠性或安全审计。LangChain、LangGraph 与 PydanticAI 的机制用于设计类比，不代表 TypeScript/Pi 的直接可移植实现。

当前动态证据包括确定性插件集成 fixture 和一份历史真实宿主验收。尚缺的是 `pi-subagents 0.69.0` 上的自然语言真实宿主请求停止实验、Pi `ctx.abort` 对 scheduled/autocontinue 的完整行为，以及固定版本的成本对照。因此本文只给出路线和退出条件，不给出节省比例、默认阈值或“已解决”的结论。
