# 01:31 场运行证据报告：RT 实施、reload 边界与会话归属

日期：2026-09-12。性质：只读历史记录研究，不是代码验收或运行修复。

## 1. 最强结论

1. **最新创建的可见顶层 Root 是 08:11:28 场，不是 01:31:47 场。** 01:31 场是本次 RT-01～RT-06 实施主场，并在 08:16 恢复、08:18 继续对话。按创建时间、最后事件时间、usage 中的 sessionHint 排序，会得到不同答案；本文用实际会话头确认身份。[M:L1、L762–769；N:L1]
2. **本场 13/13 个实际子运行均由旧指纹 `5a2297482bcf` 的 Orchestration 派出。** 05:14 的 reload 仍是该指纹；本 Root 到 08:16:07 才记录新指纹 `10b2258e3330`。此后新增派工、wait、verdict 均为 0。不能用“执行 RT 修复的会话”证明这些修复已通过新构建宿主验收。[M:L4、L578、L618、L762–769；R 全部 13 条]
3. **15 次 exact-id wait 中 13 次返回无法送达（86.67%），涉及 12/13 个独立 run。** 同一 run 的报告通知随后全部出现，失败 wait 到报告通知为 **0.036～8.913 秒**；不是任取下一条 custom 消息。唯一正常 wait 只确认完成事件，不能算“一次 wait 返回完整报告”。[第 5 节逐行表]
4. **进程退出、通知摄取、run-state 和 Task 完成并未一致收敛。** meta 13/13 exit=0；run-state 为 terminal/recorded 8、terminal/output-pending 4、running/recorded 1。4 个 pending oracle 的通知明确说 recorded，所属四个 Task 全 completed；8/8 terminal/recorded 仍残留 OUTPUT_PENDING。[第 6 节]
5. **账本修复的“120 foreign”不是可信的正确集合。** 实际工具返回 moved=120、removedFromUsage=515、removedFromLedger=0；当前 U:L127–128 的迁移审计却包含本应保留的 `7110bd1b`、`143426ad`。所以“清空了 T-004 children”不能证明“只移走外部运行”。[C/75d4492b:L12–16；U:L127–246；S:L229–239]
6. **T-023 从未成功派出运行，却保留 121 个 usage.children：120 个不属于 M，1 个属于 M 但绑定的是 T-022。** 其 lifecycle 仍 planning、executions=0；这些费用不是 121 次本 Task 工作。[M:L352–353、L641–761；L/023:L1；U:L253、L274]
7. **新构建也有独立的归属异常证据。** N 没有任何子派工，却写入 133 条不同 run 的 child meta 事件，全部贴 N 的 sessionHint；其中 13 个实际属于 M、120 个属于其他运行，116 条归历史 Task、17 条 unattributed。新构建启动成功不等于 session attribution 正确。[N:L4、L16–148]

## 2. 来源、快照与身份口径

### 2.1 来源短名

以下 `L<n>` 均为原文件物理行号。账本和 run-state 为单行 JSON，引用 L1 后同时说明 JSON 字段；不能把格式化输出的虚拟行号当源行号。

| 短名 | 绝对路径 / 规则 |
|---|---|
| M | `/home/tcuni/.pi/agent/sessions/--public-pi-pi-planner-only--/2026-09-12T01-31-47-662Z_01a0933d-fa4e-726c-983c-4f4e039fec2e.jsonl` |
| N | 同目录 `2026-09-12T08-11-28-374Z_01a094ab-e4f5-74d0-a6bb-642b20714178.jsonl` |
| C/UUID | M 去掉 `.jsonl` 的目录下 `<完整子 UUID>/run-0/session.jsonl`；完整映射见第 4 节 |
| A/run/agent | 同 sessions 工作区目录 `subagent-artifacts/<完整 runId>_<agent>_meta.json`；另有 `_output.md`、`_transcript.jsonl` |
| L/nnn | `/home/tcuni/.pi/agent/planner-only/ledger/T-20260912-nnn.json` |
| R/call_n | `/home/tcuni/.pi/agent/planner-only/run-state/unknown-session-_public_pi_pi-planner-only-call_n.json` |
| U | `/home/tcuni/.pi/agent/planner-only/usage.jsonl` |
| S | `docs/runtime-session-143619-2026-09-11-optimization-spec.md`，本次读取为 305 行 |

快照指纹：

| 文件 | 行数 | 字节 | SHA-256 |
|---|---:|---:|---|
| M | 769 | 1,753,592 | `034da25fbf0bd056c6bc2a007b5581b968f26f5e9313f297e2d66b2f8c7016a5` |
| N | 150 | 117,625 | `c4dc4043e4127d8a80a347f1131d560a46e0283d908904aedf5a7b33c54db9fc` |
| U | 274 | 634,509 | `5af36dd716492643232e3a1bcffe21dc22a411dbb6bf433ad8776c627577049b` |

当前共享目录有 62 个 Task JSON、122 个 run-state JSON、133 个 meta JSON；这些是检索母集，不是本场分母。M 下恰有 13 个子 session 文件。M/N 末事件分别为 08:18:24.035Z / 08:15:44.946Z；L/023 的 writtenAt 为 08:25:11.714Z。账本是后续写回快照，不是 05:18 时刻的冻结状态。

### 2.2 最新 Root 的确定

只枚举 `agent/sessions/*/*.jsonl`，读取第一行 `type=session`、`id`、`timestamp`、`cwd`，不递归把 `run-0/session.jsonl` 计入 Root。可见顶层会话头共 109 个；本工作区 10 个，创建时间最大者为 N。前几个本工作区 Root 的创建时间依次为 09-11 14:36、09-12 01:14、01:31、08:11。

