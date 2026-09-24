# 01: 请求总额度耗尽后持久封锁并停止活动 child

**What to build:** 一个用户请求内所有 Root 工具和 child 共享有限额度；耗尽后封锁新工作、取消已有工作，并如实显示停止状态与 Writer hold。

**Blocked by:** None（前置验证及用户确认已完成）。

**Status:** ready-for-human

**Approval:** 2026-09-20 用户批准建议值和五票拆分。

- [x] Request controller 独占 requests 的 tool attempts、child claims、绝对截止、封锁与持久化；Task 的状态含义不变。
- [x] 工具 hook、execute 直入和最终 child dispatch 都使用同一状态；toolCallId/dispatch 身份幂等计数，覆盖 reviewer、validator、report-only 和并发预检查。
- [x] 第 N+1 个 tool/child 请求被拦截；已失败/取消的 launch 不返还额度，跨 Task/重载不清零。
- [x] 每次派发在 emit REQUEST 前原子持久化 dispatch-keyed claim 和累计额度；提交前拒绝不占 claim，提交后状态未知则保守保留，不在重载时自动重发。
- [x] 在 claim 提交前、提交后发送前、发送后 terminal 前分别注入故障并重载，确认没有漏计或重复启动；诊断区分 claim、已发 REQUEST 和已确认 terminal。
- [x] 请求截止能在 child 活跃时关闭 admission 并走现有取消路径；确认停止才释放 writer，未确认留持久 Writer hold。
- [x] 封锁先于取消；取消、晚到 terminal、持久化失败、宿主缺失 abort 均不能重开入口。
- [x] 封锁工具返回 block+terminate，尝试 Root abort；报告分别列出 admission、child、Root 状态，不将 abort 调用计为 confirmed。
- [x] 从真实插件工具/adapter/ledger seam 验证每条边界及故障；附普通路径未越界对照。
- [x] 同票更新 Request 域语义、owner/停止能力设计记录和用户诊断说明；不变更 Idle Policy、TaskSpec 或模型路由。

完成此票可演示“耗尽即封锁”，但整合发布仍等 05；自动新请求恢复由 03 提供。

**Implementation:** 已实现并通过对应单进程行为测试；源码在 request-control.ts、request-events.ts、index.ts，契约见 CONTEXT.md / ADR-0005。该状态表示提交独立验收，发布门禁仍由 05 负责，不能视为真实 CLI/TUI 验收通过。原始设计草案保留在 drafts/。
