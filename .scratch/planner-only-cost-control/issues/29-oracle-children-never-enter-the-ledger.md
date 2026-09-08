# 29: oracle 子代理从不入账，且进程退出时无兜底落账

**What to build:** 两个互相独立的账本缺口，都在 08 第五次重跑里量到了。

**(a) oracle 子代理一次都没进过 `usage.jsonl`。** run5 五条账本记录里 children 的 `(kind, agent)` 分布是 `{('worker','worker'): 22, ('reviewer','reviewer'): 3}` —— oracle 从未出现。不是时序问题：`588268d7` 与 `b288025c` 在第一次落账之前就结束了，仍然不在里面。6 次 oracle 委派花掉 **$0.25224**，账本认为它们不存在。

**根因已定位（2026-09-08 planner 读源码核实，不是猜）：`orchestrate.ts:757-778` 的「未绑定 validator」分支给委派记的 `taskId` 是占位串 `unbound-validator-${event.toolCallId}`，且**没有**设 `accountingTaskId`。** 而 `index.ts:452` 的 `accountingTaskId(record)` 返回的是 `record.accountingTaskId ?? record.taskId` —— 于是这些 oracle 的费用被记到一个**store 里根本不存在的幽灵 Task** 上，永远不会写进真实 Task 的 `usage.jsonl`。实测佐证：run5 的 `usage.jsonl` 五条记录 taskId 全是 `T-20260908-001`，全文 `grep -c unbound-validator` 为 **0**，钱既不在真 Task 里、也没单独落一条。

**同一个坑 explorer 已经填过了。** `orchestrate.ts:917-921` 的未绑定 explorer 分支注释写着「mirror the unbound-validator placeholder」，但它多写了一行 `...(accountingTask ? { accountingTaskId: accountingTask.taskId } : {})`，用 `this.store.activeForCwd(cwd) ?? active` 把费用挂回真实 Task。`index.ts:451` 那行注释「Child usage belongs to the real active Task when explorer behavior remains unbound」说的就是这个机制 —— **validator 漏了这一行。**

为什么 r5 六次 oracle 全走了未绑定分支：Root 从未嵌入 TaskSpec（工单 30），委派里没有 Task 可绑，`reviewed` 为空，直接落进 `if (!reviewed)`。所以 30 未修之前，这条路径会一直被走到。

**(b) 最后一次落账之后跑的子代理全部丢失。** 账本最后一条写于 `01:09:36Z`，进程跑到 `01:30:33Z`。这 21 分钟里又跑了 7 个子代理（$0.02227），因为 Task 再没进入终态，`flushIfTerminal` 再没触发，**进程退出时也没有任何兜底落账**。

要求：oracle／validator 角色的子代理与 worker、reviewer 同等入账（**最小改法就是给未绑定 validator 分支补上 explorer 已有的那行 `accountingTaskId`，但要自己判断 `store.activeForCwd(cwd) ?? active` 在 validator 语义下是否也成立，并说明理由**）；会话结束时无论 Task 处于什么状态都写出一条最终账本记录（可以带明确的非终态标记），使「meta 里有的 runId，账本里都有」成为可检查的不变量。

**Blocked by:** None（源码在 `0fe04df`）。

**Status:** ready-for-agent

- [ ] 一次含 oracle 委派的运行结束后，`usage.jsonl` 末条 children 里出现该 oracle 的 runId 与 costUsd。
- [ ] **未绑定 validator（委派没有指名任何 Task）的费用挂到真实活动 Task 上**，与未绑定 explorer 的现有行为一致；已绑定 validator 的既有行为逐字不变。
- [ ] 费用挂靠的目标 Task 选择要有测试覆盖「同 cwd 无活动 Task」的情形：此时不得静默丢弃，也不得挂到别的 cwd 的 Task 上。
- [ ] 会话在 Task 非终态下结束时，仍写出一条最终账本记录，且该记录的 children 覆盖本次会话产生的全部 `*_meta.json` runId。
- [ ] 不变量测试：`usage.jsonl` 末条 children 的 runId 集合 ⊇ 该会话 `<SA>` 中 `*_meta.json` 的 runId 集合。修复前该用例必须失败，回执贴出失败输出原文。
- [ ] 不重复计数：同一 runId 只出现一次（工单 23 的重复写修复不得回退，`index.test.mjs:3372-3427` 一行不改仍全绿）。
- [ ] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策，工单 13/23 同源）。

来源：08 第五次重跑 `phase-a-08-run5`（2026-09-08）。08 条款 14 是硬条件，实测差集 10 个 runId、漏记 **$0.27450360，占实际总支出 $0.78197 的 35.1%**（r4 是 30.1%，本次更差）。其中 (a) 占缺口的 92%。

工单 23 收的是「失败子委派有 meta 但不入账」，与本票两条都不是同一个洞 —— 23 的修复没有回退，这是它没覆盖到的两条路径。

对一个以「省 token」为核心目标的专题来说，**整整一个角色不在账本里**是要先修的：省下来的钱现在没法量。

round_id=claude-pD-2026-09-08-open-29

2026-09-08：派活前 planner 读 `orchestrate.ts` / `index.ts` 把 (a) 的根因钉到了具体行（见上），并对 `usage.jsonl` 实测核对。这一步是被工单 28 逼出来的 —— 28 初版照抄了一句误导性报错，成因写反，实跑才纠正。本票的 (a) 已经过源码与产物双向核实；(b) 仍只有时间戳与差集证据，未定位到具体代码路径，执行者需自己查明并在回执里写清楚。

round_id=p11-r053（补根因）

2026-09-08 派活前 planner 二次核验（round_id=p12-r056）。行号在工单 27/28 落地后有位移，重新钉一遍，
两条根因都在当前 HEAD 上复核过：

- **(a) 仍然成立。** 未绑定 validator 分支在 `orchestrate.ts:751-780`：占位串在 `:759`
  （`unbound-validator-${event.toolCallId}`），`this.delegations.set(...)` 在 `:764-779`，
  **全段没有 `accountingTaskId`**。全仓 `grep -n accountingTaskId orchestrate.ts` 只有两处命中：
  类型声明 `:231` 与 explorer 分支的 `:922`。也就是说除 explorer 外，没有任何分支挂账。
- explorer 的对照实现在 `orchestrate.ts:914-927`，挂账那行是 `:922`
  （`const accountingTask = this.store.activeForCwd(cwd) ?? active;` 在 `:918`）。
  `index.ts:451-453` 的 `accountingTaskId(record)` 返回 `record.accountingTaskId ?? record.taskId`，
  该函数在 `index.ts:459 / 511 / 534 / 848 / 858 / 903 / 911` 七处被调用 —— 补上那一行即可全线生效。
- **(b) 的落点已找到，但结论要执行者自己确认。** `index.ts:782-786` 已经有一个
  `pi.on("session_shutdown", ...)` 钩子，**它只调用 `restoreSuppressedTools()`，不写账本**。
  `flushIfTerminal`（`index.ts:436-448`）的五个调用点全在事件处理路径上
  （`:743 / 869 / 922 / 1048 / 1113`），且它开头就 `if (!after || !isFinalTaskState(after.state)) return;`
  —— Task 非终态时直接返回，这与「最后 21 分钟 7 个子代理全丢」的现象吻合。
  **执行者必须先查明 `session_shutdown` 在正常进程退出（而不只是 reload）时是否触发**，
  再决定兜底落账挂在哪里；查明过程与结论写进回执，不要默认它一定会触发。

round_id=p12-r056（派活前核验，行号复核）
