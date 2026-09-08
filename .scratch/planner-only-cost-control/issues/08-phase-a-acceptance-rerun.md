# 08: 阶段 A 验收：同票真实重跑一次 PASS

**What to build:** 用 2026-09-07 探测的同一张票（oracle-status-line）、同一 Root prompt、同一模型配置，在独立 worktree 上真实重跑一次 planner-only 流水线。目标是一次 PASS，且探测中出现的五类问题都不再出现。记录分段墙钟、每次委派的 turns 与费用、Validator 次数、是否 PASS，写成与探测记录同格式的对照文件。这是进入阶段 B–E 的门槛。

**Blocked by:** 01、02、03、04、05、06、07、22、23 —— **全部已落地**（23 于 2026-09-08 p10-r048 关闭，7/7）。账本一致性那条因此**不再是 not-run，是硬条件**。

**Status:** ready-for-human

运行约定（下面每条验收都按这三个路径写，`<N>` 为本次重跑序号）：`<RUN>`＝`.scratch/planner-only-cost-control/phase-a-08-run<N>`，`<LOG>`＝`<RUN>/artifacts/root-session.jsonl`，`<SA>`＝`<RUN>/artifacts/subagent-artifacts`，账本＝`<RUN>/artifacts/usage.jsonl`。子代理产物按 `<runId>_<agent>_<n>_{input,output,meta,transcript}` 命名，`agent` 是 pi 侧的子代理名 —— 角色到子代理名的映射见 `roles.ts` 的 `ROLE_AGENTS`／`AGENT_ROLES`：validator→`oracle`，reviewer/explorer→`reviewer`，worker 保留自身。**因此判断 oracle/reviewer 是否真的跑过，要认 meta.json 的 *顶层* `agent` 字段，既不要认文件名前缀，也不要用 `grep` 扫全文**（r4 只出现了 `worker`／`delegate`／`scout`；全文 grep 会命中 worker meta 里的 `acceptance.review.agent`）。**本次重跑必须带 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1` 启动**（工单 22），且运行期间不得执行 `/planner-only review root` —— 那条 operator slash 命令能一步把两道门槛一起关掉。

- [ ] 启动环境确实带了严格模式：运行日志里记下 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1`，且 `grep -c "review mode: root" <LOG>` 为 **0**、`grep -c "review mode: fresh" <LOG>` **≥ 1**。
- [ ] 一次运行产生 `planner_verdict` PASS，无人工 kill；`usage.jsonl` 末条 `state=completed`。
- [ ] **Oracle 真的跑过**：`python3 -c 'import json,glob,sys; print(sum(json.load(open(f)).get("agent") in ("oracle","validator") for f in glob.glob(sys.argv[1])))' '<SA>/*_meta.json'` **≥ 1**。
- [ ] **Reviewer 真的跑过**：`python3 -c 'import json,glob,sys; print(sum(json.load(open(f)).get("agent") in ("reviewer","explorer") for f in glob.glob(sys.argv[1])))' '<SA>/*_meta.json'` **≥ 1**。**必须读 meta 的顶层 `agent` 字段** —— 不要用 `grep -l '"agent": "reviewer"'`：worker 的 meta 里 `acceptance.review.agent` 也是 `"reviewer"`，那条命令会把每个 worker 都算成 reviewer（2026-09-08 r5 实测 11 vs 真实 4）。
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

