# 08: 阶段 A 验收：同票真实重跑一次 PASS

**What to build:** 用 2026-09-07 探测的同一张票（oracle-status-line）、同一 Root prompt、同一模型配置，在独立 worktree 上真实重跑一次 planner-only 流水线。目标是一次 PASS，且探测中出现的五类问题都不再出现。记录分段墙钟、每次委派的 turns 与费用、Validator 次数、是否 PASS，写成与探测记录同格式的对照文件。这是进入阶段 B–E 的门槛。

**Blocked by:** 01、02、03、04、05、06、07、22、23 —— **全部已落地**（23 于 2026-09-08 p10-r048 关闭，7/7）。账本一致性那条因此**不再是 not-run，是硬条件**。

**Status:** ready-for-human

运行约定（下面每条验收都按这三个路径写，`<N>` 为本次重跑序号）：`<RUN>`＝`.scratch/planner-only-cost-control/phase-a-08-run<N>`，`<LOG>`＝`<RUN>/artifacts/root-session.jsonl`，`<SA>`＝`<RUN>/artifacts/subagent-artifacts`，账本＝`<RUN>/artifacts/usage.jsonl`。子代理产物按 `<runId>_<agent>_<n>_{input,output,meta,transcript}` 命名，`agent` 是 pi 侧的子代理名 —— 角色到子代理名的映射见 `roles.ts` 的 `ROLE_AGENTS`／`AGENT_ROLES`：validator→`oracle`，reviewer/explorer→`reviewer`，worker 保留自身。**因此判断 oracle/reviewer 是否真的跑过，要认 meta.json 里的 `"agent"` 字段，不要认文件名前缀**（r4 只出现了 `worker`／`delegate`／`scout`）。**本次重跑必须带 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1` 启动**（工单 22），且运行期间不得执行 `/planner-only review root` —— 那条 operator slash 命令能一步把两道门槛一起关掉。

- [ ] 启动环境确实带了严格模式：运行日志里记下 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1`，且 `grep -c "review mode: root" <LOG>` 为 **0**、`grep -c "review mode: fresh" <LOG>` **≥ 1**。
- [ ] 一次运行产生 `planner_verdict` PASS，无人工 kill；`usage.jsonl` 末条 `state=completed`。
- [ ] **Oracle 真的跑过**：`grep -l '"agent": "\(oracle\|validator\)"' <SA>/*_meta.json | wc -l` **≥ 1**。
- [ ] **Reviewer 真的跑过**：`grep -l '"agent": "\(reviewer\|explorer\)"' <SA>/*_meta.json | wc -l` **≥ 1**。
- [ ] **ReviewResult 真的由 reviewer 子代理产出**：上一条命中的 runId，其 `<SA>/<runId>_*_output.md` 能被 `review.ts` 的 `extractReviewResult` 解出（人工核对时看该文件里有 `"verdict"` 与 `"findings"` 字段即可）。**不接受在 `<LOG>` 里 `grep -c ReviewResult`** —— 这个词在 reviewer 提示词与合同文本里本来就会出现，计数不为零证明不了任何评审发生过；旧条款「ReviewResult 被记录（同步或异步均可）」正是败在这里，r4 里 Root 自封 verdict 时字面上能辩成满足。
- [ ] **证据归因非零**：accept 回执 `evidence:` 行的 attributed paths **> 0**；取值 `grep -o "attributed [0-9]* path" <LOG> | tail -1`。
- [ ] 无占位 Task：`grep -c "Placeholder task" <LOG>` 为 **0**；Worker 报告 taskId 与 canonical id 匹配或被识别为别名。
- [ ] 无 WorkerReport 解析错误：`grep -c "not a valid WorkerReport" <LOG>` 为 **0**。
- [ ] Validator 至多委派一次；不出现「Async delegation has started」后无法等待的情况。
- [ ] 结束时工作树干净，无 lockfile 漂移（`git status --porcelain` 只剩本次运行的预期产物）。
- [ ] 每次委派均在默认地板内；纠偏 Worker（如发生）轮次不超过工具上限。
- [ ] **对照文件必须写出**：`test -f .scratch/planner-only-cost-control/phase-a-08-run<N>/comparison.md`。内容记录规划、实现、Validator、Reviewer 四段墙钟与子进程费用；参考值约 40 s / 2 min / 30–50 s / 70 s、约 $0.19，偏离不作为失败条件但需解释。
- [ ] 运行前执行 `slot audit` 与 `slot status` 并记录。
- [ ] 账本一致性（**硬条件**，23 已落地）：`usage.jsonl` 末条 children 的 runId 集合与 `<SA>` 中 `*_meta.json` 的 runId 集合**相等**。差集非空即本条 fail，且须把差集与漏记金额写进对照文件。scout／unbound explorer 那笔现在也必须在集合里 —— 23 关闭前它会掉进一个永远不写出的合成 taskId，正是本条要盯的。

判定规则：以上每条**分别**判 pass / fail / not-run，任一条 fail 即整轮 FAIL，不做整体印象判断。上面九条带命令的条款必须贴出实际命令输出，不接受「已确认」。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。需要真实模型花费，故标 ready-for-human。基线：`.scratch/kimi-timing-probe/run-2026-09-07.md`。

