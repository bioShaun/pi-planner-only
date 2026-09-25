# 29: oracle 子代理从不入账，且进程退出时无兜底落账

**What to build:** 两个互相独立的账本缺口，都在 08 第五次重跑里量到了。

**(a) oracle 子代理一次都没进过 `usage.jsonl`。** run5 五条账本记录里 children 的 `(kind, agent)` 分布是 `{('worker','worker'): 22, ('reviewer','reviewer'): 3}` —— oracle 从未出现。不是时序问题：`588268d7` 与 `b288025c` 在第一次落账之前就结束了，仍然不在里面。6 次 oracle 委派花掉 **$0.25224**，账本认为它们不存在。

**根因已定位（2026-09-08 planner 读源码核实，不是猜）：`orchestrate.ts:757-778` 的「未绑定 validator」分支给委派记的 `taskId` 是占位串 `unbound-validator-${event.toolCallId}`，且**没有**设 `accountingTaskId`。** 而 `index.ts:452` 的 `accountingTaskId(record)` 返回的是 `record.accountingTaskId ?? record.taskId` —— 于是这些 oracle 的费用被记到一个**store 里根本不存在的幽灵 Task** 上，永远不会写进真实 Task 的 `usage.jsonl`。实测佐证：run5 的 `usage.jsonl` 五条记录 taskId 全是 `T-20260908-001`，全文 `grep -c unbound-validator` 为 **0**，钱既不在真 Task 里、也没单独落一条。

**同一个坑 explorer 已经填过了。** `orchestrate.ts:917-921` 的未绑定 explorer 分支注释写着「mirror the unbound-validator placeholder」，但它多写了一行 `...(accountingTask ? { accountingTaskId: accountingTask.taskId } : {})`，用 `this.store.activeForCwd(cwd) ?? active` 把费用挂回真实 Task。`index.ts:451` 那行注释「Child usage belongs to the real active Task when explorer behavior remains unbound」说的就是这个机制 —— **validator 漏了这一行。**

为什么 r5 六次 oracle 全走了未绑定分支：Root 从未嵌入 TaskSpec（工单 30），委派里没有 Task 可绑，`reviewed` 为空，直接落进 `if (!reviewed)`。所以 30 未修之前，这条路径会一直被走到。

**(b) 最后一次落账之后跑的子代理全部丢失。** 账本最后一条写于 `01:09:36Z`，进程跑到 `01:30:33Z`。这 21 分钟里又跑了 7 个子代理（$0.02227），因为 Task 再没进入终态，`flushIfTerminal` 再没触发，**进程退出时也没有任何兜底落账**。

要求：oracle／validator 角色的子代理与 worker、reviewer 同等入账（**最小改法就是给未绑定 validator 分支补上 explorer 已有的那行 `accountingTaskId`，但要自己判断 `store.activeForCwd(cwd) ?? active` 在 validator 语义下是否也成立，并说明理由**）；会话结束时无论 Task 处于什么状态都写出一条最终账本记录（可以带明确的非终态标记），使「meta 里有的 runId，账本里都有」成为可检查的不变量。

**Blocked by:** None（源码在 `0fe04df`）。

**Status:** done（(a) 部分；(b) 见工单 35）

- [x] 一次含 oracle 委派的运行结束后，`usage.jsonl` 末条 children 里出现该 oracle 的 runId 与 costUsd。
- [x] **未绑定 validator（委派没有指名任何 Task）的费用挂到真实活动 Task 上**，与未绑定 explorer 的现有行为一致；已绑定 validator 的既有行为逐字不变。
- [~] 费用挂靠的目标 Task 选择要有测试覆盖「同 cwd 无活动 Task」的情形：此时不得静默丢弃，也不得挂到别的 cwd 的 Task 上。
      **半条达成**：「不挂别的 cwd」已实现且有测试（`orchestrate.test.mjs:1188-1207`）；
      「不静默丢弃」只在**内存账本**层面成立（planner 实测：ghost id 下 `children:1`、`costUsd 0.058` 仍在），
      落盘那一半未达成 —— `flushIfTerminal` 对 store 里不存在的 taskId 直接早退，幽灵 id 永远进不了 `usage.jsonl`。
      堵它要改 `index.ts`/`usage.ts`，被本轮 fence 排除。**残留移交工单 35。**
- [→] （已移交工单 35）会话在 Task 非终态下结束时，仍写出一条最终账本记录。
- [→] （已移交工单 35）不变量测试：`usage.jsonl` 末条 children 的 runId 集合 ⊇ `*_meta.json` 的 runId 集合。
- [x] 不重复计数：同一 runId 只出现一次（`index.test.mjs:3372-3427` 一行不改仍全绿）。
- [x] **占位串来源要区分对待**：`orchestrate.ts:757-759` 的三种占位串里，只有合成的
      `unbound-validator-<toolCallId>` 是幽灵；`specId` 与单个 `named[0]` 是委派声明的真实 Task id。
      挂账不得把后两种从它们声明的 Task 上改挂到 `activeForCwd(cwd)` 去；测试要覆盖
      「占位串是一个 store 里存在的 specId，且它与当前 cwd 活动 Task 不同」这一情形，
      断言费用仍记在 specId 上。
- [x] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

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

