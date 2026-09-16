# Worker Runaway Controller 与 Correction Contract

Status: ready-for-agent
Type: spec
Date: 2026-09-16
Revision: 3 — 补停止确认谓词、迟到 terminal 保留、RecoveryDecision 入口；P0 收窄为 tokens + 墙钟、显式 envelope、retry_same_plan/abort
Depends on: typed-delegation 票 11 验收完成；当前不假定已完成

## Problem Statement

Worker 的单次执行可能在极小任务上消耗异常，Root 缺少可靠的中止、证据保全与恢复闭环。现有预算定义不等于新委派链的运行时约束；普通取消进入 blocked，也不能完整表达异常原因、实际停止情况和 Root 接下来的职责。

票 10 的修正样本报告了 61 turns、1,215,987 input tokens、6,115,007 cacheRead。它已经有明确的断言目标和验证命令；目前不能把高消耗归因为任务过宽、上下文继承或模型能力。需要原始执行轨迹取证。

修正执行虽然已经使用 fresh context，但缺少独立、受约束的修正输入契约，无法系统保证输入最小化、来源明确、本轮授权明确及原 Task 验收边界不被弱化。

当前首要 correctness gap 是取消宽限超时后 execution 尚未确认停止，外层清理仍可能释放 writer reservation；其次，非 completed 返回会提前退出，缺少完整残留 Evidence 与 execution 收尾。已有 re-delegation 保持 stored TaskSpec 不变，却向 Worker 发送本轮局部 spec，而 Reviewer 使用原始 spec，存在权威要求表达不对称。实施优先级必须先解决停止与收尾，再规范输入。

## Solution

同一阶段交付两个独立职责：

- **Worker Runaway Controller（WRC）**：观察权威信号、检测异常、请求取消、确认停止、采集残留 Evidence、要求 Root 作出 RecoveryDecision。它是 execution-level fault containment and recovery mechanism，不是根因分类器或单纯 token limiter。
- **Correction Contract**：Root 判断适合窄修正后，为原 Task 下的新 execution 提供最小、结构化、可验证的输入 overlay。它不替换原 TaskSpec，也不保证消除 runaway。

闭环为：Observe → Detect anomaly → Request stop → Confirm quiescence → Collect evidence → Root diagnosis → RecoveryDecision → New bounded execution。

## User Stories

1. 作为用户，我希望异常 Worker 不无限运行，以免一次错误执行策略不断放大损失。
2. 作为 Root，我希望获得异常的观测值、阈值和来源，以便诊断而非被强迫拆任务。
3. 作为 Root，我希望区分资源异常与环境、工具、协议、模型或 provider 问题，以便选择有效恢复动作。
4. 作为用户，我希望 CANCEL 发出后仍保护工作区，以免新旧 writer 并发修改。
5. 作为 Root，我希望知道停止是否真正确认，以免把返回结果误当作副作用结束。
6. 作为 Root，我希望看到中止前后的 Git Evidence，以便选择保留、修复或回滚已有改动。
7. 作为用户，我希望停止未确认时有明确状态，以便人工处理而不是静默释放锁。
8. 作为 Root，我希望记录结构化 RecoveryDecision，以便恢复执行具有可审计依据。
9. 作为 Root，我希望在瞬时故障后允许 retry_same_plan，以免被迫无意义改写 TaskSpec。
10. 作为用户，我希望没有新依据的重复重试被拒绝，以免通过新 execution 绕过控制。
11. 作为用户，我希望累计看到同一 Task 的所有尝试和用量，以免 fresh context 重置成本记录。
12. 作为 Root，我希望在有理由时调整 envelope，以便支持工作量确实较大的任务。
13. 作为 Root，我希望窄修正使用 Correction Contract，以便只交付本轮必要事实、finding 与验证要求。
14. 作为 Reviewer，我希望始终根据原始 Task 要求和修正 finding 判断，以免修正输入降低验收标准。
15. 作为 Worker，我希望知道本轮可修改范围与停止条件，以便形成小闭环并及时返回阻塞。
16. 作为用户，我希望报告修复与代码修复显式区分，以免 report-only 执行获得修改代码的授权。
17. 作为维护者，我希望旧账本可恢复，并保留已有 Task 身份、review rounds 和 attribution 语义。
18. 作为维护者，我希望能离线回放真实异常样本，以便验证检测时点而不反复付费运行。
19. 作为维护者，我希望缺失遥测不被当成零或健康，以免静默漏报。
20. 作为用户，我希望正常完成、取消与迟到事件竞态有确定结果，以免重复恢复或重复记账。

