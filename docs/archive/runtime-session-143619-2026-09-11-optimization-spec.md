# 14:36 场运行复盘与插件优化 Spec

日期：2026-09-12

目标运行：`01a090e5-e008-716a-9705-05f01d5c11b8`（Root 会话 2026-09-11T14:36:19Z → 2026-09-12T01:16:09Z）

状态：Batch 4 已实施；RT-01～RT-06 已有代码与离线回归覆盖，以下宿主重放仍需在新构建中执行。

代码观察基线：HEAD `deffe11`（B1～B4 全部已提交，工作区干净）。**本场全部子运行都由启动时加载的旧构建执行**：M:L1082（01:12:16Z）的 status 输出没有任何 fingerprint 字段，M:L1111（01:15:16Z，用户重装后）才出现 `Plugin build: loaded=5a2297482bcf (package 0.4.1, disk HEAD deffe11fbdcc)`。因此本文的历史事件观察仍代表 **RS-01～RS-05 修复之前** 的行为；Section 3 另列当前代码已实施项与待宿主重放项。

## 1. 核心结论 / Problem Statement

本场 34 个新 Task 交付了 6 个提交和 1 次 push，实质失败的交付为 **0**；但 10 个 Task 以 `blocked` 收尾、47 次 Root 裁决中 13 次被协议改写、59 次 bg_wait 中 40 次返回"输出无法送达"、54 个子运行中 28 个撞上工具预算、退出时 79 个外部会话的子运行费用被记到了本场一个 Task 名下。**这一场的浪费几乎全部来自插件协议对 Root 的摩擦，而不是 Worker 的执行质量。** 下一轮优化目标是：让 Root 在每次派工后只需要一次等待、一次裁决；让"已交付但证据被后继任务覆盖"的 Task 能以完成态收尾；让预算、归属和用量口径不再产生假信号。

优先级建议：

| 优先级 | 编号 | 需要完成的工作 | 判定依据 |
|---|---|---|---|
| P0 | RT-01 | exact-id bg_wait 在进程终止后把报告送达 Root；oracle/validator 运行在 run-state 收敛 | 已实施（代码与单元测试）；待宿主重放 |
| P0 | RT-02 | 受认可后继（修正任务、提交任务、HEAD 前进）不再被当作 drift；Root 的 pass 不被改写为 revalidate/blocked | 已实施（代码与单元测试）；待宿主重放 |
| P1 | RT-03 | WorkerReport 信封修复而非拒绝；explorer/validator 输出可直接裁决并绑定 Task | 已实施（代码与单元测试）；待宿主重放 |
| P1 | RT-04 | 探索预算按角色与工具类别一致执行，不再只拦 read/grep | 已实施（代码与单元测试）；待宿主契约探测 |
| P1 | RT-05 | 用量归属封闭：孤儿 meta 与无任务 Root 轮次不得记入当前活跃 Task | 已实施（代码与单元测试）；待宿主重放 |
| P2 | RT-06 | 提交原语、review/oracle 自动并行交接、Root 只读上下文减负及四类 usage export 分列 | 已实施（代码与单元测试）；待宿主重放 |

RT 编号用于本次增量交付，承接 RS-01～RS-05 的验收编号（A01～A21）；新验收项编号 B01～B24。

## 2. 证据范围与口径

### 2.1 原始来源索引

以下短名在本文中固定；`L<n>` 为物理 JSONL 行号。

- **M**：`~/.pi/agent/sessions/--public-pi-pi-planner-only--/2026-09-11T14-36-19-336Z_01a090e5-e008-716a-9705-05f01d5c11b8.jsonl`（分析时 1119 行 / 2.03 MB；本文前 999 行的统计基于 01:07Z 快照，L1000 之后单独说明）
- **C/<uuid>**：M 去掉 `.jsonl` 后的目录下 `<uuid>/run-0/session.jsonl`，共 54 个子会话
- **A**：`~/.pi/agent/sessions/--public-pi-pi-planner-only--/subagent-artifacts/`，`<runId>_<agent>_meta.json`，跨会话共享，467 个文件
- **L**：`~/.pi/agent/planner-only/ledger/`，本场 Task 为 T-20260911-022 … T-20260912-021（34 个，全部 wrapped 为 `{task}` 结构）
- **R**：`~/.pi/agent/planner-only/run-state/`，本场窗口内 49 个文件，`sessionId` 全部为 `unknown-session`
- **O**：`/tmp/pi-subagents-uid-1000/async-subagent-runs/<runId>/`，143 个运行

