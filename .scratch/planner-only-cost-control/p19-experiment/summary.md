# 工单 19 汇总（2026-09-09，planner cursor `w2E:pE`）

口径：宿主会话 `message.usage.cost.total`，脚本 `.scratch/planner-only-cost-control/p18-contract-run/spend.py`。不计 `type=custom`。隔离 arm 的 worker 费用会出现在根 `toolResult` **和** `run-0/session.jsonl`，`spend.py` 合计会算两遍；去重一次生成另列。不把插件 `usage.jsonl` 当账本。

`/planner-only usage record` 在本实验的 `pi -p` 会话里四组都不可用，工单 18 的插件 JSON 记录缺席。对照以本文件 + `freeze.md` §9–§13 + `runs/session-*` 为准。

样本：票 38、39，各 isolation / role-split 一臂。基线 worktree SHA `45d9493`。SMOKE 零费率，不计对照。未跑第三张票。驱动 `CAP_USD=0.10` 写死。无失败组，无补跑。

## 1. 每次运行

| 组 | arm | 票 | exit | spend.py | 去重一次生成 | 根墙钟 | worker 墙钟 | slot 日志 | 会话 |
|---|---|---|---|---|---|---|---|---|---|
| SMOKE | 本地冒烟 | — | 0 | `0.000000` | — | 118 s | — | `p18-r086-slot-*.log` | `runs/session-SMOKE` |
| ISO-39 | isolated-baseline | 39 | 0 | `0.037454` | `0.025639` | 115 s | 72 s | `p18-r087-slot-*.log` | `runs/session-ISO-39` |
| SPLIT-39 | role-split | 39 | 0 | `0.009766` | `0.009766` | 519 s | 476 s | `p18-r088-slot-*.log` | `runs/session-SPLIT-39` |
| ISO-38 | isolated-baseline | 38 | 0 | `0.030139` | `0.023772` | 80 s | 39 s | `p19-r089-slot-*.log` | `runs/session-ISO-38` |
| SPLIT-38 | role-split | 38 | 0 | `0.014101` | `0.014101` | 590 s | 552 s | `p19-r090-slot-*.log` | `runs/session-SPLIT-38` |

墙钟 = 该 jsonl 首末 `timestamp` 之差。Root 都是 `gpt-5.6-luna`。Isolation worker 都是 luna；role-split worker 都是 `qwen3.8-27b`、宿主 usage 费用 `0`。

拆开（只计 `type=message`）：

| 组 | 根 luna assistant | 根 toolResult（worker 镜像） | run-0 worker | 根回合 / worker 回合 |
|---|---|---|---|---|
| ISO-39 | `0.013823` | `0.011816` | luna `0.011816` | 7 / 9 |
| SPLIT-39 | `0.009766` | `0` | qwen `0` | 7 / 9 |
| ISO-38 | `0.017406` | `0.006366` | luna `0.006366` | 11 / 5 |
| SPLIT-38 | `0.014101` | `0` | qwen `0` | 8 / 6 |

## 2. 两方案指标（付费对照，n=2 票）

通过率：isolation 2/2，role-split 2/2。SMOKE 另计 1/1。无失败、无剔除、无返工（每组一次，样本 diff 一次成型）。

成功完成成本（去重一次生成，四组都 exit 0）：

| 方案 | 票 39 | 票 38 | 合计 |
|---|---|---|---|
| isolated-baseline | `0.025639` | `0.023772` | `0.049411` |
| role-split | `0.009766` | `0.014101` | `0.023867` |

总支出（闸门 `spend.py`，含 isolation 双计）：isolation `0.067593`，role-split `0.023867`，SMOKE `0`，驱动合计 `0.091459`。

平均返工：两方案都是 0。

平均耗时（根墙钟）：isolation `(115+80)/2 = 98 s`；role-split `(519+590)/2 = 555 s`。

本样本去重合计 role-split / isolation = `0.023867 / 0.049411`。**不外推，不是产品承诺。**

用户 $1 账：p18 契约 `0.039576` + 本驱动 `0.091459` = `0.131035`。驱动帽内剩余 `0.008541`。

## 3. 质量

- 票 39：两边 `orchestrate.test.mjs` 把唯一 `planner-only orchestration: PASS` 挪到文件末行；无 `assert` 删除。两臂快照字节相同（`fa78d27..c6c8f3e`）。
- 票 38：两边 `orchestrate.ts` 在 `processedRunIds` 与 `confirmedNotLaunchedIds` 换成同一段冻结四行注释；Set 行为无改。两臂快照字节相同（`c21df04..4a052ab`）。
- 主仓 `index.ts` / `orchestrate.ts` / `orchestrate.test.mjs` 全程无 diff。样本只在 worktree。
- 隔离基线未关 Root policy（`PI_PLANNER_ONLY_ROLE_MODELS=1`，worker=luna）。
- 票 39 两边 root/worker 回合数对齐（7/9）。票 38 不对齐（isolation 11/5，role-split 8/6），38 只适合当作同任务同 diff 的费用对照，不是逐步对齐的回合对照。
- Role-split 在本样本上更便宜、明显更慢（本地 qwen worker 墙钟是 isolation 的数倍）。

## 4. 闸门（G2）

`p19-experiment/run.sh`：环境已定义 `CAP_USD` 则 `exit 1`；否则 `CAP_USD=0.10` 且 `readonly`。起 `pi` 前用 `spend.py` 看 `$RUN`，`>= 0.10` 打印 `SPEND GATE` 并拒绝。每组后 `--require`。离线探针 A/B/C 见 `p18-r085-execution-report.md`；探针 C 的 `SPEND GATE` 文案仍在 `runs/gate.log`。

## 5. 不做的事

不加第三张票。不抬 `CAP_USD`。不把 worktree 样本 checkout 进主仓。不 commit / push（本文件除外的产品文件本就无 diff）。
