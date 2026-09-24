# 01:31 实施场与 08:11 新构建复盘：下一轮插件优化 Spec

日期：2026-09-12。状态：待实施；本文不构成宿主验收通过。

代码基线：`daf5716e90508d7ce45d0fafa4b8b2898aeea85a`（package 0.4.1）。

## 1. 结论与目标

**上一轮 RT-01～RT-06 有代码和离线测试交付，但没有全部执行到位。** 缺口同时存在于公开工具入口、状态持久化、用量导出及真实宿主验收，不能统一标成“已实施、仅待重放”。下一轮应先补齐会话归属、等待交付和裁决的端到端链路，再推进预算与流水线优化。

本次两个观察窗口必须分开：

- **M：01:31:47 实施主场**，Root `01a0933d-fa4e-726c-983c-4f4e039fec2e`。13 个子运行都由旧指纹 `5a2297482bcf` 编排；08:16 才加载新指纹，此后没有派工、wait、verdict。它提供重放输入，不能证明新修复有效或失效。
- **N：最新创建且有可见顶层 JSONL 的 08:11:28 场**，Root `01a094ab-e4f5-74d0-a6bb-642b20714178`。启动即新指纹 `10b2258e3330`；没有子派工，却回填 133 个历史 run，并全部贴上本场 sessionHint。这是新构建用量归属仍有问题的直接证据。

最新创建、最后追加事件和账本最后写回时间不是同一口径。仅在 usage 中出现、没有可见 Root 文件的 08:14/08:17 身份线索不纳入主场分母。

### 证据入口

- **[E：完整运行证据](./runtime-session-013147-2026-09-12-evidence.md)**：M/N/U 路径、快照 SHA-256、所有 Task/run 绑定、逐次 wait 配对和可复算方法。
- **[C：代码与 B01～B24 审计](./runtime-rt01-06-implementation-audit-2026-09-12.md)**：当前 HEAD 的源码坐标、测试覆盖与入口缺口。
- **[S：上一轮 Spec](./runtime-session-143619-2026-09-11-optimization-spec.md)**：RT-01～RT-06 和 B01～B24 原始契约。

下文 `M:L<n>`、`N:L<n>`、`U:L<n>` 沿用 E 的物理行号；代码坐标以 C 的 HEAD 为准。结论依据工具返回、事件和持久化记录，不依据 Root 的“已经修好”自述。

## 2. 本次基线与旧问题是否消除

| 主题 | 实际结果 | 判断 |
|---|---|---|
| Task 终态 | 8 个相关 Task：5 completed、2 blocked、1 planning；其中新建 7 个：5/1/1 | T-023 派工被拒却留下 planning；不能只统计 completed/blocked |
| E01 wait | 15 次：13 无法送达、1 done 事件确认、1 no match；首次 wait 失败 12/13 run | 全在旧构建；新 15s 宽限未被真实样本验证 |
| 同 run 通知延迟 | 13 次失败返回后报告在 0.036～8.913s 到达；9 次 <0.1s | 15s 覆盖历史延迟范围不等于竞态已修复；done 也未在正文交付完整报告 |
| 运行收敛 | 13/13 exit=0；8 terminal/recorded、4 terminal/output-pending、1 running/recorded | 4 个 oracle 通知说 recorded、Task 已完成，持久化仍 pending |
| E03 裁决 | 9 次请求；7 次 pass 中 5 accept、1 blocked、1 lifecycle 拒绝 | 本次不是旧场同一 drift 死锁；不能混称 2 次改写 |
| 后继 | 8/8 Task 的 successors=[] | 后继逻辑没有实际被验证；文字“superseded”不算结构化闭环 |
| E05 预算 | 687 个子 toolResult 中 1 个 hard block，涉及 1/13 run | 无新构建计数/拦截/批量探测，不能将下降归功 RT-04 |
| E06 Task 污染 | 无成功 execution 的 T-023 挂 121 children：120 个外场 run、1 个本场错 Task run | 必须分别验证 session 和 Task 两层绑定 |
| 新构建 E06 | N 无派工，却回填 133 个历史 run，116 条归历史 Task、17 条 unattributed | 回填到原 Task 可能正确；标成当前 sessionHint 明确不正确 |
| untasked / export | 新构建 5/5 可观察 Root 轮次有 untasked 事件；U 未见对应持久化；未找到实际 export 结果 | 事件产生有正证据，持久化/导出未通过 |

