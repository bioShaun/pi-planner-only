[轮次] round_id=PENDING

# 任务：工单 13A —— Task 累计预算账本（账本 + 配置，不做渲染）

回信地址：**`w2E:pD`**（planner，claude）。做完必须用 `herdr agent prompt w2E:pD` 把报告发回这个 pane；
你所在的 pane 没人看。报告格式见文末「## 报告」。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`。
本任务**不提交**、**不切分支**、**不勾工单复选框**、**不改 `.scratch/` 下任何文件**（除下面点名的日志）。

---

## 0. 环境规则（逐字遵守，你的全局规则文件可能没被加载）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时文件、临时目录、缓存、构建暂存或任务产物。
  任务内的中间文件放当前工作目录（用一个名字清楚的可丢弃子目录）；需要放在工作目录之外时用 `/project/tmp`。
  这条同样适用于你调用的脚本、子进程和你委派出去的子agent。
- **预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交。**
  本任务的验收命令属于这一类，必须写成 `slot cpu -- <命令>`。
- **每次启动重任务前必须先运行 `slot audit` 和 `slot status`，并把输出写入项目日志。**
  本轮的日志路径固定为 `.scratch/planner-only-cost-control/p14-r066-slot-preflight.log`（这是唯一允许你写的 .scratch 文件）。
  **禁止先启动重活、事后再补查。**
- `slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；应等待、降低本任务并发或在报告里写明资源冲突。
  （已知本机长期有一个 `htvc` 进程绕过 slot 占约 18G 内存，**不要动它**，照常记录即可。）
- 不要用 `slot slots` 调大槽位数给自己插队。
- `.agent-dir/models.json`、`.agent-dir/auth.json` 含 API 凭据：**不许读、不许打印、不许写进报告、不许提交**。

## 1. 围栏（fence）

**只允许改这 5 个文件：**

```
types.ts  task.ts  usage.ts  usage.test.mjs  task.test.mjs
```

只读（一个字节都不许改）：`orchestrate.ts` `index.ts` `roles.ts` `review.ts` `report.ts` `evidence.ts`
`notify.ts` `floors.ts` `workspace-snapshot.ts` `package.json` `tsconfig.json`，以及
`orchestrate.test.mjs` `index.test.mjs` `roles.test.mjs` `review.test.mjs` `evidence.test.mjs`
`architecture.test.mjs` `e2e.pi-subagents.test.mjs` `floors.test.mjs` 和 `.scratch/**`（第 0 节那个日志除外）。

**渲染/展示不在本轮范围**：不要碰 `renderUsage`，不要碰 `renderTaskStatus`，不要往 `/planner-only status` 加任何输出。
那是下一轮（13B）的活。本轮只交「可被渲染层调用的纯函数 + 配置字段」。

## 2. 已探明的事实（planner 已实跑验证，直接用，不要重新考古）

`UsageLedger`（`usage.ts`）已经具备大部分归属能力，**本轮不许新建第二套计费数据结构**：

- `ledger.recordRootTurn({ taskId?, state?, model?, provider?, usage, messageId? })`，
  `usage` 的形状是 `PiUsageLike`（`usage.ts:19`）：`{ input, output, cacheRead, cacheWrite, reasoning?, cost?, ... }`
  —— **是 camelCase，不是 `input_tokens` 那套**。
- 带 `taskId` **且** `state` 能映射出 phase 时记进该 Task 的 `root`；否则进 `ledger` 的会话级 `untasked` 桶。
  planner 实跑确认：Task 创建前的 Root 轮次**已经**留在 `untasked`，不会漏进 Task —— 本轮要做的是**别把它算进来**，并让它可被读出。
- `ledger.taskUsage(taskId)` 返回 `TaskUsage`（`types.ts:350`）：`{ root: RootUsage, children: ChildUsage[], rootModel?, costUnknown }`。
- `ledger.sessionUsage()` 返回 `{ untasked: RootUsage, tasks: string[] }`。
- `ChildUsage.kind` 已经是 `worker | reviewer | explorer | validator`，角色归属**不需要新字段**。
- `RootUsage.costUsd` 是**粘性 undefined**：任一轮次算不出价，整个桶的 `costUsd` 就变成 `undefined` 且不再恢复
  （`usage.ts:416-420`）。所以 Root 在费用维度最多贡献 **1 个**未知项，拿不到「哪一轮不可知」。这是既有行为，不要去改它。
- 定价查表 `lookupRates(pricing, provider, model)`：`PricingRates` 的字段是 `input/output/cacheRead/cacheWrite`，
  **单位是每 token**（不是每百万 token）。写测试时按这个单位造 `pricing.rates`。

planner 的探针脚本（可读，别改）：`.scratch/planner-only-cost-control/p14-probe/ledger-probe.mjs`，
`node --experimental-strip-types` 可直接跑，它已经把下面的口径跑通过一遍，你的实现要和它一致。

## 3. 要做的事

### R1 `types.ts`：新增累计预算字段，**不动**既有 `budget`

在 `TaskSpec`（`types.ts:131`）里 `budget` 之后加：

```ts
	/**
	 * Cumulative budget for the whole Task: every role, every retry, one balance.
	 * Distinct from `budget`, which bounds a single delegation and keeps its
	 * existing meaning unchanged.
	 */
	cumulativeBudget?: {
		tokens?: number;
		costUsd?: number;
	};
