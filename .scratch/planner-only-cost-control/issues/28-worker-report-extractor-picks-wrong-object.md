# 28: WorkerReport 提取器在多个 JSON 对象里挑错

**What to build:** worker 输出里同时存在 WorkerReport 与其它带 `status` 字段的 JSON 对象时，提取器会挑错对象，把一份**合法**报告判成 `invalid WorkerReport: status must be one of completed, partial, blocked, failed`。触发条件是 `validation` 用对象数组写法 —— 每个条目自带 `"status": "passed"`，而 worker 合同（`roles.ts:65` 起）并没有禁止这种写法。要求：提取器在候选对象里优先选真正的 WorkerReport（有 `version` + `taskId` + 顶层 `status` 且 `status` 取值合法），不要被嵌套或相邻对象带偏；挑错时的报错要指出它挑中了哪个对象，而不是只报字段值非法。

**Blocked by:** None（源码在 `0fe04df`）。

**Status:** ready-for-agent

- [ ] 一份 worker 输出，顶层 WorkerReport 的 `status` 合法、`validation` 是对象数组且条目 `status` 为 `"passed"`：报告被接受，不再报 `status must be one of ...`。
- [ ] `validation` 写成字符串数组的既有路径行为逐字不变（`68b5f76e`／`a5b8f153` 那种形状本来就能过）。
- [ ] 输出里确实**没有**合法 WorkerReport 时，报错文案仍然指明缺什么，不因为放宽挑选而把垃圾判成合法。
- [ ] 回归用例直接用 run5 的真实输出 `phase-a-08-run5/artifacts/subagent-artifacts/74f164e8-*_output.md` 作为输入；修复前该用例必须失败，回执贴出失败输出原文。
- [ ] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。

来源：08 第五次重跑 `phase-a-08-run5`（2026-09-08）。该轮 `grep -c 'not a valid WorkerReport'` 为 **6**（08 条款 8 要求 0）。被拒的 `74f164e8_worker_output.md` 里 `"status"` 出现四次：一次是 WorkerReport 自己的 `"status": "completed"`，另外三次是 `validation` 条目对象自带的 `"status": "passed"`。

r4 也踩到过同一条计数（2 次），当时归因不清；run5 把触发条件钉死了。

优先级低于 27，但同属 08 重跑的阻塞项。

round_id=claude-pD-2026-09-08-open-28
