# 停止证据失败：只读交付、写入隔离与独立诊断

Status: delivered (pending re-review)
Date: 2026-09-17
Type: spec
Baseline: e30515866980caebca56df46f52493866b79b402

## Problem Statement

用户在 4090 服务器运行当前 planner-only 插件时，原 Excel 审核任务发生故障，随后委派的只读日志定位任务也返回 `stop_unconfirmed` 与 `stop-evidence sampling failed`。第二次故障阻断了原故障的取证，Root 又受 Idle for gather 的目录读取限制，用户只能自行在终端寻找会话日志。

已知事故标识：日志定位 Task 为 `T-20260917-005`，Run 为 `89d63895-da0a-40da-919d-8b869a6563ef`；用户提供的原故障关联标识为 `5552feec-3a3c-451b-bfbf-22f8521d6784`。用户已确认该 Pi 会话从非 Git 目录启动，与本地复现的触发条件一致。服务器账本中的实际 Task cwd、执行角色、插件加载指纹和原始 Git 错误尚未取得；若 Task 沿用会话 cwd，当前代码会走已复现的失败路径，仍需区分用户确认的环境事实与逐次执行证据。

本地使用生产 Delegation 入口、真实 Git 和模拟的身份匹配 completed terminal，已确认四个问题：

1. 在非 Git 目录，Explorer 也执行 writer 的 Git 静止检查。Git 不可用被映射为停止未确认，已返回的结构化 WorkerReport 不被接纳，Task 进入 blocked 并要求 RecoveryDecision。
2. 此时 Explorer 实际没有 writer reservation 或 Writer hold，但展示仍声称写入占用已保留。
3. 将该 Explorer 的账本恢复到新会话，会因为角色无关的 stop 状态判断而新建 Writer hold，实际阻挡同 cwd 的后续 writer。
4. 采样错误只剩布尔标志，原失败阶段、退出码与错误信息没有随停止结果提供，Root 无法直接区分非 Git 目录、Git 不可执行、状态探测失败与采样超时。

另有已确认的可用入口：Idle for gather 允许 `git_audit`，因此不是所有诊断都只能通过 Delegation。但它不能代替按 Task 查询停止证据和会话位置，故障自查仍需一个不依赖委派的完整读取路径。

## Solution

将“子执行是否已结束”“是否需要保留写入隔离”“报告是否收到”“证据是否足够验收”分别判断并展示。

受宿主工具面约束的只读 Explorer 在非 Git 目录也能返回调查报告；只读观察的验收不能伪装成 Git 变更验证。Worker 和能运行 shell 的 Validator 保留现有静止确认要求，未知能力的执行继续保守隔离。

按执行的可信能力决定 Writer hold 的创建与恢复。采样失败保留可解释的结构化原因。扩展现有 `planner_tasks`，使 Root 在 Idle、blocked 和恢复后都能按 canonical taskId 查询失败记录、采样原因及已知日志位置，无需先运行另一个子任务。

## User Stories