U:L259–263、L269–273 还引用 `08-14-44...01a094ae`、`08-17-46...01a094b1` 的 sessionFile，当前没有对应顶层 JSONL。它们是**仅在用量记录中出现的身份线索**，不足以取代 N 成为“最新可见顶层 Root”。同理，14:36 场追加到了 08:17，不会因此变成比 01:31 更新创建的会话。

### 2.3 本场成员资格

- 从 M 中成功 `subagent` 工具返回提取 taskId + host runId；用 toolCallId 回连原始 TaskSpec 和 executionId，再与 L.executions、R.runId/identityIndex 交叉核对。
- 子 session 路径用 wait 的 `details.completions[].results[].sessionFile`，以及报告通知的 `Session file:` 交叉核对。**本批 meta.transcriptPath 指向共享 artifacts 中的副本，不直接指向 M 的子目录**，不能用它的路径前缀筛 M。
- 主场涉及 8 个 Task：7 个本次新建的 T-022～028，以及实际复用的历史 T-004。成功派工只涉及其中 7 个；T-023 是被拒派工留下的 planning Task。
- Task 归属与 session 归属是两条轴。T-004 的旧两个 execution 不属于 M；T-022 的 `f032477d` 属于 M，却不能归 T-023。usage.children 不能反向决定 session 成员资格。
- 以下全场比率只统计 M；N 作为独立新构建观察，绝不混入 M 的 wait、Task、预算或进程分母。

## 3. 构建与 reload 时间线

| UTC | 一手记录 | 可证明的事实 |
|---|---|---|
| 01:31:48.024 | M:L4 | loaded=`5a2297482bcfa5bb3f8e32a208664d258c25ebf8ae9e4c9ac114ed47ffd59060`，diskHead=`deffe11fbdcc5ef03535c41386ece79162f20c1f`，package 0.4.1，provenance sessionId=`unknown` |
| 01:36–02:57 | M:L241–560 | 账本修复、四批 RT 实施及验证均在这个 loaded 版本下编排 |
| 05:14:42.266 | M:L578 | reload 又记录同一 loaded 指纹和 deffe11；用户的“已经 reload”不等于装到了工作区新代码 |
| 05:18 | C/83740aff:L14、L16、L18–20；M:L626、L638 | Worker 创建并 push `daf5716e90508d7ce45d0fafa4b8b2898aeea85a`，18 文件、1665 insertions、68 deletions；Root 接受提交 Task |
| 08:11:23 | M:L641–761 | 旧构建尾部回填 121 条 meta child 用量到 T-023 |
| 08:11:29.371 | N:L4 | 新 Root 启动即记录 loaded=`10b2258e333019d7dfd3fc587e15dcc3df386d1d3e246050d46a50cf8d109ace`，diskHead=daf5716 |
| 08:14:43 | N:L16–148 | 新构建下出现跨运行 meta 用量回填 |
| 08:16:07.784、08:16:11.950 | M:L762–763 | M 首次记录新 loaded 指纹、daf5716；sessionId 改为带时间戳的 session stem |
| 08:16–08:18 | M:L764–769 | 两轮说明性对话、两条 untasked root-turn，无派工、wait、verdict |

插件 sourcePath 是 `/home/tcuni/.pi/agent/git/github.com/bioShaun/pi-planner-only/index.ts`，不是工作区 `/public/pi/pi-planner-only/index.ts`。因此修改工作区和运行本地测试不更新已加载插件。所有 13 个 R.loadedProvenance 都保留旧指纹；13 个 launch 的 runtime extension 标识均为 `sha256:4f71a576bce95e76`，这也不能替代插件 build fingerprint。

S:L7–9、L273–275 已区分“实施/离线回归”和“新构建宿主重放”。M:L766 将多项功能标成已生效，并宣称费用封闭准确，是 Root 自述；新指纹证明加载身份，不证明 B01～B24 通过。旧构建下的失败也不能直接定性为 RT 新代码的回归。

## 4. 完整任务与运行清单

### 4.1 Task 总账

所有编号省略共同前缀 `T-20260912-`。状态取当前 L.task.state，与 M 中最后实际裁决交叉核对。

| Task | 本场工作 | 本场 run 数 | 当前状态 | M 证据 |
|---|---|---:|---|---|
| 004（历史） | 执行 T-004 修复脚本及验证，复用了原代码修正 Task | 1 | blocked | L328–339、L357–404 |
| 022（新） | 实现一次性账本修复；oracle 验证；report-only 重发 | 3 | blocked | L240–323 |
| 023（新） | 第一次尝试派 Batch 1，被 T-004 写锁拒绝 | 0 | planning | L352–353；L/023:L1 executions=[] |
| 024（新） | Batch 1：RT-01 + RT-05 | 2 | completed | L406–442 |
| 025（新） | Batch 2：RT-02 | 2 | completed | L447–479 |
| 026（新） | Batch 3：RT-03 + RT-04 | 2 | completed | L484–516 |
| 027（新） | Batch 4：RT-06 + export 分列 + spec | 2 | completed | L521–560 |
| 028（新） | commit + push 全部四批改动 | 1 | completed | L617–638 |

合计 **8 Task：5 completed、2 blocked、1 planning**。新建分母 7：5 completed、1 blocked、1 planning；实际有 run 的分母 7：5 completed、2 blocked。不能用 2/8 blocked 推出交付失败率，也不能把仍 planning 的 T-023 忽略。全部当前 successors=[]（0/8 有结构化后继）；第 7 节说明叙述性“superseded”与实际落账的差异。

### 4.2 13 个 run 的绑定索引

