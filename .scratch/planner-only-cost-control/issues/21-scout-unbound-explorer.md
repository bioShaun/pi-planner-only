# 21: scout 无 TaskSpec 时走 unbound explorer，不占用票 canonical id

**What to build:** Root 委派 pi-subagents 内置 `scout`（无嵌入 TaskSpec、未点名一个可绑定的 live Task）时，走现有 unbound-explorer 路径：不创建 Task、不调用 `nextTaskId()`、不采样 baseEvidence、输出原样返回、不当 WorkerReport 解析。启动的 agent 名称仍是调用方给的 `scout`，不得 remap 成 explorer 的 builtin reviewer。`agent: "explorer"` 的既有 remap 与「点名 live Task 则绑定」行为不变。`agent: "worker"` 且无 TaskSpec 仍按工单 03 创建占位 Task。

**Blocked by:** None (can start immediately). Sequential with 20: 不要与 20 抢同一批文件的同一轮。

**Status:** ready-for-agent

- [ ] `agent: "scout"`、无 TaskSpec、prompt 不点名 live Task：`beginDelegation` 不增加 store 中的 Task 数；delegation.kind 为 explorer；taskId 为 `unbound-explorer-<toolCallId>`；input.agent 启动时仍为 `scout`。
- [ ] 该次结果按 explorer 原样返回，不出现 `Placeholder task T-YYYYMMDD-NNN created`，不出现 `Worker output ... is not a valid WorkerReport`。
- [ ] 随后一次无 TaskSpec 的 `agent: "worker"` 才创建占位 Task，其 canonical id 是这次 Worker 的 `nextTaskId()`，不是被 scout 预先占走的 id。
- [ ] `agent: "explorer"` 无 Task 仍 remap 到 ROLE_AGENTS.explorer（builtin reviewer），并保持 unbound-explorer 警告原文。
- [ ] scout prompt 点名一个可绑定的 live Task id 时，绑定该 Task，不新建 Task（与现有 explorer 点名行为一致）。
- [ ] 不改 DEFAULT_FLOORS、不改 spec、不勾 03/08 checkbox。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md` 阶段 A 决策第 4 条（无特征字段才允许占位）与 08 验收「无占位 Task」。证据：`.scratch/planner-only-cost-control/phase-a-08-run/comparison.md` §4.1 / §6 第 1 条。

08：Root 先 `agent: scout`。`inferRoleFromAgent("scout")` 现为 undefined，编排按 worker 创建占位 `T-20260907-001` 并在 `9027d8f` 采样 base。随后 Worker 提交 `9921446` 仍挂在同一 id 上，`planner_verdict` 报 `HEAD changed (9027d8f -> 9921446)` 且 under-reported。

禁止把 scout remap 成 `ROLE_AGENTS.explorer`（`"reviewer"`）：那会拿掉 scout 的 bash，08 里的侦察将无法跑。分类为 explorer **kind** 只影响 Task/回执，不改变调用方指定的 agent 可执行文件。

scout 的用量入账不在本票范围，归工单 23（2026-09-08 拍板收进 23）：本票只管「不建 Task、原样返回」，账本那边不入账不是本票的设计意图。

不要发明未在 08 观察到的其它 builtin 名；本票只收 `scout`（大小写不敏感）。工单 03 的 worker 占位路径保持原验收。

round_id=p06-r026