## Implementation Decisions

### 1. 架构与接口边界

- 延续 typed Root/child contract：Task、execution、Correction Contract、RecoveryDecision、异常和停止证据均以结构化数据传递；不从 Worker 文本、recent output 或 Root prose 提取控制字段。
- WRC 检测异常类型，不判定语义根因。根因诊断归 Root。
- 复用现有 Delegation launcher、Orchestration、Task store、Concurrency、Evidence 和 Usage 边界，不引入第二套任务系统或异步调度体系。
- WorkerRunawayMonitor 直接接入 typed Delegation 的 raw UPDATE hook；不把监控循环放到预算 floors、Task store 或 Orchestration 中。Monitor 只观察并提出取消，launcher 负责身份绑定的取消与终止交互，execution finalization 负责收尾，现有 store／Concurrency／Evidence／Usage 各自维护权威状态。
- 区分 TaskSpec（必须达成什么）、ExecutionContract（本轮被授权做什么）、ExecutionControls（本轮如何运行）与 RecoveryDecision（为何允许再次执行）。控制配置不混入 TaskSpec，也不由补充说明决定。
- 原 TaskSpec 保持不可变。初始、修正和恢复 execution 保持原 Task 归属；改变整体目标或扩大原授权必须经过独立的新 Task／既有替代流程，不能借 overlay 偷改。

### 2. 正交状态与一致性

- 以现有 TaskExecutionRecord 为核心补齐 execution 生命周期与结束原因。状态语义至少覆盖 running、cancel_requested、stopping、stop_unconfirmed、stopped、completed、failed；结束原因区分 normal、worker_runaway、operator_cancel、timeout、tool_budget、provider_failure、tool_error、launch_failure。记录 cancelRequestedAt、endedAt、terminationConfirmed 及停止确认依据；结束时间不能拿取消请求时间冒充。
- 保留 Task lifecycle 的 blocked，不新增 TaskState = needs_replan。异常恢复用结构化 task.recovery 表达 required、reason、executionId、nextAction；needs_replan 属于 recovery metadata，停止未确认时则明确要求等待确认／人工处理。
- 通过统一转换入口约束合法组合；未确认停止不能记作已完成收尾，已确定的终止结果不被迟到 UPDATE 覆盖。
- worker_runaway 是观测异常导致结束的原因，不证明 TaskSpec 错误。needs_replan 表达 Root 必须作恢复决策，不等于必须缩小任务。
- 不把 needs_replan 塞入普通 blocked 文案后就允许自动重跑。现有终态门控必须有显式、可验证的恢复路径。
- 转换表中的 blocked → executing 不等于 Delegation admission 已允许恢复。新增由有效 RecoveryDecision 授权的恢复分支，不全局放开 blocked 委派。保留 seal 对普通迟到报告的保护，同时允许停止协调逻辑接收并核对迟到停止证据；两者不能互相绕过。
- 异常执行不能因无 WorkerReport 被当成正常成功；残留 Evidence 不伪装为正常 C_report。

### 3. P0 停止与隔离契约

