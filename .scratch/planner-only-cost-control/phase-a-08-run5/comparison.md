# phase-a-08-run5 对照记录

运行：2026-09-08 08:39:46 → 09:30:33（**50 分 47 秒**，自然退出 `exit_code=0`，无人工 kill）。
worktree `/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r5`，分支 `phase-a-08-rerun-5`，基线 `9027d8f`（与 r3/r4 同基线）。
插件＝主树 `0fe04df`（工单 01–24 已落地）。Root 模型 `kimi-coding/kimi-for-coding`，thinking high。

**本次与 r3/r4 唯一的配置差异：`PI_PLANNER_ONLY_REQUIRE_REVIEW=1`（工单 22 的严格模式）。**
运行期间未执行 `/planner-only review root`。`.agent-dir/planner-only` 未从任何旧树拷贝，账本从零开始。

## 结论

**FAIL。** 14 条验收里 5 条 fail、8 条 pass、1 条（C11）pass 但有保留。
最终 `usage.jsonl` 末条 `state=blocked` `rounds=2`，**没有产生 `planner_verdict` PASS**。

## 分段墙钟与费用

| 段 | 参考值 | r4 | r5 |
|---|---|---|---|
| 规划（首个 oracle 返回） | ~40 s | — | 88 s |
| 实现（首个 worker 返回） | ~2 min | — | 6.7 min（08:39:46 → 08:46:28） |
| Validator | 30–50 s | — | 6 次，累计 turns 42 |
| Reviewer | ~70 s | — | 4 次，全部未被记录 |
| **总墙钟** | **~8 min** | 7.8 min | **50.8 min** |
| **总费用** | **~$0.19** | $0.296 | **$0.782** |

费用构成：children $0.68286（18 个子代理）+ root $0.09911。

子代理时间线（epoch ms，`_meta.json` 的 `timestamp`）：

| # | runId | agent | turns | cost | 进账本? |
|---|---|---|---|---|---|
| 1 | `588268d7` | oracle | 3 | $0.01064 | **否** |
| 2 | `b288025c` | oracle | 5 | $0.01939 | **否** |
| 3 | `e63c7583` | worker | 22 | $0.07602 | 是 |
| 4 | `bf04bce7` | worker | 9 | $0.03166 | 是 |
| 5 | `e567653d` | worker | 9 | $0.04105 | 是 |
| 6 | `35527130` | oracle | 4 | $0.00965 | **否** |
| 7 | `7e479f36` | reviewer | 4 | $0.03906 | 是 |
| 8 | `a5b8f153` | worker | 8 | $0.04990 | 是 |
| 9 | `74f164e8` | worker | 22 | $0.11666 | 是 |
| 10 | `68b5f76e` | worker | 9 | $0.04099 | 是 |
| 11 | `52e07540` | worker | 3 | $0.01301 | 是 |
| 12 | `75d7ae1c` | delegate | 1 | $0.00384 | **否** |
| 13 | `272092ab` | oracle | 2 | $0.00496 | **否** |
| 14 | `0f57e0c8` | reviewer | 1 | $0.00976 | **否** |
| 15 | `b218cb3a` | oracle | 16 | $0.11002 | **否** |
| 16 | `9080d0f8` | reviewer | 1 | $0.00359 | **否** |
| 17 | `d51869b7` | reviewer | 1 | $0.00508 | **否** |
| 18 | `8d5078e9` | oracle | 12 | $0.09758 | **否** |

偏离解释：50.8 min / $0.782 不是模型变慢，是**一个死锁下的重试循环**——见下面根因一。
Root 反复重派 reviewer 与 oracle 想让一次 PASS 落账，每次都被同一道校验挡回，
直到会话自然结束仍停在 `blocked`。这不是「参考值偏离」，是失败本身的代价。

## 账本缺口（C14 硬条件，FAIL）

`usage.jsonl` 末条 children 共 8 个 runId，`<SA>` 的 `*_meta.json` 共 18 个。
**差集 10 个，漏记 $0.27450360，占实际总支出（$0.78197）的 35.1%**（r4 是 30.1%，本次更差）。

