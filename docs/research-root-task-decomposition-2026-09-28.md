# 编排工具调研与 Root 任务拆分优化建议

日期：2026-09-28。范围：官方文档和项目源码的机制比较；以下“建议”是对本仓库的推论，不是外部工具已验证的性能结论。外部源码链接固定在调查时的提交；本仓库现状依据 `ccfedcd11cfbb393c48a14a1eef177701b4b9754`。

## 主要结论

对能力较弱的执行模型，Root 应提前确定关键接口、行为边界和验收方式，减少子代理执行时需要自行作出的设计决定。单靠默认十分钟时限，无法判断任务是否适合所配模型。

本次调查中，Superpowers 和 GSD 对任务说明及拆分边界给出了较具体的指导；Aider 展示了方案推理与文件编辑的分工；Roo Code、CrewAI 和 LangGraph 提供上下文、依赖或反馈机制。各工具的具体依据见下表。这些机制不能直接证明在本插件上能提高完成率，仍需使用实际 Root/子模型组合验证。

建议第一阶段补强 Root 提示词、任务样例和 Worker 阻塞回报规则；通过对照运行确定收益后，再决定是否引入额外计划检查代理或结构化参数。

## 编码工具的具体做法

| 工具 | 上游如何划定任务 | 实际约束与边界 |
| --- | --- | --- |
| Superpowers | `writing-plans` 先定文件职责和接口；每项是可独立测试、值得单独复核的交付物，包含准确路径、接口、测试断言与验证命令。其模型选择规则建议：仅完整代码转录或单文件机械修复用最低档；根据文字需求实现至少用中档，跨文件集成与调试也用较强模型。执行时逐项交给新 implementer，逐项复核。 | 这些是 skill/提示词规定的流程和模型选型建议，并非便宜模型能力或成本收益的实证定律，也非从任意自然语言自动推导出合格任务的运行时校验。implementer 提示词要求遇到架构不明或超出边界时升级；plan 本身必须由上游编写、自检。具体见 [plan](https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/writing-plans/SKILL.md)、[执行与模型选择](https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/subagent-driven-development/SKILL.md)、[implementer 提示词](https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/subagent-driven-development/implementer-prompt.md)。 |
| GSD（2026-06 已归档的版本快照） | planner 要求每项写 files/action/verify/done；action 写明确标识、行为和避免事项的理由，新增接口先确定再接线；将单独无意义的搭建工作并入实际交付项。plan checker 复核模糊动作、依赖和验证缺口。 | 其每 plan 2–3 项、单项约 10–30% 上下文等均为该项目的启发式提示，不是本仓库可照搬的阈值；checker 是另一模型按提示评议，不等于确定性的 schema/质量保证。见 [planner](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/agents/gsd-planner.md)、[checker](https://github.com/gsd-build/get-shit-done/blob/bdcaab2c752d9a33a1a1ca9acf3a3c81fb991815/agents/gsd-plan-checker.md)。 |
| Aider Architect/Editor | Architect 看请求和代码，生成简明而完整的修改指示；Editor 接收这段文字产生实际编辑。配置可分别选模型。 | [源码](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/architect_coder.py)展示一次 architect 回复转交 editor，并在非自动接受配置下先问是否编辑；[提示词](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/architect_prompts.py)要求指令明确。它拆分推理与编辑，**没有**规定跨多个独立子任务的边界、验收或复核。官方[介绍](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/_posts/2024-09-26-architect.md)报告特定基准结果，不能推论本仓库成本或成功率。 |
| Roo Code Orchestrator/Boomerang | 上游 `new_task(mode, message, todos?)` 启动隔离上下文的子任务，父任务暂停；任务完成后只把总结带回。不同 mode 可记住不同模型；Orchestrator 默认无常规文件/命令工具。 | [new_task 文档](https://github.com/RooCodeInc/Roo-Code-Docs/blob/a676c4173ae60348095efaebfd1292a9617622c0/docs/advanced-usage/available-tools/new-task.md)列明必填 mode/message 和可选 todo；可开启“必须有 todo”的设置，却没有强制目标/文件/验收的结构化字段。[Boomerang 文档](https://github.com/RooCodeInc/Roo-Code-Docs/blob/a676c4173ae60348095efaebfd1292a9617622c0/docs/features/boomerang-tasks.mdx)明确需显式向下传上下文、向上传总结；其建议的具体范围/不越界等是示例 customInstructions，并非默认参数校验。默认审批和模式能力见 [modes](https://github.com/RooCodeInc/Roo-Code-Docs/blob/a676c4173ae60348095efaebfd1292a9617622c0/docs/basic-usage/using-modes.md)。 |

一个**虚构缓存项目的示意任务包**（展示 Root 可迁移的写法，并非本仓库现有文件或任何工具的原文协议）：

```text
目标：过期的缓存条目读取时返回 miss，未过期条目照常返回值。
范围：仅虚构项目的 src/cache.ts、test/cache.test.ts；不改存储接口或淘汰策略。
已定接口：沿用 get(key) 和现有构造函数注入的 clock.now()；过期边界为 now >= expiresAt。
验收：覆盖有效、刚好到期、超过到期时刻三种读取，断言返回值及 miss。
验证：运行该虚构项目的 npm test -- cache.test.ts，报告退出码、测试结果及实际 diff。
遇到未覆盖的公共接口/运行时依赖时：附证据回 Root 决定，勿自行扩大范围。
```

这里的粒度由“独立验收、接口依赖、模型是否需要自己作设计决定”决定；文件数和预计时长只可当提醒。上述路径和命令仅用于示意，不能在本仓库运行。

## 其他编排证据及迁移限制

- [Anthropic 多代理研究系统](https://www.anthropic.com/engineering/multi-agent-research-system)记载主代理需指定目标、输出格式、工具/来源建议和明确边界，过于模糊导致重复劳动与遗漏。其研究代理实验和资源比例不构成本仓库编码工作有效性的证据。
- [LangGraph orchestrator-worker 示例](https://docs.langchain.com/oss/python/langgraph/workflows-agents#orchestrator-worker)用结构化 `Sections(name, description)` 和 `Send` 将子项传进 worker 自己的状态，再汇总结果；这是数据流和字段结构，不强制描述足够细或能被便宜模型完成。
- [CrewAI planning](https://docs.crewai.com/v1.15.22/en/concepts/planning)可由 AgentPlanner 写分步计划并注入 task 描述；[task](https://docs.crewai.com/v1.15.22/en/concepts/tasks)有 description、expected_output、依赖 context 和可重试的 guardrail；[hierarchical process](https://docs.crewai.com/v1.15.22/en/learn/hierarchical-process)由 manager 分配并验证。这些配置/反馈机制仍不能保证拆解语义正确。

## 对 Lite 的建议（拟议，非现状）

当前 [plannerPrompt](../index.ts) 要求 Root 传目标、路径、约束、验证；超过默认十分钟要拆，失败后缩窄并带上报告，Root 检查 diff/输出。[CONTEXT](../CONTEXT.md) 规定子模型由 operator 配置，子代理不见父会话且无法中途向 Root 发问。`delegate.task` 当前只有非空字符串约束，**无自动任务拆解 schema**；这些是 Lite 的现状，不应与机器本地 native astra 协议混同。

建议优先在 Root 指导文本和委派样例中加入“任务包”：交付目标、确切范围与所有权、上游已经拍板的接口/依赖、不可越界事项、可观察验收、聚焦命令和阻塞回报方式。拆分条件优先是一个子项能否单独验证和复核，以及剩余设计判断是否超出所配执行模型；重复小改动若共享一套验收可合并，不能单独验收的搭建步骤并入交付项。遇到失败，Root 依据实际 diff/日志先分清缺上下文、范围过大、接口未决和模型能力不足，再缩小任务或换模型；不能假设重试必然有效。以上仅为待试的提示策略；若未来引入强制 schema/检查器，应另立需求并测试误拒率、完成率、耗时和总成本，针对实际模型组合比较。

## 优化优先级与实施位置

以下均为拟议改动，本次仅产出调研文档。

| 优先级 | 建议改动 | 实施位置 | 预期解决的问题 |
| --- | --- | --- | --- |
| P0 | Root 在派发前确定公共接口、行为边界、前置依赖；事实不足时先派探索任务 | `index.ts` 的 `plannerPrompt` | 子代理一边猜需求、一边实施，最终偏离目标 |
| P0 | 以独立可验收的行为划分任务；合并同类机械操作和不能独立交付的搭建步骤 | `plannerPrompt`，中英文 README 的委派示例 | 整个功能一次丢给弱模型，或拆得过碎导致重复探索和协调开销 |
| P0 | 将任务说明补齐为目标、范围、已定方案、验收、验证、阻塞条件，并给出一个完整示例 | `delegate.task` 描述、README | 只有任务标题和文件名，缺少实际执行依据 |
| P0 | Worker 遇到未决公共接口、范围外修改或必需信息缺失时，保留当前成果并报告缺口；Root 据证据重新规划 | `delegate.ts` 的 Worker 指导文本及 `plannerPrompt` | 子代理不能中途询问 Root，却自行扩大范围或反复猜测 |
| P1 | 针对复杂跨模块任务，让 Root 在派发前检查需求覆盖、接口一致性、依赖顺序和验证可行性 | `plannerPrompt` 或按需参考文档 | 计划条目齐全，但组合起来不能完成用户目标 |
| P1 | 根据实测结果明确各子模型的适用范围，记录何时应缩小任务、何时应调整模型配置 | README 的模型配置建议、现有测量流程 | 把能力不足误判为任务仍然不够小 |
| P2 | 若持续观察到任务字段遗漏，再评估最小结构检查；若复杂计划频繁出错，再评估独立计划检查代理 | 另行设计工具参数或流程 | 避免在尚无收益证据时增加每轮固定开销 |

第一阶段继续使用现有 `delegate({role, task, cwd?})`，将任务包写在 `task` 文本中。它属于提示约定，不宣称宿主能自动判定任务是否充分。模型调整仍通过 operator 的 `subagents.agentOverrides`，不假设 Root 能在单次 `delegate` 中切换模型。

Root 派发前可用下面四个问题自检：

1. 这项交付完成后，能用什么具体行为或产物判断成功？
2. 执行者是否仍需要决定公共接口、跨模块策略或用户需求？若有，先由 Root 解决。
3. 所需上下文和前序结果是否已经写进任务，或提供了精确可读的路径？
4. 验证是否能在本次预算内完成？若不能，将实现自测和后续完整验证分别安排，并在完整验证前保持未验收状态。

## 如何验证优化是否有效

使用同一批任务、相同仓库起点、相同 Root 和子模型、相同预算及验收标准，对比当前提示与增强提示。每次运行使用隔离工作副本；失败、超时和返工都纳入统计。先测试提示变化，再单独测试模型配置变化，避免混淆来源。

样本至少覆盖机械批量修改、单一行为修复、跨文件集成和信息不足需先探索四类。它们是建议的覆盖范围，不是已经完成的实验；实际运行次数应按预算确定并在结果中披露。

| 指标 | 统计口径 |
| --- | --- |
| 最终完成率 | 是否通过同一套外部验收，不以子代理报告完成为准 |
| 首次委派通过率与返工次数 | 首次结果是否满足该子任务的验收，以及随后纠正委派的次数 |
| 范围与上下文错误 | 是否漏传接口、重复探索、修改范围外文件；依据 diff 和日志分类 |
| 总成本与耗时 | 合计 Root、执行、验证、评审和返工；既报告全部尝试总成本，也报告每个成功任务的成本 |
| 过度拆分开销 | 委派次数、重复读取和 Root 协调轮次，结合任务类型解释 |

采用新规则的依据应是：验收质量保持或改善，且返工、总成本或耗时出现可重复改善。样本不足、结果波动或质量与成本互有得失时保留不确定性，不预先宣称收益百分比。

后续若实施插件改动，按仓库要求运行 `npm run test:release`，并将 `TMPDIR` 设在仓库外且不位于 `/tmp`；新增程序守卫时增加故障注入检查。确定性测试能验证提示注入及守卫行为，任务拆分质量仍需真实运行验证。本次文档整理未实施这些改动或运行付费实验。
