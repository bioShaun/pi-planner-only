# 13: `TASK_UNKNOWN` 拒绝文案不可操作 —— 幻觉 taskId 让 planner_delegate 原地重试

Status: done

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
- 2026-09-17（收口核验与架构闭环）：
  - HEAD: `de2cdbd0466070f6f8b6ea9350bf523b4696cdfd`（复用 T-20260917-004 typecheck 与全量测试全绿记录，定向核查源码与契约）。
  - 方向 1 与方向 2 承接落地状态：
    - 方向 1（拒绝指引可操作化与角色感知）：经票 14 细化，`delegate.ts:550-569` 针对 `TASK_UNKNOWN` 与 `TASK_FOREIGN_WORKSPACE` 严格区分 Reviewer（引导调用 `planner_tasks` 查找 canonical taskId 或在对应 workspace 寻找既有可评审 Task，禁止提示新建以防触发 `TASK_REQUIRED`）与普通角色（引导调用 `planner_tasks` 列出 live Tasks 或调用 `planner_delegate` 新建），并在 `delegate.test.mjs:272-308, 728-768` 严格测试断言。
    - 方向 2（Task 枚举手段）：维护者已在票 18 裁定采纳工具方案（live-only v1），通过 `index.ts:962-984` 注册只读 `planner_tasks`，从内存与账本双源读取 live Task（`orchestrator.listLiveTasks`），为 Root 提供准确自查 canonical taskId 入口，消除无自查手段导致的凭空捏造。
    - 结构性根治与通用熔断（票 16、票 17）：票 17 从根源消除了幻觉 taskId 的诱因，拆分工具契约为新建与再入两套独立工具；票 16（`refusal-breaker.ts`）则在所有 Root 工具上实施同 code 相同参数连续重复拒绝的机器熔断。
  - 最终工具契约与架构：
    1. 新建 Task：`planner_delegate`（schema 无 `taskId`/`recovery`，始终铸造新 Task 并返回 canonical `details.taskId`；透传 ID 自动忽略并出 warning，不再拒绝）。
    2. 再入既有 Task：`planner_redelegate`（schema 必填 `taskId`，承接修正轮、Reviewer 评审与 recovery 恢复，严格按 ID 逐字绑定既有记录）。
    3. 枚举 live Task：`planner_tasks`（只读，双源列出当前 workspace 的 live/可恢复 Task 与状态）。
  - 结论：票 13 的两个改进方向及衍生诱因已全部由票 14、16、17、18 完整实现并测试覆盖，ADR-0002 架构落地闭环，不再存在『待维护者决策』未决状态，收口关闭此票。