M 的 13 个独立子运行本地费用估算为 **$2.18002944**；直接相加重复 child 事件会得到 $4.33498252。T-023 错配的 121 个 run 合计 $14.35352752。M Root 原始 usage.cost.total 为 $5.94357570。这些是不同来源的本地费用口径，不是外部结算账单；N 的 Kimi cost=0 不能解释成免费。[E §9]

### 两个需要单独闭环的失败链

1. **T-022 修复任务**：文件采样折叠为 `scripts/` → 报告范围争议；实际还存在 EOF 空白 → request_changes 被路由成只读 report-only → 0 工具重发报告 → pass 被判 blocked/report-exhausted。最终脚本随 T-028 提交，但没有结构化后继闭环。[M:L249、291–323；E §7]
2. **T-004 历史账本修复**：工具返回移走 120 个独立 run，而非旧 Spec 的 79；515 是历史出现次数。更重要的是迁移审计包含原本应保留的 `7110bd1b`、`143426ad`。数量变化不能解释错误保留集合。当前 ledger 又出现这两个 run，也不能抹去历史误迁移审计。[U:L127–128；E §9.3]

## 3. 上轮落实核验

| RT | 已有能力 | 尚未执行到位的契约 | B 项处理 |
|---|---|---|---|
| RT-01 | 固定 15,000ms / 250ms 重试；recorded 清 lastError；validator 收敛分支 | 通知抢先消费时返回空内容或拒绝重复 wait；超时无 outputRef；env-less session 初始化可能锁在 unknown | B01～B04 保持开放 |
| RT-02 | successors 存储、部分归因、report-only Task 重绑 | 公开 planner_verdict 不接 acknowledgeDrift；实际应用 revalidate 仍递增 recovery；路径集合归因不能证明内容作者；导出缺 lineage | B05～B08 开放；B09 有较强本地覆盖、仍待宿主 |
| RT-03 | 可修复信封 normalizer、结构化 report-invalid、绑定 validator | raw-judged 未形成完整持久化 revision/export；本次可写修正被只读化需要入口重放 | B10～B12 开放 |
| RT-04 | 探索分类/计数 helper、contextPack schema；初始 Worker 去默认 hard20 | 无 handler 接入计数；修正 Worker 仍默认 hard20；无 readFirst 警告/宿主探测 | B13～B16 开放 |
| RT-05 | harvest 不再直接回退 active；Root 有 untasked 事件 | 当前会话被误作 foreign sessionHint；公开 export 不传 usageEntries；非派工工具 Root 绑定未齐；修复重试与保留集合不可靠 | B17～B19 开放，B19 有实际反证 |
| RT-06 | git_commit 注册；部分 read ceiling/status/breakdown | oracle 仅发 steering 消息；提交路径混入 Worker 声明、门禁/提交关联不足；read 缺省可绕过且 disabled 也受限；breakdown 证据未持久化 | B20～B24 开放 |

这张表取代 S 的“全项已实施”作为本轮规划依据，但不回写、抹除旧文档的历史观察。各缺口的具体源码和测试坐标见 C §3～6 及逐 B 项矩阵。

## 4. 下一轮方案与验收

新编号 **NX-01～NX-06** 表示本轮增量，验收编号 **C01～C18**；每项承接原 RT/B，不重新定义一套 Task 生命周期。

### NX-01：会话归属、用量持久化与可恢复修复（P0）

