# 阶段 A 验收重跑对照（issue 08，2026-09-07）

**目的：** 用 2026-09-07 探测的同一张票（oracle-status-line）、同一 Root prompt、同一 Kimi 模型配置，在隔离 worktree 上重跑 planner-only。插件加载的是主工作树里未提交的 01–07 实现，不是 github 安装副本 `9027d8f`。对照基线：`.scratch/kimi-timing-probe/run-2026-09-07.md`。

**结论先看：** 进程自然退出（`exit_code=0`，无人工 kill），票的代码交付在 worktree 提交 `9921446` 上完成且 lockfile 未漂移。**插件 Task 状态是 `blocked`，不是 PASS。** 因此 issue 08 验收未过，不进入阶段 B–E。Root 三次调用 `planner_verdict` 均为 pass 意图，均被 freshness 打成 `revalidate` / 最后 `blocked`。

**时区：** 会话 JSONL 时间戳为 UTC。北京时间 = UTC+8。下文时间戳一律写 UTC，必要时括号给 CST。

---

## 0. 对照验收（按 issue 08 checkbox，从产物核对，不采信 Root recap）

| checkbox | 判定 | 证据 |
|---|---|---|
| `planner_verdict` PASS，无人工 kill | **FAIL** | 无 kill，自然退出；`usage.jsonl` `state=blocked` `rounds=3`；第三次 verdict 结果 `state: blocked` / `decision: blocked` |
| Validator 至多一次；无「Async started」后无法等待 | **FAIL**（次数）/ **PASS**（可等待） | Oracle 两次（`4689ad28`、`b9def7fe`）。每次 Async started 都带 `runId`；`bg_wait` 有 id；会话中 **没有** `No active async runs` |
| ReviewResult 被记录；无 Reviewer 的 WorkerReport 解析错误 | **部分** | Reviewer `f40ab913` 完成，notify 是 reviewer 正文，**没有** `not a valid WorkerReport`。`planner_verdict` 回显 `review mode: root`。会话 custom 事件里未见结构化 ReviewResult 入账 |
| 无占位 Task；Worker taskId 与 canonical id | **FAIL**（占位）/ **PASS**（id） | Scout 无 TaskSpec → `Placeholder task T-20260907-001 created`。之后 Worker 报告 `taskId: T-20260907-001`，无 `taskId mismatch` |
| 结束时工作树干净，无 lockfile 漂移 | **PASS**（tracked） | porcelain 仅 `?? .agent-dir/` `?? .pi/` `?? .scratch/oracle-status-line/` `?? .scratch/phase-a-08-session/`。`package-lock.json` 无 diff。Worker 用了 `npm ci`（只读 lock），不是探测里的 `npm install` |
| 每次委派均在默认地板内 | **PASS** | 有界角色最高 14 assistant turns（地板 20）；Worker 最高 `$0.0517` / 31k in（地板 `$0.50` / 100k tokens）；Oracle 最高 `$0.025` / 10 turns |
| 对照文件记录四段墙钟与子进程费用 | 本文件 | 规划 ~182 s / 实现 ~100 s / Validator-1 ~51 s / Reviewer ~91 s；子进程 meta 合计 **$0.245**（usage.jsonl 只记了第一笔 scout `$0.036`） |
| 运行前 `slot audit` / `slot status` | **PASS** | `.scratch/planner-only-cost-control/phase-a-08-run/slot-preflight.txt`（agy PID 2922205 绕过 slot，未杀） |

---

## 1. 实验设计

### 1.1 隔离

| 项 | 值 |
|---|---|
| 主仓库（脏树，01–07 未提交） | `/home/tcuni-claw/pi/pi-planner-only` @ `kimi-timing-probe` HEAD `bc7bb4e`（运行期间未动） |
| 票 worktree | `/home/tcuni-claw/pi/pi-planner-only-phase-a-08` |
| 分支 | `phase-a-08-rerun`，起点 `9027d8f`，结束后 HEAD `9921446` |
| 插件 | `PI_CODING_AGENT_DIR=…/phase-a-08/.agent-dir`，`settings.json` packages 为 `npm:pi-subagents` + **本地路径** `/home/tcuni-claw/pi/pi-planner-only`。未改全局 `~/.pi/agent/settings.json`，未改 github 安装副本 |
| 会话 | worktree `.scratch/phase-a-08-session/` |
| 已知耦合 | 主树已含祖先 `1b103f6`（探测那次 +9 行 status）。本 worktree 从 `9027d8f` 再实现一遍，提交是 `9921446`（+12 行，测试多了一段 `PI_PLANNER_ONLY_ORACLE=full`） |

