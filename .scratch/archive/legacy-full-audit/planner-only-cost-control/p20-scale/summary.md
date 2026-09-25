# p20 E3/E2/E1 对照汇总（2026-09-09，planner cursor `w2E:pE`）

口径与 p19 相同：宿主会话 `message.usage.cost.total`，`p18-contract-run/spend.py`。不计 `type=custom`。隔离 arm 的 worker 费用会出现在根 `toolResult` **和** `run-0`，`spend.py` 合计双计；去重一次生成另列。不把插件 `usage.jsonl` 当账本。`/planner-only usage record` 两臂都不可用。

样本：F6 **E3**（exhausted 拒启与 untrusted 一样删 `usageBudget` / `__floorLimits`）、**E2**（`renderTaskStatus` 暴露 `writeErrorFor`）与 **E1**（status 披露会话内隔离不解除），各 isolation / role-split 一臂。基线 worktree SHA `45d9493`。驱动 `CAP_USD=2.86` 写死，对照完成后已解除武装。

## 1. 每次运行

| 组 | arm | exit | spend.py | 去重一次生成 | 根墙钟 | worker 墙钟 | 会话 |
|---|---|---|---|---|---|---|---|
| ISO-E3 | isolated-baseline | 0 | `0.058959` | `0.034303` | 149 s | 112 s | `runs/session-ISO-E3` |
| SPLIT-E3 | role-split | 0 | `0.018214` | `0.018214` | 542 s | 460 s | `runs/session-SPLIT-E3` |
| ISO-E2 | isolated-baseline | 0 | `0.125587` | `0.073622` | 228 s | 151 s | `runs/session-ISO-E2` |
| SPLIT-E2 | role-split | 0 | `0.017618` | `0.017618` | 846 s | 781 s | `runs/session-SPLIT-E2` |
| ISO-E1R2 | isolated-baseline | 0 | `0.278854` | `0.148471` | 413 s | 363 s | `runs/session-ISO-E1R2` |
| SPLIT-E1 | role-split | 0 | `0.009859` | `0.009859` | 162 s | 113 s | `runs/session-SPLIT-E1` |

无效/中止记录（**不计入对照**，计入用户账）：`session-ABORT-SPLIT-E3`（误触 `$0.003841`）、
`session-ISO-E1`（r096：worktree 未 restore，样本是 E2 残留，`$0.157509` 沉没）、
`session-ABORT-ISO-E1R2`（planner 探针事故 `$0.076681`）。

墙钟 = 该 jsonl 首末 `timestamp` 之差。Root 都是 `gpt-5.6-luna`。Isolation worker 是 luna；role-split worker 是 `qwen3.8-27b`、宿主 usage 费用 `0`。

拆开（只计 `type=message`）：

| 组 | 根 luna assistant | 根 toolResult（worker 镜像） | run-0 worker | 根回合 / worker 回合 |
|---|---|---|---|---|
| ISO-E3 | `0.009648` | `0.024655` | luna `0.024655` | 7 / 13 |
| SPLIT-E3 | `0.018214` | `0` | qwen `0` | 11 / 29 |
| ISO-E2 | `0.021657` | `0.051965` | luna `0.051965` | 17 / 20 |
| SPLIT-E2 | `0.017618` | `0` | qwen `0` | 10 / 19 |
| ISO-E1R2 | `0.018088` | `0.130383` | luna `0.130383` | 8 / 36 |
| SPLIT-E1 | `0.009859` | `0` | qwen `0` | 6 / 29 |

## 2. 两方案指标（付费对照，n=3 票 E3+E2+E1）

通过率：isolation 3/3，role-split 3/3。无失败、无剔除、无返工。

成功完成成本（去重一次生成）：

| 方案 | E3 | E2 | E1 | 合计 |
|---|---|---|---|---|
| isolated-baseline | `0.034303` | `0.073622` | `0.148471` | `0.256396` |
| role-split | `0.018214` | `0.017618` | `0.009859` | `0.045691` |

本样本去重 role-split / isolation：E3 ≈ **0.53**，E2 ≈ **0.24**，E1 ≈ **0.07**，三票合计 ≈ **0.18**。**不外推，不是产品承诺。**

Isolation 去重后 worker 占比：E3 ≈ **72%**，E2 ≈ **70.6%**，E1 ≈ **87.8%**（38/39 时 worker 只占一半或更少）。扩规模后稳定的结论：贵的是 luna worker，不是 root 开场；E1 测试块大，worker 轮数最多（36）。

平均耗时（根墙钟）：isolation `(149+228+413)/3 = 263 s`；role-split `(542+846+162)/3 = 517 s` ≈ **2.0×**。单票比值 3.6× / 3.7× / 2.5×。p19 的 38/39 是约 5–7×。