1. 作为用户，我希望只读日志定位能在非 Git 目录返回结果，以便诊断插件本身的故障。
2. 作为用户，我希望看到子任务已完成但证据不足的区别，以便不把验收失败误判为模型仍在运行。
3. 作为 Root，我希望接收到身份匹配的结构化调查报告，以便继续核对其中的事实。
4. 作为 Root，我希望缺少 Git 的只读调查能进入 reviewing，以便通过 Verdict 正常收口。
5. 作为用户，我希望只读报告的验收明确其观察范围，以便不会把它当成代码变更已验证。
6. 作为 Root，我希望畸形报告、身份错配和未满足的验收条件仍被拒绝，以便只读通道不会成为验收捷径。
7. 作为用户，我希望正常 Explorer 不生成 Writer hold，以便调查任务不阻塞后续工作。
8. 作为用户，我希望重启不为只读执行凭空新增写入占用，以便故障不会因为恢复被扩大。
9. 作为用户，我希望真实 writer 未确认停止时仍阻挡第二个 writer，以便不会发生并发修改。
10. 作为维护者，我希望 Validator 按其 shell 能力接受写入隔离，以便行为上的“不编辑”承诺不会被误当成运行时只读。
11. 作为维护者，我希望能力未知的历史记录保留保守处理，以便升级不会误释放旧 writer。
12. 作为操作者，我希望旧的可疑 Writer hold 有明确的人工恢复入口，以便无需直接删除账本。
13. 作为 Root，我希望看到失败的是哪次 Git 探测、哪个 cwd 和哪个采样阶段，以便选择具体的修复动作。
14. 作为 Root，我希望采样失败与工作区仍在变化分别展示，以便不会用延长等待处理一个永久不可用的 Git 环境。
15. 作为用户，我希望仅第一份停止样本失败时错误也不丢失，以便后一个正常样本不会掩盖故障。
16. 作为 Root，我希望无活跃 Task 时也能查询已有 Task 的诊断信息，以便排查不依赖故障中的 Delegation。
17. 作为 Root，我希望能查到超过正常恢复条数上限的目标账本，以便压缩、恢复和重启不会让故障不可见。
18. 作为用户，我希望日志路径附带来源和存在性状态，以便默认目录不会被说成已找到的故障文件。
19. 作为用户，我希望诊断输出限制体积并遮蔽敏感值，以便分享故障信息时不会泄露凭据或整段会话内容。
20. 作为维护者，我希望正常、取消、超时、迟到终态和重复事件都遵循相同的能力分类，以便修复不会只覆盖 happy path。
21. 作为 Root，我希望停止不确定时已收到的报告仍作为未验收材料保存，以便不用重新执行昂贵任务才能取证。
22. 作为用户，我希望收到取消的 Explorer 不会被自动判作成功，以便取消意图被保留。
23. 作为维护者，我希望真实宿主验证只读工具约束，以便单元测试中的角色名称不会被当作隔离证据。
24. 作为维护者，我希望测试区分“原报错消失”和“整个 Task 成功完成”，以便不会把仅初始化 Git 的对照实验当成完整解决方案。

## Implementation Decisions

### 1. 执行能力是停止与隔离判断的共同输入

- Delegation 在启动前从插件控制的实际 agent 绑定确定执行能力，并在 TaskExecutionRecord 持久化可写、受限只读或未知的分类与依据。分类不是 WorkerReport 字段，不接受模型在 instructions、TaskSpec 或报告中自报只读来降低隔离。
- 当前 Worker 与 Validator 都属于需要 writer 隔离的执行。Validator 具有 shell，现有 `readOnly` 归因标志不足以将其归类为受限只读。Explorer 仅在绑定的 scout 工具面确实排除 shell、edit、write 及其他变更入口时按受限只读处理。
- 复用现有受限角色绑定；不假定上游协议已提供新的 capability 遥测。实现必须通过实际支持的宿主配置和工具可用性验证绑定。若当前支持版本无法证明绑定约束，应在启动前返回可操作的能力错误，不能静默放行。
- 启动、正常终态、取消、迟到终态、并发 admission、账本恢复和诊断展示使用同一分类规则。Task 的初始 role 不代替本次 execution 的能力。

### 2. 停止确认与报告验收分开

- 受限只读执行收到身份匹配终态即可结束该执行的停止协调；确认依据明确表示“匹配终态 + 受限只读绑定”，不写成 `terminal+quiet-worktree`，也不声称证明外部世界静止。Git 缺失、Git 探测失败或其他 writer 的工作区变化不单独生成其 `stop_unconfirmed`、Writer hold 或停止恢复要求。
- 未收到匹配终态的执行仍不能宣称已停止。受限只读执行可以保持停止未知和适用的 RecoveryDecision 要求，但不得因此生成 writer reservation 或 Writer hold。能力未知执行按 writer 保守处理。
- Worker、Validator 保持匹配终态、等待和连续两份有效静止样本的要求。终态为 completed 不绕过该要求；取消、runaway、迟到终态、Usage 恰一次记账及第二 writer 拒绝语义保持有效。
- writer 启动前若已有样本明确无法支持必要停止证据，先返回结构化环境阻塞，不继续花费子执行成本。没有启动的执行不得伪称已启动未停止，不新增 Writer hold；已有 hold 不因本次未启动被解除。启动后才发生的采样故障仍保持隔离。
- 已收到但未获准进入 review 的 launcher 校验报告保存为“未验收的终态报告”，绑定 taskId、executionId 和 runId，供诊断读取；它不进入已接纳报告序列，不触发自动 PASS 或重放接纳。与取消后 `lateReport` 的用途保持一致，避免同一份报告重复记账。

### 3. 只读信息交付需要完整收口路径

