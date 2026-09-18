# 04: writer 环境不可验证时提前阻塞，运行后故障保持隔离

**What to build:** 在开始执行前已知环境无法提供必要停止证据时，Root 得到具体环境阻塞而不是支付子执行成本后陷入假停止故障；如果证据故障发生在执行过程中，真实 writer 的隔离持续有效。

**Blocked by:** 01 — Git 采样失败提供具体原因；02 — 受限 Explorer 正确停止，恢复时不生成写入占用。

**Status:** needs-triage

**Resolution:** Implementation complete; acceptance pending final independent review.

**Parent:** [停止证据失败规格](../spec.md)，实施决策 §2 writer 启动前阻塞、§5 完整静止证据。

- [x] 采用 02 的执行能力分类，仅对需要 writer 隔离的执行应用本票策略；Validator 和未知能力不因 readOnly 标志跳过检查。
- [x] 启动前已有 A_run 明确 Git 不可用、探测失败或必要证据不完整时，不调用 launcher，返回带 01 明细的结构化环境阻塞及可操作指引。
- [x] 未启动不得标记为“已启动但停止未确认”，不得新增持久 Writer hold；本次临时 reservation 若已取得须正确释放，但已有真实 hold 和其他执行的 reservation 保持不变。
- [x] 不虚报子执行 runId、终态或 Usage；若存在恢复决策，在没有获准启动新执行时不把它冒称为已完成恢复，不破坏既有一次消费语义。
- [x] 启动后才出现 status 失败、Git 不可用、额外根不可探测、已知哈希缺口或不可读路径时，停止证据保持不完整，不把两个相同的未知样本当作静止证明。
- [x] 第一/第二停止样本任一不完整均不能释放 writer；两份有效但不同的样本表示工作区仍变化，并与采样失败分别展示。
- [x] 正常 completed、取消和迟到终态都遵循匹配终态、等待及连续有效静止证据要求，确认前第二 writer 被拒；恢复后仍保持应有隔离。
- [x] 健康 writer 按原流程完成与释放，受限 Explorer 不被本票新增前置检查阻断；不得通过全局忽略 Git 故障或自动初始化仓库“修复”问题。
- [x] 用生产 Delegation 入口断言实际 launcher 调用次数、Execution/Task 状态、Usage、reservation/hold 及第二 writer admission，覆盖启动前非 Git、启动后失败和额外根/哈希缺口，不只断言退出码。
- [x] 类型检查、受影响测试及环境修复说明通过/更新；保留修复前后回归证据，说明如何区分“未启动”和“已启动、停止未确认”。

**边界：** 复用既有采样后端，依赖 01 的失败明细与 02 的可信分类，不依赖 03 的 observation 验收或 05 的报告保全。

## Comments

- 2026-09-17 审核修订：post-launch hash-object 失败（snapshotGap reason=hash-failed）现在使停止不确认，writer hold 与 reservation 持续有效，任务 blocked 且 recovery.required。回归见 delegate.test.mjs hash-gap 用例。
