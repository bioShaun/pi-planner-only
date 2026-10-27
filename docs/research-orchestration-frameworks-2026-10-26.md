# 编排框架官方资料对比：LangGraph、OpenAI Agents SDK、CrewAI

核查日期：2026-10-26。范围为官方在线文档、API 参考与官方示例，以 Python 接口为主；这是当日读取的滚动文档快照，未锁定安装版本，未运行框架或命令测试。下文“事实”为文档明确记载，“推断”为基于这些接口的设计判断。未考察 coding-agent 产品或本地 pi 实现。

## 五个维度

| 维度 | LangGraph | OpenAI Agents SDK | CrewAI |
| --- | --- | --- | --- |
| **独立任务并行委派（事实）** | 静态分支并行；动态 `Send` 为 worker 分配各自输入与状态，通过 reducer 汇总到共享键。Functional API 示例先创建多个 task future，再取结果汇总。[L1] | 官方推荐代码中用 `asyncio.gather` 并行运行独立 agent。`Agent.as_tool()` 让 manager 保留控制权；handoff 则切换活跃 agent，二者语义不同。[O1] | `Task(async_execution=True)` 不阻塞后续任务；下游 `context=[task_a, task_b]` 等待并使用两者结果。Flows 另支持多入口、异步方法和 `and_` 汇合。[C1][C2] |
| **子任务结束后确定性命令验收** | **事实：**普通代码节点、条件边与 future 结果提供程序化 gate 的位置。[L1] **推断：**把固定命令执行器放在 worker 完成后的节点，按退出码决定放行；这是应用代码实现，文档中的 schema、示例质量检查不等于已执行 shell 测试。 | **事实：**代码式编排支持结果检查、链式调用与评估循环；guardrail 可执行自定义检查。[O1][O4] **推断：**`await Runner.run(...)` 或并行汇合之后，由宿主执行固定命令并判定退出码最明确；不能仅依赖 manager 是否选择调用验证工具。 | **事实：**函数式 task guardrail 在输出传给下一任务前验证，返回成功/失败及结果或反馈；可重试。完成后的 `callback` 也有文档，但其定位是回调。[C1] **推断：**单任务可在函数 guardrail 中执行命令；所有并行 worker 结束后的联合验收宜放在 Flow `and_` 下游方法中，并用代码阻止失败结果继续流转。[C2] |
| **前序产物直接交给下游（事实）** | 节点通过 state 字段传值；动态 worker 输出汇入共享键；Functional API 示例直接把 `.result()` 交给下一 task，不要求 Root 重新叙述。[L1] | `RunResult.final_output` 是字符串或 `output_type` 对象；代码可把它转换为下一 agent 的输入。`to_input_list()` 提供完整本地 transcript 的续轮输入，两种传递粒度应区分。[O1][O2] | `Task.context` 引用前序 Task；`task.output` 可读取具体结果。Flow 的 `@listen(upstream)` 方法直接接收上游返回值，也可从共享 state 取值。`and_` 文档示例通过 state 读取多路结果，不能据此假定自动传入全部结果列表。[C1][C2] |
| **按角色设置推理投入与评估** | **事实：**图节点可调用不同模型；`ChatOpenAI` 提供 `reasoning_effort`，这是模型集成层配置。官方有独立 evaluator-optimizer 模式。[L1][L2] **推断：**按角色分别创建模型/节点并配置 effort；评估节点的模型与通过标准由应用指定，并非 LangGraph 统一的角色 effort 字段。 | **事实：**Agent 有独立 `model`、`model_settings`；支持 `ModelSettings(reasoning=Reasoning(effort=...))`，参数支持取决于模型/provider。官方展示 task agent 与 evaluator agent 的代码循环。[O1][O3] **推断：**可分别给 worker 与 evaluator 设置投入，但模型评估仍不是确定性命令验收。 | **事实：**Agent 有 `role`、`llm`、`reasoning`、`max_reasoning_attempts`；`reasoning=True` 指执行前反思与规划。LLM 层另有受模型支持限制的 `reasoning_effort`。`crewai test` 多次运行 crew，用指定模型给任务评分，并报告执行时间。[C3][C4][C5] **推断：**按角色绑定不同 LLM 可区分 effort；规划尝试次数、模型 effort、评估得分是三件事。 |
| **trace span 与计时（事实）** | 接入 LangSmith 后记录图执行；自定义函数可用 `@traceable` 嵌套。LangSmith run 有 `start_time`、`end_time`、`parent_run_id`、`trace_id`，可重建层级及耗时；这是 LangSmith 集成能力。[L3][L4] | SDK 默认 tracing；涵盖 agent、generation、function、guardrail、handoff，支持 `custom_span()`。Span 有 `started_at`、`ended_at`、`parent_id`。tracing 可关闭，ZDR 组织不提供此能力。[O5] | CrewAI AMP Traces 提供总运行时间、逐任务时间、任务起止时间与 timeline，用于观察并行和瓶颈。此处证据属于 AMP 平台，不能据此宣称 OSS 自动具备相同 span 导出协议。[C6] |