- 本轮支持独立 Explorer Task 的信息交付，不仅跳过停止检查。合规 completed WorkerReport 必须可返回给 Root、入账并进入 reviewing，最终可通过显式 `planner_verdict` 完成 Task。
- TaskSpec 新增结构化 `acceptanceMode`，取值为 `worktree` 或 `observation`。Root 只在 `planner_delegate` 创建 Task 时选择；省略时默认 `worktree`，新记录始终持久化解析后的值。既有账本缺字段也解释为 `worktree`，不自动迁移为观察类。`observation` 明确授权只读信息交付，不能表示代码变更已验证。禁止从 objective、constraints、acceptanceCriteria 或报告文本推断或改写该模式。
- 创建时只有 role=explorer 允许 `acceptanceMode: observation`，其他角色组合在派发前拒绝。观察模式同时要求本次执行具有可信受限只读能力；仅模式或仅角色都不足以放行。`worktree` 模式继续执行原 Evidence 验收；对于合格 observation Task，缺少 Git 不得在下游 EvidenceComparison、Review loop 或最终 Verdict 中再次自动变为永久 revalidate 循环。
- 模式属于不可变 TaskSpec：`planner_redelegate` 不提供修改该字段的入口，对透传的改写请求在派发前明确拒绝，不能静默切换。observation Task 只允许后续 Explorer 执行及 Root Verdict，不允许绑定 Worker、Validator 或 Reviewer；发现既有 execution 含 writer/未知能力、变更归因或已接纳的修改声明时拒绝观察类验收。旧 Task 如需从 worktree 改为信息调查，应显式创建新的 observation Task，原 Task 的恢复和 hold 单独处理。
- 该字段由 launcher 向下传递并由账本提供权威值，WorkerReport 不能选择或覆盖。工具描述与 Idle 修复指引在生成只读日志调查的新 Task 时显式选择 observation；验证代码变更的任务选择 worktree。是否能验收代码变更由此结构化契约决定，不解析任务文本作为控制条件。
- 观察类适用条件：执行具有可信受限只读绑定；报告身份和 schema 合法；没有声称由本次执行产生文件修改；交付是独立调查信息而非对已有 Worker 变更的验证；Task 的必需 validation 和 acceptanceCriteria 已有实际满足证据。不得因为 role 是 Explorer 就忽略用户明确要求的 Git、文件版本或一致性检查。
- 在条件满足时，观察类验收可将“不适用的 Git 变更验证”排除出完成条件，但必须保留 Git 不可用或失败的事实。显式 Verdict 绑定 canonical taskId、本次 execution 与当前报告 revision；报告变更后旧 Verdict 不得复用。不制造假的 Git digest、HEAD、工作树 fresh 状态或代码验证结论。
- 工作区同时变化可作为外部观察记录；如果 Task 要求固定版本或某个文件的当前状态，仍需核对对应输入的新鲜度。普通日志位置查询不要求整个工作区静止。
- Worker 的 Git Evidence、报告 revision、快照新鲜度、Fresh Reviewer 与提交门禁维持现有契约。Reviewer 对已有 Worker 的评审、Validator 的变更验证和 `git_commit` 不得借用观察类验收绕过这些要求。
- 失败、取消、超时、runaway 终态继续按其实际结果收口，不能只因是受限只读就变成成功。畸形报告、错配身份和未满足必需验收条件照常阻塞。

### 4. Writer hold 恢复与历史兼容

- 新记录已证实为受限只读时，所有恢复入口均不得仅因 stop 状态合成 Writer hold，包括正常恢复、超恢复条数上限的记录发现和按 Task 惰性读取。
- 已持久化的真实 writer hold，以及尚无可信能力依据的历史未确认执行，继续隔离。禁止根据 `readOnly: true`、Task 当前 role、模型陈述或一条错误展示文本自动清除。
- 升级前已经被误合成的 hold 不批量删除。诊断提供记录来源、执行身份和能力依据；操作者确认残留执行已处理后，通过现有 `planner_abort` 或适用的 `planner_redelegate.recovery`，以匹配的 executionId 和 `worktreeDecision: manual` 解除。说明 runId 与 executionId 的区别。
- 若历史记录缺少当前恢复动作所需元数据，必须展示准确的“不满足恢复前提”与人工处理指引；不能建议一个必然被守卫拒绝的动作，也不伪造恢复历史。
- 正常停止已确认的记录不因恢复而重新持有占用；多条 execution 混合的 Task 必须检查真正待隔离的执行，不能让一条 reader 记录掩盖另一条 writer。

### 5. 采样失败的结构化证据