### 1.2 票

与探测相同：`.scratch/oracle-status-line/`（已拷进 worktree）。Root prompt 要求一张票、Worker → bounded oracle → reviewer → `planner_verdict`。

实际产物：`9921446 feat: print oracle suite mode on /planner-only status`，`index.ts` +2、`index.test.mjs` +10。`index.ts` 新增 `lines.push` 相对周围少一档缩进（Reviewer 记为 minor）。

### 1.3 启动命令

```bash
slot cpu -- bash /home/tcuni-claw/pi/pi-planner-only/.scratch/planner-only-cost-control/phase-a-08-run/run.sh
```

`run.sh` 在 worktree cwd 执行：

```bash
PI_PLANNER_ONLY=1 PI_PLANNER_ONLY_REQUIRE_CONTRACT=0 \
PI_CODING_AGENT_DIR=/home/tcuni-claw/pi/pi-planner-only-phase-a-08/.agent-dir \
pi -p --approve --name phase-a-08-rerun \
  --model kimi-coding/k3-256k --thinking high \
  --session-dir "$WT/.scratch/phase-a-08-session" \
  @.scratch/oracle-status-line/root-prompt.md
```

| 项 | 值 |
|---|---|
| 开始 | `2026-09-07T13:36:28+08:00`（UTC `05:36:28.603Z`） |
| 结束 | `2026-09-07T13:48:26+08:00`（UTC `05:48:26.425Z`） |
| 墙钟 | **718 s（约 12.0 min）** |
| `exit_code` | **0**（自然退出） |

### 1.4 模型配置（shadow settings vs meta）

来源：worktree `.agent-dir/settings.json`（拷贝在 `artifacts/agent-dir-settings.json`）。

| 角色 | settings | 本次 meta 实际模型 |
|---|---|---|
| Root | kimi-coding / k3-256k / thinking high；CLI 再指定 | `kimi-coding/k3-256k` |
| Worker | kimi-for-coding + **high** | 三次均为 `kimi-for-coding:high` |
| Oracle | kimi-for-coding + **medium** | 两次均为 `:medium` |
| Reviewer | kimi-for-coding + **high** | `:high` |
| Scout（Root 自选，不在探测路径里） | 无 override | 两次 `:low` |

与探测不同：探测里 Worker/Oracle 多为 `:off`，本次 overrides **打到了子进程**。

Issue 07 警告在 `session_start` 出现（文案含模型与 `…/.agent-dir/planner-only/pricing.json`）。k3 仍无费率，`costUnknown: true`。

---

## 2. 原始产物路径

| 种类 | 路径 |
|---|---|
| 本对照 | `.scratch/planner-only-cost-control/phase-a-08-run/comparison.md` |
| 启动脚本 / 日志 | `phase-a-08-run/run.sh`、`pi-stdout.log`、`start.txt`、`end.txt`、`exit.txt` |
| slot | `slot-preflight.txt`、`slot-postflight.txt` |
| Root 会话拷贝 | `phase-a-08-run/artifacts/root-session.jsonl` |
| 会话 id | `01a07a5e-31bb-724f-9c4c-fcace743b79c` |
| usage 拷贝 | `phase-a-08-run/artifacts/usage.jsonl` |
| 子代理 meta 拷贝 | `phase-a-08-run/artifacts/metas/` |
| worktree 全量（含 transcript） | `/home/tcuni-claw/pi/pi-planner-only-phase-a-08/.scratch/phase-a-08-session/` |
| 探测基线 | `.scratch/kimi-timing-probe/run-2026-09-07.md` |

---

## 3. 完整时间线

