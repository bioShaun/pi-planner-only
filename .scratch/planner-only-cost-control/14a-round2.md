[轮次] round_id=PENDING

# 工单 14A 第二轮：修预留泄漏 + 补 V1–V13 断言

回信地址：planner pane **w2E:pD**。做完把报告发到那里，不要只写在自己的 pane 里。
工作目录：`/home/tcuni-claw/pi/pi-planner-only`（分支 `planner-only-cost-control`）。
上一轮你写的实现**已经在工作区里、未提交**，本轮在它之上继续改，不要推倒重来。

## 0. 环境硬规则（每轮都要遵守，不要跳过）

- 跑任何预计超过 1 分钟的命令一律 `slot cpu -- <命令>`，且**开跑前**先 `slot audit` 和 `slot status`，
  输出写进 `.scratch/planner-only-cost-control/p15-r070-slot-preflight.log`。
- `slot audit` 报出绕过 slot 的进程时**不要终止它们**，照抄进报告即可。
- 中间文件只放在当前工作目录下的 `.scratch/planner-only-cost-control/`，**禁止写 `/tmp`**。
- 不要读、不要打印、不要提交 `.agent-dir/models.json` 与 `.agent-dir/auth.json`（里面是 API key）。
- 不要 `git commit`，不要勾工单 checkbox。提交由 planner 做。

## 1. 上一轮的验收结论

实现的**主干是对的**，我在 planner pane 逐条复跑确认过，不用返工：

- `reservations.ts` 的算法、`floors.ts` 的 balance 来源（含无 floor 的 else 分支）、
  `beginDelegation` 里「stripDelegationKeys 之前 check-and-reserve」的位置、
  5 个终结点收敛成 `endDelegation`（`this.delegations.delete(` 现在全文件只剩 1 处，第 550 行）——都符合冻结设计。
- 端到端实跑（我的探针，不是你的报告）确认：余额只剩 2000 token / $0.01 时，
  地板本来要下发的 40000 被真正夹到 `{"tokens":{"hard":2000},"costUsd":{"hard":0.01…}}`，
  同一 Task 上第二个并发子进程被拒。**这正是工单要的效果。**

本轮只补两件事：一个我实跑证明的缺陷，和上一轮完全没写的断言。

## 2. 缺陷（必须修）：预留在「拒绝路径」上永久泄漏

**成因**：预留发生在 `beginDelegation` 靠前的位置，但 `this.delegations.set(...)` 在很后面。
两者之间有多条 `return`，这些路径预留已经记上、却没有任何记录能在将来释放它——
`endDelegation` 只在 `this.delegations` 里查得到记录时才 `release`，查不到就什么也不做。

我实跑证明了两条路径（都在干净复现脚本里）：

1. `return { block: { reason: MISSING_VALIDATION_DEFINITION_REASON } }`（validator 缺必需验证命令）。
   连发 6 次这种**根本没启动任何子进程**的委派后：
   ```
   B1 blocked-before-launch calls: 6
   B2 pendingDelegationCount (children actually in flight): 1
   B3 LEAK CONFIRMED — legitimate delegation refused:
       Planner-only guard: task T-20260908-902 cumulative budget exhausted (tokens).
       已知消耗: tokens=0, 费用 $0.0000
       在途预留: tokens=200000, 费用 $0.5000
   ```
   已知消耗是 **0**，在途预留却把 200000 的上限占满了。这个 Task 从此永久卡死，
   没有任何子进程可以结束、也就没有任何东西会归还这笔预留。
2. `return { task, conflict }`（写锁冲突）。同样记了预留、同样没人释放。

复现脚本在 `.scratch/planner-only-cost-control/p15-probe/r069-leak.mjs`，直接
`node --experimental-strip-types .scratch/planner-only-cost-control/p15-probe/r069-leak.mjs` 就能看到上面的输出。

**修法（我已在仓库外的副本上实跑验证通过，照抄即可，不要另想办法）**：

`reservations.ts` 加一个按 toolCallId 全表释放的方法：

