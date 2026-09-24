# 24: 严格模式下不得一条 slash 命令关掉门槛

**What to build:** 工单 22 落地后，`PI_PLANNER_ONLY_REQUIRE_REVIEW=1` 会让新建 Task 以 `fresh` 模式创建，`rootVerdictRefusal` 的两条严格拒绝（缺 reviewer ReviewResult、`attributed 0 paths`）也随之生效。但这两条拒绝都带 `task.reviewMode === "fresh"` 前置，而 `index.ts:1073` 的 `/planner-only review root` 会直接 `store.setReviewMode(taskId, "root")`，`task.ts:593` 的 `setReviewMode` 对严格模式没有任何判断。**一条 slash 命令就把两道门槛一起关掉，且回执只说 `Review mode for <id> set to root.`，不提这一步的后果。** 要求：严格模式开启时，`/planner-only review root` 要么直接拒绝并说明原因，要么必须显式确认并在回执中写明「严格模式的两条 accept 门槛已因此失效」。未开启严格模式时，该命令行为逐字不变。

**Blocked by:** 22（已落地，源码在 `cd717aa`）。

**Status:** done

- [x] 设 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1` 时，`/planner-only review root` 不会静默把 `reviewMode` 改成 `root`：要么拒绝、要么回执中明确写出「reviewer ReviewResult 与 attributed>0 两条 accept 门槛已失效」。
- [x] 承接上一条：若采用「拒绝」方案，`reviewMode` 保持 `fresh`，且拒绝文案指名是严格模式所致、给出关闭严格模式的方式（取消环境变量），不指向别的 slash 命令。
- [x] 严格模式下 `/planner-only review fresh` 仍然可用且行为不变（把已被改回 root 的历史 Task 拉回 fresh 不应被误伤）。
- [x] 不设该环境变量时，`/planner-only review root|fresh` 与改动前逐字一致，既有测试不改一行即全绿。
- [x] `/planner-only review pass|request_changes|blocked` 这条 operator 一次性 verdict 覆盖**不在本票范围**：它是有意设计、且已经会在回执里出声（见 `index.ts` 那段注释）。本票只管持久性的 mode 翻转。
- [x] 不勾 08/13/22/23 checkbox、不改它们的 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策，与工单 22 同源）。

来源：工单 22 落地轮 `p10-r046` 的 planner 独立验收（2026-09-08）。22 的目标是「门槛级运行不可自我豁免」，落地后这句话只在 **Root 模型一侧**成立 —— Root 拿不到 slash 命令，所以 08 重跑不受影响；但 operator 一侧仍是一步关掉，且无警告。

威胁模型要写准，不要在实现里过度宣称：**Root 模型自己不能执行 slash 命令**，这不是「Root 能自我豁免」的洞。真实风险是 operator 在不知道后果的情况下（或被会话里的文本说服）敲了 `/planner-only review root`，此后该 Task 的所有 `planner_verdict` accept 都不再受门槛约束，而且没有任何地方再提醒过这件事。

优先级：低于 23，不阻塞 08 重跑 —— 08 的验收条款已明令「运行期间不得执行 `/planner-only review root`」，用流程堵住了这一轮。本票是把流程约束变成代码约束。

round_id=claude-pD-2026-09-08-open-24

2026-09-08 p11-r050（executor pi `w2E:pG`，planner claude-pD 独立复验）：**六条全勾，本票关闭。** 方案取「拒绝」，不取「确认+告警」—— 一道能被一步绕过的门槛不是门槛，而环境变量本来就是设计好的关闭方式。

落点只有一处，`index.ts:1084-1087`：在 `sub === "root" || sub === "fresh"` 分支最前面插一个前置判断，`sub === "root"` 且 `PI_PLANNER_ONLY_REQUIRE_REVIEW === "1"` 时直接 `notify(..., "warning")` 后 `return`，**不调用** `store.setReviewMode`。`task.ts` 的 `setReviewMode` 一个字没动 —— 它是数据结构方法，策略塞进 store 会污染语义，而且全仓库只有这一个调用点，在边界拦截就够。

拒绝文案原文：

> Strict mode (PI_PLANNER_ONLY_REQUIRE_REVIEW=1) refuses review mode root: accept requires a reviewer ReviewResult and evidence attribution must have > 0 paths. The only way to disable strict mode is to unset PI_PLANNER_ONLY_REQUIRE_REVIEW and restart the session.

三条要素齐：点名环境变量、说清被保护的是哪两条 accept 门槛、给出唯一关闭方式且不指向任何别的 slash 命令。

测试 `index.test.mjs:1296-1342`（纯新增，全树 105 增 0 删，既有测试一行未改）：严格模式下 `review root` 被拒后，**从 `task` 回执读回 `Review mode: fresh`** 证明存储字段确实没变（`orchestrate.ts:1090` 渲染的是 `task.reviewMode`）—— 不拿拒绝文案自证，这是本票最容易糊弄过去的地方；严格模式下 `review fresh` 仍正常置为 fresh；不设变量时 `review root` 回执与改动前逐字一致。两个用例都用 `finally` 恢复环境变量，不污染同文件后续用例。

第 5 条（`review pass|request_changes|blocked` 的 operator 一次性 verdict 覆盖）按票面判**不在范围**，实现未触碰：它是有意设计且已在回执里出声。

Planner 独立复验（`slot cpu`，日志 `p11-r050-planner-verify.log`，预飞 `p11-r050-planner-slot-audit.log`／`-slot-status.log`）：`npm test=0`、`npm run typecheck=0`、`npm run test:e2e=0`、`git diff --check=0`，17 个 suite 全 PASS。`index.ts` 本轮净增 4 行（r049 时 103 → 现在 107），与拒绝分支的规模吻合，本轮没有顺手改动别处。

至此工单 22 说的「门槛级运行不可自我豁免」在 Root 与 operator **两侧**都成立。

round_id=p11-r050