- anomaly detection → cancel request → stop confirmation → residual Evidence → needs_replan → RecoveryDecision → 新 execution 为不可拆开的交付闭环。
- CANCEL 使用既有身份绑定。一次执行只触发一次控制动作；重复、迟到或错误身份事件不产生额外取消、释放、恢复或记账。
- 发出 CANCEL、宽限期到期或收到普通 terminal 均不自动证明所有写入已停止。必须验证实际宿主的终止语义及工具副作用结束条件。
- 明确区分“身份匹配的可信 terminal”与“已确认静止”：cancelled、timed_out、failed 可能来自 forced settlement，不能只凭 status 置 terminationConfirmed。terminal 到达后先评估停止依据；不足时仍保持 stop_unconfirmed。无条件 finally release 必须改为受终止与证据条件约束的释放。
- **P0 停止确认谓词**（宿主 terminal 不携带 forced-settlement 标记，contract 中亦无 quiescence 信号，故 P0 采用以下最小可实现依据）：`terminationConfirmed = true` 当且仅当 (a) 收到身份匹配的 terminal，且 (b) 自 terminal 到达起等待不少于 `quiescenceWaitMs`（≥ 宿主最坏清理上界：forced-settlement 3–4 s + 会话关闭 5 s，默认 10 s，可配置并记录来源）后，(c) 连续两次工作树采样（含 status hash 与 dirtyPathHashes）相同，且两次采样均未 `statusProbeFailed`。任一条件不满足 → 保持 stop_unconfirmed；(c) 采样失败 → evidence-incomplete。此谓词证明的是“观察窗口内工作树未再变化”，不证明宿主内部所有副作用已终止；该限制写入 execution 记录（`confirmationBasis: "terminal+quiet-worktree"`），后续若宿主提供显式静止信号再替换。
- **宽限到期不退订。** 宽限期只决定何时把 execution 标为 stop_unconfirmed 并向 Root 返回；launcher 必须按 requestId 继续保留 RESPONSE 监听（或注册迟到 terminal 接收器），直到收到身份匹配 terminal 或 session 结束。迟到 terminal 用于解除 stop_unconfirmed、补记 usage 与 C_terminal；它不得越过 seal 自动接受旧报告，也不得触发第二次释放或记账。
- 停止未确认时，writer 隔离保持有效；Task 明确呈现停止未确认及需要处理的信息，不启动新 writer。恢复或重启后仍不得凭丢失的内存 reservation 判定可写。
- 确认静止后采集残留工作树状态，再释放 writer lock。采样失败须明确保留 evidence-incomplete，阻止自动恢复写入，直到补齐或显式人工处置。
- 所有已确认停止的执行，包括 completed、cancelled、timed_out、tool_budget_exhausted、failed，都应记录 A_run → C_terminal 的残留窗口及 executionChangedPaths／truthPaths 的适用归因。无报告也可完成 execution finalization；没有启动 child 的 launch failure 单独记录其可证明事实，不伪造 child 终止证据。
- execution finalization 与 successful report handling 分离：前者记录结束原因、终止依据、残留 Evidence 和用量完整性；后者才校验 WorkerReport 并进入 review。不得直接把含成功假设的 completeExecution 用于所有失败路径。C_terminal 不抹除 C_report 的报告／验收语义；尚未静止的采样只能标为 interim，不能当成最终残留窗口。
- 不保证 mutation-safe checkpoint，不自动回滚。Root 根据启动前基线与残留 Evidence 决定保留、修复或回滚；实际修改继续通过授权执行路径完成。
- 正常完成先被接受时，迟到异常不得翻转结果；取消先被接受时，后续成功报告不得自动推进验收，必须收集并进入恢复判断。回调顺序与持久记录应支持确定性裁决。
- **异常结果结构化返回，不走 throw。** 当前非 completed 路径抛 DelegationRefused，Root 只得到一段文本。WRC 触发的取消、stop_unconfirmed 与 evidence-incomplete 必须作为 `planner_delegate` 的结构化 details 返回（anomaly 类型、观测值、阈值与来源、executionId、终止状态与依据、残留 Evidence 引用、task.recovery），Root 才能据此诊断。文本摘要仅为展示。
- 若宿主无法提供足够停止确认，交付必须明确暴露该限制并保持隔离；不能宣称已实现安全自动恢复。

### 4. 观测与策略

