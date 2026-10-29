# Native/Lite 对照进度与待审方案

本文件保留此前各轮事实与暂停记录。**当时的“暂停全部新测试”已由后续用户继续指令及 Root 分阶段交接替换**。当前状态以 [Root 最终复核](root-review-final.md) 为准：离线功能证据已核对，checksum 测试时序例外待用户决定；子代理已退出，没有真实实验运行。本轮控制 reported USD0.97239834，累计已知 reported USD8.01491262，替代本轮途中快照，不与reserved相加。正式有效样本0、完整pair0；旧批次结论保持原样。下文前轮记录及旧命令均不构成新启动授权。

## 已完成及证据

- 候选固定 `f818cc91c98d6129a152fb28161e00d2f601e494`；此前控制器生命周期、真实角色映射、终态与报告绑定已离线验收，见 [控制器验收](../native-lite-lifecycle/acceptance.md)。该验收不代表真实对照成功。
- 缺省 source 的 Native 完成通知修复：真实通知回放行为红灯 19/21，最终聚焦绿灯 22/22；错误身份等拒绝仍保留。证据和适用边界见 [通知修复验收](../native-lite-budget-scope/notification-fix-acceptance-and-next-preparation.md)。compare-c5 真实运行到报告审查，但被实验 Root 拒绝，不是缺少验收 JSON。
- 26 美元请求停止线、预算边界和锁预检已由前轮 Root 验收；预算测试 5/5、锁预检 7/7、控制器及 Lite 宿主聚焦 23/23、隔离 release 通过，详见 [最终验收](../native-lite-budget-scope/final-acceptance.md)。两次遗留锁均经独立维护保留式隔离，没有加入自动回收。已验收运行配置仍须在新批重新核对；不得改写旧批。

## 历史问题

| 问题及影响 | 已知原因、处理和为什么早测未覆盖 | 证据 |
| --- | --- | --- |
| 原对照批首臂 cwd 错误，纠正后 RPC runner 漏发初始请求，批次停止 | 未发送实验 provider 请求；之后离线修复通过 10/10。错误配置与请求发送路径未被此前冻结材料充分验证。 | [首批验收](../native-lite-comparison/pairs/acceptance.md) |
| 旧 brief 仍指旧路径，新工作树中 Root 请求澄清；controller 漏识别实际费用消息类型而等待 | Root 预审未核对路径一致性；后续离线修复加入路径约束与真实费用格式器，旧批不追认为成功。早期检查未覆盖新 cwd 与真实消息组合。 | [比较记录](../native-lite-comparison/recommendation.md)、[控制器验收](../native-lite-lifecycle/acceptance.md) |
| reopen-a1 将 `guide` 管理调用误判为 child launch，首臂失败、child 尚未创建 | 原 controller 没区分管理查询和启动；此前离线配置/probe 未覆盖真实 guide 调用。真实事件回放红灯及最终聚焦 20/20 离线修复已验收；模拟通过不代表真实整臂通过。 | [reopen 失败](../native-lite-reopen/acceptance.md)、[分类修复验收](../native-call-classification/acceptance.md) |
| 默认 release 环境缺失 `@earendil-works/pi-ai` | 原始失败保留；隔离入口固定依赖后通过 release，未修改全局安装。该隔离通过不证明默认全局依赖已满足，且最后 harness 调整以聚焦检查覆盖而未重跑全套。 | [生命周期验收](../native-lite-lifecycle/acceptance.md)、[隔离入口验收](../native-release-repro/acceptance.md) |
| 异步 child 运行中 Root 阶段性返回被当作完成，另有角色映射、通知顺序、Native acceptance 和报告绑定缺陷 | 已离线修复并进行专门红绿与审查；早期绿灯未覆盖真实角色、宿主通知顺序及完整终态组合。真实执行仍须验证。 | [生命周期验收](../native-lite-lifecycle/acceptance.md) |
| compare-a2 首臂本地锁超时，未观察到 usage，其余臂取消 | 启动前已有锁，持有者和来源未确定；不能凭空日志认定账单为零。后续增加锁预检。此前检查没有拒绝已有锁。 | [失败验收](../native-lite-budget-scope/failed-batch-acceptance.md)、[最终验收](../native-lite-budget-scope/final-acceptance.md) |
| compare-b3 真实完成通知未携带 source，controller 拒绝 | 安装包合法通知可省略该字段，旧检查要求 `source===async`；真实通知 fixture 之前未覆盖。修复限定在已登记 run，红绿和故障注入见上；新锁真实来源仍未知。隔离 SIGTERM 可遗留锁只证明可能机制，不证明该次真实根因。 | [失败验收](../native-lite-budget-scope/compare-b3-failure-acceptance.md)、[修复验收](../native-lite-budget-scope/notification-fix-acceptance-and-next-preparation.md) |
| compare-c5 Root 因未调查候选外 RPC 聚合实现拒绝报告 | 输入只允许候选工作树，且要求记录 unknown；验收未明确外部未知是否单独致拒，构成范围冲突。此前离线控制器测试验证结构和流程，未证明真实 Root 语义评审遵循范围；不能将拒绝视为模式能力差异。 | [终态与范围冲突](../native-lite-budget-scope/compare-c5-closeout.md) |
| 历史预算范围与预留不一致 | 控制费用曾超过账本控制 seed，后续补充承接；用户累计授权修正为测试 USD30、交互 Root 排除，26 为请求停止线。旧 reported 快照不可重复累计；预留不是实际费用，也不与 reported 相加。 | [生命周期预算](../native-lite-lifecycle/acceptance.md)、[最终验收](../native-lite-budget-scope/final-acceptance.md) |

