# phase-a-08-run4 产物快照

2026-09-08 补拷（运行本身是 2026-09-07 22:03:16 → 22:11:06）。补拷原因：r4 是新票 22 与 23 的唯一证据来源，而它当时只留了 run 目录、没留 artifacts 快照（r3 有）。原树仍在 `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r4`，本目录是它的只读副本，`cp -p` 保留 mtime。

## 来源对应

| 本目录 | 源 |
|---|---|
| `usage.jsonl` | `<worktree>/.agent-dir/planner-only/usage.jsonl` |
| `root-session.jsonl` | `<worktree>/.scratch/phase-a-08-session/2026-09-07T14-03-17-142Z_01a07c2e-….jsonl` |
| `subagent-artifacts/` | 同名目录整体 |
| `metas/` | 上面目录里 6 个 `*_meta.json` 的副本（与 r3 快照的布局对齐） |
| `session-tree/` | `…_01a07c2e-…/` 下每个 run 的 `run-0/session.jsonl`（r3 快照没有这一层；r4 保留，因为 23 的证据在里面） |

`agent-dir-settings.json` / `agent-dir-trust.json` / `artifacts-agent-dir-settings.json` 没有重复拷贝，它们在上一级 `phase-a-08-run4/` 目录里。

## 读之前必须知道的两件事

**1. `usage.jsonl` 第一条不是 r4 的。** r4 的 `.agent-dir/planner-only` 是从 r3 拷来的，所以第一条记录的 `cwd` 是 `…-phase-a-08-r3`、`sessionFile` 指向 r3 会话、`finishedAt` 是 `2026-09-07T07:08:44.501Z`。**看 r4 只看后三条**（`failed` rounds=1 → `blocked` rounds=2 → `completed` rounds=2）。

**2. `session-tree/6614fce2-…` 不是第七个子代理。** 它是 scout `eb50ca15` 的内层 run 目录 —— `bg_wait` 回执里 scout 的 `sessionFile` 就指向 `…/6614fce2-…/run-0/session.jsonl`，而它的产物文件命名用的是 `eb50ca15-…_scout_*`。同一个 scout 的两层 id，不要重复计数。

## 账本缺口（工单 23 的证据）

6 个 meta 都带 `usage.cost`，但 `usage.jsonl` 最后一条的 children 只有 4 个：

| runId | agent | meta 里的 cost | turns | 在 usage.jsonl? |
|---|---|---|---|---|
| `4e032aed` | worker | $0.10835171 | 18 | 是 |
| `c22defe6` | delegate | $0.00400235 | 1 | 是 |
| `f1d2b014` | worker | $0.03239280 | 8 | 是 |
| `2d9ca9b6` | delegate | $0.00680957 | 2 | 是 |
| **`73bd7b92`** | **worker（该次委派 `Mission … (failed)` / `isError: true`，meta 独有 `error` 字段）** | **$0.06495503** | **10** | **否** |
| **`eb50ca15`** | **scout（unbound explorer）** | **$0.02401682** | **5** | **否** |

- 账本记的：root $0.05528765 + children $0.15155643 = **$0.20684408**
- 实际发生的：**$0.29581593**
- **少记 $0.08897185，占实际支出的 30.1%。**

其中 `73bd7b92`（失败委派，$0.065）是工单 23 正文收的那一条。`eb50ca15`（scout，$0.024）在 23 的 Comments 里被明确划到范围外、保持现状 —— 但那条 scoping 是在还没量出 $0.024 之前写的，值不值得一起收，留给用户判断。scout 的费用在 `bg_wait` 回执的 `details.completions[0].results[0].usage` 里也有一份（`cost: 0.02401682, turns: 5`），不只在 meta 里。
