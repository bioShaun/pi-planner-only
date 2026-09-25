# 17: Root 费用限制范围披露

**What to build:** 插件检测宿主是否提供 Root 下一次模型调用前的可执行控制。有则 Root 费用纳入硬阻断；只有事后 Usage 时，status 明确标记 Root 部分是事后累计与后续委派限制，披露在途调用与 Root 继续调用造成的超额，不把软提示包装成整项 Task 的绝对硬上限。预算约束不通过新增 Root 编辑能力实现。

**Blocked by:** 13。

**Status:** 第 1、3、4 条 done（p15-r072 + planner 收尾）；第 2 条 blocked-on-host（宿主不提供该控制点，见 deferred-backlog）

- [x] 宿主无预调用控制：status 显示 Root 限制为事后观测，并显示已发生超额。
- [ ] 宿主有预调用控制：status 显示 Root 纳入硬阻断，Root 超额时下一次模型调用被阻断。
- [x] 两种环境下 Root 工具能力均与改动前一致。
- [x] 测试文字不得假装阻断 Root：无控制环境的测试只断言展示与超额披露。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Story 39，阶段 D 决策第 6 条）。

2026-09-08（p15-r072）：第 1、3、4 条证据；**第 2 条留空且不勾**。Status 行与 checkbox 均未改。

- 第 1 条：宿主无预调用控制时，status 把 Root 标成事后观测，并在已配置维度 `remaining < 0` 时写出已发生超额。`renderTaskStatus` 在已配置预算块追加「Root: 无预调用控制，Root 自身消耗只能事后计入（已计入 tokens=…、费用 $…）」；tokens 超支时行末为「；本 Task 当前已超额：tokens N」，两维同时超支用「、」连接。W10–W12 守展示与超额披露。默认 `HOST_ENFORCEMENT` 两维都是 `false`，与当前宿主（无 Root 预调用控制）一致。
  round_id=p15-r072

- 第 2 条：留空。pi-subagents 0.66.0 不提供「Root 下一次模型调用前」的可执行控制入口，这条在当前宿主下不可验证。不许因为 status 里写了 `if (enforcement.tokens)` 展示分支就勾上。这与工单 05 第 1、2 条曾经的处境是同一类问题：当时只证明了宿主**接受** `usageBudget` 参数形状，并不证明运行时在 `hard` 处强制执行；本条同样不能把未提供的控制点写成已验证的硬阻断。
  round_id=p15-r072

- 第 3 条：两种环境下 Root 工具能力与改动前一致。本轮只改 `floors.ts` 的声明加载和 `orchestrate.ts` 的 `renderTaskStatus` 文案；没有新增 Root 编辑能力，没有改工具注册，也没有在 Root 模型调用前插入拦截。`architecture.test.mjs` 仍断言 `orchestrate.ts` 不含 `UsageLedger` / `recordRootTurn` / `recordChild`。
  round_id=p15-r072

- 第 4 条：测试文字不得假装阻断 Root。W7–W14 只断言 status 展示与超额披露；无控制环境下没有「下一次模型调用被阻断」之类的断言。W11/W12 的超额文案是记账差值，不是拦截证明。
  round_id=p15-r072

2026-09-08（planner claude-pD 收尾）：**勾第 1、3、4 条；第 2 条仍不勾。**

### 已记录的偏离：把「检测」换成「声明」

本票 What-to-build 的原话是「插件**检测**宿主是否提供 Root 下一次模型调用前的可执行控制」。
p15-r072 没有这么做，也不打算这么做——这是一次刻意偏离，写在这里，免得以后有人当成遗漏补回去。

**改成了什么：** 由操作者用 `PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS` /
`PI_PLANNER_ONLY_HOST_ENFORCES_COST_USD` 显式声明，默认两维都是 `false`。
插件不探测、不推断，`DEFAULT_HOST_ENFORCEMENT` 由 `architecture.test.mjs` 的 W15 钉死在
`false, false`，`floors.ts` 也被 W16 禁止 import 宿主。

**为什么：** 能被探测到的只有「宿主**接受** `usageBudget` 这个参数形状」——工单 05 第 1、2 条
和工单 36 F1 都只走到这一步。**接受参数形状不等于会在 `hard` 处停下子进程。**
真让插件去探测，唯一能拿到的信号就是形状，于是探测结果必然被读成「有硬阻断」，
把一个从未验证过的能力自动写成已验证——正是本票第 4 条要防的那件事。
把它降级成操作者的一句声明，等于要求人来为这个断言负责，插件不替他断言。

**代价（明确写出来）：** 真到了宿主提供预调用控制的那天，不会自动生效，得有人去设这两个环境变量。
这是故意的：宁可漏报，也不自动上报一个没人验证过的硬阻断。

**这条偏离在什么条件下应该被推翻：** 有人拿到一次真实子进程跑到 `hard` 被宿主停下的证据
（工单 36 的 F3，要花模型钱，用户尚未拍板）。在那之前，任何「加个探测吧」的改动都是回潮。

### 第 2 条为什么还是空的

pi-subagents 0.66.0 没有「Root 下一次模型调用前」的可执行控制入口，这条在当前宿主上无法验证。
`renderTaskStatus` 里那个 `enforcement.tokens ? …` 展示分支**不是**证据，不许拿它勾第 2 条。

### 收尾时改掉的措辞

Root 披露行原来的超额后缀是「；当前tokens 超额 …」：既缺空格，又把 **Task 级**超额印在
一行讲 Root 的话里，读起来像是 Root 自己超的。现为「；本 Task 当前已超额：tokens N、费用 $X」，
源码注释里写明归属，W11 另加一条断言禁止旧措辞回潮。详见工单 14 同日收尾说明。

round_id=p15-r072（planner 收尾）