`call_` 列同时给出 R 文件定位；host agent 与插件 execution.kind 不总相同。A 文件名使用 host agent。

| 完整 host runId | Task | executionId | host agent | M 启动返回 | 子 UUID |
|---|---|---|---|---:|---|
| 5f58c9c7-790d-445b-a1af-e6b4ce040734 | 022 | call_129646 | worker | 241 | 1091c3a9-ae9a-419a-9779-39968f6306e3 |
| 7a5c1b48-904a-4cb4-b4da-a9c8e96ebaf4 | 022 | call_1006656 | oracle | 268 | 50f6d8a0-c1b9-406a-acbe-2193f41c1778 |
| f032477d-3864-4546-b0a5-c0d5a686c214 | 022 | call_1140579 | reviewer | 308 | 2931fd88-4a9f-44ba-b3b2-13e4db58d618 |
| 5d8b8581-08e7-417b-918f-6663db79194a | 004 | call_1441558 | oracle | 329 | 75d4492b-8ba1-405e-bd36-02149bb34622 |
| e8c5bb3b-8671-4750-ae9c-895fb778cf06 | 024 | call_37289 | worker | 407 | f56fedbf-6d36-478a-93ad-6a93155465d0 |
| 79f828d0-d319-4bdb-bc0a-aee065081251 | 024 | call_953598 | oracle | 430 | ce22138e-0e32-457e-9f72-96132ce383de |
| 510b15be-ae4a-45de-9769-8da6bb4b4173 | 025 | call_231310 | worker | 448 | 2dd8f762-d35a-47a4-beb4-ac77d87544f6 |
| 66606ebf-73f6-4a61-a4cd-37bff664a65a | 025 | call_1040698 | oracle | 467 | 2c95c5f8-232c-4f1c-abcd-ef6345bbdf97 |
| 6b069342-3196-40bb-9168-2d108d505a5a | 026 | call_647313 | worker | 485 | b435d9f4-a168-4d9f-8efb-ff7e2c124a04 |
| 15e5a8f8-0b70-40f4-8e5d-a49e446c4de5 | 026 | call_538805 | oracle | 504 | a668a3a8-92b2-4704-9ec1-904638101ff9 |
| e54f9fd6-ae6a-4126-b8ce-6372d7c57ff3 | 027 | call_606617 | worker | 522 | 3549d2da-0cd9-4458-a780-b6edbd759f03 |
| 8d338048-4d35-4a0c-9726-d30fee28a0fc | 027 | call_923888 | oracle | 543 | d4106b89-56ed-4cc7-a0cd-49097ae2b5b5 |
| 87840d75-ce63-4947-adb8-e21783544705 | 028 | call_961078 | worker | 618 | 83740aff-e7fe-4185-bac4-164c52ad8bd8 |

host agent 为 worker 6、oracle 6、reviewer 1；插件 execution.kind 为 worker 7、validator 6。唯一 reviewer 实际是 T-022 的 report-only WorkerReport 重发，0 工具、1 模型轮次，并非一次独立代码 ReviewResult 审查。[M:L307–312；L/022:L1 executions；C/2931fd88:L1–6]

M 中 subagent 调用 16 = 成功启动 13 + list 1（L23）+ 终态 steer 拒绝 1（L338）+ 写锁拒绝 1（L353）。因此 16 不能当子运行数。

## 5. exact-id wait 与同 run 报告通知

时间计算使用外层记录 timestamp，保留毫秒。通知匹配只接纳 `customType=subagent-notify`，用 runId、子 sessionFile、或已唯一绑定的 Task/角色与 execution 证据确认；不把 supervisor progress 当报告。以下 15 行覆盖全部 wait 返回。

| run 前缀 | M 调用→返回 | wait 耗时 s | 返回分类 | 同 run 报告 M 行 | 返回→报告 s |
|---|---|---:|---|---:|---:|
| 5f58c9c7 | 243→245 | 246.277 | 无法送达 | 249 | 0.039 |
| 7a5c1b48 | 270→272 | 63.068 | 无法送达 | 277 | 8.913 |
| f032477d | 310→311 | 5.652 | done，完成事件已观察 | 312 | 0.001 |
| 5d8b8581 | 331→333 | 52.953 | 无法送达 | 339 | 3.943 |
| 5d8b8581 | 379→380 | 0.001 | No active run matched | — | — |
| e8c5bb3b | 409→411 | 573.535 | 无法送达 | 415 | 0.041 |
| 79f828d0 | 432→434 | 61.545 | 无法送达 | 438 | 0.044 |
| 510b15be | 450→452 | 1,136.103 | 无法送达 | 456 | 0.040 |
| 66606ebf | 469→471 | 59.544 | 无法送达 | 475 | 0.036 |
| 6b069342 | 487→489 | 1,060.168 | 无法送达 | 493 | 0.054 |
| 15e5a8f8 | 506→508 | 52.932 | 无法送达 | 512 | 0.037 |
| e54f9fd6 | 524→526 | 958.278 | 无法送达 | 532 | 5.902 |
| 8d338048 | 545→547 | 64.815 | 无法送达 | 556 | 2.517 |
| 8d338048 | 551→552 | 0.002 | 无法送达（重等） | 556 | 0.036 |
| 87840d75 | 620→622 | 60.545 | 无法送达 | 626 | 0.042 |

计数解释：

