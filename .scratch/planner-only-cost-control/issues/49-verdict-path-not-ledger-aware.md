# 49: verdict 路径未接账本感知 lookup，超上限 Task 无法按 id 记 verdict

**What to build:** `planner_verdict` 的目标解析必须与委派路径同样不受会话恢复上限遮挡。

1. **现状**：`index.ts:1218-1220` 是 `params.taskId ? orchestrator.store.get(params.taskId) : orchestrator.store.active()`。`store.get` 只看内存，而会话说启动只恢复按 `updatedAt` 最新的 `MAX_LEDGER_RESTORE_PER_SESSION = 64` 条（`types.ts:58`，`orchestrate.ts:1052-1064`）——所以**新会话里对一个超出上限、但 ledger 里有快照的 Task 记 verdict，会报 `unknown task`**。
2. **要求**：复用 [工单 47](47-validator-named-task-unresolved-falls-back-to-active.md) 的账本感知 lookup（`delegationLookup()` / `restoreTaskOnDemand()`），或抽出等价的 `resolveTaskForVerdict(taskId, cwd)`；按需采纳同样要过 workspace 校验，不得成为新的跨 workspace 绑定入口。
3. **保留既有语义**：给了**未知** id 仍拒绝（文案保持 `planner_verdict: unknown task <id>.`）；**完全没给** id 才退到 `active()`。不要引入任何「点名却退到 active」的兜底 —— 这条正是 47 在委派路径上关掉的。

**Background / 证据：**

- 2026-09-14 工单 47 宿主复跑期间，operator 的 `planner_verdict` **未给 `taskId`**，落到 `store.active()`，在 `T-20260913-046` 上记了一条 `blocked`（reviewRound 0→1）——该记录是默认落点、非真实评审结论（已记在 47 的 Comments）。
- 同一轮里有更实际的阻塞：`T-20260912-016` 这类 Task 排在 64 条之外，**新会话里按 id 处置不了它**。委派路径已由 47 修好，verdict 路径仍是盲的。
- 与 [工单 46](46-no-workspace-isolation-in-task-lookup-and-alias-registration.md) 改同一处查找（`Store.get()` / 委派路径），应复用其 workspace 校验，避免两套判据。

**Acceptance:**

- 新会话中，对超出恢复上限、同 workspace、ledger 有快照的 Task，`planner_verdict({ taskId })` 能解析到该 Task 并正常记录。
- 跨 workspace 的 id 被拒，文案说明它属别的 workspace（不得报成 unknown Task）。
- 给了未知 id 仍拒绝、未给 id 仍退 `active()` —— 既有测试逐字保持通过。
- 按需采纳的记录 `store.restore()` 不落盘（`restore()` 无 `persist`），ledger 文件 mtime 不变；回归用例断言之。
- `npm run typecheck` 与 `npm test` 绿。

**Blocked by:** 无。**优先级**：46 之后、48 之后（用户定：46 → 48 → 49）。

**实现记录（2026-09-14，本机）：**

- **新增** `PlannerOrchestrator.resolveVerdictTask(taskId, cwd)`：复用 46/47 的 `delegationLookup`（账本感知 + workspace 校验 + 歧义检测），返回 `{ task?, note? }`。解析成功即返回该 Task；未命中时 `note` 解释原因 —— 记录存在但不可用（别的 workspace、不可读）或该 id 被两个 Task 当作别名（列出候选）。**任何情况下都不换一个 Task 顶替**。
- **`index.ts` 的 `planner_verdict`** 改用该方法；仍保留「不给 id 才退到 `active()`」的语义。未命中的文案**保持既有前缀** `planner_verdict: unknown task <id>.`（`index.test.mjs:1722` 断言了它），后面按需追加 `note`。

**测试**：`orchestrate.test.mjs` 新增两组 —— 账本里有快照但未恢复（超出上限）的 id 能被解析；跨 workspace 的记录不被采纳且 note 含 `belongs to workspace`；纯未知 id 无 note；被两个 Task 争用的别名 id 不解析且 note 列出两名。既有 `index.test.mjs` 的「unknown taskId → isError、无记录」逐字保持通过。

**回归证据**（本轮新验证）：把 `resolveVerdictTask` 里的账本感知 `lookup` 临时换成裸 `this.store.get` → `orchestrate.test.mjs:1580` 失败（`a beyond-cap id resolves from the ledger`、`actual: undefined`）；恢复后全绿。

**门禁**：`npm run typecheck` exit 0；`npm test` exit 0（35 个测试文件无失败）。日志 `.scratch/planner-only-cost-control/p49-impl/`。

**说明（覆盖边界）**：本票只覆盖**按 id 记 verdict** 的解析。in-memory 已加载 Task 的跨 workspace 绑定仍是 46 留下的缺口（见票 51），本票**不改变**它 —— 只是让「跨 workspace 的账本记录」在这里也不会被静默采纳。

**Status:** done（2026-09-14 本机落地、门禁绿。**未做宿主复跑** —— 与 46、48 同在 `fix/tickets-46-48-49-50` 分支上。）

## Comments

2026-09-14 立案（工单 47 Comments 记录的「与 §2 同族」项）。属于同一根因的**第三条**受影响路径：47 修了委派，46 覆盖查找与 alias 注册，本票覆盖 verdict。
