# 阶段 A 验收第三次重跑（issue 08 r3，2026-09-07）

**目的：** 20/21 接受后，用同一张票、同一 Root prompt，在**新**隔离 worktree 上再跑 planner-only。用户 2026-09-07 明示：测试不要用 `kimi-coding/k3-256k`，Kimi 用 `kimi-coding/kimi-for-coding`。第一次失败树 `phase-a-08` @ `9921446`、r2 额度中止树均保留。

**结论先看：** 进程自然退出 `exit_code=0`（约 8.4 min，无 kill）。`usage.jsonl` **`state=completed` `rounds=0`**，canonical `T-20260907-001`，Root 模型 **`kimi-for-coding`**（会话中 **0** 次 `k3-256k`）。票提交 `794a8bc`（仅 `index.ts` + `index.test.mjs`），lockfile 无漂移。按 issue 08 checkbox 从产物核对，**均可判 PASS**（见 §0 的限定：Root 模型已按用户指示偏离原 08「同一模型配置」；Reviewer 委派了两次，第一次因缺 `reportRevision`/`workspaceDigest` 被拒）。**checkbox 与 Status 未勾未改；不进入 B–E，等用户确认是否把这次算作阶段 A 门槛。**

**时区：** 会话 JSONL 为 UTC。北京时间 = UTC+8。

---

## 0. 对照验收（按 issue 08 checkbox，从产物核对，不采信 Root recap）

| checkbox | 判定 | 证据 |
|---|---|---|
| `planner_verdict` PASS，无人工 kill | **PASS** | 无 kill；`usage.jsonl` `state=completed` `finishedAt=07:08:44.501Z`。Reviewer-2 入账后 notify `decision: accept` / `state: completed`。Root 随后调用 `planner_verdict` 被拒：`already completed`；details `verdict: pass` |
| Validator 至多一次；async 可等待 | **PASS** | Oracle **一次** `3c31766e-…`。四次 Async started 均带 `runId` 与 `bg_wait id=`；**0** 次 `No active async` |
| ReviewResult 被记录；无 WorkerReport 解析错误 | **PASS**（两次 Reviewer） | 会话 **0** 次 `not a valid WorkerReport`。Reviewer-1（`ed50b789`）JSON 缺身份字段，插件拒收；Reviewer-2（`8fd34e8c`）带 `reportRevision: 1` `workspaceDigest: 4f53cda18c2baa0c` `verdict: pass`，随后 Task completed |
| 无占位 Task；Worker taskId 与 canonical / 别名 | **PASS** | 会话 **0** 次 `Placeholder task`。Root 嵌了 TaskSpec `taskId: T-20241218-001`；插件 canonical **`T-20260907-001`**，别名文案 `Root-provided id is kept as alias`。Worker 报告体内仍写 `T-20241218-001`，被识别为别名 |
| 结束时工作树干净，无 lockfile 漂移 | **PASS**（tracked） | porcelain 仅 `?? .agent-dir/` `?? .scratch/oracle-status-line/` `?? .scratch/phase-a-08-session/`。`package-lock.json` 无 diff。Worker `npm ci`（lockfile-readonly） |
| 每次委派均在默认地板内 | **PASS** | 初始 Worker 无 toolBudget 地板；25 turns / `$0.085` / in 17 065（地板 `$0.50` / 100k tokens）。Oracle 6 turns / `$0.021`（有界 `$0.10` / 20 tools）。Reviewer 无默认地板。无纠偏 Worker |
| 对照文件记录四段墙钟与子进程费用 | 本文件 | 规划 ~67 s（无 scout）/ 实现 ~158 s / Validator ~65 s / Reviewer-1 ~38 s + Reviewer-2 ~54 s；子进程 meta **$0.168**；Root **$0.178** |
| 运行前 `slot audit` / `slot status` | **PASS** | `phase-a-08-run3/slot-preflight.txt`（pbbwa PID 903016 绕过 slot 41.5G，未杀） |

**相对原 08 合同的偏离（用户授权）：** Root 不是探测的 `k3-256k`，而是 `kimi-for-coding:high`。enabledModels 本跑只开了 `kimi-for-coding`。

---

## 1. 实验设计

