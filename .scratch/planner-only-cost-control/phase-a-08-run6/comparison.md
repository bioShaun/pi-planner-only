# phase-a-08-rerun-6 对照记录（2026-09-08）

- worktree：`/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r6`，从 `9027d8f` 起，分支 `phase-a-08-rerun-6`
- 插件：主树 `0158a1b`（工单 01–30、33–35 全部已落地；r5 的四个阻塞项 27/28/29/30 已闭合）
- 模型：`kimi-coding/kimi-for-coding`，`--thinking high`；Root prompt 与 r5 **逐字节相同**（md5 一致）
- 环境：`PI_PLANNER_ONLY=1`、`PI_PLANNER_ONLY_REQUIRE_CONTRACT=0`、`PI_PLANNER_ONLY_REQUIRE_REVIEW=1`
- 账本：`.agent-dir/planner-only/` 从空开始，未拷贝旧树
- 运行期间**未**执行 `/planner-only review root`
- `exit_code=0`，12:51:38 → 12:59:01，**7 分 23 秒**，无人工 kill
- 命令原始输出：`judge-out.txt`；产物快照：`artifacts/`

## 结论

**PASS。14 条全部 pass**（其中 C2、C9 两条的**字面命令**已过时，见文末「本票条款缺陷」——
判定按条款语义走，两条的实质都满足，且证据逐条贴在下面）。

这是阶段 A 门槛第一次真正达成：Root 全程没有自签 verdict，Task 是被**独立 reviewer 子代理的 PASS**
带进 `completed` 的；账本第一次做到**零漏记**。

## 14 条逐条判定

