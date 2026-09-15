# 07: 进度与取消 —— UPDATE 事件进 `onUpdate`，abort 走 CANCEL 并落 `cancelled` 终态，孤儿子进程处置

Status: ready-for-agent（2026-09-15 由 needs-triage 展开；行号基于 ce1cea1，即 08 落地后的树）
Blocked by: 04（verified）、08（done，ce1cea1——本票只碰 `delegate.ts` / `subagent-delegation-contract.ts` / `index.ts` 的 `planner_delegate` 注册，08 之后 `delegate.ts` 是唯一委派入口）
Type: task

**What to build：** 把宿主已经提供、但我们一直丢在地上的两条通路接上。(a) **进度**：`createHostLauncher` 订阅 `SUBAGENT_DELEGATION_UPDATE_EVENT`，按身份三元组过滤后经 `runDelegation` 推给 `execute` 的第 4 个参数 `onUpdate`，TUI 在委派阻塞的 1–5 分钟里能看到子进程在干什么。(b) **取消**：`signal` abort 时 launcher 已会 emit CANCEL，但随即退订并 reject，把 pi-subagents 随后发来的 `cancelled` 终态（含 usage）丢掉，`runDelegation` 把它记成 `failed`——改为等一个有界的宽限期收终态，Task 进 `blocked`、usage 落账（06 的 G4）。(c) **孤儿**：`session_shutdown` 时对在飞委派 best-effort 发 CANCEL；`-p` 模式没有工具级软中止入口，SIGINT 会留孤儿，这一条按票 03 的实测写进 README 限制。

设计与去向表见 [spec.md 轮 3](../spec.md)。ADR：[0001](../../../docs/adr/0001-typed-delegation-contract.md)。08 交回：[08-handback.md](../08-handback.md)。

## 现状（写票时核过的事实）

1. **宿主签名早就带着这两个参数。** `pi-agent-core` `types.d.ts:349`：`execute(toolCallId, params, signal?, onUpdate?)`，`onUpdate: (partialResult: AgentToolResult) => void`（`:338`）。`index.ts:768` 的 `planner_delegate` execute 把第 4 参命名为 `_onUpdate`，从未调用；`signal` 已透传到 `runDelegation`（`{ signal, executionId: toolCallId }`）。
2. **UPDATE 的载荷形状不在我们的契约副本里。** `subagent-delegation-contract.ts`（116 行）复制了五个事件名和 Request/Started/Response/Cancel，**漏了 `SubagentDelegationUpdate`**。上游 pi-subagents@0.67.0 `src/api/delegation.ts:51-62`：
   ```ts
   export interface SubagentDelegationUpdate extends SubagentDelegationStarted {
     runId?: string; currentTool?: string; currentToolArgs?: string;
     recentOutput?: string; recentOutputLines?: string[];
     recentTools?: Array<{ tool: string; args: string }>;
     model?: string; toolCount?: number; durationMs?: number; tokens?: number;
   }
   ```
   桥接层（`src/slash/prompt-template-bridge.ts:339-345`）每次子进程 `onUpdate` 都会转成这个形状并 emit，但用 `sameStructuredDelegationUpdateProgress`（`:86-98`）对**上一条**去重——比较字段不含 `durationMs`，所以只有 tool/输出/模型/计数/tokens 变化才发新事件，纯计时不发。
