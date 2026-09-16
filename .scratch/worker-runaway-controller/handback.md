# worker-runaway-controller — 阶段交回（P0 delivered）

日期：2026-09-16 ｜ 分支：feat/typed-delegation ｜ 环境：pi 0.85.1 / pi-subagents 0.67.0

## 交付物

- **P0-A**（票 01，commit 066685b + dd1713d）：执行生命周期状态机
  （running/cancel_requested/stopping/stop_unconfirmed/stopped/completed/failed）、
  停止确认谓词（terminal + quiescenceWait + 两次一致工作树采样）、迟到
  terminal 恰一次收尾、结构化 `details.termination`、持久化 writerHold +
  restore 合成。宿主证据 host-01/（12a 同目录历史名）。
- **P0-B**（票 02，commit f63784a）：显式 `envelope{maxTokens,maxWallMs}` +
  内部 AbortController 跑飞监控（复用 CANCEL 路径）→ `worker_runaway` →
  blocked + `recovery.required`；`planner_delegate.recovery`（
  retry_same_plan/fix_environment）与 `planner_verdict` blocked+abort
  恢复门；决策恰一次消费 + 结构去重；floors.ts 委派 floor/探索探测死码
  删除（session-root 预算保留）。宿主证据 host-02/。
- **soak**（票 03，host-03-soak/）：P1×3、N1×3、3b×3、N2×1 全过；
  五条关闭标准逐条满足（详见 host-03-soak/99-soak-report.md）。

## 关键运行时事实（宿主实测）

- RPC `{"type":"abort"}` 与 TUI Esc 同一 AbortSignal；CANCEL→cancelled
  终态在 5 s 宽限内总是到达（in-process 实现）。
- 宿主死亡是 `stop_unconfirmed` 更常见的成因；restore 合成 hold 覆盖之。
- UPDATE `tokens` 为 input+output 累计快照，涨速可观（写 10 文件
  ~200k）——envelope 取值需按任务规模设定；无 envelope 时纯观测。

## 已知边界 / 下一阶段

- recovery.required 的 Task 仅能被结构化决策解锁；`abort` 后 Task 保持
  blocked 交人工。
- P1 恢复动作（narrow_task/add_information/repair_protocol/change_model/
  change_tool_strategy）显式拒绝未接线——P1 阶段（ExecutionControls +
  TaskPacketV2）接。
- export 选择器 `task.rootSessionId` 死路径（票 11 发现 F-11-1）未修，
  属既有缺陷候选。
- floors.ts 已删的探索预算若复活，应走 P1 ExecutionControls 而非 floors。

## 提交边界

- 票 11 收口：5158453 ｜ 12-A 票面：d3ffef0 ｜ P0-A 实现：066685b ｜
  restore 修复：dd1713d ｜ 12-A 收口：3d33694 ｜ 12-B 票面：e4ae360 ｜
  P0-B 实现：f63784a ｜ 12-B 收口：0049218 ｜ 票 03 开票：cf28cae
- 最终 stage commit 包含票 12、票 03、spec 与本 handback；host-01/02/03-soak 证据目录与
  handoff/ 工件不入库。
