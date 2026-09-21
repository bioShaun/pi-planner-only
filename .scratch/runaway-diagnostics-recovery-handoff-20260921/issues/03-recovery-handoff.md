# 03: 恢复重跑自动交接

**What to build:** `retry_same_plan` / `fix_environment` 子包附带结构化 `priorExecution` 段：executionId、endedReason、observed/limit、pre-dispatch 与取消时 diffstat 差异、最近 8 条工具与参数、最后 20 行 recentOutput、recovery.reason。不改 TaskSpec；Root `instructions` 单独追加。验证：fake launcher 断言段内容与顺序；真实 Pi 检查子会话首条 user 消息包含该段。

**Blocked by:** 01 — 见同目录工单。

**Status:** ready-for-agent

**Parent:** [spec](../spec.md)


## Comments

- 2026-09-21：本轮按用户确认的范围处理；00 发布步骤见 `../RELEASE-STEPS.md`，05 提案见 `../UPSTREAM-PROPOSAL.md`，01–04 的实现与验证统一记录于 `../REPORT.md`。未更新本机安装或提交上游 PR。

- 当前进度：实现与审查修正已落地；最新快照的发布/宿主复验及 strict 最终门禁受环境阻塞，未关闭验收。继续执行见 `../RESUME.md`。
