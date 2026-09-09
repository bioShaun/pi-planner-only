# SPLIT-E2 验收（planner 重算，2026-09-09）

不采信执行者口头数字。下列由 planner 对 `p20-scale/runs/session-SPLIT-E2` 与 worktree 重跑；
执行者报告 `p20-r094-execution-report.md` 的两个 spend 数（`0.017618` / `0.224218`）已独立复现。

## 闸门

| 项 | 值 |
|---|---|
| spend.py `session-SPLIT-E2` | `0.017618`（planner 复跑一致） |
| spend.py `p20-scale/runs` | `0.224218`（planner 复跑一致） |
| 驱动 exit | 0 |
| worktree HEAD | `45d9493e25f47c58911edc01757c6133caeaa39d`（首尾一致） |
| 主仓产品 diff | 空（planner 复查 `git diff -- index.ts orchestrate.ts orchestrate.test.mjs` 为 0 行） |
| `session-ISO-E2` | 未被本次运行重写（执行者报告 + runs/ 目录核对） |
| 删除 assert | 无（worktree diff 纯插入，`2 insertions(+)`） |
| `orchestrate.test.mjs` | PASS（planner 在 worktree 经 `slot cpu` 重跑：`planner-only orchestration: PASS`，fail 0；日志 `p20-r094-planner-verify-test.log`） |
| slot 前置 | `p20-r094-planner-verify-slot-audit.log` / `-slot-status.log`（无绕过 slot 的重进程） |

## 拆开（type=message）

| 桶 | USD | 回合 |
|---|---|---|
| 根 luna assistant | `0.017618` | 10 |
| 根 toolResult（worker 镜像） | `0` | — |
| run-0 qwen worker | `0`（宿主 usage 费用 0） | 19 |
| spend.py（含双计） | `0.017618` | — |
| 去重一次生成 | `0.017618` | 根 10 / worker 19 |

根墙钟 846 s（`03:49:14.449Z`–`04:03:20.119Z`）；worker 781 s。

## 质量

- 两臂样本 diff **字节相同**（`iso-e2-*.diff` 与 `split-e2-*.diff` sha256 一致：
  `14d99580…` / `f092564e…`）。E2 与 E3 一样，role-split 也产出了与 isolation 相同的产品改动。
- `orchestrate.ts`：`renderTaskStatus` 在 `this.snapshots?.writeErrorFor(task.taskId)` 为真时追加
  `Ledger write: 本会话无法写入该 taskId 的账本（writeErrorFor）`（措辞逐字符合冻结）；
  无 `snapshots` 时不加；「余额不可信」原文未动。
- `orchestrate.test.mjs`：L15 后新增 L15b 断言匹配 `/本会话无法写入该 taskId 的账本/`；
  L10/L14b 未动；无既有断言删除。
- 回合不对齐（ISO 根 17 / worker 20 vs SPLIT 根 10 / worker 19）——E2 同 E3，
  适合作同任务同产品 diff 的费用/时延对照，不是逐步对齐的回合对照。

## 对照（E2，去重一次生成）

| 方案 | E2 |
|---|---|
| isolated-baseline | `0.073622` |
| role-split | `0.017618` |

比值 ≈ **0.24**（n=1 票，不外推）。根墙钟 228 s vs 846 s ≈ **3.7×**。

## 用户 $3 账

p18+p19 `0.131035` + p20 `runs/` `0.224218` = `0.355253`。剩余 `2.644747`。
驱动帽 `2.86` 未改，帽内剩余 `2.635782`。E1 未武装、勿自挑。
