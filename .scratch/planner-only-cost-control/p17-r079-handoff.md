[轮次] round_id=p17-r079

# 工单 16-c：预算停止之后的收尾能力（pin 住现状 + 补一行停止状态）

你是本轮唯一的写者。**报告发回 planner pane `w2E:pD`**（`herdr agent prompt w2E:pD '<报告全文>'`）。
你没有继承任何上下文，本文件是全部输入。

## 0. 环境硬规矩（必须遵守，与本仓库无关但对本机是硬约束）

- **绝对不要在 `/tmp` 或其子目录下创建任何中间文件/临时目录/缓存/构建产物**。
  任务内的临时文件放在当前工作目录下一个清楚命名的可丢弃子目录；
  需要放在工作目录之外时用 `/project/tmp`。
- 预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，**一律用 `slot` 提交**：
  `slot cpu -- <命令>`。本轮的 `npm test` / `npm run test:e2e` 属于这一类。
- **启动这类重命令之前，必须先跑 `slot audit` 和 `slot status`，把输出写进
  `.scratch/planner-only-cost-control/p17-r079-slot.log`。**
  `slot audit` 若发现绕过 slot 的其他重进程，**不得终止它们**；只能等待、降低自己的并发或在报告里说明资源冲突。
  禁止先跑重活、事后补审计。不要用 `slot slots` 调大槽位给自己插队。
- **绝对不要读取、打印或提交 `.agent-dir/models.json`、`.agent-dir/auth.json`**，里面是 API key。

## 1. 工作目录与背景

工作目录 `/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`，`HEAD=64b21c7`。
这是一个 pi 编辑器扩展，用 `node --experimental-strip-types` 直接跑 `.ts`。

本仓库有一条「累计预算闸门」：TaskSpec 里带 `cumulativeBudget: {tokens, costUsd}` 时，
每次受控付费委派（`tool_call` 钩子里的 subagent 调用）在启动前先向
`BudgetReservations.reserve()` 申请预留；余额不够就直接 block，理由是
`Planner-only guard: task <id> cumulative budget exhausted (<dimension>).`
**reviewer 角色按设计豁免这条闸门**（预算花光的 Task 也必须还能被关掉）。

工单 16 还剩两条没做：

> - [ ] 预算停止后：status 可查；Root 可记录非通过 Verdict；此前已启动的子进程返回后仍被结算与记录。
> - [ ] 预算停止不改变写锁与 Task 状态机的现有规则。

## 2. planner 已经实跑核过的结论（不要重新推翻，但要 pin 住）

我（planner）写了两个探针并跑通，逐字日志在
`.scratch/planner-only-cost-control/p17-r079-planner-probe-aftermath.log` 与 `...-corners.log`，
探针源码在 `.scratch/planner-only-cost-control/p17-probe/r079-budget-stop-aftermath.mjs`
和 `r079-budget-stop-corners.mjs`（**这两个文件本轮只读，不许改**）。结论：

**上面两条 checkbox 描述的行为，当前代码已经全部成立。** 具体实测：

1. 停止期间 `/planner-only task <id>` 照常渲染，Budget 块、`在途预留` 行都在。
2. 停止之前就已启动的子进程回来时**仍然被结算与记录**：usage 计入（实测超支到
   `已用 $0.0550 / 上限 $0.0500，剩余 -$0.0050（已超支）`），WorkerReport 入库，状态照常
   `executing → changes_requested`。
3. 该子进程**回来时 usage 缺失**也照样结算：按工单 15 的有界负债记成
   `已用 $0.0500（其中 $0.0500 是 1 个未知项按授予额度估算，非实测）`、`费用未知 1 项`。
4. 停止之后 Root 仍能记录**非通过 Verdict**：`request_changes` 与 `blocked` 都返回 `isError=false`。
   （唯一会被拒的情形是既有生命周期规则：没有 WorkerReport、或还有子进程未回执——与预算无关。）
5. 写锁不受影响：在途写者持锁期间，另一个**同 cwd** 的 Task 的写者被拒，理由是
   `already holds the write lock for <cwd>`，不是预算理由。
6. 被预算拒掉的那次委派**不改变 Task 状态**（`executing` → 仍 `executing`），
   也**不泄漏预留**（`在途预留` 的「N 个子进程未回执」不变）。
7. 对照组（预算给到 $5、永不停止）跑同一段序列（Root 先记 blocked、子进程后落地），
   最终状态与预算停止组**完全一致**（都是 `blocked → changes_requested`）。
   也就是说预算停止确实没有改变状态机。