承接 RT-05、B04/B17～B19/B24。入口：`index.ts` harvest/message handlers、`orchestrate.ts` provenance/export、`usage.ts`、修复脚本。

**契约：**

- 每个 run 保存不可被 harvest 改写的 ownerRootSessionId、taskId、executionId 绑定；observedInSessionId 单独表示本次扫描。历史归回原 Task 与当前会话用量分开。不能把当前 provenance 当外部 run 的来源。
- session_start 完成前不得将 unknown/unknown-session 固化为最终身份；无可信来源时保持 unknown 并明确原因，不猜当前 Task。
- Root 用量以 turn 与 toolCallId 关联；覆盖 subagent、bg_wait、planner_verdict、git_audit。message_end 在 tool_call 前后的两种顺序都要支持。多 Task 轮次记录显式 shared/ambiguous 归属，禁止“取最后一个目标”。
- untasked 与 foreign 事件持久化；公开 `/planner-only usage export` 路径接入实际 usage ledger（命令以当前注册入口为准）。导出按唯一 run/turn 聚合，区分累积快照与增量，未知费用不补零当已定价。
- 以实际 binding 判断修复集合，输出保留/迁移/冲突清单。修复须保留原快照与迁移 journal，跨文件中断可恢复，重复执行不再追加同一迁移；不得用“当前场外”直接推出“相对原 Task 错配”。

**验收：**

- **C01**：重放 N（0 launch + 133 历史 meta），当前会话 child 用量为 0；原 owner 不被改写；unknown 有原因。重复扫描、重启再扫无重复记账。
- **C02**：重放 T-023 的 121 children，识别 120 个外场 + f032477d 的错 Task；T-004 的两个原 run 留在原 Task。修复中断后重跑，与一次成功结果一致且可追溯。
- **C03**：通过真实命令 handler 导出含 5 条新构建 untasked、同 run 三来源重复、外部 child 的 fixture；事件→ledger→export 数量/token/已知费用守恒。in-session tasked、untasked/shared、foreign、unknown 为互斥桶，跨桶引用不重复计费。

### NX-02：一次 wait 交付报告与状态一致收敛（P0）

承接 RT-01、B01～B04。入口：`recoverPendingRun`、notify 收据、Completion store、bg_wait adapter。

**契约：**

- 将已摄取报告作为可重取的交付结果，以 runId + reportRevision 查找；通知先到、wait 先到和重启后 exact-id 重等均返回报告或明确的真实错误，不能空 content，也不能把“已消费”当无匹配。
- 宽限默认 15s，配置位置明确；对 output present 的宿主结果优先解析其收据，不仅轮询另一路文件。宽限耗尽返回 outputRef、nextAction=retry-output-reconcile；执行失败、输出暂不可见、已摄取分别表示。
- 收据应用后联合约束 terminal/recorded、清除活跃 lastError、无 retry-output-reconcile；如保留历史错误，写独立历史字段。validator delivered 与 Root 已裁决不可混用 judged-directly 名义。

**验收：**

- **C04**：以 M 的 0.036s、8.913s 时序及边界 15s 注入，覆盖 notify-before/during/after-wait；一次 wait 返回同 revision 报告，重复 wait 幂等，无重复 usage。
- **C05**：输出永不出现、exit 非零、saved output 已存在但通知抢先消费三类 fixture，各返回正确类别；前者在配置期限后可重试并带路径，不建议重派。
- **C06**：重放 4 个 oracle pending 和 1 个 running/recorded；通过真实 adapter 持久化后重建 store，状态/报告/nextAction 仍一致，slot 仅释放一次。

### NX-03：裁决可审计、后继有证据、修正保持可写（P0）

承接 RT-02/03、B05～B12。入口：公开 planner_verdict schema、review 应用路径、Task 绑定与 Git evidence。

**契约：**