3. **CANCEL 在桥接层是可用的。** `prompt-template-bridge.ts:158-175`：收到 `{requestId, ownerRunId, nodeId}`（且**不能有多余键**）→ `attemptControllers.get(key).abort()`；子进程被中止后，同一 attempt 会 emit 一条 `SUBAGENT_DELEGATION_RESPONSE_EVENT`，`status: "cancelled"`（`:352-368`，正常返回路径带 `aborted` 标志经 `toSubagentDelegationResponse` 映射为 cancelled；抛错路径直接构造 cancelled）。也就是说**取消是有终态的，而且终态带 usage**（如果 pi-subagents 拿到了）。
4. **我们的 launcher 把这条终态扔了。** `delegate.ts:760-796` `createHostLauncher`：`onAbort` → emit CANCEL → `cleanup()`（退订 RESPONSE）→ `reject(new Error("planner_delegate aborted: …"))`。`runDelegation:386-393` 把 launch 抛错一律记为 `failed` + `stateReason = "delegation launch failed: planner_delegate aborted: …"`。而同文件 `:69` `BLOCKING_STATUSES` 明确把 `cancelled` 映射为 `blocked`（delegate.test.mjs:262 有断言）。同一件事两条路径两个终态——取消走 signal 是 `failed`，取消走 launcher 终态是 `blocked`。
5. **G4 就在这里。** `runDelegation:458-470` 与 `runReviewInvocation:624-635` 只在 `status === "completed"` 路径落 usage；非 completed 终态（cancelled / timed_out / tool_budget_exhausted / failed）在 `:396-407` 直接 throw，`response.usage` 丢弃。06 票明确把它交给 07（06:134「07 做 cancel 时一并处理」）。
6. **写锁在 finally 里释放**（`:528`），abort 抛错也会走到，本票不用动它。
7. **票 03 的孤儿实测**（03:141）：`-p` 模式下 INT 打在委派在飞时父进程直接死、无 `cancelled` 终态落盘、子进程 `sleep 300` 变孤儿；TUI Esc 中止工具回合的路径**未测**。宿主的 Esc 语义是给 `execute` 的 `signal` 发 abort（这正是通路 (b)）；`-p` 没有这个入口。
8. **测试夹具**：`delegate.test.mjs` 的假 launcher 形状是 `async (request) => response`（`:54/:100/:301/:411`），不带 signal 也不带事件；`index.test.mjs` 的假 `pi` 没有 `events` 字段，`createHostLauncher(pi)` 在那里从未被真正驱动。launcher 本身目前零单测。
9. **06 的 G3（model / thinking / toolBudget / timeoutMs 不设）与 08 的 K3（探索工具预算等 07/G3 接线）**：这两项不在本票——本票只接 `onUpdate` 与 abort/终态语义，不改 Request 的字段集。K3 的 `toolBudget` 接线是另一张票（见承接项），但它依赖本票把「非 completed 终态也落账」做对，否则 `tool_budget_exhausted` 的花费会像现在的 cancelled 一样消失。

## 范围

**改**：`subagent-delegation-contract.ts`（补 `SubagentDelegationUpdate`）、`delegate.ts`（`createHostLauncher`、`DelegationDeps.launch` 签名、`DelegationOptions`、`runDelegation` / `runReviewInvocation` 的 abort 与非 completed 落账、新增纯渲染函数）、`index.ts`（`planner_delegate` execute 透传 `onUpdate`；`session_shutdown` best-effort CANCEL）、`delegate.test.mjs`（新增 launcher 与进度/取消用例）、`index.test.mjs`（假 `pi` 补 `events`，一条透传断言）、README.md / README.zh-CN.md（**只加**一段「取消与孤儿」限制，其余 README 改动归 10）。
**不改**：`types.ts`、`orchestrate.ts`、`task.ts`、`policy.ts`、`usage.ts`（`childUsageFromValue` 现成够用）、`concurrency.ts`；Request 字段集（G3）不动。

## 设计

### D1. 契约副本：补 `SubagentDelegationUpdate`

`subagent-delegation-contract.ts` 在 `SubagentDelegationStarted` 之后逐字加入上游 0.67.0 的 `SubagentDelegationUpdate`（见现状 §2），文件头注释的「copied from」段补一句 Update。**验收用 diff 而不是靠眼睛**：把副本里的五个事件名常量与 `SubagentDelegationUpdate` 字段名列表，和 `~/.pi/agent/npm/node_modules/pi-subagents/src/api/delegation.ts` 的同名声明做文本比对（naming.test.mjs 已有「读已安装包」的先例，`:24-29`，新断言放在那里或 delegate.test.mjs 都可；安装包缺席时 skip 并打印原因，不算通过）。

