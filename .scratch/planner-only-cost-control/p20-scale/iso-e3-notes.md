# ISO-E3 验收（planner 重算，2026-09-09）

不采信执行者口头数字。下列由 planner 对 `p20-scale/runs/session-ISO-E3` 与 worktree 重跑。

## 闸门

| 项 | 值 |
|---|---|
| spend.py `--require session-ISO-E3` | `0.058959` |
| spend.py `p20-scale/runs` | `0.058959` |
| 驱动 exit | 0 |
| worktree HEAD | `45d9493e25f47c58911edc01757c6133caeaa39d` |
| 主仓产品 diff | 空 |
| `session-SPLIT-E3` | 不存在 |
| 删除 assert | 无（`git diff \| grep '^-.*assert'` 空） |
| `orchestrate.test.mjs` | PASS（planner 在 worktree 重跑） |

## 拆开（type=message）

| 桶 | USD | 回合 |
|---|---|---|
| 根 luna assistant | `0.009648` | 7 |
| 根 toolResult（worker 镜像） | `0.024655` | — |
| run-0 luna worker | `0.024655` | 13 |
| spend.py（含双计） | `0.058959` | — |
| 去重一次生成 | `0.034303` | 根 7 / worker 13 |

根墙钟 149 s（`02:59:19.954Z`–`03:01:48.975Z`）；worker 112 s。

## 质量

exhausted 路径在 `reservation.refused` 上按 untrusted 同样 `delete usageBudget` / `__floorLimits`，拒绝文案仍走 `cumulativeBudgetRefusal`。新测试插在 V9 与 V10 之间，V7 六行文案未改。快照：`iso-e3-orchestrate.ts.diff`、`iso-e3-orchestrate.test.mjs.diff`。

## 样本闸门（freeze）

「去重 < $0.05 **且** worker 回合 < 8 → 换 E2」。本臂去重 `0.034303` 仍低于 0.05，但 worker **13** 回合、费用占去重后约 72%。不换 E2，开 SPLIT-E3。

## 用户 $3

p18+p19 `0.131035` + p20 `0.058959` = `0.189994`。剩余 `2.810006`。驱动帽 `2.86` 未改。
