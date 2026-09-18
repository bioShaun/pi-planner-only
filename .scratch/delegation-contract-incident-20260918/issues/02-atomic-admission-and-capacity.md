# 02: 准入拒绝不留下新 Task，并解释并发占用

**What to build:** 用户收到新 Delegation 的前置拒绝时，没有新增悬挂 Task 或 reservation；接受后才发生的故障仍可定位与恢复。容量或 workspace 冲突有准确错误码，现有 status 能解释普通占用与恢复的 Writer hold。

**Blocked by:** None (can start immediately).

**Status:** resolved

Parent: Delegation 契约事故修复：运行身份、准入一致性与参数保真（2026-09-18）。范围 B 的新建准入与占用诊断；User Stories 8–12、25。

- [x] 从已注册 planner_delegate 入口复现准入拒绝后仍可见 planning Task 的现有行为，再将回归改为验证拒绝后内存、任务查询与持久化账本均无本次新增 Task/execution。
- [x] TaskSpec 无效、已知执行能力不满足、容量已满、workspace conflict、已有 Writer hold 等前置拒绝均无 launcher 请求、无新增有效 reservation；允许 Task id 分配器留下序号空洞。
- [x] 准入使用原子 reservation，而非只增加无锁预检。两个调用竞争最后一个名额或同一 cwd 的 writer 权限时最多一个通过；失败方不留下 Task 或占用。
- [x] reservation 已取得但 Task 建档失败时，释放且只释放本次临时占用；已有 Task、其他执行 reservation 与真实 Writer hold 不受影响。
- [x] 已接受创建后发生证据采样或 launcher 故障时，保留可定位 Task、是否实际启动、错误原因与适用恢复信息，不将这类故障误清理成准入前拒绝。
- [x] 对已有 Task 的前置拒绝保留原 TaskSpec、状态与执行历史，不因重入失败重新创建 Task。
- [x] 并发上限与 workspace conflict 返回各自准确的机器码；没有创建新 Task 的拒绝明确说明未创建、未启动，涉及已有 Task 时保留其 canonical taskId。
- [x] 现有 status 输出每个 reservation 对应的 Task、execution、角色、能力与 workspace；可区分普通活动占用和恢复的 Writer hold，后者展示已知 hold 原因。
- [x] 持久化恢复可合法产生 occupied 大于 limit；测试覆盖其可解释性及新 writer 仍被拒，不将大于限额本身判定为泄漏，不自动清空 hold 或提高限额。
- [x] 账本重载后，被拒绝的新 Task 不复活，已接受后的故障记录与真实 Writer hold 不丢失；完成故障注入、并发竞争和相关既有回归。

Testing seam: 已注册工具入口与可重载账本，结合现有并发与终止 fixture。核心断言是调用结果、launcher 请求数、Task/ledger 状态和 status 占用，不固定内部实现步骤。不需要新的独立预重构票；局部整理随本行为完成。