## 费用及当前观察

前轮最终已知 reported USD **6.67280288**，含控制/修复 worker 与实验 Root/child，不含交互 Root；不是 provider 发票。前轮账本 59 事件、reserved USD **16.204782395**，SHA-256 `e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d`，至 26 停止线的预留余额 USD **9.795217605**。本轮只读核对账本 hash 相同且锁路径不存在；没有写账本。原控制预留 USD11.41064652 覆盖历史控制 USD5.40165224 和前轮控制 USD1.12088280；可用部分不是新的实验费用预算，也不应与 reported 累加。

Root 在控制 worker 退出后按 assistant entry id 去重核对 **49 条**，重复 0、cost 缺失 0，本轮 reported USD **0.36971140**。累计已知 reported 为 **USD7.04251428**（6.67280288 + 0.36971140）；这是模型报告费用，不是最终账单，也不与 reserved 相加。该终态值替代本轮所有途中快照，不重复累加。未达到本轮 USD1.50 控制费用检查点；检查点不是硬 provider 上限。session：[最终会话](/home/tcuni-claw/.pi/agent/sessions/--home-tcuni-claw-pi-pi-planner-only--/2026-10-28T05-08-10-044Z_01a180e8-9abc-7502-9676-971766476ed0/fe058543-96ae-4916-9509-a3f5fcfbfcec/run-0/session.jsonl)，SHA-256 `f94c0cb09c6cf6501c86fa28abfb69fbcbd23595b7ef4839c3713fe0426389a3`。本轮最终复核账本仍为上述 59 事件、原 hash，锁路径不存在。

## 历史补充：根因判断与方法建议（当时待审；续行后仅离线准备获授权）

本节为当时方向性分析，区分已证实事实、系统性判断和待验证措施；不改写历史验收。后续 Root 已授权本轮离线协议/测试/校准准备修正，但没有授权 provider 实验、正式四臂准备或 launch。下文原命令与阶段是历史草案，不能直接执行。

### 已证实事实

