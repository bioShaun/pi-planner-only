# Lite 编排优化：产品参照与适用边界

日期：2026-10-26。范围：对照官方资料与当前 Lite 实现，评估并行、验收、上下文传递及计时。本文是研究建议，不修改运行代码、配置或 ADR，也不是性能实验结果。

已根据后续版本、strict 边界和调度约束核对修订。具体实施顺序和验收以 [Lite 编排优化实施方案](planner-optimization-plan-2026-10-26.md) 为准。下文 `validator` 是 Lite 角色名，对应宿主 agent `oracle`。

## 结论

优先减少不必要的委派，再并行执行必要的独立委派。确定性验收由运行时执行，决策仍由持有需求上下文的 Root 负责。自动修复循环与独立审查承担不同职责。

建议顺序：

0. 先确定目标宿主版本，对齐版本声明、开发依赖和类型检查，验证实际宿主的取消、同批并行和终态时序；这是 `check` v1 的前置条件。
1. 从既有会话日志建立离线基线，未知区间标为“交接间隙”或 unknown，不等待新增遥测。
2. 改写现有提示词：只把独立且锁兼容的委派放在同一批；收窄前置 explorer 条件，保留非 strict 模式的小任务自做规则。
3. `check` v1：仅 worker 可请求操作者配置的命名检查，仅在 child 为 `completed` 时执行，并保持目录锁。
4. 复用宿主 `pi-telemetry` 契约与可用接口，补齐离线日志不能解释的关键区间。
5. 在基线后单独试验 Root 的推理档位，不预设“审核阶段最适合降档”。
6. 报告引用暂缓；并行写不做；`check` v2 的同一 child 修复循环另行设计。

提示词不能简单追加：用户核对的非 strict/strict 长度为 1474/1489 字符，实施时需重新测量，通过改写满足两者均少于 1500 字符的现有约束。角色组合示例放工具描述，不写死 validator 与 reviewer 并行；内置检查上线后，该组合的需求会减少。

## 官方产品和框架的参照