- 无法送达 **13/15 次**，正常 done **1/15 次**，无匹配 **1/15 次**；首次 wait 无法送达 **12/13 run**。
- 13 次失败 wait 对应 12 条不同报告通知；8d338048 的两次失败共享 L556，不能算两个完成报告。
- 失败 wait 的延迟小于 0.1s 有 **9/13 次**，其余 4 次为 2.517、3.943、5.902、8.913s。按独立失败 run 的首次 wait 是 8/12 小于 0.1s。
- L334 和 L548 是 supervisor progress，分别紧接 L333、L547，但真正报告是 L339、L556。拿“下一条 custom”会把这两次错误算成 0.001s。
- 7a5c1b48 在通知前有 `planner_recover`（L275–277）；这 8.913s 包含 Root 介入，不能全部解释成宿主保存文件的延迟。
- 无匹配的 L380 发生在同 run 报告 L339 之后，不再寻找别的 Task 的后续通知凑配对。
- 初次失败返回的 details 已含 completion success=true、outputState=present 和子 session 路径，例如 L272、L452、L489。**宿主完成结果可见，与插件返回“saved output could not be delivered”并存**，说明不能只读 isError（此类返回可为 false）或只读正文判断进程失败。
- L311 只说 completion/control events observed，报告在 L312；严格的“wait 正文内直接交付完整报告”在 15 次返回中为 0，不能把 done 计成 RT-01 B01 已验收。

本场实际 wait 次数 / run = 15/13；旧 spec 的 59/54 与本场不是同规模、同工作负载实验。S:L131 所述“其后第一条 custom_message”也不能直接复用为本场同-run 通知算法。

## 6. 多维运行状态收敛

以下均以第 4 节的 13 个实际绑定 run 为分母，R 文件均 L1：

| R executionState / ingestionState | 数量 | executionId |
|---|---:|---|
| terminal / recorded | 8/13 | call_129646、1006656、1441558、37289、231310、647313、606617、961078 |
| terminal / output-pending | 4/13 | call_953598、1040698、538805、923888 |
| running / recorded | 1/13 | call_1140579 |

其他字段：

- 13/13 meta.exitCode=0，0/13 非零退出；不等于 13 个报告都满足验收。
- R 中 12/13 executionState=terminal；6/6 oracle 已 terminal，故不能照抄旧场“9 个 oracle 永远 running”。但其中 **4/6 oracle 仍 output-pending**。
- 13/13 R 含 terminalSource 和 terminalErrorClass；terminalSource 为 host-notify 11、reconcile 2，terminalErrorClass 全为 missing-report。旧 spec 的“字段 0 次出现”仅属于旧场快照，本场已不同。[S:L45–47]
- 12/13 R 有 lastError.code=OUTPUT_PENDING；特别是 **8/8 terminal/recorded 均未清除**。running/recorded 的 call_1140579 无 lastError，但 nextAction 仍 retry-output-reconcile。
- 13/13 slotReleased=true，13/13 nextAction=retry-output-reconcile，13/13 sessionId=unknown-session。释放槽位不等于 lifecycle、ingestion、下一步建议全部一致。
- 4 个 output-pending oracle：M:L438、475、512、556 均明确“Validator result ... recorded”，L/024～027 各有 1 个 validatorReports、state=completed。**Task 与通知成功，但 RunRecord 未反映摄取完成**，不是报告未到 Root。
- call_1140579 在 M:L319 的恢复返回也明确 running/recorded + RUN_ALREADY_RECORDED；这不是仅存在于后来磁盘快照中的异常。

meta 另有独立宿主 acceptance：6/6 host worker 为 rejected（Structured acceptance report not found），其余 7/7 为 not-required。该 attestation 协议与插件 WorkerReport/Root verdict 不同：例如 T-026 被 Root 接受、meta acceptance 却 rejected，进程仍 exit=0。[A/6b069342/worker 的 acceptance.runtimeChecks、childReportParseError；M:L516] 不把这 6 个 rejected 算成模型或代码执行失败，也不忽略这一层协议差异。

## 7. Root 请求、实际裁决、恢复与后继

### 7.1 全部 9 次 planner_verdict

| M 调用→返回 | Task | Root 请求 | 插件返回的实际决策 |
|---|---|---|---|
| 291→293 | 022 | request_changes | changes_requested / report_correction |
| 321→323 | 022 | pass | blocked / report-exhausted |
| 356→357 | 004 | pass | refused=lifecycle，子 run pending，未落 review |
| 402→404 | 004 | blocked | blocked / worker-failed-exhausted，仍引用旧代码修正失败 |
| 440→442 | 024 | pass | completed / accept |
| 477→479 | 025 | pass | completed / accept |
| 514→516 | 026 | pass | completed / accept |
| 558→560 | 027 | pass | completed / accept |
| 636→638 | 028 | pass | completed / accept |

请求分布：pass 7、request_changes 1、blocked 1。**7 次 pass 中 5 次 accept、1 次 blocked、1 次拒绝**；全部调用的 pass→blocked 为 1/9，已处理且未拒绝调用中为 1/8；pass 未获接受为 2/7。应同时给这几种分母，不能笼统写“2 次裁决改写”。request_changes 保持 changes_requested，但修正动作被路由成 report-only。

L/022.reviews 保留的是请求 pass，不是 applied blocked；L/004.reviews 共有 3 条，但其中 2 条来自以前会话，本场只新增最终 blocked 1 条。全 8 个相关 Task 的 reviews 快照合计 10 条，本场实际新增 8 条；拒绝的 pass 不入账。**仅数 ledger.reviews 会同时混入旧 review、漏掉拒绝、掩盖请求与实际状态不一致。**

### 7.2 T-022：并非单纯“成果正确、协议错”