```
meta - ledger: 0f57e0c8 272092ab 35527130 588268d7 75d7ae1c 8d5078e9 9080d0f8 b218cb3a b288025c d51869b7
ledger - meta: []
```

差集拆成两个互相独立的原因：

**(a) oracle 子代理从不入账（$0.25224，占缺口 92%）。** 五条账本记录里 children 的
`(kind, agent)` 分布是 `{('worker','worker'): 22, ('reviewer','reviewer'): 3}` ——
**oracle 一次都没有出现过**。这不是时序问题：`588268d7` 与 `b288025c` 在第一次落账
（00:48:45Z）之前就结束了，仍然不在里面。6 次 oracle 委派花掉 $0.25224，账本认为它们不存在。

**(b) 最后一次落账之后的 7 个子代理全部丢失（$0.02227）。** 账本最后一条写于 01:09:36Z，
而进程跑到 01:30:33Z。这 21 分钟里又跑了 7 个子代理，因为 Task 再没进入终态，
`flushIfTerminal` 再没触发，进程退出时也没有兜底落账。

工单 23 收的是「失败子委派有 meta 但不入账」，与这两条都不是同一个洞。

## 根因一：reviewer 合同与绑定校验互相矛盾，严格模式下构成死锁

这是本轮 FAIL 的主因，也是 22 落地后第一次暴露。

- `review.ts:145-152` 是发给 reviewer 的输出合同，逐字规定 ReviewResult 的形状：
  `{"taskId","verdict","summary","evidenceFresh","findings":[...]}`。
  **合同里没有 `reportRevision`，也没有 `workspaceDigest`。**
- `review.ts:199-209` 的 `validateReviewResultBinding` 规定：`verdict === "pass"` 时
  这两个字段**都必须有**，缺任一条就报
  「ReviewResult is missing reportRevision; a pass must name the report revision it reviewed」。
- `roles.ts:523-525` 只把这两个值放进发给 reviewer 的 **ReviewRequest 输入包**，
  从没要求 reviewer 回显。

于是：**一个严格照合同办事的 reviewer，永远产不出一份能被记录的 PASS。**
本轮 4 次 reviewer 委派全部照合同返回（`0f57e0c8` 的输出是一份格式完全合法、
论证也扎实的 `verdict: pass`），全部被绑定校验拒收。

`root` 模式下这个洞看不见——Root 自己签 verdict，不走 reviewer 记录路径（正是 r4 的情形）。
工单 22 把默认切成 `fresh` 之后，`rootVerdictRefusal` 要求「pass 必须有已记录的 reviewer
ReviewResult」，而 reviewer 又永远记不上，**两道门槛互相咬死，Task 只能以 blocked 收场**。

单元测试没能拦住，因为 fixture 直接注入了这两个字段（`review.test.mjs` 等文件里
`reportRevision` 出现 15 次）。绿灯建立在「注入了真实链路上不存在的字段」之上。

## 根因二：Root 未嵌 TaskSpec，插件造占位 Task

```
[PLANNER-ONLY] Placeholder task T-20260908-001 created (parent did not embed a TaskSpec; canonical id: T-20260908-001).
```

第一个 worker 拿到的是一个没有 objective / scope / acceptanceCriteria 的空壳，原话：

> No TaskSpec was embedded in this task — the objective, scope, constraints, and acceptance
> criteria are all empty. Per the planner-only worker contract, I made no code edits.

后续 worker 只能自己去翻 `.scratch/oracle-status-line/issues/` 猜任务，虽然最终猜对并实现提交了
`e4769de`，但整条评审链一直挂在一个「无目标」的 Task 上，reviewer 也在 summary 里点出
「TaskSpec embedded no explicit objective/scope/acceptanceCriteria, so review is limited to
verifying the reported end state」。这就是 Kimi 探测记的第三个 bug（TaskSpec 静默丢弃），
22/23/24 都没碰它。

## 根因三：WorkerReport 提取器在多个 JSON 对象里挑错

