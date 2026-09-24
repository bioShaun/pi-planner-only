# 12:25 场运行复盘与插件优化 Spec

日期：2026-09-11

目标运行：`01a0906e-7b39-716c-ae11-3e903f249b4f`

状态：spec-ready；以下验收要求尚待实施/重放

代码观察基线：HEAD `7544cc3` + 本次开始时已存在的工作区修复（package 0.4.1），不是纯 HEAD 快照。

收尾时发现另一运行已将上述既有修复提交为 `df40efe`（`feat(runtime): close batch identity concurrency and evidence fixes`），工作区仅余本文未跟踪。本次分析未执行该提交；提交存在仍不证明常驻Pi进程已加载新构建。

## 1. 核心结论 / Problem Statement

本场最需要优化的是 **让运行结果、归属证据与实际加载版本形成可核验的闭环**。当前工作区已经包含身份分配、TaskPacket、Completion、并发与 O-03～O-05 的修复，不能继续把旧审计中的所有待办当成尚未实现；也不能把 Worker 的交付或 Root 的 accept 当成新插件已在常驻宿主生效的证明。

优先级建议：

| 优先级 | 编号 | 需要完成的工作 | 判定依据 |
|---|---|---|---|
| P0 | RS-01 | 运行版本可识别，身份与终态摄取在真实宿主中收敛 | 已退出运行仍 running/waiting；六个运行在启动时即 report-invalid；现有修复缺加载版本证明 |
| P0 | RS-02 | O-03 从摄取到 verdict 使用同一归属规则，并守住并发准入 | 当前验收重算漏传 readOnly；正式入口关闭 workspace 检查 |
| P1 | RS-03 | 模型与 thinking 按字段来源解析，预测与启动参数分离 | host-default model 反写已修，thinking 反写及错误预检对象仍有缺口 |
| P1 | RS-04 | 工具预算可见、分阶段收尾、可恢复中间成果 | 12 个运行触发 36 条实际 hard20 拦截，工具拦截不等于进程终止 |
| P1 | RS-05 | 统一现场回归、证据导出和完成口径 | 混合 ledger、重复事件、旧 verdict 会污染成功率和优化判断 |

RS 编号用于本次增量交付，关联既有 IS/RR/O/CP，不另建一套相互竞争的生命周期。

## 2. 证据范围与口径

### 2.1 原始来源索引

以下短名在本文中固定；`L<n>` 为物理 JSONL 行号，普通 JSON 使用字段名定位。

- **M**：`/home/tcuni/.pi/agent/sessions/--public-pi-pi-planner-only--/2026-09-11T12-25-54-745Z_01a0906e-7b39-716c-ae11-3e903f249b4f.jsonl`
- **C/<uuid>**：M 去掉 `.jsonl`，追加 `/<uuid>/run-0/session.jsonl`。
- **A**：`/home/tcuni/.pi/agent/sessions/--public-pi-pi-planner-only--/subagent-artifacts/`，产物以宿主 runId 命名。
- **L**：`/home/tcuni/.pi/agent/planner-only/ledger/`。
- **R**：`/home/tcuni/.pi/agent/planner-only/run-state/`。

研究观察窗口约为 14:13–14:19 UTC，源会话仍有追加，以下全量统计限于当时发现的 16 个子会话。账本是观察时快照，不是历史每个时刻的状态。引用实际工具返回、模型错误、产物和源码，不将模型思考或 Root 总结作为事实计数。

宿主 runId 与子会话目录 UUID 是两个身份，须通过收据的 sessionFile 关联。前一份 [运行优化审计](./runtime-optimization-audit-2026-09-11.md) 研究的是 **07:57 场**，其“34 次 wait”“27 次预算拦截”等数字不能混入本场。

### 2.2 对运行总结的校正