计数只用实际工具返回、custom 事件、meta 与账本字段，不用 Root 的自述。宿主 runId、子会话 UUID、Task executionId（`tool_*` / `call_*`）是三套身份，本文用 A 中的 `transcriptPath` 与 R 中的 `runId` 关联。费用为 meta/usage 本地估算：Kimi Root 轮次 cost=0（未定价），Luna 子运行有估算值；两者不可横比。

### 2.2 对运行总结的校正

| 用户提供的线索 | 本次核实结果 | 证据 |
|---|---|---|
| run-state 本次新增 `terminalSource`、`terminalErrorClass` | HEAD 类型上存在（`completion.ts:64-65`、`orchestrate.ts:166-176`），但 106 个 run-state 文件中 **0 个** 含这两个字段；本场加载的是旧构建 | R 全量扫描；M:L1082 vs L1111 |
| T-20260912-016 做了 20 次只读 grep/read 后被截断 | 实际 21 次：grep、find×6、read×9、grep×5，第 22 次起被拦；计数器把 find 计入，但只拦 read/grep，随后 bash 与 find 仍可用 | E05 |
| 修正轮 drift → revalidate → 3 次恢复到上限变 blocked | T-026 确为 3/3；T-034、T-20260912-001 在 1/3 时就因"同一证据状态已复验"（`evidence-no-progress`）blocked。两条分支终点相同 | E03、`review.ts:608-627` |
| `node -e 'exportSessionEvidence()'` 一行导出 | `exportSessionEvidence(options)` 是纯函数，需要传入 tasks/runRecords/delegations/usageEntries（`usage.ts:1127-1136`）；实际入口是会话内命令 `usage export [rootSessionId]`（`index.ts:1687-1691`）。无参一行脚本不能工作 | 源码 |
| Root 自己的 token/cost | Kimi 段 104 轮 cost=0，Gemini 段 128 轮 $4.95；"root share 81%" 只在 Gemini 段有意义 | E06 |
| 子任务输出在 `/tmp/...` | 属实（143 个运行）；`AGENTS.md` 明示 /tmp 空间很小，saved output 依赖 /tmp 是持久性风险，本文列入 Out of Scope 提醒 | O |

### 2.3 可复核事件

**E01：exact-id wait 无法送达。** M 中 bg_wait 共 59 次：40 次返回 `the run is terminal but its saved output could not be delivered; inspect the run artifacts or re-delegate`，5 次"未终止请重试"，2 次"No active run matched"，11 次成功（全部是 oracle 运行）。40 次失败 wait 平均阻塞 223 s（说明 wait 确实等到了进程退出），随后同 Task 的 `[PLANNER-ONLY REVIEW STATE]` 通知在 **0 s（30 次）～15 s（最大）** 内到达并带全量报告。每个 Task 绑定运行的第一次 wait 无一例外失败。

| runId 前缀 | Task | wait 阻塞 | 通知延迟 | Root 后续动作 |
|---|---|---:|---:|---|
| 552a5aae | 022 | 129 s | 0 s | read output-0.log ×2 → verdict |
| 21cf2cf8 | 026 | 708 s | 0 s | 派 reviewer → verdict |
| 82334f52 | 912-009 | 839 s | 0 s | 派 oracle → bg_wait |
| aa252447 | 912-007 | 31 s | 0 s | read output-0.log ×2 → verdict ×2 |
| 1224b2e9 | 912-020 | 36 s | 0 s | git_audit ×3 → verdict |

Root 对此的自适应：5 次紧接着 `read /tmp/.../output-0.log`（全场共 8 次读该日志），7 次以 `git_audit status/head/diff-stat` 连查替代，其余等待通知到达后再裁决。R 中 35 个 `terminal/recorded` 记录全部残留 `lastError: {code: OUTPUT_PENDING}`。

源码路径：`orchestrate.ts:3576-3604` `recoverPendingRun` 在 `reconcileDelegation` 返回空而 meta 已有 exitCode 时立即返回 pending，不等待输出落盘，也不查询通知路径是否已摄取。HEAD 未改此分支。

**E02：oracle/validator 运行不收敛。** R 中 9 个 `running/waiting` 记录全部是 oracle（8e266f46、6080967a、5e077f18、b3bd944a、e6732b16、b9c19337、9d778ce2、3c3fefb4、e18f33be），对应 meta 均 exit=0，Root 的 bg_wait 均成功。另有 5 个 `unbound-validator-*` 合成 Task（M:L175、L208、L246、L470、L787），其输出 Root 只能"judge it directly"（`orchestrate.ts:4727`）。