- P0 使用当前支持的累计 UPDATE tokens 与独立墙钟计时。tokens 明确定义为宿主累计 input + output，不含 cacheRead/cacheWrite；UPDATE 是快照，不求和。
- 内部可消费 raw UPDATE 的 toolCount、durationMs、currentTool、currentToolArgs、recentTools 等实际支持字段；展示仍保留安全摘要，不为检测而向 Root 或账本复制完整工具参数。字段存在不等于独立事件流，须验证实际宿主版本的 shape 与含义。
- structured UPDATE 当前没有 turns；不得以 UPDATE 数、toolCount 或定时心跳替代。详细缓存与 turns 在可得的终态用量中分别保留。
- 缺失、不合法或回退的计数不重置已观测消耗；未知不等于零。取消缺失终态用量时保留已知下界与 incomplete 标记，不编造准确费用。
- P0 envelope 独立于旧 floors 定义，配置需校验、在 launch 前确定并记录来源。**P0 以显式配置交付：未配置时 WRC 不触发取消**（仍记录观测与累计用量）；不提供生产默认异常线，不冻结对话中的 60k/120k/40 turns 候选。默认线的校准依据归 P2，不作为 P0 交付门。
- 记录任务累计尝试、异常和用量；不能通过 fresh execution 绕过重复尝试控制。
- 工具活动不等于进展；edit、test 开始/结束不自动重置停滞。P0 不提供 progressScore 或 tokens/progress。
- 重复命令、重复读取、验证结果重复、patch oscillation 只有在权威结构化遥测支持时才引入；不得解析终端文本或 Worker 自述来伪造宿主事件。
- **P0 检测信号只有累计 tokens 与墙钟。** 当前 UPDATE 的 `recentTools` 仅含 `{tool, args}`，没有执行身份或序号，无法证明事件边界，因此 repetition detector 不属于 P0。P2 引入时必须依靠稳定工具执行身份或已验证的计数关系去重再生成 fingerprint；相同 currentTool／recentTools 跨 UPDATE 出现不能计作重复执行；同命令在输入改变后重跑不直接判为无进展。
- suspected warning 可通过现有进度展示呈现，但当前 Root 的同步委派回合尚未返回，不假定其可即时决策。当前没有已验证的 STEER/CHECKPOINT 通道，warning 不等于向 Worker 发出收束指令；P0 不实现 soft checkpoint steering。
- 不向当前 structured API 填入不支持的 usageBudget。显式超时与 launcher 控制必须分别说明实际生效语义。

### 5. RecoveryDecision

- 最小恢复决策、消费门控与新 bounded execution 属于 P0，不得后移到 P1 而留下“只能停止、无法受控恢复”的半闭环。P1 完善 typed overlay 与 execution controls 支持的恢复动作；未接线动作明确拒绝，不伪装执行成功。
- **入口**：不新增工具，Policy 工具集不变。再执行类动作通过 `planner_delegate` 新增的类型化 `recovery` 字段提交——恢复本质是对同一 Task 授权一次新的 bounded execution，属于 Delegation；`abort` 通过 `planner_verdict`（verdict `blocked`）携带同一 `recovery` 对象提交，Task 保持 blocked、`recovery.nextAction = "abort"`，交人工处理。两个工具接受同一 RecoveryDecision 结构；Delegation admission 在 `task.recovery.required` 时要求该字段有效，缺失即拒绝。
- RecoveryDecision 至少包含原 Task、异常 execution、动作、理由、证据引用、工作树处理决定和下一次执行参数或其引用。
- 动作全集：narrow_task、add_information、fix_environment、change_tool_strategy、repair_protocol、change_model、retry_same_plan、abort。**P0 接线**：retry_same_plan、abort、fix_environment（不改 spec 与 controls，仅记录 Root 已处理环境的理由）。其余动作依赖 P1 的 ExecutionContract（narrow_task、add_information、repair_protocol）或 ExecutionControls（change_model、change_tool_strategy），P1 前提交即明确拒绝并说明缺失能力。
- Root 诊断可区分 SPEC、ENVIRONMENT、MODEL、PROVIDER 及尚不明确的原因；不要求第一次一定归 SPEC 或第二次才能换模型。
- retry_same_plan 合法，但必须有瞬时故障或其他具体依据；对同一异常 execution 的恢复决策不能重复消费。重复失败且没有新的有效依据时拒绝自动重试，要求进一步诊断或人工介入。
- 原样措辞不同不构成新恢复依据。复用 no-progress 思路时，应比较结构化决策、相关证据与执行条件，而非仅比较 objective 字符串。
- envelope 扩大必须记录 Root 理由及进展／工作量证据；不自动倍增。模型调整必须确认下一次请求实际采用了该模型，否则明确拒绝，不能只修改展示字段。

### 6. TaskPacketV2、ExecutionContract 与 Correction Contract

