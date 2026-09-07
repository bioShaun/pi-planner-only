# 12: 有界复核只接受完整可信结果，否则 Validator 补检

**What to build:** 只有当必需验证结果完整、对应当前报告版本与 Evidence 时，Validator 才做有界复核；否则 Validator 按 TaskSpec 要求执行缺失或不可信的检查，优先补齐相关检查，TaskSpec 显式要求完整套件时遵循。测试文件存在与 Git 状态检查不能替代必需测试的实际结果。Worker 自报通过不产生通过 Verdict。

**Blocked by:** 11。

**Status:** ready-for-agent

- [ ] 报告验证完整且 Evidence 新鲜：Validator 合同为 bounded，只做复核。
- [ ] 报告验证完整但 Evidence stale：Validator 重跑 TaskSpec 要求的命令。
- [ ] 报告缺一条必需命令：Validator 只补跑缺失命令，不重跑全部。
- [ ] TaskSpec 要求完整套件：Validator 跑完整套件。
- [ ] Validator 只确认测试文件存在而未给出必需命令结果：不能推进为通过。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Story 27，阶段 C 决策第 2 条）。

p09-r042：Validator 仅在完整 WorkerReport 且 `lastComparison.fresh === true` 时使用 bounded；缺比较或 stale 使用 full 并重跑 listed commands。

p09-r043：TaskSpec 多必需命令且 WorkerReport 仅给出部分且 Evidence fresh 时，Validator 合同为 ORACLE_SUITE=missing，只补跑缺失命令；stale 仍降级为 full。
p10-r044：TaskSpec.validation.commands 精确包含 `npm run test:e2e`、`full suite` 或 `全量套件` 时，即使 WorkerReport 完整通过且 Evidence fresh，Validator 仍使用 ORACLE_SUITE=full。
p10-r045：Validator 仅确认测试文件存在或 Git 状态而未精确覆盖 TaskSpec 必需命令时，fresh 也使用 ORACLE_SUITE=full，且状态不显示 Validation: passed。
