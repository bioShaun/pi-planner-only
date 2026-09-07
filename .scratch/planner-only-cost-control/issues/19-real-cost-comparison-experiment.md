# 19: 真实费用对照实验

**What to build:** 在明确记录的样本与预算下，用同一组票分别运行高费用模型独立执行的隔离基线和角色模型分工方案，按 18 的规范记录每次运行，汇总比较通过率、成功完成成本、总支出、返工与耗时，并写成报告。隔离基线不解除产品中 Root 的 Policy。报告样本量与质量差异，不承诺节省比例。

**Blocked by:** 09、18。

**Status:** ready-for-human

- [ ] 样本票、模型配置、预算上限在实验前写定并记录。
- [ ] 每次运行前执行 `slot audit` 与 `slot status` 并记录。
- [ ] 每次运行有完整记录文件，失败运行不剔除。
- [ ] 汇总报告给出两方案的各项指标与样本量，说明质量差异。
- [ ] 报告不出现未经测量的节省百分比。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 42–43，阶段 E 决策第 1、3 条）。需要真实模型花费，故标 ready-for-human。
