# 01: 任务重新派工或成功流转时清理残留的 `stateReason`

Status: ready-for-agent
Type: task
Blocked by: none
来源：0.8.0 真实宿主验收观察（场景 A 账本 `evidence/A/ledger.json:2349`）

## 问题描述

在 0.8.0 场景 A 真实宿主运行中，Explorer 前两次遭遇 `worker_runaway`，TaskRecord 的 `stateReason` 被设置为：
`"worker runaway: tokens 17027 exceeded envelope 12000; delegation cancelled"`。

随后 Root 通过 `planner_redelegate.recovery` 第三次派工成功，子代理完成任务，报告被接纳，最终 verdict 为 `pass`，任务状态变为 `completed`。然而，在最终账本（`ledger.json`）及 `/planner-only tasks` 诊断中：
```json
{
  "taskId": "T-20260918-001",
  "state": "completed",
  "stateReason": "worker runaway: tokens 17027 exceeded envelope 12000; delegation cancelled"
}
```
`state: completed` 却带着过去跑飞的 `stateReason`，这容易引起误解。

## 期望行为

1. 当 Task 从异常状态（如 `blocked`）重新派工恢复（进入 `executing`），或新一轮报告进入审查（`reviewing`）、最终通过（`completed`）时，历史的 `stateReason` 应被清空（或重置）。
2. 在 `TaskStore` 的状态转换契约中（或 `transition` / `redelegate` / `advanceReview` 逻辑中），明确 `stateReason` 的生命周期，确保只有当前状态真正需要 reason 时才设置，恢复后不留僵尸原因。
3. 补齐单元测试，验证：任务 blocked 并设置 `stateReason` 后，经由 recovery redelegate 重新执行并 completed 时，`stateReason` 不再残留。

## Comments

- 2026-09-18 开票。在 0.8.0 场景 A 账本发现此现象，不阻塞 0.8.0 身份链路发布，作为后续小版本优化。
