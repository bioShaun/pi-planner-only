# 01: 执行轨迹入账本

**What to build:** 保留最近 64 条 UPDATE 快照并随执行记录持久化；取消时把最后快照写成带 `snapshot:true` 的 usage 并进入 usage.jsonl（`usageComplete:false`）；`planner_tasks` 诊断增加轨迹摘要（首次非只读工具序号、最大单轮 tokens 增量、只读占比）。验证：fake launcher 环形缓冲与取消落盘；index.test.mjs 诊断展示。

**Blocked by:** None for local implementation — 00 deployment deferred by user on 2026-09-21.

**Status:** ready-for-agent

**Parent:** [spec](../spec.md)


## Comments

- 2026-09-21：本轮按用户确认的范围处理；00 发布步骤见 `../RELEASE-STEPS.md`，05 提案见 `../UPSTREAM-PROPOSAL.md`，01–04 的实现与验证统一记录于 `../REPORT.md`。未更新本机安装或提交上游 PR。

- 当前进度：实现与审查修正已落地；最新快照的发布/宿主复验及 strict 最终门禁受环境阻塞，未关闭验收。继续执行见 `../RESUME.md`。
