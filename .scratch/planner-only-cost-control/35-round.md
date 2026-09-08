[轮次] round_id=PLACEHOLDER

你是本轮的**执行者**。Planner 在 herdr pane `w2E:pD`，**做完请把报告发回 `w2E:pD`**。

**注意：本轮没有清空你的上下文**（pairctl 对 cursor 没有已知的开新会话命令）。
你之前可能还记着别的轮次 —— **一律以本文件为准，不要复用任何旧的行号、结论或围栏。**

工作目录：`/home/tcuni-claw/pi/pi-planner-only`（分支 `planner-only-cost-control`，
HEAD 应为 `88a4eb6`）。

---

## 0. 环境硬规则（必须逐条遵守，你的全局规则文件可能没被加载）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时目录、缓存、构建暂存或任务产物。
  任务内的中间文件放当前工作目录下一个清楚命名的可丢弃子目录；
  需要放到工作目录之外时用 `/project/tmp`。这条同样适用于你起的脚本、子进程和被你委派的子代理。
- **预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交。**
  本轮验收命令属于这一类，必须走 `slot cpu -- …`。
- **每次启动重任务前必须先运行 `slot audit` 和 `slot status`，并把输出写入项目日志**
  （放 `.scratch/planner-only-cost-control/`，文件名带 round_id）。**禁止先跑后补查。**