```

`budget` 的类型、语义、所有既有用法一律不动。

### R2 `task.ts`：校验与解析

- 校验函数里按 `budget` 现有那段（`task.ts:166-180`）的同样形状校验 `cumulativeBudget`：
  必须是对象；`tokens` / `costUsd` 出现时必须是**正的有限数**。错误信息逐字为：
  - `cumulativeBudget must be an object when present`
  - `cumulativeBudget.tokens must be a positive finite number`
  - `cumulativeBudget.costUsd must be a positive finite number`
- 解析路径（`task.ts:316-317` 那处 `parsed.budget` 的搬运）同样搬运 `cumulativeBudget`。
- **不要**把 `cumulativeBudget` 加进 `TASKSPEC_CHARACTERISTIC_FIELDS`（`task.ts:185`）。那个列表用于识别 TaskSpec 块，
  改它会改变提取行为，不在本轮范围。

### R3 `usage.ts`：新增纯函数 `summarizeTaskBudget`

导出以下类型与函数（名字逐字照用，13B 和工单 14 会按这些名字调用）：

```ts
export interface CumulativeBudgetLimits { tokens?: number; costUsd?: number }

export interface BudgetDimension {
	/** undefined when this dimension is not configured. */
	limit?: number;
	/** Sum of the components whose value is known. */
	known: number;
	/** How many components could not be valued at all. Never folded into `known`. */
	unknownParts: number;
	/** limit - known. undefined when limit is undefined. NEVER clamped: overspend must stay negative. */
	remaining?: number;
}

export interface RoleUsageSummary {
	calls: number;
	tokens: number;
	costUsd: number;
	costUnknownParts: number;
}

export interface TaskBudgetSummary {
	configured: boolean;
	tokens: BudgetDimension;
	costUsd: BudgetDimension;
	/** "root" plus one key per DelegationKind actually seen. Absent roles are absent, not zero-filled. */
	byRole: Record<string, RoleUsageSummary>;
}

export function summarizeTaskBudget(usage: TaskUsage, limits?: CumulativeBudgetLimits): TaskBudgetSummary;
```

**冻结口径（照抄，不要自己换个说法、不要“优化”）：**

1. 单个组件的 token 数 = `input + output + cacheRead + cacheWrite`。
   **不加 `reasoning`**：该字段并非所有 provider 都报，且与 `output` 的包含关系因 provider 而异，加进去可能重复计数。
   在函数上方注释里写明这一条。
2. `tokens.known` = Root 四项之和 + 所有 children 四项之和。
3. `tokens.unknownParts` = `root.tokensUnknownTurns` + `children.filter(c => c.pending || c.source === "unavailable").length`。
4. `costUsd.known` = `(root.costUsd ?? 0)` + Σ `(child.costUsd ?? 0)`。
5. `costUsd.unknownParts` = `(root.costUsd === undefined ? 1 : 0)` + `children.filter(c => c.costUsd === undefined).length`。
   Root 最多贡献 1，原因见第 2 节的粘性说明，写进注释。
6. `remaining` = `limit === undefined ? undefined : limit - known`。**不许 clamp 到 0**，超支就是负数。
7. **未知项不抵扣余额**：`unknownParts` 只报数，不参与 `known` 也不参与 `remaining`。
   （这是本轮刻意的保守口径；把未知项算成负债是工单 15 的事，本轮不做，在注释里写明。）
8. `configured` = `limits?.tokens !== undefined || limits?.costUsd !== undefined`。
9. `byRole`：`"root"` 由 `usage.root` 得到（`calls = root.turns`，`costUnknownParts = root.costUsd === undefined ? 1 : 0`）；
   其余按 `child.kind` 聚合。**同一角色的重试合并进同一个桶**（worker 跑三次就是 `worker.calls === 3`），
   不许为重试新开桶、不许重新发一份预算。

### R4 `usage.ts`：新增 `summarizeSessionUsage`

```ts
export interface SessionUsageSummary {
	/** Session-level usage that belongs to no Task (pre-Task Root turns, unattributable children). */
	unattributed: { turns: number; tokens: number; costUsd: number; costUnknown: boolean };
	tasks: string[];
	/** Whole-session tokens: unattributed + every task's root and children. */
	totalTokens: number;
	/** Whole-session known cost. Unknown components are counted in costUnknownParts, never as 0 spend. */
	totalCostUsd: number;
	costUnknownParts: number;
}

