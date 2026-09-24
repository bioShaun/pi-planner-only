[轮次] round_id=p16-r076

# 工单 37：一个 Task 的**第一次**委派完全绕过累计预算闸门

你是本轮唯一的写者。工作目录 `/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`，
HEAD `90e3b23`。**本轮不 commit、不勾任何 checkbox、不动 `spec.md`。**

---

## 0. 环境规则（逐字遵守，不得放宽）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时目录、缓存、构建暂存或任务产物。
  任务局部的中间文件放当前工作目录（用一个名字清楚的一次性子目录）；
  需要放到工作目录之外时用 `/project/tmp`。这条同样约束你派出去的子任务。
- **预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交。**
  本轮 `npm test` / `test:e2e` / typecheck 都要走 `slot cpu -- <命令>`。
- **每次启动重任务前必须先运行 `slot audit` 和 `slot status`，并把输出写入项目日志**
  （`.scratch/planner-only-cost-control/p16-r076-slot.log`）。
- `slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；应等待、降低本任务并发或报告资源冲突。
  **禁止先启动重活、事后再补查。**（预告：现在有个 `pbbwa` 进程 RSS 约 50G 绕过了 slot，
  不要动它，记录下来串行跑即可。）
- **不要用 `slot slots` 调大槽位数给自己插队。**
- `.agent-dir/models.json` 和 `.agent-dir/auth.json` 存放 provider API key，
  **不得读取、不得回显到报告里、不得提交**。

---

## 1. 病灶（我已实跑坐实，你不必重新发现，但要能复现）

`beginDelegationInner` 里那段「检查—预留—盖 grant」的入口条件是 `budgetTask = target?.task`
（`orchestrate.ts:740-741`）：

```ts
const budgetTask = target?.task;
const cumulativeBudget = (budgetTask?.spec as ...)?.cumulativeBudget;
if (role !== "reviewer" && budgetTask?.usage && cumulativeBudget && typeof cumulativeBudget === "object") {
```

**创建 Task 的那一次委派，走到这一行时 store 里还没有这条记录**——记录要到本函数后面
`orchestrate.ts:1012/1017` 的 `store.create()` 才出现。于是整段被跳过：
不检查、不预留、不盖 grant，`resolveEffectiveLimits` 也拿不到 `balanceTokens/balanceCostUsd`。

实测（探针 `.scratch/planner-only-cost-control/p16-probe/r075-first-delegation-ungated.mjs`，
`cumulativeBudget = {tokens: 200000, costUsd: 0.05}`）：

```
usageBudget handed to call-first:  {"tokens":{"hard":100000},"costUsd":{"hard":0.5}}
first delegation blocked? no
在途预留 present after 1st? false
second delegation blocked? YES: ... cumulative budget exhausted (costUsd).
```

**第一个子进程拿到的单次硬上限是 $0.50，而整个 Task 的累计预算是 $0.05——十倍。**
闸门要到第二次委派才开始工作。对**只委派一次**的 Task（最常见的形态），`cumulativeBudget` 等于没生效。

次生后果两条：第一个子进程没有 grant，工单 15 的有界负债对它是空的；
D4 的 `在途预留` 行也不显示它。

---

## 2. 改法（已定稿，不要另起炉灶；有异议先停下来报告）

完整论证在 `.scratch/planner-only-cost-control/design-15-16-decisions.md` §E，先读它。摘要：

**D1.** 预留点不动。当 `target?.task` 为空、而 `spec?.cumulativeBudget` 存在且是对象时，
用 `emptyTaskUsage()` + 该 `cumulativeBudget` 现算一份 budget，预留挂在 `spec.taskId` 上。
`orchestrate.ts:703/712` 已确认：新 Task 时 `targetSpec === spec === target.spec`，
所以要读的就是 `spec.cumulativeBudget` / `spec.taskId`。

新 Task 余额是满的，**检查那一半必然通过**；真正起作用的是另一半：
把 grant 喂给 `resolveEffectiveLimits` 的 `balanceTokens/balanceCostUsd`，
让第一个子进程的 `usageBudget.hard` 受累计预算约束，并盖上 grant。

我已实跑核验过形状（`p16-probe/r077-empty-budget-shape.mjs`）：

```
tokens  dim: {"limit":200000,"remaining":200000,"known":0,"unknownParts":0,"debt":0}
costUsd dim: {"limit":0.05,"remaining":0.05,"known":0,"unknownParts":0,"debt":0}
reserve outcome: {"grant":{"tokens":100000,"costUsd":0.05}}   ← 被夹到整份 Task 预算
2nd reserve    : {"refused":{"dimension":"costUsd","available":0,...}}
```

**D2（键的风险，必须处理，否则比不改更糟）.** `spec.taskId` 不一定就是入库的 id：
`shouldReplaceTaskId` 分支会用 `store.nextTaskId()` 另生成一个，原 id 只留作别名
（`orchestrate.ts:1009-1012`）。而 `endDelegation` 是按 `record.taskId` 释放的（`orchestrate.ts:573` 的 `endDelegation`）。
键不对 → 预留**永久泄漏**，且 `inFlight(真 taskId)` 看不见它 → D4 不显示、闸门不计数。

因此给 `reservations.ts` 加：

```ts
rekey(fromTaskId: string, toTaskId: string, toolCallId: string): void
```

在 `task = this.store.create(storedSpec, spec.taskId);`（`orchestrate.ts:1012`）**之后立刻**调用它改键。
`store.create` 在本文件有三处（1012 / 1017 / 1079）：只有 1012 那处会换 id，另外两处入库 id 就是 `spec.taskId`
（1079 是无 spec 的自动建 Task，压根没有 `cumulativeBudget`），所以只有 1012 需要 rekey——但这一点请你自己核实一遍，别只信我。
`rekey` 的语义你自己定，但必须满足：源不存在时是无害的 no-op；改完之后
`inFlight(from)` 不再包含它、`inFlight(to)` 包含它；源 Task 的 map 空了要删掉（跟 `release` 一致）。

**D3.** 其余一切不动。grant 盖章、D4 披露、工单 15 的负债都是按 `toolCallId` 走的，改键之后自动正确。

**D4.** `role !== "reviewer"` 这个既有豁免保持不变——预算耗尽的 Task 必须仍然关得掉。

**D5.** 已存在的 Task（`task start` 建的、或 `existing` 分支命中的）行为必须**一个字不变**。

---

## 3. 允许改的文件（其余只读）

`orchestrate.ts`、`reservations.ts`、`orchestrate.test.mjs`、`architecture.test.mjs`、
`.scratch/planner-only-cost-control/p16-r076-*.log`。

不要改 `index.ts`、`usage.ts`、`task.ts`、`ledger-store.ts`、`index.test.mjs`，
不要动 `.scratch` 下除自己日志外的任何文件，不要改 `issues/` 里的 checkbox。

---

## 4. 验收（四条都要，日志留在 `.scratch/planner-only-cost-control/p16-r076-*.log`）

1. `slot cpu -- npm run typecheck` 退出 0
2. `slot cpu -- npm test`：前 16 个 suite 全部打印 `: PASS`；
   允许且**只允许** `naming.test.mjs` 失败于
   `AssertionError [ERR_ASSERTION]: extension install is missing <某个文件>`
   （分支未上 main 的既有闸门）。出现任何别的失败都算没过。
3. `slot cpu -- env PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` 退出 0
4. `git diff --check` 退出 0

另外跑一遍 `node --experimental-strip-types .scratch/planner-only-cost-control/p16-probe/r075-first-delegation-ungated.mjs`
并把**完整输出**贴进报告。修好之后它应当变成：

- `usageBudget handed to call-first` 的 `costUsd.hard` **不超过 0.05**（不再是 0.5）；
- `在途预留 present after 1st?` 为 **true**；
- 第二次委派仍然被拒。

**不要修改这个探针文件。** 它是我留的基线。

---

## 5. 逐条失败证明（本轮的硬要求，不做等于没做）

你新加的**每一条**断言，都要单独证明它不是空转：
针对该断言施加一个**只针对它**的变异，跑它所在的测试文件，
把**逐字的失败输出**（含 `文件:行号` 与断言 message）贴进报告。

- **合并成一组只证明了一条——不接受「这几条一起证」。**
- 如果某条断言在变异后不是第一个失败的，把先失败的那条**临时注释掉**再跑，
  直到失败定位到目标行；报告里写清你为此中和了哪些行。
- 负向断言（「不应该出现 X」）**不能**用「把功能删掉」来证明——那证明的是反向。
  要用**反向变异**（让 X 真的出现）来证明。
- 我会自己独立重跑一遍全套空转审计。上一轮我 48 条全跑了，其中一条是我自己的变异写错、
  不是你的断言有问题——所以请把你的变异写清楚，方便我复核。

---

## 6. 报告

回信给 **planner pane `w2E:pD`**（这是回信地址，必须用 `herdr agent prompt w2E:pD '<正文>'`），
同时把全文写到 `.scratch/planner-only-cost-control/p16-r076-report.log`。

报告要包含：改了哪些文件、`slot audit`/`slot status` 原文、四条验收的退出码与关键输出、
探针的完整输出、逐条失败证明、以及**你认为我这份工单里写错或自相矛盾的地方**
（上一轮你提的 8 条里有 2 条是我写错了，请继续这么做）。

**不 commit、不勾 checkbox。**
