# Delegation 契约事故修复：运行身份、准入一致性与参数保真

Status: ready-for-agent
Date: 2026-09-18
Type: spec

## Problem Statement

Root 在 planner-only 模式中完成了两项 Explorer 信息收集，却无法把结果接纳为有效 WorkerReport；随后一项实现 Task 在调用被拒后仍被创建，重入又连续遇到 validation 参数缺失，最终触发重复拒绝保护。用户得到的是“内容已交付但无法验收、任务已创建但没有执行”的工作流。

用户提供的事故记录如下；除完整给出的 UUID 外，不补全缺失标识，也不将叙述当作原始传输记录。

| Task / 轮次 | WorkerReport 中的 workerRunId | 收到的结果 |
| --- | --- | --- |
| T-20260918-004 首轮，run 前缀 f01f7964 | planner-scout | 身份不匹配 |
| T-20260918-004 纠正轮，run 前缀 52909790 | T-20260918-004 | 身份不匹配 |
| T-20260918-005，run 8f7330e8-2957-4d30-8e93-ffb345efc8bd | not-provided-in-launch-packet | 身份不匹配 |
| T-20260918-006 创建 | 不适用 | CONCURRENCY_LIMIT_REACHED，occupied 4/3；随后可见 planning、无 execution |
| T-20260918-006 重入 | 不适用 | validation 被诊断为只有 required: true；重复拒绝保护最终阻止继续执行 |

用户报告重入时传入的必需测试命令为 `cd skills/herdr-pair && python3 -m unittest tests.test_pairctl -v`。它是事故输入样本，不是本项目的验证命令。用户报告 recon 的内容保留在 run summary 中，且事故工作区未修改；本次规格工作未独立验明这些内容的完整性或正确性。

当前源码只读核对支持以下结论：

- Orchestration 下发的 Task 内容由 TaskSpec 与 instructions 构造，没有在这一边界注入 child run id；回收却将 WorkerReport 身份与 launcher 返回的 runId 对照。尚未检查事故中实际 launcher 给子会话的全部上下文，不能断言它绝对没有通过其他渠道提供身份。这是运行身份契约缺口的强线索。
- 新 Task 的持久化创建发生在并发准入之前；准入拒绝可能留下未执行的 planning Task。这条顺序在源码中可确认。
- delegate 与 redelegate 共用包含 validation.commands 的参数定义，TaskSpec 构造也转发该字段。报错证明校验点没有收到完整 validation，尚不能证明字段在模型生成、宿主解析、schema 转换或插件内部哪一层消失。
- 重复拒绝保护比较规范化后的参数，不会主动忽略 commands。它能证明所观察边界的参数相同，不能证明上游没有发生变换；当前“修改没有发出”的提示超出了可观察事实。
- occupied 4/3 不单独证明 reservation 泄漏。恢复的 Writer hold 可无条件占位，限额也可变化，必须检查占用明细。
- 当前状态机允许 planning → blocked；planner_verdict 的 blocked 不要求已有 WorkerReport。因此“planner_abort 不适用”不等于“任务无法结束”。

## Solution

让用户从创建、执行、报告接纳到验收得到一致且可恢复的结果：

1. 每次执行开始前，子会话能取得本次真实运行身份，按该身份返回 WorkerReport；Root 继续严格校验，错误报告保留为未接纳诊断材料。
2. 新 Delegation 因前置准入检查被拒时，不留下可操作但永不执行的新 Task，也不泄漏 reservation。已被接受后发生的启动或执行故障保留可追踪 Task 与现有恢复语义。
3. 合法的 validation.commands 在两种委派入口中完整到达执行边界；缺失时，诊断能指出实际观察到的参数以及最后一个有证据的边界。
4. 重复拒绝保护继续阻止相同失败的无限循环，但不会阻止实际变化后的合法调用，也不会把未知的上游行为归咎于 Root。
5. 旧版本留下的 planning、无 execution Task，可在条件允许时通过 planner_redelegate 启动，或通过 planner_verdict blocked 明确结束；无需伪造 RecoveryDecision。

