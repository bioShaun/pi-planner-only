# 02: 准备阶段守卫（opt-in）

**What to build:** envelope 新增 `maxReadOnlyTools` 与 `preparationTokensShare`，默认关闭；触发时取消，`endedReason: preparation_runaway`，`runawayObservation.signal: preparation`，诊断列出触发前工具与参数清单。只读角色不适用写入判定。验证：fake launcher 触发/不触发矩阵；真实 Pi 只读循环任务复现。

**Blocked by:** 01 — 见同目录工单。

**Status:** ready-for-agent

**Parent:** [spec](../spec.md)


## Comments

- 2026-09-21：本轮按用户确认的范围处理；00 发布步骤见 `../RELEASE-STEPS.md`，05 提案见 `../UPSTREAM-PROPOSAL.md`，01–04 的实现与验证统一记录于 `../REPORT.md`。未更新本机安装或提交上游 PR。

- 当前进度：实现与审查修正已落地；最新快照的发布/宿主复验及 strict 最终门禁受环境阻塞，未关闭验收。继续执行见 `../RESUME.md`。