| 用户提供的线索 | 本次核实结果 | 证据 |
|---|---|---|
| 七次只读 undeclared 误报 | 本场新建 finding 为 **4 个 execution**；另有历史 finding 回显、同一执行再次裁决 | E01 |
| 两次 hard20 导致退出 partial | **12 个 run、36 条实际拦截**；这些 run 的 meta exitCode 均为0，报告有 completed/partial；被禁工具不等于进程被杀 | E02 |
| 一次 Kimi 403 | **两个独立运行**发生五小时限额403，均 exit1 | E03 |
| 001～014 都是本场新任务 | 其中仅009的 createdAt 在本场；其余有早于本场的身份/状态，部分 spec.cwd 指向其他项目 | E04 |
| 新增锁与 claim 当前留在 ledger | 观察时未发现 lock/claim 实物；不能据此推断历史未创建，也不能将 running 状态当作野锁 | E04 |
| O-03、模型反写已经彻底消除 | 当前源码有修复，但缺修复后缺省模型及读写重叠宿主回放；另有可定位的剩余代码缺口 | E05、S01～S04 |

### 2.3 可复核事件

**E01：只读误归属。**

| M 行 / UTC | Task | runId | 判别 |
|---|---|---|---|
| L51 / 12:32:41.256 | 001 | `baa3c241-1f9f-4fcb-bb1b-3dd4c9cb9f23` | orchestrate.ts finding 的 detectedAt=09:53:24.890，属于历史回显 |
| L83 / 12:42:48.621 | 004 | `801f40d3-08d7-4c9c-aadf-9cad60107273` | 新 finding：task.ts；L87 是同 finding 重现及新增 drift |
| L542 / 13:22:58.424 | 009 | `2f084856-0be7-4067-8919-bae1b70e3164` | 新 finding：task.ts/types.ts |
| L547 / 13:23:08.649 | 010 | `856510f9-7e42-4f0b-9e2b-37ece84ffdf2` | 新 finding：18路径；通知 state=completed、decision=report_correction |
| L569 / 13:34:30.193 | 012 | `ece875b9-ce14-4a20-824c-ed1f368e8424` | 新 finding：10路径；state=completed、decision=blocked/report-exhausted |

L83 同时要求 `Revert undeclared paths` 和 `Do not modify files`，指引互相矛盾。对应只读子会话工具轨迹只有 ls/find/grep/read，未见 bash/edit/write；后面三个研究任务与写任务时间重叠（M:L527–537、L560–564）。这强支持“将窗口变化强归给只读执行”，但没有文件系统作者审计，不能逐路径断言具体 writer。Root 在 M:L544/L549/L571 所说的“第五/六/七次”不是去重统计。

**E02：预算拦截。**只计 toolResult 文本以 `Tool budget hard limit reached` 开头的运行时返回；以下子 UUID 前缀在本场目录唯一。

| C UUID 前缀 | 被拦物理行 | 条数 |
|---|---|---:|
| 557ee6be | 37 | 1 |
| 7f6f34c2 | 39 | 1 |
| a7f12b58 | 41、42 | 2 |
| dfacf32b | 37、39 | 2 |
| 1b6b7461 | 31、32、42、43 | 4 |
| 7a15f015 | 30 | 1 |
| 3e711f6d | 31～36 | 6 |
| ab3ffc7c | 31～35 | 5 |
| 339ff9bf | 32～36 | 5 |
| 293a8707 | 33～37 | 5 |
| 88ecfa6d | 32～34 | 3 |
| 27e93913 | 34 | 1 |
| 合计 | 12 run | **36** |

开场两个 reviewer 各提出21次工具调用，第21次被拦，最终文本 completed、meta exit0。T004 的 C/`dfacf32b-4738-4b18-8050-5ca4fcb457cf`:L37/L39 分别在第21/22次被拦，L40 返回 partial、meta exit0。CP Worker C/`293a8707-39bb-4635-ad7e-3a9988c01dd8` 总共提出121次工具调用，L230 返回 partial。因此 hard20 不是所有工具统一停止的可靠描述；宿主具体计数/豁免规则需单独做契约探测。

**E03：Kimi 限额。**

| C 错误位置 / UTC | runId | input / output / cacheRead | turns / exitCode |
|---|---|---|---|
| `9fe4853c-6224-44d0-9f53-cf2d3f6dfcd4`:L36 / 12:46:00.926 | `ab905e46-ba0c-4c2c-89f2-193ab19d308a` | 15,029 / 2,799 / 84,224 | 11 / 1 |
| `b2c37a2b-73b4-46e1-b6d3-f324d80d7e40`:L130 / 12:46:03.211 | `e8d59a89-5746-4501-896b-9448067c1bd5` | 126,843 / 45,612 / 4,462,080 | 55 / 1 |

