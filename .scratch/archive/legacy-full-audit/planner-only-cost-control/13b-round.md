[轮次] round_id=PENDING

# 任务：工单 13B —— 把累计预算显示到 status（只做渲染）

回信地址：**`w2E:pD`**（planner，claude）。做完必须用
`herdr agent prompt w2E:pD '<报告正文>'` 把报告发回这个 pane；你所在的 pane 没人看。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`。
**不提交、不切分支、不勾工单复选框、不改 `.scratch/` 下任何文件**（下面点名的日志除外）。

---

## 0. 环境规则（逐字遵守，你的全局规则文件可能没被加载）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时文件、临时目录、缓存或任务产物。
  任务内的中间文件放当前工作目录下一个名字清楚的可丢弃子目录；要放到工作目录之外时用 `/project/tmp`。
  这条同样适用于你调用的脚本、子进程和你委派出去的子 agent。
- **预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交。**
  本轮的验收命令属于这一类，必须写成 `slot cpu -- <命令>`。
- **启动重任务前先跑 `slot audit` 和 `slot status` 并写进日志**：
  `.scratch/planner-only-cost-control/p14-r068-slot-preflight.log`（这是唯一允许你写的 .scratch 文件）。
  禁止先跑重活、事后补查。
- `slot audit` 若发现绕过 slot 的其他重进程，**不得终止**，照实记录即可
  （已知本机有个 `htvc` 长期占约 20G，别动它）。
- 不要用 `slot slots` 调大槽位给自己插队。
- `.agent-dir/models.json`、`.agent-dir/auth.json` 含 API 凭据：不许读、不许打印、不许写进报告、不许提交。

## 1. 围栏

**只允许改这 4 个文件：**

```
orchestrate.ts  index.ts  orchestrate.test.mjs  index.test.mjs
```

只读（一个字节都不许改）：`usage.ts` `types.ts` `task.ts` `roles.ts` `review.ts` `report.ts`
`evidence.ts` `notify.ts` `floors.ts` `role-models.ts` `workspace-snapshot.ts` `package.json`，
以及 `usage.test.mjs` `task.test.mjs` `roles.test.mjs` `review.test.mjs` `evidence.test.mjs`
`architecture.test.mjs` `e2e.pi-subagents.test.mjs` `floors.test.mjs` 和 `.scratch/**`（第 0 节的日志除外）。

**本轮只做展示**：不许新增任何计算口径、不许改动账本、不许新增字段。你要显示的数字全部来自
上一轮已经落地并合入的两个纯函数，直接调用即可。

## 2. 已经有的东西（上一轮 `p14-r067` 落地，已提交 `8a22d1c`，直接用）

`usage.ts` 已导出（**不要重新实现，不要改它们**）：

```ts
summarizeTaskBudget(usage: TaskUsage, limits?: { tokens?: number; costUsd?: number }): TaskBudgetSummary
summarizeSessionUsage(ledger: UsageLedger): SessionUsageSummary
```

- `TaskBudgetSummary = { configured: boolean; tokens: BudgetDimension; costUsd: BudgetDimension; byRole: Record<string, RoleUsageSummary> }`
- `BudgetDimension = { limit?: number; known: number; unknownParts: number; remaining?: number }`
  —— `limit` / `remaining` 在该维度**没配置**时是 `undefined`；`remaining` **可能是负数**（超支），不许自己 clamp。
- `RoleUsageSummary = { calls: number; tokens: number; costUsd: number; costUnknownParts: number }`
  —— key 是 `"root"` 加上实际出现过的 `worker` / `reviewer` / `validator` / `explorer`。
- `SessionUsageSummary = { unattributed: { turns, tokens, costUsd, costUnknown }, tasks, totalTokens, totalCostUsd, costUnknownParts }`

累计预算的配置来自 `task.spec?.cumulativeBudget`（`types.ts` 里的 `TaskSpec.cumulativeBudget`，
形状 `{ tokens?: number; costUsd?: number }`）。**注意别和 `task.spec?.budget` 搞混**：后者是单次委派预算，本轮完全不碰。

**架构约束（有测试守着，违反必红）**：`orchestrate.ts` 里**不许出现** `UsageLedger`、`recordRootTurn`、`recordChild`
这三个标识符（`architecture.test.mjs:81-83`）。所以：

- **Task 级**预算块写在 `orchestrate.ts` 的 `renderTaskStatus`（约 `orchestrate.ts:1115`），只用 `summarizeTaskBudget`；
- **会话级**那两行写在 `index.ts` 的 `/planner-only status` 处理器（约 `index.ts:1085-1088`），那里有 `ledger`，用 `summarizeSessionUsage`。

## 3. 要输出的内容（格式冻结，逐字照抄，不要自己润色措辞）

### 3.1 `renderTaskStatus`：在 `return lines.join("\n")` 之前追加

若 `task.usage` 是 `undefined` → **什么都不追加**（不许显示编造的零）。

否则 `const budget = summarizeTaskBudget(task.usage, task.spec?.cumulativeBudget);`

金额一律格式化成 `$` + `toFixed(4)`（例：`$0.8630`）。token 直接输出整数，不加千分位。

**(a) 未配置累计预算**（`budget.configured === false`）——只追加一行，**不许出现「剩余」二字**：

```
Budget: 未设累计上限（已知消耗 tokens=<tokens.known>，费用 $<costUsd.known>；未知项 tokens <tokens.unknownParts> 项、费用 <costUsd.unknownParts> 项）
```

**(b) 配置了累计预算**（`configured === true`）——追加三行：

```
Budget (累计):
  tokens: <维度行>
  费用: <维度行>
```

维度行的规则（两个维度同一套）：

- 该维度 `limit === undefined`（另一个维度才配了）→
  `已用 <known>，未设累计上限，未知项 <unknownParts> 项`
- 该维度配了 `limit` →
  `已用 <known> / 上限 <limit>，剩余 <remaining>，未知项 <unknownParts> 项`
  - `unknownParts > 0` 时，在「剩余 <remaining>」后面紧跟 `（不含 <unknownParts> 个未知项）`，再接逗号和未知项那一段；
  - `remaining < 0` 时，在整行**末尾**追加 `（已超支）`。
- 费用维度的 `known` / `limit` / `remaining` 都按 `$` + `toFixed(4)` 输出；token 维度输出整数。

**(c) 角色分项**——紧接着追加（`byRole` 里 `calls === 0` 的角色**跳过**；`root` 排第一，其余按 key 字母序）：

```
Budget by role:
  - root: <calls> turns, tokens=<tokens>, 费用 $<costUsd>
  - worker: <calls> calls, tokens=<tokens>, 费用 $<costUsd>
```

某个角色 `costUnknownParts > 0` 时，在该行末尾追加 `，费用未知 <costUnknownParts> 项`。
`root` 那行用 `turns`，其余角色用 `calls`。若过滤后一个角色都不剩，则整个 `Budget by role:` 块不输出。

### 3.2 `index.ts` 的 `/planner-only status`

在现有 `if (active) { lines.push("", orchestrator.renderTaskStatus(active)); }` **之后**追加
（无论有没有 active Task 都要输出第一行）：

```
Session usage: tokens=<totalTokens>，已知费用 $<totalCostUsd>，未知项 <costUnknownParts> 项
```

再仅当 `unattributed.turns > 0 || unattributed.costUnknown === true` 时追加一行：

```
Unattributed (会话级，未归入任何 Task): <turns> turns, tokens=<tokens>, 费用 $<costUsd>
```

且 `unattributed.costUnknown === true` 时该行末尾追加 `，费用不可知`。

**这一行的数字绝不允许折进任何 Task 的数字里**——它存在的意义就是把 Task 创建前的 Root 用量单独摆出来。

## 4. 必须新增的测试

`orchestrate.test.mjs`（每条都断言**完整行的字符串**，不要只断言包含某个数字）：

- **U1** 没配 `cumulativeBudget` → 输出含 `未设累计上限`，且**整段 status 不含「剩余」**。
- **U2** 两个维度都配了 → 两行维度行逐字符合 3.1(b)，数字写死。
- **U3** 超支（`limit` 小于 `known`）→ 剩余是负数且行尾有 `（已超支）`。
- **U4** 只配 `costUsd` 不配 `tokens` → tokens 行是 `已用 …，未设累计上限，未知项 … 项`，费用行正常。
- **U5** 有未知项 → 出现 `（不含 N 个未知项）`。
- **U6** 同一角色重试两次 → `Budget by role` 里 worker 只有一行且 `2 calls`；没用过的角色不出现。
- **U7** `task.usage === undefined` → status 里完全没有 `Budget` 开头的行。

`index.test.mjs`：

- **U8** `/planner-only status` 输出含 `Session usage:` 行，数字与 `summarizeSessionUsage` 一致；
  存在 Task 创建前的 Root 轮次时含 `Unattributed (会话级，未归入任何 Task):` 行，
  且**该 Task 的 Budget 行里不含这部分 token**（把两个数字都写死断言）。

既有测试一条都不许改。

## 5. 验收（四条全部退出码 0）

```bash
slot audit  >  .scratch/planner-only-cost-control/p14-r068-slot-preflight.log 2>&1
slot status >> .scratch/planner-only-cost-control/p14-r068-slot-preflight.log 2>&1
slot cpu -- npm run typecheck
slot cpu -- npm test
slot cpu -- npm run test:e2e
git diff --check
```

`npm test` 里包含 `architecture.test.mjs`，它会检查 `orchestrate.ts` 没有 `UsageLedger` 等标识符——必须绿。

## 6. 报告（发回 `w2E:pD`）

1. `round_id=p14-r068`；
2. 改了哪些文件 + `git diff --stat` 原样粘贴；
3. 四条验收命令各自的**退出码**；
4. **逐字失败证明**：对 U1–U8 每一条，临时把实现改坏一处（例如把「未设累计上限」换成一个编造的余额、
   把 `remaining` clamp 到 0、把 `Unattributed` 的数字加进 Task、把 worker 重试拆成两行），
   **原样粘贴**失败输出（含文件名与行号），然后改回并说明改回后退出 0。
   **没有失败证明的断言按未交付处理。**
5. 新增输出的**实际样例**：把一个配了预算的 Task 的 status 完整贴回来（就是渲染结果本身）。
6. preflight 里 `slot audit` 是否发现绕过 slot 的进程（有就照写，不要终止）。

工单本身和代码现状对不上、或你觉得哪里写错了：**停下来把疑点发回 `w2E:pD`，不要自己换个说法实现。**
