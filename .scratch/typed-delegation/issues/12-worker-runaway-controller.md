# 12: Worker Runaway Controller 与 Correction Contract — 新阶段入口

Status: ready-for-agent
Type: spec
Blocked by: 11
Date: 2026-09-16

## 权威 spec

[Worker Runaway Controller 与 Correction Contract](../../worker-runaway-controller/spec.md)

本票承接票 10 的异常消耗与新链预算接线发现，在票 11 完成验收后推进。它是新阶段入口，不将新架构追加为票 11 的验收条件，也不重复维护 spec 正文。

## 阶段交付

本阶段只做正确与稳定运行所需：P0-A、P0-B、宿主 soak、运行时事实文档。取证与 P1 移至下一阶段。

1. ~~取证 N1-worker2-61turn~~ → 下一阶段。child 全轨迹很可能不可得，fixture 只有终态 usage，不改变 P0 实现决策。
2. P0-A（单独立票、单独验收）：优先修 execution termination correctness：状态／原因／停止依据、spec §3 的停止确认谓词（terminal + quiescenceWaitMs + 两次一致工作树采样）、宽限到期后继续接收迟到 terminal、stop_unconfirmed 保持 writer 隔离、C_terminal 与异常 execution 收尾、异常结果作为 `planner_delegate` 结构化 details 返回而非 throw、迟到事件及重启恢复。可信 terminal（包括 cancelled）不自动等于静止确认。
3. P0-B（依赖 P0-A 验收通过）：在 typed Delegation raw UPDATE seam 接 Minimal WRC——信号只有累计 tokens + 墙钟，envelope 显式配置、未配置不取消；交付最小 RecoveryDecision，入口为 `planner_delegate` 新增 `recovery` 字段（再执行）与 `planner_verdict blocked`（abort），Policy 工具集不变；P0 只接线 retry_same_plan／abort／fix_environment，其余动作明确拒绝。闭环：异常 → 取消 → 确认停止 → Evidence → blocked + recovery.required/needs_replan → 恢复授权 → 新 bounded execution。
4. 收口（本阶段关闭标准）：宿主 soak——N2 类故意跑飞 → 取消 → 确认 → blocked + recovery → retry 全链 ≥ 1 次通过；P1／N1／3b 回归各 ≥ 3 次；全程无手动 kill、无锁泄漏、无重复记账，stop_unconfirmed 仅在预期场景出现。随 P0-A 更新 CONTEXT.md／ADR 0001 的 in-process 运行时事实。
5. ~~P1~~ → 下一阶段入口：TaskPacketV2 = immutable TaskSpec + typed ExecutionContract；correction/report_correction 为原 Task 的 overlay。ExecutionControls 独立配置模型／thinking／timeout 等运行参数，并接线 narrow_task／add_information／repair_protocol／change_model／change_tool_strategy。

P2 repetition／steering／默认 envelope 校准与 P3 自适应策略为后续演进。本阶段实施票：12-A（P0-A）、12-B（P0-B，含 floors.ts 死预算裁定）、12-S（soak）；本票不是一次执行即可完成的实现指令。

## 关键约束

- 不将异常直接判断为 TaskSpec 拆分失败。
- CANCEL／宽限超时／普通 terminal 不自动等于静止确认。
- 原 TaskSpec、累计 Usage、review rounds 与 Evidence chain 持续有效。
- 不解析 Worker prose 生成控制信号；不向当前 structured API 传 usageBudget。
- 不新增 TaskState = needs_replan；保留 blocked lifecycle，以结构化 recovery metadata 与受授权恢复分支表达下一步。
- 不新增工具；RecoveryDecision 走 `planner_delegate.recovery` 与 `planner_verdict`。
- raw UPDATE 是快照且 `recentTools` 无执行身份；P0 不做 repetition detector，也没有 soft checkpoint steering。
- 宽限到期不退订 RESPONSE；迟到 terminal 解除 stop_unconfirmed、补记一次 usage/C_terminal，不越过 seal 接受旧报告。
- P0 不提供默认异常线；停止确认谓词只证明观察窗口内工作树静止，该限制写入记录。
- 测试复用 typed Delegation／Orchestration 边界及现有宿主事件夹具；停止语义与宿主最坏清理上界必须另经真实宿主验证。