- 2026-09-08 phase-a-08-rerun-5（Planner 本 pane `slot cpu`；**首次带 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1`**；新 worktree `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r5` 从 `9027d8f` 起，插件为主树 `0fe04df`；`.agent-dir/planner-only` 未从旧树拷贝，账本从零开始；运行期间未执行 `/planner-only review root`）：`exit_code=0`，50 分 47 秒，无 kill。**十四条逐条判：8 pass、5 fail、1 pass 有保留 → 整轮 FAIL。** 对照：`phase-a-08-run5/comparison.md`；命令原始输出：`phase-a-08-run5/judgment-raw.txt`。checkbox 与 Status 未动。

  | 条款 | 判定 | 实测 |
  |---|---|---|
  | 1 严格模式 / review mode | **pass** | `env.txt` 有 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1`；`review mode: root` = 0，`review mode: fresh` = 2 |
  | 2 PASS 且末条 completed | **fail** | 末条 `state=blocked` `rounds=2`，全程无 `planner_verdict` PASS |
  | 3 oracle 真的跑过 | **pass** | 6 次（按 meta 顶层 `agent` 字段） |
  | 4 reviewer 真的跑过 | **pass** | 4 次（同上）。**票面命令输出 11，是过计数 —— 见下** |
  | 5 ReviewResult 由 reviewer 产出 | **pass** | `0f57e0c8_reviewer_output.md` 是单个 JSON，含 `"verdict":"pass"` 与 `"findings"`，可被 `extractReviewResult` 解出 |
  | 6 证据归因 > 0 | **fail** | `attributed [0-9]* path` 匹配 **0 次**（从未走到 accept 回执） |
  | 7 无占位 Task | **fail** | `grep -c 'Placeholder task'` = **16**（r4 是 2） |
  | 8 无 WorkerReport 解析错误 | **fail** | `grep -c 'not a valid WorkerReport'` = **6**（r4 是 2） |
  | 9 Validator 至多一次 | **fail** | oracle 委派 **6 次**；`Async delegation has started` = 0，无「起了等不到」的情况 |
  | 10 工作树干净 | **pass** | 只剩 `?? .agent-dir/`、`?? .scratch/oracle-status-line/`、`?? .scratch/phase-a-08-session/` |
  | 11 委派在默认地板内 | **pass（有保留）** | 18 个子代理费用全部 ≪ `costUsd.hard=0.5` 地板；但两次 worker 与一次 oracle 跑到 22／16 turns，纠偏轮次偏高，随 27/28 一并复看 |
  | 12 对照文件写出 | **pass** | `phase-a-08-run5/comparison.md`（本轮由 planner 补写） |
  | 13 slot 预飞记录 | **pass** | `phase-a-08-run5/slot-preflight.txt`；审计发现绕过 slot 的 PID 3028125／`postsort`（3.5G），按规则未终止 |
  | 14 账本一致性（硬条件） | **fail** | ledger 8 个 runId vs meta 18 个，差集 10 个，漏记 **$0.27450360 / 35.1%**（r4 是 30.1%） |

  **22 达成了它的目标**：`review mode: root` 归零，oracle 与 reviewer 都真的跑了，Root 再也不能在零 oracle 零 reviewer 下自签 PASS —— r4 的三条硬 FAIL 里前两条不复现。代价是把一条原本被自封 PASS 掩盖的死锁暴露成显性失败。

  **四条新缺陷已开票，全部阻塞 08 第六次重跑：**
  - **27（最高优先）** reviewer 输出合同（`review.ts:145-152`）不含 `reportRevision`／`workspaceDigest`，而 `validateReviewResultBinding`（`review.ts:199-209`）对 pass 硬性要求这两个字段 —— **照合同办事的 reviewer 永远产不出可记录的 PASS**。严格模式把默认切成 fresh 后与 `rootVerdictRefusal` 咬死，Task 只能 blocked。单元测试全绿是因为 fixture 注入了这两个字段（测试里 `reportRevision` 出现 15 次）。
  - **28** worker 合同没写 `validation` 元素形状（`workerReportShapeReminder` 只写 `"validation":[]`，校验却要求元素是对象），且提取器用「错误最少」挑候选，把报错归给了同一份输出里的不相干小对象 —— 对外那句 `status must be one of …` 不是真报告的问题（条款 8 的直接成因）。**初版工单照抄这句假报错，把成因写反了，2026-09-08 派活前实跑 `extractWorkerReport` 才纠正；详见 28 的 Comments 与 `comparison.md` 根因三。**
  - **29** oracle 子代理**从不入账**（5 条账本记录里 children 只有 worker 与 reviewer，$0.25224 全部丢失），且进程退出时无兜底落账（最后一次落账后又跑了 7 个子代理，$0.02227 丢失）。条款 14 的直接成因，与 23 不是同一个洞。
  - **30** 严格模式下无 TaskSpec 的委派应被拒绝而非造占位 Task（条款 7 的直接成因；工单 03 的占位路径是有意设计，不冲突）。

  **本票自身的条款缺陷（未擅自修改，待授权）：** 条款 4 的字面命令 `grep -l '"agent": "\(reviewer\|explorer\)"' <SA>/*_meta.json | wc -l` 会**过计数** —— worker 的 `_meta.json` 里 `acceptance.review.agent` 也是 `"reviewer"`，于是 7 个 worker meta 全部命中，输出 11 而非真实的 4。条款 3 的 oracle 命令碰巧不受影响（没有同名嵌套键），但同样脆弱。判定结论不受影响（4 ≥ 1 与 11 ≥ 1 都 pass），但这条命令不可用于将来的「至多一次」类判定。建议改为读 meta **顶层** `agent` 字段（如 `python3 -c` 或 `jq -r .agent`），改法需授权后落成带日期的注记。