1. 初 Worker 的脚本路径被目录折叠采样为 `scripts/`，报告声称的具体文件被判 over-declared/missing，通知要求 revalidate，recoveryAttempts 进入 1。[M:L249]
2. 独立 oracle 检查通过 typecheck/rs05；Root 随后确实发现 `git diff --check` 的 EOF 空白问题。该失败在子工具返回也真实存在，不应称零实现问题。[C/1091c3a9:L48；M:L291–293]
3. request_changes 同时要求去空白、使脚本可归属，实际却被路由到“Do not modify files”的 report-only。新 invocation 只缩减 changedFiles，0 工具，没有执行代码修正。[M:L293、L307–312]
4. 再 pass 仍 blocked，report-exhausted，显示 round=0/3。L/022.recoveryAttempts=2，recoveryStates 有两个不同 revision 的证据状态，不是 3 次恢复耗尽；其 spec 已被 report-only 契约覆盖，原 objective 要回 M:L240 才能看全。
5. 脚本最终随 T-028 提交，可证明交付物存在，但 T-022 没有 successor、completionKind=committed 或 closed-superseded 的实际闭环。[C/83740aff:L12–16；L/022:L1]

### 7.3 T-004：修复成功自述与旧 Task 状态混用

清理工具由 oracle 执行，绑定到旧 T-004；其输出 taskId=T-pending、status=partial，因实际 moved=120 与契约 79 不符。[M:L328–339] 然后出现：

- L353：Batch 1 派工被 T-004 写锁拒绝；创建的 T-023 留在 planning。
- L357：Root 想以“120 unique foreign 全部清理”pass，却被 pending lifecycle 拒绝。
- L361：planner_recover 返回 REPORT_SCHEMA_INVALID / terminal / report-invalid / retryable=false。
- L380：再次 wait 无 active run。
- L404：最终 blocked 仍以历史代码修正未完成为原因，并显示 reviewRound=3；这不能证明本场执行了 3 次新修正。L/004.recoveryAttempts=0。

本场 planner_recover 共 **3 次**：L276 recorded、L319 duplicate、L361 pending/schema-invalid。最后 R/call_1441558 又是 recorded；必须保留“当时返回”和“最后快照”的区别，不能只择其一。

### 7.4 后继关系能证明到哪一步

业务上存在“023 被拒后由 024 执行同目标”“022 的脚本被 028 提交”“024～027 的代码统一由 028 提交”；L/004 旧 review 文本也称由 T-006 替代。但 **8/8 当前相关 Task 的 successors 都为空**，本场 verdict 没有 acknowledgeDrift，未见结构化 commitOf 闭环。故本场不能验收 RT-02 的认可后继归因；也不能把四批各一次 pass 的正常接受，解释为“后继覆盖死锁已经消失”。

## 8. 预算、验证和流水线

### 8.1 全量子工具结果

13 个子 transcript 共 **687 条 toolResult**：read 247、grep 98、find 6、ls 5、bash 177、edit 148、write 4、contact_supervisor 2。

唯一明确宿主 hard block：**1 条 / 687 toolResult，涉及 1/13 run（7.69%）**，C/1091c3a9:L52，文本为 `after 33 tool calls (hard 20)`，阻拦 read。此 run 总 toolResult=33；被拦发生在 EOF 空白修正准备阶段，最后仍产出 completed 报告并列风险。[L48–53]

| run / Task | toolResult 数 | 明确 hard block |
|---|---:|---:|
| 5f58c9c7 / 022 worker | 33 | 1 |
| 7a5c1b48 / 022 oracle | 16 | 0 |
| f032477d / 022 report-only | 0 | 0 |
| 5d8b8581 / 004 oracle | 11 | 0 |
| e8c5bb3b / 024 worker | 107 | 0 |
| 79f828d0 / 024 oracle | 16 | 0 |
| 510b15be / 025 worker | 165 | 0 |
| 66606ebf / 025 oracle | 13 | 0 |
| 6b069342 / 026 worker | 157 | 0 |
| 15e5a8f8 / 026 oracle | 15 | 0 |
| e54f9fd6 / 027 worker | 128 | 0 |
| 8d338048 / 027 oracle | 16 | 0 |
| 87840d75 / 028 worker | 10 | 0 |

launch details 中 8/13 下发 hard=20、soft=16、block=[read,grep,find,ls]：首个 worker、6 个 oracle、report-only。其余 5 个 worker 未返回 toolBudget 字段。**没有字段不代表无限额；配置 block 集合也不等于四种工具均实际触发拦截。** 本场只有 read 一条正例，不能由 0 次 bash block 推断宿主绕过规则已修复或仍存在。

预算下降相对旧 spec 的 28/54 只能作描述，不是 RT-04 因果效果：本场 4 个大型 Batch Worker 已在旧 loaded 下无 hard=20 返回，且无新构建预算探测。soft 提醒恰好一次、bash 只读分类、批量计数、contextPack 减探索等 B13～B16 仍缺相应宿主正反例。

### 8.2 验证和提交

四批各由 Root 显式派 1 个 oracle（M:L429、466、503、542）；通知均通过，Task 均被接受。没有实际自动 oracle 派工证据。唯一 host reviewer 是 report-only 重发；没有形成独立 reviewer + oracle 并行审查对。

从 13 个启动返回与对应完成记录看，下一次派工均在前一 run 完成后，观察最大子运行并发为 1。M 的 git_commit 调用 **0 次**；唯一提交/push 由 T-028 Worker 完成（1 个 run、10 条 bash 结果），不是 RT-06 提交原语宿主验收。

Root 工具调用共 **149 次**：read 82、git_audit 24、subagent 16、bg_wait 15、planner_verdict 9、planner_recover 3。新 loaded 后此类工具调用为 0。Root 工具/模型轮次成本仍显著，但与旧场体量不同，不用百分比承诺性能收益。

## 9. 用量：事件、快照、run 与归属不可混计