**所以本轮的价值不在改行为，而在于：这七条现在一条断言都没有，会静默回退。**
本轮的主要交付是把它们钉死。

## 3. 唯一要改的行为（D1 + D2）

探针里查出一个会误导用户的真问题：**停止是由「在途预留占满」造成时，status 上的
`剩余` 仍然显示满额。** 逐字实测（`...-corners.log` 最后一段，子进程挂住不回执）：

```
State: blocked
  费用: 已用 $0.0000 / 上限 $0.0500，剩余 $0.0500，未知项 0 项；宿主未强制该维度，仅事后观测
  在途预留: tokens=40000, 费用 $0.0500（1 个子进程未回执）
new delegation on the abandoned Task blocked? YES: ... cumulative budget exhausted (costUsd).
```

用户看到「剩余 $0.0500」却被告知「budget exhausted」，只会当成 bug。

**不要去改 `剩余` 的算法。** `剩余` 的语义是「已花掉之外的余额」，工单 14/15/16 的闸门与
`summarizeTaskBudget` 都建立在这个语义上，动它会波及一大片。改法是**加一行停止状态**。

### D1 — `reservations.ts`：把「够不够」抽成一个纯函数

新增方法（放在 `reserve()` 之前）：

```ts
/**
 * Would a new reservation be refused right now? Pure: reads the held map,
 * mutates nothing. reserve() and the status renderer must share this so the
 * line the user reads can never drift from the gate that refuses them.
 */
wouldRefuse(taskId: string, budget: ReservationBudget): ReservationRefusal | undefined {
	const held = this.inFlight(taskId);
	const availableTokens = budget.tokens.limit === undefined
		? undefined
		: budget.tokens.limit - budget.tokens.known - held.tokens;
	const availableCostUsd = budget.costUsd.limit === undefined
		? undefined
		: budget.costUsd.limit - budget.costUsd.known - held.costUsd;
	if (availableTokens !== undefined && availableTokens <= 0) {
		return { dimension: "tokens", available: availableTokens, held: held.tokens, budget: budget.tokens };
	}
	if (availableCostUsd !== undefined && availableCostUsd <= 0) {
		return { dimension: "costUsd", available: availableCostUsd, held: held.costUsd, budget: budget.costUsd };
	}
	return undefined;
}
```

**`reserve()` 必须改成调用它**，不许把这段算术复制两份——两份就会分叉，那正是这一行要防的事。
`reserve()` 里 grant 用的 `availableTokens/availableCostUsd` 可以从返回值以外重新算，
但**判拒绝这一步必须走 `wouldRefuse`**：

```ts
reserve(taskId, budget, desired) {
	const refused = this.wouldRefuse(taskId, budget);
	if (refused) return { refused };
	...  // 其余不变
}
```

### D2 — `orchestrate.ts`：status 上加一行停止状态

位置：Task status 的 Budget 块里，**紧接在 `在途预留` 那行之后**
（当前在 `orchestrate.ts:1389-1394` 一带，`const inFlight = this.reservations.inFlight(task.taskId);` 那段）。
条件：`budget.configured` 为真、该 Task 不在 `untrustedBalances` 里（那条分支更早就 return 了）、
且 `this.reservations.wouldRefuse(task.taskId, budget)` 返回了 refusal。

**这段代码我已经在本地原型跑通过（typecheck 0、16 个套件全 PASS、e2e 0），照抄即可，措辞一个字都不要改：**

```ts
				// Ticket 16-c: the stop the gate enforces must be legible here. When the
				// balance is held by in-flight children rather than spent, 剩余 still reads
				// full, so the refusal looks like a bug unless this line says otherwise.
				const stop = this.reservations.wouldRefuse(task.taskId, budget);
				if (stop) {
					const dimension = stop.dimension === "tokens" ? "tokens" : "费用";
					const unaffected = "reviewer 不受此限；status、Root 的 Verdict、已在途子进程的结算都不受影响。";
					lines.push(stop.held > 0
						? `  预算已停止（暂时）: ${dimension} 余额已被 ${this.reservations.heldCount(task.taskId)} 个在途子进程预留占满，新的受控付费委派会被拒绝；子进程回执后未用完的部分会退回。${unaffected}`
						: `  预算已停止: ${dimension} 已用满，新的受控付费委派会被拒绝。${unaffected}`);
				}
```

两个分支我都实测渲染过：

```
  在途预留: tokens=100000, 费用 $0.0500（1 个子进程未回执）
  预算已停止（暂时）: 费用 余额已被 1 个在途子进程预留占满，新的受控付费委派会被拒绝；子进程回执后未用完的部分会退回。reviewer 不受此限；...
```
```
  费用: 已用 $0.0550 / 上限 $0.0500，剩余 -$0.0050，未知项 0 项（已超支）；宿主未强制该维度，仅事后观测
  预算已停止: 费用 已用满，新的受控付费委派会被拒绝。reviewer 不受此限；...
```

