[轮次] round_id=PENDING

# 任务：工单 32 —— 绑定补齐必须取 reviewer 实际收到的那份 ReviewRequest

你是执行者。回报地址：**planner pane `w2E:pD`**（用 `herdr agent prompt --pane w2E:pD` 回报，
不要只在自己 pane 里输出）。工作目录 `/home/tcuni-claw/pi/pi-planner-only`，分支
`planner-only-cost-control`（HEAD `94713af`）。你没有继承我的任何上下文，本文件就是全部输入。

## 环境硬规矩（子代理常常读不到全局规则，这里逐条写明）

- 任何中间文件、临时目录、日志**一律不得**放在 `/tmp` 或其子目录。需要放在工作目录之外时用
  `/project/tmp`。
- 预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，**一律用 `slot` 提交**
  （本任务用 `slot cpu -- <命令>`）。
- **启动重任务前先跑 `slot audit` 与 `slot status`，把输出写进 `/project/tmp/<你的round_id>-slot-preflight.log`**
  （**不要**写进 `.scratch/`，那里对你只读）。`slot audit` 若报告有绕过 slot 的其他重进程，
  **不得擅自终止**它；等待、降低并发或直接向我报告冲突即可。禁止先跑后补查。
- 不要用 `slot slots` 调大槽位给自己插队。

## 允许改动的文件（fence）

可写：`orchestrate.ts`、`review.ts`、`orchestrate.test.mjs`。

只读、**一个字节都不许改**：`index.ts`、`roles.ts`、`types.ts`、`task.ts`、`usage.ts`、
`report.ts`、`evidence.ts`、`notify.ts`、`floors.ts`、`workspace-snapshot.ts`、`package.json`、
`index.test.mjs`、`review.test.mjs` 及其余所有 `*.test.mjs`、`e2e.pi-subagents.test.mjs`、
`.scratch/**`（不许勾任何工单 checkbox、不许改任何工单 Status、不许碰 `spec.md`）。
不要 `git commit`、不要 `git add`、不要建分支、不要 rebase。

## 背景（这些事实我已实跑核验过，直接用，不必重新论证）

`handleReviewerResult` 在记录 verdict 之前会把 reviewer 省略的绑定字段补齐：

```ts
// orchestrate.ts:1810
const expectedBinding = {
    reportRevision: task.reports.length,
    ...(task.snapshot ? { workspaceDigest: task.snapshot.digest } : {}),
};
const boundReview = bindReviewResultFromRequest(review, expectedBinding);
const bindingErrors = validateReviewResultBinding(boundReview, expectedBinding);
```

补齐取的是**记录时**的 `task.reports.length` / `task.snapshot.digest`。而
`review.ts:216-217` 的注释写的是「fill omitted FR-03/D09 bindings **from the ReviewRequest the
reviewer was shown**」——注释描述的语义与代码实际做的事不是一回事。今天两者必然相等，只是因为
「一个 Task 同时只有一次未结委派」这条隐式锁；锁一放松，一份 reviewed revision N 的 PASS 就会被
盖章成 N+1，正是 FR-03/D09 要堵的洞，而且**不会有任何测试变红**。

reviewer 真正看到的那份包在哪：`index.ts:895` 先调 `orchestrator.prepareRoleDelegation(event.input)`，
它**原地改写** `event.input`，把 Root 的原始 prompt 换成 `roles.ts:511-529` 用
`buildFreshReviewerTask` 生成的包；随后才调 `beginDelegation`。所以
`orchestrate.ts:719` 的 `const packet = extractReviewRequest(delegationPrompt(input))`
读到的**就是** reviewer 收到的那一份，生产路径上它必然带 `reportRevision`
（`roles.ts:523` 无条件写 `target.task?.reports.length ?? 0`）。

但这份包今天只被用来算 `packetTruncated`，**没有存进委派记录**：`DelegationRecord`
（`orchestrate.ts:227-254`）只有 `packetTruncated?: boolean`。而
`handleReviewerResult(task, text, record)` 的三处调用点（`:1375`、`:1642`、`:1689`）
都已经把 `DelegationRecord` 传进来了，取值链是通的。

## 要做的事