## 验收与选型判断（设计推断）

- **固定验收必须是控制流的一部分。**推荐结构为“并行独立 worker → 等待全部必要结果 → 宿主执行预定检查命令 → 依据真实退出码及产物放行 → 下游”。三者文档均提供可接入此结构的代码控制流，但这些材料没有证明任一框架会默认替用户项目运行验收命令。[L1][O1][C1][C2]
- **区分三层验证。**schema / `output_type` / `output_pydantic` 约束形状；输出 guardrail 验证其函数或模型实际检查的属性；shell 测试验收还要求执行器真的启动命令并获取结果。函数 guardrail 可以承载执行器，但名称本身不提供执行证据。OpenAI agent 输入 guardrail 只作用于链首，输出 guardrail 只作用于产出最终答案的 agent；逐个受保护 function-tool 调用应查看 tool guardrail。CrewAI 的字符串 guardrail 是 LLM 判断，`crewai test` 的 1–10 分也不是项目测试退出码。[L1][O2][O4][C1][C5]
- **偏重显式 DAG、状态传递与汇合：优先考察 LangGraph；偏重 Python 宿主控制加 agent/tool tracing：优先考察 OpenAI Agents SDK；偏重角色化任务、现成 context/guardrail 和业务 Flow：考察 CrewAI。**这是根据上述接口的适配判断，不是性能排名；本次没有基准测试。[L1][O1][O5][C1][C2][C3]
- **计时需要统一口径。**由这些起止时间可计算各步骤耗时，但并行子 span 耗时之和可能大于总墙钟时间。建议分别记录端到端墙钟、单角色耗时、模型耗时及验收命令耗时，并给宿主验收单独埋点；trace 中显示“完成”只能证明对应步骤结束，不能替代命令结果。[L4][O5][C6]

## 官方来源

- [L1] LangGraph 工作流：并行、`Send`、state/future 传递、条件 gate、evaluator-optimizer：<https://docs.langchain.com/oss/python/langgraph/workflows-agents>
- [L2] LangChain OpenAI 模型集成与 `reasoning_effort`：<https://docs.langchain.com/oss/python/integrations/chat/openai>
- [L3] LangGraph 接入 LangSmith、嵌套自定义追踪：<https://docs.langchain.com/langsmith/trace-with-langgraph>
- [L4] LangSmith run 数据字段：<https://docs.langchain.com/langsmith/run-data-format>
- [O1] OpenAI Agents SDK 多 agent 编排：<https://openai.github.io/openai-agents-python/multi_agent/>
- [O2] SDK 结果类型与续轮输入：<https://openai.github.io/openai-agents-python/results/>
- [O3] Agent 配置、推理设置与参数兼容性：<https://openai.github.io/openai-agents-python/agents/>；<https://openai.github.io/openai-agents-python/models/>；<https://openai.github.io/openai-agents-python/ref/model_settings/>
- [O4] SDK guardrail 的边界、执行与 tripwire：<https://openai.github.io/openai-agents-python/guardrails/>
- [O5] SDK trace/span 与时间字段：<https://openai.github.io/openai-agents-python/tracing/>
- [C1] CrewAI Task：异步、context、输出、guardrail、callback：<https://docs.crewai.com/en/concepts/tasks>
- [C2] CrewAI Flow：start/listen、状态、`and_` 与路由：<https://docs.crewai.com/en/concepts/flows>
- [C3] CrewAI Agent 角色、LLM 与规划参数：<https://docs.crewai.com/en/concepts/agents>
- [C4] CrewAI LLM 配置与推理 effort：<https://docs.crewai.com/en/concepts/llms>
- [C5] CrewAI testing 的模型评分与时间指标：<https://docs.crewai.com/en/concepts/testing>
- [C6] CrewAI AMP Traces：<https://docs-platform.crewai.com/platform/en/features/traces>
