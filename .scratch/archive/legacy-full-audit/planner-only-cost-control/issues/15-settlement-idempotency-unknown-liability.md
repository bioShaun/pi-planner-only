# 15: 结算、幂等与未知负债

**What to build:** 已完成调用按宿主 Usage 结算并释放未消费预留；重复的 result、notify 或恢复事件只结算一次。确认从未启动才释放全额预留；取消请求、超时、丢失通知都不是停止证明，预留继续占用直到确认。未知 Usage 保持待结算或记为未知负债；未知价格不等于零，已配置费用上限时不能仅凭可见小计放行。token 约束独立于费用约束有效。

**Blocked by:** 14。

**Status:** done（15-a = p15-r073，15-b = p16-r074，均经 planner 逐条复核）

- [x] 同一 runId 的完成通知重复两次：账本只扣一次，预留只释放一次。
- [x] 启动失败且宿主确认未启动：全额预留释放。
- [x] 取消请求后无确认：预留保持；status 显示在途。
- [x] 子进程 Usage 缺失：记为未知负债，配置了费用上限时下一次启动被拒绝并说明。
- [x] 子进程模型无费率但 token 已知：token 维度正常结算，费用维度记未知。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 33–35，阶段 D 决策第 4 条）。

2026-09-08（planner claude-pD 复核，p15-r073 = 15-a，cursor `w2E:pE` 落地）：
**第 1、4、5 条勾上；第 2、3 条留给 15-b。**

做法：未知的子进程消耗不再当成零，而是按**启动时授予的额度**记一笔**有界负债**，
计进 `known`，因此 14A 的启动闸门看得见它；真值到达时由 `upsertChild` 的按键替换
（`run:<runId>` 优先，其次 `call:<toolCallId>`）**替换**掉负债，不是叠加。
`types.ts` 的 `ChildUsage` 加 `tokensDebt` / `costDebtUsd`，`BudgetDimension` 加 `debt`，
`reservations.ts` 加 `grantFor(toolCallId)`，`beginDelegation` 的 `finally` 顺手把
`grantedTokens` / `grantedCostUsd` 盖到委派记录上（沿用 14A 的收敛点，不去碰五处 `delegations.set`）。

**前置洞（不修就没法做）**：`index.ts` 里的 `pendingChild` 有一处调用是
`pendingChild(record.kind, { agent, toolCallId: undefined })`（HEAD index.ts:622）。
`childKey` 对无键子项返回 `undefined`，`upsertChild` 于是**追加**而不是替换——
同一个子进程会留下两行，负债永远还不掉。本轮把 `toolCallId` 贯到三处调用点，X11 守这条。

逐条证据（全部是我在 planner pane 实跑的）：

- 第 1 条：账本半边 X3——同一 `toolCallId` 写三次（pending → 结算 → 再结算），
  `children.length` 恒为 1，`tokens.known` 停在 39000 不翻倍。
  预留半边 `p15-probe/r073-clause1-double-release.mjs`——`release` 重复调用是惰性的，
  只归还本次的额度，同 Task 里另一笔在途预留（`call-b`）不受影响。
- 第 4 条：`p15-probe/r073-clause4-gate.mjs`——4 个从未回报 Usage 的子进程，
  实测可见费用 **0**，负债 $0.52，`remaining` 为 **-$0.0200**，第 5 次启动按 `costUsd` 维度被拒。
  同一份预算把负债抹掉后（阳性对照）**同样的可见小计会被放行** `{"tokens":40000,"costUsd":0.1}`——
  那正是 15-a 关掉的洞。披露由 X1、X5、X7 守。
- 第 5 条：X2——无费率模型结算后 `tokens.known=39000`、`tokens.debt=0`，
  而 `costUsd.debt` 仍为 0.12、`unknownParts=1`。token 维度独立于费用维度生效。

**与工单原文的偏离（第 4 条，决策记在 `design-15-16-decisions.md` §B.3）**：
原文「配置了费用上限时下一次启动被拒绝」。**实现是额度耗尽才拒，不是一有负债就拒**；
负债无论是否耗尽额度都会披露。理由：按授予额度记的负债是**上界估计**，
一有负债就拒会把「授予了 4 万 token」直接等同于「花掉了 4 万 token」，
正常并发会被自己的估计卡死。代价写在这里：真实花费介于 0 和授予额度之间时，
闸门用的是保守的那一端，可能比实际更早拒绝。

**去功能审计**（执行者没做，我另做的）：把实现整体退回 HEAD、其余断言逐条置空后单独跑，
X1–X7、X9、X10 全部失败，X11 的两条也都失败——没有空转的。
X8 是否定断言，退回 HEAD 时恒真，改用它针对的变异来证：
把负债注解从「已用」挪到「剩余」后，**单独留 X8**（X7 置空）仍然失败，
说明它不是靠 X7 陪跑。

执行者提的五点，我逐条实跑核过：

1. **成立但不必改**。X11 那条字面断言确实盖不住三参数形态
   （`pendingChild(record.kind, { agent, toolCallId: undefined }, grantedDebt(record))` 它看不见），
   可它不是空转——HEAD 的 index.ts:622 **逐字**就是那个两参数形态，整体退回时它立刻失败。
   三参数形态由同块的正则断言接住（实跑：字面断言 exit=0，正则断言 exit=1）。两条各守一半，都留。
