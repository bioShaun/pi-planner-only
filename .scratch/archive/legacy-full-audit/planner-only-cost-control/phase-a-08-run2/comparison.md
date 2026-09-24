# 阶段 A 验收第二次重跑（issue 08 r2，2026-09-07）— 额度中止

**目的：** 20/21 接受后，用同一张票、同一 Root prompt、同一 Kimi 模型配置，在**新**隔离 worktree 上再跑一次 planner-only。第一次失败树 `/home/tcuni-claw/pi/pi-planner-only-phase-a-08` @ `9921446` 保留不动。

**结论先看：** **不是一次 08 验收跑。** 进程 `exit_code=1`（约 2.5 min）。Root `kimi-coding/k3-256k` 在 scout 返回之后、Worker 派出之前收到 Kimi `403 permission_error`：5-hour usage limit。无 `planner_verdict`，无 Worker/Oracle/Reviewer。不进入 B–E。checkbox 与 Status 未动。

Scout 这一段已经打到脏树插件（含 21）：`agent=scout` 走 unbound-explorer，**没有**占位 `T-20260907-001`。

**时区：** 会话 JSONL 为 UTC。北京时间 = UTC+8。

---

## 0. 对照验收（按 issue 08 checkbox；未完成流水线 = 未跑满）

| checkbox | 判定 | 证据 |
|---|---|---|
| `planner_verdict` PASS，无人工 kill | **FAIL**（未完成） | 无 kill；`exit_code=1`；无 usage.jsonl；无 verdict |
| Validator 至多一次；async 可等待 | **未跑** / scout **可等待** | 无 Oracle。scout `runId=717cdcd9-…`，`bg_wait` 等到完成 |
| ReviewResult；无 WorkerReport 误解析 | **未跑** | 无 Reviewer。scout 结果按原文注入，不是 WorkerReport |
| 无占位 Task；Worker taskId | **scout 段 PASS** / Worker **未跑** | 插件文案 `unbound-explorer-tool_K6iMydWAt3dRWNRiPHEdPGbM`，会话中无 `Placeholder task`、无 `T-20260907-001` |
| 结束时工作树干净，无 lockfile 漂移 | **未跑到实现** | HEAD 仍 `9027d8f`；porcelain 仅 `?? .agent-dir/ ?? .scratch/oracle-status-line/ ?? .scratch/phase-a-08-session/` |
| 每次委派均在默认地板内 | scout **PASS** | scout 7 turns / `$0.026` / `:low` |
| 对照文件记录四段墙钟 | 本文件（仅规划侦察） | 规划侦察 ~73 s；实现/Validator/Reviewer 未发生 |
| 运行前 `slot audit` / `slot status` | **PASS** | `phase-a-08-run2/slot-preflight.txt`（agy PID 2922205 绕过 slot，未杀） |

---

## 1. 实验设计

| 项 | 值 |
|---|---|
| 主仓库（脏树，01–21 未提交） | `/home/tcuni-claw/pi/pi-planner-only` @ `kimi-timing-probe` HEAD `bc7bb4e` |
| 票 worktree | `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r2` |
| 分支 | `phase-a-08-rerun-2`，起点且结束仍为 `9027d8f` |
| 插件 | `PI_CODING_AGENT_DIR=…/phase-a-08-r2/.agent-dir`，packages = `npm:pi-subagents` + 本地 `/home/tcuni-claw/pi/pi-planner-only`。未改全局 `~/.pi/agent/settings.json` |
| 第一次失败树 | 保留 `/home/tcuni-claw/pi/pi-planner-only-phase-a-08` @ `9921446` |
| 启动 | `slot cpu -- bash …/phase-a-08-run2/run.sh` |
| 开始 | `2026-09-07T14:45:15+08:00`（UTC `06:45:15`） |
| 结束 | `2026-09-07T14:47:43+08:00`（UTC `06:47:43`） |
| 墙钟 | **148 s（约 2.5 min）** |
| `exit_code` | **1** |

stderr 原文（`pi-stderr.log`）：

```
403 {"error":{"type":"permission_error","message":"You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends. To continue now, purchase extra usage or upgrade your plan: https://www.kimi.com/membership/subscription?tab=quota"},"type":"error"}
```

---

## 2. 时间线（到中止）

```
06:45:15  启动；k3-256k；issue 07 无费率警告（pricing.json 路径在 r2 agent-dir）
06:45:27  Root 读票（spec + issue 01）
06:45:34  git status / subagent list；HEAD 9027d8f
06:45:59  委派 scout（agent=scout, context=fresh，无 TaskSpec）
          插件：Async started task unbound-explorer-tool_K6iMydWAt3dRWNRiPHEdPGbM
          runId=717cdcd9-9f6d-4659-9c55-f9f0e992b901（可等待；无 Placeholder）
06:46:04  bg_wait id=717cdcd9-…
06:47:12  scout 完成（~73 s）；结果按 scout 正文注入；usage child taskId 为 unbound-explorer-tool_…
06:47:43  Root 下一轮 k3-256k → 403 5-hour limit；pi 退出 1
```

**没有发生：** Worker、Oracle、Reviewer、`planner_verdict`、占位 `T-20260907-001`、lockfile 漂移、人工 kill。

---

## 3. Scout 明细

| 项 | 值 |
|---|---|
| runId | `717cdcd9-9f6d-4659-9c55-f9f0e992b901` |
| 模型 | `kimi-coding/kimi-for-coding:low` |
| 墙钟 | 06:45:59 → 06:47:12（**73 s**） |
| 轮次 | 7 |
| 费用 | **$0.0258** |
| 插件 taskId | `unbound-explorer-tool_K6iMydWAt3dRWNRiPHEdPGbM`（非 canonical `T-YYYYMMDD-001`） |
| 输出 | 只读侦察（status 插入点、`oracleSuiteMode()`、测试锚点）；不是 WorkerReport |

相对第一次 08：当时 scout 无 spec → 占位 `T-20260907-001`。本次同一 Root 行为（先 scout）被 21 改成 unbound-explorer。Worker 无 spec 是否仍占位 **未测到**。

---

## 4. 产物路径

| 种类 | 路径 |
|---|---|
| 本对照 | `.scratch/planner-only-cost-control/phase-a-08-run2/comparison.md` |
| 启动 / 退出 | `phase-a-08-run2/run.sh`、`start.txt`、`end.txt`、`exit.txt`、`env.txt`、`pi-stderr.log` |
| slot | `slot-preflight.txt`、`slot-postflight.txt` |
| Root 会话拷贝 | `phase-a-08-run2/artifacts/root-session.jsonl` |
| scout meta/output | `phase-a-08-run2/artifacts/subagent-artifacts/` |
| worktree 全量 | `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r2/.scratch/phase-a-08-session/` |
| 第一次对照 | `.scratch/planner-only-cost-control/phase-a-08-run/comparison.md` |

---

## 5. 下一步（未授权前不重跑、不换模型）

08 合同要求与探测相同的 Kimi Root/子进程配置。额度耗尽时 **不能**改用 agy 或其他模型冒充 08 PASS。

额度窗口结束后：再开**新** worktree（不要复用本 r2 会话目录，也不要复用第一次 `9921446` 树），同样加载主树脏插件，再 `slot cpu`。本 r2 树 HEAD 仍是 `9027d8f`，可作中止证据保留。