- 同阶段 P1 交付，职责与 WRC 独立。Root 判断适合窄修正后才使用，不能把所有 REQUEST_CHANGES 强行当成小任务。
- 将已有本轮局部 spec 概念明确为 ExecutionContract，而非另造 CorrectionSpec 系统。TaskPacketV2 明确包含 version、原始 immutable taskSpec、typed execution、knownFacts、artifactRefs 和可选 instructions；Worker 与 Reviewer 的权威 TaskSpec 必须相同。
- ExecutionContract 用 discriminated union 区分 initial、correction、report_correction。修正分支结构化表达 review revision、findingIds、局部 objective、allowedPaths、validationCommands 与 evidence baseline；Root 必须验证来源引用属于本 Task 且适用于当前修正。
- instructions 只承载非权威补充说明；finding、范围授权、验证义务、恢复意图和模型选择不得只放在该文本中。矛盾说明不能覆盖 typed 字段，运行时授权与验收不能依赖 Worker 自行选择优先级。
- Contract 是原 Task 下某次 execution 的结构化 overlay，包含 execution class、目标、来源 review/finding 标识、当前 Evidence 基线引用、本轮允许修改范围、验证命令、停止条件，以及最小必要事实及其来源。
- 事实与引用可继承，前一 Worker 的推理上下文和累计对话不自动继承。所有 Worker 继续 fresh context。
- overlay 不替换、不放宽原 Task constraints、acceptanceCriteria、required validation 或 scope；路径授权不得超过原 Task。原 Task 的强制条件仍参与最终验收。
- 定向验证可作为本轮操作计划，但不能抹掉尚未满足的原始验证要求。Reviewer 接收原 TaskSpec、修正目标与完整相关 Evidence，不仅审 overlay。
- 明确区分 code correction 与 report-only correction；后者不得授予代码写入权限。Report 声明与 Root truth 的累计归因延续前置票的规则。
- 仍使用现有 WorkerReport 上行契约；Task accounting、review rounds、workspace attribution、Evidence chain 不重置。
- fresh context ≠ fresh Task ≠ fresh accounting。

### 7. ExecutionControls

- execution controls 独立于 TaskSpec 与工作目标，提供宿主已支持的 model、thinking、timeoutMs 及可选 toolBudget 的类型化接线与校验。模型升级不要求新宿主协议，但必须验证请求实际传递及采用情况，记录请求配置与可得的实际执行配置。
- launcher-side anomaly envelope 与宿主 timeout/toolBudget 分别记录来源及作用。toolBudget 不是 writer 的通用硬终止机制；使用前考虑 structured report 工具可能被封锁，不默认采用 block-all，也不把宿主默认值误称为插件配置。
- TaskPacket 版本升级须明确工具输入兼容和旧记录恢复策略，不再让局部 thisSpec 伪装为原 Task authority。持久记录保存足以复核本次授权与控制配置的信息，旧账本缺失字段保留未知含义。

### 8. 阶段边界

- **本阶段范围 = 正确与稳定运行所需**：P0-A、P0-B、宿主 soak、运行时事实文档更新。取证与 P1 移至下一阶段。
- 前置取证（下一阶段）：建立 N1-worker2-61turn forensic fixture，记录实际逐轮行为分类、输入来源、模型／宿主来源与遥测缺口；无法取得原始轨迹时明确标缺失，不编造阶段分布。调研已确认只核对了运行产物、child 全轨迹未取得——fixture 很可能只有终态 usage，此时它只能验证"终态越线"而非检测时点，不改变 P0 任何实现决策。
- P0-A：Execution termination correctness 优先，补 execution 状态与原因、§3 停止确认谓词、宽限后继续接收迟到 terminal、stop_unconfirmed writer 隔离、C_terminal、异常执行收尾、结构化异常返回、迟到事件和重启恢复。**单独立票、单独验收。**
- P0-B：Minimal WRC + minimal RecoveryDecision：raw UPDATE 的 tokens + 墙钟信号、显式 envelope 配置、内部 CANCEL、blocked + recovery、`planner_delegate.recovery` 入口、retry_same_plan／abort／fix_environment 接线与重试约束。依赖 P0-A 验收通过；不单独交付只有检测或取消的半闭环。
- P0 收口（本阶段关闭标准）：宿主 soak——N2 类故意跑飞 → 取消 → 确认 → blocked + recovery → retry 全链至少 1 次通过；P1／N1／3b 回归各 ≥ 3 次；全程无手动 kill、无锁泄漏、无重复记账，stop_unconfirmed 仅在预期场景出现。随 P0-A 提交更新 CONTEXT.md「child processes」与 ADR 0001 取消说明为 in-process 运行时事实。
- P1（下一阶段入口，不属于本阶段）：TaskPacketV2 + ExecutionContract + ExecutionControls，规范 correction/report correction，接线其余恢复动作；职责独立，不与 P0 捆绑验收。P0 中"未接线动作明确拒绝"是完整边界，P1 缺席不留缺口。
- P2：repetition/stall、patch oscillation、可靠 steering 与 soft checkpoint、默认 envelope 校准与回放基准；不作为 P0/P1 必须实现项。
- P3：按 execution class 校准、自适应阈值与模型策略；不得用尚未完成的校准支撑固定数值的可靠性声明。