两者 stopReason=error、403 permission_error 明确为 five-hour usage limit。数量来自各 run 的 meta.usage；首代 A 的55 turns不同于70次工具调用。meta.cost 是本地记录，部分 Luna meta.cost=0 而 ledger 有非零估算，不可作为结算费用横比；也不能证明账号额度全部由本场消耗。

**E04：混合账本与未收敛运行状态。**

- 001～014 当前状态计数为7 completed、4 blocked、3 changes_requested，仅是混合快照分布，不是本场成功率。目录实际还存在015～021。
- `R/unknown-session-_public_scripts_tc-probe-design-v2-tool_CoQV87XTKn7GQ64ZggXPJDm6.json`：runId=`e8d59a89…`，executionState=running、ingestionState=waiting，updatedAt=12:28:21.093；原子会话12:46:03已403退出。workspaceId亦与本场子执行工作区不符。
- `R/unknown-session-_public_pi_pi-planner-only-call_176444.json`：runId=`9bef983d-31bb-40c4-8b57-3fffa096c667`，启动时13:20:35.109即 terminal/report-invalid、REPORT_SCHEMA_INVALID；M:L550在13:32:13.589才实际送达 completed 报告。
- 同形态启动时错误记录还有 `call_154313`、`call_141608`、`call_191425`、`call_280102`、`call_191504`，合计六个本场 run。不能用旧 task.completed 掩盖 ingestionState。
- 观察时 planner-only 持久目录递归未见 lock/claim 名称或非空相关状态字段；这不证明旧进程已经使用当前分配器。

**E05：模型反写链。**M:L30/L34/L60/L74/L89 下发参数未指定 model，实际子会话/meta 却为 Kimi；M:L42读取的磁盘 defaultModel 与 worker/reviewer override 为 Luna。M:L442读取到旧代码无条件写 `inputRecord.model/thinking`；M:L450显示 defaultModel来自Root context、source=host-default；M:L250读取宿主代码显示输入 model 进入 explicitModel。该链强支持反写覆盖宿主 override，但未逐次捕获最终 payload 来源，磁盘配置也不代表宿主当时内存配置。修复 Worker 及之后多轮（M:L467/L487/L527等）显式指定 Luna，故这些成功不能验收缺省 override 路径。

## 3. 当前实现核查

以下为代码阅读时位置；行号用于定位证据，不是实施要求中的固定模块布局。

| 编号 | 源码/测试位置 | 已有实现及剩余缺口 |
|---|---|---|
| S01 | `evidence.ts:1258–1471`；`evidence.test.mjs:1225–1238` | 已新增三类路径，readOnly=true时不生成归属 finding；新增专项测试只直接调用纯比较函数 |
| S02 | `orchestrate.ts:1392–1437,1469–1563` | 摄取仅按 execution.kind=explorer传readOnly；验收重算完全未传。reportOnly原窗口与当前执行能力还需统一，不能按修正执行的只读性洗掉原Worker变更 |
| S03 | `orchestrate.ts:1818–1862`；`role-models.ts:180–231` | host-default model不反写已有；但 model source=explicit时仍写从hostThinking推得的thinking。缺省预检查Root模型而非宿主真正选中的child override |
| S04 | `role-models.ts:205–213`；`orchestrate.ts:1801–1853` | 完全没有registry context时warn-and-continue；registry对象存在但读取抛错时返回unverified，Orchestration却block，降级语义不一致 |
| S05 | `index.ts:673–705,1068–1085` | bg_wait现已registerCompletionReceipt，不能沿用07:57审计“完全未接收据”的结论；本场旧运行状态仍需要真实宿主接线/reload验收 |
| S06 | `roles.ts:293–324`；`floors.ts` | 当前下发hard限额及__floorLimits；未形成有宿主能力证明的阶段式收尾协议。预算变换还有将对象重建为hard-only的行为，应核对soft等有效字段保真 |
| S07 | `index.ts:210–212`；`concurrency.ts:139–155` | 正式入口构造controller时enforceWorkspace=false，跳过其读写冲突检查；writer互斥仍依赖既有锁。与CP第一阶段同worktree读写串行要求不一致，不能以controller默认测试替代入口验收 |
| S08 | `roles.ts:214–324`；`role-models.ts:150–177` | 输入对象混有__delegationRole/__floorLimits/__oracleSuiteConflict与变换后的agent/context/budget；部分是合法策略，但诊断字段与宿主载荷应分离，不能一律认定所有变换有错 |

