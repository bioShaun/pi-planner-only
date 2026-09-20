# P0：请求级封锁、停止与恢复（已批准 spec）

**Status:** ready-for-agent

实现注记（2026-09-20）：公开 SDK 的 command context 不携带来源，extension 可主动启用 slash command 展开。因此 resume 增加实际人机 UI 确认与确认前后 idle 检查；headless 不可凭命令文本解锁。SDK 还会在 tool_call 前拒绝未知工具/非法参数，故从公开 assistant message_end 的结构化 toolCall 补记尝试，与 hook/execute 使用同一 ID 去重。默认值和范围不变。

范围：仅 P0。日期：2026-09-20。用户已明确批准建议阈值和五张 ticket 的拆分，继续实现。批准原文：“采用建议值和拆分，继续实现”。

## Problem Statement

用户请求内，Root 可以反复改写拒绝参数、新建 Task 或恢复失败执行，持续启动模型/child。当前拒绝器和单次 envelope 不能形成共享请求边界；另一条 evidence revalidation 路径的三次上限也没有实际递增。用户无法从一句“已停止”判断停止的是新委派、活动 child，还是 Root 本身。

## Solution

引入一个请求生命周期控制模块作为共享额度、封锁和边界的唯一 owner。达到边界后先持久封锁所有新的 Root tool/child admission，再取消活动 child，并请求宿主停止 Root。展示三项独立状态：新委派是否封锁、child 是否确认停止、Root 是否确认停止。

本阶段最低交付是可跨重载保持的准入封锁和正确的 Writer hold。完整停止只对通过真实宿主模式验收的组合声明；默认 SDK 的队列续跑已有反例。合法的新用户请求不会继承上一请求的额度，但同请求的 Task、纠正、恢复和自动续跑共享同一份额度。

## User Stories

1. As an operator, I want failed automatic attempts to stop at a finite boundary, so that one request cannot keep launching children.
2. As an operator, I want limits shared across Tasks, so that minting a Task cannot reset the request.
3. As an operator, I want wording changes ignored by no-progress detection, so that refusals cannot be replayed indefinitely.
4. As Root, I want a finite opportunity to repair invalid parameters, so that one malformed call need not end useful work.
5. As an operator, I want every launched child counted, including reviewers and failed attempts, so that hidden retries do not escape the limit.
6. As an operator, I want closure enforced at final child dispatch, so that concurrent or direct execution paths cannot bypass the hook.
7. As an operator, I want active children cancelled on request stop, so that work does not continue after admission closes.
8. As an operator, I want Writer hold retained until stop is confirmed, so that cancellation cannot create overlapping writers.
9. As an operator, I want reload and compaction to preserve closure, so that runtime maintenance does not reopen work.
10. As an operator, I want queued and extension messages to remain in the same request, so that automatic continuation cannot grant itself a new budget.
11. As an operator, I want a trusted next input to open a fresh request after settlement, so that a previous failure does not block unrelated work.
12. As an operator, I want a command-only recovery path when boundaries are unknown, so that Root cannot unlock itself.
13. As an operator, I want evidence revalidation counted at actual dispatch, so that the existing three-attempt limit works without charging refused calls.
14. As an operator, I want refusal, transient failure, child budget termination and unconfirmed stop distinguished, so that recovery is bounded and relevant.
15. As an operator, I want new-delegation closure, child stop and Root stop reported separately, so that a limited stop is not presented as full termination.
16. As an operator, I want model identity checked against actual historical records, so that routing intent is not mistaken for runtime identity or cost savings.

## Implementation Decisions

### Request 生命周期与持久化

- Request 是大于 Task 的新概念；TaskSpec 不变，不挪用 Task 状态或 reviewRound 表达 Request。
- 控制记录包括版本、宿主 session 身份、规范化 workspace 身份、程序生成 requestId、起点、冻结的限额、计数、封锁原因、settled 证据及停止状态。不把 transcript 或模型文本作为控制数据。
- 在第一次受管入口前恢复记录。session_start、重载、compaction、分支切换本身都不证明新请求；记录缺损、归属冲突或写入失败时关闭 admission 并明确告知，不能默认归零。首次安装没有旧记录可建立新记录；与已有记录损坏严格区分。
- 封锁状态先写入内存与原子持久化，再传播取消；持久化失败也必须保持本进程封锁。并发准入串行裁决，截止与最后一份额度的竞争不能多放行一个 child。
- 旧请求的延迟 terminal 只更新原执行和对应 Writer hold，不能重置新请求或把预算记到新 requestId。
- 每个 child 使用程序生成的稳定 dispatch key 关联请求与执行。在所有前置验证完成后，先原子持久化该 key 的 launch claim、累计额度和派发状态，再发出 launcher REQUEST。提交前失败不消耗 child claim；提交后失败/崩溃保守保留 claim，不因是否收到 terminal 而返还，也不在重载时自动重发同一 key。
- launcher 接收请求与本地记账不构成跨进程事务；诊断区分“已提交 claim”“已观察到 REQUEST 发出”“terminal 已确认”。发送前后未知窗口保留封锁/写入预留，等待关联 terminal 或 operator 处理，不把“未看到确认”当成“未启动”。新的恢复执行使用新 key 并消耗剩余额度。