实现按三个范围分别复现和验收：A 运行身份；B 准入与任务状态；C 参数保真与拒绝诊断。三者共享工具入口验收边界，不以其中一项通过代替其余两项。

## User Stories

1. As an operator, I want completed Explorer work to produce an admissible WorkerReport, so that useful recon can proceed to a Verdict.
2. As an Explorer, I want my current run identity supplied before my first turn, so that I can report it without guessing.
3. As a Worker, I want task identity and run identity clearly distinguished, so that I do not substitute a Task id for a run id.
4. As a Worker, I want a new execution's identity on every correction round, so that I never reuse an earlier run's identity.
5. As Root, I want wrong-run reports rejected, so that results from different executions cannot be confused.
6. As an operator, I want rejected report content preserved with its rejection reason, so that useful diagnostic material remains available.
7. As Root, I want schema validity and execution identity reported separately, so that I can understand why a structured report was not admitted.
8. As Root, I want a pre-admission refusal to leave no new live Task, so that a failed create call cannot strand work.
9. As Root, I want the refusal code to identify capacity or workspace conflict accurately, so that I choose the appropriate next action.
10. As an operator, I want every occupied reservation attributable to a Task or execution and a hold reason where applicable, so that I can understand occupied capacity.
11. As an operator, I want restored Writer holds to remain effective, so that a restart cannot admit a conflicting writer.
12. As Root, I want failures after accepted admission distinguished from admission refusals, so that I can locate and recover the existing Task.
13. As Root, I want valid commands preserved through both delegation tools, so that mandatory validation reaches the execution unchanged.
14. As a Worker, I want exact mandatory validation commands in my TaskSpec, so that I know which checks must produce evidence.
15. As Root, I want required validation with missing commands refused before launch, so that incomplete requests cannot silently weaken acceptance.
16. As a maintainer, I want correlated observations at tool-call boundaries, so that I can locate where a parameter disappeared.
17. As a maintainer, I want the loaded plugin, host, launcher and exposed schema identified in incident evidence, so that I do not diagnose a different runtime version.
18. As Root, I want a real commands change to produce a different refusal identity, so that an earlier malformed request cannot block a correction.
19. As an operator, I want truly identical repeated refusals still bounded, so that a broken workflow does not consume unlimited turns.
20. As Root, I want refusal messages to describe the boundary they observed, so that I can distinguish missing input from unproven transport loss.
21. As Root, I want an existing planning Task with no execution to accept a valid redelegation, so that legacy stranded work can resume without a duplicate Task.
22. As Root, I want to close an unstarted Task with a blocked Verdict and an explicit reason, so that abandonment is recorded without fabricated execution recovery.
23. As an operator, I want recon acceptance to preserve identity checks in observation mode, so that read-only work remains attributable.
24. As a maintainer, I want real host acceptance tests alongside deterministic regressions, so that a fake launcher cannot conceal a missing child-visible identity or a schema conversion defect.
25. As an operator, I want fixes to preserve mandatory tests and writer isolation, so that restoring progress does not weaken acceptance.

## Implementation Decisions

