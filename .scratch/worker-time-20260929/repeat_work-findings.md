# T2 重复工作分析

## 覆盖与口径

| Run | delegation 匹配 | child tool calls | 重复 calls / 总数 | 文件重复（本 child / 跨 child） | bash 重跑（本 child / 跨 child） |
|---|---:|---:|---:|---:|---:|
| o2-1 | 10/10 | 200 | 160/200 (80.0%) | 43 / 106 | 1 / 10 |
| o2-2 | 9/9 | 160 | 86/160 (53.8%) | 22 / 60 | 0 / 4 |
| r2t treat | 10/11 | 176 | 108/176 (61.4%) | 27 / 66 | 1 / 14 |
| r3t treat | 6/6 | 102 | 55/102 (53.9%) | 17 / 37 | 1 / 0 |
| r5s treat | 8/8 | 159 | 107/159 (67.3%) | 36 / 66 | 2 / 3 |
| **合计** | **43/44** | **797** | **516** | **145 / 335** | **5 / 31** |

链接通过 agent、usage.turns、durationMs（容差 10s）、toolCalls/toolCount 精确一致，并用 clone 路径/时间线索消歧。未匹配为 r2t #2 explorer：Root 结果缺 usage，不能可靠推断。整体链接可靠度较高，但非完整覆盖。Transcript 有逐消息时间戳、无单次工具调用耗时，故只能报告重复调用数，不能换算真实节时。

脚本还输出 handoff-named file rereads（各 run 94/62/61/35/65）。这是“早先 report 或当前 task 提到路径”的启发式命中，包含有意复核且可能受路径格式影响，不应视为浪费数。

**口径警告（Root 补充）：** “重复 calls”是把对某个已被任何 child 读过的文件的每次再读都算作重复（含修改后重读、validator/reviewer 有意复核、同文件不同切片），因此 516/797（65%）是**上限口径，不是浪费比例**，也不能换算成节省时间（transcript 无单次调用耗时）。真正可治理的浪费只是其中一部分，需要按下面的模式逐个判断。

## 模式与改进候选

1. **同一验证命令被重复派发/执行。** 例：o2-1 的 `pytest tests/contracts/test_ref_alt_stage_fold_to_long.py -q` 共 6 次；r2t 4 次、r3t 3 次、o2-2 3 次。Validator/reviewer 独立复验通常有用，不建议删掉验证；Root 可复用前序通过结果，仅在代码变更后追加测试。候选：delegate prompt 要求说明复跑理由及覆盖差异。估计每 run 省 0–30 秒；低置信，测试耗时未记录。
2. **Worker 在探索报告之后仍重复读取实现文件。** 五 run 均反复读 `src/tc_probe_design/pipelines/annotate.py`（例如 o2-2 共 18 次、o2-1 共 14 次；含多 child 与切片重读）。候选：explorer 报告附精确文件/行范围，worker prompt 要求优先按范围读取，仅在实现需要时扩展。估计每 run 10–45 秒；低置信，部分是必要上下文/修改前复核。
3. **同一 child 内文件反复读取。** 全部 runs 有 145 次额外读取；涉及相同文件不同 slice 也计重复。候选：worker/scout prompt 提醒记录已读文件与行范围、先扩读而非重新读相同范围。估计每 run 5–25 秒；中低置信，无法判断不同 slice 内容是否重叠。
4. **重复状态/差异检查。** `git status --short` 在 r2t 出现 4 次、r5s 3 次、o2-2 3 次；部分用于不同阶段确认，属低价值但可能必要。候选：Root 在任务交接中携带最近一次 status/diff 摘要，并要求仅状态变化后重查。估计每 run 2–10 秒；中置信。

**有用重复与浪费边界：** reviewer/validator 独立重跑测试、worker 修改后重读目标文件，视为有用验证；优先治理同一 child 的相同命令/文件重复、或 worker 对已明确报告路径的无差别重探索。脚本按 tool call 参数和路径统计，不会判断文件是否已被修改，因此结果是重复工作候选而非可直接消除的工作量。

## 复现

在本目录运行 `python3 repeat_work.py`。匹配、未匹配 delegation、每 run 重复统计与 top paths/commands 均由脚本打印。