**E03：后继覆盖导致的 drift 死锁。**

T-20260911-026（RS-01 主 Worker，12 min，报告 completed，改 4 个文件）：

| M 行 / UTC | Root 请求 | 插件裁定 | 原因 |
|---|---|---|---|
| L192 15:26 | request_changes | changes_requested | 正常 |
| — | 修正以新 Task T-031 执行（13.8 min），编辑同一批文件 | — | — |
| L263 15:54:40 | pass | revalidate（恢复 1/3） | F1 drift：T-031 改了 completion.ts/orchestrate.ts/completion.test.mjs |
| L271 15:55:08 | pass | blocked | 同一证据状态第二次裁决 → evidence-no-progress |
| L280→L293 | report-only 重绑（60a3343e）；再一次无 TaskSpec 的 report-only 派工被造成占位 Task T-033 并 blocked | — | `T-pending` 哨兵 + reportOnly 被 guard 拒绝 ×3 |
| L304 15:58 | pass | blocked | 同上 |
| L407 23:06:52 | pass | revalidate（恢复 3/3） | F3 drift：T-003 提交 d13a7b7 使 HEAD 前进、10 个文件"变化" |
| L418 / L429 23:08–23:09 | pass ×2 | blocked ×2 | recovery-limit |

账本：8 条 review 全部记录，3 条 drift finding，3 个 recoveryStates，4 个 execution（2 个 reportOnly），11 个 Root 轮次 / 90 K input。终态 `blocked`，而其成果已在 d13a7b7 中。T-034（1 次恢复）与 T-20260912-001（1 次恢复）沿同一路径 blocked，触发原因分别是后继修正 T-20260912-001/002 和提交。

规则位置：`review.ts:588-649`——`staleOverride = 无 review 或 verdict==='pass'`，凡 comparison 判定 revalidate 就把 pass 改写为 revalidate/blocked；`orchestrate.ts:4326-4329` 注释明确"A PASS over them is not eligible"。比较逻辑不区分变化来自"绑定到本 Task 的修正/提交"还是外部未知作者。HEAD 的 B2-1 提交（b7b5691）标题含 "drift lifecycle"，源码中未见 successor/superseded 概念（grep 无命中），故此项 **未处理**。

**E04：信封拒绝与再发行。** T-024（explorer 2.7 min，9 轮）与 T-029（2.7 min）的 WorkerReport 因"malformed validation entry"被整体拒绝，Task 直接 blocked（`orchestrate.ts:4660-4680`）；Root 把原文交给新 explorer T-025 / T-030 重发有效信封（各 1 轮、0 工具、0.3 min），再各记 2 次裁决。同场的通知却显示 normaliser 已能处理 `validation[].type "check" → other`。另一个 validator 输出被判"not a WorkerReport"（1 次）。T-20260912-004 在 request_changes 后被自动路由到只读修正（第二 execution reportOnly=true），Worker 报 failed，Root 只能 blocked-superseded 并以 T-006 重做。

**E05：工具预算。** 只计子会话 toolResult 以 `Tool budget hard limit reached after N tool calls (hard 20). The '<tool>' tool is blocked` 开头的返回（该文本来自宿主，不在本插件源码内）。

| 指标 | 值 |
|---|---:|
| 拦截总数 / 涉及运行 | 87 / 28（共 54 运行） |
| 被拦工具 | read 54、grep 33；find/ls/bash 0 |
| 首次拦截位置 | 全部为第 21 次调用之后（after 21…31，hard 20） |
| 拦截后仍继续的 Worker | 5c4589a5：153 次调用，其中 bash 104（cat/sed/head 23，grep 类 14）；24253ba0：97 次，bash 37（读类 16） |
| T-016 (C/c0296223) | 5 轮 29 次：grep, find×6, read×9, grep×6（第 22 次起被拦）, bash, read×6（被拦）→ 报 blocked，exit 1 |

T-016 的 instructions 要求"Read first"两段 spec 加 `floors.ts`、`usage.ts`(1426 行)、`completion.ts`、`orchestrate.ts`(4795 行)、`test-fixtures.ts`——20 次 read 不足以读完一个文件。HEAD 的 `floors.ts:300-311` 已让初始 Worker 不带工具 floor、`floors.ts:275` 增加 soft=ceil(0.8×hard) 且 `advisoryOnly=true`；本场旧构建下初始 Worker 仍被 hard 20 拦截，新行为宿主未验证。