### D2. `delegate.ts` 的 launcher 契约

```ts
export interface DelegationLaunchHooks {
  /** 每条按身份三元组过滤后的 UPDATE。调用方不得阻塞。 */
  onUpdate?: (update: SubagentDelegationUpdate) => void;
}
export interface DelegationDeps {
  …
  launch: (request: SubagentDelegationRequest, signal?: AbortSignal, hooks?: DelegationLaunchHooks) => Promise<SubagentDelegationResponse>;
}
export interface DelegationOptions {
  signal?: AbortSignal;
  executionId?: string;
  /** 宿主 execute 的 onUpdate；runDelegation 把 SubagentDelegationUpdate 渲染成 AgentToolResult 局部结果后转发。 */
  onUpdate?: (partial: { content: { type: "text"; text: string }[]; details: DelegationProgressDetails }) => void;
}
```

第三参可选：既有假 launcher `async (request) => response` 不用改，tsc 也不会报（少一个参数是兼容的）。

**`createHostLauncher(pi)` 改成：**

1. 订阅 `SUBAGENT_DELEGATION_UPDATE_EVENT`，用与 RESPONSE 相同的三元组过滤（`requestId` 必等；`ownerRunId` / `nodeId` 存在则必等），命中调 `hooks?.onUpdate(payload)`。UPDATE 订阅随 RESPONSE 一起在 `cleanup()` 退订。
2. **abort 不再立刻 reject。** `onAbort`：emit CANCEL（payload 保持严格三键，桥接层 `:163` 多一个键就忽略）→ 保持 RESPONSE 订阅 → 启动宽限计时器 `cancelGraceMs`（默认 5000，`createHostLauncher(pi, { cancelGraceMs })` 可调，单测传 0–50ms）。宽限内收到匹配终态 → `resolve(response)`（预期 `status: "cancelled"`，也接受任何终态）；宽限到期 → `reject(new DelegationAborted(request.nodeId))`。`DelegationAborted extends Error`，`name = "DelegationAborted"`，导出。
3. 已 `settled` 后到达的任何事件一律忽略（现状已如此）。
4. 进程级在飞表：模块级 `const inFlight = new Map<string, SubagentDelegationCancel>()`，REQUEST 发出时登记、settle 时删除；导出 `cancelInFlightDelegations(pi): number`——对每条登记 emit CANCEL，返回条数。给 D5 的 shutdown 用。

**为什么等终态而不是立刻 reject**：桥接层在 abort 后会补发 `cancelled` 终态（现状 §3），只有拿到它 Task 才能按 `BLOCKING_STATUSES` 的既定语义进 `blocked`，usage 才能落账。5 s 是给 pi-subagents 杀子进程和 emit 的时间；宿主验证要测这个窗口够不够（见「宿主验证」第 3 条），不够就在交回里给实测值，票不预设更长的默认。

### D3. `runDelegation` / `runReviewInvocation`

1. **进度转发**：把 `options.onUpdate` 包成 `hooks.onUpdate = (u) => options.onUpdate?.(renderDelegationProgress(role, task.taskId, u))` 传给 `deps.launch`。`renderDelegationProgress` 是纯函数（导出，单测直测）：
   - `text`：一行摘要 `planner_delegate <role> <taskId>: <durationMs/1000 取整>s · <toolCount ?? 0> tools · <currentTool ?? "…">` + 最多 3 行 `recentOutputLines`（各截到 200 字符，用 `slice`，不 split、不 match）；
   - `details: DelegationProgressDetails = { taskId, role, runId?, currentTool?, toolCount?, durationMs?, tokens?, progress: true }`——`progress: true` 让终态的 `details.report` 消费者能区分局部结果。
   - **固定条**：这里是显示，不是解析。`recentOutput` / `recentOutputLines` 原样截断展示，不从中提取任何字段；`currentToolArgs` 不展示（可能含路径与命令，Root 不该借此偷看子进程 shell）。