- Evidence 采集返回有界的失败明细：采样阶段（A_run、C_report、停止第一/第二样本或接受时采样）、固定 Git 操作、cwd、时间、退出码、超时或启动失败事实、经遮蔽和截断的错误摘要。无法确定的字段保持未知。
- 区分非 Git 目录、Git 无法启动、状态探测失败、超时和未分类探测错误。分类必须有执行结果支持；无法可靠区分时使用未分类错误，不从单一 code 128 猜测具体原因。
- Git 非仓库与探测异常不能都折叠成没有原因的 `gitAvailable: false`。探测中捕获的异常保留原因，不覆盖宿主原始终态及 endedReason。
- 停止第一份和第二份样本的错误都保留；只第一份失败、第二份成功时仍可从结果和账本查询到第一份错误。声明的额外 worktree 的错误要标明对应 cwd。
- 工作区不一致与采样不完整分别展示。写入能力执行的采样不能把已知不完整的根目录、哈希缺口或不可读路径判成完整静止证据；不得通过减少失败信息换取“通过”。本轮不重写采样后端。
- 保留现有状态和布尔字段的兼容读取，新明细为可选增量字段。旧账本没有错误明细时显示未记录，不伪造历史 Git 命令输出。
- 屏幕和工具文本从同一结构化事实渲染。只有账本或并发控制确有 Writer hold 时才显示保留占用；受限只读执行显示无写入占用，不泛称所有 stop_unconfirmed 都保留 hold。

### 6. 无需委派的诊断查询

- 扩展已有 `planner_tasks`：不带 taskId 时保持现有 live Task 列表语义；带 canonical taskId 时返回当前 workspace 内该 Task 的只读诊断详情，可选 executionId 精确定位一次执行。该模式允许查看 blocked、failed、completed 和仅存在于账本中的 Task。
- 返回 Task cwd、role、状态、执行身份与能力依据、宿主终态及 endedReason、停止确认依据、采样错误、真实 hold、RecoveryDecision 前提、报告是否收到/接纳和已知日志位置。没有报告或 Usage 时明确未知/不完整。
- 单任务查询优先复用权威内存记录；未加载时读取其确定性账本，不为了展示而恢复进内存、合成 hold、消费 RecoveryDecision、采样 Git 或发出 Delegation。查询不得改变 Task、并发状态或磁盘账本。
- 严格校验 canonical taskId 与可选 executionId 的归属，拒绝路径穿越和其他 workspace 的数据。目标不在内存、超恢复条数上限、账本损坏或磁盘无记录分别返回明确结果。
- 日志位置只来自宿主提供的当前会话元数据或已有持久记录。区分已验证文件、记录中已知但当前不可访问的位置，以及默认目录提示。没有确切文件名时明确未知，不遍历整个会话目录、不读取整段会话、不构造一个声称已存在的文件名。
- 诊断结果有固定输出上限，截断必须披露且不能把“未展示”说成“不存在”。错误内容遮蔽凭据，不返回环境变量转储、完整 shell 参数、完整 Worker transcript 或任意文件内容。
- Policy 的 Idle 与 live allowlist 都继续允许 `planner_tasks` 和 `git_audit`。Root 提示与拒绝修复指引指出：先查已有 Task，再用 `git_audit` 对 Task cwd 检查 Git；不要求用新 Explorer 才能诊断旧 Explorer 的故障。
- 本轮不增加通用 shell 或任意路径读取权限。操作员仍可显式选择已有的关闭守卫入口，但它不是默认诊断步骤。

### 7. 契约和交付边界

- 延续 ADR-0001 的结构化上下行、身份绑定与取消隔离原则；不解析报告文本、不恢复旧的文件扫描式报告兜底。延续 ADR-0002 的创建/重绑定分离和 ADR-0003 的独立 abort 入口。
- 本规格有意收窄 WRC P0 中对所有执行统一要求工作区静止的表述：该要求保留于有写入能力及能力未知的执行；受限只读执行采用独立依据。实现交付时同步更新域契约说明和面向用户的恢复说明，不能让旧文档继续声称 reader 也必须拥有 writer hold。
- 修改职责集中在 Delegation 生命周期、Evidence 探测、Review loop 的观察类验收、Orchestration 恢复、现有 Task 查询及其 host adapter。复用已有状态机和持久化，不新增独立任务系统。
- 新记录字段与查询参数需兼容旧账本、既有不带参数的 Task 列表和现有结构化返回消费者。公开工具 schema 变化按仓库发布约定升级版本。

