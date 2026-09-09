# ISO-E1R2 验收（planner 重算，2026-09-09）

r096 的 ISO-E1 无效（见 freeze 失败记录）后，r097 重跑。执行者报告的两个 spend 数已独立复现。

## 闸门

| 项 | 值 |
|---|---|
| spend.py `session-ISO-E1R2` | `0.278854`（planner 复跑一致） |
| spend.py `p20-scale/runs` | `0.737262`（planner 复跑一致） |
| 驱动 exit | 0（基线闸门通过：开跑前 worktree 干净，执行者贴了原样输出） |
| worktree HEAD | `45d9493e25f47c58911edc01757c6133caeaa39d`（首尾一致） |
| 主仓产品 diff | 空 |
| 删除 assert | 无（diff 纯插入） |
| `orchestrate.test.mjs` | PASS（planner 经 slot 重跑，fail 0；日志 `p20-r097-planner-verify-test.log`） |
| slot 前置 | `p20-r097-planner-slot-audit.log`（无绕过 slot 的重进程） |

## 内容检查（r096 教训：形状 ≠ 内容）

- `orchestrate.ts`：`renderTaskStatus` 数组字面量之后 `if (this.snapshots?.isQuarantined(task.taskId))` 时
  push `Ledger quarantine: 本会话拒绝写入该 taskId 的账本（隔离在会话内不解除）`（措辞逐字）。
  **实现形状与 E2 样本的展开式不同**（push vs 条件展开）——两臂对比时照记质量差，不补跑。
- `orchestrate.test.mjs`：L14–L24 段之后新增独立块（`mkdtempSync(".planner-only-16b-l25-")`，
  `T-20260908-965`）：restoreFromLedger 报 quarantine（L25）→ 新 store 修复文件（L25a）→
  披露仍在（L25b）。既有断言未动。
- 无 E2 残留特征（`writeErrorFor` 状态行 / `本会话无法写入该 taskId 的账本` 均 grep 无匹配）。

## 拆开（type=message）

| 桶 | USD | 回合 |
|---|---|---|
| 根 luna assistant | `0.018088` | 8 |
| 根 toolResult（worker 镜像） | `0.130383` | — |
| run-0 luna worker | `0.130383` | 36 |
| spend.py（含双计） | `0.278854` | — |
| 去重一次生成 | `0.148471` | 根 8 / worker 36 |

根墙钟 413 s；worker 363 s。去重后 worker 占 **87.8%**——E1 的测试块比 E2/E3 大，worker 轮数明显多。

快照：`iso-e1-orchestrate.ts.diff`（sha `bf374a74…`）、`iso-e1-orchestrate.test.mjs.diff`（sha `b83c26b9…`）。

## 用户 $3 账

p18+p19 `0.131035` + p20 `runs/` `0.737262` = `0.868297`。剩余 `2.131703`。
驱动帽 `2.86` 内剩余 `2.122738`。SPLIT-E1 预计 ≈$0.02（qwen worker 免费）。
