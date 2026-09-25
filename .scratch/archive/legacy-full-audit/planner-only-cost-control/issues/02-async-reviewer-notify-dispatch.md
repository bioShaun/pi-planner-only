# 02: 异步 Reviewer 通知按 ReviewResult 分流

**What to build:** Root 省略 `async` 字段委派 Reviewer、宿主以异步方式运行并在完成时发出通知后，插件把通知里的输出当作 ReviewResult 处理：执行 taskId 身份检查、报告版本与工作区摘要绑定检查，推进审核状态机，向 Root 注入的是审核结论而不是「不是合法 WorkerReport」。同步与异步两条路径对 Reviewer、Validator、Worker 三种角色的处理结果完全一致。

**Blocked by:** None (can start immediately).

**Status:** done（p04-r017 落地，planner 复核后逐条勾选）

- [x] 异步 Reviewer 返回合法 ReviewResult：review round 推进，Verdict 可基于该结果产生，通知文案不含 WorkerReport 错误。
- [x] 异步 Reviewer 返回 taskId 或 reportRevision 不匹配的 ReviewResult：被拒绝的原因与同步路径完全相同。
- [x] 异步 Reviewer 输出被截断且无输出文件：处理方式与同步路径一致，不落到 Worker 报告修正逻辑。
- [x] 同一组输入分别走同步和异步路径，最终 Task 状态、round、记录的 ReviewResult 一致（集成测试断言）。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（问题 2，User Story 3，阶段 A 决策第 3 条）。证据：analysis P2。

Planner verified `p04-r017` (2026-09-07): 同步/异步 Reviewer 在 orchestrate.test.mjs 与 index.test.mjs 公开 hook 上状态、round、ReviewResult 一致；截断不进 Worker 纠偏。
