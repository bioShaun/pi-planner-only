# 03: 非 Git Explorer 的观察类任务完整收口

**What to build:** Root 能显式创建只读信息调查 Task，在非 Git 目录收到合规报告、进入 reviewing，并通过显式 Verdict 正常 completed；整个过程不把信息交付冒称为代码变更验证。

**Blocked by:** 02 — 受限 Explorer 正确停止，恢复时不生成写入占用。

**Status:** done

**Parent:** [停止证据失败规格](../spec.md)，实施决策 §3、§7 结构化契约及兼容要求。

- [x] 创建工具和 TaskSpec 支持结构化 acceptanceMode，取值 worktree/observation；新建时省略默认 worktree 并持久化解析值，旧账本缺字段仍按 worktree 解释。
- [x] 只有创建 role=explorer 可以选择 observation，并且实际执行必须满足 02 的可信受限只读能力；非法模式、角色或能力组合在派发前拒绝。
- [x] 模式只由创建时 Root 选择，经 launcher 下传并由账本提供权威值；禁止从 objective、constraints、acceptanceCriteria、报告正文或 WorkerReport 的自报字段推断/改写。
- [x] 模式属于不可变 TaskSpec；重绑定工具不提供模式修改入口，透传的改写请求在派发前明确拒绝。旧 worktree Task 若另开信息调查，使用新 observation Task，旧 Task 的 hold/recovery 不被消除。
- [x] observation Task 后续只允许 Explorer 执行和 Root Verdict，不允许绑定 Worker、Validator 或 Reviewer。含历史 writer/未知能力执行、变更归因或已接纳修改声明时，拒绝观察类验收。
- [x] 在受控非 Git cwd，合规 completed 报告返回并入账，进入 reviewing；验收条件满足后显式 Verdict 可完成 Task，不在 EvidenceComparison、Review loop 或接受入口再次进入永久 revalidate。
- [x] 接纳仍校验 schema、身份绑定、无本次修改声明和必需 validation/acceptanceCriteria；畸形报告、错配身份、取消/失败结果及缺失必需验证不得走成功路径。
- [x] 普通调查不要求整个工作区静止；若 Task 明确要求 Git、固定版本或特定输入当前状态，仍核对相应证据与新鲜度。observation 不可用于证明既有 Worker 代码变更已通过验收。
- [x] 观察类 Verdict 绑定 canonical taskId、本次 execution 和当前报告 revision；新报告使旧裁决不可复用，不制造 Git digest、HEAD 或工作树 fresh 状态。
- [x] 保留并披露 Git 不可用/探测失败事实；受限只读停止与 observation 验收是两个条件，不能用任一个替代另一个。
- [x] 工具描述、Root 引导和 Idle 修复建议在生成只读信息任务时显式选择 observation；代码变更验证使用 worktree，不靠解析自然语言执行模式切换。
- [x] 通过注册工具创建、Delegation、报告记录与显式 Verdict 做完整回归，覆盖非 Git、健康且有有效 HEAD 的 Git、status 失败、外部变更和所有拒绝边界；只证明 stop 错误消失不算通过。
- [x] 类型检查、受影响测试与用户说明通过/更新；公开 schema 变化遵循发布约定。既有 Worker 的 Evidence、Fresh Reviewer、快照绑定、Verdict 和 git_commit 门禁有不退化证据。

**边界：** 本票不为非 Git writer 建立新的采样后端，不赋予 observation Task 提交或验证代码修改的能力；05 的报告保全和 06 的故障查询独立交付。

## Comments

- 2026-09-17 审核修订：报告身份在接纳处拒绝错配（保留为 unacceptedReport，不入序列、不绑定 reportIndex），并在 Verdict 边界复核 taskId / evidence.taskId / workerRunId（拒绝 kind: report-identity）；expectedEvidence.gitRef / diffStat 改为对照 Root 自行采样验证，非 Git 环境或 ref 不匹配一律拒绝（kind: observation-inadmissible）。回归见 delegate.test.mjs 与 orchestrate.test.mjs。