| 项 | 值 |
|---|---|
| 主仓库（脏树 01–21 未提交） | `/home/tcuni-claw/pi/pi-planner-only` @ `kimi-timing-probe` HEAD `bc7bb4e` |
| 票 worktree | `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r3` |
| 分支 | `phase-a-08-rerun-3`，起点 `9027d8f`，结束 HEAD **`794a8bc`** |
| 插件 | `PI_CODING_AGENT_DIR=…/phase-a-08-r3/.agent-dir`；packages = `npm:pi-subagents` + 本地主树。未改全局 `~/.pi/agent/settings.json` |
| CLI | `pi -p --approve --name phase-a-08-rerun-3 --model kimi-coding/kimi-for-coding --thinking high` |
| 开始 | `2026-09-07T15:00:38+08:00`（UTC `07:00:38`） |
| 结束 | `2026-09-07T15:09:01+08:00`（UTC `07:09:01`） |
| 墙钟 | **503 s（约 8.4 min）** |
| `exit_code` | **0** |

---

## 2. 时间线

```
07:00:39  会话创建；Root kimi-for-coding（无 k3-256k 无费率警告）
07:00:45  Root 读票
07:01:23  subagent list
07:01:45  委派 Worker + TaskSpec（taskId T-20241218-001）
          插件：Async started task T-20260907-001 runId=2146530a-…（无 Placeholder）
07:01:45–07:04:23  Worker-1 实现 + npm ci + commit 794a8bc（~158 s）
07:05:24  委派 Oracle bounded；suite-conflict 警告（Root 文案像 full，模式 bounded）
07:05:24–07:06:29  Oracle-1 PASS（~65 s）
07:06:54  委派 Reviewer-1
07:06:54–07:07:32  Reviewer-1（~38 s）；插件拒收：缺 reportRevision / workspaceDigest
07:07:50  委派 Reviewer-2
07:07:50–07:08:44  Reviewer-2 PASS，带身份字段；orchestrator accept / completed
07:08:52  Root planner_verdict → refused already completed（details verdict=pass）
07:09:01  Root recap；pi 退出 0
```

**没有发生：** scout、占位 Task、第二次 Oracle、纠偏 Worker、`No active async`、`not a valid WorkerReport`、lockfile 漂移、人工 kill、k3-256k。

---

## 3. 各次委派

墙钟用会话时间戳。费用用 meta `usage.cost`。

### 3.1 Worker-1 — 实现

| 项 | 值 |
|---|---|
| runId | `2146530a-ca67-465f-bba3-14cf3eea9a7d` |
| 模型 | `kimi-coding/kimi-for-coding:high` |
| 墙钟 | 07:01:45 → 07:04:23（**158 s**） |
| 轮次 | 25 |
| 用量 | in 17 065 / out 4 825 / cacheRead 259 072 |
| 费用 | **$0.0847** |
| 提交 | `794a8bc` `status: print oracle suite mode (bounded\|full)`；`index.ts` +2、`index.test.mjs` +64 |
| 安装 | `npm ci` lockfile-readonly |
| 报告 taskId | `T-20241218-001`（别名）；canonical `T-20260907-001` |

### 3.2 Oracle-1

| 项 | 值 |
|---|---|
| runId | `3c31766e-b54e-4e85-a870-71417f98add8` |
| 模型 | `:medium` |
| 墙钟 | 07:05:24 → 07:06:29（**65 s**） |
| 轮次 | 6 |
| 费用 | **$0.0208** |
| 结论 | bounded PASS；HEAD 与 `794a8bc` 一致；只跑了报告里的 `index.test.mjs` |
| 插件 | `Oracle suite conflict` 警告（bounded 仍执行） |

### 3.3 Reviewer-1（被拒）

| 项 | 值 |
|---|---|
| runId | `ed50b789-ef8e-4a20-9edb-9cd8ce45e30b` |
| 模型 | `:high` |
| 墙钟 | 07:06:54 → 07:07:32（**38 s**） |
| 轮次 | 2 |
| 费用 | **$0.0127** |
| 插件 | `Reviewer verdict was rejected: ReviewResult is missing reportRevision`（以及 workspaceDigest） |

