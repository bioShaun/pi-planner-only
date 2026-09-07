# 16: 持久化恢复与预算停止后的收尾能力

**What to build:** 扩展 reload 或会话恢复后，Task 的累计消耗与在途预留身份从现有 Usage 持久化与重放机制恢复，不会得到一份新预算；关键数据无法恢复时状态明确拒绝声称余额可信。预算不足停止新的付费委派后，status 查询、合法的非通过 Verdict、已完成结果的结算仍然可用，不为预算停止绕过现有生命周期规则。

**Blocked by:** 15。

**Status:** ready-for-agent

- [ ] reload 后 status 显示的已用与预留与 reload 前一致。
- [ ] Usage 文件损坏：status 显示余额不可信，新的付费委派被拒绝。
- [ ] 预算停止后：status 可查；Root 可记录非通过 Verdict；此前已启动的子进程返回后仍被结算与记录。
- [ ] 预算停止不改变写锁与 Task 状态机的现有规则。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 37–38，阶段 D 决策第 5 条）。
