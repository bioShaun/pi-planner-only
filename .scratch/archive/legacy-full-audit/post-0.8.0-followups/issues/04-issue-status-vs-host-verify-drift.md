# 04: 工单 Status 与「代码已合 / 宿主未验」不同步

**Status:** ready-for-agent（文档/triage；不派产品实现）
**Type:** process
**Blocked by:** none
**来源：** 2026-09-23 planner 巡检

## 问题描述

多份战役工单仍标 `ready-for-agent`，但 Comments / RESUME 已写「实现与审查已落地；release/host/strict 受环境阻塞未关验收」。例如：

- `.scratch/runaway-diagnostics-recovery-handoff-20260921/issues/01`–`04`
- `.scratch/delegation-contract-incident-20260918/issues/03`–`05`（部分 checkbox 已勾，仍欠真实宿主）

后果：容易误派重复实现，或把「待宿主终验」误读成「未开工」。

## 期望行为

1. 约定 Status 枚举至少区分：`ready-for-agent` / `implemented-pending-host`（或等价措辞）/ `ready-for-human` / `done`。
2. 对已合入 main、仅欠宿主/strict 的票批量改 Status，并在 Comments 链到合入 commit / REPORT。
3. `AGENTS.md` / `docs/agents/issue-tracker.md` 补一行读法：Comments 写「已落地」但 Status 仍 ready = triage 债务，以 Status 为准派活前必须重读 Comments。

## 非目标

- 不借机改产品行为或放宽断言。

## Comments

- 2026-09-23 planner 开票。
