# 13: `TASK_UNKNOWN` 拒绝文案不可操作 —— 幻觉 taskId 让 planner_delegate 原地重试

Status: needs-triage（改进方向 1 可直接派活；方向 2 是工具面契约决策，需维护者先定）

## 现象

宿主观测（2026-09-16）：planner-only Root 想派一个「盘点上一阶段剩余工作」的只读调查 Task，连续 8+ 次调用 `planner_delegate` 均返回：

```
planner_delegate refused: unknown Task T-20260717-001
```

拒绝文本逐字相同（其中仅回显 taskId，其余参数是否变化未取证），随后 Root 自述 "Stopping failed retries" 停止重试（该文案为模型输出，非已证实的 harness 熔断机制）。任务未启动，调查未进行。

## 机制与证据

- **`T-20260717-001` 是编造的 ID。** Task ID 形如 `T-YYYYMMDD-NNN`，仅在省略 `taskId` 时由 `store.nextTaskId()` 铸造（`task.ts:421`、`delegate.ts:523`）。该字面量意为 2026-07-17 的第 1 个 Task，早于本项目全部记录（2026-09 起），全仓无引用。
- **显式 `taskId` 的语义是绑定既有 Task**（`delegate.ts:501-505`）：`store.get` 未命中即抛 `DelegationRefused("TASK_UNKNOWN")`。拒绝本身正确——为伪造 ID 静默建任务会破坏「显式 ID 逐字绑定存储记录」的契约（`delegate.ts:496-498` 注释）。`taskId` 的合法用途有三：`role=reviewer` 评审既有 Task（`delegate.ts:492-493` 强制要求）、对 blocked+recovery.required 的 Task 携 `recovery` 再执行、以及对存活 Task 的普通再委派（`delegate.ts:196` "Existing Task id to re-delegate"，`delegate.ts:629` `planning/changes_requested/report-invalid` 等态再入 `executing`，修正轮即此路径）。
- **重试循环的成因是拒绝不给纠正路径。** 对比同函数的 `TASK_CLOSED`（`delegate.ts:537-541`）带 "start a new Task instead"，`TASK_UNKNOWN` 只说 `unknown Task X`，模型拿不到「省略 taskId 即新建」的提示，只能原地盲重试。
- **触发诱因：** `PLANNER_PROMPT`（index.ts:199）"The tool returns the canonical taskId in details; pass it as taskId on every later call for that Task" 容易被模式匹配成「每次调用都必须提供 taskId」，于是按格式凭空造一个。

## 改进方向

1. **拒绝文案可操作化**（可直接派活）：`TASK_UNKNOWN` 追加指引，如 `unknown Task T-…; omit taskId to create a new Task, or pass an existing Task id`；`TASK_FOREIGN_WORKSPACE`（`delegate.ts:506-511`）同理补一句「该 ID 属于其他 workspace 的账本」。`delegate.test.mjs` 相应断言更新。
2. **Task 枚举手段**（契约决策）：当前 Root 工具面（`git_audit` / `git_commit` / `planner_delegate` / `planner_verdict`）没有任何列出现存 Task 的入口；taskId 一旦丢失或记错，Root 没有自查手段，只剩再造一个幻觉 ID 这条路。候选：新增只读 `planner_tasks`（列出 taskId/state/一行 summary），或把现存 Task 清单塞进 `TASK_UNKNOWN` 拒绝的 `details`。做不做、做哪个需维护者定。

## 关联

- 与票 12 同类：守卫拒绝正确、但拒绝没有把恢复路径告诉调用方。

## Comments

- 2026-09-16（落档）：来源为宿主实跑观察 + 源码逐行核对；定性为可用性/防幻觉加固，非代码 bug。
- 2026-09-16（复发与立项）：方向 1 已落地（含票 14 角色区分），但 session `01a0a9cc` 再次出现幻觉 `taskId`（`T-20260918-015`）同参数重发两次，证明文案不是 loop-breaker。§机制"触发诱因"段的结构性根治立项为票 17（创建路径去掉 `taskId`）；通用重复拒绝熔断立项为票 16；方向 2 立项为票 18。
