Status: ready-for-agent

# 借鉴 mcode-stack 与 pstack：Native 优先的拆分、缓存与测量

来源：
- MiniMax-AI/mcode-stack `stacks/ronny/`：subagent-split-check、long-command-check、context-tax-audit、independent-review、harness-experiment、trajectory-review；
- pstack `skills/poteto-mode/playbooks/orchestrate.md`、`skills/swarm`；

本地副本位于 `/home/tcuni-claw/scripts/{mcode-stack,pstack}`。

用户目前主要使用 Native 模式，因此 Native 相关条目优先，Lite 条目暂缓。

## Problem Statement

1. **Root 提示缓存可能在等待子代理时过期。**
   - Native 下子代理异步运行，Root 交还控制权，子代理完成后再被唤醒。
   - 若唤醒前的空闲时间超过服务商的缓存有效期，Root 唤醒后的第一轮要为整个前缀重新付费，正好打在本插件想压低的 Root 成本上。
   - pi-ai 默认使用短缓存保留期；环境变量 `PI_CACHE_RETENTION=long` 可改为长保留期（Anthropic 为 1 小时，直连 OpenAI 为 24 小时）。本机当前未设置。
   - 目前没有数据说明这个问题实际有多大。
2. **Native 指令不论任务大小都要求拆分。**
   - `NATIVE_PROMPT` 只有一句"实现和跑测试交给子代理"，没有小任务例外，也没有要求核实子代理审查给出的发现。
   - subagent-split-check 警告的正是这种按工作种类而非上下文边界拆分的做法；independent-review 也要求先逐条核实审查发现再修。
3. **测量缺少翻转视角和缓存指标。**
   - 基准汇总没有按任务给出相对基线的通过/失败翻转，也没有 Root 缓存命中率。
   - 近期结论多来自每组每任务一次运行。
4. **审查设置可以更独立**：reviewer 与 worker 用不同家族的模型，发现按固定结构输出。这在 Native 下属于 pi-subagents 的配置，不是插件代码。

## Solution

按优先级推进：

- **P1，Native Root 缓存测量（离线，不花钱）**：
  1. 新增离线分析脚本，读取真实 Pi 会话记录：
     - 统计每轮 Root 请求距上一次 Root 请求的空闲间隔、触发原因（工具结果、用户消息、子代理完成通知、其他）和缓存命中情况；
     - 按间隔分组，看命中率在哪里下跌。（issue 01；按 provider 拆分见 issue 02；跳过子代理会话见 issue 03。已完成）
  2. 用它分析本机近期的 Native 会话，写出结论报告。（已完成，见 `root-cache-report.md`）
  3. ~~问题确认后，在 `/planner-only status` 里加上 Root 缓存命中率和冷启动次数~~ **暂缓**（2026-10-29 用户同意）：只有 Native Root 用 Claude 时，等待 ≥5 分钟才冷启动；本机 Native 主流的 tcuni GPT 系列在 5–60 分钟内命中率约 95%，显示意义低。Native 的 Claude 用量明显增加时再评估。
  4. 对策（2026-10-29 用户同意）：不默认开启 `PI_CACHE_RETENTION=long`，也不笼统推荐。估算在全部模式下 Claude 的缓存费用反而上升约 30%，只有 Native 下 Claude Root 长时间等待子代理时才可能净省。README 只说明它的作用、代价（写入单价从 1.25 倍升到 2 倍、子代理继承）和适用场景，由用户自行决定。
- **P2，Native 指令的最小修改（需要对照实验）**：
  - 候选只加两句：一两处的小改动由 Root 自己做；子代理审查的结论，先打开代码逐条核实再修。
  - 用 bench 的 native 组做对照，每组每任务至少 2 次。也可以先从日常使用中收集自然发生的证据。
  - 不把 Lite 的规则搬进来，保持 Native 是中性指令。
- **P3，配置与文档**：README 里建议 reviewer 使用与 worker 不同家族的模型，并说明如何通过 pi-subagents 的 agent 配置要求结构化发现（问题、位置、原因、严重程度）。
- **支撑：bench 汇总**：
  - 按任务的翻转视图；
  - 单样本标注；
  - Root 缓存命中率；
  - 实验记录格式：假设、唯一改动、运行次数、指标表、翻转任务及原因、决定。
- **暂缓（仅 Lite）**：
  - 检查结论绑定代码状态（`git_commit` 指纹提示）；
  - reviewer 结束指令改为结构化发现；
  - `plannerPrompt` 的修改（受 1,500 字符上限约束，现为 1,498）；
  - "Worker 自测"与"Worker 加 Validator"的对照实验；
  - 按失败原因重试并设上限；
  - 先跑通一个再批量。

## User Stories