- 多次失败发生在实验基础设施和真实接口边界：cwd、RPC 初始请求、管理调用分类、异步终态及完成通知。局部离线绿灯没有覆盖这些真实组合；后续修复通过也不等于整条真实链路已验证。见[首批验收](../native-lite-comparison/pairs/acceptance.md)、[生命周期验收](../native-lite-lifecycle/acceptance.md)、[分类修复验收](../native-call-classification/acceptance.md)及[通知修复验收](../native-lite-budget-scope/notification-fix-acceptance-and-next-preparation.md)。
- compare-c5 已到达真实报告评审，Root 明确 rejected；允许输入与拒绝理由存在范围冲突，不是 controller 缺少验收 JSON。见[终态与范围冲突](../native-lite-budget-scope/compare-c5-closeout.md)。
- 目前没有通过协议验收的样本或完整 pair；历史锁的具体来源仍未查明，不能把所有失败都归为同一根因，也不能推断模式优劣。

### 系统性判断（基于上述证据，非已验证定论）

主要问题是把“实验装置能否正常执行”“任务在允许范围内是否完成”“Native/Lite 表现有何差异”混进同一个通过/失败结论：完整对照反复承担了基础设施集成调试，而 Root 的内容验收标准又未充分与输入范围、角色权限对齐。增加 hash、日志和局部断言有助于追溯，但不能单独证明真实链路可用或裁判标准一致。

因此，不宜把下一步简化成“补 brief 后直接重开四臂”；应先建立下列分层门槛。新 brief 明确范围外 unknown 与角色职责是必要修正，但不是已经验证的解决方案。

### 建议方法与阶段门槛（均待授权、实施和验证）

1. **先定义三层结果，避免混淆失败含义。** 分别记录基础设施终态、Root 内容验收结论和对照可用性，并保留原始理由及证据。进程 exit 0、child completed、验收 JSON 合法不等于报告合格；Root rejected 也不自动说明基础设施失灵或模式能力较差。Root 必须可以如实拒绝，不能为得到绿灯而强制 accepted=true。
2. **用最小真实任务验证执行链路，不计入正式比较。** 经单独授权及现有预算、锁、slot 门禁后，用两种模式共同可完成的简单任务，检查请求发送、child 创建、异步终态、报告读取/hash、Root 决策及费用事件关联；仅验证接线与生命周期，不评估复杂研究能力。先核验 S1 的单 worker 链路；S2 正式运行前仍须核验其 validator/reviewer 拓扑，不能用 S1 通过替代。准备阶段也计入适用费用范围，不新增预算、不自动重试，不因失败自动扩大 controller 修改范围。
3. **统一任务与裁判契约，再校验验收边界。** 冻结允许输入、角色权限、必须回答的范围内问题、允许的 unknown 和明确拒绝条件，并让两臂应用同一标准。契约应能区分“合规披露范围外 unknown”“遗漏范围内可回答问题”“无证据却声称无重复或零成本”；校准材料与旧答案不得进入正式实验输入。静态检查可验证冻结和传递，语义是否正确仍需实际评审证据，不能以关键词断言或缺失实现的 no-op 红灯代替。
4. **前置门槛通过后，另行冻结正式对照。** 冻结候选、brief、允许证据、各臂 runtime/依赖/配置及预期模式差异，不能只凭源码相同宣称环境等价；完成逐臂预检方案验收后，再申请具体首臂 launch gate。明确记录准备运行与正式尝试的分类，不能事后只挑通过结果；正式拒绝、超时和控制器错误均保留并分类解释，是否可用于比较由预先约定标准决定。沿用失败即停、不自动重跑的约束；若修改协议，建立新版本，不重判旧批为成功。

**尚未确定的执行细节：** 最小任务内容、语义校准用例、具体脚本改动、准备运行的费用分配及停止条件、各阶段证据清单仍须先明确并审核；本节不提供可直接启动的命令，也不声称这些门槛已经通过。该方法会增加一次小规模准备成本，目的是避免继续用完整对照发现基础接口或验收范围问题，而不是保证下一批通过。

## 待审范围与验收矩阵

