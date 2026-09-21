# 05: 上游：结构化 UPDATE 携带用量分类

**What to build:** 向 nicobailon/pi-subagents 提 PR：`SubagentDelegationUpdate` 增加 `usage{input,output,cacheRead,cacheWrite,turns}`，从原生进度投影（execution.ts 已算 input+cacheRead 窗口）。落地后插件熔断口径可配 `uncached|total`，轨迹摘要能标出缓存未命中轮次。走 `/project/tmp/pi-subagents-runtime-agent-settings` 的 fork 远端。

**Blocked by:** 01 — 见同目录工单。

**Status:** ready-for-human

**Parent:** [spec](../spec.md)


## Comments

- 2026-09-21：本轮按用户确认的范围处理；00 发布步骤见 `../RELEASE-STEPS.md`，05 提案见 `../UPSTREAM-PROPOSAL.md`，01–04 的实现与验证统一记录于 `../REPORT.md`。未更新本机安装或提交上游 PR。
