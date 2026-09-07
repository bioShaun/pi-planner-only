# 05: 有界委派默认 toolBudget 与 usageBudget 地板

**What to build:** 报告修正、纠偏、Validator、Explorer 这类有界委派在调用方和 TaskSpec 都没有给预算时，也带着默认的工具调用硬上限与用量（token、费用）硬上限启动；实现 Worker 首轮不设默认工具上限但必须有默认用量上限。调用方或 TaskSpec 有更严格限制时取更严者。默认值可在配置中覆盖但不能为空。委派结果里能看到本次生效的上限来自默认地板、调用方还是 TaskSpec。一个在已通过的测试上反复执行同一命令的纠偏 Worker 会在上限处被宿主停止，Root 收到停止原因而不是等到人工 kill。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] 无任何预算的报告修正委派：宿主实际启动参数含默认 toolBudget.hard 与 usageBudget（真实公开宿主入口验证）。
- [ ] 无任何预算的 Validator 与 Explorer 委派：同上；实现 Worker 首轮只含默认 usageBudget。
- [ ] 调用方给出比默认更严的 usageBudget：生效值是调用方的；TaskSpec budget 比默认更严：生效值是 TaskSpec 的；两者都更宽松：生效值是默认地板。
- [ ] 委派结果说明生效上限及来源。
- [ ] 子进程因工具上限被停止时，Root 收到的结果包含停止原因，Task 状态不停留在 executing。
- [ ] 默认数值集中在一处配置，可覆盖，设为空时启动报错。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（问题 5，User Story 7，阶段 A 决策第 6 条）。证据：analysis P5（210 轮、207 次同一命令、约 $0.98、零护栏）。阶段 D 的 14 要在此基础上叠加累计余额。

Round `p05-r021`: 落地默认 toolBudget / usageBudget 地板。集中配置在 `floors.ts`，有界委派（纠偏/修正/Validator/Explorer）默认 toolBudget.hard=20, tokens.hard=40000, costUsd.hard=0.10；Worker 首轮仅默认 tokens.hard=100000, costUsd.hard=0.50；Reviewer 不设默认地板。更严者胜并在委派结果中注明来源 (floor/caller/taskSpec)。子进程因工具/用量上限停止时 Task 状态转 failed 并向 Root 报告原因。空或非法配置启动报错。E2E 显式核查并标记 §F 预算契约未验证。全部 15 组单测及类型检查均 PASS。