1. 作为 Native 用户，我想知道子代理运行期间 Root 缓存有没有过期、过期多少，以便判断是否值得开启长缓存保留期。
2. 作为维护者，我希望缓存分析直接读取 Pi 的会话文件，不需要重跑任何模型。
3. 作为维护者，我希望分析能按空闲间隔分组，给出每组的请求轮数、缓存命中率和冷启动轮数。
4. 作为维护者，我希望分析能按触发原因分组，区分子代理完成通知唤醒和普通工具结果。
5. 作为维护者，我希望只统计处于 Native（或指定）模式下的 Root 轮次，并能看到模式在会话中途的切换。
6. 作为维护者，我希望会话首轮、切换模型后的首轮和交接后的首轮单独标注，不与"空闲导致的过期"混在一起。
7. 作为维护者，我希望结果可以输出为 JSON，便于归档和前后对比。
8. 作为维护者，我希望看到总缓存写入成本，以及空闲过期导致的那部分写入成本（按会话记录中已有的费用字段，不重新定价）。
9. 作为 Native 用户，我希望 `/planner-only status` 显示本会话 Root 缓存命中率和冷启动次数（在 P1 结论支持后实施）。
10. 作为 Native 用户，我希望文档说明 `PI_CACHE_RETENTION=long` 的作用和代价（写入单价更高），以便自己决定是否开启。
11. 作为 Native 用户，我希望很小的改动不必经过子代理（在 P2 测量支持后实施）。
12. 作为 Native 用户，我希望 Root 在修复审查发现前先逐条核实（在 P2 测量支持后实施）。
13. 作为维护者，我希望基准汇总能显示按任务的通过/失败翻转，并标注单样本。
14. 作为维护者，我希望基准汇总包含 Root 缓存命中率，以免一项改动省了 token 却破坏了缓存。
15. 作为维护者，我希望每次改动 Root 指引都有一份固定格式的实验记录。
16. 作为维护者，我希望 Lite 的条目保留在暂缓清单中，不被遗忘，也不抢占 Native 的工作。

## Implementation Decisions

- **缓存分析（P1）**：放在 bench 目录，作为独立的离线命令。不调用模型，只读取输入。
  - **输入**：Pi 会话 JSONL，即 `type: "message"` 的条目带 `timestamp` 和 `message.usage`；模式来自 `custom` 条目 `planner-only-mode`；子代理通知是 `custom_message`，`customType` 以 `subagent` 开头。
  - **只统计 Root 会话**：子代理自己的会话不参与，只计统计会话文件内的 Root assistant 消息。
  - **命中率**：cacheRead / (input + cacheRead + cacheWrite)。冷启动轮指 cacheWrite 大于 cacheRead 的轮次。
  - **空闲间隔**：当前 assistant 的 `message.timestamp`（请求开始）减去上一条 assistant 的外层 `timestamp`（响应结束）。当前条缺少 `message.timestamp` 时，退回到外层时间戳之差，并计为近似。
  - **分组**：默认按 5 分钟和 60 分钟两个边界分组，可通过参数调整。
  - **首轮**：会话首轮、模型或思考级别切换后的首轮、交接产生的新会话首轮，单独归类为"结构性冷启动"。
  - **会话树**：会话文件可能有分支（回退）。第一版按文件顺序处理，并在报告中注明这一近似。
- **状态显示（P1 第 3 步）**：复用 Native 现有的 Root 用量记录，只增加观察性输出，不改变任何行为。
- **术语**：沿用 `CONTEXT.md` 中的 Root、Native、Lite、Root handoff。

## Testing Decisions

- 缓存分析的测试参照 `bench/test_guidance_metrics.py`：用合成 JSONL 夹具，通过子进程调用命令，检查文本和 JSON 输出，只测外部行为。
- 先写测试并运行，确认失败原因是缺少该行为，再实现。
- 离线运行时 `TMPDIR` 设为 `/project/tmp` 下的目录，不使用 `/tmp`。
- 涉及插件代码的改动（状态显示、指令）必须通过 `npm run test:release`，现有断言不得删除或削弱。

## Out of Scope

- 采纳"默认单主循环、只为上下文拆分"的立场：与插件的成本前提冲突。
- 插件替用户设置 `PI_CACHE_RETENTION`：这是用户本机的配置。
- 修改 pi-subagents 本身的行为或 agent 定义。
- 任何付费模型运行：P2 的对照实验需另行批准预算。
- 子协调者、多层编排、云端 worker（来自 pstack）。

## Further Notes

- 已吸收或已印证、不需要再做的：
  - handoff brief 已有"排除过的方案 / 怎么验证的 / 已知坑"字段（`84e3519`）；
  - 默认开新子代理、不续接，与 ADR-0011 一致；
  - 派活时写明完成证据、看 diff 而不是看汇报；
  - 后台长任务与限制状态查询的指引；
  - Lite 只暴露 4 个工具。
- 与仓库已有原则一致：`docs/lite-direction-review-2026-09-25.md` 提出"不能为了委派而委派"，最终要看通过率、全部尝试与返工费用、耗时和人工介入。