```
05:36:28  启动；会话创建；k3-256k；issue 07 无费率警告
05:36:31  Root 读 prompt（要求 Worker → bounded oracle → reviewer → planner_verdict）
05:36:49  subagent list
05:36:56  委派 scout（context=fresh，无 TaskSpec）
          插件：Placeholder task T-20260907-001；Async started runId=64a12941…（可等待）
05:36:57–05:38:18  Scout-1
05:38:25  插件把 scout 输出当 WorkerReport → 解析失败；要求 report-only 修正
05:38:43–05:39:00  Scout-2（revived / 补报告）
05:39:03  委派 Worker 实现（context=fork；仍无嵌入 TaskSpec）
05:39:31–05:41:11  Worker-1 实现 + npm ci + commit 9921446
05:41:47  委派 Oracle-1 context=fresh → Async started 4689ad28… PLACEHOLDER 再出现
05:41:51–05:42:42  Oracle-1 bounded PASS
05:42:58  委派 Reviewer context=fresh；Async started f40ab913…（此次文案无 Placeholder）
05:42:59–05:44:30  Reviewer PASS（2 minor）
05:44:44  Root planner_verdict pass → 插件 round 2/3 changes_requested / stale
          HEAD 9027d8f → 9921446；under-reported index.ts/index.test.mjs
          workspace snapshot 因 untracked 运行时目录变化
05:45:05–05:45:18  Worker-2 report-only（绑定 T-20260907-001 + 9921446）
05:45:46  委派 Oracle-2
05:45:47–05:46:30  Oracle-2 bounded PASS
05:46:40  Root planner_verdict pass → round 3/3 仍 stale（base 仍 9027d8f）
05:47:22–05:47:49  Worker-3 report-only
05:48:03  Root 第三次 planner_verdict → state=blocked（max 3 review rounds）
          evidence: workspace snapshot 在报告后再次变化（base 已是 9921446）
05:48:26  Root 打印 recap；pi 退出 0
```

**没有发生：** 纠偏死循环、人工 SIGTERM、lockfile 漂移、`No active async runs`、Worker `taskId mismatch`。

**发生了、验收不允许的：** 占位 Task、两次 Validator、三次 review round 后 `blocked`。

---

## 4. 各次委派明细

墙钟用各 transcript 首末 `timestamp`。费用用 meta `usage.cost`（Kimi 宿主字段）。

### 4.1 Scout-1 — 规划侦察（探测路径里没有）

| 项 | 值 |
|---|---|
| runId | `64a12941-8c79-4e54-a2ff-2b020d1bebc7` |
| 模型 | `kimi-coding/kimi-for-coding:low` |
| 墙钟 | 05:36:57 → 05:38:18（**81 s**） |
| 轮次 | 8 |
| 费用 | **$0.0362** |
| 插件 | 无 TaskSpec → 占位 `T-20260907-001`；输出不是 WorkerReport |

### 4.2 Scout-2 — 报告修正

| 项 | 值 |
|---|---|
| runId | `6ebf4f7c-927f-46af-a3ea-3ec72a1c9eef` |
| 模型 | `:low` |
| 墙钟 | 05:38:43 → 05:39:00（**17 s**） |
| 轮次 | 2 |
| 费用 | **$0.0091** |
| 行为 | 把 scout 结论收成 `taskId: T-20260907-001` 的 JSON；无代码改动 |

### 4.3 Worker-1 — 实现

| 项 | 值 |
|---|---|
| runId | `6b3f6f86-3f62-422b-82a6-d3721c906734` |
| 模型 | `:high`（探测为 `:off`） |
| 墙钟 | 05:39:31 → 05:41:11（**100 s**；探测 Worker-1 是 135 s） |
| 轮次 | 14 |
| 用量 | in 9 508 / out 3 520 / cacheRead 101 632 |
| 费用 | **$0.0424** |
| 提交 | `9921446`，仅 `index.ts` + `index.test.mjs` |
| 安装 | **`npm ci`**（meta：`lockfile-readonly`；lock 未改）。探测是 `npm install` 弄脏 lockfile |
| 插件 | 仍打印 Placeholder（委派未嵌 TaskSpec）。报告 taskId 用 canonical `T-20260907-001` |