2. **abort 语义统一**：`:386-393` 的 catch 分成两支——`error instanceof DelegationAborted || options.signal?.aborted` → `transition(task, "blocked")` + `stateReason = "delegation cancelled by operator; no terminal response within grace"`；其余保持 `failed` + 现有文案。reviewer 分支（`:606`「launch throw propagates as-is」）不动 Task，只把 `DelegationAborted` 原样抛出。
3. **G4：非 completed 终态落账。** 在 `:396-407` throw 之前，若 `response.usage` 存在，走与 completed 相同的 `childUsageFromValue(...)` + `deps.usage.recordChild(task.taskId, child)`，`source` 与 completed 路径一致；`ChildUsage.outcome`（types.ts:675）是 `"succeeded" | "failed" | "unknown"` 三值，非 completed 终态一律落 `outcome: "failed"`，终态原文放进 `stateReason`（已有），不扩 `types.ts` 的联合。reviewer 分支同理（`:606-612` 之后）。落账在 throw 之前、在写锁 finally 之前。
4. `DelegationOutcome` 不变；取消没有 outcome，只有 throw。

### D4. `index.ts`

- `planner_delegate` execute（`:768`）：`_onUpdate` 改名 `onUpdate`，`runDelegation(..., { signal, executionId: toolCallId, onUpdate })`。`onUpdate` 的局部结果直接是宿主 `AgentToolResult` 形状（`content` + `details`），不再包装。
- `session_shutdown`（`:944` 起，`restoreSuppressedTools()` 之后、`shouldFlushUsageOnShutdown` 早退之前——取消不受 flush 条件约束）：`const cancelled = cancelInFlightDelegations(pi); if (cancelled > 0) notify(host, `Planner-only: cancelled ${cancelled} in-flight delegation(s) on shutdown`, "warning")`。best-effort：桥接层不在或已卸载时 emit 无人接，不报错。

### D5. README 限制段（两语言各一段，放在「Usage accounting / 用量核算」之后、「Design specs / 设计规范」之前）

标题「Cancellation and orphaned children / 取消与孤儿子进程」，内容三句：TUI 下 Esc 中止 `planner_delegate` 会向子进程发 CANCEL，Task 进 `blocked`，已消耗的 usage 落账；`-p`（print）模式没有工具级中止入口，SIGINT 会连同 Root 一起结束而子进程可能残留，需手工清理（票 03 实测）；宽限期默认 5 s，超时后 Task 同样进 `blocked` 但 usage 未知。措辞对齐 10 之后要写的 Delegation 词条，不在本票展开。

## 单测（`delegate.test.mjs`，假 launcher；launcher 用假 `events` 总线）