### 9.1 M 的事件账

M 中 planner-only-usage 共 **425 条**：root-turn 160、child 158、leak 89、injected 18。

158 条 child 事件按实际绑定分解：

| 分类 | 事件数 | 独立 runId | 解释 |
|---|---:|---:|---|
| 属于 M 的 run | 38 | 13 | bg-wait 12、sync-details 15、meta-file 11，含同 run 多次摄取 |
| 不属于 M 的 run | 120 | 120 | 全部 meta-file，均落 T-023 |
| 合计 | 158 | 133 | 不能当 158 次运行或直接加总费用 |

例如 M:L451、453、454 是同一个 510b15be 的三种来源；bg-wait 和 meta-file 均带同一估算 costUsd。直接加所有 M child 事件会把本场部分费用重复加总为 $4.33498252。按 13 个 run 去重并取有定价的完整最终记录，本场子费用估算 **$2.18002944**，对应 meta 合计 input=1,588,318、output=135,259、cacheRead=85,002,752、turns=474。host meta.usage.cost 全为 0，本地 costUsd 是另一套估算，不能叫结算账单。

### 9.2 T-023 是两类污染的交汇点

M:L641–761 在 08:11:23 回填 121 个不同 run 到 T-023，其中：

- **120/121** 不在 M 派工集合，合计 $14.35141172。
- **1/121** 是 M 的 f032477d，实际任务 T-022，在 M:L755 被记到 T-023，$0.00211580。
- 合计 $14.35352752；L/023:L1 usage.children 当前也为这 121 个独立 run，但 executions=[]、reports=[]、reviews=[]。

所以“foreign=120”只描述 session 外的部分；另外 1 条虽 in-session 仍 Task 错配。若只以“是否在本 Root 的 child 集合”做费用过滤，仍会漏掉它。

相关 8 个 Task 的当前 ledger children 合计 **136 条、133 个独立 run**：13 个 M run、120 个外部 run（含 T-004 两个旧 run）。f032477d 同时挂 T-022/T-023，7110bd1b 和 143426ad 同时挂 T-004/T-023，形成 3 条跨 Task 重复。分 Task 为 004=3、022=3、023=121、024=2、025=2、026=2、027=2、028=1。其中 023 绝不能算本场 121 个 execution。

当前 L/004 的 3 children 为 `7110bd1b`、`143426ad`、`5d8b8581`：只有最后一个是 M 成员。因此 **T-004 children=3，M 中 T-004 run=1** 完全可以同时成立。其余有派工 Task 的 ledger 已按 run 去重，但多条 child.sessionHint 被后续 harvest 覆盖为 `2026-09-12T08-17-46-121Z_01a094b1-a888-75a6-bb06-69fe691f3ecf`，并不反映真实派工 Root。

### 9.3 修复“120 而非 79”的更严重问题

实际执行的历史工具结果：C/75d4492b:L12 为 dryRun=false、moved=120、removedFromUsage=515、removedFromLedger=0；L15 为 246 条当时 usage 快照、5 条 T-004 汇总记录、T-004 children=0、120 条 unattributed、120 unique run。

这首先说明 **515 是被移除的历史 child 出现次数，120 是去重 run 数，79 是旧 spec 单次污染观察的计数**，三者不能直接相等。但不能仅以“数据后来增长”解释差额并接受：

- U:L127–246 共 120 条 `sourceTaskId=T-20260912-004` 的 unattributed 审计，合计 $14.35141172。
- **U:L127 的 runId=7110bd1b...，U:L128 的 runId=143426ad...**，正是 S:L239、M:L240 明确要求保留的两个真实 T-004 run。这 2/120 条不是相对 T-004 的 foreign；相对 M 又确实是历史 run。
- oracle 的 ledger 检查命令读取顶层 x.children，而实际文件包裹为 `{version,writtenAt,task}`。L16 同时输出了完整 snapshot；重新读取 nested task.usage 后当时同样没有 children，因此“当时未列出 children”可复核，**但原检查方法不构成对正确嵌套路径的可靠验收**，更不能用 removedFromLedger=0 证明已修好真实账本。
- 当前账本再次出现正确的三个 T-004 run，不意味着迁移审计正确，可能是后续 harvest 写回；本次只观察结果，不推断未记录的内存写回因果。

本次没有运行修复脚本。以上是对既有历史执行的审计。结论是 B19 保留集合的验收有直接反证，不能把 M:L766 的“已清理、度量可信”当事实。

### 9.4 新 Root N 的 foreign 与 untasked

N 的全部工具调用是 bash 1 次（guard 拒绝）、git_audit head/status/log 各 1 次，共 4 次；成功子派工=0、子目录 run=0、wait=0、verdict=0。[N:L7–13]

但 N:L16–148 有 **133/133 不属于 N 的 child run**，均 source=meta-file 且 child.sessionHint=N stem：

- 13 个实际 M run，估算 $2.18002944；其余 120 个 $14.35141172；合计 **$16.53144116**。
- taskId 为历史 Task 的 116 条，unattributed 17 条。归回某个原 Task 可能是正确的全局 Task 关联，**贴成 N 的 sessionHint 仍是错误会话归属**。
- N:L142 的 f032477d 被归 T-022，而 M:L755 曾归 T-023；同一 run 在多会话用量事件中有冲突归属，不能只保留最后 sessionHint 当真值。
- N:L4 已是新 loaded，所以此项与 M 的旧构建 wait 问题不同：它是新构建下可直接观察到的 usage 归属问题。133 条正好覆盖当前共享 meta 母集，但仅凭记录不定位具体实现分支。