本次实际执行两个无模型、无文件写入的离线探针：

1. 同一A/C和零修改报告，compareExecutionTruth带readOnly返回undeclared=[]；不带标记返回undeclared=[/repo/a.ts]。结合S02证明两处调用语义不一致；未将此称为完整verdict宿主重放。
2. preflightEffectiveModel显式model、未指定thinking、hostThinking=high，返回source=explicit/thinking=high；缺省Root模型不在registry返回blocked；registry读取抛错返回unverified。结合S03/S04可定位剩余反写/阻塞链。

既有 [批次A验收](./runtime-batch-a-2026-09-11-acceptance.md) 已将身份修复记为 implemented/unit-verified，并记录真实契约测试因隔离clone缺依赖失败；本文不将其转述为当前宿主已通过。

## 4. Solution

Root 应能直接得到以下结果：此运行实际加载哪版插件、以何身份和能力启动、宿主实际选择何模型、运行是否终止、报告是否已摄取、证据是否仍新鲜、下一步可执行动作是什么。信息不足明确保留unknown/pending，不能要求只读执行虚报变更，也不能将启动收据当坏报告。

实施复用现有 Orchestration、CompletionReceipt/RunRecord、Evidence、Usage 与并发准入；在现有宿主适配接缝验证完整路径。性能优化先减少错误恢复、重复探索和误报修正，再依据可比运行数据调整任务粒度与预算。

## 5. User Stories

1. 作为Root，我希望看到已加载插件指纹，以便确认本轮是否真正使用修复版本。
2. 作为操作者，我希望重启后能关联旧run与原Task，而不继承其他工作区的spec与裁决。
3. 作为Root，我希望启动成功只记为运行中，而不因没有最终报告立即消耗修正轮次。
4. 作为Root，我希望403等终态被可靠持久化，即使Worker没有返回报告。
5. 作为Root，我希望notify、wait和recover重复到达只摄取一次报告、费用及终态。
6. 作为Explorer，我希望诚实声明零修改，不承担并发Worker的路径。
7. 作为Reviewer，我希望检查所依据的版本可知，读取期间变化会要求重验。
8. 作为Worker，我希望reportOnly延续原执行证据，而不被新窗口覆盖或清除。
9. 作为提交类Worker，我希望已有dirty内容的提交与本轮新增编辑分别可见。
10. 作为操作者，我希望缺省委派继续服从宿主agentOverrides。
11. 作为操作者，我希望仅指定model不会隐式指定Root的thinking。
12. 作为Root，我希望预检不可用与明确模型不可用有不同诊断。
13. 作为子执行，我希望接近工具上限时知道应收尾，并交付有来源的partial。
14. 作为Root，我希望从中间成果继续剩余问题，而不是重新做全部调查。
15. 作为操作者，我希望看到工具预算哪些维度真正由宿主执行，哪些仅作提示。
16. 作为维护者，我希望按独立run/finding统计，避免重复通知膨胀失败次数。
17. 作为维护者，我希望回归用实际事件入口、真实收据形状和最终payload验证，而不是fixture自己与自己比较。
18. 作为操作者，我希望费用估算、未知费用和cache用量分列，能比较完整任务链而非仅成功run。

## 6. Implementation Decisions 与验收要求

### RS-01：身份、加载版本与运行收敛（P0；承接IS-01、RR-02/03/06、O-07）

**契约**

