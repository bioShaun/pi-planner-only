# 11: 验证状态五分法，无报告或空结果不走 bounded 快速路径

**What to build:** 每个 Task 的验证状态区分通过、失败、未运行、未知、无需验证。没有 WorkerReport、validation 为空、缺项、not-run、失败、或状态与退出码矛盾，都不能满足必需验证，Validator 因此走 full 模式而不是 bounded。无需验证只能来自 TaskSpec 明确不要求验证。validation.required 为真时命令与预期结果必须被完整覆盖，缺少可执行或可判断的要求时返回需补充定义的原因。

**Blocked by:** 03、08。

**Status:** ready-for-agent

- [ ] 无报告：状态未知，Validator 合同为 full。
- [ ] validation 为空且 status 不是 failed：状态未知，Validator 合同为 full。
- [ ] 含 not-run 或状态 passed 但退出码非零：状态失败或矛盾，必需验证不通过。
- [ ] TaskSpec validation.required 为假：状态无需验证，status 显示理由。
- [ ] required 为真但 commands 为空：委派返回需补充验证定义的原因。
- [ ] 完整通过且与当前 Evidence 匹配：状态通过。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 22–26，阶段 C 决策第 1 条）。现状：无报告时验证被视为通过、落到 bounded。

p08-r034：无报告时验证状态为未知，Validator 合同为 `ORACLE_SUITE=full`。
p08-r035：空 validation 且 status 非 failed 时验证状态为未知，Validator 合同为 `ORACLE_SUITE=full`；纯函数、prepareRoleDelegation 与公开 tool_call 均已锁定。
p08-r036：公开空 validation tool_call 场景补齐 validator 成功 `tool_result`，避免共享 usage 账本污染后续 oracle 成本断言；`npm test` 恢复 exit 0。
p08-r037：`not-run` 与 `passed` 非零退出码均判定必需验证未通过；纯函数、prepareRoleDelegation 与公开 tool_call 均锁定 Validator `ORACLE_SUITE=full`。
p08-r038：TaskSpec 显式 `validation.required=false` 的 status 显示无需验证及理由；缺省 false、空 validation、无报告仍不显示无需验证。
p09-r039：required 为真但 commands 缺失或为空时，Validator 委派与公开 tool_call 均返回「需补充验证定义」，不注册 pending 且不以 `ORACLE_SUITE` 顶替；非空 commands 路径保持原样。
p09-r040：已入库 Task 的 required validation 缺少 commands 时，task-id-only Validator 委派同样在启动前返回「需补充验证定义」，不包装 `ORACLE_SUITE` 且不注册 pending。p09-r041：完整通过且与当前 Evidence 匹配时 status 显示 `Validation: passed`；stale 或缺少 Evidence 不显示。