### D2b — 一条既有断言会因此变红，必须按下面改（这是我授权的唯一一处既有测试改动）

`orchestrate.test.mjs` 的 **Y3b**（当前在 5454 行附近）钉住「`在途预留` 的下一行是 `Root:`」，
而新行正插在两者之间。**只改这一条**，把

```js
	assert.equal(costIdx >= 0 && lines[costIdx + 1] === "  在途预留: tokens=100000, 费用 $0.5000（1 个子进程未回执）" && lines[costIdx + 2].startsWith("  Root:"), true);
```

改成

```js
	// 16-c: the stop line the reservation causes sits between them.
	assert.equal(costIdx >= 0 && lines[costIdx + 1] === "  在途预留: tokens=100000, 费用 $0.5000（1 个子进程未回执）" && lines[costIdx + 2].startsWith("  预算已停止（暂时）:") && lines[costIdx + 3].startsWith("  Root:"), true);
```

**除 Y3b 外不许改任何既有断言。** 如果你发现还有别的既有断言变红，**停下来报告，不要自己改**——
我原型跑完 16 个套件只有 Y3b 一条红，多出来的就是你引入的回归。

（顺带说明一个会让你困惑的现象：默认 floor 是 `costUsd $0.5`，所以只要 Task 的
`cumulativeBudget.costUsd ≤ $0.5`，**第一个在途子进程就会把余额整份预留掉**，
于是「预算已停止（暂时）」在只有一个子进程在跑的常见情形下就会出现。这是准确的——
那一刻第二次委派确实会被拒——所以措辞里写了「（暂时）」和「未用完的部分会退回」。不要因此改判定。）

**不要**改 `cumulativeBudgetRefusal` 的文案，**不要**动闸门本身的判定，**不要**改 `剩余` 的计算。

## 4. 要写的断言（D3）

写在 `orchestrate.test.mjs`（行为）与 `architecture.test.mjs`（文本闸门）里。
每条都要能独立失败——见第 6 节的失败证明要求。

**A 组：新行为（D1/D2）**

- A1 `wouldRefuse` 在余额充足时返回 `undefined`。
- A2 `wouldRefuse` 在已用打满时返回 `dimension: "costUsd"`（或 tokens），且 `held === 0`。
- A3 `wouldRefuse` 在余额被在途预留占满时返回 refusal，且 `held > 0`。
- A4 `wouldRefuse` 是纯的：连调两次，`inFlight()` 与 `heldCount()` 前后不变。
- A5 `reserve()` 与 `wouldRefuse()` 一致：同一状态下 `reserve` 拒绝 ⟺ `wouldRefuse` 返回 refusal，
  且 `dimension` 相同。
- A6 status 在「花光」型停止下出现 `预算已停止: 费用 已用满` 行，且**不含**「（暂时）」。
- A7 status 在「预留占满」型停止下出现 `预算已停止（暂时）:` 行，含「预留占满」与正确的 `<N>` 个子进程。
- A8 未停止时 status **不出现** 任何以 `  预算已停止` 开头的行（反向断言）。
- A9 该行提到 reviewer 不受此限。
- A10 未设 `cumulativeBudget` 的 Task 不出现该行。

**B 组：pin 住第 2 节那七条现状（本轮不改代码，只补断言）**

- B1 停止期间 `/planner-only task <id>` 正常渲染：不抛异常，输出里有 `Budget (累计):`。
- B2 停止之前启动的子进程回来后，usage 被计入（`已用` 反映它），WorkerReport 入库
  （`task.reports.length` +1），状态按既有规则推进。
- B3 同上但该子进程 usage 缺失：按工单 15 记有界负债，`未知项 1 项` 且 `已用` 含
  `按授予额度估算，非实测`。
- B4 停止后 Root 记录 `request_changes` 成功（有 report、无在途子进程时）。
- B5 停止后 Root 记录 `blocked` 成功。
- B6 写锁不变：在途写者持锁期间，另一个**同 cwd** Task 的写者被拒，理由包含
  `already holds the write lock`，**不含** `cumulative budget exhausted`（这是负向断言，要反向变异）。
- B7 被预算拒掉的委派不改变 Task 状态（前后 `task.state` 相等）。
- B8 被预算拒掉的委派不泄漏预留（`heldCount` 前后相等）。
- B9 reviewer 在停止后仍不被拒。
- B10 对照：预算充足时跑同一段「Root 先记 blocked、子进程后落地」序列，
  终态与预算停止组相同——即停止没有改变状态机。