- 会话启动/reload记录loaded fingerprint、source path、package版本、host/subagent版本、session/workspace与能力；磁盘HEAD单列。指纹来自所加载构建，不能事后读取已改磁盘冒充内存版本。不可得字段标unknown。
- 新Task分配必须经过共享持久身份分配器；继续旧Task必须明确绑定且工作区一致。历史混合记录在恢复视图中标identity-conflict，保留原记录，不按最新Task猜身份。
- launch receipt只推进launching→running；收到可信terminal才推进terminal。ingestion状态独立，不用Task.state或报告自述推断物理进程退出。
- terminal但报告迟到为output-pending；403/进程错误与报告缺失分别记录，返回准确恢复动作，不诱导修正根本不存在的报告。
- notify/wait/recover/reload统一走同一收据摄取路径，持久化后再确认；重复与乱序到达保持幂等。可信terminal释放执行slot一次，报告迟到不重新占slot；writer锁按既有契约独立核销。
- 对本场旧状态只提供绑定核查和可审计恢复结果；没有可靠身份时返回冲突，不自动合并跨工作区历史。

**验收**

- **A01**：加载新构建，产生可对照指纹；仅修改磁盘代码，当前loaded指纹不变化，reload后变化。
- **A02**：重放E04启动收据→最终报告，启动阶段无REPORT_SCHEMA_INVALID、无修正计数；最终仅一份报告。
- **A03**：重放两份403，RunRecord终态与meta一致，slot释放一次；无报告不转completed、不自动启动新模型。
- **A04**：notify/wait/recover顺序排列、重复、输出文件迟到、持久化前后崩溃和reload后重试，report/usage均一次，Task和运行状态可同时解释。
- **A05**：共享ledger多进程分配、坏快照占号、跨workspace继续、旧completed身份被新建复用等IS回归在新宿主过门；历史冲突不污染新Task。

### RS-02：证据归属闭环与并发准入（P0；承接O-03、CP）

**契约**

- 摄取、自动Review、planner_verdict、reportOnly重算使用同一执行归属上下文。能力来自可信启动绑定，不来自报告“我是只读”的自述或单一agent名称。
- reportOnly的变更归属沿用原执行能力和A_run/C_report；当前修正进程只读不能豁免原Worker的漏报。连续多轮修正须找到明确原窗口。
- 区分执行编辑、提交产物、外部观察及未知作者。只读观察到的commit不能在导出中标为该只读执行提交的产物；不能仅因路径被命名为committedPaths就认为作者已证实。
- 作者归属与读取新鲜度独立：A_run→C_report期间变化也可能使读取混用版本；不能只检查C_report→C_now，然后自动接受已在执行期间过期的研究。有可信读取集合时按相关路径判断，否则保守重验相关范围。
- 未归属变化要求核查或重验，不建议只读角色回退文件，也不要求它把外部修改写进changedFiles。
- 默认并发3及可调上限沿用CP；在同worktree读写新鲜度专项通过前，正式入口执行CP既有串行门。不同worktree、独立只读可并行；相同Task别名、结构化重试不能意外绕过冲突检查。
- 本项需同步澄清领域文档中“窗口diff即Truth”的归属限定，保留Root独立采样权威；这不是接受Worker自报替代证据。

**验收**

- **A06**：E01精简场景经真实事件入口，零修改只读报告在摄取、Review、verdict、reload重算均无undeclared；外部路径可见。
- **A07**：读取目标在执行期间变化、报告后变化分别触发重验；无相关变化不反复重读；纯只读路径不生成“先回退再只读修正”指令。
- **A08**：Worker真实漏报保持阻断；一次及连续reportOnly不能用只读身份清空原finding；历史finding不迁移给新Task。
- **A09**：提交已有dirty、新编辑后提交、只读观察别人提交、外部未知修改四类场景输出归属与freshness一致。
- **A10**：经生产宿主适配入口验证读写串行、双writer互斥、三路独立任务准入及第四路拒绝；不可仅测controller默认构造。放开同worktree读写需A06～A09宿主证明并明确更新CP策略。

### RS-03：字段级模型来源与宿主解耦（P1；承接RR-07）

**契约**