N 三条 root-turn（L6、9、14）全部 id=`root-turn:untasked:*`，无 taskId；M 新 loaded 后两条（L765、768）也是如此。**5/5 已观察新构建 Root 轮次的 untasked 事件有正证据**，不过 N 有 git_audit 而仍 untasked，不能泛化为所有带任务工具的轮次也正确绑定。

### 9.5 Root 用量与持久化缺口

M 的 160 条 root-turn：T-004 84、T-022 16、T-023 27、T-024 7、T-025 6、T-026 6、T-027 8、T-028 4、untasked 2，总和 160。

首个成功派工返回 L241 前已有 **59/160 条 Root 用量事件**，全归历史 T-004（L9–239）。其中 L239 是包含首次派工的轮次；若只计首个派工调用 L240 前的既往工具/说明轮次，应区分这一调用轮次，而不能据此声称有 59 次纯闲聊。T-023 的 27 轮更不能解释成它执行了工作。

M Root 原始 usage 合计 input=4,407,912、output=74,439、cacheRead=31,446,606、totalTokens=35,928,957，cost.total=$5.94357570。N Root 3 轮合计 totalTokens=38,803、cost=0（Kimi 未定价；不是免费结论）。M 两条新 loaded untasked 费用为 $0.48670950。不同模型、cache 与估算来源分列，不从 token 比或 Root share 推断模型效率。

U 不是 custom usage 事件流，而是每行带 root/children 的**汇总快照**：

- 274 行中，sourceTaskId=T-004 的迁移审计 120 行（L127–246）；这不是 usage export。
- sessionFile=M 的 8 行：L247–253、L274。T-023 出现两次，均 121 children / 27 Root turns，是重复快照，不能相加；这里还缺 T-022 的 M 汇总行。
- N 的对应汇总块 L254–258、L264–268，每块有 unattributed 17 children，以及四个历史 Task 的 3/3/1/3 children。它们不等于 N 真实运行清单。
- **U 全 274 行没有 untasked 标识/Task 行，也没有上述 5 条 untasked 的独立快照。** 只能说“Root transcript 有事件、当前 usage ledger 未见持久化”，不能据此断言所有未知 shutdown 途径永远丢失它们。
- U:L259–263、L269–273 引用当前未见顶层文件的 sessionFile，保留为来源不完整线索，不将其猜作实际最新 Root。

### 9.6 usage export 检索结果

在 `/home/tcuni/.pi` 下检索名称含 export/untasked/unattributed 的非依赖、非 `.git` 文件，未发现独立 runtime export 文件；M/N 也无实际 usage export 执行结果。M:L769 只是 Root 推荐 `/usage export` 和描述理想字段，不能当导出物。仓库 usage 相关文件为源码、测试和历史 spec，不是本次运行 export。

因此本报告**没有使用导出 statuses/linkage/breakdown 的数字**，也没有主动执行 export 命令。无法排除任意命名或被保存到本次权限范围外的导出；当前可核实的是 M/N/U/ledger/run-state/meta，而不是 B24 宿主导出验收。

## 10. 与旧 E01～E08 / RT 验收的逐项关系

| 旧主题 | 本次直接观察 | 验收边界 |
|---|---|---|
| E01 / RT-01 wait | 13/15 失败；报告稍后到 | 发生于旧 loaded；新构建 B01/B02 无派工样本 |
| E02 / RT-01 convergence | oracle 6/6 terminal，但 4/6 pending；另 1 running/recorded | 比旧场更细的分裂状态；B03/B04 仍需真实新运行 |
| E03 / RT-02 successors | T-022 pass→blocked；T-004 pass refused；successors 0/8 | 不同于旧场三次 drift 恢复链，不能套用旧失败原因；新功能未被本场 exercised |
| E04 / RT-03 envelope | report-only 1 run；T-pending partial 导致 schema-invalid；旧 normalisation 已出现 | Normalised 不是新三层 repair 已验收；B10/B11/B12 要单独重放 |
| E05 / RT-04 budget | 1/13 run hard block；四个大 Worker 无 hard=20 返回 | 工作负载和下发规则不同，不能归因于本场编写的新 RT-04 |
| E06 / RT-05 usage | T-023 120 foreign + 1 错 Task；新 N 133 historical child；untasked 有事件无 U 行 | 已有新构建归属异常正例；B17～B19 不能标通过 |
| E07 / RT-06 pipeline | 显式 oracle、无审查并行、Worker commit；git_commit 0 | B20/B21 无新构建正例；未见 B24 实际 export |
| E08 / 子运行异常 | 13/13 exit=0；清理报告 partial；2 条 supervisor progress | 进程成功、报告部分成功、验收拒绝、状态阻塞应分列 |

最值得下一轮验证的顺序：先确认真实 session/run/Task 三元绑定与 untasked 持久化，再验证同-run wait/notification/RunRecord 一致性，最后重放 report-only 修正、认可后继和自动验证/提交原语。这里列的是基于证据的验证目标，本次没有派工、调用模型、运行修复、修改代码或触碰 runtime 文件。

## 11. 可复现方法

分析使用 Python 标准库，只读 JSON/JSONL；原因是文件工具无法对嵌套 JSON 做分组、去重和时间差。运行证据统计全部离线完成，未启动新的 Pi 子运行。以下核心重算片段可直接用 `python -` 执行，不导入插件、不触发宿主：