**E06：用量归属。**

- M:L1003–L1081（01:10:36Z，全部同一秒）：79 条 `kind=child, source=meta-file` 事件记入 T-20260912-004，runId 无一属于本场（meta 时间戳 2026-09-11T06:24Z ～ 2026-09-12T01:00Z，含 12:25 场的 Kimi 403 运行 ab905e46、104 轮 Worker 04164888），估算 costUsd 合计 11.33。L 中 T-004 的 `usage.children` 已被污染。机制：`index.ts:1150-1157` `session_shutdown` → `flushOpenUsageOnShutdown` → `harvestOrphanMetas`（`index.ts:690-716`）扫描共享 A 目录，凡账本没见过的 runId 一律记入 `store.active()?.taskId ?? "unattributed"`。
- root-turn 归属：`usage.ts:513-523` 用"当前活跃 Task"。本场前 15 个 Root 轮次（14:36–14:41，此时尚无新 Task）记入上一场的 T-20260911-013；23:34 之后所有无派工的 Root 轮次记入 T-004（35 轮、736 K input），而 T-004 当时并无工作。
- Root 段费用：Gemini 段 128 轮 $4.95，input 3.78 M、cacheRead 26.2 M；Kimi 段 104 轮 cost=0。

**E07：流水线形态。** 54 个运行 = worker 24 + reviewer 15 + oracle 15（含 5 个 unbound）。最大并发 2，处于并发 2 的时间 9 min、并发 1 共 169 min，Root 活跃约 240 min 中约 65 min 没有任何子运行。仅有的 7 对重叠全部是 reviewer×oracle（≤97 s）。7 个 Task（003/008/011/015/018/020/021）只做 `git commit`/`push`，每个各占 1 次 Worker 运行 + 3 个 Root 轮次 + 1 次裁决。Root 工具结果字节：read 151 KB（orchestrate.ts ×10、index.ts ×9、output-0.log ×8）、subagent 131 KB、custom 通知 64 条 138 KB、planner_verdict 53 KB。

**E08：子运行异常。** C/309d00d8 两次 `OpenAI API error (502)` 自行重试成功；C/880eaa39（T-023 Worker，16 min，124 次调用）在 `need_decision`（发现并发外部编辑）后被 `terminated`，报告 partial。子运行 `contact_supervisor` 7 次（progress_update 5、need_decision 2），Root 以 `subagent_supervisor` 回复 2 次。

## 3. 当前实现核查

| 编号 | 源码位置 | 已有实现及剩余缺口 | HEAD 状态 |
|---|---|---|---|
| S01 | `orchestrate.ts` | exact-id wait 宽限送达与 terminal/recorded 收敛 | 已实施；单测通过，宿主重放待执行 |
| S02 | `completion.ts` | recorded 后清除 lastError、保留错误历史 | 已实施；单测通过，宿主重放待执行 |
| S03 | `orchestrate.ts` | validator/oracle 收据进入 terminal/recorded 或 judged-directly | 已实施；单测通过，宿主重放待执行 |
| S04 | `review.ts`, `orchestrate.ts` | 后继与提交归因、裁决保真及有界恢复 | 已实施；单测通过，宿主重放待执行 |
| S05 | `orchestrate.ts`, `task.ts` | report-only 继承 TaskSpec，不生成占位 Task | 已实施；单测通过，宿主重放待执行 |
| S06 | `orchestrate.ts`, `report.ts` | WorkerReport 信封修复与直接裁决 | 已实施；单测通过，宿主重放待执行 |
| S07 | `floors.ts`, `orchestrate.ts` | 探索预算按工具类别执行，并向 Root/Worker 提供收尾提示 | 已实施；rt04 单测通过，宿主契约探测待执行 |
| S08 | `index.ts`, `usage.ts` | 孤儿 meta 与 Root 轮次封闭归属 | 已实施；单测通过，宿主重放待执行 |
| S09 | `usage.ts`, `index.ts` | Root 轮次按调用绑定，空闲时 untasked | 已实施；单测通过，宿主重放待执行 |
| S10 | `git-audit.ts`, `index.ts` | 独立 policy-governed `git_commit`，只提交 completed Task truth paths 并执行门禁 | 已实施；RT-06 单测通过，宿主重放待执行 |
| S11 | `orchestrate.ts` | sessionId 从 provenance/环境恢复，避免跨会话归属 | 已实施；单测通过，宿主重放待执行 |