- 公开入口透传 acknowledgeDrift；review 审计同时保存 requestedVerdict、appliedDecision、refusedReason、executionId/reportRevision。拒绝也有独立审计事件，不伪造已落账 review。
- recoveryAttempts 只在真实自动复验成功派出时 +1；纯裁决改写、派工失败、重复请求均不计。修复旧测试中“stale pass 直接消耗恢复次数”的反向断言。
- 后继必须有明确关系及已完成的证据；同路径后来被外部编辑仍属 drift，不能仅靠 terminal 后继的路径并集消除。提交归因核对 C_report tree 与 HEAD 的 truth-path 内容，不只看 HEAD 前进。
- 混合“改文件 + 改报告”的 request_changes 保持可写；report-only 不覆盖原 TaskSpec。原始信封直接裁决保存新的摘要 revision、来源及其证据。
- 派工预检查失败不得留下貌似活跃的占位 Task；Task 创建和 writer reservation 有可回滚的关联，显式创建但未派工的合法 planning Task仍可保留。

**验收：**

- **C07**：通过公开工具重放“Worker→修正后继→提交”以及同路径外部编辑反例；认可变化可完成，未知编辑复验；导出 parent/successor/completionKind 完整。
- **C08**：重复 stale pass、派工拒绝、实际复验、进程恢复重试分别断言恢复增量 0/0/1/幂等；从公开事件能重算 M 的 9 请求、8 落账、1 拒绝口径。
- **C09**：T-022 混合修正、不可修复信封直接裁决、T-023 写锁拒绝走 handler 重放；前者确实执行写入修正，第二者持久化 raw-judged revision，第三者无遗留活动占位/锁。

### NX-04：把探索预算接到实际运行事件（P1）

承接 RT-04、B13～B16。

**契约：**在真实宿主先探测 read/grep/find/ls/bash 只读及批量调用的计数、提示和拦截；确定插件能观察子工具事件的接缝。若 Root handler 看不到子事件，需通过子侧适配实现，不能仅调用 Root 内存 helper。状态按 execution/run 而非 Task 累加，修正 execution 单独计量。soft 只提示一次；hard 后可产出带证据 partial。readFirst/contextPack 警告以真实探索预算计算。

**验收：**

- **C10**：保存新 loaded fingerprint 下宿主探测原始调用/结果，覆盖五类工具及批量，作为可重放 fixture；明确配置值与实际拦截差异。
- **C11**：初始和修正 Worker 均覆盖；bash cat/sed 计入探索，写操作/验证不误计，重复事件不重计，两个 execution 不串预算。
- **C12**：重放原 T-016 和本场 T-022 收尾场景；soft 一次、hard 后 partial 可摄取；contextPack 和超预算 readFirst 警告通过派工 handler 可见。

### NX-05：可验证的提交与并行交接（P1）

承接 RT-06、B20～B23。

**契约：**git_commit 仅用 Root truth 路径授权，门禁绑定当前证据 revision 和 TaskSpec，执行超时独立配置；成功记录 commit lineage。oracle 自动化需真正触发绑定 Task/revision 的只读运行，或者明确标为“建议派工”，不能将 steering 当已执行。每 revision 去重，reviewer/oracle 结果聚合一次。Root read 默认范围和显式范围均受策略限制，仅在 planner-only 启用时生效；status 按本会话/cwd 的待执行/待裁决 Task 显示，通知样板首次后简化。

**验收：**

- **C13**：git_commit handler 覆盖 truth 外 dirty、伪造 Worker validation、门失败/超时、成功提交；成功有 commit linkage、零 Worker 提交运行。push 必须有显式授权入口，否则明确报告不支持。
- **C14**：真实宿主同 reportRevision 重复通知只派一个 oracle，新 revision 可重派；与 reviewer 实际重叠；汇总包含两者结果，失败不丢失。记录 Root 工具调用数，不用消息文本代替并行证明。
- **C15**：启用/停用模式、缺省/显式 read 范围、待裁决但无运行、别的 cwd 存在 Task 都有 handler 验证；同事件集比较通知字节，并记录原始分母。

