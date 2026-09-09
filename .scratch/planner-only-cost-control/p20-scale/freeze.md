# 工单 19 扩规模冻结（p20，2026-09-09 cursor `w2E:pE`）

用户授权：用量硬限 **$1 → $3**；要更大规模对照，真实反映角色分工（luna root + qwen worker vs luna 双角色）的费用与质量，不是再跑 38/39 那种一行改动。

## 账

| 项 | USD |
|---|---|
| 用户硬限 | `3.00` |
| p18 契约 | `0.039576` |
| p19 `runs/`（38/39 四组 + SMOKE） | `0.091459` |
| 已花合计 | `0.131035` |
| 剩余 | `2.868965` |

本驱动 **新对账根** `p20-scale/runs/`，不把 p19 的 `session-*` 链进来。
`CAP_USD=2.86` 写死（剩余向下取到分），环境里已定义 `CAP_USD` 则 `exit 1` 且不起 `pi`。planner 另用 `0.131035 + 本 RUN` 看守用户 `$3`。

## 样本（点名，串行）

38/39 太小：isolation worker 只占去重后的一半或更少，两边 diff 字节相同，看不出质量差。p20 用 F6 **E 档第三条**（产品行为，不是卫生注释）：

**E3**：`beginDelegationInner` 里 untrusted 拒启会 `delete input.usageBudget` 与 `__floorLimits`；`reservation.refused`（cumulative budget exhausted）那条不会。两边都不起子进程。改 exhausted 路径，使这两条拒绝留下同样的 hook 输入（删掉 `usageBudget` 与 `__floorLimits`）。不改拒绝文案。补一条 `orchestrate.test.mjs` 断言：带着 `usageBudget` 的 worker 因 exhausted 被拒后，`input.usageBudget` 不存在。

| 组 | arm | 何时开 |
|---|---|---|
| `ISO-E3` | isolated-baseline（luna worker） | **先只开这一组** |
| `SPLIT-E3` | role-split（qwen-local worker） | 看完 ISO-E3 账单与样本再开 |
| E2 / E1 | 见文末 | E3 完成后用户「继续」才开 E2；E1 仍勿自挑 |

默认 argv 空则 `exit 2`。

## 两 arm 配置

与 p19 freeze §2 相同：两边都开 Root policy、`ROLE_MODELS=1`、thinking low、真实 `pricing.json`。唯一差别是 `PI_PLANNER_ONLY_MODEL_WORKER`。CLI `--model` = `tcuni/gpt-5.6-luna`。Worktree 仍是 `/home/tcuni-claw/pi/pi-planner-only-p19-experiment`，HEAD 保持 `45d9493`（先 restore 掉 38 的注释样本）。

## 质量口径（比 p19 严）

除 spend.py 外，planner 验收：

1. exhausted 拒绝文案仍匹配既有 `/cumulative budget exhausted/` 测试。
2. 新断言存在且 `git diff` 不含对无关 `assert` 的删除。
3. 两臂样本 diff 是否字节相同（允许不同；不相同要记质量差，不补跑凑绿）。
4. 若 ISO-E3 去重费用仍 < `$0.05` 且 worker 回合 < 8，样本仍偏小，下一组改 E2 而不是再加一行注释。

## 停

撞帽、质量分叉、或用户 `$3` 用尽：停，不抬帽。不加未点名票。不 push。

## E2（用户 2026-09-09「继续」授权）

E3 对照已完成。账：p18+p19 `0.131035` + p20 `runs/` `0.081013` = `0.212048`；用户剩余约 `2.79`。帽仍写死 `2.86`，对账根仍是 `p20-scale/runs/`（含 E3 与误触 ABORT）。

**E2**（F6 E 档第二条）：`LedgerSnapshotStore.writeErrorFor()` 至今只有测试读。隔离导致写不进去时，用户只能从 status 的「余额不可信」间接看出来。

改 `orchestrate.ts` 的 `renderTaskStatus`：若 `this.snapshots?.writeErrorFor(task.taskId)` 为真，追加这一行（措辞逐字）：

`Ledger write: 本会话无法写入该 taskId 的账本（writeErrorFor）`

不改「余额不可信」原文。不删 `writeErrorFor` / `lastWriteError`。无 `snapshots` 时不加这行。不要做 E1（会话内不解除隔离）。

在 `orchestrate.test.mjs` 既有 L15（placeholder persist 之后、文件仍是损坏字节）后面加一条：再次 `renderTaskStatus`，匹配 `/本会话无法写入该 taskId 的账本/`。不要改 L10/L14b（persist 之前 writeErrorFor 还没被 write() 写入）。不要删既有 assert。

| 组 | arm | 何时开 |
|---|---|---|
| `ISO-E2` | isolated-baseline | **先只开这一组** |
| `SPLIT-E2` | role-split | 看完 ISO-E2 账单与样本再开 |
| E1 | 未武装 | 勿自挑 |