- **保持现有边界。** 主要涉及 Delegation 的工具适配、Orchestration、Task 存储、ConcurrencyController、WorkerReport 身份校验和 RefusalBreaker。继续遵守 typed Delegation、创建与重入分离、异常执行放弃独立入口三项已接受 ADR；不引入从文本回捞报告、修补报告身份或混用创建与重入的回退机制。
- **先冻结可验证事实。** 对 A/B/C 各建立最小复现，记录实际加载版本与有效 schema。事故端原始记录不可得时，明确区分“历史原因未定位”和“当前契约已验证”，不得用当前 mock 测试倒推历史事实。
- **身份由 launcher 权威分配。** 明确区分 requestId、ownerRunId、Task id、executionId 与 child runId；不得假设任意两者相等。权威运行身份必须在子会话首次执行前以确定性上下文暴露，并与 terminal response 的 runId 一致。Root 无需事先猜测尚未分配的 child runId。
- **优先修正身份下发，不改写回包。** 先核对 launcher 实际能力；如果现有能力可提供运行身份，接通并覆盖它。若必须扩展上游 typed contract，记录兼容版本和能力检测，完成真实集成后才能宣告 A 解决。不得凭空向未支持的协议塞字段，或收到错误 WorkerReport 后偷偷覆盖 workerRunId。若选择改变身份权威模型，必须先显式更新 ADR，不属于本规格默认方案。
- **各执行独立绑定。** 首轮与纠正轮分别拿到自己的身份。角色名、Task id、requestId 的替代值、上一轮 runId、占位字符串都不得通过身份校验。结构校验通过但身份不匹配的 WorkerReport 不进入可验收报告序列；诊断材料继续保留。
- **新建采用明确的无任务拒绝语义。** 对 TaskSpec 无效、已知能力不满足、并发上限、workspace conflict、已有 Writer hold 等前置拒绝，在调用结束后内存与持久化账本均不得出现本次新增的 Task 或 execution。允许分配器产生序号空洞，不要求回收已领取的 id。
- **准入不能只有无锁预检。** 必须保留原子的 reservation 操作；两个并发调用不能同时越过最后一个名额或同一 cwd 的 writer 隔离。准入成功后建档失败应释放本次临时 reservation；不得释放其他执行或真实 Writer hold 的占用。实现顺序可在现有 seam 内调整，但上述外部结果必须成立。
- **区分拒绝与接受后的故障。** 通过准入并接受创建后，证据采样或 launcher 发生故障时，按现有生命周期保留 Task、错误原因、是否实际启动及适用恢复信息，不将它伪装成无副作用的准入拒绝。对已绑定 Task 的前置拒绝保留原 TaskSpec、状态与执行历史。
- **拒绝代码与信息一致。** 并发上限与 workspace conflict 保持各自可区分的机器码，不统一包装成误导性的 writer conflict。涉及已有 Task 时保留 canonical taskId；无新 Task 时明确“未创建、未启动”。
- **占用解释优先复用现有 status。** status 应列出 reservation 对应 Task、execution、角色、能力、workspace，并区分恢复的 Writer hold 与普通活动占用；有 hold 原因时展示它。允许合理的 occupied 大于 limit，禁止通过抬高限额或清空所有 hold 来制造恢复成功。
- **validation 保真。** 继续使用两种工具共享的 TaskSpec 参数形状。合法 commands 数组通过宿主解析和工具适配后完整到达 TaskSpec 与子会话，不改写命令字符串或以 acceptanceCriteria 代替结构化 validation。required=true 且 commands 缺失或不合法时仍拒绝；不得自动改成 required=false。
- **重入保持既有契约。** 非 Reviewer 重入仍使用调用明确提交的有效执行 TaskSpec，不因参数缺失而静默借用旧 commands。存储的原始 TaskSpec 不被纠正轮覆盖。Reviewer 继续使用已存 Task 的审核上下文，不受本轮执行参数修复改变。
- **参数定位以边界证据为准。** 对同一 toolCallId 比较原始 tool-call 参数、宿主解析或转换后的输入，以及 execute 入参；插件自身无法观察的上游边界要标明。复用宿主已有记录，必要时添加有界诊断，不建设全量遥测系统。保留字段是否存在、类型、数组长度、实际观察层和关联标识；命令内容仅在脱敏事故材料中按需保留，不回显凭证。
- **重复保护维持范围。** 仍以工具名、规范化参数及拒绝代码维护已有拒绝计数规则。commands 的新增、删除、顺序或内容变化均参与参数身份；对象键序变化不视为修正。第三次提示停止、后续相同调用拦截的保护继续有效。
- **修正诊断措辞。** 将 byte-identical 的表述澄清为“本边界收到的规范化参数相同”，给出前次 toolCallId、拒绝码及缺失字段摘要。不能声称模型没有发送修改，也不能声称 transport 已证实丢字段。保护触发后仍可使用 status、任务查询和合法的不同参数调用。
- **兼容遗留 planning Task。** 无 execution、无 recovery.required 的 planning Task 可通过合法 planner_redelegate 进入执行，也可通过 planner_verdict blocked 结束并记录原因。后者不是取消运行中的执行，不授予清理 Writer hold 的能力。planner_abort 仍仅处理 recovery.required 的异常执行；不新增通用 launch/resume/cancel 工具。

