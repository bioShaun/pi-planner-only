# ISO-E2 验收（planner 重算，2026-09-09）

不采信执行者口头数字。下列由 planner 对 `p20-scale/runs/session-ISO-E2` 与 worktree 重跑。

## 闸门

| 项 | 值 |
|---|---|
| spend.py `--require session-ISO-E2` | `0.125587` |
| spend.py `p20-scale/runs` | `0.206600` |
| 驱动 exit | 0 |
| worktree HEAD | `45d9493e25f47c58911edc01757c6133caeaa39d` |
| 主仓产品 diff | 空 |
| `session-SPLIT-E2` | 不存在 |
| 删除 assert | 无（`git diff | grep '^-.*assert'` 空） |
| `orchestrate.test.mjs` | PASS（planner 在 worktree 重跑） |

## 拆开（type=message）

| 桶 | USD | 回合 |
|---|---|---|
| 根 luna assistant | `0.021657` | 17 |
| 根 toolResult（worker 镜像） | `0.051965` | — |
| run-0 luna worker | `0.051965` | 20 |
| spend.py（含双计） | `0.125587` | — |
| 去重一次生成 | `0.073622` | 根 17 / worker 20 |

根墙钟 228 s（`03:35:54.035Z`–`03:39:41.808Z`）；worker 151 s。去重后 worker 占 `0.051965 / 0.073622` ≈ 70.6%。

## 质量

`renderTaskStatus` 在 `this.snapshots?.writeErrorFor(task.taskId)` 存在时追加 `Ledger write: 本会话无法写入该 taskId 的账本（writeErrorFor）`，`余额不可信` 文案未改。新测试在 L15 损坏字节 persist 后断言匹配该文案（L15b）。快照：`iso-e2-orchestrate.ts.diff`、`iso-e2-orchestrate.test.mjs.diff`。

## 用户 $3 账

p18+p19 `0.131035` + p20 `0.206600` = `0.337635`。剩余 `2.662365`。驱动帽 `2.86` 未改。
