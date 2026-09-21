# 04: 重派预算不得低于上次实测

**What to build:** `retry_same_plan` 且 `envelope.maxTokens < 上次 runawayObservation.observed` 时拒绝，代码 `RECOVERY_ENVELOPE_BELOW_OBSERVED`，文案给出实测值与建议（改计划或新 Task）。验证：delegate.test.mjs 拒绝/放行两例；refusal-breaker 对该码的重复拒绝计数。

**Blocked by:** None

**Status:** ready-for-agent

**Parent:** [spec](../spec.md)


## Comments

- 2026-09-21：本轮按用户确认的范围处理；00 发布步骤见 `../RELEASE-STEPS.md`，05 提案见 `../UPSTREAM-PROPOSAL.md`，01–04 的实现与验证统一记录于 `../REPORT.md`。未更新本机安装或提交上游 PR。

- 当前进度：实现与审查修正已落地；最新快照的发布/宿主复验及 strict 最终门禁受环境阻塞，未关闭验收。继续执行见 `../RESUME.md`。
