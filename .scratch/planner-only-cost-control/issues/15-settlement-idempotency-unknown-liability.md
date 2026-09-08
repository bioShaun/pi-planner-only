# 15: 结算、幂等与未知负债

**What to build:** 已完成调用按宿主 Usage 结算并释放未消费预留；重复的 result、notify 或恢复事件只结算一次。确认从未启动才释放全额预留；取消请求、超时、丢失通知都不是停止证明，预留继续占用直到确认。未知 Usage 保持待结算或记为未知负债；未知价格不等于零，已配置费用上限时不能仅凭可见小计放行。token 约束独立于费用约束有效。

**Blocked by:** 14。

**Status:** 第 1、4、5 条 done（15-a，p15-r073 + planner 收尾）；第 2、3 条 ready-for-agent（15-b）

- [x] 同一 runId 的完成通知重复两次：账本只扣一次，预留只释放一次。
- [ ] 启动失败且宿主确认未启动：全额预留释放。
- [ ] 取消请求后无确认：预留保持；status 显示在途。
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