范围维持候选内源码和相关测试，不加入仓库外 pi-subagents 实现，不读旧解答给实验 Root。S1 两臂使用同字节 brief、恰好一个 worker；S2 两臂同字节 brief、一个 validator/oracle 与独立无 shell reviewer。S2 对历史 manifest/release 的读取只限候选内任务所引用记录，排除其他研究归档与他臂结果；不可把源码相同当作依赖/runtime 相同。

S2 输入审计：对候选 commit 的只读 `git ls-tree` 和 `git show ... | wc -l` 确认 `.scratch/reviewer-range-integration-20261027/combined-source-manifest.sha256` 在候选内且为 192 行，同目录 `acceptance.md` 和 `release-combined.log` 也在候选内。该 acceptance 明确 manifest 对应历史组合工作树，不直接证明候选绑定；release 的适用性仍待实验核查。候选内另有 `.scratch/native-release-repro/acceptance.md` 及 release 日志，但对应更早基线，不能直接当候选 release。旧 brief 一方面禁止读取 archived research，另一方面要求引用历史记录；应在新 brief 精确允许上述候选内指定记录，并禁止其他归档。它也明确授权本批 `common/S2-candidate.diff`，这超出“只用 worktree/input/results”的字面范围；新 brief 必须显式把这一个已冻结公共 diff 加入允许输入，且与各臂 `input/S2-candidate.diff` 同字节。若用户不批准该例外、需要的具体证据不在候选内或无法核验时，标为待冻结输入并阻断，不能默许外部归档或宣称证据已齐全。

| 场景 | 两臂共同的 Root 验收标准 | unknown 边界 |
| --- | --- | --- |
| S1 Native / Lite | 报告以具体文件和符号支撑候选内数据来源、调用与快照/增量和重复计数边界、Root/child 与 input/output/cache read/write 覆盖、缺失 usage/cost 行为；Root 实读报告及证据后验收。范围内可回答遗漏不能用 unknown 豁免。 | 候选外 RPC 内部聚合、真实运行和 provider 账单无法由候选源码证明时应明确 unknown 与边界；单独因此不得拒绝，也不能当作免费或已证明无重复。 |
| S2 Lite / Native | validator/oracle 核查 merge 父提交及祖先、192 项 manifest/release 的候选绑定，记录其实际命令、cwd、时间、exit、指纹；reviewer 仅独立审查固定 diff 并说明该输入的局限，不运行命令。Root 按各角色职责分别审查，再判断两份报告合起来是否覆盖整臂标准。 | 对记录不能证明的依赖环境和运行时结论标 unknown；不可代替角色范围内可完成的检查，也不得要求 reviewer 提供 validator 专属命令输出或 manifest 检查。 |

离线契约检查只能证明 brief 的冻结、传递、两臂一致和结构，不能仅靠关键词证明 LLM 语义评审正确；是否遵守仍需真实臂证据。下一阶段须先补协议/brief 和对应行为红绿及故障注入，保留实际命令、环境、hash、exit；本轮不执行。

## 第一版暂停时的脚本与命令状态（历史；后由续行修正）

已存在、前轮使用并验收的脚本：[prepare-batch.mjs](../native-lite-budget-scope/prepare-batch.mjs)、[verify-batch.mjs](../native-lite-budget-scope/verify-batch.mjs)、[freeze-contract.mjs](../native-lite-budget-scope/freeze-contract.mjs)、[run-rpc-arm.mjs](../native-lite-lifecycle/run-rpc-arm.mjs)。**现有 prepare 硬编码旧 brief，不能直接用于本轮新契约**。本轮未执行、未验证的审查草稿：[S1 brief](S1-brief.review.md)、[S2 brief](S2-brief.review.md)、[prepare-batch.review.mjs](prepare-batch.review.mjs)、[单臂命令](run-arm.review.sh.txt)。准备草稿复制既有脚本、只更换 brief 输入并记录原脚本 SHA-256；不能视为实现验收。逐臂自动验证和真实行为红绿尚未产生；恢复测试须先取得真实基线红灯。下列是参数示例，不可照此启动；批次时间、attempt 及新脚本须在审核批准后冻结。原 controller 不改，除非先获得 Root 对精确范围的批准。

