# p20 E3/E2 对照汇总（2026-09-09，planner cursor `w2E:pE`）

口径与 p19 相同：宿主会话 `message.usage.cost.total`，`p18-contract-run/spend.py`。不计 `type=custom`。隔离 arm 的 worker 费用会出现在根 `toolResult` **和** `run-0`，`spend.py` 合计双计；去重一次生成另列。不把插件 `usage.jsonl` 当账本。`/planner-only usage record` 两臂都不可用。

样本：F6 **E3**（exhausted 拒启与 untrusted 一样删 `usageBudget` / `__floorLimits`）与 **E2**（`renderTaskStatus` 暴露 `writeErrorFor`），各 isolation / role-split 一臂。基线 worktree SHA `45d9493`。驱动 `CAP_USD=2.86` 写死。无失败组，无补跑，未开 E1。

## 1. 每次运行

| 组 | arm | exit | spend.py | 去重一次生成 | 根墙钟 | worker 墙钟 | 会话 |
|---|---|---|---|---|---|---|---|
| ISO-E3 | isolated-baseline | 0 | `0.058959` | `0.034303` | 149 s | 112 s | `runs/session-ISO-E3` |
| SPLIT-E3 | role-split | 0 | `0.018214` | `0.018214` | 542 s | 460 s | `runs/session-SPLIT-E3` |
| ISO-E2 | isolated-baseline | 0 | `0.125587` | `0.073622` | 228 s | 151 s | `runs/session-ISO-E2` |
| SPLIT-E2 | role-split | 0 | `0.017618` | `0.017618` | 846 s | 781 s | `runs/session-SPLIT-E2` |

墙钟 = 该 jsonl 首末 `timestamp` 之差。Root 都是 `gpt-5.6-luna`。Isolation worker 是 luna；role-split worker 是 `qwen3.8-27b`、宿主 usage 费用 `0`。

拆开（只计 `type=message`）：

| 组 | 根 luna assistant | 根 toolResult（worker 镜像） | run-0 worker | 根回合 / worker 回合 |
|---|---|---|---|---|
| ISO-E3 | `0.009648` | `0.024655` | luna `0.024655` | 7 / 13 |
| SPLIT-E3 | `0.018214` | `0` | qwen `0` | 11 / 29 |
| ISO-E2 | `0.021657` | `0.051965` | luna `0.051965` | 17 / 20 |
| SPLIT-E2 | `0.017618` | `0` | qwen `0` | 10 / 19 |

## 2. 两方案指标（付费对照，n=2 票 E3+E2）

通过率：isolation 2/2，role-split 2/2。无失败、无剔除、无返工。

成功完成成本（去重一次生成）：

| 方案 | E3 | E2 | 合计 |
|---|---|---|---|
| isolated-baseline | `0.034303` | `0.073622` | `0.107925` |
| role-split | `0.018214` | `0.017618` | `0.035832` |

本样本去重 role-split / isolation：E3 ≈ **0.53**，E2 ≈ **0.24**，两票合计 ≈ **0.33**。**不外推，不是产品承诺。**

Isolation 去重后 worker 占比：E3 `0.024655 / 0.034303` ≈ **72%**，E2 `0.051965 / 0.073622` ≈ **70.6%**（38/39 时 worker 只占一半或更少）。这是扩规模后才看见的：贵的是 luna worker，不是 root 开场。

平均耗时（根墙钟）：isolation `(149+228)/2 = 189 s`；role-split `(542+846)/2 = 694 s` ≈ **3.7×**。p19 的 38/39 是约 5–7×。

p20 `runs/` 闸门合计 **`0.224218`**（ISO-E3 `0.058959` + 完成的 SPLIT-E3 `0.018214` + 误触中止 `0.003841` + ISO-E2 `0.125587` + SPLIT-E2 `0.017618`）。用户 `$3`：p18+p19 `0.131035` + p20 `0.224218` = **`0.355253`**，剩余 **`2.644747`**。驱动帽内剩余 `2.635782`。帽未抬。

误触：planner 把「解除武装」的 `run.sh` 改动和一次 `SPLIT-E3` 探针并行提交，探针读到旧驱动、又起了一次 luna root（1 回合 `$0.003841`，无 worker）。已杀掉；jsonl 挪到 `runs/session-ABORT-SPLIT-E3/`，**不计入对照**，但计入用户账。工作区产品文件仍干净。

## 3. 质量

- **产品 `orchestrate.ts`**：E3 两臂快照**字节相同**（`c21df04..6687c1d`，sha `f389e467…`）；
  E2 两臂快照也**字节相同**（`c21df04..689d0e2` / `fa78d27..4fa0157`，sha `14d99580…` / `f092564e…`）。
  E3：`reservation.refused` 上按 untrusted 同样删除两字段，拒绝文案仍走 `cumulativeBudgetRefusal`；
  E2：`renderTaskStatus` 在 `writeErrorFor(taskId)` 为真时追加 `Ledger write: 本会话无法写入该 taskId 的账本（writeErrorFor）`，「余额不可信」原文未动。
- **测试 `orchestrate.test.mjs`**：E3 两臂**字节不同**（记质量差，不补跑）。行为等价：都带 `usageBudget`、都匹配 `/cumulative budget exhausted/`、拒后 `usageBudget` 与 `__floorLimits` 都不在。ISO 插在 V9 后、任务 id `T-20260908-p20`、`__floorLimits: { marker: true }`；SPLIT 插在 V14 后、id `T-20260908-v16`、带 `reports.push` 与更像真实 floor 的 `__floorLimits`。两边都无 `assert` 删除。planner 在各自 worktree 样本上重跑 `orchestrate.test.mjs` 均为 PASS。
  E2 两臂**字节相同**：都在 L15 后加一条 L15b 断言匹配 `/本会话无法写入该 taskId 的账本/`；L10/L14b 未动。planner 在 SPLIT-E2 worktree 样本上重跑 PASS（`p20-r094-planner-verify-test.log`）。
- 主仓 `index.ts` / `orchestrate.ts` / `orchestrate.test.mjs` 全程无 diff。样本只在 worktree 快照。
- 隔离基线未关 Root policy（`ROLE_MODELS=1`，worker=luna）。
- 回合不对齐（E3：7/13 vs 11/29；E2：17/20 vs 10/19）。两票都只适合当作同任务同产品 diff 的费用/时延对照，不是逐步对齐的回合对照。

快照：`iso-e3-*.diff`、`split-e3-*.diff`、`iso-e2-*.diff`、`split-e2-*.diff`（E2 验收备忘 `iso-e2-notes.md` / `split-e2-notes.md`）。

## 4. 闸门

`p20-scale/run.sh`：环境已定义 `CAP_USD` 则 `exit 1`；否则 `CAP_USD=2.86` 且 `readonly`。付费组在本对照完成后全部解除武装（argv 空或点名均 `exit 2`）。

## 5. 不做的事

不开 E1（冻结写明未武装、勿自挑）。不抬 `CAP_USD`。不把 worktree 样本 checkout 进主仓。不 commit / push。对照完成后付费组已解除武装。