| 工具或资料 | 本次核对的机制 | 对 Lite 的启示 |
|---|---|---|
| [Cursor subagents](https://cursor.com/docs/subagents) | 官方明确一条消息发出多个 Task 调用以同时执行；子代理默认新上下文，只向父代理返回结果；文档提醒简单任务可能因启动和收集上下文而变慢 | 支持批量派发，也支持少分派几跳；并行与减少子代理数量是两种独立优化 |
| [Claude Code agents](https://code.claude.com/docs/en/agents) | 区分会话内 subagent、团队、后台会话和脚本 workflow；并行写可用 worktree，团队模式也可按文件分工 | 无需把 Lite 扩成共享任务账本和通信系统才能获得并行收益 |
| [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams.md) | `TaskCompleted` 钩子退出码 2 阻止任务完成并返回反馈；`TeammateIdle` 钩子可以要求继续工作 | 完成事件可由确定性检查阻挡，但这种钩子不是默认自动测试，也不等同于 Lite child 已退出后的 resume |
| [Claude Code dynamic workflows](https://code.claude.com/docs/en/workflows.md) | 用脚本中的 `agent()`、`parallel()`、`pipeline()` 编排；中间结果留在变量里 | 上游结果不必由 Root 逐字重写；固定依赖可交运行时执行 |
| [Aider lint/test](https://aider.chat/docs/usage/lint-test.html) | `/test` 执行命令，非零退出时尝试修复；配置 `--test-cmd` 和 `--auto-test` 后可在编辑后自动测试 | 测试失败直接反馈当前编码上下文有成熟先例；自动测试需要配置 |
| [Cognition 实践](https://cognition.com/blog/multi-agents-working) | 单线程写入、独立干净上下文 reviewer；coding agent 用用户要求和既定决策筛选审查意见 | 保留决策所有者；报告传递不能替代范围与决策，审查意见也不应无条件进入自动修复 |
| OpenAI Codex | 官方检索结果支持并行子代理与分角色模型配置；本次官方页面和 `.md` 直取均返回 Forbidden | 只作方向参照；不据此断言当前具体字段、默认值或权限实现 |

通用框架的详细证据另见 [LangGraph、OpenAI Agents SDK、CrewAI 对比](research-orchestration-frameworks-2026-10-26.md)。它们的数据流、普通代码节点和 trace 值得参考；输出 schema 或 guardrail 本身不证明 shell 测试通过。

## `check` v1 与 v2

当前 `delegate.ts` 的 `launch()` 在收到终态时释放目录锁，然后 `runDelegation()` 生成结果。`check` v1 不能只在结果格式化阶段追加一条命令；需要把正常完成路径的锁持有期延长到检查结束，并保持取消、未确认停止、迟到终态的语义。

最小结果应区分 child 执行状态与检查状态，并保存命令、cwd、退出码、超时或取消状态、耗时、输出尾部及完整日志位置。child 返回 `completed` 不表示检查通过；检查超时或未运行也不能记成通过。

v1 只接受 worker 的命名检查；即使 validator 同样持独占锁，也不开放该参数。reviewer 不占锁，explorer 只持共享锁，不满足本方案的检查独占期要求。请求中的检查名、角色及配置在启动 child 前验证。

检查定义只能来自操作者控制的配置层，不能从仓库文件、项目 settings、仓库 `.env` 或 child 产物读取。实施方案拟用操作者启动宿主时提供的 `PI_PLANNER_ONLY_CHECKS` 名称映射；strict 和非 strict 统一禁止通过工具请求覆盖命令、参数、环境或检查超时。请求接受时固定定义，检查前不重新读取。strict 是工具使用策略而非沙箱；固定命令调用的仓库测试脚本可被修改，不能与仓库覆盖检查定义混为一谈。

child 非 `completed`，包括失败、超时、取消及 `stop_unconfirmed` 时，一律不执行检查，记为 `not_run`。跳过检查不构成释放未确认停止 child 的锁的理由。检查超时或取消后也要确认执行方停止再释放锁，迟到终态不得提前解锁。

验收必须包含未配置名称、请求覆盖命令、非 worker 请求 check 的拒绝场景，以及检查超时、检查期间取消、迟到终态不提前释放锁的故障注入。具体结果契约与验收矩阵见实施方案。

已核对安装包 `pi-subagents` 0.81.0 的 `docs/tool-reference.md`，其中描述了原生 `gate`：宿主运行命令，按工作区和环境复用部分验证结果；typed gate 则不复用。当前结构化请求解析器 `src/slash/delegation-request.js` 的允许字段仍没有 `gate`、`acceptance` 或 `resume`。因此：

- 原生工具通道有这个机制，不代表 Lite 的结构化通道能直接透传。
- v1 可以由 Lite 自己运行检查；这与“直接透传上游 gate 不可行”不是同一个结论。
- 初版不必做跨委派结果缓存；避免重复测试先从明确谁负责最终检查做起。
- worker 为修复问题而运行的局部测试仍有价值；v1 主要替代只有执行命令职责的 validator。

v2 有两种不同方案：在 child 存活时将检查结果反馈给它，或 child 终止后恢复同一会话。前者需要存活期间的验收反馈协议，后者需要结构化 resume。不能把“保留上下文”与“同一个进程一直没退出”混为一谈。

[ADR-0011](adr/0011-child-resume-is-not-exposed-in-lite.md) 的现状限制仍适用。它的收益测量针对超时后续跑，不能直接回答频繁检查失败后的修复收益；但绕过目录锁、身份关联和 git 摘要的通道问题也不会因新收益数据而消失。未来 v2 应保留单一锁所有者、总时间及尝试预算，并把越界决策或不可修复的环境问题交回 Root。

## 报告引用与减少委派

报告引用用于转交事实和证据，Root 仍需写明目标、Scope、Decided、Acceptance。下游不能把 explorer 的建议自动当成已批准的接口决策。

上游结构化请求中的 `context` 是 `"fresh" | "fork"`，Lite 当前固定发送 `"fresh"`，不是报告列表。未来若做引用，可另取 `contextRefs` 等名称，由插件解析后构造上游请求，不能原样透传。引用还需能定位完整报告、来源 cwd 和对应运行，明确失败或不完整报告的状态；新增这些语义的收益目前不足以优先实施。

主要潜在收益是减少 Root 输出和信息转述损失。报告进入 worker 上下文仍消耗输入 token；worker 为修改代码重新读取当前文件通常必要，不能把全部重复读取记作浪费。

非 strict 下约 ≤2 个文件或 ≤10 分钟的小任务仍由 Root 自己做。strict 下或已经需要委派的局部任务，可以直接让 worker 在限定范围内探索和实现。只有未知事实会影响 Root 必须先裁决的公共接口、跨模块方案或任务拆分时，才应先派 explorer；修改现有条件句，不叠加一条相互冲突的规则。

用户提供的重复读取占比 1–6%、Root 间隙约 67 秒，以及此前 19 万字符等样本数字，本次未重新审计原始记录，不能作为已复现的性能结论。省去一跳会节省启动和交接，但部分探索及推理可能转移给 worker。

## 计时与推理档位

版本纠正：此前读取的 pi-coding-agent 0.84.4 来自仓库开发依赖，实际宿主是 1.4.0。`package.json` 两处宿主声明仍为 `>=0.84 <1`，没有运行时范围检查；`contract.test.mjs` 核对 pi-subagents，不证明宿主兼容。必须先对齐版本与类型检查，并验证实际宿主的取消、并行和终态时序，不能等到遥测阶段才处理。

已在 1.4.0 的 `dist/core/extensions/types.d.ts` 中核对 `turn_start`、`message_start/update/end` 等事件仍存在。Lite 已有 request/started/update/response 关联和角色累计 duration，但累计 child 时间包含并行重叠，不能当作会话墙钟；类型定义的核对不等于运行验证。

`@earendil-works/pi-telemetry` 1.4.0 的 `README.md` 和 `dist/index.d.ts` 提供显式 context/span、links、指标、内存实现与存储查询契约，不自带 exporter。应先核对插件可用的宿主入口，复用现有契约补 delegation/check 的跨度，不重新设计一套 trace 抽象，也不从机器安装路径硬编码导入。[OpenTelemetry traces](https://opentelemetry.io/docs/concepts/signals/traces/) 可作后端适配参照，不是前置部署要求。

先从既有 JSONL 建立离线基线，无法拆分的区间标为“交接间隙”或 unknown。后续遥测补充缺失时序，避免重复记录宿主已有的 span；不能将未关联到宿主 trace 的孤立 span 宣称为完整关键路径。

`turn_start` 到 `turn_end` 可能包含工具执行；`message_start` 也可能是用户或工具结果消息。应筛选 assistant，并区分请求等待、首个输出和流式生成。没有 provider 时序时，不能将整个跨度标成纯 thinking。

状态展示分别报告墙钟与各角色累计时间；不可相加的重叠时间应明确标注。未被观测覆盖的区间先标 unknown，不自动归为模型思考或空闲。

只降低 Root 审核阶段推理档位并没有从这些官方资料得到普遍支持。日志归纳可单独测试降档；冲突裁决、需求符合性和接受审查意见仍可能需要复杂推理。实验应保持任务和子角色配置一致，比较端到端耗时、总 token、费用、返工和漏检，而不是只看 Root 响应速度。

## 成本口径

[Anthropic 的多代理研究系统文章](https://www.anthropic.com/engineering/multi-agent-research-system) 原文的数据是：其样本中 agent 约用普通聊天的 4 倍 token，多代理约用普通聊天的 15 倍。它不是同一批子代理从串行改成并行的成本倍数，也不是 Lite 的测量。

同样数量、同样任务的子代理改成并行，不必然增加 token，减少 Root 中间交接还可能节省 token。新增代理、重复探索、竞态返工或缓存差异才可能改变总量，需要实测。

便宜模型降低费用，不降低 token 数。若目标是省 token，就应单列 Root 输出、child 输入输出、缓存读取及总量；若目标是省钱，则另列实际费用，避免混用。

## 证据边界

本次核对官方文档和本地源码，没有运行产品对照实验、检查循环、性能 benchmark 或 release 测试。没有修改提示词、运行逻辑、配置及既有 ADR。各工具文档会更新；本文不把产品支持某种机制等同于 Lite 已经具备该机制。