### NX-06：构建与验收证据成为发布门（P0，贯穿各批）

**契约：**每份验收记录带 sourcePath、loaded fingerprint、disk HEAD、Root UUID、runId、executionId、原始证据引用及结果。状态分为“代码完成 / handler 验证 / 宿主验证”，任一缺失不能升格。安装目录和工作区不同，reload 后须验证 loaded 身份再产生测试 run。

**验收：**

- **C16**：升级后启动新 Root，先记录 provenance，再产生至少一个可审计子运行；其 RunRecord 指纹与预期一致。只有 reload、没有新 run 的记录不通过。
- **C17**：B01～B24 每项映射到代码/handler/宿主证据或明确未完成原因，禁止仅以 helper PASS 标完；新增 C01～C15 同样纳入矩阵。
- **C18**：从冻结 fixture 重算 E 的 Task、wait、同 run 通知、裁决请求/实际、唯一 run 费用；从真实公开入口产生一次 usage export 并验证守恒，记录 schemaVersion、截止时间和缺失来源。

## 5. 实施顺序与完成定义

| 批次 | 交付 | 完成门 |
|---|---|---|
| 0 | NX-06 的构建/证据矩阵；冻结 M/N 代表事件（去敏 fixture） | C16～C18 的基础设施到位；旧新构建严格隔离 |
| 1 | NX-01 | C01～C03；先恢复度量可信度，再以 dry-run 明细执行真实修复 |
| 2 | NX-02 + NX-03 | C04～C09；一次交付、可审计裁决、可写修正、认可后继 |
| 3 | NX-04 | C10～C12；先宿主探测后策略落地 |
| 4 | NX-05 + 完整 export/验收归档 | C13～C18；保留所有未通过 B 项，不以总测试 PASS 关闭 |

每批先用现有真实 handler harness 检查公开入口和重建 store 后的状态，再在已确认新指纹的宿主运行小规模正反例。优先做“通知抢先消费”“同路径外部修改”“无派工 Root 扫历史 meta”等确定性案例，无需先启动一整场大型开发才能发现接线缺口。

门禁沿用 `npm run typecheck`、`npm test`、`PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e`、`git diff --check`。预算计数和自动并行还需真实宿主行为探测；schema e2e 不能替代。

**关闭标准：**认可成功案例中 wait 无法送达=0、非预期裁决改写=0、已知外部 run 计入当前 session=0、错 Task 归属=0、重复费用=0、untasked 持久化丢失=0。未知编辑仍应触发复验、真实验证失败仍可 blocked；不将“所有裁决一律不改写”设为无条件目标。不基于两个不同工作负载的历史场次承诺时间/费用改善百分比。

## 6. 本次实际验证与交付边界

- 读取并对齐 M/N、Task ledger、run-state、meta、usage 汇总快照；全 UUID 索引、逐行时序和重算方法见 E。
- 代码审计的 `npm run typecheck` 通过；`HOME=/tmp/opencode PI_CODING_AGENT_DIR=/tmp/opencode npm test` 通过。
- 工作区隔离的 `PI_CODING_AGENT_DIR=/public/pi/pi-planner-only/node_modules PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` 未通过：该解析路径没有 pi-subagents，宿主契约不可验证；不是已证实的兼容性失败，亦不是 release gate PASS。
- 当前记录未发现真实 usage export 产物。本次未调用 Pi 会话内命令，故不声称 unattributed 已核对通过；现有公开导出入口还存在 C 所列输入缺口。
- 本轮交付本文、E、C 三份互相引用的文档；真实 ledger 修复、插件实现、新模型运行及宿主重放属于上述后续批次。

**下一步最小可执行单元：NX-01/C01+C03。** 先把“无派工的新 Root 扫到 133 个历史 meta”及“untasked 有事件无持久化”固化成真实 handler 失败用例，修复后从公开 export 验证零本场 child 和用量守恒，再继续等待与裁决闭环。
