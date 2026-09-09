# 41: blocked 生命周期允许止损并停放迟到回执

**What to build:** 修正 `blocked` Task 当前“不能 abandon、但仍可能被迟到回执重开”的不对称生命周期：

1. `abandon` 特判允许 `blocked → failed`，提供操作者止损通道；当前行为会报 `cannot abandon terminal task: blocked`。
2. `blocked` 状态下收到迟到的子进程回执时，将回执停放进历史，**不调用 `advanceReview`，不推进 Task 状态**。可用已有 `stateReason` 或新增 `sealedAt` 字段作为判定依据，但不新增状态枚举。
3. `planner_verdict` 对 `blocked` 的独立结案通道保持不动。2026-09-09 的 r099 实战中，验收全绿但账本因报告纠正死锁而锁住，正是靠 Root 独立核验后记录 verdict 完成结案；该逃生门不能被移除。
4. `renderTaskStatus` 补充明确披露：`blocked` 仍接受 Root verdict，迟到回执只写入历史，不会重开 Task。

**Design basis:** 依据 `.scratch/planner-only-cost-control/p21-r100-cloud-backlog/blocked-lifecycle-design-proposal.md`。Planner 于 2026-09-09 拍板采用 Option 3 + 回执停放；明确否掉 Option 1（`blocked_open`/`blocked_sealed` 双子态，复杂度过高）与 Option 2（把 `blocked` 变为全终态，会拆掉独立结案逃生门）。

**Acceptance:** 每个行为变化至少有一条独立断言：`blocked → failed` 的 abandon、迟到回执只入历史且不变更状态、`planner_verdict` 仍可对 blocked 结案、status 披露新语义。既有 B1–B10 预算停止语义一个不许改变；B10 已证非空转，窄变异测试必须继续保持。

**Blocked by:** 无。

**Status:** done（2026-09-09 p22-r101 / PR #4 `5d80e1d`，Devin review `e5fd9a6`，合入 `f90836e`。）

## Comments

2026-09-09 planner intake：云端 PR #4 已合进 `planner-only-cost-control`。`blocked → failed` abandon 特判、`sealedAt` 封印、迟到回执 `parkBlockedReceipt`（不 `advanceReview`）、`planner_verdict` 逃生门保留、status 披露新语义。B1–B10 未改。e2e 契约门仍标「待本机终验」（云端未装 pi-subagents）。
