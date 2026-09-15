# 05: policy-cutover

Status: needs-triage（到达时由 Devin 展开为完整票面）
Blocked by: 04
Type: task

**Scope（一段话）：** Policy 切换：Root 的 `subagent` / `bg_wait` 一律拒绝；Idle-for-gather 规则改为只认 `planner_delegate` / `planner_verdict` / `git_audit`；`decidePolicy` 不再读 prompt；宿主验证旧拦截链不可达（Root 试图调 `subagent` 得到拒绝，且不启动 run）。

**Acceptance：** 到达时定；固定一条：`grep` 证明本票没有新增任何对 prompt / 子进程输出文本的解析。

**04 复核承接项（2026-09-15）：** `delegate.ts` 的 validator 分支 `beginExecution` 须加 `auxiliary: true`，与旧链 `orchestrate.ts:3041-3048` 对齐；否则旧链 `!auxiliary` 过滤（`orchestrate.ts:1683/1818/2151/3667`）会把 validator 当成最新真实 execution。展开票面时纳入。