本次执行的离线核对：以 M 的每次 bg_wait 调用/返回时间戳与其后第一条 custom_message 时间戳相减，得到 E01 的通知延迟分布；以 A 的 `timestamp` 与 M 的派工返回时间计算 E07 的并发直方图；均为纯记录比对，未运行模型。

## 4. Solution

Root 在一次派工之后应只需要：一次 `bg_wait id=<runId>` 拿到报告或明确的终态错误；一次 `planner_verdict` 记录结论，且结论按请求落账。当 Task 的证据被本 Task 认可的后继（修正任务、提交任务、HEAD 前进）覆盖时，Task 以"完成，已被后继取代/已提交"收尾，而不是 blocked。预算、归属、用量只描述本会话、本 Task 确实发生的事；不能描述的记为 unattributed/unknown。

实施沿用现有 Orchestration、CompletionReceipt/RunRecord、Review、Usage 与 floors 模块；不新建生命周期。所有验收先在确认 loaded fingerprint 的宿主中重放本场事件，再以离线 fixture 固化。

## 5. User Stories

1. 作为 Root，我希望 exact-id bg_wait 在子进程退出后直接返回报告，而不是让我去读 /tmp 日志。
2. 作为 Root，我希望 oracle 运行结束后 run-state 与账本同时收敛，status 里不再有永远 running 的 oracle。
3. 作为 Root，我希望在修正任务或提交任务之后，对原 Task 记 pass 就能完成它，而不是被改写成 revalidate 三次后 blocked。
4. 作为 Root，我希望 report-only 重绑只需 taskId，不需要重新粘贴 TaskSpec，也不会生成占位 Task。
5. 作为 Root，我希望 explorer 的报告只是 validation 字段格式不对时，插件替我修好而不是让我再派一个 explorer 重发。
6. 作为 Root，我希望给 validator 指定 taskId 后它的输出绑定到该 Task，不产生 unbound-validator。
7. 作为 Worker，我希望预算限制的是"探索"这件事，而不是只禁 read/grep 让我改用 bash cat。
8. 作为 Worker，我希望在接近上限时收到明确的收尾提示，并能提交带证据的 partial。
9. 作为操作者，我希望退出会话时不会把别的会话的费用记到我当前的 Task 上。
10. 作为操作者，我希望 Root 在没有处理任何 Task 时的轮次记为 untasked，而不是记到上一场的某个 Task。
11. 作为 Root，我希望接受后的提交是一个受策略约束的原语，而不是再派一个 Worker。
12. 作为 Root，我希望 Worker 报告到达后 reviewer 与 oracle 自动并行，而不是我串行等两次。
13. 作为维护者，我希望导出的会话证据能把"被后继取代""信封被修复""预算拦截""外部费用"分列，不与失败混计。

## 6. Implementation Decisions 与验收要求

### RT-01：等待送达与运行收敛（P0；承接 RS-01 A02/A04）

**契约**

- exact-id wait 在 meta 出现 exitCode 后进入有界宽限：按固定间隔重试 `resolveDelegationOutput` 直到输出可读、或通知路径已把同 runId 摄取为 recorded、或宽限耗尽（设计值 15 s，可配置）。宽限内摄取成功即返回与 notify 相同的报告内容与 REVIEW STATE。
- 通知路径先于 wait 摄取时，wait 返回"已通过通知摄取（reportRevision n）"并附报告，不返回 pending。
- 宽限耗尽才返回 pending，且 `nextAction` 只允许 `retry-output-reconcile`，不得建议 re-delegate；同时把 `outputRef` 与 O 目录路径写入返回文本。
- `ingestionState` 进入 `recorded` 时清除 `lastError`；仍需保留历史则移入 `lastErrorHistory`。
- validator/oracle 运行走同一收据路径：终止即 `terminal`，输出被 Root 直接裁决时 `ingestionState=judged-directly`（新增枚举），不得停留在 `running/waiting`。
- 无 `PI_SESSION_ID` 时，sessionId 取 loaded provenance 的 sessionId 或 M 文件名中的会话 UUID；`unknown-session` 仅在两者都不可得时使用。

**验收**