2. **只是顺序问题，不是空转**。见上面的 X8 变异审计。
3. **不成立**。我构造了 X2 接不住而 X3 接得住的变异：
   `if (index >= 0 && task.children[index].pending)`（只替换还在 pending 的行，第二次结算改成追加）。
   X2 只写两次，照样绿；X3 写三次，`children.length` 变 2 立刻失败。X3 不是 X2 的复读。
4. **成立，且本来就满足**。`assert.notEqual` 单独确实弱（记成 0 也能过），
   但它从来不是单独出现的，紧跟着的 `=== 0.0731` 才是真正的锚点。保持成对。
5. **确认是既有结构，本轮不动**。`console.log("planner-only orchestration: PASS")` 在 3715 行，
   HEAD 上它后面就已经压着 243 条断言。退出码才是权威。要清理另开工单。

`naming.test.mjs` 仍然是预期内失败（安装副本跟着 main 走，还没有 `reservations.ts`），
其余 15 个套件、typecheck、e2e 全绿。

round_id=p15-r073


2026-09-08（planner claude-pD 复核，p16-r074 = 15-b，cursor `w2E:pE` 落地）：
**第 2、3 条勾上，15 号工单整体关闭。**

**派活前实跑核出来的回归（15-a 自己带进来的）**：宿主明确回报「没启动」的委派，
15-a 照样给它记一笔**全额授予的负债**。我在 planner pane 用
`p16-probe/r074-clause2-failed-launch-debt.mjs` 实测：一个 $0.5 上限的 Task，
第一次委派正常结算掉 $0.05，第二次委派宿主回 `spawn failed: no such agent 'worker'`，
负债 $0.45 直接把额度吃满，**插件自己让 Root 做的那次重试被自己拒掉**——
错误文案写着「Fix the delegation input and re-delegate with the same TaskSpec」，
而 14 号工单第 5 条禁止重置累计值，于是官方推荐的恢复路径必然失败，Task 被永久锁死。

四条决策记在 `design-15-16-decisions.md` §B.4，摘要：

- **D1 单一分类器**：「确认未启动」只在 `handleSubagentResult` 里判一次，
  `index.ts` 通过 `orchestrator.wasConfirmedNotLaunched(toolCallId)` 查询，
  不在适配器里重抄 `isError && !runId && results.length === 0`。A1/A2 守这条。
- **D2 不记负债**：确认未启动的子进程消耗为零，不该有负债行。
- **D3 预算停机不算启动失败**：`isBudgetStop` 即便没有 runId 也**照记**负债——
  它是「跑了、被预算掐掉」，不是「没启动」。Y2、Z5 守这条。
- **D4 status 显示在途**：`  在途预留: tokens=…, 费用 $…（N 个子进程未回执）`，
  打在两行维度之后、`  Root:` 之前。Y3、Y3b、Y4、Y6 守这条。

逐条证据（全部我自己在 planner pane 实跑）：

- 第 2 条：探针修复前 GAP A 断言「重试被拒」成立；修复后**同一条断言反过来失败**
  （`r074-clause2-failed-launch-debt.mjs:115`，`actual: undefined, expected: true`），
  `r074-fixed.mjs` 通过，status 里 `已用 1500 / 上限 200000`、`已用 $0.0500 / 上限 $0.5000`、
  `未知项 0 项` 三处都稳住。
- 第 3 条两半都要冻结：**预留保持**由 Y5 守——异步错误但未确认停止时
  `reservations.inFlight(taskId)` 与调用前 `deepEqual`；**status 显示在途**由 Y6 守——
  同一场景仍打出 D4 行。取消/超时/丢通知走的都是这条未确认路径。
  另外实测 `store.abandon` **不**释放预留（`{tokens:100000, costUsd:0.5}`，held 1 保持不变），
  与第 3 条一致，不是 bug。

**空转审计**（执行者做过一遍，我另做了一遍，脚本 `p16-probe/r074-vacuity-audit.py`）：
16 条新断言逐条施加针对性变异，先失败的断言依次置空直到归因到目标行——
**16/16 全部 CAUGHT**，日志 `p16-r074-vacuity-audit.log`。
否定断言（Y2、Y4、Y7、Z5）去功能咬不动，一律改用反向变异证明：
Y2/Z5 用「无条件加入集合」、Y4 用「去掉零值判断照样打印」、Y7 用「在未确认路径上也加入集合」。
Y5 的变异（在保锁返回路径上 `endDelegation`）会先打挂两条既有写锁断言（2847、2859），
按方法置空后 Y5 归因成立。

**执行者提的 5 点，逐条裁决**：

1. **成立，是我工单的自相矛盾**。我写「集合要有界，不能无限增长（跟 `processedRunIds` 同等对待即可）」，
   而 `processedRunIds` 本身就是无上限的会话级 Set。执行者按「同等对待」实现（Set，无数值上限）是对的，
   凭空发明一个 FIFO N 才是编造。**上限要加就两个集合一起加，另开工单。**
2. **成立**。修复后 GAP B 也不再成立，但那是 D4 正常工作（重试成功后确实持有预留），不是残留 bug。
3. **成立**。`/planner-only status` 只渲染 `store.active()`，探针早先看不到 Task 段是因为启动失败把
   Task 打成 `failed`，不是 status 漏打在途。
4. **成立**，见上面第 3 条的 abandon 实测。
5. **属实**，`design-15-16-decisions.md` 的 B.4 是我写的，不是执行者的产出。

`naming.test.mjs` 仍是预期内失败（安装副本跟着 main，还没有 `reservations.ts`），
其余 15 套件、typecheck、e2e 全绿；还原工作树后我又整套重跑了一遍才提交。

round_id=p16-r074
