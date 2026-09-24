[轮次] round_id=PLACEHOLDER

# 工单 15 第 2、3 条（15-b）：确认未启动要连负债一起释放；status 要显示在途预留

回执地址：**planner pane `w2E:pD`**（做完用 `herdr agent prompt w2E:pD '<报告>'` 回报，
不要只在自己 pane 里打印）。工作目录 `/home/tcuni-claw/pi/pi-planner-only`，分支
`planner-only-cost-control`，当前 HEAD 是 `83e2bbe`。

## 环境硬规矩（必须遵守，delegated subagent 也一样）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时目录、缓存、构建暂存或任务产物。
  任务内的中间文件放当前工作目录下一个明确命名的可丢弃子目录；要放到工作目录之外时用 `/project/tmp`。
- 预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，**一律用 `slot` 提交**
  （`slot cpu -- <命令>`）。本轮的 `npm test` / `npm run test:e2e` 属于这一类。
- **每次启动重任务前必须先跑 `slot audit` 和 `slot status`，并把输出写进项目日志**
  （写到 `.scratch/planner-only-cost-control/p16-r074-slot-audit.log` 和 `-slot-status.log`）。
  禁止先启动重活、事后补查。`slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；
  应等待、降低本任务并发或在报告里说明资源冲突。
- 不要用 `slot slots` 调大槽位数给自己插队。
- `.agent-dir/models.json` 和 `.agent-dir/auth.json` 含 provider API key：
  **不得读取、不得回显进报告、不得提交**。

## 背景（不要重新推导，这是我实跑出来的）

15-a（commit 83e2bbe）把「未知的子进程消耗」从记零改成按**启动时授予的额度**记一笔
**有界负债**，计进 `known`，让 14A 的启动闸门看得见它。真值到达时由 `upsertChild`
按键（`run:<runId>` 优先，其次 `call:<toolCallId>`）**替换**掉负债。

它漏了一种情况：**宿主确认这个子进程根本没启动**。orchestrate.ts 的
`handleSubagentResult` 里已经有这个分类器——`isBudgetStop ||
(event.isError && 没有可解析的 WorkerReport)` 且 `!delegation.runId`
时，注释原话是 "A launch that never produced a run (no receipt, no runId) is a
confirmed start failure and unlocks"，它会 `endDelegation`（释放写锁 + 释放预留）。
但 index.ts 的 `recordSyncChildren` 在同一个 `tool_result` 上照样记了一行
带全额负债的 pendingChild —— 预留放了，负债没放。

我实跑复现（探针 `.scratch/planner-only-cost-control/p16-probe/r074-clause2-failed-launch-debt.mjs`，
直接 `node` 跑，已在仓库里，**不要改它**）：

```
---- 第一个子进程正常结算后 ----
  费用: 已用 $0.0500 / 上限 $0.5000，剩余 $0.4500，未知项 0 项
---- 第二个委派宿主确认没启动，然后按插件自己的提示重发同一份 TaskSpec ----
Planner-only guard: task T-20260908-902 cumulative budget exhausted (costUsd).
已知消耗: tokens=101500, 费用 $0.5000
在途预留: tokens=0, 费用 $0.0000
```

实测消耗 $0.05，一次从未启动的委派记了 $0.45 负债，把 $0.50 的上限吃穿。
插件给 Root 的提示原话是 "Fix the delegation input and re-delegate with the same
TaskSpec"，工单 14 第 5 条又规定重发不重置累计值 —— 它推荐的恢复路径必然被自己拒绝，
Task 从此发不出任何委派。这是本轮第一件要修的。

第二件：`renderTaskStatus`（orchestrate.ts:1242-1275 一带）**全文没有「在途」二字**，
只有拒绝文案 `cumulativeBudgetRefusal` 会打印在途预留。工单 15 第 3 条要求
「取消请求后无确认：预留保持；status 显示在途」——预留保持这半边已经成立
（`delegation.runId && !isBudgetStop` 分支提前 return，不走 `endDelegation`），
**显示在途这半边没做**。

## 我已经定好的设计取舍（不要自己另选一条，也不要改这些措辞）

**D1 —— 分类器只准有一个。** 判断「宿主确认未启动」的逻辑**必须复用
`handleSubagentResult` 里已有的那一处**，不许在 index.ts 里照抄一份
`event.isError && !runId && results.length === 0`。现在这个 bug 的成因就是
两处各自判断。做法：orchestrator 在确认未启动、调用 `endDelegation` 的同时，
把这个 toolCallId 记进一个集合（参照现成的 `processedRunIds` 的写法），
再暴露一个查询方法（例如 `wasConfirmedNotLaunched(toolCallId): boolean`）；
index.ts 的 `recordSyncChildren` 在记 pendingChild 之前查它。
集合要有界，不能无限增长（跟 `processedRunIds` 同等对待即可）。

**D2 —— 确认未启动时，那一行 pendingChild 根本不要记，而不是记了再删。**
一个从未启动的子进程消耗为零，既不该有负债，也不该计进 `未知项`。
`UsageLedger` 目前没有删除 child 的能力，本轮**也不要加**删除接口。

**D3 —— 只在「确认未启动」时豁免，`isBudgetStop` 不豁免。**
预算触顶而停的子进程是真的跑过、真的花了钱，负债必须留着。
注意现有代码里 `isBudgetStop` 与「没有 runId」是两个独立条件，别合并。

**D4 —— status 的在途预留单独占一行，不要往维度行末尾追加。**
维度行已经很长了（已用/上限/剩余/未知项/宿主强制后缀）。
格式**逐字**用下面这行，只有在途不为零时才出现，放在两条维度行之后：

```
  在途预留: tokens=<整数>, 费用 $<四位小数>（<N> 个子进程未回执）