```
[PLANNER-ONLY] Worker output for task T-20260908-001 is not a valid WorkerReport.
invalid WorkerReport: status must be one of completed, partial, blocked, failed
```

被拒的 `74f164e8_worker_output.md` 里 `"status"` 出现四次：一次是 WorkerReport 自己的
`"status": "completed"`，另外三次是 `validation` 数组里条目对象自带的 `"status": "passed"`。
提取器抓到了后者，把一份合法报告判死。对照组：`68b5f76e` 与 `a5b8f153` 把 `validation`
写成字符串数组，就顺利通过。触发条件是 validation 用对象写法——而 worker 合同并没有禁止这种写法。

## 与 r4 的对比

| | r4 | r5 |
|---|---|---|
| `review mode: root` | 出现 | **0** |
| oracle 真的跑过 | **0 次** | 6 次 |
| reviewer 真的跑过 | **0 次** | 4 次 |
| Root 自封 PASS | **是** | **不可能了**（严格模式拒绝） |
| `Placeholder task` | 2 | 16 |
| `not a valid WorkerReport` | 2 | 6 |
| 终态 | completed（自封） | **blocked** |
| 漏记比例 | 30.1% | **35.1%** |

工单 22 达成了它的目标：**Root 再也不能在零 oracle 零 reviewer 的情况下自己签 PASS。**
代价是把一条原本被自封 PASS 掩盖的死锁暴露成了显性失败——这是好事，但必须先修完才能再重跑。

## 按主模型 5× 定价复算（2026-09-08，用户指示）

用户口径（2026-09-08 明确）：**只把 `root` 那一行的主模型单价 ×5，children 照实测价不动。**
理由是平时 root 坐的是 opus 这类贵模型，而子代理本来就该跑便宜模型 —— 这个不对称正是本插件要省的那笔钱，
把两边一起放大反而把它抹平了。

| 口径 | root | children(18) | 合计 | root 占比 | 未入账 | 未入账占比 |
|---|---|---|---|---|---|---|
| 实测（root 也是 kimi） | $0.09911 | $0.68283 | $0.78194 | 12.7% | $0.27450 | 35.1% |
| **主模型 5×（本节口径）** | **$0.49555** | $0.68283 | **$1.17838** | **42.1%** | $0.27450 | 23.3% |

r4 同口径：实测 $0.29582 → 5× 后 **$0.51697**。参考值 ~$0.19 里 root 占比若与本次相近（12.7%），
5× 后约 **~$0.29**；即 r5 在真实定价下是参考值的 **~4 倍**。

**判定不变，但读数要读对三件事：**

1. **root 占比 12.7% → 42.1%。** 这就是本插件存在的理由被量化出来的样子：主模型越贵，
   root 侧每一个多余的 turn 越贵。r5 的 root 烧了 12 个 turn 才停在 `blocked`，
   在 opus 级单价下这一项单独就 $0.50，比整轮参考总支出还高。
2. **C14 仍然 FAIL，且不要被 23.3% 骗了。** 漏记比例从 35.1% 降到 23.3% 纯粹是 root 单价把分母撑大了，
   缺口本身（oracle 从不入账 $0.25224 + 末次落账后 7 个子代理丢失 $0.02227）**一分钱没少**。
   账本漏的是 children 侧的钱，抬高 root 单价不修复任何东西。**不得据此宣称账本变准。**
3. **工单 27 的优先级只增不减。** 这一轮的超支不是「模型贵」，是根因一的死锁重试循环
   （50.8 min vs 参考 ~8 min）。而在真实定价下，那个循环最贵的部分恰好落在 root 侧 ——
   Root 反复重派 reviewer 与 oracle、每次被同一道校验挡回，每一次重派都在按 opus 单价计费。

口径来源：children 单价取 `<SA>/*_meta.json` 的 `usage.cost`（18 个全有），root 取 `usage.jsonl` 末条的
`root.costUsd`，两者与上文时间线表同源，未做任何估算；5× 只作用在 root 那一个数上。

round_id=p11-r053