1. **`renderDelegationProgress` 直测**：全字段 / 只有三元组 / `recentOutputLines` 超 3 行超 200 字符 → 截断；`currentToolArgs` 不出现在 `text` 与 `details`。
2. **进度透传**：假 launcher 第三参收到 hooks，调用 `hooks.onUpdate` 两次再 resolve completed → `options.onUpdate` 被调两次，`details.progress === true`、`taskId` 正确；终态 outcome 不受影响。
3. **launcher 过滤**：假 `pi = { events: tinyEmitter }`；发三条 UPDATE（匹配、`requestId` 不匹配、`nodeId` 不匹配）→ hooks 只收 1 条；RESPONSE 同样只认匹配的。
4. **launcher abort → CANCEL → 宽限内 cancelled 终态**：`cancelGraceMs: 50`；abort 后断言总线上出现且仅出现一条 CANCEL，payload 恰为三键；随后 emit `{status:"cancelled", usage:{…}}` → promise resolve 为该响应。
5. **launcher abort → 宽限到期**：不发终态 → reject，`error.name === "DelegationAborted"`；到期后再 emit 终态被忽略（无未处理 rejection、无二次 resolve）。
6. **runDelegation 取消两条路**：(a) launcher resolve cancelled → Task `blocked`、`stateReason` 含 `cancelled`、**usage 已落账**（G4）、写锁已释放、`DelegationRefused.code === "CANCELLED"`；(b) launcher reject `DelegationAborted` → Task `blocked`、`stateReason` 含 `no terminal response`、写锁已释放、无 usage 行。
7. **G4 其余终态**：`timed_out` / `tool_budget_exhausted` / `failed` 带 usage → 落账且 Task 终态与 `:262` 既有表一致；不带 usage → 不落、不抛。reviewer 分支：cancelled 带 usage → 落账、Task 不动。
8. **`cancelInFlightDelegations`**：两条在飞 + 一条已 settle → 返回 2，总线上两条 CANCEL。
9. **index.test.mjs**：假 `pi` 补 `events`（同一 tinyEmitter）；一条用例：调 `planner_delegate` execute，从总线上截获 REQUEST 后 emit 一条 UPDATE 再 emit completed RESPONSE → `onUpdate` 被调一次；`session_shutdown` 在有在飞请求时总线上出现 CANCEL。这条覆盖的是 index.ts 的接线，不是 runDelegation。

## 宿主验证（TUI，需要操作者或 tmux 驱动；`-p` 做不了 Esc）

宿主启动沿用 05/06 的方式：`pi -ne -e ~/.pi/agent/npm/node_modules/pi-subagents -e /public/pi/pi-planner-only/index.ts`，但**不带 `--mode json -p`**，在 tmux 窗格里跑交互 TUI；Esc 用 `tmux send-keys Escape` 发。每项都要有 jsonl 原文或截屏文字为据。

1. **进度可见**：让 Root 用 `planner_delegate(role: "worker")` 派一个 1–3 分钟的任务（沿用 03 的 hello.txt 类任务，目标是能看到多条 UPDATE）。期望：工具回合阻塞期间 TUI 至少刷新 2 次进度行，且行内 `tools` 计数递增。交回：进度行原文 ≥2 条。
2. **Esc 取消**：同类任务在飞 30 s 时 Esc。期望：(a) tool_result `isError === true`，文本含 `cancelled`；(b) `/planner-only task <id>`（用 host-05 的 render-status.mjs 渲染）显示 `State: blocked`，`State reason` 含 `cancelled`；(c) `pgrep -f <子进程特征>` 为空（子进程已终止，无孤儿）；(d) ledger 里该 Task 有一条 `pending: false` 的 child usage 行（终态带 usage）——若 pi-subagents 在 cancelled 时不给 usage，则记「无 usage」，这是 pi-subagents 侧的事实不是本票缺陷。
3. **宽限窗口实测**：记录 Esc 到 `cancelled` 终态到达的间隔（launcher 里临时 `console.error` 时间戳可以，交回后删）。若 >5 s，交回里给实测值并建议默认值；票不预设。
4. **shutdown 取消**：任务在飞时 `/exit`（或 `tmux send-keys C-d`）。期望：CANCEL 被发出（可从 `/tmp/pi-subagents-uid-*` 或子进程存活与否判断），`pgrep` 无孤儿。做不到就记录现象。
5. **`-p` 孤儿复现一次**：`--mode json -p` 派同类任务，10 s 后 SIGINT。预期与 03 一致（父死、子留）；确认后 README 限制段的措辞与实测一致。清理孤儿。

## 验收

