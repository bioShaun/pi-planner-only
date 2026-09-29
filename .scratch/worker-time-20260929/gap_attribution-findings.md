# Root 与委派间隙归因

## 时间戳盘点

- Root JSONL 有 session 的 ISO `timestamp`，event 通常没有独立时间戳；message 有毫秒 `timestamp`。assistant/toolResult 都是 `message_end`，无独立的 Root assistant 开始/结束事件对。
- toolCall 时间点取含 toolCall 的 assistant message_end；toolResult 时间点取 toolResult message_end。因此 Root 工具调用有可计算的 start→result span；Root assistant turn 没有显式 start，不能由相邻消息间隔切出其模型耗时。
- Root 实际工具：delegate、read、bash、git_audit、git_commit。strict 中存在 bash，未据此推断违规，只记录观察。
- child active 主要按 transcript 第一条至最后一条 user/assistant 消息时间；与 Root delegate submit→result span 对比时，前者排除了调度/委派外壳时间。委派关联沿用 `repeat_work.py` 的 agent/turn/duration/toolCalls 匹配。Root 日志缺失独立 event timestamp 时使用 message timestamp。

## 汇总

| run | wall s | child interval union s | 未被 child duration 覆盖的残差 s | overlap |
|---|---:|---:|---:|---|
| o2-1 | 1715 | 1212.57 | 502.43 | 否 |
| o2-2 | 1455 | 915.60 | 539.40 | 否 |
| treat r2t | 1994 | 1258.70 | 735.30 | 否 |
| treat r3t | 1155 | 777.18 | 377.82 | 否 |
| treat r5s | 1381 | 959.41 | 421.59 | 否 |
| 均值（描述性） | 1540 | 1024.69 | 515.31 | 0/5 |

残差分类合计（约 2576.54 秒）：Root-own-tool 1458.54 秒，delegate-submit-to-child-start 525.76 秒，child-end-to-Root-next-action 506.39 秒，无法区分 85.74 秒；Root-assistant-turn 区间近零（时间戳粒度及缺少 turn 起点所致）。段落按边界切分并合计到 wall；逐 run 脚本打印分段及总和。

| arm | n | wall 均值 | child union 均值 | 残差均值 |
|---|---:|---:|---:|---:|
| o2 | 2 | 1585.00 | 1064.09 | 520.91 |
| treat | 3 | 1510.00 | 998.43 | 511.57 |

最大 Root 动作间 gap（每 run）：o2-1 57.22s（reviewer 后→worker）；o2-2 224.33s（explorer 后→worker）；r2t 135.53s（explorer 后→worker）；r3t 105.56s（explorer 后→worker）；r5s 116.61s（explorer 后→worker）。输出 token 可用时脚本列出；这些 gap 不代表模型延迟。

Root phase gap 汇总（次数/秒，来自每次 Root 委派间动作间隔；中位数与最大值见脚本逐 run 表）：before first delegate 5/28.42；after explorer 14/939.87；after worker 15/148.75；after validator 7/98.75；after reviewer 3/57.22；final wrap-up 12/106.74。最大 gap 为 o2-2 explorer 后 224.33 秒。

## 可验证的改动假设

目前不提出改动假设：统计能定位长间隔及其相邻角色，但不能证明它由重复决策/长输出导致，Root assistant turn 的明确时长也不可见。需要用可观测的关键路径事件验证等待、往返和重复决策后再提出假设。

角色的 wall share 大不意味着可删除；应看关键路径上的等待、往返与重复决策。未能归因的因素包括事件间的 reasoning/生成、调度或排队、工具内部工作、Root 与 child 并行时间，以及 transcript 匹配误差。gap 仅表示时间戳区间，绝不标为模型 latency。n=2/3 的 arm 均值仅为描述性结果。

## Root 复核更正（重要）

上面的类别名 “Root-own-tool” 和 “delegate-submit-to-child-start” **有误导**，以本节为准。原因：Root 日志中 message 的 `timestamp` 是消息创建时间（message_start 与 message_end 相同），assistant 消息的时间戳是该次 LLM 请求的开始。所以 “assistant 时间戳 → 该轮 toolResult 时间戳” 里包含的是 **Root 模型的推理+输出生成**，read/git_audit 本身只需毫秒。例如一个 128 秒的 “Root-own-tool read” 实际是一轮输出 16,160 token 的 Root 生成。同理 “delegate-submit-to-child-start” 主要是 Root 写 delegate task 那一轮的生成。

用 `root_turns.py`（本目录）复算，5 个 run：
- 不含 delegate 的 Root 轮次，合计秒数占 wall：8% / 25% / 18% / 14% / 19%（o2-1, o2-2, r2t, r3t, r5s）；加上写 delegate task 的轮次会更多。
- 这些轮次的耗时随输出 token 增长：输出 <200 token 中位 6.8 秒；200–500 中位 7.8 秒；500–1000 中位 12.4 秒；>1000（23 轮）均值 43 秒、中位 32 秒，最大约 129 秒（16k token）。约 90–110 token/秒。
- 输出 token 主要是 thinking：5 个 run 合计 thinking 约 80 万字符，delegate 任务文本约 19 万字符，普通文本约 1.6 万字符。大轮次多在 explorer 返回后、下一次委派前（读一两个文件后大量 thinking）。
- 该 Root 用的是全局默认 thinking level（`~/.pi/agent/settings.json` 的 `defaultThinkingLevel: high`；bench 命令行没有单独指定）。

“未被 child duration 覆盖的残差” 33% 因此大部分是 Root 模型生成（以 thinking 为主）与写委派任务，而不是工具或调度开销。仍无法区分的：单轮内推理与输出各占多少；delegate 启动开销（child 第一条消息前的部分）。

## 可验证的改动假设（Root 复核后补）

**假设：Root 的 thinking level 从 high 降到 low/medium，可以明显缩短 Root 生成时间（explorer 后、委派前的长思考），且不降低通过率。** 这不是缩短 worker，而是关键路径上 Root 的长思考轮次。风险：Root 的规划与验收质量可能下降（返工、漏检）。验证：同一 Root 模型（cline-pass/deepseek-v4.1-flash）、同一任务、child 配置和验证标准固定，只改 Root thinking；至少各 3 个有效 run；指标：通过率、总 wall、Root 生成秒数、委派次数、返工次数。前提：先确认 `pi --thinking <level>` 能在 bench 中按 arm 指定，且该模型的 thinking 档位确实会改变输出 token 数（小样本预测试）。