- `slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；应等待、降低并发或报告冲突。
- **不要用 `slot slots` 调大槽位给自己插队。**
- **`.agent-dir/models.json` 与 `.agent-dir/auth.json` 含 provider API key：
  不许读、不许写进报告、不许提交。**

## 1. 本轮范围（工单 35）

票在 `.scratch/planner-only-cost-control/issues/35-no-final-ledger-flush-when-the-session-ends-non-terminal.md`，
**先完整读一遍**，特别是末尾两段 planner 的派活前核验（行号在 `88a4eb6` 上钉过两次）。

**一句话：会话结束时，如果 Task 还没走到终态，账本就再也不写了，最后一段子代理的钱全丢。**

08 第五次重跑实测：账本最后一条写于 `01:09:36Z`，进程跑到 `01:30:33Z`；
这 21 分钟里又跑了 7 个子代理（**$0.02227**），一条都没进账本。

## 2. Planner 已经替你查清的事实（实读源码／`node_modules` 得出，不必再查）

1. **机制已定位。** `flushIfTerminal`（`index.ts:436`）的早退在 **`:444`**：
   `if (!after || !isFinalTaskState(after.state)) return;`（`:443` 是
   `const after = orchestrator.store.get(taskId);`）。
   五个调用点 `index.ts:743 / 869 / 922 / 1048 / 1113` 全在事件处理路径上。
   Task 一直不进终态 → 账本再也不写 → 进程退出时没有任何兜底。
2. **可以挂的钩子已经存在。** `index.ts:782-786` 有 `session_shutdown`，
   函数体目前只有 `restoreSuppressedTools()`，签名是 `async () => {}`（**不接事件参数**），
   注释只考虑了 reload。但在**当前安装的宿主 `@earendil-works/pi-coding-agent` 0.84.4**
   （planner 实测版本号）上它的覆盖面远不止 reload：
   - `dist/core/extensions/types.d.ts:477-483`：事件带 `reason`，取值
     `"quit" | "reload" | "new" | "resume" | "fork"`，**`quit` 就是正常退出**；
   - `dist/core/extensions/runner.d.ts:65`：`emitSessionShutdownEvent(...): Promise<boolean>`，
     **handler 是被 await 的**，所以在里面做异步落账能跑完；
   - CHANGELOG：`:2317` print/JSON 模式退出前也 emit；`:1996`／`:1239` SIGHUP／SIGTERM
     在 interactive／print／RPC 模式下都 emit；`:1748` `/quit` 在进程退出前 emit。
3. **账本记录类型在 `usage.ts`**（`UsageEntryKind` 在 `usage.ts:50`，`UsageEntry` 在 `:52`），
   **不在 `types.ts`** —— 所以加「非终态」标记不需要动 `types.ts`，围栏是够用的。

## 3. 验收条款

1. 会话在 Task **非终态**下结束时，仍写出一条最终账本记录，**且带明确的非终态标记**
   （不要伪装成终态）。
2. 该记录的 children 覆盖本次会话产生的全部 `*_meta.json` runId。
3. 不变量测试：`usage.jsonl` 末条 children 的 runId 集合 ⊇ 该会话子代理产物目录中
   `*_meta.json` 的 runId 集合。**修复前该用例必须失败，回执贴出失败输出原文。**
4. **不重复计数**：同一 runId 只出现一次。既有的 exactly-once 用例
   （`index.test.mjs:3462-3517`，注释标 `p11-r052`）**一行不改**仍然全绿；
   紧邻它上面 `3421-3460` 是工单 29(a) 的未绑定 validator 落盘用例，**同样一行不改**。
   **动手前先 `grep -n "p11-r052" index.test.mjs` 自查行号**，对不上以你 grep 到的为准并在报告里说明。
5. **`reason` 的处理要给出理由**：哪些 reason 该落账、哪些不该。
   `reload`/`new`/`fork` 是会话替换，替换后的实例可能会接着写 —— 重复落账的风险你要自己论证，
   不能只写「我认为不会」。这一条是本票的核心判断，报告里要单独成段。
6. Task 已在终态、`flushIfTerminal` 已经落过账的情形，**不得因为兜底再写一条重复记录**。
7. **幽灵 taskId 的费用不得永远落不了盘（从工单 29 移交，那一轮的围栏排除了 `index.ts`，
   所以没能收口 —— 本轮有权改）。** 未绑定 validator 在「同 cwd 没有任何活动 Task」时，
   挂账键是合成的 `unbound-validator-<toolCallId>`。planner 实测
   （`.scratch/planner-only-cost-control/p12-verify-r058/ghost-cost.mjs`）：
   费用**在内存账本里是在的**（该 ghost id 下 `children: 1`、`costUsd 0.058`），
   但 `flushIfTerminal` 的 `:443-444` 对 store 里不存在的 id 直接早退，
   于是它**永远进不了 `usage.jsonl`**。
   要求：这笔钱要么落盘成一条带明确「未归属」标记的记录，要么有其它可检查的去处；
   **不接受静默消失**。
8. 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## 4. 文件围栏（Fence）

**可改：** `index.ts`、`usage.ts`、`index.test.mjs`、`usage.test.mjs`。
**只读：** `orchestrate.ts`、`task.ts`、`roles.ts`、`report.ts`、`review.ts`、`types.ts`、
`evidence.ts`、`notify.ts`、`workspace-snapshot.ts`，以及 `.scratch/` 下的一切。
**不要 `git commit` / `git add` / 改 `.gitignore`。** 提交由 planner 做。

planner 已经对着条款逐条查过这个围栏：**七条实质条款都能在这四个文件里做到**
（账本记录类型在 `usage.ts` 不在 `types.ts`，钩子和落账路径都在 `index.ts`）。
如果你发现某条做不到，**停下来在报告里指名哪一条、缺哪个文件**，
不要自行扩大围栏，也不要把条款做掉一半就报完成。

## 5. 验收命令（必须实跑，贴原始输出与退出码）

```
slot cpu -- npm run typecheck
slot cpu -- npm test
slot cpu -- npm run test:e2e
git diff --check
```

四条都必须 exit 0。跑之前先 `slot audit` / `slot status` 并存日志（见 §0）。

## 6. 报告格式（发回 `w2E:pD`）

1. 落账时机怎么设计的、挂在哪个钩子、为什么。
2. **条款 5 的 `reason` 论证**，单独成段。
3. **RED 原文**：修复前新增用例的失败输出，逐字贴。
   **必须是最终交付的那个用例的失败输出** —— 上一轮执行者贴的 RED 是中途废弃的草稿版断言产生的，
   与最终用例对不上，被 planner 当场查出来了。
4. `git diff --numstat` 全部行。
5. 四条验收命令的退出码与关键输出。
6. slot 预检结果（含发现的绕过 slot 的进程，**未终止**）。
7. **「想改但没改」清单**：围栏挡住了什么、哪条条款你觉得有问题。
8. 条款 1-8 逐条自评，做到就说做到，没做到就明说。

**不要在报告里复述你没有实际跑过的结果。** Planner 会在自己 pane 里逐条复现你的每一项证据，
包括独立回滚你的源码改动来验证 RED —— 报告与实跑对不上会直接打回。
