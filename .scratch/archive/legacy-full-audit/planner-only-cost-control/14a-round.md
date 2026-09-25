[轮次] round_id=p15-r069

# 工单 14A：启动前原子预留与取严下传（受控委派的真正封顶）

你是本轮唯一的写入者。做完后把报告发回 **`w2E:pD`**（planner，claude）：
`herdr agent prompt w2E:pD "<你的报告>"`。不要在自己的 pane 里等我来看。

---

## 0. 环境规则（逐条照做，不得放宽）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时目录、缓存、构建暂存或任务产物。
  本轮的中间文件放当前工作目录 `.scratch/planner-only-cost-control/` 下；需要放到工作目录之外时用 `/project/tmp`。
  这条对 shell 命令、脚本、工具、子进程和你委派的子代理一律适用。
- **预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交。**
  本轮的验收命令用 `slot cpu -- ...`。
- **每次启动重任务前必须先运行 `slot audit` 和 `slot status`，并把输出写入项目日志**
  （本轮写 `.scratch/planner-only-cost-control/p15-r069-slot-preflight.log`）。禁止先启动重活、事后再补查。
- `slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；应等待、降低本任务并发或报告资源冲突。
- 不要用 `slot slots` 调大槽位数来给自己插队。
- `.agent-dir/models.json` 和 `.agent-dir/auth.json` 含 provider API key：**不得读取、不得回显到报告里、不得提交**。

## 1. 围栏（scope fence）

**只允许你改这 5 个文件：**

```
reservations.ts      （新建）
floors.ts
orchestrate.ts
floors.test.mjs
orchestrate.test.mjs
architecture.test.mjs
```

- `usage.ts` / `types.ts` / `task.ts` / `index.ts` / `roles.ts` **只读**，一个字都不许改。
- `package.json` / `tsconfig.json` 只读。**例外**：`reservations.ts` 是新文件，必须加进 `package.json` 的 `files` 数组
  （`architecture.test.mjs` 会查这一条）——**只允许这一处 package.json 改动**。
- `.scratch/` 只读，唯一例外是你自己的 `p15-r069-slot-preflight.log`。
- `spec.md` 和 `issues/` 下任何文件都不许动。
- **不要 commit**，不要勾任何工单的 checkbox。提交由我来做。

## 2. 背景：这一轮要堵的洞（我已实跑复现，数字是真的）

工单 13 已经落地了「累计账本」：`TaskSpec.cumulativeBudget` + `summarizeTaskBudget()`。
但它**只是个仪表盘**——算得出余额，没人按余额拦人。我实跑复现如下（`.scratch/planner-only-cost-control/p15-probe/t14-probe2.mjs`）：

一个 `cumulativeBudget: { tokens: 50000, costUsd: 0.20 }` 的 Task，已经烧掉 48000 tokens / $0.19，
剩 **2000 tokens / $0.01**。此时发起两次并发的受控重试委派，实际下传的是：

```
A3 remaining tokens: 2000 cost: 0.010000000000000009
A4 retry down-passed usageBudget: {"tokens":{"hard":40000},"costUsd":{"hard":0.1}} toolBudget: {"hard":20}
A6 concurrent down-passed usageBudget: {"tokens":{"hard":40000},"costUsd":{"hard":0.1}}
A7 OVERSUBSCRIPTION: two in-flight children may each spend 40000 + 40000 tokens against a remaining balance of 2000
```

余额 2000，却给两个孩子各发了 40000 的额度。**本轮就是修这个。**

## 3. 我已经替你验证过的事实（照用，不要重新试错）

1. **别用 `createTaskSpec()` 造带预算的 spec。** 它是测试专用 helper，**会静默丢掉 `budget` 和
   `cumulativeBudget`**（`task.ts` 的 `createTaskSpec` 根本没有拷这两个字段，`CreateTaskSpecInput` 里也没有）。
   我第一次探测就栽在这：`spec.cumulativeBudget` 打印出来是 `undefined`。
   **真实路径是把原始 JSON 塞进 prompt**，由 `extractTaskSpecDetails` 解析——测试里请直接 `JSON.stringify({...})` 手写 spec。
   **不要为了让 `createTaskSpec` 支持预算而去改 `task.ts`，它在围栏外。**
2. **`agent` 名字必须是已知角色名**，否则 `resolveDelegationTarget` 返回 `undefined`，`prepareRoleDelegation` 直接空转。
   合法值见 `roles.ts` 的 `AGENT_ROLES`：`explorer` / `scout` / `reviewer` / `oracle` / `validator` / `worker`。
   我用 `agent: "builder"` 试过，整个 prepare 静默什么都不做。
3. **唯一能拒绝启动的地方是 `PlannerOrchestrator.beginDelegation()`**，返回 `{ block: { reason: string } }`；
   `index.ts:897` 收到后 `return { block: true, reason }`。四种 kind（worker/validator/reviewer/explorer）
   都从这个函数走 `this.delegations.set(...)`，没有旁路。
4. **`beginDelegation` 里 `task.usage` 与 `spec.cumulativeBudget` 都拿得到**：
   `target?.task?.usage`、`target?.task?.spec?.cumulativeBudget`。
   `summarizeTaskBudget(usage, limits)` 返回 `{ configured, tokens, costUsd, byRole }`，
   其中 `tokens`/`costUsd` 是 `BudgetDimension = { limit?, known, unknownParts, remaining? }`，
   **`limit` 未配置时 `limit` 和 `remaining` 两个键都不存在**，`remaining` 永不 clamp（超支就是负数）。
5. **`orchestrate.ts` 里现在有正好 5 处 `this.delegations.delete(`**（我数过：`grep -c` 得 5），
   分别在 `reconcileDelegation`、超期顶替、启动失败、异步回执、异步通知五条终结路径上。
6. `floors.ts` 的 `resolveEffectiveLimits()` 已经是「多候选取最小并记来源」的结构，
   `LimitSource = "floor" | "caller" | "taskSpec"`。**注意它的 `else` 分支**：当某维度没有 floor 时
   （例如 reviewer 角色三个维度都没有 floor），现在只在 caller / taskSpec 之间挑。
7. 我已实跑验证了本轮算法可行（`.scratch/planner-only-cost-control/p15-probe/reserve-proto.mjs`），输出：
   ```
   C1 grant: {"tokens":2000,"costUsd":0.010000000000000009} (floor was {"tokens":40000,"costUsd":0.1})
   C2 second: {"refused":"tokens","available":0}
   C3 with balance cap 2000 -> tokens should stay 500 (caller): 500 | cost should be 0.01 (balance): 0.01
   C4 refusal: {"dimension":"costUsd","available":0,"knownTokens":1000,"knownCost":0.2,...}
   C5 unconfigured grant: {} refused: false
   ```
   **这两个 probe 文件只许读，不许改。**

## 4. 冻结的设计（照抄语义，措辞不要自己换）

### 4.1 新模块 `reservations.ts`

导出一个 `BudgetReservations` 类，持有 `taskId -> (toolCallId -> {tokens?, costUsd?})`。

- `inFlight(taskId): { tokens: number; costUsd: number }` —— 该 Task 当前所有在途预留之和。
- `reserve(taskId, budget, desired): ReserveOutcome` —— **必须是一个同步函数体，中间不许有任何 `await`**。
  这就是「原子」的全部含义：检查余额与写入预留在同一个同步块内完成，中途不给事件循环插队的机会。
  - 可用额度 `available(dim) = dim.limit - dim.known - inFlight`，`dim.limit === undefined` 时为 `undefined`（不设限）。
  - **任一已配置维度的 `available <= 0` 即拒绝**，返回 `{ refused: { dimension, available, held, budget } }`，
    先判 `tokens` 再判 `costUsd`（顺序冻结，测试要依赖）。
  - 否则按维度取 `min(available, desired)` 写入预留并返回 `{ grant }`。未配置的维度不出现在 `grant` 里。
  - **不要引入 epsilon 或任何取整**。`available` 是极小正数时就照发——那会让宿主立刻按预算停机，这是正确行为。
- `release(taskId, toolCallId): void` —— 幂等，重复调用不报错。

**不许**在这个模块里 import `usage.ts` 之外的任何本项目模块，不许 import `index.ts`，不许 import `@earendil-works/*`。

### 4.2 `floors.ts`：新增 `balance` 候选

- `LimitSource` 增加 `"balance"`，成为 `"floor" | "caller" | "taskSpec" | "balance"`。
- `ResolveLimitsOptions` 增加 `balanceTokens?: number` 和 `balanceCostUsd?: number`。
- 这两个值**参与 tokens / costUsd 两个维度的取最小**，和 floor / caller / taskSpec 平权。
  **toolBudget 维度不受影响**——余额没有工具次数这个量纲。
- **关键：`else` 分支也要加。** 某维度没有 floor 时（reviewer），balance 仍然要能单独成为生效上限。
  换句话说：只要 balance 有值，它就必须进入候选集合，无论有没有 floor。
- 平手时（数值相等）保持现有「先到者胜」的比较写法（`c.value < best.value` 才替换），
  候选压入顺序冻结为：**floor → caller → taskSpec → balance**。

### 4.3 `orchestrate.ts`：检查—预留—拒绝—释放

- `PlannerOrchestrator` 持有一个 `BudgetReservations` 实例。
- 在 `beginDelegation` 里，**在 `stripDelegationKeys(input)` 之前**：
  1. 取 `task = target?.task`；`task?.usage` 或 `task.spec?.cumulativeBudget` 缺一则**不做任何预留、不拒绝**，
     保持今天的行为（未配置累计预算的 Task 一切照旧）。
  2. `summarizeTaskBudget(task.usage, task.spec.cumulativeBudget)` 取余额，
     调 `reserve(task.taskId, budget, { toolCallId, tokens: <当前 floorLimits.tokens?.value>, costUsd: <floorLimits.costUsd?.value> })`。
  3. 被拒 → `return { block: { reason: <见 4.4> } }`，且**不得**留下任何预留、不得 `delegations.set`。
  4. 通过 → 用 `resolveEffectiveLimits({..., balanceTokens: grant.tokens, balanceCostUsd: grant.costUsd })`
     重算 `floorLimits`，并把重算结果写回 `input.usageBudget`（`{ tokens: { hard }, costUsd: { hard } }`，
     只写有值的维度），同时更新 `DelegationRecord.floorLimits` / `floorSummary`。
     `formatFloorLimitsSummary` 因此会打印 `(balance)` 作为来源——这是意料之中的，不要抑制。
- **重试与 Reviewer 一律计入同一个累计余额，不重置。** reviewer 委派同样要走预留和可能的拒绝。
- **释放**：新增一个私有方法
  ```ts
  private endDelegation(toolCallId: string): void {
      const record = this.delegations.get(toolCallId);
      this.delegations.delete(toolCallId);
      if (record) this.reservations.release(record.taskId, toolCallId);
  }
  ```
  把现存 **5 处** `this.delegations.delete(...)` 全部改成 `this.endDelegation(...)`。
  改完之后 `orchestrate.ts` 里 `this.delegations.delete(` 必须**只剩 1 处**，就是 `endDelegation` 内部那一处。

### 4.4 冻结的拒绝文案（测试按字面断言，一个字都不要改）

```
Planner-only guard: task <taskId> cumulative budget exhausted (<dimension>).
已知消耗: tokens=<n>, 费用 $<x.xxxx>
在途预留: tokens=<n>, 费用 $<x.xxxx>
未知项: tokens <n> 项, 费用 <n> 项
上限: tokens=<limit|未设>, 费用 $<limit|未设>
本次受控启动被拒绝；结束在途子进程或提高 cumulativeBudget 后重试。
```

- `<dimension>` 取 `tokens` 或 `costUsd`（原样英文，不翻译）。
- 金额一律 `.toFixed(4)`，token 一律整数。
- 未配置的维度上限位置写 `未设`。
- **未知项只报告、不折算。** 沿用工单 13 冻结的语义：unknown 既不计入 `known`，也不从 `remaining` 里扣。
  不要因为有未知项就拒绝启动。

## 5. 必须写的测试（每组都要有逐字失败证明，见 §7）

**V1（floors.test.mjs）** balance 小于 floor → 生效值是 balance，`source === "balance"`。
**V2（floors.test.mjs）** caller 比 balance 更严 → 生效值是 caller；balance 比 caller 更严 → 生效值是 balance。
**V3（floors.test.mjs）** reviewer 角色（无 floor）只给 balance → 生效值是 balance。这条专门守 §4.2 的 `else` 分支。
**V4（floors.test.mjs）** balance 只影响 tokens / costUsd，`toolBudget` 的生效值和来源与不传 balance 时完全一致。
**V5（orchestrate.test.mjs）** 余额 2000 tokens / $0.01、floor 40000 / $0.1 的受控委派：
  实际下传的 `usageBudget` 是 `{ tokens: { hard: 2000 }, costUsd: { hard: 0.01 } }`（cost 用 `Math.abs(x-0.01) < 1e-9` 比较）。
  这条直接对应 §2 复现出来的缺陷。
**V6（orchestrate.test.mjs）** 两次并发受控委派：第二次拿到的额度等于「余额减去第一次预留」；
  若因此归零则第二次被拒绝，`outcome.block.reason` 匹配 `/cumulative budget exhausted \(tokens\)/`。
**V7（orchestrate.test.mjs）** 费用耗尽而 token 未耗尽 → 被拒绝且 `reason` 里的维度是 `costUsd`，不是 `tokens`。
**V8（orchestrate.test.mjs）** 拒绝文案逐字包含 Task id、已知消耗、在途预留、未知项四段（按 §4.4 断言整块文本）。
**V9（orchestrate.test.mjs）** 一次委派结束（走任一终结路径）后预留被释放：
  同一 Task 的下一次委派重新拿到完整余额。
**V10（orchestrate.test.mjs）** Reviewer 委派也计入同一余额、也能被拒绝；
  且连续两次重试不会让 `known` 消耗被重置。
**V11（orchestrate.test.mjs）** `cumulativeBudget` 未配置的 Task：下传值与本轮改动前**完全一致**，不拒绝、不加 `(balance)`。
**V12（architecture.test.mjs）** ①`orchestrate.ts` 中 `this.delegations.delete(` 恰好出现 1 次；
  ②`reservations.ts` 在 `package.json` 的 `files` 里；
  ③`reservations.ts` 不含 `from "./index.ts"` 也不含 `@earendil-works`。

## 6. 验收命令（必须用 slot 跑，四条都要退出码 0）

```bash
slot audit  > .scratch/planner-only-cost-control/p15-r069-slot-preflight.log 2>&1
slot status >> .scratch/planner-only-cost-control/p15-r069-slot-preflight.log 2>&1
slot cpu -- npm run typecheck
slot cpu -- npm test
slot cpu -- npm run test:e2e
git diff --check
```

`npm test` 必须整套绿，不允许「只跑我改的那个文件」。

## 7. 失败证明（硬性要求，不许省）

对 **V1–V12 每一组**，逐一做：把被测的那个行为**临时改坏**（例如把 balance 候选从取最小改成忽略、
把 `available <= 0` 改成 `< 0`、把 `endDelegation` 里的 release 注释掉、把拒绝文案里的「在途预留」那行删掉），
跑一次测试，**把红色失败输出逐字贴进报告**，然后**改回来**。

报告里必须写清楚每组「改了什么 → 报了什么错」。

**如果你没做失败证明，就在报告里直说没做，不要编。** 上一轮的执行者就是老实说没做，我自己补跑了，
那没有任何问题；编一份假的才是问题。同样，如果某条改坏之后测试**依然通过**，那说明这条断言是空的——
**如实报告，不要为了好看去修饰**，这正是这一步存在的意义。

## 8. 报告格式

发回 `w2E:pD`，包含：
1. 改动文件清单 + `git diff --stat` 原文；
2. §6 四条命令的**退出码**；
3. V1–V12 的失败证明（或明确说明未做）；
4. `slot audit` 里若有绕过 slot 的进程，列出 PID/RSS 并说明你没有终止它们；
5. 任何你认为工单本身写错了的地方——**发现工单有毛病要说出来，不要将就着实现**。