示意参数：`BATCH_ID=20261028T140000+0800`，`BATCH_ROOT=/project/tmp/pi-native-lite-20261028T140000+0800`，`ATTEMPT=scope-d1`，共享账本 `/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json`。示例仅占位，不能复用已存在路径。准备草稿绑定 `PI_NATIVE_LITE_BATCH_ROOT`、`PI_NATIVE_LITE_BATCH_ID`、`PI_NATIVE_LITE_ATTEMPT_ID`；验证须核对四臂 manifest、brief、候选、设置、runtime/controller hash、ledger 前缀、锁和空输出。现有 `verify-batch.mjs` 要求当前 ledger 与冻结 prefix 完全等长、所有臂输出为空，仅适合首次全批预检，不能原样用于第一臂后。后续逐臂由 Root 人工验证冻结的历史 ledger prefix 原样保留、当前 ledger 的完整性及预算、目标臂输出为空，并检查候选和冻结配置不变；保留已完成臂的输出，不重冻结旧结果。逐臂检查脚本尚未产生或验收。

准备及首轮核验命令草案，均未执行；实际值和 slot 门禁须批准后提供。两份 brief 内的旧 batch/attempt 字符串仅作为现有准备脚本的替换标记，准备时须全部替换并核对新路径；它们不授权复跑旧批次。Root 静态核对准备草稿与原脚本的差异仅为来源 hash 注释及两份模板输入路径；没有执行脚本、语法检查或测试。Root 另澄清了 S2 按角色分别验收的文案，防止把 validator 的命令要求施加给无 shell reviewer。

```sh
# cwd /home/tcuni-claw/pi/pi-planner-only; BATCH_ROOT/BATCH_ID/ATTEMPT 必填
# 预计重任务前先保存 slot audit/status，并按 slot 规则排队。
env TMPDIR=/project/tmp/pi-native-lite-scope-contract/tmp TMP=/project/tmp/pi-native-lite-scope-contract/tmp TEMP=/project/tmp/pi-native-lite-scope-contract/tmp PI_NATIVE_LITE_BATCH_ROOT="$BATCH_ROOT" PI_NATIVE_LITE_BATCH_ID="$BATCH_ID" PI_NATIVE_LITE_ATTEMPT_ID="$ATTEMPT" node .scratch/native-lite-scope-contract/prepare-batch.review.mjs
env TMPDIR=/project/tmp/pi-native-lite-scope-contract/tmp TMP=/project/tmp/pi-native-lite-scope-contract/tmp TEMP=/project/tmp/pi-native-lite-scope-contract/tmp PI_NATIVE_LITE_BATCH_ROOT="$BATCH_ROOT" PI_NATIVE_LITE_BATCH_ID="$BATCH_ID" PI_NATIVE_LITE_ATTEMPT_ID="$ATTEMPT" node .scratch/native-lite-budget-scope/verify-batch.mjs
```

历史首臂受控入口及完整精确命令见 [历史 worker 报告](/project/tmp/pi-native-lite-budget-scope/worker-report.md)，该命令绑定已停止批次，**禁止重跑**。[单臂草稿](run-arm.review.sh.txt) 列必填参数、人工检查及实际 runner，不自动循环。launcher 的 `TMPDIR`、`TMP`、`TEMP` 为 `/project/tmp/pi-native-lite-scope-contract/tmp`；现有 runner 会把子进程这三项及 `PI_SUBAGENTS_TEMP_ROOT` 覆盖为 `$BATCH_ROOT/tmp`，需要在用户审核时明确该差异，不能宣称子进程使用控制 tmp。预计超过一分钟、2G 或大量 IO 的任务前读 `~/.config/agents/slot.md`，每次保存新的 slot audit/status 再经 slot 运行。

