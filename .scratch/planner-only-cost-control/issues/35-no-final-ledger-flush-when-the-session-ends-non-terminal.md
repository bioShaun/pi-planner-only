# 35: 会话在 Task 非终态下结束时没有兜底落账，最后一段子代理全丢

**What to build:** 这是原工单 29 的 (b) 半张，拆出来单独派活（(a) 半张走 round p12-r058）。

08 第五次重跑：账本最后一条写于 `01:09:36Z`，进程跑到 `01:30:33Z`。
这 21 分钟里又跑了 7 个子代理（**$0.02227**），一条都没进账本。

**机制已定位。** `flushIfTerminal`（`index.ts:436`）开头就是
`if (!after || !isFinalTaskState(after.state)) return;` —— Task 不在终态直接返回。
它的五个调用点（`index.ts:743 / 869 / 922 / 1048 / 1113`）全在事件处理路径上。
于是只要 Task 一直没走到终态，账本就再也不写了，进程退出时也没有任何兜底。

**关键的未知项，planner 已经查清并钉死（原工单让执行者自己查，现在不必了）：**

`index.ts:782-786` 已有一个 `session_shutdown` 钩子，函数体只有 `restoreSuppressedTools()`，
注释写的是「A reload tears down this instance...」—— 只考虑了 reload。
但在**当前安装的宿主版本 `@earendil-works/pi-coding-agent` 0.84.4** 上，
这个事件的覆盖面远不止 reload：

- `dist/core/extensions/types.d.ts:477-483` —— 事件带 `reason`，取值
  `"quit" | "reload" | "new" | "resume" | "fork"`，注释「Fired before an extension runtime is
  torn down due to quit, reload, or session replacement」。**`quit` 就是正常退出。**
- `dist/core/extensions/runner.d.ts:65` —— `emitSessionShutdownEvent(...): Promise<boolean>`，
  返回 Promise，**handler 是被 await 的**，所以在里面做异步落账能跑完。
- CHANGELOG 佐证：`:2317` print/JSON 模式退出前也会 emit；`:1996` 与 `:1239`
  SIGHUP／SIGTERM 在 interactive／print／RPC 模式下都会 emit；`:1748` `/quit` 在进程退出前 emit。

**所以兜底落账挂在这个已有钩子里是可行的**，且能按 `reason` 区分 quit 与 session 替换。
现有 handler 目前不接收事件参数（`async () => {...}`），需要改成接收。

**Blocked by:** None。建议排在原工单 29(a)（round p12-r058）之后，两者都动账本路径，
但改的不是同一段代码；若 (a) 已落地，先 rebase 到它上面。

**Status:** ready-for-agent

- [ ] 会话在 Task **非终态**下结束时，仍写出一条最终账本记录，且带明确的非终态标记
      （不要伪装成终态）。
- [ ] 该记录的 children 覆盖本次会话产生的全部 `*_meta.json` runId。
- [ ] 不变量测试：`usage.jsonl` 末条 children 的 runId 集合 ⊇ 该会话 `<SA>` 目录中
      `*_meta.json` 的 runId 集合。**修复前该用例必须失败**，回执贴出失败输出原文。
- [ ] 不重复计数：同一 runId 只出现一次。既有的 exactly-once 用例
      （`index.test.mjs:3372-3427`，注释标 `p11-r052`）一行不改仍然全绿。
- [ ] `reason` 的处理要说明理由：哪些 reason 该落账、哪些不该
      （例如 `reload`/`new` 是会话替换，替换后的实例可能会接着写，重复落账的风险要自己论证）。
- [ ] Task 已经在终态、`flushIfTerminal` 已经落过账的情形，不得因为兜底再写一条重复记录。
- [ ] **（从工单 29 移交）幽灵 taskId 的费用不得永远落不了盘。**
      未绑定 validator 在「同 cwd 没有任何活动 Task」时，挂账键是合成的
      `unbound-validator-<toolCallId>`。planner 实测（`p12-verify-r058/ghost-cost.mjs`）：
      费用**在内存账本里是在的**（该 ghost id 下 `children: 1`、`costUsd 0.058`），
      但 `flushIfTerminal`（`index.ts:436-449`）第 443-444 行
      `const after = orchestrator.store.get(taskId); if (!after || !isFinalTaskState(after.state)) return;`
      对 store 里不存在的 id 直接早退，于是它永远进不了 `usage.jsonl`。
      本票有权改 `index.ts`/`usage.ts`（工单 29(a) 的 fence 排除了它们，这是那一轮没能收口的原因）。
      要求：这笔钱要么落盘成一条带明确「未归属」标记的记录，要么有其它可检查的去处；
      **不接受静默消失**。
- [ ] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。
原始出处：工单 29 的 (b) 半张，来源是 08 第五次重跑 `phase-a-08-run5`（2026-09-08）。

**优先级：阻塞第六次 08 重跑。** 08 条款 14 是硬条件；run5 实测漏记
$0.27450360，占实际总支出 $0.78197 的 **35.1%**，其中 (a) 占缺口 92%、本票占其余部分。
对一个以「省 token」为核心目标的专题，账本不全就等于省下来的钱量不出来。

拆票理由（planner，2026-09-08）：原工单 29 两个缺陷互相独立 —— (a) 是挂账目标写错（改动小、
边界清楚），(b) 是落账时机缺兜底（要动生命周期钩子、要论证重复落账）。
合成一轮会产出一份读不完的 diff，且 (b) 的论证会被 (a) 的琐碎挤掉。

宿主事件语义是 planner 在 `node_modules` 里实读 0.84.4 的 `.d.ts` 与 CHANGELOG 核实的，
不是从文档或记忆里抄的。若将来升级宿主版本，这段结论要重新核。

round_id=p12-r058（拆票并钉死宿主事件语义）
