# 47: validator 点名的 Task 在会话 store 找不到时静默退到 active Task（恢复上限让 ledger 记录不可见）

**What to build:** 点了名却解析不到的 Task id 必须 fail-closed；ledger 上真实存在的 canonical id 不得因会话恢复上限而对点名查找不可见。

1. **点名未命中不得退到 active。** `resolveValidatorReviewedTask()` 的取值序是 ReviewRequest.taskId → target.taskId → spec.taskId → prompt 中恰好一个已知 id → **本 cwd 的 active Task**。前四级全部未命中时，无论 prompt 是否点了名，都落到第五级。要求：**引用**（reference）—— prompt 正文里出现的 canonical id、或 ReviewRequest / input 显式给的 id —— **一个都解析不到**时，返回结构化拒绝（`VALIDATOR_TARGET_UNBOUND`，多名皆未命中时 `VALIDATOR_TARGET_AMBIGUOUS`），文案写明点的是哪个 id；不得用 active Task 顶替。active 回退只在**没有任何引用**时保留。

   **引用 vs 声明（2026-09-14 定案）。** 嵌入 TaskSpec 自身的 `taskId` 是**声明**（declaration）而非引用：TaskSpec 可以描述一个尚不存在的 Task，所以此类 absent id 仍走未绑定路径（这是 issue 29 / p12-r058 刻意保留的能力，`orchestrate.test.mjs:1275-1299` 覆盖）。判据落在 `isCanonicalTaskId()`（`roles.ts`，锚定非全局的正则）与「promptTaskIds 减去 spec 自身 taskId」上。注意 `promptTaskIds` 是**文本扫描**，嵌入 spec 的 id 同样会被它命中——不减去 `spec.taskId` 就无法区分这两种语义。

   report-only 路径已经是「未命中即拒」的语义（`orchestrate.ts` 的 `REPORT_TARGET_UNBOUND` / `REPORT_TARGET_AMBIGUOUS`）；validator 路径照此对齐，但按上一条保留声明的例外。
2. **恢复上限不得遮蔽显式点名。** 会话启动只恢复按 `updatedAt` 最新的 `MAX_LEDGER_RESTORE_PER_SESSION = 64` 条（`types.ts:58`；`orchestrate.ts:1052-1064`），`Store.get()`（`task.ts:1570-1577`）只查内存。要求：对 canonical 形状的 id，`get` 未命中时按需从 ledger 读取并 `restore()`（或委派路径的 lookup 回退到 ledger），使点名查找不受上限影响；上限本身保留（它防的是无界 flood，不是查找）。按需恢复必须走与工单 46 相同的 workspace 校验，不得成为跨 workspace 绑定的新入口。
3. **`resolveDelegationTarget()` 不得把未命中的点名当作没点名。** `roles.ts:490-525` 在 lookup 未命中时 `taskId` 留空、只保留 `namedTaskIds`；下游看不出「点了名但没找到」与「没点名」的区别。要求：该区别在 `DelegationTarget` 上可辨（保留 `namedTaskIds` 已够，但 validator 路径必须消费它），并在准入层据此拒绝。

**Background / 证据：**

- **工单 45 宿主终验检查 F 因此失败**（`.scratch/planner-only-cost-control/p45-host/summary.md`、`check-f.log`）：两种 task-id-only probe 都点名 `T-20260911-001`（ledger 上的 spec 为 `{"required":true}` 且无 `commands`），预期触发 `orchestrate.ts:2710-2727` 的 stored-task 拒绝（文案 `orchestrate.ts:273`），实际两次都返回 `Async delegation for task T-20260913-046 has started`。守卫代码在被验构建里存在，但 `target.task` 从未是 `T-20260911-001`。
- **根因已复现**（`.scratch/planner-only-cost-control/p45-impl/rank-ledger.mjs`，2026-09-14 对本机 ledger 按 `orchestrate.ts:1052-1064` 同一排序重算）：符合恢复条件的记录 120 条，上限 64；`T-20260911-001` 排第 100 → 未恢复进会话 store；`T-20260913-046` 排第 3，且是本 cwd 带报告的 active Task → 第五级回退选中了它。
- **后果一：fail-open。** validator 实际跑在一个与点名不同的 Task 上，run 与 usage 都记到了 `T-20260913-046`。这与工单 46 的「静默取第一个」同族，且更直接：操作者明确说了 id。
- **后果二：工单 45 的守卫只对最新 64 条可达。** 同一脚本列出 ledger 上 `required:true` 无可用 `commands` 的记录 28 条，其中仅 6 条在上限内；其余点名即退到 active。
- **不是工单 45 引入。** §5 注释与 active 回退在 `091fa28` 上已存在；45 只是让这条路径第一次被宿主终验打到。

**Acceptance:**