```ts
	releaseByToolCall(toolCallId: string): void {
		for (const [taskId, reservations] of this.held) {
			if (reservations.delete(toolCallId) && reservations.size === 0) this.held.delete(taskId);
		}
	}
```

`orchestrate.ts` 把现有的 `async beginDelegation(...)` **改名**为
`private async beginDelegationInner(...)`（函数体一行不动），并在原位置新增外壳：

```ts
	async beginDelegation(
		event: { toolCallId: string; input?: unknown },
		baseCwd: string,
	): Promise<DelegationOutcome> {
		try {
			return await this.beginDelegationInner(event, baseCwd);
		} finally {
			// 预留发生在「这次委派到底启不启动」定下来之前。任何没有把委派记进
			// this.delegations 就返回的路径（TaskSpec 非法、缺验证定义、reviewer 无
			// taskId、写锁冲突、抛异常），都必须把预留还回去，否则余额会被从未存在
			// 的子进程占满。
			if (!this.delegations.has(event.toolCallId)) {
				this.reservations.releaseByToolCall(event.toolCallId);
			}
		}
	}
```

**为什么这个判据是安全的（我实跑核对过，别自己改成别的判据）**：真正启动并被记录的委派，
`this.delegations.has(toolCallId)` 为 true，`finally` 不动它。我的
`.scratch/planner-only-cost-control/p15-probe/r069-lifecycle.mjs` 在打补丁前后输出完全一致：

```
E2 retry-1 keys: [ 'task' ] | recorded: true | launched with: {"tokens":{"hard":2000},"costUsd":{"hard":0.01…}}
E3 inFlight while child runs: {"tokens":2000,"costUsd":0.01…}
E4 concurrent second child: REFUSED (correct)
```

## 3. 上一轮完全没写的部分：V1–V13 断言

上一轮报告写的是「未改 tests 文件……没有逐字失败证明可提供」。**测试是这张工单的主体，必须补齐。**
下面每条写成独立断言，放在指定文件里，措辞和数值照抄，不要换成近似值。

写进 `floors.test.mjs`（在 `console.log("planner-only floors: PASS")` 之前）：

- **V1** `balanceTokens` 比 floor/caller/taskSpec 都小时，`resolveEffectiveLimits` 的
  `tokens` 取 balance 值且 `source === "balance"`。
- **V2** `balanceTokens` 比它们都大时，生效值不变、`source` 不是 `"balance"`（balance 只能压低，不能抬高）。
- **V3** **无 floor 的分支**：`role: "reviewer"`（reviewer 不设地板）只给 `callerUsageBudget`
  和 `balanceTokens`，balance 更小时结果是 balance；这条专门守 `else` 分支，不要用有地板的角色代替。
- **V4** `balanceCostUsd` 同样覆盖上面三种情形；`toolBudget` 不受 balance 影响（balance 只作用于 tokens/costUsd）。

写进 `orchestrate.test.mjs`（Ticket 14 具名段落）：

- **V5** 上限 `{tokens:50000, costUsd:0.20}`、已消耗 48000/$0.19 时，bounded 重试实际发出的
  `input.usageBudget` **逐字**是 `tokens.hard === 2000`、`costUsd.hard` 约等于 `0.01`
  （浮点，用 `Math.abs(x - 0.01) < 1e-9`，不要写 `assert.equal(x, 0.01)`）。
- **V6** 并发：同一 Task 上第一个子进程已启动并持有预留时，第二个受控启动被拒（返回 `block`）。
- **V7** 只有 costUsd 见底（tokens 还很宽裕）时，拒绝理由里的维度是 `costUsd` 而不是 `tokens`。
- **V8** 拒绝文案**逐字**等于下面六行（`\n` 连接）：
  ```
  Planner-only guard: task <taskId> cumulative budget exhausted (<dimension>).
  已知消耗: tokens=<n>, 费用 $<x.xxxx>
  在途预留: tokens=<n>, 费用 $<x.xxxx>
  未知项: tokens <n> 项, 费用 <n> 项
  上限: tokens=<limit|未设>, 费用 $<limit|未设>
  本次受控启动被拒绝；结束在途子进程或提高 cumulativeBudget 后重试。
  ```
