# 16: 重复拒绝熔断 —— 同工具 + 同 refusal code + 逐字相同参数的重发必须被机器打断

Status: done（2026-09-16；refusal-breaker.ts 纯状态机 + index.ts 三处共用 withRefusalBreaker，tool_call 预拦截，session_start 重置；集成测试随票 17 拆面落在 planner_redelegate 上）

## 问题

票 13 / 14 / 15 都在修拒绝文案。三次宿主实证（2026-09-16 两个 session、`TASK_UNKNOWN` 与 `TASKSPEC_VALIDATION_INCOMPLETE` 两种 code）表明文案修复无法根治：模型读懂并复述了正确的下一步（"Omitting invented task"），然后**原样重放上一次的参数对象**。session `01a0a9cc-7abb-7362-b5d6-d309ab6212a6` 的两次 `planner_delegate` 调用 `call_cWyY…` / `call_O7RL…` arguments 逐字相同（`taskId: "T-20260918-015"`），而第二次的拒绝文本已经是票 13/14 落地后的版本。

拒绝文本是给模型**读**的；只有比较**实际发射**的机制才能证伪"我这次改了"的叙述。这是整族问题（任何守卫的任何 refusal）的通用防线，不是某一条 refusal 的文案问题。

## 要求

### R1. 新模块 `refusal-breaker.ts`

纯函数式、无 I/O 的 session 级状态机，供 `index.ts` 所有 Root 工具的 `execute` 包装层复用。

```ts
export interface RefusalObservation {
	count: number;                 // 该 (toolName, argsHash) 连续被同一 code 拒绝的次数，含本次
	previousToolCallId?: string;   // 上一次被拒的 toolCallId
	notice?: string;               // count >= 2 时追加到拒绝文本的段落；count 1 时 undefined
	hardStop: boolean;             // count >= HARD_STOP_AT
}

export class RefusalBreaker {
	observeRefusal(toolName: string, toolCallId: string, params: unknown, error: unknown): RefusalObservation;
	observeSuccess(toolName: string, params: unknown): void;   // 同 key 成功 → 清除条目
	shouldBlock(toolName: string, params: unknown): { block: true; reason: string } | { block: false };
	reset(): void;   // session_start 调用
}
```

- **key** = `toolName + ":" + sha256(canonicalJson(params))`。`canonicalJson` 递归按键名排序、去除值为 `undefined` 的键，使键序差异不算"不同参数"。
- **refusal code** 提取顺序：`error.code`（`DelegationRefused.code`、`TaskSpecContractError.code`）→ 否则取 `error.message` 第一行。
- 同 key 再次被拒且 code 相同 → `count += 1`；code 不同 → 视为有进展，`count` 重置为 1。
- 常量：`NOTICE_AT = 2`，`HARD_STOP_AT = 3`，`BLOCK_AT = 4`。

### R2. 判定"什么算 refusal"

只计**预启动拒绝**，不计已启动执行后的异常终止。`isRefusal(error)` 为真当且仅当：

- `error instanceof DelegationRefused`（`delegate.ts:430-440`），或
- `error instanceof TaskSpecContractError`（`task.ts:406-413`），或
- `error.message` 匹配 `/^(planner_delegate|planner_verdict|git_commit) refused\b/` 或 `/^planner_verdict: unknown task\b/`。

`DelegationAborted`（`delegate.ts:447-458`）、以 `details.termination` 返回的异常结束、store-error 一律**不计**。

### R3. 分级行为

| count | 行为 |
|---|---|
| 1 | 原拒绝原样抛出，无附加 |
| 2 | 原拒绝末尾追加一段：`Repeat notice: these arguments are byte-identical to refused call <previousToolCallId> (same refusal <code>). The change you described was not emitted — read back the arguments you actually sent before calling again.` |
| 3 | 在 2 的基础上前置一行 `STOP: this exact call has now been refused 3 times with <code>. Do not call <toolName> again with these arguments. Report the received arguments verbatim to the user and wait for instruction.`；若 `ctx.hasUI`，`ctx.ui.notify(..., "warning")` 让人类看见 |
| ≥ 4 | `tool_call` hook（`index.ts:1035-1071`）在执行前用 `shouldBlock` 拦下：`{ block: true, reason: "planner-only: identical call refused 3 times with <code>; blocked. Change the arguments or ask the user." }` |

原拒绝文本（含票 13/14/15 的恢复指引）在所有档位都保留，追加不替换。

### R4. 接线点