## Testing Decisions

- **主要测试边界**：复用现有 typed Delegation／Orchestration 公开入口，以可控 launcher／事件总线、时钟和 Git runner 驱动完整可观察行为。优先沿用现有委派、取消、并发、Evidence、Usage 和账本恢复测试骨架，避免新增绕开生产路径的 Controller 专用测试体系。
- 测试断言观察请求、取消身份、返回结果、Task/execution 记录、writer admission、Git Evidence 与 Usage；不依赖私有调用顺序或内部类名。
- 覆盖健康完成、token/time 越线、重复与乱序 UPDATE、未知计数、无 UPDATE 的超时、取消重复请求、错误身份、终态迟到与完成竞态。
- 重点验收：宽限期过后工具仍写入、普通 terminal 未证明静止、Evidence 采样失败、重启恢复中的未确认 writer。这些情况下第二位 writer 均不能被自动放行。
- 分别覆盖身份匹配的 cancelled／timed_out forced-settlement 返回与真正静止确认；验证前者不会提前释放 reservation。用可控时钟与 Git runner 驱动 §3 谓词：terminal 后 quiescenceWaitMs 内工作树仍变化 → 保持 stop_unconfirmed；两次采样一致 → confirmed 且 `confirmationBasis` 记录；采样失败 → evidence-incomplete。
- 宽限到期后 terminal 才到达：验证 launcher 仍接收、execution 从 stop_unconfirmed 解除、usage 与 C_terminal 补记且只记一次；旧报告不越过 seal 被接受；不发生第二次释放。
- WRC 取消后 `planner_delegate` 返回结构化 anomaly details（类型、观测值、阈值来源、executionId、终止状态与依据、Evidence 引用、task.recovery），而非仅文本错误。
- 对每类已确认停止的非成功执行验证 C_terminal、残留归因、Usage 完整性与最终记录，不产生伪造 WorkerReport 或成功 review；停止未确认时仅允许明确标注的 interim Evidence。
- P0 验证未配置 envelope 时 WRC 只观测不取消；配置非法（非正数、无来源）时 launch 前拒绝。重复信号测试（慢工具跨多条快照、recentTools 滚动窗口重叠、同命令不同执行、输入改变后的合法重跑）归 P2。
- 验证停止确认后残留修改完整归因、用户已有修改不被自动回滚；缺失 Usage 保留 incomplete，快照不会重复累计。
- RecoveryDecision 经生产入口验证：`task.recovery.required` 时不带 `recovery` 的 `planner_delegate` 被拒；缺理由、错误 execution、已消费决策、无依据原样重试均拒绝；有依据的 retry_same_plan 产生新 bounded execution 并保持同一 Task 累计记录；abort 经 `planner_verdict` 记录且 Task 保持 blocked；P1 前提交 change_model／narrow_task 等被明确拒绝并说明缺失能力。P1 后再验证受控模型／策略调整。
- Correction Contract 验证无历史自动继承、不覆盖原 spec、不扩大权限、不删除原验证要求；窄修正成功后仍通过原有 review/acceptance 门。报告修复不可获得代码写入权限。
- 验证 TaskPacketV2 给 Worker 的 taskSpec 与 Reviewer 权威 spec 一致，execution overlay 独立；冲突 instructions 不影响授权，失效 review/finding 引用被拒；model/thinking/timeout 等 controls 经真实请求接线并记录实际采用情况。
- 旧账本缺少新增字段时有兼容解释；不把未知停止状态升级成安全已停止。已有正常 review、累计 changedFiles 与拒绝 verdict 的行为回归通过。
- forensic replay 只使用当时可见的信号验证报警时点，不使用未来信息。它不证明真实中止成功，也不证明换输入或模型后的反事实收益。
- 真实宿主验收确认实际加载版本、UPDATE 口径、取消后工具静止、残留 Evidence、锁行为及恢复执行。若契约缺失，验收应显示停止未确认并拒绝第二位 writer；不能以单测通过替代宿主事实。
- 运行仓库 typecheck 与完整测试；声明 P0/P1 完成前应提供上述关键场景的证据。默认策略校准理由归 P2。