### 已批准有限默认值（尚未以正常任务组校准）

| 边界 | 建议值 | 计数/触发定义 |
|---|---:|---|
| 请求内 Root tool attempts | 32 | tool_call 记录所有工具尝试（含被拒）；execute 直入使用同一 toolCallId 去重补计。第 33 次在执行前拒绝 |
| 请求内 child launch claims | 8 | 所有角色、所有 Task 和 recovery 共用；第 9 次在最终 dispatch 前拒绝；失败/取消不返还已提交 claim |
| 连续同类无进展失败 | 3 | 第 3 次确认失败即关闭请求；改文案/Task/execution/evidenceRef 外壳不清零 |
| 真正结构修复的继续机会 | 2 | 仅已有结构问题实际减少时使用；额度不增加总 tool/child 限额，不累计无限续命 |
| 请求最长活动时间 | 15 分钟 | 从首次受管活动开始，绝对截止时间跨重载保留；到期关闭 admission 并取消活动 child，不能承诺 provider 已停止计费 |
| 每 Task evidence revalidation 派发 | 3（既有） | 只在有效重新验证 dispatch 提交时递增，同一 grant 不重复收费，拒绝不计数 |

这些是用户批准的保守初值，不是测量得出的成本最优值。仅 operator 配置可设置正有限值；配置在请求开始时冻结。Root 参数、child 报告和同请求政策切换不能提升或重置额度。invalid/zero/unlimited 配置必须显式报错并保持封锁，不能悄悄回退为无限。

不新增美元或精确 token 硬上限。Root 模型请求次数在可观察的宿主 seam 记录，当前缺少跨模式可靠拦截证据，不伪装成可保证的硬计数闸门。

### 语义稳定的事件与进展

- 单 owner 接收工具尝试/结果、child dispatch/terminal、结构验证结果、可信宿主边界及定时截止事件。调用方执行决定，不各自维护请求预算。
- 工具名、操作分支和结构化失败类别用于归类；canonical Task/execution 标识用于关联和审计，不构成新额度。summary/reason 文案、JSON 字段顺序和新 execution ref 不等于进展。
- typed contract 合法只证明可接纳，不证明工作有进展。采用下表决定是否更新连续失败状态。每个结构化 failure family 在 Request 内保留一条持久失败链；同 family 的失败跨 Task 累加，文案和新 ID 不创建新链。遇到另一 family 建立/更新它自己的链，不抹掉旧链；任何未解决链达到上限都关闭请求。
- 每条失败链记录由程序实际关联的失败 Task/execution 成员；无法绑定到已有 Task 的拒绝记为 unbound 成员。纠正/recovery dispatch 根据已有 Task 的待纠正状态记录可信前序关系，并与 dispatch 记录一起持久化；不由 Root/child 自报因果关系。
- 精确解决集合：一次纠正/recovery 通过既有 Evidence/准入/审核进入 completed 后，解决其可信因果前序闭包中所有“同一 Task、同一 failure family”的失败成员，包含间接前序；不解决其他 Task、其他 family、无因果路径或 unbound 成员。Task/execution ID 用于验证关系，不为新 Task 分配新额度。关系缺失则保守保留，不能通过时间先后或文案猜测。
- 仅当一条链的全部失败成员都经上述关联证明解决且没有 unbound 成员时，才清除该链 streak。无关 Task 的成功不影响原链；关系不明或 unbound 失败在当前请求内保守保留。真实结构修复最多消耗两份继续机会，不清除已有 streak，也不提高全局额度；若修复后仍失败，按实际失败结果计数。

