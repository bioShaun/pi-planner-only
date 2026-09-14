# 46: 跨主机同名 Task id 下 Store 查找与 alias 注册无 workspace 隔离

**What to build:** 让 Task 查找与 alias 注册不再依赖「同名碰撞不会发生」这个不成立的假设。

1. **`Store.get()` 命中多个 workspace 时不得静默取第一个。** 现在 `Store.get()`（`task.ts:1489-1496`）先直接命中 canonical id，再遍历返回**第一个** `aliases` 命中者，全程无 workspace 过滤；`Map` 的遍历顺序（加载顺序）就成了裁决者。要求：要么按当前 workspace 过滤，要么在命中多个 workspace 时返回**歧义错误**，不得静默择一。
2. **`insertNew()` 注册 alias 前必须检查碰撞。** `task.ts:1346-1348` 现在 `aliases = alias && alias !== taskId ? [alias] : []`，不检查该 alias 是否已是某个**已存在的 canonical id**、或已被其它任务占用。要求：撞上即拒（结构化错误），不静默覆盖也不静默并存。
3. **委派路径必须过 `TASK_WORKSPACE_MISMATCH`。** 现在这个守卫只存在于 `continueTask()`（`task.ts:1466-1487`）。委派走的是 `resolveDelegationTarget(input, (taskId) => this.store.get(taskId))`（`orchestrate.ts:2233`，另见 `roles.ts:675`），完全绕过 workspace 校验。要求：委派路径解析出的 target 也要校验 workspace，不匹配即拒。

   **2026-09-14 修订（实测后定案）。** 把拒绝临时改成打印、跑完整套件枚举，严格相等在委派路径上的爆散面是**整套件约 100 处**（`taskCwd=/fixture/<id>` × `delegCwd=/repo`（orchestrate.test.mjs）与 × `delegCwd=/public/pi/pi-planner-only`（index.test.mjs）各一批，另有 4 处临时目录 cwd、2 处 `/repo/v-acct-*`）。这是套件的**基础 fixture 约定**（Task 建在 `/fixture/<id>`、委派从 Root 的 workspace 发出），不是个别笔误；早先「只有 2 个文件失败」是逐文件首个断言中断造成的低估。

   因此本票**不采用**严格相等，改为：委派路径的 workspace 校验沿用**工单 47 的按需采纳边界**（只对从账本采纳进来的记录校验），in-memory 绑定维持现状；跨 workspace 的**别名复用**另以「拒绝铸造 alias」覆盖（见 §4），零 fixture 破坏。

   **理由的性质要说清楚**：「约 100 处命中」只推翻**成本估算**（早先「只有两处 fixture 需调整」是低估），**并不能证明** in-memory 跨 workspace 绑定是正确语义。二者不可混同。

   **已知缺口（明确不在本票范围，单独承接）**：in-memory 已加载 Task 的跨 workspace 绑定**依然存在**。46 完成的是「歧义拒绝 + alias 碰撞拒绝 + 账本感知预检」，**不构成全面的 workspace 隔离**，不得如此描述。承接票见 §5。
5. **（后续票）确定 workspace 绑定契约。** 先定契约（路径相等 / 仓库根相等 / 是否只约束写入类角色 / 与 `continueTask` 的关系），再据契约迁移套件 fixture 约定（`/fixture/<id>` × Root workspace 这一基础约定）并补对应验证。承接票：`51-workspace-binding-contract.md`。
4. **不得为已在别处的 id 铸造别名。** `spec.taskId` 需要被替换成新 canonical id 时，若该 id 经账本感知 lookup 已解析到别的 Task、或存在但不可绑定（别的 workspace / 歧义 / 不可读），拒绝（`TASK_ALIAS_CONFLICT`），不要铸出一个永远无法用该 id 再次抵达的 Task。见「实现记录」。


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

**实现记录（2026-09-14，本机；未 commit）：**

- **要求 1（歧义）**：`Store.resolveCandidates(taskId)` 返回全部候选（canonical 命中即唯一候选，否则列出所有声称该别名的 Task）；`get()` 在候选 >1 时返回 `undefined`，不再静默取第一个；委派 lookup 记录 `ambiguous`，并在**所有角色**上于早期拒绝（`TASK_ID_AMBIGUOUS`，文案列出候选成员）。
- **要求 2（alias 注册）**：`Store.aliasConflict(alias, ownerTaskId)` 是唯一判据（canonical 遮蔽 / 别名已被占用两类），`insertNew` 撞上即抛 `TASK_ALIAS_CONFLICT`；委派路径在 `nextTaskId()` **之前**用账本感知 lookup 预检 `spec.taskId`，拒绝时不泄漏 id claim，且保持 `alias → createAllocated → rekey` 三行相邻（architecture C37-3 不变量）。
- **要求 4（新增）**：拒绝理由同时覆盖「已解析到别的 Task」与「存在但不可绑定（别的 workspace / 歧义 / 不可读）」，后者文案带上 workspace 说明。
- **顺手发现（重要）**：工单 47 的账本感知 lookup 已在 `resolveDelegationTarget` 阶段把这类记录**采纳**，于是「重复 prompt 携带陈旧 id」走的是「绑定到已存在 Task」分支 —— **不再铸出被遮蔽的 alias**。也就是说该向量在 47 落地时已关闭；本票的 alias 检查补的是**不可绑定**那一类（跨 workspace / 歧义）。已用测试把该绑定行为固化。

**测试**（`task.test.mjs` + `orchestrate.test.mjs`）：canonical id 不得充当 alias；alias 不得被两个 Task 占用；单一持有者仍可解析；重复 alias 时 `get()` 返回 `undefined` 而 `resolveCandidates` 报出两名。委派层：歧义 id → `TASK_ID_AMBIGUOUS` 且列出候选、无 run；陈旧 id → 绑定既有记录、不铸 alias、不建第二个 Task；跨 workspace 不可绑定的 id → `TASK_ALIAS_CONFLICT`、文案含 workspace、不建 Task。

**回归证据**（本轮新验证，非历史 RED 声明）：临时关掉歧义检查 → `orchestrate.test.mjs:1450` 失败（`expected: 'TASK_ID_AMBIGUOUS'`、`actual: undefined`）；临时关掉 alias 检查 → `orchestrate.test.mjs:1500` 失败（`expected: 'TASK_ALIAS_CONFLICT'`）；两者恢复后全绿。

**门禁**：`npm run typecheck` exit 0；`npm test` exit 0（35 个测试文件无失败）。日志 `.scratch/planner-only-cost-control/p46-impl/`。

**Status:** done（2026-09-14 本机落地，门禁绿。要求 3 按上述修订执行 —— 严格相等未采用；**未做宿主复跑**。）

**实现者裁定（要求 1 的两条路）。** 建议取**歧义错误**而非「按当前 workspace 过滤」：过滤会把真实的跨 workspace 绑定静默变成「找不到」，操作者失去线索；而歧义错误是 fail-closed，与 `resolveRunBinding()`（`orchestrate.ts:1171-1225`）对 `identity-conflict` 的处理一致。若实现者选择过滤，必须在回执说明为何认为静默收窄是安全的。

## Comments

2026-09-14 立案（工单 45 复核期间发现）。当时为排除「跨任务污染」假设逐项核对：`Store.get()` 的 canonical-id 优先与无 workspace 过滤、`insertNew()` 无 alias 碰撞检查、`TASK_WORKSPACE_MISMATCH` 不在委派路径 —— 三处均为当前 `091fa28` 上的真实行为。本案未命中，但路径成立。