- 分离原始requested、插件policy-resolved、宿主predicted、actual四类数据；model与thinking各有source，不能共用一个source决定两个字段写回。
- 显式输入、TaskSpec及角色策略按已有优先级和冲突规则生成新的launch payload；host fallback和unknown只进入诊断。未指定字段保持缺省，显式thinking-only输入也必须保留。
- 缺省child模型由宿主权威解析接口提供，包含agentOverrides/default；若没有此能力，不用Root模型的可用性阻断实际可能合法的child启动，记录unverified并继续既定降级流程。
- registry缺席、读取失败、能力不足统一归为unverified；可确认的显式模型不存在才是blocked。可用性预检不能承诺运行时账户额度充足。
- 实际模型回执与最终payload比较；预估模型不同不冒充“显式配置被违背”。403分类为provider运行错误，不静默换模型或重复耗尽同一额度。
- 对agent/context/budget/reportOnly等输入变换做来源清单：有合同依据的变换保留，诊断元数据存编排侧，不作为宿主公开参数。拒绝路径不留下部分变换污染下一次重试。soft预算等宿主有效字段不应被无说明丢弃。

**验收**

- **A11**：Root=Kimi、host worker/reviewer override=Luna、输入不含model/thinking；最终child实际Luna，原输入和下游显式字段仍缺省。另测仅defaultModel、无override及显式选择。
- **A12**：显式model-only、thinking-only、TaskSpec、role-policy/fallback分别检查每字段来源；不得写入推断high或字符串unknown。
- **A13**：Root模型不在registry但child override合法仍可启动；registry缺席/抛错为unverified；显式无效模型blocked且无Task/预算/slot残留。
- **A14**：重复prepare/preflight、拒绝后重试与payload序列化不改变原始请求；实际宿主schema只接收支持字段，原始instructions和合法预算字段可追溯。

### RS-04：预算分阶段收尾与中间成果（P1；承接O-06）

**契约**

- 先探测宿主真实tool-budget协议：attempted/executed/blocked计数、哪些工具受限、批量调用的计数、soft阈值、最终文本是否仍可生成。把requested/effective/enforced分列，不能把hard20宣称为全工具最大20次。
- 支持时进入exploring→finalizing→terminal：初始建议soft=ceil(0.8×hard)，hard20时soft16，保留hard阈值前的收尾余量；该默认是可调设计值，不是本场最佳性能结论。
- soft提示已耗/剩余预算、未完成问题和报告要求；finalizing停止扩展搜索。hard后禁止新的探索调用，不靠换bash绕过；最终文本不依赖额外读写工具。宿主不支持阶段控制时明确advisory-only，不伪装强制保证。
- 没完成必需验收时输出可解析partial及证据引用、已完成项、未运行项、阻塞原因、继续所需材料；不制造completed或虚构validation结果。完成了全部义务的预算拦截run仍可正常报告completed。
- 增量checkpoint与最终WorkerReport分开存储，不能当正式完成摄取；进程403等无法继续生成时，仅暴露已有checkpoint及宿主错误，不伪造WorkerReport。
- 下一轮绑定原Task和新execution，保留证据引用与未完成范围，重验变化部分；不自动加大预算、不无限重试同一受限模型。预算只能约束本任务，不以此宣称约束账号五小时总额度。

**验收**

- **A15**：受支持宿主hard20场景soft16触发收尾，模型仍可返回合法partial；硬阈值之后新探索实际执行数为0，重复被拦调用单独计量。批量调用在途例外须明确记录。
- **A16**：重放E02的ls/grep/read拦截及Worker bash/edit混合场景，报告实际enforcement范围；不支持宿主标advisory-only，不能记为A15强制保证通过。
- **A17**：宽范围只读调查中断后有来源的checkpoint/partial可恢复；后续只补未完成问题及必要重验，不重复整场搜索。
- **A18**：403发生在checkpoint前/后各测一次；terminal、partial可用性、nextAction与用量准确；没有有效中间成果时明确缺失。

### RS-05：证据导出、回归门与验收口径（P1；承接RR-01/10、O-07）

**契约**

- 单次导出以rootSessionId为范围，串联toolCallId、host runId、child sessionFile、canonical Task、execution、reportRevision、loaded fingerprint及源码指纹。
- 状态分列process exit、ingestion、WorkerReport.status、ReviewResult、Task.state、Verdict。保留原始code，映射policy-rejection/host-error/ingestion-error/lifecycle-refusal/accepted及retryable/nextAction。
- finding按task+execution+finding身份去重，保留重复通知数；工具拦截数、涉及run数与进程失败数分列。
- 用量分input/output/cacheRead/cacheWrite、估算来源和未知费用；按完整目标链统计Root、失败、重试、修正与验证，不从不可比Kimi/Luna任务推断模型优劣。
- 每个需求状态使用implemented / unit-verified / host-verified / unproven，附构建与收据。报告说完成、parser接受、正式验收三个事实不可混为一体。

