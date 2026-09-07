# 17: Root 费用限制范围披露

**What to build:** 插件检测宿主是否提供 Root 下一次模型调用前的可执行控制。有则 Root 费用纳入硬阻断；只有事后 Usage 时，status 明确标记 Root 部分是事后累计与后续委派限制，披露在途调用与 Root 继续调用造成的超额，不把软提示包装成整项 Task 的绝对硬上限。预算约束不通过新增 Root 编辑能力实现。

**Blocked by:** 13。

**Status:** ready-for-agent

- [ ] 宿主无预调用控制：status 显示 Root 限制为事后观测，并显示已发生超额。
- [ ] 宿主有预调用控制：status 显示 Root 纳入硬阻断，Root 超额时下一次模型调用被阻断。
- [ ] 两种环境下 Root 工具能力均与改动前一致。
- [ ] 测试文字不得假装阻断 Root：无控制环境的测试只断言展示与超额披露。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Story 39，阶段 D 决策第 6 条）。