```sh
npm run typecheck && npm test                                                   # exit 0
git grep -nE 'SubagentDelegationUpdate' -- subagent-delegation-contract.ts delegate.ts   # 契约副本与 launcher 都引用
node -e '…'  # 或测试内断言：副本的 5 个事件名 + Update 字段名 == 已安装 pi-subagents delegation.ts（见 D1）
git grep -nE '_onUpdate' -- index.ts                                             # planner_delegate 一行归零（其余工具的 _onUpdate 不动）
git grep -nE 'cancelInFlightDelegations' -- index.ts delegate.ts                 # 定义 1 + 调用 1
git diff -- '*.ts' | grep -E '^\+.*(JSON\.parse|\.match\(|new RegExp|\.split\()'  # 0 行——固定条：本票不新增任何对 prompt / 子进程输出文本的解析（recentOutputLines 只 slice 不 split）
git diff -- '*.ts' | grep -E '^\+.*currentToolArgs'                              # 只允许出现在契约副本的接口声明里
git diff --stat -- README.md README.zh-CN.md                                     # 各只加一段
```

宿主验证 5 项的证据随交回；1、2 两项任一失败本票不算 verified。

## 交回

验收命令原样输出；`DelegationDeps.launch` / `DelegationOptions` 的最终签名；`renderDelegationProgress` 一条真实 UPDATE 的渲染样例；宿主验证 5 项各自的证据与结论（含宽限实测值）；G4 落账的 `ChildUsage` 行样例（`outcome: "failed"` + 终态在 stateReason）；README 两段原文；以及两点说明：
1. 取消的两条路径（终态到达 / 宽限到期）在 Task 状态、stateReason、usage 三项上的最终差异表。
2. `session_shutdown` 的 CANCEL 在宿主上是否真的能阻止孤儿（能 / 不能 / 未观测到）。

## 不做

- 不接 `model` / `thinking` / `toolBudget` / `timeoutMs`（G3；`toolBudget` 接线见承接项）。
- 不做 `-p` 模式的取消（宿主没有入口）；只记 README 限制。
- 不改 `types.ts`（`ChildUsage.outcome` 沿用三值联合，不为 cancelled 加新值）。
- 不改 `orchestrate.ts` / `task.ts` / `policy.ts`；不动 README 其余段落（10 收）。
- 不为进度行做任何"智能"摘要：不解析 recentOutput，不猜子进程阶段。

## 承接项

- **10**：宿主端到端验收把「Esc 取消」作为反例之一纳入；README/CONTEXT 的 Delegation 词条引用本票的限制段。
- **新票候选「toolBudget / timeoutMs 接线」**（08 K3 + 06 G3）：Request 加 `toolBudget`（floors.ts 的 `DEFAULT_EXPLORATION_BUDGET` 等）与 `timeoutMs`；依赖本票的 G4 落账，否则 `tool_budget_exhausted` / `timed_out` 的花费仍会丢。
- **新票候选「新链预算门」**（08 K1/K2）：与本票无耦合，但 launch 前门的拒绝也应产生 `blocked` + stateReason 的同一语义。

## Comments

**2026-09-15 展开（规划方）。** 由一段话 stub 展开为完整票面。写票时核过：宿主 execute 签名的 `onUpdate`（pi-agent-core types.d.ts:338/349）从未被 `planner_delegate` 使用；契约副本缺 `SubagentDelegationUpdate`；桥接层（pi-subagents 0.67.0 prompt-template-bridge.ts:158-175、:339-345、:352-368）在 abort 后会补发 `cancelled` 终态，而我们的 launcher 在 abort 时先退订再 reject，把它丢了，导致同一个"取消"在 signal 路径记 `failed`、在终态路径记 `blocked`；06 的 G4（非 completed 终态 usage 不落账）的根因与此同源，一并收。最大的设计决定是 D2 的"abort 后等宽限期收终态"而不是立刻 reject——默认 5 s 是估计值，宿主验证第 3 条负责给实测。`-p` 模式的孤儿（03 实测）没有工具级入口可修，只记限制。
