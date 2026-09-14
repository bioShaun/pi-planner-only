# 46: 跨主机同名 Task id 下 Store 查找与 alias 注册无 workspace 隔离

**What to build:** 让 Task 查找与 alias 注册不再依赖「同名碰撞不会发生」这个不成立的假设。

1. **`Store.get()` 命中多个 workspace 时不得静默取第一个。** 现在 `Store.get()`（`task.ts:1489-1496`）先直接命中 canonical id，再遍历返回**第一个** `aliases` 命中者，全程无 workspace 过滤；`Map` 的遍历顺序（加载顺序）就成了裁决者。要求：要么按当前 workspace 过滤，要么在命中多个 workspace 时返回**歧义错误**，不得静默择一。
2. **`insertNew()` 注册 alias 前必须检查碰撞。** `task.ts:1346-1348` 现在 `aliases = alias && alias !== taskId ? [alias] : []`，不检查该 alias 是否已是某个**已存在的 canonical id**、或已被其它任务占用。要求：撞上即拒（结构化错误），不静默覆盖也不静默并存。
3. **委派路径必须过 `TASK_WORKSPACE_MISMATCH`。** 现在这个守卫只存在于 `continueTask()`（`task.ts:1466-1487`）。委派走的是 `resolveDelegationTarget(input, (taskId) => this.store.get(taskId))`（`orchestrate.ts:2233`，另见 `roles.ts:675`），完全绕过 workspace 校验。要求：委派路径解析出的 target 也要校验 workspace，不匹配即拒。

**Background / 证据：**

- **ledger 是跨机共享的，已在真实数据上看到后果。** 本机（`/public/pi/pi-planner-only`）的 ledger 里出现了来自**另一台主机**的 `T-20260914-001`：那台机器（`/Users/chunchunmaomao`，macOS）的同名任务 `cwd` / `spec.cwd` 均为 `.../finance-check-workspace`，alias 为 `T-20260910-005`；本机同名任务则是 git-history fold（alias `T-fold-09dup`，cwd `/public/pi/pi-planner-only`）。
- **同日必撞号。** `createTaskId()`（`task.ts:442`）按 `T-<YYYYMMDD>-<NNN>` 铸 id，两台主机同一天各自从 001 开始，重号是必然而非偶然。
- **危险组合。** `T-20260910-005` 这类 alias 本身是标准 canonical id 形状，于是「alias 撞已有 canonical id」与「同名跨机任务并存」会叠加：命名式委派可能解析到**另一个 workspace 的 Task**，而 `roles.ts:684-692, 700-719` 在无嵌入 spec 时会嵌入 `target.task.spec` 与 `target.task.reports.at(-1)`。
- **本次未命中，属运气。** 2026-09-14 的复核把「跨任务污染」判定为跨主机重号错觉（见 [工单 45](45-taskspec-validation-shape-vs-validator-guard.md) Comments）；当时逐项排除了 alias 重复与 canonical-id 遮蔽，但**排除的是这一次的具体碰撞，不是这条路径的缺陷**。

**Acceptance:**

- `Store.get()`（或其调用方）在候选跨多个 workspace 时不再静默返回第一个：返回歧义错误，或限定在当前 workspace 内解析。错误须结构化并指明候选。
- `insertNew()` / `createTask()` 注册与已有 canonical id 相同的 alias 时抛结构化错误；合法 alias（不撞 canonical id、不撞已占用 alias）行为不变。
- 委派路径（`orchestrate.ts:2233` / `roles.ts:675`）解析到与当前 cwd 不同的 workspace 的 Task 时，以 `TASK_WORKSPACE_MISMATCH`（或等价的委派级结构化错误）拒绝。
- 回归测试覆盖：跨 workspace 同名 id 不静默择一；alias 撞 canonical id 被拒；委派跨 workspace 被拒。既有 `continueTask` 的 workspace 校验保持通过。
- `npm run typecheck` 与 `npm test` 绿。

**需讨论（本票不做，仅记）：** id 是否应加入主机/workspace 区分因子。这会让 `T-<YYYYMMDD>-<NNN>` 不再是全局唯一键，属更大的改动 —— 涉及既有 ledger 的兼容读取、alias 迁移与 snapshot 命名。单独立项评估；本票只做隔离与拒绝，不改 id 格式。

**Blocked by:** 无。**优先级：** 排在工单 45 之后（45 已落地）。

**Status:** ready-for-agent

**实现者裁定（要求 1 的两条路）。** 建议取**歧义错误**而非「按当前 workspace 过滤」：过滤会把真实的跨 workspace 绑定静默变成「找不到」，操作者失去线索；而歧义错误是 fail-closed，与 `resolveRunBinding()`（`orchestrate.ts:1171-1225`）对 `identity-conflict` 的处理一致。若实现者选择过滤，必须在回执说明为何认为静默收窄是安全的。

## Comments

2026-09-14 立案（工单 45 复核期间发现）。当时为排除「跨任务污染」假设逐项核对：`Store.get()` 的 canonical-id 优先与无 workspace 过滤、`insertNew()` 无 alias 碰撞检查、`TASK_WORKSPACE_MISMATCH` 不在委派路径 —— 三处均为当前 `091fa28` 上的真实行为。本案未命中，但路径成立。