- **B01**：重放 E01 的 552a5aae（通知延迟 0 s）与 37b76b37（15 s）两条时序，exact-id wait 一次返回报告；run-state 为 `terminal/recorded` 且无 `lastError`。
- **B02**：输出永不落盘的注入场景，wait 在宽限后返回 pending，nextAction=retry-output-reconcile，文本含 outputRef；重复 wait 幂等。
- **B03**：E02 的 9 个 oracle runId 重放后 run-state 全部 terminal；status 输出中 oracle 不再显示 running。
- **B04**：设置/不设置 `PI_SESSION_ID` 两种启动，run-state 文件名与 sessionId 字段都不再是 `unknown-session`（除非 provenance 也不可得，此时记 unknown 并在 status 中警示）。

### RT-02：后继关系与裁决保真（P0；承接 RS-02 A07/A08）

**契约**

- Task 记录 `successors[]`：修正任务（由 request_changes 派生，绑定 parentTaskId）、提交任务（TaskSpec 声明 `commitOf: <taskId>` 或 Root 用 RT-06 原语提交）、以及 Root 在 verdict 中显式声明的 `acknowledgeDrift: {successorTaskId | commit}`。
- 比较逻辑对 drift 路径做作者归因：变化路径 ⊆ 某后继 execution 的 truth 路径，或 HEAD 前进且工作树干净且 `git diff <C_report tree> HEAD -- <truth paths>` 为空，则记为 `superseded`/`committed`，不是 drift；仍产生 finding，但 kind 为 `superseded`，不触发 revalidate。
- 只有作者不明的变化才走现有 stale→revalidate→blocked 路径。Root 的 pass 带 `acknowledgeDrift` 且引用的后继已 completed 时，直接 completed，`completionKind=superseded|committed`；不带时保持现行保守行为。
- 被协议改写的裁决（pass→revalidate/blocked）不消耗 `recoveryAttempts`；恢复计数只由实际派出的自动复验消耗。
- 全部 review 为 pass 且无未解释变化的 Task 不得以 `blocked` 收尾；若仍不能 completed，收尾状态为新增的 `closed-superseded`，导出时与 blocked 分列。
- report-only 重绑只需 `taskId`（或别名）+ `reportOnly: true`，插件从原 execution 继承 TaskSpec；`T-pending` 与 reportOnly 组合直接拒绝并给出正确用法，不造占位 Task。

**验收**

- **B05**：重放 T-026 全链（Worker→T-031 修正→T-003 提交），Root 在 L263 与 L407 的 pass 分别以 superseded、committed 完成，总裁决 2 次，recoveryAttempts=0，无占位 Task。
- **B06**：同一场景注入一条不属于任何后继的外部编辑，仍触发 revalidate；复验通过后 completed。
- **B07**：T-034 → T-20260912-001 → 002 的两级修正链，三者最终都非 blocked；导出中三者互相引用 successor/parent。
- **B08**：13 次改写裁决各一条 fixture，改写前后 `recoveryAttempts` 不变；仅自动复验派出时 +1。
- **B09**：report-only 仅传 taskId 的入口重放 60a3343e/cc57bea4，成功重绑；传 `T-pending`+reportOnly 被拒且账本无新 Task。

### RT-03：信封修复与直接裁决（P1）

**契约**

- WorkerReport 解析分三级：schema 合法 → 直接摄取；可修复（validation 条目缺 type/ command、changedFiles 为字符串、status 别名等）→ 修复后摄取并在通知中列出修复项；不可修复 → 保留原文，Task 进入 `report-invalid` 但 **不 blocked**，Root 可对原文直接 `planner_verdict`（pass/request_changes/blocked 皆可），裁决时把原文摘要作为 report revision 记录。
- validator 派工携带 taskId 时，其输出绑定到该 Task 的 execution（kind=validator），不生成 `unbound-validator-*`；无 taskId 才用合成 id。
- request_changes 之后的修正派工默认可写；只有 Root 显式 `reportOnly` 或 Task 处于报告修正（`report_correction`）时才只读。自动路由到只读时通知必须说明原因与解除方式。

**验收**

- **B10**：T-024/T-029 的原始输出（A 中 saved output）重放，两者在修复级摄取；不再需要 T-025/T-030。
- **B11**：构造不可修复信封，Root 直接 pass 后 Task completed，导出中 `reportSource=raw-judged`。
- **B12**：带 taskId 的 validator 输出绑定到 Task；导出无 unbound 记录；T-004 场景下修正派工为可写。

### RT-04：探索预算一致执行与收尾（P1；承接 RS-04 A15～A17）

**契约**