## Testing Decisions

测试以外部行为为准：工具结果、子会话实际可见输入、接纳的 WorkerReport、Verdict、Task/账本状态、launcher 是否启动以及 status 可见占用。避免断言私有函数调用顺序、源码文本匹配，或仅证明 schema 声明包含某个字段。

**主 seam：现有已注册 planner_* 工具入口。** 复用工具注册、事件总线、TaskStore/ledger fixture，驱动 create → launch → report → Verdict，以及拒绝 → 查询 → 合法重入/结束的完整序列。大部分回归在此完成；纯组件测试只补足规范化参数和竞争边界，不另造一套平行编排框架。

**必需集成补充：真实 Pi host 与实际 launcher 边界。** 工具入口 fixture 无法证明模型可见上下文和宿主 schema 转换，因此必须保留这一层验收。它是同一工作流的环境验收，不是新的业务 API。用户已确认工具入口主 seam 与真实 Pi host/launcher 补充验收的范围。

现有测试先例：

- `index.test.mjs`：已注册工具、事件总线、mint/rebind、refusal breaker、Verdict 与恢复序列。
- `delegate.test.mjs`：真实 runDelegation seam、可替换 launcher/GitRunner、参数拒绝和执行终止。
- `concurrency.test.mjs`：容量与 workspace 冲突；补上与账本结果联动的工具级场景。
- `refusal-breaker.test.mjs`：规范化参数、计数阶梯、不同拒绝码及成功后的计数行为。
- `report.test.mjs`、`orchestrate.test.mjs`：身份拒绝、未接纳报告与 Verdict 门禁。

| 场景 | 必须观察到的结果 |
| --- | --- |
| 两个 Explorer Task，其中一个增加纠正轮 | 三次执行各自获得对应 runId；合法 WorkerReport 被接纳，可进入正常 Verdict |
| child 只能读取真实下发上下文 | 不向测试 child 旁路提供预先知道的 runId；child 能从规定渠道取得运行身份 |
| 角色名、Task id、上一轮 runId 或占位字符串冒充身份 | 报告拒绝且 pass 不成功；诊断材料保留；observation 模式同样有效 |
| 不支持身份下发的 launcher | 明确报告契约不兼容；不得悄悄启动一个必须猜身份的 child |
| 新建时容量已满或 workspace 冲突 | 无新增 Task/execution、无 launcher 请求、无新增占用；拒绝码准确 |
| 两个调用竞争一个剩余名额或同一 cwd 的 writer 权限 | 最多一个成功；失败方不留下悬挂 Task 或 reservation |
| reservation 成功但 Task 持久化失败 | 本次临时占用释放，已有 Task 与其他占用不受影响 |
| 已接受后 launcher 失败 | 现有故障记录与恢复语义完整，Task 可定位，不被误当作准入前拒绝 |
| 恢复后 Writer hold 令 occupied 超过 limit | status 能解释占用；新 writer 被拒；不自动清除 hold |
| delegate 与 redelegate 接收 required=true 和同一非空 commands 数组 | commands 原样到达执行 TaskSpec 与 child；原始已存 TaskSpec 不被重入覆盖 |
| 使用事故命令字符串作为参数 fixture | 字符串完整往返；fixture 不实际执行其他项目的测试 |
| 缺失 commands 后补上 commands | 首次拒绝无副作用；后续合法请求不被前次重复保护封锁 |
| 连续相同错误与只改变对象键序 | 保持现有计数与拦截规则；提示只陈述可观察边界 |
| 上游有 commands、下游缺失的受控转换 fixture | 诊断能把丢失限制在两个已观察边界之间；不能用此模拟结果宣称历史根因已查明 |
| 旧 planning、无 execution Task 合法重入 | 使用原 taskId 启动一次，不铸造另一个 Task，不要求 RecoveryDecision |
| 旧 planning、无报告 Task 选择 blocked | 无需 WorkerReport 或 recovery.required 即可结束；无伪造报告、无执行取消或 hold 释放 |
| 重复拒绝保护已触发后查询与结束旧 Task | 查询仍可用，合法 blocked Verdict 不受另一工具参数的拒绝计数封锁 |
| Task/ledger 重载 | 被拒绝的新 Task 不复活；已接受故障 Task 与真实 Writer hold 不丢失 |