export function summarizeSessionUsage(ledger: UsageLedger): SessionUsageSummary;
```

只能通过既有的 `ledger.sessionUsage()` / `ledger.taskUsage()` 读数。
`unattributed` 必须来自 `sessionUsage().untasked`，**绝不允许**把它折进任何一个 Task（尤其不许折给最后一个 active Task）。

### R5 不许做的事

- 不许新增任何持久化文件、任何新的 Map/缓存、任何「预算余额」字段存进 `TaskRecord` 或 usage 日志。
  两个 summarize 都是**按需计算的纯函数**，Usage 仍是唯一事实来源。
- 不许改 `recordRootTurn` / `recordChild` / `resolvePending` / `taskUsage` / `sessionUsage` / `load` / `drain` 的行为。
- 不许改 `renderUsage` 一个字节。
- 不许改动或删除任何既有测试用例的断言。

## 4. 必须新增的测试（`usage.test.mjs` / `task.test.mjs`）

每一组都要有独立断言，且都要在报告里给**逐字失败证明**（见第 6 节）：

- **T1 单一账本 + 角色分项**：一个 Task 依次经历 Root planning / executing / reviewing 三轮，
  再加 worker、validator、reviewer、explorer 各一次子委派，**外加第二次 worker（重试）**。
  断言：全部进同一个 summary；`byRole.worker.calls === 2`；重试没有另开桶；`byRole` 里出现且仅出现实际用过的角色。
- **T2 Task 创建前的 Root 轮次不进 Task**：先记一条无 `taskId` 的 Root 轮次，再建 Task 并记账。
  断言：`summarizeTaskBudget` 的 `tokens.known` **精确等于** Task 创建之后那些组件的手算和（把数字写死在断言里），
  且 `summarizeSessionUsage(ledger).unattributed.turns === 1`、其 tokens 等于那条轮次的手算值。
- **T3 未配置累计预算**：`summarizeTaskBudget(usage)` → `configured === false`，
  且**两个维度的 `remaining` 都是 `undefined`**（不许出现编造的余额数字）。
- **T4 配置了累计预算**：两个维度都给出 `limit / known / unknownParts / remaining`；
  再加一条**超支**用例：`limit` 小于 `known` 时 `remaining` 是**负数**，不是 0。
- **T5 未知项**：造一个模型查不到价的 child（`costUsd === undefined`）和一条 token 全零的 Root 轮次。
  断言：费用维度的 `unknownParts` 计到了这个 child，`known` 没有把它当成 0 花销偷偷吃掉；
  token 维度的 `unknownParts` 计到了那条全零轮次。
- **T6 `task.ts` 校验**：`cumulativeBudget` 为非对象 / `tokens: 0` / `tokens: -1` / `costUsd: "x"` 各自产出第 R2 节那三条逐字错误信息之一；
  合法的 `cumulativeBudget` 能完整通过提取路径带出来；**只带 `budget`（不带 `cumulativeBudget`）的老 TaskSpec 行为与改动前完全一致**。
- **T7 会话合计**：`summarizeSessionUsage` 的 `totalTokens` 等于「未归属 + 所有 Task 的 root 与 children」的手算和（数字写死）。

## 5. 验收（四条全部退出码 0）

先做 preflight 并写日志：

```bash
slot audit  >  .scratch/planner-only-cost-control/p14-r066-slot-preflight.log 2>&1
slot status >> .scratch/planner-only-cost-control/p14-r066-slot-preflight.log 2>&1
```

然后：

```bash
slot cpu -- npm run typecheck
slot cpu -- npm test
slot cpu -- npm run test:e2e
git diff --check
```

四条都必须退出 0。`npm test` 里既有的 usage / task 用例必须全绿且**未被改动**。

## 6. 报告

用 `herdr agent prompt w2E:pD` 发回，必须包含：

1. `round_id=p14-r066`；
2. 改了哪些文件 + `git diff --stat` 原样粘贴；
3. 四条验收命令各自的**退出码**；
4. **逐字失败证明**：对 T1–T7 每一组，临时把被测代码改坏一处（比如把重试合并去掉、把 `remaining` clamp 到 0、
   把未知项算进 `known`、把 `untasked` 折进 Task），**原样粘贴**测试报出的失败输出（含文件名与行号），
   然后改回来并说明改回后退出 0。**没有失败证明的断言按未交付处理**——上一轮就是因为少一条证明被打回。
5. preflight 日志里 `slot audit` 是否发现绕过 slot 的进程（有就照写，不要终止它）。

有任何一处你觉得工单本身写错了、或和代码现状对不上：**停下来把疑点发回 `w2E:pD`，不要自己换个说法实现**。