**验收**

- **A19**：冻结E01～E05的脱敏最小fixture及源索引，统计重现4个新finding、36条拦截/12run、2个403，历史事件与重复回显单列。
- **A20**：导出能解释E04所有状态不一致，不把混合001～014标为本场完成任务；无法关联的费用/身份标unattributed。
- **A21**：A02/A06/A11至少各一条从宿主事件入口到最终持久化/launch payload的回归进入标准release链；fixture不以预制expected自比较冒充行为验证。

## 7. Testing Decisions

首选现有Pi宿主适配→Orchestration的高层接缝，注入可控Git采样、输出文件、时钟及宿主收据；只在预算执行与宿主模型解析处增加必要的契约探测。纯比较测试用于边界案例，不替代高层验收。

参考现有 `index.test.mjs` 的真实handler harness、`orchestrate.test.mjs` 的恢复/归属场景、`completion.test.mjs` 的持久化故障注入、`evidence.test.mjs` 的临时Git仓库，以及 `e2e.pi-subagents.test.mjs` 的公开契约检查。完整在线模型回放与公开API导入检查分别记证据；后者通过不等于前者通过。

实施阶段门禁：

```text
npm run typecheck
npm test
PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e
git diff --check
```

并在确认loaded fingerprint的新Pi进程运行A01～A21适用的真实宿主场景。依赖/宿主不可用时记blocked/unproven，保留失败日志，不将单元PASS替代。每项优先构造对当前缺口会失败的回归，再修实现。

本次文档任务实际验证为原始记录结构化核对、当前源码检查及第3节两个离线探针；未执行上述完整实施门禁或在线模型验收。

## 8. 分批实施与完成定义

| 批次 | 内容 | 依赖与完成门 |
|---|---|---|
| 1 | RS-01 + RS-05最小版本/身份索引和fixture | A01～A05；建立能辨识新构建的验收环境 |
| 2 | RS-02 | A06～A10；先补验收重算与生产准入，不提前放开混合读写 |
| 3 | RS-03 | A11～A14；包含缺省override真实启动，不以显式Luna替代 |
| 4 | RS-04 + RS-05完整导出 | A15～A21；宿主能力不足的强制收尾明确留待上游协作 |

性能指标先建立基线，再比较同一组目标：每个被接受目标的总run数、误归属修正数、无效预算重试数、可用partial比例、终态收敛延迟、总用量及来源明确的总费用。确定性验收中误归属为0、重复摄取/计费为0；不基于这一个混合场次承诺百分比降本或延迟收益。

## 9. Out of Scope

- 本文交付spec，不实施插件改动或迁移/清理真实ledger与会话。
- 不重新设计全部调度器、Task生命周期或提高默认并发上限；沿用CP与既有writer约束。
- 不自动换付费模型、购买额度或比较不可比任务的模型质量。
- 不将当前未见锁文件解释为需要批量删除；身份claim、短时分配锁、writer锁、slot、持久运行状态是不同对象。
- 不重复立项已实现的TaskPacket保真、O-04检查覆盖、O-05报告修复；保留其既有回归，若高层回放失败再沿原编号修复。

## 10. Further Notes 与关联规格

- [原运行可靠性 Spec：RR-01～RR-10](./runtime-reliability-2026-09-11-spec.md)
- [Task 身份与 TaskSpec 修复：IS](./runtime-identity-and-spec-repair-2026-09-11-spec.md)
- [默认安全并行：CP](./default-safe-concurrency-2026-09-11-spec.md)
- [07:57 场优化审计：O-01～O-07](./runtime-optimization-audit-2026-09-11.md)
- [本场批次A验收及模型反写复盘](./runtime-batch-a-2026-09-11-acceptance.md)

本文按用户要求输出到docs；后续实施票引用RS编号及A验收编号，并关联上述原需求。测试接缝是本次建议，实施前可调整宿主适配方式，但不能降级验收层次或将未观测结果标为完成。