- 先在真实宿主做契约探测并写入文档：计数器包含哪些工具、拦截哪些工具、批量调用如何计数。当前观测：计数全部工具，只拦 read/grep。
- 插件侧把预算语义改为"探索预算"：受计的工具集 = read/grep/find/ls + bash 中的只读模式（cat/head/tail/sed -n/rg/grep），由插件在 toolResult 侧统一计数并注入 soft 提示；宿主 hard 拦截保留为兜底，但插件下发的 hard 值按角色设定，不再对 Worker 下发 20。
- soft 触发时注入一次收尾提示（剩余额度、未完成项、partial 模板）；hard 触发后插件在下一轮注入"仅允许 edit/write/bash 非读命令 + 最终报告"。
- TaskSpec 新增 `contextPack`：Root 或前序 explorer 已确认的文件片段（路径+行范围+内容摘要）随 instructions 下发，Worker 不需再探索即可定位；`readFirst` 列表超过预算的 60% 时派工前警告 Root。
- 预算拦截 run 必须产出可解析 partial（B4-1 checkpoint 契约），并在导出中与进程失败分列。

**验收**

- **B13**：宿主契约探测输出文档化（计数/拦截/批量三项），并作为 fixture 固化；与本场 87 次拦截的分布一致。
- **B14**：重放 C/5c4589a5 的调用序列，bash cat/sed 被计入探索预算；Worker 角色 hard 不为 20；soft 提示恰好一次。
- **B15**：重放 T-016：带 contextPack 的同一 TaskSpec 在 20 次探索内产出非 blocked 报告；不带时派工前出现预算警告。
- **B16**：hard 触发后仍能交付含证据引用的 partial（沿用 A17），run-state 为 terminal/recorded。

### RT-05：用量归属封闭（P1；承接 RS-05 A20）

**契约**

- `harvestOrphanMetas` 只处理本会话派出的 runId（Delegation 记录或本会话 M 目录下存在 transcript）；其余 meta 记入 `unattributed`，并附 `sourceDir`、`metaTimestamp`、`sessionHint`（从 transcriptPath 推断）。
- 任何自动归属都不得使用 `store.active()`；活跃 Task 只用于展示。
- root-turn 归属改为工具调用绑定：本轮调用了 subagent/bg_wait/planner_verdict/git_audit 的 taskId → 归该 Task；否则 `untasked`。会话启动后首个派工之前的轮次一律 untasked。
- 会话内 `usage`/`usage export` 分列 in-session、foreign(unattributed)、untasked，并给出每类的估算来源；账本 `usage.children` 记录 `sessionId`。
- 提供一次性修复命令，把已污染的 T-20260912-004 中 79 条外部子运行移到 unattributed（保留原记录审计）。

**验收**

- **B17**：重放 01:10:36Z 的退出流程，T-004 新增 child 记录为 0，unattributed 记录 79，各带 sessionHint。
- **B18**：本场前 15 个 Root 轮次重放后归 untasked；T-013 用量不变。
- **B19**：`usage export` 输出中 in-session/foreign/untasked 三列之和等于全部条目；T-004 修复后 `usage.children` 仅含 7110bd1b、143426ad 与其 validator。

### RT-06：流水线形态与 Root 上下文（P2）

**契约**

- 新增 Root 侧受策略约束的提交原语（`git_audit` 同源，独立工具名如 `git_commit`）：只能提交某个 completed Task 的 truth 路径，提交信息必须引用 taskId，前置门（typecheck/test）由 TaskSpec 声明并由插件执行或引用最近 oracle 结果；push 同理需显式 `allowPush`。不满足则拒绝，不派 Worker。
- Worker 报告到达且 `validation.required` 时，插件可按策略自动并行派出 oracle（绑定 Task），Root 只需等待一次汇总通知；reviewer 派工不阻塞 oracle。
- planner-only 模式下 Root 的 `read` 默认限制行范围（如 ≤200 行），超限提示改派 explorer；通知中"Limits/Report normalised"样板只在首次出现，后续引用。
- 状态输出的"当前 Task"不再回退到上一场的非终态 Task（E06 中 T-028 长期 `reviewing`），而是明确"无活跃 Task"。

**验收**

