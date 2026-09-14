# 47: validator 点名的 Task 在会话 store 找不到时静默退到 active Task（恢复上限让 ledger 记录不可见）

**What to build:** 点了名却解析不到的 Task id 必须 fail-closed；ledger 上真实存在的 canonical id 不得因会话恢复上限而对点名查找不可见。

1. **点名未命中不得退到 active。** `resolveValidatorReviewedTask()`（`orchestrate.ts:3217-3247`）的取值序是 ReviewRequest.taskId → target.taskId → spec.taskId → prompt 中恰好一个已知 id → **本 cwd 的 active Task**。前四级全部未命中时，无论 prompt 是否点了名，都落到第五级。要求：prompt 点了名（`promptTaskIds` 非空）或显式给了 taskId 而**一个都解析不到**时，返回结构化拒绝（例如 `VALIDATOR_TARGET_UNBOUND`，多名皆未命中时 `VALIDATOR_TARGET_AMBIGUOUS`），文案写明点的是哪个 id；不得用 active Task 顶替。active 回退只在 prompt **完全没点名**时保留。report-only 路径已经是这个语义（`orchestrate.ts:2290-2320` 的 `REPORT_TARGET_UNBOUND` / `REPORT_TARGET_AMBIGUOUS`），validator 路径照此对齐。
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
- 点名一个存在于 ledger 但超出恢复上限的 canonical id 能被解析（按需恢复），于是 45 的 stored-task 拒绝对 `T-20260911-001` 这类记录真正触发。回归测试用超过上限的记录集（或注入较小上限）覆盖。
- prompt 完全没点名时，active 回退行为不变（既有测试保持通过）。
- 按需恢复的记录经过 workspace 校验；跨 workspace 的 id 不因本票被静默绑定。
- 宿主复跑 p45-host 检查 F：出现 `create a new Task that carries a complete validation definition` 拒绝。
- `npm run typecheck` 与 `npm test` 绿。

**Blocked by:** 无。与 46 改同一处查找（`Store.get()` / 委派路径），建议一并排期；若分开，本票在前——它挡着 45 的宿主终验转 verified。

**Status:** ready-for-agent

**实现者裁定（要求 2 的两条路）。** 倾向在 `Store.get()` 之外加一层「委派 lookup」做按需恢复，而不是让 `Store.get()` 自己读盘：`get` 在热路径上被大量调用（usage 归并、alias 解析），读盘副作用放在委派入口更可控，也便于与 46 的 workspace 校验放在同一个函数里。若实现者选择改 `Store.get()`，须在回执说明读盘失败（损坏记录、并发写）时的行为。

## Comments

2026-09-14 立案（工单 45 宿主终验检查 F 失败的根因）。证据脚本 `p45-impl/rank-ledger.mjs` 可在本机重跑复现排名。