- 2026-09-07 phase-a-08-rerun（Planner 本 pane `slot cpu`，未派 executor）：隔离 worktree `/home/tcuni-claw/pi/pi-planner-only-phase-a-08` 加载主树 01–07 插件，自然退出 `exit_code=0`（12.0 min，无 kill）。usage `state=blocked` `rounds=3`，不是 PASS。对照：`.scratch/planner-only-cost-control/phase-a-08-run/comparison.md`。checkbox 与 Status 未动；不进入 B–E。
- 08 再跑前先做 20（snapshot 忽略 scope 外 untracked）与 21（scout 走 unbound explorer）。20 先派；21 等 20 接受后再派。
- 2026-09-07 phase-a-08-rerun-2（Planner 本 pane `slot cpu`，20/21 已接受）：新 worktree `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r2` 从 `9027d8f` 起，加载主树 01–21 插件。`exit_code=1`（2.5 min）。Root k3-256k 在 scout 返回后 403「5-hour usage limit」。scout 走 `unbound-explorer-tool_…`，无占位 `T-20260907-001`，无 Worker。对照：`.scratch/planner-only-cost-control/phase-a-08-run2/comparison.md`。checkbox 与 Status 未动；不进入 B–E。额度窗口结束后再开新树重跑，不换模型。
- 2026-09-07 phase-a-08-rerun-3（Planner 本 pane `slot cpu`；用户指示不用 k3-256k、改用 `kimi-coding/kimi-for-coding`）：新 worktree `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r3` 从 `9027d8f` 起。`exit_code=0`（8.4 min）。`usage.jsonl` `state=completed` `rounds=0` `rootModel=kimi-for-coding`。无 Placeholder、无 k3、Oracle 一次、Reviewer 两次（第一次缺身份字段被拒，第二次 pass 后 Task completed）。提交 `794a8bc`。对照：`.scratch/planner-only-cost-control/phase-a-08-run3/comparison.md`。checkbox 与 Status 未动。
- 2026-09-07 用户「下一步」：以 r3 产物作为阶段 A 门槛，进入阶段 B。仍不勾 08 checkbox、不改 Status。B 先派工单 10（换价文案），再派 09（角色模型策略）。
- 2026-09-07 phase-a-08-rerun-4（Planner 本 pane；插件为含 01–12 的脏主树，新 worktree `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r4` 从 `9027d8f` 起，票提交 `4a72dd0`）：`exit_code=0`（7.8 min，无 kill、无 k3、tracked 干净、slot 预飞已记录）。**按八条从产物核对，三条硬 FAIL，不作阶段 A 门槛：** ① 会话中 `ReviewResult` 出现 0 次、`not a valid WorkerReport` 2 次；② `Placeholder task` 2 次；③ `phase-a-08-run4/` 未写 `comparison.md`。Root 在**零 oracle、零 reviewer、`evidence: fresh (attributed 0 paths)`、WorkerReport 缺失字段被插件 normalise 成 `passed`** 的情况下自记 `planner_verdict` PASS。根因是 `reviewMode` 默认 `root`（见新票 22），会复发，不是 09–12 的路由回归。另发现失败子委派 `73bd7b92` 有 meta 但不入 `usage.jsonl`（见新票 23）。checkbox 与 Status 未动；仍以 r3 为已发生的阶段 A 门槛记录。判断细节：`/project/tmp/herdr-notes/planner-only-08-r4-judgment-2026-09-07.md`。**22 落地前不重跑 08。**

- 2026-09-08 验收条款重写（planner claude-pD；工单 22 已落地，源码在 `cd717aa`，分支 `planner-only-cost-control`）：旧的八条改成十四条可逐条核对的条款，其中九条带字面命令。改动要点：① 旧第三条「ReviewResult 被记录（同步或异步均可）」拆成三条独立门槛 —— oracle 子代理真的跑过、reviewer 子代理真的跑过、ReviewResult 真的由那个 reviewer 的 `_output.md` 产出。旧写法没规定 ReviewResult 必须由 reviewer 子代理产生，r4 里 Root 自封 verdict 时字面上能辩成满足。② 前两条按 meta.json 的 `"agent"` 字段判，不按文件名前缀 —— 角色到子代理名要过 `roles.ts` 的 `ROLE_AGENTS`（validator→`oracle`，reviewer/explorer→`reviewer`），照文件名写 `*_oracle_*_meta.json` 会写出一条实际匹配不到的条款。③ 第三条明写**不接受** `grep -c ReviewResult`：这个词在 reviewer 提示词和合同文本里本来就出现，计数非零证明不了评审发生过。④ 新增「证据归因 > 0」与「review mode 必须 fresh、root 计数为 0」两条，直接对着 r4 那张 `review mode: root / evidence: fresh (attributed 0 paths)` 的回执写；receipt 字面量已对源码核过（`orchestrate.ts:1063` / `evidence.ts:785`）。⑤ 重跑必须带 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1`，且明令运行期间不得执行 `/planner-only review root`（工单 22 的残留豁免口）。⑥ `Placeholder task`、`not a valid WorkerReport`、`comparison.md` 三个 r4 实际踩到的坑各给一条计数式条款，字面量已对 `orchestrate.ts:1554/1969` 核过。⑦ 增加账本一致性条款；23 未落地时记 not-run，但差集与漏记金额仍要写进对照文件。⑧ Blocked by 加 22。checkbox 未勾，Status 仍 ready-for-human。

round_id=claude-pD-2026-09-08-rewrite-08
