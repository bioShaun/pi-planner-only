# 重复工作分类结果

## 计数与时间

| Run | FIRST | USEFUL-REVERIFY | USEFUL-AFTER-EDIT | WASTE-CROSS | WASTE-SAME | OTHER-REPEAT | child 秒 | turns | wall 秒 | 全 waste 秒 | mixed 半计秒 | (全 waste+mixed)/wall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| o2-1 | 92 | 1 | 18 | 19 | 19 | 65 | 1128.2 | 74 | 1715 | 51.0 | 113.8 | 9.61% |
| r2t treat | 87 | 14 | 12 | 7 | 12 | 42 | 1188.7 | 85 | 1994 | 8.7 | 59.4 | 3.41% |
| r5s treat | 96 | 7 | 6 | 6 | 33 | 43 | 896.4 | 78 | 1381 | 0.0 | 57.9 | 4.19% |
| **合计** | **275** | **22** | **36** | **32** | **64** | **150** | **3213.3** | **237** | **5090** | **59.7** | **231.0** | **5.71%** |

每个观察单位是文件路径读取，或一条 bash 命令；bash 中识别出的文件读取另计。child 秒为匹配 transcript 中首末 assistant 消息的跨度之和；turns 为 assistant 消息时间戳数。wall 读同目录 `.wall`。以 assistant 消息时间至下一 assistant 消息估时间：该 turn 所有观察均为 WASTE-* 才全额计入“全 waste”；含 waste 的混合 turn 只计一半，列为 mixed 半计秒。末 turn 无后继时间，记 0。

实现边界/偏差：按旧脚本链接函数匹配 transcript，delegate 顺序作为跨 child 先后；缺失或同时间戳可能影响先后。read 的 `offset/limit` 用于识别同 child 同范围复读，不同范围不会判 WASTE-SAME；bash 范围无法识别。bash 文件写入仅识别明确常见写操作，write/edit/apply_patch 从参数提取路径，可能漏掉写入或误认路径。当前子任务文本/前序报告路径做启发式匹配，未检查当时文件内容快照；changed 的编辑状态也限于可识别路径。耗时含模型等待，并非真实工具耗时。

## 例子

WASTE-CROSS（早先 child 报告/当前 task 已交接路径，后续 worker/explorer 未改动复读）：
- o2-1 explorer: `src/tc_probe_design/cli/commands/annotate.py`
- o2-1 explorer: `src/tc_probe_design/pipelines/annotate.py`
- o2-1 explorer: `src/tc_probe_design/config/annotate.py`

WASTE-SAME（同 child、同文件重复读取；工具为 read）：
- o2-1 explorer: `src/tc_probe_design/pipelines/annotate.py`
- o2-1 explorer: `src/tc_probe_design/workflows/allele_pair_align.py`
- o2-1 worker: `src/tc_probe_design/exceptions.py`

## 结论

严格全 waste 占 wall 约 1.17%；含 mixed turn 半计为 5.71%，跨过 5% 主要靠对混合 turn 的估算，证据不够支持大改工作流。建议小规模试验单一改动：Root 将 explorer 已读文件及行范围带入 worker task，并要求仅在实现确需时扩读。以同类 run 对比 WASTE-CROSS 次数、全 waste/mixed 秒及 wall 占比，同时人工抽查是否妨碍实现；本分析没有 per-call 时长，结论不确定。

复现：`python3 .scratch/worker-time-20260929/repeat_work_classify.py`；仅报告指定三次 run。