### 3.4 Reviewer-2

| 项 | 值 |
|---|---|
| runId | `8fd34e8c-4cdf-467c-ac20-30312aba8034` |
| 模型 | `:high` |
| 墙钟 | 07:07:50 → 07:08:44（**54 s**） |
| 轮次 | 3 |
| 费用 | **$0.0496** |
| 裁决 | `verdict: pass`，`reportRevision: 1`，`workspaceDigest: 4f53cda18c2baa0c`，findings 空 |

---

## 4. Token 与费用

### 4.1 子代理（meta / usage.jsonl children，一致）

| 角色 | 次数 | turns | USD |
|---|---|---|---|
| Worker | 1 | 25 | 0.0847 |
| Oracle | 1 | 6 | 0.0208 |
| Reviewer | 2 | 5 | 0.0623 |
| **合计** | **4** | **36** | **0.1678** |

usage.jsonl 记下了全部 4 个孩子（r1 blocked 时只记了第一笔 scout）。`costUnknown: false`。

### 4.2 Root

`kimi-for-coding`；19 turns；in 14 054 / out 4 015 / cacheRead 784 384；**$0.178**。`byPhase.planning` 仍为 0（几乎全在 reviewing 17 turns）。

### 4.3 与探测反事实 / r1 blocked

| 段 | 探测反事实 | r1（blocked） | **本次 r3** |
|---|---|---|---|
| 规划 | ~40 s | ~182 s（含 scout） | **~67 s**（无 scout） |
| 实现 | ~135 s | 100 s | **158 s** |
| Validator | ~30–50 s | 51 s + 二次 43 s | **65 s（一次）** |
| Reviewer | ~74 s | 91 s | 38+54 = **92 s**（两次） |
| 合计墙钟 | ~5 min | 12.0 min 后 blocked | **8.4 min 自然 PASS** |
| 孩子 $ | ~0.19 | 0.245 | **0.168** |
| Root 模型 | k3-256k | k3-256k | **kimi-for-coding**（用户授权） |
| 结束 | 被杀 | blocked | **completed** |

偏离解释：无 scout 故规划更短；Worker 25 轮（含 `npm ci`）比 r1 的 14 轮长；多一次 Reviewer 是身份字段契约，不是 WorkerReport 误解析；Root 换便宜模型后费用可计。

---

## 5. 探测五类问题对照

| 探测问题 | 本次 r3 |
|---|---|
| 1 回执 / async 无法等待 | 未再现（均有 runId，能等到） |
| 2 异步 Reviewer 当 WorkerReport | **未再现**；缺字段按 ReviewResult 拒收，二次补身份后入账 |
| 3 TaskSpec 静默占位 | **未再现**（有 spec；错误日期 id 收成别名） |
| 4 Worker/Validator 默认 fresh | 本跑未单独抽检 context 字段；未出现 fork 纠偏环 |
| 5 纠偏死循环超地板 | **未再现** |
| lockfile / npm install | **未再现**（`npm ci`） |
| thinking override | Worker `:high` / Oracle `:medium` / Reviewer `:high` 均打到 meta |
| k3 无费率警告 | 本跑 Root 不是 k3；无该警告 |

---

## 6. 产物路径

| 种类 | 路径 |
|---|---|
| 本对照 | `.scratch/planner-only-cost-control/phase-a-08-run3/comparison.md` |
| 启动 / 退出 | `phase-a-08-run3/run.sh`、`start.txt`、`end.txt`、`exit.txt`、`env.txt`、`pi-stdout.log` |
| slot | `slot-preflight.txt`、`slot-postflight.txt` |
| usage / 会话 | `phase-a-08-run3/artifacts/usage.jsonl`、`root-session.jsonl` |
| 子代理 | `phase-a-08-run3/artifacts/subagent-artifacts/`、`metas/` |
| worktree | `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r3` @ `794a8bc` |

---

## 7. 未做

未勾 08 checkbox，未改 Status，未 commit/push/PR 主仓库，未进入阶段 B–E。主仓库 HEAD 仍为 `bc7bb4e`。是否把「便宜 Root 模型 + 两次 Reviewer」算作阶段 A 门槛，等用户确认。
