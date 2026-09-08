# 22: 门槛级运行强制 fresh 审核，verdict 不得零 reviewer 自封

**What to build:** 现状 `task.ts` 建 Task 时 `reviewMode` 硬编码默认 `"root"`，全仓库只有 `index.ts` 的手动 slash 命令会调 `setReviewMode`；非 fresh 模式下 `review.ts` 与 `orchestrate.ts` 明确告诉 Root「Root review is active; record the verdict yourself with planner_verdict」。结果是 Root 可以在**零 oracle、零 reviewer、`attributed 0 paths`** 的情况下让 `planner_verdict` accept 通过。新增一个可开关的严格模式（建议 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1`，与既有 `PI_PLANNER_ONLY_REQUIRE_CONTRACT` 同一命名族）：开启后 Task 以 fresh 模式创建，`planner_verdict` 的 accept 必须有 reviewer 的 ReviewResult 入账、且证据归因路径非零，否则拒绝并指名缺的是什么。未开启时行为逐字不变。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] 设 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1` 时，新建 Task 的 `reviewMode` 为 `fresh`，不是 `root`。
- [x] 该模式下，没有 reviewer ReviewResult 入账时 `planner_verdict` 的 accept 被拒绝；拒绝文案指名缺的是 reviewer ReviewResult，不指向 slash 命令。
- [x] 该模式下，证据归因路径为 0（accept 回执 `evidence:` 行的 attributed paths 为 0）时 accept 被拒绝。
- [x] 该模式下 accept 成功的回执，`review mode:` 行为 `fresh`，且 `evidence:` 行的 attributed paths 大于 0。
- [x] 不设该变量时，行为与改动前逐字一致：`reviewMode` 默认 `root`、Root 可自记 verdict、既有测试不改一行即全绿。
- [x] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。

证据：2026-09-07 phase-a-08-rerun-4。同票、同 root-prompt（prompt 里写死了「After the worker returns: bounded oracle (plugin default), then plugin reviewer, then `planner_verdict`」），Root 两步全跳，直接自记 verdict 并 accept。产物核对：`/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r4/.scratch/phase-a-08-session/subagent-artifacts/` 只有 6 个 meta（scout ×1、worker ×3、delegate ×2），**没有 oracle、没有 reviewer**；会话中 `"agent":"oracle"` 与 `"agent":"reviewer"` 各 0 次、字符串 `ReviewResult` 0 次、`review mode: root` 5 次。最终 accept 回执为 `state: completed / review mode: root / decision: accept / evidence: fresh (attributed 0 paths) base 4a72dd0`。

r3 通过不是因为插件拦住了，而是那次 Root 恰好听了 prompt。所以这是门槛设计漏洞、会复发，不是 09–12 的路由回归。**在本票落地前重跑 08，有很大概率以完全相同的方式再挂一次，只是白烧一次真实模型费用。**

本票落地后重写 08 的验收条款时，把下面三条写成**独立的、可一条命令核对的** checkbox（现有 08 第三条「ReviewResult 被记录（同步或异步均可）」没规定必须由 reviewer 子代理产生，Root 自封 verdict 时字面上容易被辩成满足）：
- 运行结束后 `subagent-artifacts/` 同时存在 `*_oracle_meta.json` 与 `*_reviewer_meta.json`；
- 会话中 `ReviewResult` 出现次数 ≥ 1；
- accept 回执 `evidence:` 行的 attributed paths > 0。

「fresh reviewer 默认化」在 0.3.1 被列为非目标、0.3.2 又被判「仍次要」。本票不要求改默认值，只要求门槛级运行能强制。

round_id=claude-pD-2026-09-07-open-22-23

p10-r046 已落地（未 commit）：`task.ts` 的 `TaskStore.create` 按 `PI_PLANNER_ONLY_REQUIRE_REVIEW === "1"` 给 `fresh`，`rootVerdictRefusal` 在既有 reviewer 分支后新增 attributed 0 拒绝。Planner 独立验收 npm test / typecheck / test:e2e / git diff --check 全 0，naming PASS。

**残留（未修，需拍板）**：两条门槛都带 `task.reviewMode === "fresh"` 前置，而 `/planner-only review root` 这个 operator slash 命令仍可把 mode 改回 root，一步就把严格模式关掉且无警告。Root 模型自己拿不到 slash 命令，所以不影响 08 重跑；但「门槛级运行不可自我豁免」这句话目前只在 Root 一侧成立。要堵就是再一刀：strict 开启时 `/planner-only review root` 拒绝或至少告警。

2026-09-08（planner claude-pD）：08 的验收条款已按本票重写。**上面那段建议里有一条是错的，改 08 时已纠正**：`subagent-artifacts/` 里**不会**出现 `*_oracle_meta.json` / `*_reviewer_meta.json` 这样的文件名前缀 —— 产物按 pi 侧子代理名命名，角色到子代理名要过 `roles.ts` 的 `ROLE_AGENTS`（validator→`oracle`、reviewer/explorer→`reviewer`），且 r4 实际只落了 `worker`／`delegate`／`scout`。照文件名写会写出一条永远匹配不到的验收条件。08 改成认 meta.json 里的 `"agent"` 字段（与本票 Comments 上面那段证据用的方法一致）。同理，「会话中 `ReviewResult` 出现次数 ≥ 1」也被 08 明确拒绝采用：这个词在 reviewer 提示词与合同文本里本来就会出现，计数非零证明不了评审发生过；08 改成核对 reviewer 那个 runId 的 `_output.md` 能被 `extractReviewResult` 解出。

残留豁免口已开成工单 24，本票不再扩范围。