1. **把包里的绑定值持久化。** 在 `orchestrate.ts:722` 那次 `this.delegations.set(...)` 里，
   把 `packet` 的 `reportRevision` / `workspaceDigest` 一并存进 `DelegationRecord`
   （字段名自定，写进 interface 并加一行注释说明它是「reviewer 实际收到的那份包里的绑定」）。
2. **补齐改为从记录里的包取值。** `expectedBinding` 的**补齐来源**改成第 1 步存下的包绑定。
   注意区分两件事：**补齐（fill）的来源**换成包；**校验（validate）比对的对象**仍然是记录时的
   最新 revision / digest——一份声明 revision N 的 PASS 在最新是 N+1 时**照旧必须拒收**
   （`T-20260905-996` 就是这条）。不要把校验也一起改成拿包比包，那会把 996 那条洞重新打开。
3. **取不到包时不许静默退回。** 记录里没有可用的包绑定（包缺失，或包里没有 `reportRevision`）时
   **一律不补齐**，让现有缺失校验按原样拒收，并在拒收回执里说明「这次委派没有可用的
   ReviewRequest 绑定，请重新委派 review」。**不得**退回记录时的
   `task.reports.length` / `task.snapshot.digest`。
4. **同步改正 `review.ts` 的注释**，让它与实际取值来源一致（现在写的是对的目标、错的现实）。
5. **修 fixture `orchestrate.test.mjs` 的 `T-20260905-998`。** 它今天能绿，靠的正是第 3 条要堵的
   退路：它直接调 `beginDelegation`，跳过了 `prepareRoleDelegation` 的改写，所以委派记录里没有包。
   我已实跑证明改法可行且全绿——把委派输入提出来，先 `prepareRoleDelegation` 再 `beginDelegation`：

   ```js
   const probeInput = { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) };
   await orch.prepareRoleDelegation(probeInput);
   await orch.beginDelegation({ toolCallId: "call-t8-4r", input: probeInput }, BASE);
   ```

   **不许**为了让 998 继续绿而保留记录时退路，**不许**删掉 998，**不许**放宽它的断言
   （它必须仍然断言：省略绑定的 pass 被补齐成 `reportRevision=1` + 当前 digest，Task 走到
   `completed`）。全量 `npm test` 里除 998 外没有第二条用例依赖这条退路——我已用探针统计过：
   37 次 reviewer 委派中 28 次无包，但只有 998 一条同时「无包 + reviewer 省略 revision」。
6. **新增用例（本票的核心证据）：** 委派时包里 revision 为 N、记录时 Task 已有 revision N+1 的情况下，
   一份**不含绑定字段**的 pass **不得**被记成 N+1。现有的一 Task 一委派锁挡住了这条路，所以用例
   要么直接调补齐函数与校验（绕开委派锁），要么显式构造两条并存的委派记录；
   **不许为了让用例可达而放松锁本身**。

## 验收（我会在自己 pane 里逐条复跑，不认口述）

```bash
slot cpu -- npm run typecheck
slot cpu -- npm test
slot cpu -- npm run test:e2e
git diff --check
```

四条都必须退出 0。注意：`npm run test:release` **现在是红的**（工单 26 落地后 §F 缺真实覆盖，
这是预期状态），**不是**你要修的东西，也不许为了让它变绿动 `e2e.pi-subagents.test.mjs`。

另外必须满足：

- `orchestrate.test.mjs` 里 `T-20260905-996` / `T-20260905-997` / `T-20260905-999`
  **一行不改**仍绿（改 998 是允许的，且只能按上面的方向改）。
- `index.test.mjs` **一个字节都不许改**，其中工单 27 的端到端用例（`T-20260908-027`）仍绿。
- 新增用例在改代码前是 **RED**：请把改前实跑的失败输出**原样粘贴**给我（不要复述、不要美化）。
  改后再跑一遍贴 GREEN。

## 回报格式

用 `herdr agent prompt --pane w2E:pD` 发回，开头写 `round_id=<本轮 id>`，包含：

1. 改了哪些文件、每个文件改了什么（一两句）；
2. 新增用例的 **RED 原样输出** 与 **GREEN 原样输出**；
3. 上面四条验收命令各自的退出码；
4. `slot audit` / `slot status` 预检日志路径；
5. 第 3 条（取不到包）你具体怎么实现的、拒收回执长什么样；
6. 有没有任何你认为工单写错了的地方——**发现工单与代码对不上时不要自己猜着改，停下来告诉我**。