## Testing Decisions

测试以外部可观察结果为准：工具返回、Task/Execution 记录、报告接纳与最终 Verdict、Writer hold、第二 writer admission、恢复后的状态和 Usage。优先使用既有生产入口，不为私有 helper 的调用顺序增加镜像测试。

主要 seam 是现有 `runDelegation` 及其 launcher/event transport；恢复问题通过真实账本写入与 `restoreFromLedger` 验证；Policy 和诊断通过注册到 Pi 的工具 execute 入口验证。复用现有 Delegation 取消与静止测试、Explorer 报告测试、Evidence GitRunner 测试、恢复占用测试和 Idle allowlist 测试。

| 验收场景 | 必须观察到的结果 |
| --- | --- |
| 非 Git cwd，observation Task，受限 Explorer，合规 completed 报告 | 报告返回并入账，进入 reviewing；信息验收条件满足时显式 Verdict 可 completed；没有 stop-evidence 导致的恢复要求或 Writer hold |
| 健康且有有效 HEAD 绑定的 Git cwd，同一信息任务 | 同样完整收口；证明不只是原错误消失 |
| Explorer cwd 的 Git status 失败或其他 writer 持续改动 | 诊断可见，执行停止不受 writer 静止条件阻塞；Task 特定的一致性要求仍有效 |
| Explorer 声称修改文件、报告身份错配或必需验证缺失 | 不得借观察类路径完成 Task |
| acceptanceMode 缺省、历史缺字段、非法模式/角色组合、重绑定改写模式 | 缺省与历史保持 worktree；非法组合与模式改写在派发前拒绝；不从任务文本推断模式 |
| observation Task 试图绑定 Worker/Validator/Reviewer，或含既有 writer/未知能力执行、变更归因 | 拒绝该调用或观察类验收，不能借模式绕过已有变更验证和隔离 |
| Explorer 取消、超时、无匹配终态、迟到及重复终态 | 如实保留终态与恢复要求；不制造 writer hold；报告和 Usage 恰一次处理 |
| Worker/Validator 正常完成后仍变化或采样失败 | 停止不确认并保持真实隔离，第二 writer 被拒；Validator 即使 readOnly=true 也不放行 |
| writer 启动前 Git 不可用 | 不调用 launcher；返回环境阻塞，不制造一个新未停止 writer；既有 hold 保持 |
| 第一停止样本失败、第二成功；第二失败；两者失败 | 每次失败阶段及其原因保留，不能只保存最后样本后丢失前次错误 |
| Git 不可启动、非仓库、status 非零、超时、额外根不可用或已知哈希缺口 | 返回可区分或明确未知的原因；不完整写入证据不能确认静止 |
| 新 reader 执行账本恢复；reader 与 writer 混合历史 | 不为 reader 新建 hold，不漏掉真正需要隔离的 writer |
| 历史未知能力、已有 hold、恢复上限之外的记录 | 真实/未知 writer 的隔离不退化；提供可执行且前提准确的人工恢复指引 |
| Idle 状态按 taskId 查 blocked 或只在账本中的任务 | 返回有界诊断；不调用 launcher、Git 或通用 shell；查询前后账本与并发状态不变 |
| 无参数 planner_tasks | 保持既有 live Task 列表行为 |
| 错误 taskId、其他 cwd、错配 executionId、损坏账本、日志文件缺失 | 有明确诊断，无任意文件读取、越界数据或伪造路径 |
| 错误明细含敏感值或超长内容 | 已知敏感值被遮蔽、输出有界、截断明确；不影响原失败阶段判断 |
| Writer hold 实际不存在/存在 | 文本展示与结构化诊断、恢复记录和并发状态一致 |
| 写入任务通过 reviewer、Verdict 与提交 | 原报告绑定、Evidence freshness、快照和提交门禁不被观察类模式绕过 |

真实宿主验收是本规格的交付要求：

1. 使用仓库支持的 Pi 与 pi-subagents 版本，在受控非 Git 目录显式创建 observation 模式的只读日志查找 Task，记录实际请求、工具结果、终态、报告和 Verdict，完成正常收口。
2. 用宿主可验证证据证明受限 Explorer 不具备 shell/edit/write 等变更入口；仅有模型说“我只读”或拒绝尝试不是证据。
3. 重载/重启后确认该只读任务没有占用；同时用受控 writer 停止不确认场景证明真实隔离仍保持。
4. 委派失败后，在 Idle 通过现有 Task 查询直接取到对应诊断和准确日志位置状态，且全过程不另起子任务。
5. 真实宿主条件缺失时验收记录为 BLOCKED，不以模拟 launcher 的结果冒充通过。