真实宿主验收须记录加载的插件版本/指纹、host 和 launcher 版本、provider/model、实际暴露的相关 schema，以及脱敏的输入/输出关联记录。至少完成首轮与纠正轮身份下发、一次有效 commands 重入、一次准入拒绝、一次遗留 planning Task 结束。不能只用 fake launcher 同时硬编码报告和 terminal 的相同 runId 来宣告身份链路通过。

如果原事故模型调用记录无法取得，C 的历史根因保持未定位；当前修复仍须证明受支持运行组合的参数保真，并留下可复查的边界诊断。缺真实宿主或上游能力时，明确记录该验收未完成，不能标记为全链路修复。

本次只发布规格，未运行以上测试。后续实现先建立会在缺陷上失败的回归，再修复并执行相关测试及项目要求的发布检查。测试中间文件必须放在已确认的项目目录，禁止写入 `/tmp`；预计超过一分钟、超过 2G 内存或大量读写 NFS 的工作按项目 slot 规则执行，并先将 audit/status 写入项目日志。

## Out of Scope

- 实现事故中另一项目的工单 01/versioned-acceptance，或将 recon 摘要当作该工单已验收的依据。
- 自动操作事故会话中的 T-004、T-005、T-006，重写历史报告、伪造 pass 或修改历史运行身份。
- 放宽 WorkerReport 身份校验、关闭 mandatory validation、把必需测试藏进自然语言 acceptanceCriteria。
- 放宽同一 cwd 的 writer 隔离、提高并发限额以绕过拒绝、无证据清除 Writer hold。
- 新的任务队列、调度器、通用取消工具或全面 lifecycle 重构。
- 修改 Explorer 模型选择策略；撰写规格时工作区已有相关并行改动，应由后续实现按当时基线兼容。
- 大规模 telemetry、provider 适配器重写，以及没有边界证据支持的上游缺陷修复。

## Further Notes

- 本规格源于 2026-09-18 用户事故总结与同轮源码核对；原始宿主调用 JSON、完整 child 输入和占用快照尚未作为附件提交。已确认行为与待定位原因必须保持区分。
- 参考域模型：[CONTEXT.md](../../CONTEXT.md)；参考决策：[ADR-0001](../../docs/adr/0001-typed-delegation-contract.md)、[ADR-0002](../../docs/adr/0002-split-delegation-creation-from-rebinding.md)、[ADR-0003](../../docs/adr/0003-abort-is-its-own-tool-surface.md)。
- `ready-for-agent` 表示范围、约束与验收已可供 Agent 执行，包括必要诊断；不表示参数丢失的历史根因已经证实，或修复已实现。
- 推荐先固定同一份宿主事故 fixture 和版本信息，再分别推进 A/B/C。若真实 launcher 需要上游变更，单独记录依赖与未完成验收，不阻塞可独立完成的准入一致性和拒绝诊断工作。
- 发布到本地 Markdown issue tracker 即创建本文件。本轮不拆实现工单、不提交代码、不改任务账本。