### 4.4 Oracle-1

| 项 | 值 |
|---|---|
| runId | `4689ad28-b30f-47e2-b9a3-386d9554f540` |
| 模型 | `:medium` |
| 墙钟 | 05:41:51 → 05:42:42（**51 s**） |
| 轮次 | 10 |
| 费用 | **$0.0251** |
| 结论 | bounded PASS。父进程经 Async started + wait 收到结果 |

### 4.5 Reviewer

| 项 | 值 |
|---|---|
| runId | `f40ab913-3ca8-43f6-9fdb-4a16229fb0d6` |
| 模型 | `:high` |
| 墙钟 | 05:42:59 → 05:44:30（**91 s**；探测 74 s） |
| 轮次 | 5 |
| 用量 | in 27 026 / out 3 190 / cacheRead 48 384 |
| 费用 | **$0.0476** |
| 裁决 | PASS，2 minor（缩进；测试应用 try/finally） |
| 插件 | 无 WorkerReport 解析错误。后续 `planner_verdict` 仍走 `review mode: root` |

### 4.6 Worker-2 — report-only

| 项 | 值 |
|---|---|
| runId | `27724bf3-381f-478d-883e-d348662d64ac` |
| 模型 | `:high` |
| 墙钟 | 05:45:05 → 05:45:18（**13 s**） |
| 轮次 | 2 |
| 费用 | **$0.0127** |
| 行为 | 不改文件；JSON `taskId: T-20260907-001` `status: completed` |

### 4.7 Oracle-2（第二次 Validator，验收不允许）

| 项 | 值 |
|---|---|
| runId | `b9def7fe-b092-4a2f-96f4-8cce6217d56b` |
| 模型 | `:medium` |
| 墙钟 | 05:45:47 → 05:46:30（**43 s**） |
| 轮次 | 8 |
| 费用 | **$0.0203** |
| 原因 | 第一次 `planner_verdict` 被拒后 Root 再验证 |

### 4.8 Worker-3 — 第三次 report-only

| 项 | 值 |
|---|---|
| runId | `b3a1c1e0-9f70-48c1-972a-fab70479c6ee` |
| 模型 | `:high` |
| 墙钟 | 05:47:22 → 05:47:49（**27 s**） |
| 轮次 | 5 |
| 费用 | **$0.0517** |
| 之后 | 第三次 verdict → `blocked` |

---

## 5. Token 与费用

### 5.1 子代理（meta `usage.cost`）

| 角色 | 次数 | turns | USD |
|---|---|---|---|
| Scout | 2 | 10 | 0.0453 |
| Worker | 3 | 21 | 0.1069 |
| Oracle | 2 | 18 | 0.0453 |
| Reviewer | 1 | 5 | 0.0476 |
| **合计** | **8** | **54** | **0.2451** |

usage.jsonl 落盘时 `children` **只有 Scout-1 一笔**（`$0.0362`），`total $0.0362 excluding Root`。以 meta 为准时孩子费用约 **$0.245**。账本漏记其余 7 个孩子，记为一档记录缺陷，不是「孩子只花了 3.6 分」。

### 5.2 Root（k3-256k）

usage.jsonl：25 turns；in 68 965 / out 8 508 / cacheRead 710 144 / reasoning 3 000；`costUnknown: true`。`byPhase` 几乎全在 `reviewing`（23 turns），`planning` 为 0（scout 被记成 worker kind）。

### 5.3 与探测 §8 反事实干净路径

| 段 | 探测反事实 | 本次实测（到第一次 Reviewer 结束） | 含纠偏到 blocked |
|---|---|---|---|
| 规划 | ~40 s | ~182 s（含两次 scout） | 同左 |
| 实现 | ~135 s | **100 s** | 同左 |
| Validator | ~30–50 s | Oracle-1 **51 s** | + Oracle-2 43 s |
| Reviewer | ~74 s | **91 s** | 同左 |
| 合计墙钟 | ~5 min | 到 Reviewer 结束 **~8.0 min** | **12.0 min** 后自然退出 |
| 孩子 $ | ~0.19 | 到 Reviewer：0.036+0.009+0.042+0.025+0.048 ≈ **0.160** | **0.245** |
| 结束 | PASS（假设） | — | **blocked** |

