# 11: 验证状态五分法，无报告或空结果不走 bounded 快速路径

**What to build:** 每个 Task 的验证状态区分通过、失败、未运行、未知、无需验证。没有 WorkerReport、validation 为空、缺项、not-run、失败、或状态与退出码矛盾，都不能满足必需验证，Validator 因此走 full 模式而不是 bounded。无需验证只能来自 TaskSpec 明确不要求验证。validation.required 为真时命令与预期结果必须被完整覆盖，缺少可执行或可判断的要求时返回需补充定义的原因。

**Blocked by:** 03、08。

**Status:** done（2026-09-08 planner 独立核验，代码在 p06–p11 各轮已落地）

- [x] 无报告：状态未知，Validator 合同为 full。
- [x] validation 为空且 status 不是 failed：状态未知，Validator 合同为 full。
- [x] 含 not-run 或状态 passed 但退出码非零：状态失败或矛盾，必需验证不通过。
- [x] TaskSpec validation.required 为假：状态无需验证，status 显示理由。
- [x] required 为真但 commands 为空：委派返回需补充验证定义的原因。
- [x] 完整通过且与当前 Evidence 匹配：状态通过。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 22–26，阶段 C 决策第 1 条）。现状：无报告时验证被视为通过、落到 bounded。

p08-r034：无报告时验证状态为未知，Validator 合同为 `ORACLE_SUITE=full`。
p08-r035：空 validation 且 status 非 failed 时验证状态为未知，Validator 合同为 `ORACLE_SUITE=full`；纯函数、prepareRoleDelegation 与公开 tool_call 均已锁定。
p08-r036：公开空 validation tool_call 场景补齐 validator 成功 `tool_result`，避免共享 usage 账本污染后续 oracle 成本断言；`npm test` 恢复 exit 0。
p08-r037：`not-run` 与 `passed` 非零退出码均判定必需验证未通过；纯函数、prepareRoleDelegation 与公开 tool_call 均锁定 Validator `ORACLE_SUITE=full`。
p08-r038：TaskSpec 显式 `validation.required=false` 的 status 显示无需验证及理由；缺省 false、空 validation、无报告仍不显示无需验证。
p09-r039：required 为真但 commands 缺失或为空时，Validator 委派与公开 tool_call 均返回「需补充验证定义」，不注册 pending 且不以 `ORACLE_SUITE` 顶替；非空 commands 路径保持原样。
p09-r040：已入库 Task 的 required validation 缺少 commands 时，task-id-only Validator 委派同样在启动前返回「需补充验证定义」，不包装 `ORACLE_SUITE` 且不注册 pending。p09-r041：完整通过且与当前 Evidence 匹配时 status 显示 `Validation: passed`；stale 或缺少 Evidence 不显示。

2026-09-08（planner claude-pD，纯核验，未改代码）：**六条全勾。** 干净 HEAD `23d10a4` worktree，`npm test`=0。

- 第 1 条：实跑核验（`.scratch/planner-only-cost-control/p15-probe/t11-c1-probe.mjs`）。无报告的 Task 发 Validator 委派，实际下传合同是 `ORACLE_SUITE=full`；`lastWorkerValidationPassed(undefined)` 为 `false`；status 里既无 `Validation: passed` 也无 `Validation: not required`（即未知）。
- 第 2 条：`orchestrate.test.mjs:3432`（p08-r035）—— validation 为空列表且 status 非 failed 判未知。
- 第 3 条：`orchestrate.test.mjs:3447`（p08-r037）—— 含 not-run、或 passed 但退出码非零，都不进 bounded。
- 第 4 条：`orchestrate.ts:1127` 输出 `Validation: not required (TaskSpec 明确不要求验证)`。**这条我专门实跑验证过**（`p15-probe/t11-c4-probe.mjs`）：`isExplicitlyNoValidation` 靠 `task.ts:36` 的 WeakSet，而写入只发生在 `createTaskSpec`（测试专用 helper）里，我一度怀疑真实的 JSON 解析路径永远不会命中、从而这条只在测试夹具里为真。实跑结论是**没有这个洞**——`extractTaskSpecDetails` 内部同样走 `createTaskSpec`，解析出来的 spec 一样进 WeakSet，端到端 status 确实打印该行。记在这里以免以后有人重复怀疑。
- 第 5 条：`orchestrate.test.mjs:135/153` —— required 为真但 commands 为空，委派被拦并返回需补充验证定义的原因（两条分别覆盖嵌入 spec 与仅点名 Task id）。
- 第 6 条：`orchestrate.ts:1128` —— 需同时满足有报告、非「明确不要求」、worker 验证通过、`lastComparison.fresh === true`、TaskSpec 验证完整，才判 `Validation: passed`。

round_id=claude-pD-2026-09-08-note-11