```

前半截 `在途预留: tokens=%d, 费用 $%.4f` 与 `cumulativeBudgetRefusal` 里现有那行
**必须逐字一致**（现有的是 `在途预留: tokens=${inFlight.tokens}, 费用 $${inFlight.costUsd.toFixed(4)}`），
这样拒绝文案和 status 说的是同一句话。`<N>` 是该 Task 当前持有预留的调用数。
在途为零时**不打印这一行**。

## 第 3 条的两半都要冻结

工单原文是「取消请求后无确认：**预留保持**；status **显示在途**」。

- **预留保持**这半边我读代码认为已经成立（`delegation.runId && !isBudgetStop`
  的分支提前 return，不走 `endDelegation`），但**没有测试守着它**。
  本轮要补一条：一个带 runId 的异步委派收到错误事件、且工件没有证明它终止时，
  预留**仍然在途**（数值不变），且该 Task 的 status 打印出 D4 那一行。
- **status 显示在途**这半边按 D4 做。

`/planner-only task abandon <id>` 同理：操作者放弃一个 Task **不等于**宿主确认子进程停了，
预留必须保持。如果你实跑发现 abandon 会释放预留，那是另一个 bug，**报告里说明，本轮不要顺手修**。

## 允许改动的文件（只有这些）

- `orchestrate.ts`
- `index.ts`
- `reservations.ts`（若 D4 需要一个「某 Task 持有几笔预留」的读取方法）
- `orchestrate.test.mjs`
- `index.test.mjs`
- `usage.test.mjs`（只有确实需要时）
- `architecture.test.mjs`（只有确实需要时）
- `.scratch/planner-only-cost-control/p16-r074-*.log`

其余全部只读。**不要 commit，不要动 `spec.md`，不要动 `issues/` 下任何 md，
不要勾任何 checkbox，不要改我那个探针文件。** 收尾由 planner 做。

## 验收（四条都要在报告里贴退出码）

1. `slot cpu -- npm run typecheck` → exit 0
2. `slot cpu -- npm test` → 前 15 个套件打印 `: PASS`，**只有 `naming.test.mjs` 失败**，
   逐字是 `AssertionError [ERR_ASSERTION]: extension install is missing reservations.ts`。
   这是预期内的：它校验仓库外那个跟着 **main** 走的安装副本，`reservations.ts` 还没合进 main。
   出现**任何其他**失败都算不通过。
3. `slot cpu -- env PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` → exit 0
4. `git diff --check` → exit 0
5. `node .scratch/planner-only-cost-control/p16-probe/r074-clause2-failed-launch-debt.mjs`
   → **现在它证明 bug 存在，修完之后它必须失败**（因为 GAP A 的断言反过来了）。
   不要改这个文件。**另写一个** `.scratch/planner-only-cost-control/p16-probe/r074-fixed.mjs`，
   同样的场景，断言修复后的行为：重发**不被拒绝**，`已知消耗` 停在 tokens=1500 / $0.0500，
   `未知项` 为 0 项。把两个文件的输出都贴进报告。

## 逐条失败证明（这是硬要求，做不到就不要交）

你新加的**每一条**断言，都要单独证明它不是空转。方法：把实现改回本轮之前的行为
（或对准该断言做一个针对性变异），**只留待证的那一条断言**、把同块的其他断言
逐条注释掉，跑出**逐字的失败输出**贴进报告。**合并成一组只证明了一条**——
我之前就被这么混过去过一次，这轮不接受「这几条一起证」。

否定断言（`assert.equal(..., false)` 这类）用去功能证不了，改用它针对的变异来证，
并说明你选的是哪个变异、为什么它恰好只被这一条接住。

## 报告要包含

- 每条验收命令的**完整命令行**和退出码
- `slot audit` / `slot status` 两份日志的路径和摘要（有没有绕过 slot 的重进程）
- 每条新断言的逐字失败输出
- 两个探针的完整输出
- 你改了哪些文件、各改了什么，以及**任何你认为我这份工单写错了的地方**
  （我自己写的工单已经错过三次，直说，我会实跑核）