**C 组：`architecture.test.mjs` 文本闸门**

- C16-10 `reservations.ts` 含 `wouldRefuse(taskId`。
- C16-11 `reservations.ts` 的 `reserve(` 里调用了 `this.wouldRefuse(`（防止算术被复制两份）。
- C16-12 `orchestrate.ts` 含 `预算已停止`。

## 5. 围栏（改这些，其余只读）

**可改：** `reservations.ts`、`orchestrate.ts`、`orchestrate.test.mjs`、`architecture.test.mjs`，
以及新增 `.scratch/planner-only-cost-control/p17-r079-*.log` 日志。

**只读，一个字都不许改：** `.scratch/planner-only-cost-control/spec.md`、
`.scratch/planner-only-cost-control/issues/` 下所有文件、`.scratch/planner-only-cost-control/p17-probe/`
下所有探针、`ledger-store.ts`、`task.ts`、`index.ts`、`usage.ts`、其余全部源码与测试。

**不许 commit。不许勾任何 checkbox。不许 `git add`。** 改动留在工作区，planner 复核后自己提交。

## 6. 验收（四条全部要跑，逐字贴日志）

先按第 0 节写好 `p17-r079-slot.log`，然后串行走 slot：

```bash
npx tsc --noEmit -p tsconfig.json ; echo "typecheck exit=$?"
slot cpu -- npm test ; echo "npm test exit=$?"
slot cpu -- env PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e ; echo "e2e exit=$?"
git diff --check ; echo "diff-check exit=$?"
```

- typecheck 必须 `exit=0`（我原型实测 0）。
- `npm test`：16 个套件必须全部打印 `: PASS`。**只允许 `naming.test.mjs` 失败**
  （既有闸门：安装副本里缺 `ledger-store.ts`，本分支未并 main，与本轮无关；
  **注意它的失败输出走 stderr**，别以为没输出就是过了），因此整体 `exit=1` 是预期的。
- e2e 必须 `exit=0`。
- `git diff --check` 必须 `exit=0`。

另外**原样重跑**我的两个探针（不许改它们），把输出贴进报告：

```bash
node --experimental-strip-types .scratch/planner-only-cost-control/p17-probe/r079-budget-stop-aftermath.mjs
node --experimental-strip-types .scratch/planner-only-cost-control/p17-probe/r079-budget-stop-corners.mjs
```

第 2 节那七条结论必须仍然逐条复现；corners 最后一段的 `RAW STATUS` 块里现在应当多出
`预算已停止（暂时）:` 那行，aftermath 结尾的完整 status 里应当多出 `预算已停止: 费用 已用满` 那行。
跑完把仓库根下残留的 `.p17-probe-*` / `.planner-only-*` 沙盒清掉（它们被 gitignore，但别留着）。

## 7. 逐条失败证明（本仓库的硬要求，不做等于没做）

**每一条**新断言（A1–A10、B1–B10、C16-10..12）都要单独证明它非空转：

- 针对该断言的语义做一个**尽量窄**的变异（改源码，不是改测试），跑它所属的那个套件，
  贴出**逐字**失败输出（含文件名与行号），确认第一条红的就是目标断言；然后还原。
- **负向断言（B6 的「不含 cumulative budget exhausted」、A8 的「不出现该行」）必须用反向变异**：
  制造出那个不该出现的东西，看断言是否变红。
- 变异要和断言的语义一样窄。**越界的变异会先炸在别处，而别处未必有断言可中和**——
  如果你的变异没让目标断言变红，**先怀疑你自己的变异写错了**，再考虑断言空转。
  本仓库前几轮的教训：改到一个根本不含目标字面量的键、或者顺手把更早一个测试块的前置状态干掉，
  都会让你误判成「断言无效」。
- 一次变异一条断言，不许把几条合成一组证明。

把每条的变异描述 + 逐字失败输出写进报告（可以放
`.scratch/planner-only-cost-control/p17-r079-vacuity.log` 再在报告里摘要，但摘要不能代替逐字输出）。

## 8. 报告回 `w2E:pD` 时要包含

1. 改了哪些文件、各 +/− 多少行。
2. 四条验收的逐字输出与 exit code。
3. 两个探针的逐字输出。
4. 逐条失败证明（23 条）。
5. 你不同意工单的地方（如果有）——**不要擅自改工单的判断，写进报告，由 planner 裁决。**
6. 你在实现中发现的、本轮没做的问题。

不 commit。报告发完就停。