本地回归至少运行类型检查、受影响的 Delegation/Evidence/Review/Orchestration/Policy/adapter 测试及仓库完整发布检查。先让最小回归在当前行为下失败，再实现修复；保留失败与通过证据。规格编写本身不表示这些实现验收已通过。

## Out of Scope

- 修改 Excel 审核逻辑、修复 GPU/驱动、调整模型或宣称已经确定 4090 的现场根因。
- 自动连接服务器、升级服务器插件、全局关闭守卫、自动初始化用户目录为 Git 仓库或修改 Git 全局信任设置。
- 为非 Git writer 构建全新文件系统 Evidence 后端；本轮保证独立只读信息任务可用，并为 writer 提供启动前明确阻塞。
- 无条件放行 `stop_unconfirmed`、把 Git 不可用判作 clean，或批量删除历史 Writer hold。
- 把收到但未验收的报告自动转换成成功报告，或让取消后的 completed 结果越过现有取消竞态规则。
- 重建 Worker 内部 transcript、任意会话目录搜索、通用日志搜索工具或第二套恢复系统。
- 改写 WRC envelope、自动扩大预算、增加默认 timeout 或重做 pi-subagents 的停止协议。
- 修改原始 TaskSpec、放松写入任务的 Reviewer/快照/提交验收，或恢复已淘汰的文本报告解析通道。
- 本次 to-spec 不包含实现、发版或部署；实施票可在后续从本规格拆分。

## Further Notes

### 已有证据及限制

- 基线为本规格顶部的提交。前轮执行 `node --experimental-strip-types delegate.test.mjs` 返回 exit 0，stdout 为 `delegate.test.mjs: all cases passed`。这是现有行为基线，不是修复通过证据。
- 非 Git/Git 对照运行使用真实 Git 与生产 Delegation 入口，但 launcher terminal 为模拟，停止等待在测试中设为 0；不证明真实宿主只读隔离或停止时序。
- Git 对照仅初始化了仓库，停止确认通过且报告入账，但 Task 随后因缺少 HEAD 绑定进入 changes_requested。不得由此建议“执行 git init 即可完整修复”。
- 账本恢复重放证明原本无 hold 的 Explorer 被合成为 writer 占用；Policy 探针证明 Idle 允许 git_audit，并拒绝 read/grep。
- 原始输出保存在本目录 evidence 中，仅为诊断输出快照。前轮临时 harness 以内联形式执行，未保存为可复跑源文件；实现必须在已有测试 seam 重建回归，不把这些输出当成自动化测试。
- 用户已确认 4090 的 Pi 启动目录不是 Git 仓库。Task 账本中的实际 cwd、执行角色、加载版本和具体探测错误仍待取证。该缺口不阻止实施本地已复现的缺陷修复，也不应被记成已解决现场事故。

### 证据索引

- [既有 Delegation 测试输出](evidence/delegate-baseline.stdout)
- [非 Git/Git Explorer 对照输出](evidence/explorer-git-differential.json)
- [恢复与 Idle Policy 输出](evidence/explorer-restore-and-policy.json)
- [领域词汇](../../CONTEXT.md)
- [既有 WRC P0 规格](../worker-runaway-controller/spec.md)
- [ADR-0001](../../docs/adr/0001-typed-delegation-contract.md)
- [ADR-0002](../../docs/adr/0002-split-delegation-creation-from-rebinding.md)
- [ADR-0003](../../docs/adr/0003-abort-is-its-own-tool-surface.md)

### 测试边界确认

2026-09-17 用户明确确认：“符合，按此写入规格。”已确认的边界为：以现有 runDelegation 入口为主，在账本恢复入口、Pi 工具守卫和真实宿主补充验收；非 Git 目录的 Explorer 可交付、不会生成写入占用，Worker/Validator 的隔离不退化。

### 规格复核

只读复核确认事故证据与范围描述相符，并指出观察类验收不能依靠任务文本判定。已在实施决策中明确不可变 acceptanceMode、创建默认值、历史兼容、角色组合、重绑定规则和对应验收用例；这是本规格新增的公开契约决定，不是现有实现能力。