```python
import json, re, hashlib
from pathlib import Path
from collections import Counter
from datetime import datetime

B = Path('/home/tcuni/.pi/agent')
D = B / 'sessions/--public-pi-pi-planner-only--'
M = D / ('2026-09-12T01-31-47-662Z_'
         '01a0933d-fa4e-726c-983c-4f4e039fec2e.jsonl')
def rows(p):
    return [(i, json.loads(s)) for i, s in
            enumerate(p.read_text().splitlines(), 1) if s.strip()]
def txt(x):
    c = x.get('message', x).get('content', [])
    return c if isinstance(c, str) else '\n'.join(z.get('text', '') for z in c)
def ts(x):
    return datetime.fromisoformat(x['timestamp'].replace('Z', '+00:00'))

r = rows(M)
print(len(r), hashlib.sha256(M.read_bytes()).hexdigest())
roots = []
for p in (B / 'sessions').glob('*/*.jsonl'):
    with p.open() as f:
        h = json.loads(f.readline())
    if h.get('type') == 'session' and h.get('cwd') == '/public/pi/pi-planner-only':
        roots.append((h['timestamp'], str(p), h['id']))
print('latest visible top-level', max(roots))

calls, launches, childpaths = {}, {}, {}
for i, x in r:
    m = x.get('message', {})
    c = m.get('content', [])
    for z in c if isinstance(c, list) else []:
        if z.get('type') == 'toolCall':
            calls[z['id']] = (i, x, z)
    d = m.get('details') or {}
    if m.get('toolName') == 'subagent':
        hit = re.search(r'Async delegation for task (\S+) has started', txt(x))
        if hit and d.get('runId'):
            launches[d['runId']] = (hit[1], i, m['toolCallId'])
    for co in d.get('completions', []):
        for z in co.get('results', []):
            if z.get('sessionFile'):
                childpaths[co['runId']] = z['sessionFile']
ids = set(launches)
assert len(ids) == 13
print('tools', Counter(z['name'] for _, _, z in calls.values()))

# 固定人工核对过的“同 run 报告”配对，避免把 progress 或别的 Task 算进去。
pairs = {245:249, 272:277, 311:312, 333:339, 411:415,
         434:438, 452:456, 471:475, 489:493, 508:512,
         526:532, 547:556, 552:556, 622:626}
byline = dict(r)
waits = []
for i, x in r:
    m = x.get('message', {})
    if m.get('toolName') != 'bg_wait':
        continue
    ci, cx, c = calls[m['toolCallId']]
    rid = c['arguments']['id']
    assert rid in ids
    delay = (ts(byline[pairs[i]]) - ts(x)).total_seconds() if i in pairs else None
    waits.append(txt(x))
    print(rid, ci, i, (ts(x)-ts(cx)).total_seconds(), pairs.get(i), delay)
assert len(waits) == 15
assert sum('could not be delivered' in t for t in waits) == 13

for p in (B / 'planner-only/run-state').glob('*.json'):
    d = json.loads(p.read_text())
    if d.get('runId') in ids:
        print(p.name, d['executionState'], d['ingestionState'], d.get('lastError'))
for p in (B / 'planner-only/ledger').glob('*.json'):
    d = json.loads(p.read_text())
    t = d.get('task', d)  # 必须解 wrapper
    if t.get('taskId') in {x[0] for x in launches.values()} | {'T-20260912-023'}:
        ch = t.get('usage', {}).get('children', [])
        print(t['taskId'], t['state'], len(t.get('executions', [])),
              t.get('successors'), t.get('recoveryAttempts'), len(ch),
              sum(c.get('runId') in ids for c in ch))

events = [x['data'] for _, x in r if x.get('customType') == 'planner-only-usage']
print('usage event kinds', Counter(x['kind'] for x in events))
children = [x for x in events if x['kind'] == 'child']
print('in-session events', sum(x.get('runId') in ids for x in children))
print('foreign events', sum(x.get('runId') not in ids for x in children))
tools, blocked = Counter(), []
for p in M.with_suffix('').glob('*/run-*/session.jsonl'):
    # 文件集合还需与上表13个明确 child UUID 校验，不能用于其他Root。
    for i, x in rows(p):
        m = x.get('message', {})
        if m.get('role') == 'toolResult':
            tools[m.get('toolName')] += 1
            if txt(x).startswith('Tool budget hard limit reached'):
                blocked.append((str(p), i, txt(x)))
print('child tools', tools, 'blocks', blocked)

u = rows(B / 'planner-only/usage.jsonl')
audit = [(i,x) for i,x in u if x.get('sourceTaskId') == 'T-20260912-004']
print('repair audit', len(audit),
      len({c['runId'] for _,x in audit for c in x.get('children', [])}))
print('untasked persisted', [(i,x.get('taskId')) for i,x in u
                             if 'untasked' in json.dumps(x)])
```

复核步骤补充：

1. 逐项使用第 4 节全 UUID 校验 13 个 meta、子文件、R 和 L.executions；所有计数读取完整 JSON，不对工具显示的截断字符串做解析。
2. 每次 verdict 通过 toolCallId 联结请求和返回，优先读 details.action/state/refused；ledger.reviews 只用于确认请求是否落账。
3. 费用按独立 runId 取最终完整有 costUsd 的记录；分开展示 meta.cost=0 与本地估价，不把 38 条 in-session 事件的费用当 13 次运行总价。
4. foreign 相对哪个 Root、错 Task 相对哪个 binding 必须明确；N 的 ids 集合为空，不能使用 M 的 ids 算 N 的“本场”费用。
5. JSONL 物理行和 SHA 固定本次证据边界。若 runtime 后续追加、账本被其他宿主刷新，应先比 hash，再作为新快照复算，不能静默混入本报告数字。

**最终判断：代码与测试交付、宿主加载新代码、真实契约验收是三个不同完成点。本场证实前两者发生，并暴露多层状态/归属不一致；尚不能宣告 RT-01～RT-06 的真实运行验收完成。**
