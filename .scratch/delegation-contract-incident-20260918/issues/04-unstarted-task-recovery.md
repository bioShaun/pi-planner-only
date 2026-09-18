# 04: 为遗留未启动 Task 提供可验证的启动与结束路径

**What to build:** Root 查到旧版本遗留的 planning、无 execution Task 后，能用完整参数通过 planner_redelegate 启动原 Task，或以 planner_verdict blocked 记录放弃原因。错误提示明确这两条既有路径，不要求不存在的异常执行身份或新建重复 Task。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

Parent: Delegation 契约事故修复：运行身份、准入一致性与参数保真（2026-09-18）。范围 B 的遗留状态处理；User Stories 21–22、25。

- [x] 构造并从持久化账本恢复一个 planning、无 execution、无 WorkerReport、无 recovery.required 的旧 Task；不必先运行缺陷版本制造它，不操作事故用户的真实记录。
- [x] planner_tasks 可定位其 canonical taskId，展示未启动事实；相关拒绝和使用说明明确区分“未启动 Task”与“异常执行待 RecoveryDecision”。
- [x] 在容量可用、参数有效时，通过已注册 planner_redelegate 入口对原 taskId 启动恰好一次执行，不另铸 Task，不要求 RecoveryDecision，原始 TaskSpec 不被覆盖。
- [x] 在独立的同类 fixture 上，planner_verdict blocked 不要求 WorkerReport 或 recovery.required，记录原因并将 planning 转为 blocked；不制造 WorkerReport 或虚构 execution。
- [x] blocked Verdict 不发送不存在执行的取消请求，不清除其他执行的 reservation 或 Writer hold；它不是正在运行执行的通用取消入口。
- [x] 重复拒绝保护已经因本 Task 的 malformed redelegate 触发时，查询仍可用，合法的 blocked Verdict 仍能结束 Task，其他工具的参数计数不能封锁这条路径。
- [x] planner_abort 对没有 recovery.required 的 Task 仍不适用；错误指导指向查询、有效重入或 blocked Verdict，不建议伪造执行身份，也不引入 launch/resume/cancel 新工具。
- [x] 再次加载账本后，已启动执行或 blocked 结果仍正确；结束的 Task 不被无意复活。既有行为已满足时，以缺口回归和准确指导交付，不做无必要的 lifecycle 重构。
- [ ] 通过现有工具入口完成上述回归，并在隔离真实宿主上演示遗留 Task 查询与 blocked 结束；完整跨缺陷启动到最终报告的演示留给 05。

当前限制：持久化 fixture 与工具入口回归可证明本地 lifecycle 行为；没有本轮隔离真实宿主的查询与 blocked 结束证据，因此不能关闭本票。

Testing seam: 已注册任务查询、重入、Verdict 工具及可重载账本，参考既有 mint/rebind、无报告 Verdict 与恢复测试。独立 fixture 与完整有效参数足以验证本票，所以 01–03 不构成启动本票的逻辑依赖。