| 实际结果/状态变化 | 无进展状态处理 | 后续行为 |
|---|---|---|
| typed WorkerReport 为 failed 或 blocked | 按已确定的 failure family 递增；无法分类记 unknown-failure | 到阈值关闭请求，否则仅允许已有契约表达的下一步 |
| typed report 为 partial 或 completed，但尚未通过最终验收 | 不清 streak，不因为新 report revision 宣称完成 | 按既有 Review loop 继续，仍占总额度 |
| 重复 request_changes / 同类 task-quality 缺陷 | task-quality family 递增；报告结构正确和新 revision 不清零 | 有限纠正；阈值后关闭请求 |
| child budget/cancel 且无有效完成 | 对应 budget/cancel family 递增 | recovery 不清零，并消耗新 launch claim |
| environment failure / stop-unconfirmed | 对应 family 递增；stop-unconfirmed 同时保留 Writer hold | 无自动环境重试；Writer hold 条件独立生效 |
| transient provider/transport failure | 对应 transient family 递增 | 不新增插件透明 retry，显式重试计入原请求 |
| 程序确认缺失/非法字段已修复 | 消耗有限结构修复机会；不清 streak | 可继续该次验证；若仍失败，失败照常计数 |
| 同一失败 Task 的关联纠正/recovery 经完整验收进入 completed | 解决同 Task、同 family 的全部可信因果前序成员；仅该 family 链全部成员解决后清 streak | 总 tool/child 计数与截止时间保持 |
| 无关 Task completed，或缺少可信纠正关系 | 原失败链完整保留 | 不因新 Task 完成授予旧链新机会 |
| 状态查询、读取、获得新 ID、纯提示或文案变化 | 不清 streak、不授予修复机会 | 总 tool attempts 照常计入 |

- 明确区分确定性契约失败、环境错误、暂态 provider/transport 错误、任务质量失败、budget/cancel 和 stop-unconfirmed。插件不新增透明 retry loop；Root 发起的恢复仍占共享额度。上游已有 provider retry 的 owner 留在宿主，具体次数记录到兼容性结果，不能声称插件截断了所有宿主内部重试。

### 停止与 Writer hold

- 在 Root tool hook 和最终 launcher REQUEST 边界都检查同一 Request。涵盖新建、重入、异常 recovery、reviewer、validator 和 report-only 路径；一批已预检查工具仍需在 execute/dispatch 再检查。
- 封锁后所有 Root tool_call 返回 terminating block；配合 best-effort ctx.abort。terminate 的全批次要求及队列限制需测，不等价于整个请求结束。不得通过隐藏 active tools 破坏 child 的工具 ceiling。
- 通过已有单次执行取消、terminal 关联和 quiescence 机制取消活动 child。仅确认停止后释放写入预留；stop-unconfirmed 持久保留 Writer hold，重载后仍拒绝新 writer。
- 公开插件上下文没有清空队列的接口。P0 不直接 import 上游 raw TypeScript、不调用宿主私有 session 字段、不改用户全局 host 安装来绕过能力缺口。
- Root stop 状态至少区分 requested、confirmed、unsupported/unconfirmed；必须有宿主终态证据才能显示 confirmed。已调用 ctx.abort 或工具返回错误不能升级状态。
- writer 的显式人工处理继续遵循既有契约；Request reset 不清除 Writer hold，也不能把迟到 terminal 当作新请求的停止证明。

### 可信边界与 operator 恢复

- 已验证 `agent_settled` 是强于 agent_end/turn_end 的边界。后两者不结束 Request；settled 记录结束事实，但封锁不在这个事件上立即清除。
- 仅在旧请求已 settled、没有未结算活动调用，并收到受支持来源的下一条独立输入时建立新 Request。interactive 来源的 idle 场景已在 SDK 探针观察；RPC 的真实入口在最终宿主验收前不得默认授予自动 reset 能力。启动时的第一条受信任输入可开新 Request。
- source=extension、scheduled/custom messages、steer/followUp、autocontinue、自动重试都不授予新额度。用户在旧请求活动时发送的 steering 归入旧请求；不根据输入文本推测用户在“开新任务”。
- 未知/旧宿主缺少可靠 settled 或来源证据时保留封锁，使用 operator-only `/planner-only request resume`。该入口不注册为模型工具，不接受 child 请求或文本伪装命令；必须等旧调用停止，未确认 writer 仍保留 hold。
- `/planner-only request status` 展示 Request 原因和三项停止状态；结果有界，不把 child transcript 注入 Root。

### evidence revalidation 既有上限

