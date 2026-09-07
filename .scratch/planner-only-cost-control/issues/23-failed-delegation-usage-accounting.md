# 23: 失败的子委派与 unbound scout 必须入 usage 账，不得静默丢弃

**What to build:** 委派失败的子代理消耗了真实 token 与费用，但现在完全不进 `usage.jsonl`。`usage.jsonl` 的 children 去重与写入逻辑要覆盖失败/被拒的子委派：只要有 `<runId>_<agent>[_0]_meta.json` 就按 meta 入账，并带一个能区分成功与失败的字段；连 meta 都没有（子进程根本没起来）时不伪造 0 成本条目，而是计入 `costUnknown` 或等价的未知项。成功委派的既有字段与去重规则不变。

同一规则覆盖 unbound-explorer 路径（含 `scout`）：`delegation.kind` 为 explorer 不等于不入账，只要落了 `<runId>_<agent>[_0]_meta.json` 就按 meta 入账。工单 21 的既有行为（不建 Task、不调 `nextTaskId()`、输出原样返回）一律不动，本票只改账本。

**Blocked by:** None (can start immediately). Sequential with 21：不要与 21 同一轮抢改 `orchestrate.ts` / `roles.ts`；本票的验收全部走 fixture，不依赖 21 先落地。

**Status:** ready-for-agent

- [ ] 一次 `isError: true` / Mission failed 的子委派，其 meta 文件中的用量出现在 `usage.jsonl` 的 children 里，条目的 `runId` 与 meta 文件名中的 runId 一致。
- [ ] 该条 child 带一个可区分成功与失败的字段；成功委派条目的既有字段一个不变。
- [ ] 子进程根本没启动、没有 meta 文件时，不写入 0 成本条目；该次委派计入 `costUnknown` 或等价的未知项，不静默丢弃。
- [ ] 一次无 TaskSpec 的 `scout`（unbound explorer）委派，其 meta 中的用量出现在 children 里；工单 21 的既有验收（不建 Task、`delegation.kind` 为 explorer、原样返回）全部仍然成立。
- [ ] children 仍按 `runId` 去重，同一 runId 不重复入账；同一 scout 的内层 run 目录（r4 的 `session-tree/6614fce2-…`）不被当作第二个子代理重复计数。
- [ ] 回归以 fixture 形式进单测，用 r4 的六个 meta 文件名与 `usage.jsonl` 的差集构造（差集恰为 `73bd7b92` 与 `eb50ca15` 两条），补记后 children 合计从 $0.15155643 变为 $0.24052828、含 root 的总额等于 $0.29581593，不需要重跑真实模型。
- [ ] 不勾 08/13 checkbox、不改 08/13 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 28–30，阶段 D 决策）。

证据：2026-09-07 phase-a-08-rerun-4。`/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r4/.scratch/phase-a-08-session/subagent-artifacts/73bd7b92-06a4-4c17-a5c8-e9936494f47f_worker_0_meta.json` 存在，会话中该次委派回执为 `Mission: 03d86289-86ca-4d43-bf3c-7d6a5800f618 (failed)` / `isError: true`；而 worktree 的 `.agent-dir/planner-only/usage.jsonl` 四条记录里，children 只有 `4e032aed`、`c22defe6`、`f1d2b014`、`2d9ca9b6` —— **`73bd7b92` 完全没入账**。

工单 13 的第一条 checkbox 是「全部用量记入同一账本」，直接压在本票上。13 的 Blocked by 已于 2026-09-08 改成「05、08、23」。

scout（unbound explorer）入账**在**本票范围（2026-09-08 用户拍板）：r4 的 `eb50ca15-…_scout_meta.json` 同样不在 `usage.jsonl` 里。不建 Task 是工单 21 的设计，不入账不是 —— 两者互不牵连，21 的路径行为本票一个字不动。scout 那笔的用量有两个来源可取：meta 文件，以及 `bg_wait` 回执的 `details.completions[0].results[0].usage`。

2026-09-08 补量（产物快照 `.scratch/planner-only-cost-control/phase-a-08-run4/artifacts/`，README 有全表）：r4 的 6 个 meta 都带 `usage.cost`，但 `usage.jsonl` 最后一条的 children 只有 4 个。漏的两条是 `73bd7b92`（失败 worker，**$0.06495503**、10 turns）与 `eb50ca15`（scout，**$0.02401682**、5 turns）。账本记 root $0.05528765 + children $0.15155643 = **$0.20684408**；实际 **$0.29581593**；**少记 $0.08897185，占实际支出的 30.1%**。scout 那 $0.024 在 `bg_wait` 回执的 `details.completions[0].results[0].usage` 里也有一份，不只在 meta 里。

round_id=claude-pD-2026-09-07-open-22-23
round_id=claude-pD-2026-09-08-scope-23-scout