**E2 对照已完成（2026-09-09）**：ISO-E2 去重 `0.073622` / SPLIT-E2 `0.017618`，两臂快照字节相同，验收备忘 `iso-e2-notes.md` / `split-e2-notes.md`。p20 `runs/` 合计 `0.224218`；用户 `$3` 剩 `2.644747`。驱动已重新解除武装（argv 空与点名均 `exit 2`）。E1 仍未武装、勿自挑。

## E1（用户 2026-09-09 授权，接在 E2/E3 收口之后）

E2/E3 对照已收口入库。E1 是 F6 E 档第一条：**隔离在会话内不解除，status 无提示**。

**E1**：`LedgerSnapshotStore` 在会话启动的 `restoreFromLedger()` 里把损坏的 taskId 放进内存隔离名单
（`ledger-store.ts` 的 `quarantined`），会话内永不解除——中途把文件修好也没用。改 `orchestrate.ts`
的 `renderTaskStatus`：若 `this.snapshots?.isQuarantined(task.taskId)` 为真，追加这一行（措辞逐字）：

`Ledger quarantine: 本会话拒绝写入该 taskId 的账本（隔离在会话内不解除）`

不改「余额不可信」原文；**不加** E2 的 `writeErrorFor` 行；**不**在会话内解除隔离；
无 `snapshots` 时不加这行。

测试：在 `orchestrate.test.mjs` L14–L24 块结束后**新增一个独立 `{...}` 段**（自己的
`mkdtempSync` `.planner-only-16b-l25-`）：写坏 `T-20260908-965` 快照 → `restoreFromLedger()` →
**会话中途**用新 `LedgerSnapshotStore` 把快照修好 → 断言
`renderTaskStatus` 匹配 `/本会话拒绝写入该 taskId 的账本/`（L25：文件确实修好；L25b：披露仍在）。
L14–L24 既有断言一个不动；不许删既有 assert。

| 组 | arm | 何时开 |
|---|---|---|
| `ISO-E1` | isolated-baseline（luna worker） | 用户已授权（2026-09-09）；**先只开这一组** |
| `SPLIT-E1` | role-split（qwen-local worker） | 看完 ISO-E1 账单与样本再开 |

质量口径沿用 E2/E3：两臂快照字节相同与否照记不补跑；planner 在 worktree 重跑
`orchestrate.test.mjs`；验收后存 `iso-e1-*.diff` / `split-e1-*.diff` 快照与 notes，更新 `summary.md`。
花费计入 `p20-scale/runs/`，帽仍 `2.86`；用户 `$3` 剩 `2.410557`（r097 派发时点）。
两臂样本做完即解除武装。

## E1 第一轮失败记录（r096，2026-09-09）

**ISO-E1（r096）无效**：`session-ISO-E1` 花费 `0.157509`，但 worktree 终态字节等于 SPLIT-E2 残留样本
（`isQuarantined` 计数 0）——**执行者报告的「restore before execution」与证据矛盾**
（worker 在自己 edit 之前读到的 orchestrate.ts 已含 E2 行；root 全程无 bash/edit）。
内层 root 在 worker 未回有效 WorkerReport 后试图伪造 completed 报告（工单 33 场景实战），
被扩展的 role-model mismatch 闸门拒绝，最终 verdict=blocked。钱计入用户账，不计入对照。

**驱动加固（G4：把判断变成脚本行为）**：`run.sh` 的 `run_group()` 新增 worktree 基线闸门——
`orchestrate.ts` / `orchestrate.test.mjs` 有 tracked diff 即 `exit 1`，不自动 restore。
重跑组名 `ISO-E1R2`（`ISO-E1` 组名停用防撞残留 session）。

**planner 自己的事故（如实记）**：验证闸门时直接探了武装组名 `ISO-E1R2`，把一次真实付费运行
当探针跑了两分钟才杀掉；`session-ABORT-ISO-E1R2` 花费 `0.076681`，留盘不入对照。
教训：**探针只能打被拒组名**；任何组名调用前先问「如果它真被武装，会发生什么」。

## E1 收口（2026-09-09，r097/r098）

- **ISO-E1R2（r097）通过**：去重 `0.148471`（根 8 / worker 36 回合，worker 占 87.8%），快照 `iso-e1-*.diff`，验收备忘 `iso-e1r2-notes.md`。
- **SPLIT-E1（r098）通过**：去重 `0.009859`（根 6 / worker 29 回合），快照 `split-e1-*.diff`，执行者首次完整贴出 restore 前后原样输出。
- **E1 两臂字节不同**（插入位置与测试块结构不同），行为等价，照记质量差；E1 比值 ≈ **0.07**，p20 三票合计 ≈ **0.18**。
- p20 `runs/` 合计 `0.747121`；用户 `$3` 剩 `2.121844`。**驱动已解除武装**（argv 空与点名均 `exit 2`）。
- E1 的产品修复**只在 worktree 快照**，是否落地主仓由用户拍板（E2/E3 已由 r095 落地为 `8b22568`）。
