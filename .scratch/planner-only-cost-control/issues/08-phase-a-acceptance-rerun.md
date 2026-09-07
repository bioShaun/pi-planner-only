# 08: 阶段 A 验收：同票真实重跑一次 PASS

**What to build:** 用 2026-09-07 探测的同一张票（oracle-status-line）、同一 Root prompt、同一模型配置，在独立 worktree 上真实重跑一次 planner-only 流水线。目标是一次 PASS，且探测中出现的五类问题都不再出现。记录分段墙钟、每次委派的 turns 与费用、Validator 次数、是否 PASS，写成与探测记录同格式的对照文件。这是进入阶段 B–E 的门槛。

**Blocked by:** 01、02、03、04、05、06、07。

**Status:** ready-for-human

- [ ] 一次运行产生 `planner_verdict` PASS，无人工 kill。
- [ ] Validator 至多委派一次；不出现「Async delegation has started」后无法等待的情况。
- [ ] ReviewResult 被记录（同步或异步均可），不出现 WorkerReport 解析错误。
- [ ] 无占位 Task；Worker 报告 taskId 与 canonical id 匹配或被识别为别名。
- [ ] 结束时工作树干净，无 lockfile 漂移。
- [ ] 每次委派均在默认地板内；纠偏 Worker（如发生）轮次不超过工具上限。
- [ ] 对照文件记录规划、实现、Validator、Reviewer 四段墙钟与子进程费用；参考值约 40 s / 2 min / 30–50 s / 70 s、约 $0.19，偏离不作为失败条件但需解释。
- [ ] 运行前执行 `slot audit` 与 `slot status` 并记录。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。需要真实模型花费，故标 ready-for-human。基线：`.scratch/kimi-timing-probe/run-2026-09-07.md`。

- 2026-09-07 phase-a-08-rerun（Planner 本 pane `slot cpu`，未派 executor）：隔离 worktree `/home/tcuni-claw/pi/pi-planner-only-phase-a-08` 加载主树 01–07 插件，自然退出 `exit_code=0`（12.0 min，无 kill）。usage `state=blocked` `rounds=3`，不是 PASS。对照：`.scratch/planner-only-cost-control/phase-a-08-run/comparison.md`。checkbox 与 Status 未动；不进入 B–E。
- 08 再跑前先做 20（snapshot 忽略 scope 外 untracked）与 21（scout 走 unbound explorer）。20 先派；21 等 20 接受后再派。
- 2026-09-07 phase-a-08-rerun-2（Planner 本 pane `slot cpu`，20/21 已接受）：新 worktree `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r2` 从 `9027d8f` 起，加载主树 01–21 插件。`exit_code=1`（2.5 min）。Root k3-256k 在 scout 返回后 403「5-hour usage limit」。scout 走 `unbound-explorer-tool_…`，无占位 `T-20260907-001`，无 Worker。对照：`.scratch/planner-only-cost-control/phase-a-08-run2/comparison.md`。checkbox 与 Status 未动；不进入 B–E。额度窗口结束后再开新树重跑，不换模型。
- 2026-09-07 phase-a-08-rerun-3（Planner 本 pane `slot cpu`；用户指示不用 k3-256k、改用 `kimi-coding/kimi-for-coding`）：新 worktree `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r3` 从 `9027d8f` 起。`exit_code=0`（8.4 min）。`usage.jsonl` `state=completed` `rounds=0` `rootModel=kimi-for-coding`。无 Placeholder、无 k3、Oracle 一次、Reviewer 两次（第一次缺身份字段被拒，第二次 pass 后 Task completed）。提交 `794a8bc`。对照：`.scratch/planner-only-cost-control/phase-a-08-run3/comparison.md`。checkbox 与 Status 未动。
- 2026-09-07 用户「下一步」：以 r3 产物作为阶段 A 门槛，进入阶段 B。仍不勾 08 checkbox、不改 Status。B 先派工单 10（换价文案），再派 09（角色模型策略）。
- 2026-09-07 phase-a-08-rerun-4（Planner 本 pane；插件为含 01–12 的脏主树，新 worktree `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r4` 从 `9027d8f` 起，票提交 `4a72dd0`）：`exit_code=0`（7.8 min，无 kill、无 k3、tracked 干净、slot 预飞已记录）。**按八条从产物核对，三条硬 FAIL，不作阶段 A 门槛：** ① 会话中 `ReviewResult` 出现 0 次、`not a valid WorkerReport` 2 次；② `Placeholder task` 2 次；③ `phase-a-08-run4/` 未写 `comparison.md`。Root 在**零 oracle、零 reviewer、`evidence: fresh (attributed 0 paths)`、WorkerReport 缺失字段被插件 normalise 成 `passed`** 的情况下自记 `planner_verdict` PASS。根因是 `reviewMode` 默认 `root`（见新票 22），会复发，不是 09–12 的路由回归。另发现失败子委派 `73bd7b92` 有 meta 但不入 `usage.jsonl`（见新票 23）。checkbox 与 Status 未动；仍以 r3 为已发生的阶段 A 门槛记录。判断细节：`/project/tmp/herdr-notes/planner-only-08-r4-judgment-2026-09-07.md`。**22 落地前不重跑 08。**
