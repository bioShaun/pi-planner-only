# 07 执行时长与 Request 剩余时间

Status: done
Completion: step 1 committed a96559b; step 2 committed eb941ca, release exit 0 and strict PASS (final)

现有十分钟 execution 默认值不能代表一次晚启动委派实际还有十分钟：Request 截止自首个活动起算，验证与评审也需要时间。当前 TaskExecutionRecord 没有可校准的启动时间与统一耗时口径，Root 只能估算余量。P3 小任务组不区分五分钟和十分钟的策略效果。

范围：先明确并持久化插件自身的 execution 开始/结束时间和耗时口径，明确是否从 REQUEST 出站或 launcher STARTED 起算，排除前置 Git 采样；向 Root 返回权威 Request 剩余时间及其观测时点。未知时间必须明确 unknown，不能补猜。不得刷新 Request 截止、增加额度、改变一次修复或 Writer hold 规则。

验收：普通执行、等待启动、取消、晚到终态、恢复账本和跨 Request 场景都保留一致时间来源；时长不受墙钟回拨误导；同一 Request 内重入不能重新获得完整时限。若进一步自动截断 execution envelope 或强制预留评审时间，先另作 ADR 决定该行为，不能混入纯观测改动。

后续代表性校准需要同时比较 default-breach rate、Root 恢复 token 和完整 Request 完成率，并覆盖可能超过五分钟的工作；本轮三种小任务不能外推。沿用显式模型配置、全部失败样本、普通终端验收与 slot audit/status 规则。

## 稳定性影响评估与实施规划（2026-09-20，Claude）

现状核实：Request 截止 = 首次活动 `startedAt + activeMs`（request-control.ts:284/386），到点 `close("active-time-limit")` 取消一切，真实 TUI 三场景已证明关闭后零调用。execution envelope 默认 10 分钟墙钟独立计时（delegate.ts:1321–1338），不参照 Request 剩余时间；Root 只在诊断文本里看到 `Deadline: <ISO>`（request-control.ts:455），没有结构化的剩余时间。

结论：**不影响"有界运行"意义上的稳定**，安全网在 Request 层已闭合。影响的是结果可预期性：晚启动的 child 会被 Request 截止砍掉，已付费工作丢失，且终态呈现为取消而非"时间不足"，Root 无法预判也无法在同一 Request 内重试。这是可控范围内的浪费与误归因，值得做，但按观测和裁决分两步，不混在一起。

### 第一步：纯观测（不改任何时序行为）

1. TaskExecutionRecord 持久化 `launchedAt`（REQUEST 出站时刻）、`startedAt`（launcher STARTED，可为 unknown）、`endedAt`、`durationMs`（单调时钟差，不用墙钟相减），并标明口径；前置 Git 采样不计入。
2. Request 记录返回结构化字段：`requestDeadline`、`remainingMs`、`observedAt`；未启动时 `remainingMs = null` 并说明"未开始计时"。挂到 planner_status 的 Task 诊断和 planner_delegate/redelegate 的 details。
3. 终态归因：child 因 Request 关闭被取消时，endedReason 保留 `operator_cancel`/host 语义不变，但附 `requestClosed: "active-time-limit"` 与关闭时刻，让 Root 能区分"被操作者停"与"Request 到期"。
4. 测试（p1-delegation.test.mjs 真实入口 + request-control.test.mjs）：普通执行、等待启动、取消、晚到终态、恢复账本、跨 Request 重入不能重获完整时限、墙钟回拨不改变 durationMs。不删既有断言。
5. 验收：release exit 0；ordinary review 即可（无权限或写入边界变化）。

### 第二步：裁决后的钳制（另写 ADR-0010）

- 决定：launch 时若 `envelope.maxWallMs > remainingMs − reserveMs`，是拒绝、钳制到剩余值、还是仅警告；`reserveMs` 给验证与评审留的余量如何定（建议从 P3/真实记录取中位数，先设常量并标 provisional）。
- 不刷新 Request 截止，不增加额度，不改一次修复与 Writer hold。
- 测试：钳制/拒绝的三种分支、显式 envelope 与默认值各一组、剩余不足时不启动 child 且账本有记录。
- 验收：行为变化，走 strict gate（默认 600 秒）。

### 规模与分工

第一步约一天内可完成的改动量（记录字段、两处返回、归因附注、测试）；第二步取决于裁决，改动小但要 ADR。用户实施，Claude 审核；每步交付：改动文件列表、命令与退出码、日志路径、diff 统计。

## 第一步实施结果（2026-09-20，Codex）

第一步已完成，未提交。实际诊断入口为 `planner_tasks`（仓库无 `planner_status`），委派返回 `details.request` 与 `details.executionTiming`。执行耗时采用 REQUEST 出站到最终落账的单调时钟差，包含既有停止确认，排除前置 Git；未知时间不补猜，取消宽限期结束且无终态时不填写最终耗时。Request 关闭原因与时刻随原 Request 归属持久化，`operator_cancel` 语义不变。

完整 release 首轮 exit 1（旧的完整诊断相等测试遇到实时观测字段），固定该测试时钟且保留全部旧断言后，复跑 exit 0。独立 `astra_reviewer` ordinary review PASS，无需修正项；本轮没有替代或修改既有 Claude 审核记录。13 个产品/测试文件，393 insertions(+), 29 deletions(-)，既有断言删除 0 行。

文件列表、完整命令、失败及通过日志、审查与哈希见 [第一步交付记录](../issue07-step1/closeout.md)。第二步钳制/拒绝/警告及 reserveMs 尚未裁决，ADR-0010 未创建；P3 大任务测量未启动，本轮只完成其时间观测前置条件。

## 第二步裁决与完成（2026-09-21，Codex）

第一步经 Claude 独立 ordinary review PASS 后已提交：`a96559b`。第二步采用钳制并记录，预留 60 秒标 provisional，已写入 ADR-0010 并实现；不足预留或剩余观测不可用时持久化拒绝，不启动 child。Reviewer 可用预留窗口，Request 截止与额度不刷新。

两轮 strict finding 分别修复了手动恢复拒绝时提前解除 hold、异步采样后使用过期 hold 快照的并发问题；顺序及并发回归随完整 release 通过。最终 fresh strict `PASS (final)`，父子实际只读探针和最终哈希均核实。第二步已于 `eb941ca` 提交，P3 大任务测量未启动。完整文件列表、命令、退出码、失败记录与证据见 [第二步交付](../issue07-step2/closeout.md)。