- `index.ts` `planner_delegate` `execute` 的 catch（`index.ts:806-819`）：`isRefusal(error)` 为真时调用 `observeRefusal`，把 `notice` 拼进 rethrow 的 message（对 `DelegationRefused` 需重建实例以保留 `code` / `taskId`，或直接改 `error.message`——实现者选一种并在测试中锁定 `code` 不丢）。成功路径调用 `observeSuccess`。
- `planner_verdict`（`index.ts:846` 起）与 `git_commit`（`index.ts:670` 起）的 `execute`：同样包装。三处应共用一个 `withRefusalBreaker(toolName, toolCallId, params, ctx, fn)` 高阶函数，避免三份复制。
- `tool_call` hook：在现有 `decidePolicy` 之前，对 `ROOT_TOOLS ∪ {git_commit}` 调 `shouldBlock`。
- `session_start`（`index.ts:991`）调 `reset()`。

### R5. 打包与架构

- `package.json` `files` 加入 `refusal-breaker.ts`；`architecture.test.mjs` 加对应 `pkg.files.includes` 断言（参照 `architecture.test.mjs:74-95` 既有模式）。
- 该模块不 import `index.ts`、不 import pi 运行时；只依赖 `node:crypto` 与 `delegate.ts` / `task.ts` 的错误类（或仅鸭子类型检查 `.code` / `.name`，由实现者选，但要在测试里锁定对两种错误类实例都成立）。

## 验收标准

- `refusal-breaker.test.mjs`（新）：
  - 同 toolName、键序不同但内容相同的 params → 同 key。
  - 连续三次同 code 拒绝 → count 1/2/3，第 2 次起 `notice` 含 `previousToolCallId` 与 code，第 3 次 `hardStop === true`；第 4 次 `shouldBlock` 返回 `block: true`。
  - code 变化 → count 重置为 1；同 key 成功 → 条目清除，再次拒绝从 1 起。
  - `DelegationAborted`、普通 `Error("boom")` → `isRefusal` 为假，不计数。
  - 对 `DelegationRefused` 与 `TaskSpecContractError` 实例都能提取 code。
- `index.test.mjs` 或 `delegate.test.mjs`（视既有 harness 在哪一层可触达 registered tool）：以 `taskId: "T-20200101-001"` 连续调三次 `planner_delegate`，第 2 次拒绝文本含 `Repeat notice`，第 3 次含 `STOP`，三次 `code` 均仍为 `TASK_UNKNOWN`，launcher 0 次调用、Task 0 铸造；第 4 次在 `tool_call` 层被 block。
- 票 13/14/15 既有断言（`delegate.test.mjs:248-286`、`660-710`）对**首次**拒绝逐字不变。
- `node --experimental-strip-types refusal-breaker.test.mjs`、`delegate.test.mjs`、`index.test.mjs`、`architecture.test.mjs`、`policy.test.mjs` 与 `npx tsc --noEmit` 全绿。

## 非目标

- 不改任何守卫的拒绝语义或 code。
- 不做跨 session 持久化；进程重启即清零。
- 不做"语义相近"参数比较，只做逐字（canonical JSON）比较。

## 关联

- 票 15 改进方向 3 的升级：当时标可选，现有第三次实证，升为必做。
- 票 13 / 14 / 15：本票是它们共同的防御纵深；票 17 是消除入口。
- 票 17 落地后 `TASK_UNKNOWN` 在创建路径上不再可达，但本票对 `planner_redelegate`、`planner_verdict`、`git_commit`、`TASKSPEC_*` 仍然有效。

## Comments

- 2026-09-16（开票）：来源为 session `01a0a9cc` 原始 toolCall arguments 逐字比对（两次 `taskId: "T-20260918-015"` 相同）+ `index.ts` / `delegate.ts` / `policy.ts` 接线点逐行核对。
- 2026-09-16（落地）：R4 选直接改 `error.message`——不重拆 `DelegationRefused`，原实例的 `code` / `taskId` / `name` / `stack` 全部保留，`refusal-breaker.test.mjs` 已锁定。`isRefusal` 用鸭子类型（`.name` + `.code` 提取，message 前缀兜底），不 import delegate/task。`shouldBlock` 只作用于 `ROOT_TOOLS ∪ {git_commit}`。注意接线后票 17 把带 `taskId` 的调用面移到 `planner_redelegate`——集成用例因此走新工具名，`planner_delegate` 上同参数不再产生 refusal（会铸新 Task，这正是 17 要的行为）。