## 第一版暂停时的阶段和停点（历史计划，已被下方续行状态取代）

1. 当时等待用户审核；后续用户授权继续离线准备，但未放行实验。
2. 经授权后准备协议、必要最小脚本和先红后绿测试；新批次四臂准备及预检，冻结 hash/命令/预算，交 Root 验收。任何锁、漂移或预算异常即停，不能手改账本或自动清锁。
3. 仅具体首臂 launch gate 后按 S1-native、S1-lite、S2-lite、S2-native 顺序，每臂上限 20 分钟；每臂前重新核对并保存 slot 证据，每臂后提交真实 session、fingerprints/ledger、usage、终态、Root acceptance、报告 hash、配置、exit 和墙钟供 Root 验收。失败、超时或 stop 即停止整个批次，不自动重跑。

## Root review 1 续行状态

Root 首版 review 未通过；第一版完整保存在 `/project/tmp/pi-native-lite-scope-next/review-1/scope-contract/`，其非 TDD 历史不追认。本轮仅依据 review 逐项修正，不改第一版副本、controller/产品/历史证据或共享 ledger，不运行 provider/RPC 实验，也不准备或冻结正式批次。

先对第一版真实缺口增加测试，记录 worktree 源码漂移、ledger path override、unbound worktree override 仍被放行；随后针对账本完整性用现有真实 `readLedger`/`BUDGET_USD` 契约实现修复，并加入实际 controller/models/user settings/Pi/pi-subagents manifest 文件校验、workspace snapshot、brief pair/S2 diff bytes、batch/attempt/arm/ledger path binding、manifest/runtime-lock cross-binding、fail-closed lock/output 检查（含 symlink 输出）。真实 guard ledger fixture 的 checksum、事件合计、reservation cap 负例和 fault injection 均覆盖。`prepareBatch` 现在可在显式 fixture 依赖下生成 manifests；端到端测试用它生成隔离四臂 fixture 后调用实际 `arm-preflight.mjs` CLI（仅测试模式、所有依赖真实路径都限定在 TMPDIR 内），验证替换 markers、paired bytes 以及合法追加 ledger 与保留前臂输出。

已批准 legacy verifier 基线在 `/project/tmp/pi-native-lite-scope-next/legacy-baseline/evidence/`：用 fixture-only copy，仅将旧 verifier 固定真实 ledger 路径替换为 fixture 路径；原 verifier SHA 和完整单行适配 diff 留存。初始全批状态通过，合法 ledger append 在旧 prefix-count 等长约束处拒绝，已完成 arm 输出在全空输出约束处拒绝。原 `.scratch/native-lite-budget-scope/verify-batch.mjs` 未改。新 checker 对等语义已由 `prepareBatch`→manifest→`runArmPreflight` 集成 fixture 通过。

R2 的旧实现红灯保留为 `/project/tmp/pi-native-lite-scope-next/r2-red-current.log` 与 `r2-red-current-2.log`；fixture 逐步修正期间的语法/夹具失败不冒充红灯。经真实依赖文件的 `r2-prepared-cli-red-2.log` 复现生成 manifest 后当前 CLI 不能在隔离依赖路径通过；修复后的 `r2-prepared-cli-green.log` 通过。最终逐臂聚焦 11/11、legacy baseline 3/3、syntax、`git diff --check` 和使用已存在隔离依赖的完整 `npm run test:release` 均通过，日志与 hash 见 [preflight.md](preflight.md)。默认全局 release 的缺失依赖原始失败仍保留；没有改全局包或安装。

**最终验收阻塞：** checksum/event-sum red chronology不完整。第一轮 R2 fixture 对账本测试错误地忽略了用于制造不一致总额的第二参数；原始 `r2-pre-impl-current.log` 中该断言失败是 fixture 错，不是产品红灯。之后对冻结第一版使用真实 guard schema和损坏 checksum 的独立重放确证旧实现会放行，但它晚于实现，绝不追认成TDD。正确schema/checksum fault的最终绿灯已通过。Root要求这一项在做出修复前必须有真实红，明确不豁免；详见 `r2-tdd-fixture-audit.md`。不通过整体TDD验收，不再人为回退/关闭guard伪造时序。