- **V9** 子进程结束后预留归还：走 `handleSubagentResult` 让那次委派终结，之后同一 Task 的下一次
  受控启动**不再**被拒。
- **V10** reviewer 委派不因累计预算被拒（reviewer 不设地板、不占预留）。
- **V11** Task 没有 `cumulativeBudget` 或没有 `usage` 时，下发的 `usageBudget` 与本轮改动前**完全一致**。
- **V12**（写进 `architecture.test.mjs`）：`orchestrate.ts` 里 `this.delegations.delete(` 恰好出现 **1 次**；
  `package.json` 的 `files` 数组含 `reservations.ts`；`reservations.ts` 不含 `from "./index.ts"` 也不含 `@earendil-works`。
- **V13**（新增，守本轮这个缺陷）：连续 5 次**被拒绝、从未启动**的委派（用 validator 缺验证命令那条路径）
  之后，同一 Task 的一次正常受控启动**仍然成功**；并断言此时 `pendingDelegationCount()` 与这 5 次调用之前相同。
  没有这条，泄漏会再回来。

## 4. 围栏

**只允许改这 5 个文件**：`reservations.ts`、`orchestrate.ts`、`floors.test.mjs`、
`orchestrate.test.mjs`、`architecture.test.mjs`。

`floors.ts` 上一轮已经改好、本轮**不要再动**。
`usage.ts` / `types.ts` / `task.ts` / `index.ts` / `roles.ts` / `package.json` **只读**。
仓库外的安装副本 `~/.pi/agent/git/github.com/bioShaun/pi-planner-only` **不要碰**（见下）。

## 5. 验收（上一轮的验收条款我写错了，这是修正版）

上一轮我要求 `npm test` 退出 0，这在**新增 .ts 文件的那一轮里根本不可能满足**——
`naming.test.mjs` 校验的是仓库外的安装副本，而安装副本要等提交后才同步。这是我的工单缺陷，
你上一轮把它指出来是对的。修正后的验收：

1. `slot audit` + `slot status` → `p15-r070-slot-preflight.log`，退出码 0。
2. `slot cpu -- npm run typecheck` 退出 0。
3. `slot cpu -- npm test` —— 允许且**仅允许** `naming.test.mjs` 这一条失败，且失败信息必须正好是
   `extension install is missing reservations.ts`。它前面的 15 个套件必须全部 PASS
   （policy / roles / floors / role-models / task / report / review / notify / usage / orchestration /
   evidence / git_audit / extension / workspace snapshot / architecture）。
   任何其它套件失败都算不通过。
4. `slot cpu -- npm run test:e2e` 退出 0。
5. `git diff --check` 退出 0。
6. `node --experimental-strip-types .scratch/planner-only-cost-control/p15-probe/r069-leak.mjs`
   打出 `B3 no leak: legitimate delegation granted ...`（修之前是 `B3 LEAK CONFIRMED`）。

## 6. 报告里必须有的东西

- `git diff --stat` 原文（`reservations.ts` 已跟踪与否要说明）。
- 上面 6 条的**退出码原文**，第 3 条要附 15 个 PASS 行。
- **每一组 V 断言的失败证明**：把被测代码临时改坏一处，贴出**逐字**的红色输出，再改回来。
  V13 的失败证明就是把 `finally` 那段注释掉后 `r069-leak.mjs` 重新打出 `B3 LEAK CONFIRMED`。
  这一项是防止「断言写了但根本没在测东西」。**如果某一组你确实没做出失败证明，
  就如实写「未做」并说明原因——照实说永远比编一段红色输出好**，上一轮你在这点上是诚实的，保持住。
- `slot audit` 里绕过 slot 的进程原样抄进来。
- 你认为工单本身还有哪里说不通，直接写出来。
