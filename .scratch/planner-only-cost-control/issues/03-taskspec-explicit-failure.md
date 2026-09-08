# 03: 嵌入 TaskSpec 显式失败、title 别名、canonical id 回显

**What to build:** Root 在委派文本里嵌入的 TaskSpec 不合法时，委派在启动前被拒绝并告知具体是哪个字段缺失或类型错误，而不是静默创建占位 Task。`title` 可作为 `objective` 的别名被接受，但结果里要说明采用了别名。只有完全没有 TaskSpec 特征字段的委派才允许占位 Task，占位事实写在委派结果首行。每次委派返回都回显插件分配的 canonical taskId，并说明 Root 自造的 id 只作别名保留；Worker 用别名回报时不再被身份检查拒绝。

**Blocked by:** None (can start immediately).

**Status:** done（p04-r018 落地，planner 复核后逐条勾选）

- [x] 嵌入 JSON 含 taskId、acceptanceCriteria、scope 但缺 objective：委派被拒，原因指明缺 objective，未创建任何 Task，未启动子进程。
- [x] 嵌入 JSON 的 validation.required 不是布尔值：委派被拒，原因指明字段与期望类型。
- [x] 嵌入 JSON 用 title 代替 objective：Task 创建成功，objective 取 title 值，委派结果说明采用了别名。
- [x] 委派文本没有任何 TaskSpec 特征字段：占位 Task 创建，委派结果首行告知占位事实与 canonical id。
- [x] Worker 用 Root 自造 id 回报：解析为别名，报告被接受并记录在 canonical Task 下，结果回显 canonical id。
- [x] Reviewer packet 在上述合法路径下都带有非空 objective 与 acceptanceCriteria。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（问题 3，User Stories 4–5，阶段 A 决策第 4 条）。证据：analysis P3。这张票是阶段 C（11）和阶段 D（13）的前提：预算与验证要求都挂在 TaskSpec 上。

Planner verified `p04-r018` (2026-09-07): `npm test` 与 `npm run typecheck` 由 Planner 重跑均为 exit 0。特征字段以 `task.ts` 的 `TASKSPEC_CHARACTERISTIC_FIELDS` 为准（TaskSpec 键 + `title`），回执分类未回退。回报里多写的 `model`/`timeoutMs` 等字段不在代码中。