- **B20**：重放 B1～B4 的 6 次提交，全部由提交原语完成，0 次 Worker 运行；错误路径（truth 路径外有 dirty、门失败）被拒绝并说明。
- **B21**：Worker 报告到达后 oracle 自动派出并与 reviewer 重叠；Root 在该 Task 上的裁决前工具调用 ≤2。
- **B22**：Root 读取 orchestrate.ts 超范围被提示；通知字节在同等事件数下下降（以本场 138 KB 为基线记录，不承诺百分比）。
- **B23**：无活跃 Task 时 status 不显示上一场 Task。
- **B24**：`usage export` 新增分列：superseded/committed 完成数、信封修复数、预算拦截 run 数、foreign 费用；对本场重放得到 3/2/28/79。

## 7. Testing Decisions

首选现有宿主适配 → Orchestration 的高层接缝，注入可控的 meta 文件、saved output 落盘时序、通知事件、Git 采样与时钟；预算部分先做宿主契约探测再写断言。纯函数测试只用于比较逻辑与信封修复的边界。

参考 `index.test.mjs` 的真实 handler harness、`completion.test.mjs` 的持久化故障注入、`rs01.test.mjs`/`rs02.test.mjs` 的事件重放、`usage.test.mjs` 的归属测试，以及 `e2e.pi-subagents.test.mjs` 的公开契约检查。

实施门禁沿用：

```text
npm run typecheck
npm test
PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e
git diff --check
```

并在 `Plugin build: loaded=<新指纹>` 的宿主中重放 B01～B24 适用场景。本场遗留的 A01～A21 宿主验收同样尚未执行，应与本轮合并为一次宿主验收；旧构建下得到的任何"通过"不得计入。

本次文档任务只做了记录结构化比对、源码定位与两项离线时序计算；未运行上述门禁或任何模型。

## 8. 分批实施与完成定义

| 批次 | 内容 | 完成门 |
|---|---|---|
| 1 | RT-01 + RT-05（含 T-004 修复命令） | B01～B04、B17～B19；先止血送达与归属，因为它们直接污染后续所有度量 |
| 2 | RT-02 | B05～B09；需要 RT-01 的 recorded 语义稳定 |
| 3 | RT-03 + RT-04 | B10～B16；预算部分先交付契约探测文档 |
| 4 | RT-06 + 导出分列 | B20～B24；提交原语、自动 oracle 交接、Root read ceiling、无陈旧 status、四类 usage breakdown | 已实施；rt06 单测通过，宿主重放待执行 |

度量基线（本场，旧构建）：每个被接受目标的 Root 轮次、每次派工的 wait 次数（本场 59/54 ≈ 1.1，其中 68% 未送达）、裁决被改写率（28%）、以 blocked 收尾但成果已交付的 Task 数（10）、预算拦截 run 占比（52%）、foreign 费用条数（79）。确定性验收要求：wait 无法送达=0、改写裁决=0、成果已交付却 blocked=0、foreign 归属=0；不基于本场承诺时间或费用百分比。

## 9. Out of Scope

- 本文交付 spec，并记录 RT-01～RT-06 的代码/单测状态；真实 ledger/run-state 不在本文中清理。
- 不改变默认并发上限与 writer 互斥策略；RT-06 的并行只涉及只读的 reviewer/oracle。
- 不替换宿主的工具预算机制，只在插件侧补齐语义与提示；宿主计数规则的变更留待上游。
- 不迁移 saved output 出 /tmp；但应记录 `AGENTS.md` 对 /tmp 空间的约束，作为后续宿主配置项（`asyncDir`）评估依据。
- 不评价 Kimi/Luna/Gemini 模型质量；本场三段模型不可比。
- 不重做 RS-01～RS-05 已在 HEAD 的实现；其宿主验收与本轮合并执行。

## 10. Further Notes 与关联规格

- [12:25 场复盘与 RS-01～RS-05](./runtime-session-122554-2026-09-11-optimization-spec.md)
- [运行可靠性 Spec：RR-01～RR-10](./runtime-reliability-2026-09-11-spec.md)
- [Task 身份与 TaskSpec 修复：IS](./runtime-identity-and-spec-repair-2026-09-11-spec.md)
- [默认安全并行：CP](./default-safe-concurrency-2026-09-11-spec.md)
- [07:57 场优化审计：O-01～O-07](./runtime-optimization-audit-2026-09-11.md)

后续实施票引用 RT 编号与 B 验收编号。本场的关键事实是"所有观测来自旧构建"：实施前应先在新构建上跑一场同规模的基线（同一组目标、同一并发设置），把 E01～E08 中已被 B1～B4 消除的项从本 spec 中划掉，再按第 8 节分批。