round_id=claude-pD-2026-09-08-judge-08-r5

- 2026-09-08 条款 3／4 命令修正（planner claude-pD，用户授权「按推荐处理」）：两条命令由 `grep -l '"agent": "..."' <SA>/*_meta.json | wc -l` 改为读 meta **顶层** `agent` 字段的 `python3 -c`，并在条款 4 与运行约定段落写明为什么不能用全文 grep。原因：worker 的 `_meta.json` 里 `acceptance.review.agent` 也是 `"reviewer"`，全文 grep 把每个 worker 都算成 reviewer。改后对两批真实产物回验：r5 得 oracle **6** / reviewer **4**（旧命令分别是 6 / **11**），r4 得 **0 / 0**（r4 正是因为零 oracle 零 reviewer 判 FAIL）。两个方向都对，命令现在可用于「至多一次」这类计数判定。**只改命令，不改门槛语义（仍是 ≥ 1），checkbox 与 Status 未动。** 备份 `08-phase-a-acceptance-rerun.md.bak-20260908d`。

- 2026-09-08 关于 r5 worker 自行提交 `e4769de`：**不是缺陷，不开票。** 本次运行的 Root prompt `.scratch/oracle-status-line/root-prompt.md:12` 逐字授权：「Worker may commit on the current branch `kimi-timing-probe`. Do not push. Leave `.scratch/` untracked.」worker 提交了、没有推、`.scratch/` 保持 untracked，三条都守住了。分支 `phase-a-08-rerun-5` 连同该提交作为证据保留，不合并、不推送。附带记下一个 run 夹具的小瑕疵：该行写死的分支名 `kimi-timing-probe` 是从最初探测带过来的，与 r3/r4/r5 实际所在分支都不一致；本轮没造成误操作，但将来重跑前值得把它改成不指名分支的说法。

- 2026-09-08 费用口径补充（用户指示「主模型按 5× 价格」，口径已于同日澄清）：**只把 root 的主模型单价 ×5，children 照实测不动** —— 平时 root 坐 opus 这类贵模型，子代理本就跑便宜模型，这个不对称正是本插件要省的钱。r5 实测 $0.78194 → 5× 口径 **$1.17838**（root $0.09911→$0.49555，children $0.68283 不变）；r4 同口径 $0.29582 → $0.51697；参考值 ~$0.19 → ~$0.29，即 r5 约为参考的 4 倍。明细见 `phase-a-08-run5/comparison.md`「按主模型 5× 定价复算」一节。**14 条判定一条没变**，但两点必须读对：① root 占比从 12.7% 升到 **42.1%**，r5 光 root 那 12 个 turn 就 $0.50，比参考轮整轮还贵 —— 主模型越贵，工单 27 那个「Root 反复重派、每次被同一道校验挡回」的死锁越烧钱；② C14 里漏记比例看着从 35.1% 降到 23.3%，那只是 root 单价把分母撑大，缺口（oracle 从不入账 $0.25224 + 末次落账后 7 个子代理丢失 $0.02227）一分没少，**不得据此宣称账本变准**。

round_id=claude-pD-2026-09-08-fix-08-clauses