- grant、dispatch、terminal 分开：grant 保存证据状态，不消耗次数；验证完准入并提交实际派发时消费一次 pending grant，记录 evidence key 与执行身份，计数持久化。
- 把计数、消费和该 dispatch 的记录作为一个一致性操作；不得先清 pending 再因写盘失败丢失 grant，也不得先 emit child 再无持久派发记录。
- 同一 dispatch 的重入幂等；提交前拒绝和重复 grant 不递增；上限耗尽不能通过相同或新 evidenceKey 再 dispatch。与所有 child claim 相同，派发提交后发生失败或发送状态未知时保守记为已用尝试，单独披露是否观察到实际 REQUEST，不自动退回计数或重复启动。
- 该 Task 局部限制和请求 child claims 限制作用域不同；前者继续由 TaskStore 持有，后者仅由 Request controller 持有。两者均须满足，互不重置。

## Testing Decisions

- 主行为入口复用现有“真实插件 hook → 已注册工具 execute → 版本化 launcher event adapter → ledger”fixture；模拟宿主事件、Git 和 child event source，断言实际 launch/取消/持久状态，不只测试计数方法。
- 宿主边界另用固定版本真实 AgentSession/ExtensionRunner + faux provider，断言模型调用数、输入来源及事件顺序。这是必要的第二层证据，不能用 fake ctx.abort spy 代替。
- 01 验证总 attempts/launch/deadline 的边界值、并发竞争、execute 直入、reviewer 分支、所有角色以及 late terminal；child 活跃时确认/未确认取消和重载 Writer hold 均覆盖。故障注入分别落在 claim 提交前、持久化后 REQUEST 前、REQUEST 后 terminal 前，恢复后没有漏计、退回未知 claim 或自动重发。
- 02 覆盖完全相同、只改文案、换 Task、用最新 executionRef 恢复、交替失败类别；真实参数修复可在有限额度内继续，成功状态查询不能冲掉预算。逐项驱动上述结果表，尤其是结构合法的 failed/blocked、未验收 completed、重复 request_changes、budget 和 environment，均不能冒充完成清 streak。必须验证 A 同类失败两次→无关 B 完成→A 再次同类失败会关闭请求；反向对照验证 A 的真实关联纠正完成能解决 A 成员，不能同时解决其他 Task 或 unbound 成员。
- 02 的因果正向对照为 A/e1 失败→A/e2 纠正失败→A/e3 纠正被完整接纳：e3 解决同 family 的 e1 和 e2；并行保留另一 Task、另一 family、unbound 或没有可信前序边的成员。恢复后继续判断使用同一持久因果关系，不能只清直接前序而遗漏 e1。
- 03 覆盖 settled 后新 interactive 输入、活动时 steering、extension/custom nextTurn/followUp、agent_end 再排队、compaction、重载、未知来源、operator resume 与未确认 writer 的组合；Root 不能调用 resume。
- 04 通过真实 verdict/reviewer 决策授予 revalidation，再实际重入，断言计数恰好一次与第 4 次派发为 0；覆盖被拒与重复派发。原基线 probe 保留，另写修复后回归，不能删旧行为断言后宣称历史复现全绿。
- 05 记录本地测试 host、实际 CLI host、launcher 的固定版本/指纹；至少验证当前 0.85.1 + 0.69.0 的 transport 与默认 SDK/CLI 模式，真实 TUI 未验收就明确缺项。自然语言有界宿主验收与 faux 探针分开；不能把 replica binding 冒充 TUI。
- `npm run test:release` 与任何生成子进程的测试必须在普通终端或 CI 执行，保留命令、版本、stdout/stderr、signal 和 exit。sandbox EPERM 为环境阻碍，不能削弱/改写 probe。
- 有生产行为变化后，冻结中性证据，使用规定的独立只读 launcher 完成 fresh Reviewer gate，并核对前后状态。文件写入始终单 writer；重活先 slot audit/status 入日志，再 slot 提交。

## Out of Scope

P1–P3、Idle Root 读取放开及读取字节默认额度、路由恢复、默认 envelope 优化、partial-report grace/format repair、强制 reviewer 链、全局宿主私有 API 改造及费用节省承诺。现有 typed TaskSpec/WorkerReport、独立 abort surface 和 Root-stamped identity 不变。

## Further Notes

- [原路线图](../../docs/pi-planner-only-stability-and-delegation-plan.md)
- [前置证据与限制](evidence/discovery.md)
- [五张票的入口及依赖](README.md)

实现时更新 canonical domain/相关 ADR，使用已确定的 Request 术语与边界；设计批准本身不代表实现已验收。P0 保底条件达成与完整 Root stop 两种验收结果必须分别标记。