| 条款 | 判定 | 实测 |
|---|---|---|
| 1 严格模式 / review mode | **pass** | `env.txt` 有 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1`；`review mode: root` = **0**，`review mode: fresh` = **2** |
| 2 PASS 且账本 completed | **pass** | Task 行 `state=completed` `rounds=0` `rootModel=kimi-for-coding`；accept 回执 `decision: accept` / `[FRESH REVIEWER] verdict: pass`。Root 也发了 `planner_verdict{verdict:"pass"}`，被插件按设计拒收：`refused: lifecycle — Task ... is already completed; verdicts are final`。**字面「末条」已不适用**，见文末 |
| 3 oracle 真的跑过 | **pass** | 顶层 `agent` 字段计数 = **1** |
| 4 reviewer 真的跑过 | **pass** | 顶层 `agent` 字段计数 = **1** |
| 5 ReviewResult 由 reviewer 产出 | **pass** | 用 `review.ts` 的 `extractReviewResult` **实跑**解析 `2b609a71_reviewer_0_output.md`，解出 `{taskId:"T-20260908-001", verdict:"pass", evidenceFresh:true, findings:[]}` |
| 6 证据归因 > 0 | **pass** | `attributed 2 path`（3 处回执全是 2） |
| 7 无占位 Task | **pass** | `grep -c 'Placeholder task'` = **0**（r5 是 16）。两次无效 worker 委派被**拒绝**而不是造占位，见下 |
| 8 无 WorkerReport 解析错误 | **pass** | `grep -c 'not a valid WorkerReport'` = **0**（r5 是 6） |
| 9 Validator 至多一次 / 异步能等到 | **pass** | oracle 委派 **1 次**；唯一一次异步委派（scout）回执 `Async delegation for task unbound-explorer-… has started`，随后 `bg_wait id=1fd32313…` 等到结果（04:52:08 → 04:53:31） |
| 10 工作树干净 | **pass** | 只剩 `?? .agent-dir/`、`?? .scratch/oracle-status-line/`、`?? .scratch/phase-a-08-session/` |
| 11 委派在默认地板内 | **pass** | 见「地板核对」表：无一子代理触顶，无 budget stop，四个 `exitCode` 全 0；最大 turns 12（r5 曾到 22） |
| 12 对照文件写出 | **pass** | 本文件 |
| 13 slot 预飞记录 | **pass** | `slot-preflight.txt`；审计发现绕过 slot 的 PID 3917509／`pbbwa`（48.6G、CPU 1863%），**按规则未终止**，cpu 池 16 槽全空故照常起 |
| 14 账本一致性（硬条件） | **pass** | ledger runId 集合 = meta runId 集合（4 = 4），差集**双向为空**，漏记 **$0.00000000** |

## 分段墙钟与费用

| 段 | 参考值 | r4 | r5 | **r6** |
|---|---|---|---|---|
| 规划（起会 → worker 真正启动） | ~40 s | — | 88 s | **173 s**（含 scout 83 s ＋ 两次被拒的 worker 委派） |
| 实现（worker） | ~2 min | — | 6.7 min | **93 s**（`durationMs` 92825，12 turns） |
| Validator（oracle） | 30–50 s | — | 6 次，累计 42 turns | **87 s**（1 次，7 turns） |
| Reviewer | ~70 s | — | 4 次，全部未被记录 | **43 s**（1 次，3 turns，PASS 被记录） |
| 收尾（verdict 拒收＋git_audit＋落账） | — | — | — | **15 s** |
| **总墙钟** | **~8 min** | 7.8 min | 50.8 min | **7 min 23 s** |
| **总费用（实测口径）** | **~$0.19** | $0.296 | $0.782 | **$0.15628** |

偏离说明（按票面要求解释，不作为失败条件）：
- **规划段 173 s 超参考 40 s**：其中 83 s 是 scout（unbound explorer）异步跑完，另有两次 worker 委派
  被严格模式当场拒绝（工单 30），Root 第三次才带上合法 TaskSpec。**这两次拒绝是本次要验的行为，不是浪费**——
  r5 同样的输入造出了 16 个占位 Task。
- **Validator 87 s 略超 30–50 s**：只跑了一次，7 turns，重跑了 HEAD/status ＋ `index.test.mjs` ＋ `typecheck`。
  r5 是 6 次共 42 turns，本次是一次跑完。
- **实现与 Reviewer 都低于参考**。总墙钟与总费用**双双低于参考值**。

## 子代理明细与地板核对

| runId | agent | model:thinking | turns | tool | 时长 | cost | 适用地板 | 触顶? | 进账本? |
|---|---|---|---|---|---|---|---|---|---|
| `1fd32313` | scout | `…:low` | 9 | — | 83 s | $0.03440 | bounded：tool 20 / tokens 40k / $0.10 | 否（in+out 14 727 tok） | **是**（unattributed 行） |
| `8e6d03ee` | worker | `…:high` | 12 | 14 | 93 s | $0.06922 | workerInitial：无 tool 上限 / tokens 100k / $0.50 | 否（in+out 24 895 tok） | 是 |
| `e67b0831` | oracle | `…:medium` | 7 | 9 | 87 s | $0.02334 | bounded：tool 20 / tokens 40k / $0.10 | 否（tool 9 ≤ 20，in+out 10 271 tok） | 是 |
| `2b609a71` | reviewer | `…:high` | 3 | 4 | 43 s | $0.01363 | reviewer 无默认地板；回执声明 tokens 100k / $0.50 | 否 | 是 |

地板数值来源 `floors.ts:31-42` 的 `DEFAULT_FLOORS`（bounded：`toolBudgetHard 20` / `tokensHard 40_000` /
`costUsdHard 0.10`；workerInitial：`tokensHard 100_000` / `costUsdHard 0.50`）。上表 tokens 只计 input+output；
cacheRead（scout 63 744、worker 192 768、oracle 35 584、reviewer 12 800）单列，宿主是否计入 hard 上限
未经本轮验证，**不作断言**——四个子代理均无 stop reason、`exitCode` 全 0，也没有任何 budget stop 回执。

## 账本一致性（条款 14，硬条件）

`usage.jsonl` 两行：

| 行 | taskId | state | incomplete | unattributed | root cost | children |
|---|---|---|---|---|---|---|
| 1 | `T-20260908-001` | `completed` | — | — | $0.01570 | worker $0.06922、oracle $0.02334、reviewer $0.01363 |
| 2 | `unbound-explorer-tool_p8hiRjFeOSGigk0wAkKzeZZr` | — | `true` | `true` | — | scout $0.03440 |

- ledger runId 集合 **=** `<SA>/*_meta.json` 的 runId 集合（4 = 4，差集双向为空），**漏记 $0.00000000**。
  r5 是 8 vs 18、漏记 $0.27450（35.1%）；r4 漏记 30.1%。
- 第 2 行是**工单 35 的进程退出兜底落账**在真实运行里第一次生效：`finishedAt` 04:59:01.538Z 正是进程结束那一刻，
  scout 那 $0.03440 在 35 落地之前会**永远写不出来**（它挂在一个没有 Task 的合成 id 上）。
- 工单 29 的效果同样可见：oracle 这次**在**账本里；r5 里 6 个 oracle 一个都没进。

## 按主模型 5× 定价复算

口径同 r5：**只把 root 的主模型单价 ×5，children 照实测不动**——平时 root 坐 opus 这类贵模型，
子代理本就跑便宜模型，这个不对称正是本插件要省的钱。

| 口径 | root | children(4) | 合计 | root 占比 | 未入账 |
|---|---|---|---|---|---|
| 实测（kimi 同价） | $0.01570 | $0.14058 | **$0.15628** | 10.0% | $0.00000 |
| **主模型 5×** | **$0.07848** | $0.14058 | **$0.21907** | **35.8%** | $0.00000 |

- 参考值 ~$0.19 在同一 5× 口径下约 **~$0.29**（沿用 r5 的换算），**r6 低于参考值**。
- r5 同口径 $1.17838 → r6 $0.21907，**降到 1/5.4**；实测口径 $0.78194 → $0.15628，降到 1/5.0。
- root 只花了 2 个 turn、4.4k token（accept 回执自报 `root 4.4k/$0.0157 (2 turns) · children 43.3k/$0.11 ·
  root share 13%`；回执的 13% 与本表 10.0% 差在回执按 token 口径、本表按 cost 口径）。
  即便主模型贵 5 倍，root 也只占 35.8%——r5 那个「Root 反复重派、每次被同一道校验挡回」的死锁（工单 27）
  在本轮不再出现。

数据来源：children 取各 `_meta.json` 的 `usage.cost`，root 取 `usage.jsonl` 第 1 行的 `root.costUsd`，
与上文时间线同源，未做任何估算；5× 只作用在 root 那一个数上。

## 本轮实测到的插件行为（与已闭合工单的对应）

- **工单 30（严格模式拒绝无 TaskSpec 的委派）**：Root 头两次 worker 委派被当场拒收——
  第一次「role worker delegated without an embedded TaskSpec」，第二次「embedded TaskSpec is invalid
  (scope must be an object when present)」，第三次才放行。r5 同样输入造出 16 个 `Placeholder task`。
- **工单 27（补齐 reviewer 省略的绑定字段）**：reviewer 交回的 ReviewResult **不含**
  `reportRevision`／`workspaceDigest`，仍被记录并让 Task 进 `completed`。r5 正是卡在这里死锁
  （照合同办事的 reviewer 永远产不出可记录的 PASS）。
- **工单 22／24（严格模式 + root verdict 拒收）**：`review mode: root` 归零；Root 的 `planner_verdict` PASS
  被以 `refused: lifecycle` 拒收，因为 Task 已由 reviewer 的 PASS 完成。
- **工单 29／35（oracle 入账 + 退出兜底落账）**：账本第一次零漏记，见上一节。

## 本票条款缺陷（**未擅自修改，待授权**）

两条的**字面命令**已被本插件自身的正确行为淘汰，语义没变、判定不受影响，但照字面跑会给出误导性结果：

1. **条款 2 的「`usage.jsonl` 末条 `state=completed`」**：工单 35 落地后，进程退出时会追加一行
   `unattributed` 兜底快照，**末条不再是 Task 行**（本轮末条是 scout 那笔，没有 `state` 字段，
   照字面跑会 `KeyError: 'state'`）。建议改为「`usage.jsonl` 中该 Task 的记录 `state=completed`」，
   并允许存在 `unattributed:true` 的兜底行。
   同条的「一次运行产生 `planner_verdict` PASS」也需要跟着改：22／24 落地后，fresh reviewer 的 PASS
   才是完成动作，Root 随后的 `planner_verdict` 会被按设计拒收（本轮就是如此）。建议改为
   「产生一次被记录的 PASS verdict（fresh reviewer 的 accept，或 Root 在无 reviewer 可仲裁时的 `planner_verdict`）」。
2. **条款 9 的字面串「Async delegation has started」**：真实回执是
   `Async delegation for task <id> has started (runId: …)`，字面 grep **恒为 0**（本轮的 0 是假阴性；
   实际有 1 次异步委派且被 `bg_wait` 等到）。建议改成 `grep -o 'Async delegation for task [^ ]* has started'`
   配 `grep -o 'bg_wait id=[0-9a-f-]*'` 两条对照。

本轮 `judge.sh` 里这两处已按上述语义修正并写了注释（脚本不是票面，改脚本不等于改条款）；
**票面条款一个字未动，checkbox 与 Status 未动**，等授权后再落带日期的注记。

round_id=claude-pD-2026-09-08-judge-08-r6
