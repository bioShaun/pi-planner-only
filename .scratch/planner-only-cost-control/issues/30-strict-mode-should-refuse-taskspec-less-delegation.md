# 30: 严格模式下无 TaskSpec 的委派应被拒绝，而不是造占位 Task

**What to build:** 工单 03 有意允许「委派文本没有任何 TaskSpec 特征字段 → 创建占位 Task 并在结果首行告知」，那是宽松模式下的合理兜底。但 08 条款 7 要求一次合格运行里 `Placeholder task` 计数为 **0**，两者的落点不同：03 管插件遇到空委派怎么办，08 管 Root 不该发空委派。run5 里 Root 从头到尾没嵌过 TaskSpec，第一个 worker 拿到的是没有 objective／scope／acceptanceCriteria 的空壳，整条评审链挂在一个「无目标」的 Task 上跑了 50 分钟。要求：`PI_PLANNER_ONLY_REQUIRE_REVIEW=1` 时，没有任何 TaskSpec 特征字段的委派**直接拒绝**并说明缺什么，不创建占位 Task；不设该变量时，03 的占位行为逐字不变。

**Blocked by:** None（源码在 `0fe04df`；与 03 的关系见下）。

**Status:** ready-for-agent

- [ ] 严格模式下，委派文本无任何 TaskSpec 特征字段：委派被拒，未创建 Task，未启动子进程，拒绝文案指名严格模式并说明需要哪些字段。
- [ ] 严格模式下，TaskSpec 合法的委派行为逐字不变。
- [ ] **不设**严格模式时，工单 03 的占位路径逐字不变：占位 Task 仍创建，结果首行仍告知占位事实与 canonical id，03 的既有测试一行不改即全绿。
- [ ] 特征字段判定仍以 `task.ts` 的 `TASKSPEC_CHARACTERISTIC_FIELDS` 为准，不另立一套。
- [ ] 不勾 03/08 checkbox、不改它们的 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。

来源：08 第五次重跑 `phase-a-08-run5`（2026-09-08）。该轮 `grep -c 'Placeholder task'` 为 **16**（08 条款 7 要求 0）。第一个 worker 的原话：

> No TaskSpec was embedded in this task — the objective, scope, constraints, and acceptance criteria are all empty. Per the planner-only worker contract, I made no code edits.

reviewer 也在 summary 里点出「TaskSpec embedded no explicit objective/scope/acceptanceCriteria, so review is limited to verifying the reported end state」。

**这不是工单 03 的回归。** 03 的第四条验收明写占位路径是有意设计且已实现。本票是把 08 条款 7 的要求落到代码上：门槛级运行不接受空委派。写票时确认过两者不冲突 —— 03 管兜底，本票管严格模式下不兜底。

r4 也踩到过（2 次），当时归因到 `reviewMode` 默认 root，属误判：22 落地后计数不降反升，说明是独立的一条。

round_id=claude-pD-2026-09-08-open-30