- 2026-09-08 phase-a-08-rerun-6（Planner 本 pane `slot cpu`；带 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1`；新 worktree `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r6` 从 `9027d8f` 起，插件为主树 `0158a1b`（27/28/29/30/33/34/35 全部已闭合）；Root prompt 与 r5 逐字节相同；`.agent-dir/planner-only` 从零开始；运行期间未执行 `/planner-only review root`）：`exit_code=0`，**7 分 23 秒**，无 kill。**十四条逐条判：14 pass → 整轮 PASS。** 对照：`phase-a-08-run6/comparison.md`；命令原始输出：`phase-a-08-run6/judge-out.txt`。**checkbox 与 Status 未动，等用户决定是否据此关票并进入阶段 B–E。**

  | 条款 | 判定 | 实测 |
  |---|---|---|
  | 1 严格模式 / review mode | **pass** | `review mode: root` = 0，`review mode: fresh` = 2 |
  | 2 PASS 且账本 completed | **pass** | Task 行 `state=completed` `rounds=0`；accept 回执 `decision: accept` / `[FRESH REVIEWER] verdict: pass`；Root 的 `planner_verdict{pass}` 被按设计 `refused: lifecycle`。字面「末条」已失效，见下 |
  | 3 oracle 真的跑过 | **pass** | 顶层 `agent` 计数 = 1 |
  | 4 reviewer 真的跑过 | **pass** | 顶层 `agent` 计数 = 1 |
  | 5 ReviewResult 由 reviewer 产出 | **pass** | 用 `review.ts` 的 `extractReviewResult` 实跑解析 `2b609a71_reviewer_0_output.md`，解出 `verdict:"pass"`、`findings:[]` |
  | 6 证据归因 > 0 | **pass** | `attributed 2 path` |
  | 7 无占位 Task | **pass** | 0（r5 是 16）；两次无效 worker 委派被工单 30 当场拒收 |
  | 8 无 WorkerReport 解析错误 | **pass** | 0（r5 是 6） |
  | 9 Validator 至多一次 / 异步能等到 | **pass** | oracle 1 次；scout 异步委派被 `bg_wait id=1fd32313…` 等到。**票面字面串恒为 0，是假阴性，见下** |
  | 10 工作树干净 | **pass** | 只剩三个预期 untracked |
  | 11 委派在默认地板内 | **pass** | 四个子代理全部未触顶、无 budget stop、`exitCode` 全 0；最大 12 turns（r5 曾 22） |
  | 12 对照文件写出 | **pass** | `phase-a-08-run6/comparison.md` |
  | 13 slot 预飞记录 | **pass** | `slot-preflight.txt`；审计发现绕过 slot 的 PID 3917509／`pbbwa`（48.6G），按规则未终止 |
  | 14 账本一致性（硬条件） | **pass** | ledger 4 runId = meta 4 runId，差集双向为空，**漏记 $0.00000000**（r5 漏 35.1%、r4 漏 30.1%） |

  **费用与墙钟：** 实测 $0.15628（root $0.01570 ＋ children $0.14058），**主模型 5× 口径 $0.21907**（root $0.07848，占 35.8%），均**低于参考值**（~$0.19 → 5× 约 ~$0.29）。总墙钟 7 分 23 秒，参考 ~8 min。r5 → r6：实测降到 1/5.0，5× 口径降到 1/5.4。分段：规划 173 s（含 scout 83 s ＋ 两次被拒委派）、worker 93 s、oracle 87 s、reviewer 43 s、收尾 15 s。

  **四张阻塞票的效果在真实运行里都看得见：** ① 30 —— 前两次 worker 委派分别以「无 TaskSpec」「scope 非对象」被拒，Root 第三次才带上合法 TaskSpec，占位 Task 归零；② 27 —— reviewer 交回的 ReviewResult **不含** `reportRevision`／`workspaceDigest` 仍被记录并完成 Task，r5 的死锁不再复现；③ 29 —— oracle 这次进了账本；④ 35 —— 进程退出兜底落账写出第二行 `unattributed` 快照（`finishedAt` 正是进程结束时刻），把 scout 那 $0.03440 捞了回来，这是账本零漏记的最后一块。

  **本票条款缺陷（未擅自修改，待授权）：** ① 条款 2 的「`usage.jsonl` 末条 `state=completed`」被工单 35 淘汰 —— 退出兜底会追加一行 `unattributed` 快照，末条不再是 Task 行（照字面跑会 `KeyError: 'state'`）；同条「一次运行产生 `planner_verdict` PASS」也被 22／24 淘汰 —— fresh reviewer 的 PASS 才是完成动作，Root 随后的 verdict 会被按设计拒收。建议改为「该 Task 的账本记录 `state=completed`，允许并存 `unattributed:true` 的兜底行」＋「产生一次被记录的 PASS verdict（fresh reviewer accept，或无 reviewer 可仲裁时的 `planner_verdict`）」。② 条款 9 的字面串 `Async delegation has started` 与真实回执 `Async delegation for task <id> has started (runId: …)` 对不上，grep 恒为 0（本轮 0 是假阴性，实际有 1 次并被等到）；建议改成 `grep -o 'Async delegation for task [^ ]* has started'` ＋ `grep -o 'bg_wait id=[0-9a-f-]*'`。两处只在 `judge.sh` 里按语义修正并加了注释，**票面一个字未动**。备份 `08-phase-a-acceptance-rerun.md.bak-20260908e`。

round_id=claude-pD-2026-09-08-judge-08-r6