p20 `runs/` 闸门合计 **`0.747121`**（六组有效 `0.512856` + ISO-E1 无效 `0.157509` + 误触 `0.003841` + ABORT `0.076681`， spend.py 逐会话数与合计一致）。用户 `$3`：p18+p19 `0.131035` + p20 `0.747121` = **`0.878156`**，剩余 **`2.121844`**。驱动帽 `2.86` 未动，帽内剩余 `2.112879`。**对照完成后驱动已解除武装**（argv 空与点名均 `exit 2`）。

误触：planner 把「解除武装」的 `run.sh` 改动和一次 `SPLIT-E3` 探针并行提交，探针读到旧驱动、又起了一次 luna root（1 回合 `$0.003841`，无 worker）。已杀掉；jsonl 挪到 `runs/session-ABORT-SPLIT-E3/`，**不计入对照**，但计入用户账。工作区产品文件仍干净。

## 3. 质量

- **产品 `orchestrate.ts`**：E3 两臂快照**字节相同**（`c21df04..6687c1d`，sha `f389e467…`）；
  E2 两臂快照也**字节相同**（`c21df04..689d0e2` / `fa78d27..4fa0157`，sha `14d99580…` / `f092564e…`）；
  **E1 两臂字节不同**（ISO `c21df04..6fa4bf9` / SPLIT `c21df04..7017c1b`）——同是 `lines.push` 措辞逐字，
  但插入位置不同（ISO 在数组字面量后、aliases 之前；SPLIT 在 `return lines.join` 之前），
  测试块结构也不同（ISO 3 条断言 / SPLIT 4 条）。行为等价，照记质量差，不补跑。
  E3：`reservation.refused` 上按 untrusted 同样删除两字段，拒绝文案仍走 `cumulativeBudgetRefusal`；
  E2：`renderTaskStatus` 在 `writeErrorFor(taskId)` 为真时追加 `Ledger write: 本会话无法写入该 taskId 的账本（writeErrorFor）`，「余额不可信」原文未动；
  E1：`isQuarantined(taskId)` 为真时追加 `Ledger quarantine: 本会话拒绝写入该 taskId 的账本（隔离在会话内不解除）`，不在会话内解除隔离。
- **测试 `orchestrate.test.mjs`**：E3 两臂**字节不同**（记质量差，不补跑）。行为等价：都带 `usageBudget`、都匹配 `/cumulative budget exhausted/`、拒后 `usageBudget` 与 `__floorLimits` 都不在。ISO 插在 V9 后、任务 id `T-20260908-p20`、`__floorLimits: { marker: true }`；SPLIT 插在 V14 后、id `T-20260908-v16`、带 `reports.push` 与更像真实 floor 的 `__floorLimits`。
  E2 两臂**字节相同**：都在 L15 后加一条 L15b 断言匹配 `/本会话无法写入该 taskId 的账本/`；L10/L14b 未动。
  E1 两臂**字节不同**：都在 L14–L24 段后新增独立 `.planner-only-16b-l25-` 块（`T-20260908-965`，中途修复后披露仍在）。
  planner 在各 worktree 样本上重跑 `orchestrate.test.mjs` 均为 PASS（E3/E2/E1 三票，日志 `p20-r09*-planner-verify-test.log`）。
- 主仓 `index.ts` / `orchestrate.ts` / `orchestrate.test.mjs` 全程无 diff。E2+E3 的产品修复已由 r095 正常轮次落地主仓（`8b22568`）；E1 的产品修复**只在 worktree 快照**（用户未拍板是否落地）。
- 隔离基线未关 Root policy（`ROLE_MODELS=1`，worker=luna）。
- 回合不对齐（各票 root/worker 回合数两臂不同）。各票都只适合当作同任务同产品 diff 的费用/时延对照，不是逐步对齐的回合对照。

快照：`iso-e3-*.diff`、`split-e3-*.diff`、`iso-e2-*.diff`、`split-e2-*.diff`、`iso-e1-*.diff`、`split-e1-*.diff`
（验收备忘 `iso-e2-notes.md` / `split-e2-notes.md` / `iso-e1r2-notes.md`）。

## 4. 闸门

`p20-scale/run.sh`：环境已定义 `CAP_USD` 则 `exit 1`；否则 `CAP_USD=2.86` 且 `readonly`。
r096 失败后新增**基线闸门**：`run_group()` 起跑前检查 worktree 的 `orchestrate.ts` / `orchestrate.test.mjs`
无 tracked diff，否则 `exit 1` 不自动 restore。付费组在本对照完成后全部解除武装（argv 空或点名均 `exit 2`）。

## 5. 不做的事

不抬 `CAP_USD`。不把 worktree 样本 checkout 进主仓（E1 样本除外——它尚未落地，见 §3）。不 push。
对照完成后付费组已解除武装；无效会话（`session-ISO-E1`、`session-ABORT-*`）留盘作证。