2026-09-08 派活前 planner 三次核验（round_id=p12-r058）。工单 27/28/33/34 已全部落地
（HEAD `76689a3`），但它们只动了 `report.ts`/`roles.ts`/`types.ts`，**本票引用的所有行号在
当前 HEAD 上逐条复核仍然成立，无需重钉**：`orchestrate.ts:759` 占位串、`:764-779` 无
`accountingTaskId`、全文只有 `:231`（类型）与 `:922`（explorer）两处命中；explorer 取值在
`:918`；`index.ts:452-453` 的 `accountingTaskId(record)` 与 `:459/511/534/848/858/903/911`
七处调用点；`session_shutdown` 在 `index.ts:782-786`，函数体只有 `restoreSuppressedTools()`；
`flushIfTerminal` 定义在 `:436`，调用点 `:743/869/922/1048/1113`。
`store.activeForCwd` 确实存在（`task.ts:488`）。

run5 产物也重跑核对了一遍（`.../phase-a-08-run5/artifacts/usage.jsonl`）：
5 条记录、taskId 全是 `T-20260908-001`、`grep -c unbound-validator` 为 0、
children 的 `(kind, agent)` 分布 `{('worker','worker'): 22, ('reviewer','reviewer'): 3}`。
与本票原文完全一致。

**新增一条要求（读代码时发现的坑，写进条款）：占位串有三种来源，不能一视同仁地改。**
`orchestrate.ts:757-759` 是 `specId ?? (named.length === 1 ? named[0] : undefined) ??
\`unbound-validator-${event.toolCallId}\``。只有第三种是合成幽灵；前两种是委派自己声明的
真实 Task id。如果照抄 explorer 那行**无条件**写
`accountingTaskId = store.activeForCwd(cwd) ?? active`，那么当占位串本来是一个有效的
`specId`（比如 `T-002`）而当前 cwd 的活动 Task 是 `T-001` 时，费用会被从 `T-002`
**改挂到 `T-001`** —— 把一条今天正确的路径改错。explorer 没有这个问题，因为它的
`taskId` 恒为合成串。执行者必须处理这个区别，并说明判据。

round_id=p12-r058（派活前核验）

2026-09-08：**本票已拆分**（round_id=p12-r058）。
(a)「未绑定 validator 挂账到幽灵 Task」保留在本票，已派给 w2E:pE（cursor），round p12-r058。
(b)「会话非终态结束时无兜底落账」**移到新工单 35**
（`35-no-final-ledger-flush-when-the-session-ends-non-terminal.md`），
本票上面条款里属于 (b) 的两条（最终账本记录、runId 差集不变量）由 35 承接，本票不再计。
拆票理由与宿主 `session_shutdown` 事件语义的实读结论都写在 35 里。

2026-09-08 planner 验收（round_id=p12-r058，执行者 w2E:pE / cursor）：**接受并提交。**

改动只有 `orchestrate.ts` +11/-1：把合成占位串提成 `syntheticId` 变量，
`accountingTask` 仅当 `placeholder === syntheticId` 时取 `this.store.activeForCwd(cwd)`，
再按 explorer 的写法条件展开 `accountingTaskId`。测试 `orchestrate.test.mjs` +154、
`index.test.mjs` +69。

执行者对我提出的「三种占位串」陷阱选了**按合成串判**，而不是按 `store.get(placeholder)` 是否存在。
理由我复核后认同：若按 store 是否存在，一个声明了 `T-002` 但 store 里暂时没有它的委派
会被改挂到 cwd 的活动 Task 上，正是本票禁止的改挂。「声明了真实 id」应当压过
「当前 cwd 碰巧有活动 Task」。它也**没有**照抄 explorer 的 `?? active` 兜底 —— 抄了就会跨 cwd 挂账。

planner 在自己 pane 里逐条复现：

- 两处 RED 独立复现（只回滚 `orchestrate.ts`）：`orchestrate.test.mjs:1106` 得到
  `undefined` 而非 `'T-20260908-581'`；`index.test.mjs:3435` 得到 `0 !== 1`，
  失败消息里打出的 children 只有一个 worker、没有 oracle。逐字节还原后 md5 与冻结快照一致。
  日志：`p12-r058-29a-verify-red-orch.log` / `p12-r058-29a-verify-red-index.log`。
- 四条验收命令 `slot cpu` 一次跑通 exit 0，17 个测试文件全 PASS，e2e PASS。
  日志：`p12-r058-29a-verify-accept.log`。slot 预检 `p12-r058-verify-slot-audit.log`：
  绕过 slot 的 `htvc`（PID 3821263，RSS 18.7G）与 `agy`（PID 3239052），按规则均未终止。
- `index.test.mjs:3400-3439` 那个新用例是**真端到端**：走 `tool_call`/`tool_result` 真实
  handler，先断言通知里出现「validator delegation names no Task under review」证明确实走了
  未绑定分支，再从磁盘 `usage.jsonl` 读回，断言 oracle child 的
  `runId`/`agent`/`costUsd 0.058`/`kind: validator` 都在真实 Task 的记录里。
  这正是本票的标题不变量，不是插件自证。

**明确未达成的半条（见上面 `[~]`）：** 「同 cwd 无活动 Task 时不静默丢弃」只在内存账本层面成立。
planner 实测确认费用没在账本对象里消失，但它落不了盘。这是**我写的 fence 与我写的条款自相矛盾**
造成的，不是执行者的实现缺陷 —— 执行者主动在回执里点明了这一点而没有偷偷扩大范围。
残留已作为一条新条款写进工单 35。

round_id=p12-r058
