# 05: 保存已收到但未验收的终态报告

**What to build:** 子执行已经返回结构化报告，但停止确认或其他接纳条件未满足时，Root 能知道报告已经收到，并保留它用于后续诊断，无需重新执行才能取证。

**Blocked by:** None (can start immediately).

**Status:** done

**Parent:** [停止证据失败规格](../spec.md)，实施决策 §2 报告保全，§6 报告可观测性。

- [x] launcher 已校验、身份匹配但未被接纳的终态报告，作为未验收材料保存在对应 Execution，绑定 canonical taskId、executionId 和 runId。
- [x] 至少覆盖 completed terminal 后停止采样失败导致报告未接纳，以及取消后 completed 的既有 lateReport 语义；保持收到、未验收和已接纳三种事实可区分。
- [x] 委派结构化结果及文本说明报告是否收到/接纳，并提供绑定信息和有界诊断摘要；已有报告材料随账本恢复仍可识别，不依赖未来的查询工具才能演示本票。
- [x] 保全材料不进入已接纳报告序列，不创建有效 report revision、自动 review、PASS 或重放接纳；不因此解除 Writer hold 或消费 RecoveryDecision。
- [x] 取消后的 completed 不能越过取消意图；迟到/重复终态不重复保存同一报告、不重复增加报告计数或 Usage，也不把未验收报告改写成成功交付。
- [x] 不从文本、日志或任意产物扫描恢复报告；缺少结构化报告、schema 不合法或身份不匹配时明确报告缺失/无效，不绑定到另一 Task。
- [x] 不复制 Worker transcript 或完整工具参数；报告展示有界且披露截断，保留的结构化报告仍受既有报告契约约束。旧账本无材料时明确未知/未记录。
- [x] 使用现有 Delegation/事件入口构造“启动前 Git 健康、completed 后采样失败”的回归，使该验证在 04 实现启动前阻塞后仍有效；断言结果、持久记录、已接纳报告计数、Usage 和恢复状态。
- [x] 正常已接纳报告行为不变；类型检查、受影响测试与报告状态说明通过/更新，并保留前后验证证据。

**边界：** 本票可独立落地，不修改停止谓词、能力分类或 observation 验收。06 负责将这些材料的状态纳入按 Task 查询，不将其转换成验收证明。

## Comments

- 2026-09-17 审核修订：身份错配的报告现在同样走未接纳路径——保存在执行的 unacceptedReport / unacceptedReportReason，绝不进入 reports 序列或绑定 reportIndex。回归见 delegate.test.mjs 身份错配用例。