- validator 委派点名的 id 一个都解析不到时，被结构化拒绝并写明该 id；不启动 run，不用 active Task 顶替。多名皆未命中给歧义拒绝。
- 点名一个存在于 ledger 但超出恢复上限的 canonical id 能被解析（按需恢复），于是 45 的 stored-task 拒绝对该记录真正触发。回归测试用超过上限的记录集（或注入较小上限）覆盖。
  **宿主复跑目标改用 `T-20260912-016`**（2026-09-14 定案），不用 `T-20260911-001`：后者 `cwd=/public/scripts/tc-probe-design-v2` 属**别的 workspace**，在 §2 的 workspace 校验下必然拒绝采纳，因此拿不到 stored-task 拒绝。`T-20260912-016` 是同 workspace（`/public/pi/pi-planner-only`）、rank 72（超上限 64）、`blocked`（非终态、可重绑）、stored spec 为 `required:true` 无可用 commands。`T-20260911-001` 这类跨 workspace 的点名应得到 `VALIDATOR_TARGET_UNBOUND`，并在 reason 里写明「belongs to workspace …」，不得报成 unknown Task。
- prompt 完全没点名时，active 回退行为不变（既有测试保持通过）。
- 按需恢复的记录经过 workspace 校验；跨 workspace 的 id 不因本票被静默绑定。
- 宿主复跑 p45-host 检查 F：以 `Validate T-20260912-016`（见上）复现，出现 `create a new Task that carries a complete validation definition` 拒绝；并复跑 `Validate T-20260911-001` 确认得到 `VALIDATOR_TARGET_UNBOUND` + 「belongs to workspace」说明。（**本机未做**，待 operator。）
- `npm run typecheck` 与 `npm test` 绿。

**宿主复跑结果（2026-09-14，operator 会话，被验构建 `59d9ee3`，loaded=629b4b6133e9）：**

- ✅ **跨 workspace 点名**：`Validate T-20260911-001`（task-id-only）在解析层被拒，**无 run、无 active 兜底**；reason 含 `names unknown Task T-20260911-001 (its ledger record belongs to workspace /public/scripts/tc-probe-design-v2 and this delegation runs in /public/pi/pi-planner-only; cross-workspace binding is refused)`。
- ✅ **严格 task-id-only 复现**：`Validate T-20260912-016`（rank 72 > 上限 64，不嵌 spec / 不嵌 ReviewRequest）→ 45 的 stored-task 拒绝触发，逐字含 `Task T-20260912-016 is stored with validation.required = true but no usable validation.commands, so no Validator delegation for it can start. The stored TaskSpec is not editable: create a new Task that carries a complete validation definition.`；**无 run、无警告**。
- ✅ **按需恢复越过上限**：两条探针都说明点名查找不再受 `MAX_LEDGER_RESTORE_PER_SESSION = 64` 遮挡（016 rank 72、011 rank 100 均在限外却被正确解析/识别）。
- ✅ **无 active-Task 兜底**：两条均未出现 `Async delegation … has started`；016 的按需采纳只进内存（`restore()` 无 `persist`，其 `.json` mtime 未变）。
- ✅ **门禁**：`59d9ee3` 上 `npm run typecheck` exit 0、`npm test` exit 0（35 个测试文件无失败），日志 `.scratch/planner-only-cost-control/p47-impl/{typecheck,npm-test}-rerun.log`。

**遗留跟进项（不影响本票结论）：** 跨 workspace 拒绝的文案以 `names unknown Task X` 起头、随后才给 workspace 原因；措辞应改为主诉 workspace 冲突。见 Comments。

**Blocked by:** 无。与 46 改同一处查找（`Store.get()` / 委派路径），建议一并排期；若分开，本票在前——它挡着 45 的宿主终验转 verified。

**Status:** verified（2026-09-14：本机 `npm run typecheck` / 全量 `npm test` exit 0；宿主复跑两条探针均 PASS —— 跨 workspace 的 `Validate T-20260911-001` 得 `VALIDATOR_TARGET_UNBOUND` + `belongs to workspace` 说明，严格 task-id-only 的 `Validate T-20260912-016` 得 stored-task 拒绝 + `create a new Task` 指引；两条都无 run、无警告、无 active 兜底。）

**实现者裁定（要求 2 的两条路）。** 倾向在 `Store.get()` 之外加一层「委派 lookup」做按需恢复，而不是让 `Store.get()` 自己读盘：`get` 在热路径上被大量调用（usage 归并、alias 解析），读盘副作用放在委派入口更可控，也便于与 46 的 workspace 校验放在同一个函数里。若实现者选择改 `Store.get()`，须在回执说明读盘失败（损坏记录、并发写）时的行为。

## Comments

2026-09-14 立案（工单 45 宿主终验检查 F 失败的根因）。证据脚本 `p45-impl/rank-ledger.mjs` 可在本机重跑复现排名。

2026-09-14 实现（本机；未 commit）：

**改动**（`orchestrate.ts` + `roles.ts`）