后续校准的子进程 TMP 约定已由 Root 明确：worker/离线工具和 launcher TMPDIR/TMP/TEMP 留在 `/project/tmp/pi-native-lite-scope-next/tmp`；仅现有 runner 启动的校准 Root/children 按 runner 设置使用每次新 `BATCH_ROOT/tmp`，必须是 `/project/tmp/pi-native-lite-<唯一标识>/tmp`、不落 `/tmp`。这不是 launch gate。共享 ledger 只读状态保持 59 events、reserved USD 16.204782395、SHA-256 `e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d`，lock 不存在。正式有效样本/完整 pair 仍为 0/0；没有实验、RPC、formal batch 或新 ledger lock。

## Root review 2 续行：runner消费契约

首个真实消费者fixture矩阵由当前 `prepareBatch` 产物调用既有 `run-rpc-arm.mjs`，PI_BIN 是只写 marker、受控exit23的本地mock。R3有效红灯在runner:37的manifest version1身份断言；16个formal/校准arm都未达到mock spawn。之后将manifest恢复为runner接受的version1 envelope，在两份formal brief及全部6份校准输入补足第一行路径/合同字面字段/S2 reviewer diff句型和各自execution shell。首个绿灯尝试曾在runner:64暴露校准壳遗漏 `plain-text reports` 字面字段，修正后完整16个mock spawn通过，并核对args、model、mode、results/session参数及child TMP env。它仅证明启动前既有runner消费接线，不是RPC/provider/语义测试。红绿命令、raw日志hash及12/12 focus详见 [preflight](preflight.md)。R2通过release原始日志Root已核验，本次没有无收益重跑release。R2 checksum TDD历史阻塞仍保留。

## Root review 2 续行：真实 runner 消费验证

R2后对既有 `run-rpc-arm.mjs` 做只读核验，并新增在隔离 worktree 上真实调用该 runner的fixture测试。其 `PI_BIN` 是本地纯mock executable：只写命令参数/工作目录/runner注入env marker并以预定23退出；没有加载Pi/provider、扩展、模型或网络。首轮红灯在runner manifest identity check，明确因为新prepare产version2而旧消费者仅接受version1；红灯随后也到达了契约字段检查，表明模板外壳仍不匹配。当前参数化consumer测试覆盖正式S1/S2和6份校准brief、Native/Lite配对共16个mock spawn；check runner preflight完成、mock参数和子进程tmp环境正确。校准semantic prompts使用共享外壳并区分对象级 verdict 与评审任务完成；封存期望保持独立且不进入prompt。

此项是runner启动前消费/参数/env验证，不是provider链路、模型判断、RPC握手或真实child终态测试。正式/release controller未改。checksum时序缺口继续存在且不豁免；报告会保留该阻塞。

本轮截至暂停前实际操作：只读核对 HEAD、历史材料、账本及 session；创建外部 tmp 目录；曾短暂新增一个草稿测试并运行一次 `node --test .scratch/native-lite-scope-contract/scope-contract.test.mjs`，exit 1、3 项断言失败，原始日志 `/project/tmp/pi-native-lite-scope-contract/red.log` SHA-256 `fc226d0babc049a70f376d4c72332af9abe351ffa1bf77f408eb92aec02386d9`。该测试使用缺失实现的 no-op 作为草稿，并不构成目标行为红灯或有效契约证明；草稿测试和临时实现已移除，未运行绿灯。上述测试发生在暂停指令之前，之后没有新测试或实验。最初继承的 TMP 环境是 `/project/tmp/pi-1000`，并非指定目录；一次工具输出截断写入该仓库外位置，后续命令显式设为指定目录。未提交、推送、安装或 reload；未改产品、controller、历史证据或共享 ledger。
