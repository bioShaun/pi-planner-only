# 37: 一个 Task 的第一次委派完全绕过累计预算闸门

**What to build:** 创建 Task 的那次委派必须和后续委派一样，先过 14A 的检查—预留，
再把余额并进该子进程的 per-call `usageBudget.hard`。

**Blocked by:** 14、15（已 done）。

**Status:** ready-for-agent（改法已定稿，见 design-15-16-decisions.md §E；派工前欠一次形状核验）

- [ ] 第一次委派会预留额度，status 的 `在途预留` 行看得见它。
- [ ] 第一次委派拿到的 `usageBudget.hard` 受累计余额约束，不会超过 Task 的整份预算。
- [ ] 第一次委派拿到 grant，因此它的 Usage 缺失时按工单 15 记有界负债。
- [ ] 已存在的 Task（`task start` 建的、或将来回放恢复的）行为不变。

## Comments

2026-09-08（planner claude-pD，实跑发现，探针 `p16-probe/r075-first-delegation-ungated.mjs`）：

`beginDelegationInner` 里那段检查—预留的入口条件是 `budgetTask = target?.task`
（`orchestrate.ts:727-733`）。但**创建 Task 的那次委派，走到这一行时 store 里还没有这条记录**——
记录要到 `orchestrate.ts:1000/1005` 的 `store.create()` 才出现。于是整段被跳过：
不检查、不预留、不盖 grant，`resolveEffectiveLimits` 也拿不到 `balanceTokens/balanceCostUsd`。

实测（`cumulativeBudget: { tokens: 200000, costUsd: 0.05 }`）：

```
usageBudget handed to call-first:  {"tokens":{"hard":100000},"costUsd":{"hard":0.5}}
first delegation blocked? no
在途预留 present after 1st? false
usageBudget handed to call-second: {"tokens":{"hard":100000},"costUsd":{"hard":0.5}}
second delegation blocked? YES: Planner-only guard: task T-20260908-902 cumulative budget exhausted (costUsd).
```

**第一个子进程拿到的单次硬上限是 $0.50，而整个 Task 的累计预算是 $0.05——十倍。**
闸门要到第二次委派才开始工作。对**只委派一次**的 Task（最常见的形态），
`cumulativeBudget` 等于完全没生效。

另有两个次生后果：

- 第一个子进程没有 grant，Usage 缺失时 `grantedDebt` 返回 `{}`，工单 15 的有界负债对它是空的
  （实测：错误形状的 usage 被记成「费用未知 1 项」，金额 0）。
- D4 的 `在途预留` 行对它不显示，用户看不到这笔在途。

**改法已定稿**：方案 B′，写在 `design-15-16-decisions.md` §E。要点：

- 预留点不动，补上 `target?.task` 为空时用 `targetSpec.cumulativeBudget` + 空 usage 现算 budget 的分支；
- 加 `BudgetReservations.rekey(from, to, toolCallId)`，在 `shouldReplaceTaskId` 分支
  `store.create(storedSpec, spec.taskId)` 之后改键——否则预留会挂到别名上永久泄漏，
  且 `inFlight(真 taskId)` 看不见它，比不预留更糟。

**工单初稿里的方案 C 描述是错的，已在 §E.2 更正**：`beginDelegation` 就是 `tool_call` 钩子，
建完 Task 再预留仍然是启动前。但 C 有另一个真问题——`orchestrate.ts` 的 828、886、936
是**成功启动**的早退路径，走不到 `ensureCwd`，整段往后挪会把它们现有的预留弄丢。

派工前还欠一次实跑核验：`summarizeTaskBudget(emptyTaskUsage(), cumulativeBudget)`
的形状与既有调用一致（`limit` 有值、`known` 为 0）。**没核之前不许派。**