## Out of Scope

- 完善或重新解释宿主 usageBudget.hard，保证精确计费 token ceiling。
- 自动根因判断、LLM progress judge、统一生产力分数。
- 自动预算倍增、无条件模型升级、无限任务拆分或重试。
- 自动回滚、把 CANCEL 包装为 mutation-safe checkpoint。
- 未经宿主支持的实时 turns、缓存统计、工具事件或 soft checkpoint 通道。
- P2/P3 的实现以及以小样本拟合自动生产阈值；P0 不提供默认异常线，不提供 repetition detector。
- 宣称"终止已确认"意味着宿主内部所有副作用已结束；P0 谓词只证明观察窗口内工作树静止。
- 替换原 Task 系统、重置 review/accounting、恢复自由文本协议解析。
- 预先宣称 Correction Contract 能把 61 turns 降至 5–10 turns。

## Further Notes

- 原则：Budget is a diagnostic boundary, not a productivity target.
- 原则：Root 做判断，Worker 做有界执行；WRC 隔离并限制错误执行策略的放大。
- 原则：A correction inherits facts, findings and evidence — never the previous Worker's reasoning context.
- Revision 2：第一优先级改为 execution termination correctness；WRC 位于 typed Delegation seam；needs_replan 使用 blocked Task 的 recovery metadata；Correction Contract 采用 TaskPacketV2 的 ExecutionContract overlay；最小 RecoveryDecision 保留在 P0。可信 terminal 与静止确认严格分开。
- Revision 3（对照源码复核后）：定义 P0 停止确认谓词（terminal + quiescenceWaitMs + 两次一致工作树采样）；宽限到期不退订，迟到 terminal 用于解除 stop_unconfirmed；异常结果作为 `planner_delegate` 结构化 details 返回；RecoveryDecision 入口为 `planner_delegate.recovery`／`planner_verdict`，Policy 工具集不变；P0 检测只用 tokens + 墙钟，repetition 归 P2；envelope 显式配置、无默认线；P0 恢复动作限 retry_same_plan／abort／fix_environment；P0-A 单独立票验收，P1 不与 P0 捆绑。复核依据：delegate.ts:595-597 无条件释放、:443-475 非 completed 直接 throw、:959-969 宽限到期 cleanup 退订；subagent-delegation-contract.ts:66-77 UPDATE 无执行身份、:107-118 terminal 无 forced-settlement 标记；policy.ts:26-33 工具集；ticket 08 已删除 planner_recover。
- 本文件是新阶段的权威 spec。入口票为 [typed-delegation 12](../typed-delegation/issues/12-worker-runaway-controller.md)，前置缺陷修复仍由 [票 11](../typed-delegation/issues/11-refusal-ledger-and-cumulative-declaration.md) 独立验收。
- 来源：[源码与样本调研](../worker-token-limit-research.md)、[票 10 交回](../typed-delegation/10-handback.md)、[61 轮用量](../typed-delegation/host-10/29c-n1-usage.txt)、[修正委派输入](../typed-delegation/host-10/22c-n1-worker2.json)。调研只核对了选定运行产物，尚未完成 child 全轨迹取证。
- 架构依据：[领域词汇](../../CONTEXT.md)、[typed delegation ADR](../../docs/adr/0001-typed-delegation-contract.md)。其中历史 child process／取消说明与当前安装宿主的 in-process 实现存在差异；实现阶段应更新相应领域文档与 ADR 的运行时事实，保留 typed contract 决策。
- 尚需实现阶段验证的契约：宿主最坏清理上界的实测值（决定 quiescenceWaitMs 下限）、未确认执行跨重启的隔离恢复、`tokens` 口径的安装版本一致性及精确 schema/API 形状。缺少支持时显式阻塞相关自动恢复能力，不能以推测填补。