偏离解释：规划被 scout 占位任务拉长；实现更快且 thinking high 生效；Reviewer 略长；失败成本在 freshness/`blocked`，不在 210 轮死循环。探测死循环 Worker-3 约 $0.98 / 15 min，本次没有。

---

## 6. 失败机制（为何代码对了仍 blocked）

两层 freshness，会话里都出现了：

1. **占位 Task 的 base 钉在 `9027d8f`。** Scout 无 TaskSpec 创建 `T-20260907-001`。Worker 随后在同一 canonical id 上提交 `9921446`。两次 `planner_verdict` 都报 `HEAD changed (9027d8f → 9921446)` 且 `under-reported: index.ts, index.test.mjs`。规格允许「完全没有 TaskSpec 特征」时占位，但 08 要求验收跑无占位；Root 先 scout 等于把票 id 绑到空任务上。

2. **workspace snapshot 含运行时 untracked 目录。** `.scratch/phase-a-08-session/`、`.agent-dir/`、`.pi/` 每次委派都会写。第三次 blocked 文案：`workspace snapshot changed since the report (ec7d2d6a… → 397e1f5a…)`，此时 base 已是 `9921446`，tracked 树已干净。这会让「报告后快照必变」成为稳态，吃光 3 个 review round。

探测的五类问题对照：

| 探测问题 | 本次 |
|---|---|
| 1 回执 / async 无法等待 | 未再现（有 runId，能等到结果） |
| 2 异步 Reviewer + WorkerReport 误解析 | Reviewer 未误解析为 WorkerReport |
| 3 TaskSpec 静默占位 | **再现**（scout / 未嵌 spec 的 Worker、Oracle） |
| 4 Worker/Validator 默认 fresh | 本次 Worker-1 实际 `context=fork`；Oracle/Reviewer 为 `fresh` |
| 5 纠偏死循环超地板 | **未再现**（最高 14 轮） |
| lockfile / npm install | **未再现**（`npm ci`） |
| thinking override 未打到子进程 | **未再现** |
| k3 无费率无警告 | **未再现**（07 警告出现） |

---

## 7. 和探测总表对照

| | 探测 2026-09-07 | 本次 issue 08 |
|---|---|---|
| 墙钟 | 10.4 min 到首次 review；25.2 min 被杀 | 8.0 min 到首次 Reviewer；**12.0 min 自然退出** |
| 结束 | 未结束 / SIGTERM | `exit 0` / **blocked** |
| 实现 Worker | 33 轮 / 135 s / $0.15 / `:off` / `npm install` | 14 轮 / 100 s / $0.042 / `:high` / `npm ci` |
| Oracle | 4 次，3 次父进程没接到 | 2 次，都接到；仍多于「至多一次」 |
| Reviewer | 3 轮 / 74 s / $0.018；结果被当 WorkerReport | 5 轮 / 91 s / $0.048；未当 WorkerReport |
| 纠偏 | 210 轮 / ~$0.98 死循环 | 2 次 report-only + 1 次额外 Oracle 后 blocked |
| 孩子 $ | ~0.24 完成孩子 + ~0.98 死循环 | **~0.245 全部孩子** |

---

## 8. 建议的阶段 A 后续（未开票，未进入 B–E）

08 未 PASS，规格禁止进入 B–E。若要再跑 08，需要先修编排，而不是再烧一笔同样的钱：

1. **freshness 快照不要把运行时 untracked 目录算进去**（session、agent-dir、`.pi/`），否则 PASS 在隔离重跑里不可达。
2. **Explorer/scout 无 TaskSpec 的占位不要占用即将到来的票 canonical id**；或 Root 合同禁止在第一张票的 Worker 之前用会创建 Task 的 scout。
3. **usage.jsonl 在 blocked 结束时应写下全部孩子**，不要只留第一笔 scout。
4. Worker-1 用了 `context=fork`。若 04 的默认 fresh 只在「未传 context」时生效，Root 显式 fork 会绕过；对照 08 时要决定这是否算违约。

未改 spec，未勾 08 checkbox，未改 Status。