- `delegationLookup(cwd)` / `restoreTaskOnDemand(taskId, cwd)`（新增，挂在 `restoreFromLedger` 之后）：`store.get` 未命中时按需读 ledger 并 `restore()`，**每条委派一份缓存**。采纳前必须过 workspace 校验；`cwd` 缺失或记录属别的 workspace 一律不采纳，并记下原因（"belongs to workspace …"），避免把「记录存在但不可用」报成 unknown Task。按实现者裁定走**首选路线**（在 `Store.get()` 之外加委派层），不动 `Store.get()` 的热路径；读盘异常被吞掉并视为「未采纳」→ fail-closed，不会半途绑到别的 Task。
- `resolveValidatorReviewedTask()` 改为返回 `{ task } | { refused }`，并把「引用」与「声明」分开：引用 = prompt 正文的 canonical id（`promptTaskIds` 减去 spec 自身 `taskId`）+ ReviewRequest / input 显式 id；引用非空而一个都解析不到 → `VALIDATOR_TARGET_UNBOUND`（多名为 `VALIDATOR_TARGET_AMBIGUOUS`）。spec 声明的 absent id 仍走未绑定，保住 p12-r058。
- 解析提前到**任何准入副作用之前**（早于结构化委派闸门 `:3005`、容量预留、写锁、起 run），拒绝因此零副作用。
- `prepareRoleDelegation` 与 `beginDelegation` 改用同一条账本感知 lookup，打包与准入不会再各绑一个 Task。
- 新增 `isCanonicalTaskId()`（`roles.ts`，锚定非全局正则），供上面判据复用。
- 顺手补掉工单 45 漏掉的**第五处判据副本**（`embeddedTaskLooksInvalid` 里原为 `required === true && (!Array.isArray(commands) || commands.length === 0)`），现走 `isValidationDefinitionIncomplete()`；malformed `commands` 仍留在本地判断（它是 shape 错误，共享谓词刻意不管）。

**测试**（`orchestrate.test.mjs`，4 组新用例 + 既有 p12-r058 全部保持通过）

1. prose 点名一个不存在的 canonical id，且本 cwd 的 active Task **带报告**（旧代码正好会在此 fail-open）→ `VALIDATOR_TARGET_UNBOUND`，文案含该 id；`getDelegation()` 为 `undefined`、`pendingDelegationCount() === 0`。
2. prose 点名两个都不存在的 id → `VALIDATOR_TARGET_AMBIGUOUS`，两个 id 都在文案里。
3. 快照在 ledger 但**不在会话 store**（构造后写盘，模拟超出恢复上限）→ 按需采纳 → 45 的 stored-task 拒绝触发（`VALIDATION_DEFINITION_INCOMPLETE` + `create a new Task`）。这是检查 F 的本机孪生用例。
4. 跨 workspace 的快照 → 不采纳、`VALIDATOR_TARGET_UNBOUND`，文案含 `belongs to workspace`。

**回归证据**（本轮新验证，非历史 RED 声明）：临时把 `if (referenceIds.length > 0)` 关掉后，用例 1 在 `orchestrate.test.mjs:1362` 失败（`actual: undefined, expected: 'VALIDATOR_TARGET_UNBOUND'`），即旧路径确实放行；恢复后全绿。

**门禁**：`npm run typecheck` exit 0；`npm test` exit 0（35 个测试文件，无失败）。日志 `.scratch/planner-only-cost-control/p47-impl/{typecheck,npm-test}.log`（gitignored）。

**宿主复跑**：已完成（见上）。本票实现提交 `9d80701`（docs `59d9ee3`），运行中的 clone 已更新到 `59d9ee3`（`/planner-only status` 报 `loaded=629b4b6133e9`）。

2026-09-14 宿主复跑（operator 会话；Acceptance 上方「宿主复跑结果」即本轮记录）：

- 第一次尝试**未复现**，原因是探针嵌了**完整 spec**：守卫取值序 `specDetails.spec ?? spec ?? target?.task?.spec` 里，**提交的** spec 优先于 `target.task.spec`，016 的 stored 定义因此被遮蔽 —— 这是工单 45 要求 6 已记录、刻意保留的隐藏逃生口，不是缺陷。**严格探针必须彻底 task-id-only。**
- 按 task-id-only 重跑后两条探针都 PASS（逐字见上）。
- 复跑期间的一次误操作：`planner_verdict` **未给 `taskId`** 时落到 `store.active()`（`index.ts:1218-1220` 的文档化默认），在 `T-20260913-046` 上记了一条 `blocked`（reviewRound 0→1）。该 Task 仍是 `changes_requested`、生命周期本就由 `T-20260914-010` 收口，故保留不 override；成因记此，以免后人误读成对 046 的真实评审结论。该路径用裸 `store.get`、**未接账本感知 lookup**，新会话里按 id 处置超上限 Task 会报 `unknown task` —— 与 §2 同族，待定是否开票。
