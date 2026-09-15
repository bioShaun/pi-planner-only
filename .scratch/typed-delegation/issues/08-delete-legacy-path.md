# 08: 删除旧委派路径 —— 按去向表收掉 orchestrate 拦截链、六个整文件与全部文本解析

Status: ready-for-agent（2026-09-15 由 needs-triage 展开；行号基于 4883189）
Blocked by: 05 B 段（90a1975，verified）、06（48a5fc5，verified；保留意见 49f3caa 已消化）
Type: task

**What to build：** 按 [spec.md 模块去向表](../spec.md) 把旧委派链整块删掉：`notify.ts` / `completion.ts` / `reservations.ts` / `acceptance-claims.ts` / `acceptance.ts` / `test-fixtures.ts` 整文件；`orchestrate.ts` 的 `beginDelegation*` / `prepareRoleDelegation` / `handleSubagentResult` / `handleAsyncNotify` / 收据与恢复方法与全部私有级联；`task.ts` / `report.ts` / `roles.ts` / `review.ts` 的文本解析函数；`index.ts` 的 subagent 拦截分支、`tool_result` 的 bg_wait/subagent 分支、`message_end`/`context` 的 notify 处理、`planner_recover` 工具；`policy.ts` 的 legacy 分支与迁移旗标；对应测试文件与 `architecture.test.mjs` 断言更新；`package.json` `files` / `test` / `test:e2e` / `test:release` 同步。

设计与去向表见 [spec.md 轮 3](../spec.md)。ADR：[0001](../../../docs/adr/0001-typed-delegation-contract.md)。

## 现状（写票时核过的事实）

1. **旧链对外已不可达，只剩测试旗标。** `decidePolicy` 在 B 段后对 `subagent` / `bg_wait` 一律拒绝（`policy.ts:171-173`），不看输入不分 live/Idle。`PI_PLANNER_ONLY_LEGACY_SUBAGENT` 的全部足迹：`index.ts:1420`（传入 `PolicyInput.legacyDelegation`）、`index.test.mjs:14`（全文件在旗标下跑——**这是本票最大的测试处置**）、`policy-cutover.test.mjs:9/:17/:171/:203`。删旗标后 `prepareRoleDelegation` / `beginDelegation` / `handleSubagentResult` / `handleAsyncNotify` / `registerCompletionReceipt` / `recoverPendingRun` / `reingestOriginalReport` / `reconcilePendingDelegations` / `authorizedWaitId` 的全部生产调用点归零（`index.ts:1434-1435/:1491/:1518/:1601/:1639/:870/:1190`）。
2. **五处保活侧耦合，不是级联能自动清的，逐条见 D2：**
   - `recordRootVerdict` 内部调 `reconcilePendingDelegations`（`orchestrate.ts:4498`），`planner_verdict` execute 也调（`index.ts:1304`）——同步 launcher 下不存在「已结束未消费」的子进程，两处直接删调用。
   - `exportEvidence` 带 `runRecords` + `acceptance: ACCEPTANCE_CLAIMS`（`orchestrate.ts:1046-1056`）；`exportSessionEvidence`（`usage.ts:1563`）的 options 同步去掉这两项，`usage.ts:1781` 的 `buildAcceptanceEvidenceMatrix` 块随之删除。导出的 payload 形状变化是预期内的迁移差异，交回时写进说明。
   - `renderTaskStatus` 读 `this.runRecords` 渲染「Persisted run provenance」（`:3612-3618`）——`TaskExecutionRecord` 不带 loadedProvenance（types.ts 无此字段），runRecords 删除后该行**删掉**；「Loaded provenance」行（`:3622`）不动。同方法还读 `delegationHistory` 渲染「Delegations:」段（`:3675` 起）——history 分支随 `recordHistory`/`noteDelegationModel` 删，`else if (children.length > 0)` 的 usage.children 分支**保留**（新链的 child 行走这条）。
   - `PlannerOrchestrator` 的 deps（`index.ts:366-408`）：`recordCompletionUsage` / `automaticOracleDispatch` / `artifactDirs` / `delegationRateKind` / `getModelPreflightContext` 删（全部只喂 beginDelegationInner / 收据路径）；`concurrency` / `gitRunner` / `ledgerDir` / `getSessionRootUsage` / `getUsageEntries` / `sessionRootBudgetConfig` 留（status 渲染、verdict 采证、export 还要）。`automaticOracleDispatch` 是往 steer 消息里塞 subagent 形状 task JSON 的旧 oracle 派发，新链里 validator 由 Root 走 `planner_delegate`，不再自动派发。
   - `index.ts` 约 :90-115 的指纹源文件清单里有 `notify.ts` / `reservations.ts`（computeLoadedFingerprint 的输入）——同步删条目；`test-fixtures.ts` 也在清单里。
3. **`jsonCandidates` 的最后一个保活侧消费者就是两个 `@deprecated` 提取器**（`review.ts:433/:463`），随 extractReviewRequest / extractReviewResult 一起删；`validateReviewRequest` 除被 extractReviewRequest 调用外无生产消费者，一并删。`extractFinalAssistantText` 只被 notify.ts / completion.ts 用，随文件删。
4. **`reviewAttribution` 原件（`orchestrate.ts:1677-1728`）此时可删**——`review.ts` 的 `reviewAttributionOf` 副本已落地且 06 verified，唯一调用方 `prepareRoleDelegation`（`:1758`）删除。
5. **探索预算与 run 记录是收据期机制**：`recordExplorationToolCall` / `isExplorationToolCall` / `explorationBudgetStatus` 绑定 `DelegationRecord`（`index.ts:1466-1482` 经 `getDelegation(toolCallId)`/`details.parentToolCallId` 查），新链不建 DelegationRecord，该块已死；`RunRecordStore` / `getRunRecords` / `registerRunRecord` / `updateRunRecord` / `markRunTerminal` / `markRunIngestion` / `resolveRunBinding` / `resumeRunId` / `getRecoveryView` / `renderRecoveryView` / `ingestCompletionReceipt` / `releaseRunSlot` / `endDelegation` 同理全删。`concurrency.ts` 的 reservation 是另一套（`delegate.ts` 在用），**不动**。
6. **LOC 基线（本票开工点）：** `wc -l *.ts` = 22,899；`wc -l *.test.mjs` = 27,563。stub 里的 21,813 是写 stub 时的旧值，以本数为准。

## 范围

**整文件删**：`notify.ts`、`completion.ts`、`reservations.ts`、`acceptance-claims.ts`、`acceptance.ts`、`test-fixtures.ts`、`e2e.pi-subagents.test.mjs`、`notify.test.mjs`、`completion.test.mjs`、`tests/` 整树（`runtime-reliability-2026-09-11.test.mjs` + `fixtures/`——replay-harness 引 `extractWorkerReport`，是旧事件流的重放器）。
**符号删**：见 D1–D4。
**改**：`orchestrate.ts` / `index.ts` / `policy.ts` / `task.ts` / `report.ts` / `roles.ts` / `review.ts` / `usage.ts` / `package.json` / `architecture.test.mjs` / `naming.test.mjs`（若枚举到被删文件名）/ 全部受影响的测试文件。
**不改**：`types.ts`（合同类型不动；若删完后有遗留的孤儿类型别名，留——10 决定）、`evidence.ts`、`ledger-store.ts`、`workspace-snapshot.ts`、`concurrency.ts`、`floors.ts`（floor 计算逻辑留，见 K2）、`role-models.ts`、`git-audit.ts`、`delegate.ts` 的编排语义、`subagent-delegation-contract.ts`、README / CONTEXT.md（10 收）。

## 设计

执行序：先删 `index.ts` 的入口分支与 `policy.ts` 的旗标（斩断可达性）→ 删 `orchestrate.ts` 公共入口 → tsc + grep 收敛私有级联 → 删整文件 → 处置测试 → 收 package.json 与 architecture/naming 断言 → 全绿。中间状态不需要编译通过；建议单 commit 原子落地。

### D1. `index.ts`（删块清单，行号基于 4883189）

- `planner_recover` 工具注册整段（`:1172` 起至 `});`）——含 execute 内的 `reingestOriginalReport` 调用与 capability 分支文案。
- `tool_call` hook：`:1418-1420` 的 `legacyDelegation` 传参；`:1421-1423` 的 `authorizedWaitId` 接线；`:1402-1405` 的 `bg_wait` 归因 else 分支；`:1426-1455` 的整个 subagent 拦截块（prepare/begin/composite/warnings/rootTurnTaskIds 回填全在里面）。归因名单 `["subagent", "bg_wait", "planner_verdict", "git_audit", "planner_delegate"]`（`:1397`）**保留不动**——被拒的 orchestration 调用仍应进回合归因。
- `tool_result` hook：`:1466-1482` 的探索预算块（含 `getDelegation` / `parentToolCallId` 查询）；`:1483-1505` 的 `bg_wait` 分支；`:1515-1533` 的 `subagent` 分支。**保留**：REVIEW_LEAK_TOOLS 块（`:1506-1514`）——泄漏记账与委派路径无关。
- `message_end` hook：`:1591-1619` 的 notify 段（`isSubagentNotifyMessage` / `parseSubagentNotify` / `handleAsyncNotify` / `recordAsyncChild` / `flushIfTerminal` 循环）。**保留**：assistant 角色记账与 sessionRootBudget 评估段。
- `context` hook（`:1622-1651`）整体删——它只重排/改写 notify 消息。
- 顶层与类内 helper 级联，删：`isSubagentNotifyMessage`、`customMessageText`、`SUBAGENT_NOTIFY_TYPE`、`pendingChild`、`grantedDebt`、`CHILD_META_AGENTS`、`runIdFromDetails`、`harvestMetaUsage`、`bindOwnedChild`、`recordBgWaitChildren`、`recordAsyncChild`、`recordSyncChildren`、`accountingTaskId`、`artifactDirsFor`、`resolveTaskPending`（只经 meta 文件解 pending 债务——新链不产生 pending child；历史账本里残留的 pending 行就保持 pending，纯展示项）、`harvestOrphanMetas` 与其 `:785` 调用点、`ledgerHasRunId`、`META_FILE_RE`、`AGENT_KIND`、`taskIdForSessionRun` 调用点（`:774/:1404`）。
- 有保活消费者、**留**：`persistSessionEntries`、`syncUsage`、`contentText`、`asRecord`、`canonicalTaskId`、`enrichDecisionText` / `recordInjectedText`（verdict 与 `/planner-only` 子命令在用，操作的是我们自渲染的 decision 文本）、`flushIfTerminal`（verdict/abandon/reset 在用——删掉内部 `resolveTaskPending` 调用与 `asyncDir` 形参）、`writeUsageLog` / `sessionFileOf` / `usageLogPath`、`rootShareWarnThreshold`。
- `/planner-only` 状态块：`:1722` 的 `renderRecoveryView` 行删；`:1728` 的 `delegatedStatusTask` 查询删（新链同步，无 in-flight 委托可查）；`:1740` 的 `listDelegations().length` 预算回退行按其上下文处理——若该行只为「有 pending 委托时显示未设上限」服务，随查询一起删。
- import 区：`./notify.ts` 整行（`:20`）；`./orchestrate.ts` 里的 `compositeWorkflowBlockReason` / `isDelegationCall` / `isExecutionCreatingAction` / `DelegationRecord`（`:18-19`）；usage.ts import 里只喂已删 helper 的符号（`childOutcomeFromExitCode` 等，逐一核）。`buildRunRecord` / `summarizeRuns` / `renderRunSummary` **留**（`record` / `summary` 子命令读 store+ledger，`:2012/:2051`）。
- `subagentVersion` / provenance capabilities 字段**留**——pi-subagents 仍是结构化委派事件的宿主实现，兼容区间真实有效。

### D2. `orchestrate.ts`（公共 API 切割线 + 保活清单）

**删的公共入口**（删除后其私有级联由 grep 归零驱动）：`beginDelegation` / `beginDelegationInner`、`prepareRoleDelegation`（方法包装，`:1735-1785`）、`handleSubagentResult`、`handleAsyncNotify`、`registerCompletionReceipt`、`reingestOriginalReport`、`recoverPendingRun`、`reconcilePendingDelegations`、`authorizedWaitId`、`resolveValidatorReviewedTask`、`ingestCompletionReceipt`、`getDelegation` / `listDelegations` / `pendingDelegationCount` / `wasConfirmedNotLaunched`、`taskIdForSessionRun`、`noteDelegationModel`、`recordExplorationToolCall` / `isExplorationToolCall` / `explorationBudgetStatus`、`getRecoveryView` / `renderRecoveryView`、`getRunRecords`、模块级 `isExecutionCreatingAction` / `isDelegationCall` / `compositeWorkflowBlockReason` / `classifyHostAction`。

**保活的公共 API**（executor 以此为停止线）：`store`、构造器与收缩后的 `OrchestratorDeps`、`setLoadedProvenance` / `getLoadedProvenance` / `setLoadedFingerprint` / `getLoadedFingerprint`、`exportEvidence`（去 `runRecords`/`acceptance` 两项）、`setSessionRootBudgetConfig` / `renderSessionRootBudgetStatus`、`restoreFromLedger`、`renderConcurrencyStatus` / `setConcurrencyLimit` / `setConcurrencySavedLimit` / `resetConcurrencyLimit` / `getConcurrencyStatus`、`resolveVerdictTask`、`recordRootVerdict`（删 `:4498` 的 reconcile 调用）/ `recordRootVerdictRefusal` / `rootVerdictRefusal`、`renderDecisionBlock`、`renderTaskStatus`（按现状 §2 改两处）。

**私有级联**（由上面删出不可达后逐个删，交回时给最终清单）：`delegations` map 与 `DelegationRecord` 类型、`delegationHistory` / `recordHistory`、`runRecords` 字段与 `runSessionId`（若只喂 run 记录）、`resolveRunBinding` / `resumeRunId` / `recordedWaitDelivery` / `rememberWaitDelivery`、`updateRunRecord` / `registerRunRecord` / `markRunTerminal` / `markRunIngestion`、`releaseRunSlot` / `endDelegation`、`beginExecutionRecord` / `completeExecutionSample` / `recordReportExecutionTruth`（只被 beginDelegationInner / handleSubagentResult 喂——verdict 路径只读 `task.executions` 不写）、`parkBlockedReceipt` / `isBlockedReceiptSealed` / `delegationArtifactDirs` / `readStoppedRunArtifact` / `resolveDelegationOutput` / `matchAsyncDelegations`、`reviewAttribution`（原件）、`reservations` 字段与 `cumulativeBudgetRefusal` / `untrustedLedgerRefusal`（若只服务被删路径）、`writerConflict` / `noteStaleHolder` / `isLiveWriterStale`（若 verdict/status 不可达）、`hasPendingDelegation`、`delegationLookup`（若只服务 beginDelegation）、execution-record 写入器全套。
**保活私有**：`captureEvidenceOptionsFor`、`executionForLatestReport` / `latestAttributionExecution`、`successorAttribution`、`preparePassFindings` / `augmentExecutionEvidence`（verdict 路径在用）、`foldSnapshotBindingIntoComparison`、`restoreTaskOnDemand` 及其 restore 级联、`depsUsageEntries`、以及 recordRootVerdict / renderTaskStatus / restoreFromLedger 可达的一切。
**refusal 码**：`RUN_*` / `OUTPUT_*` / `REPORT_TARGET_UNBOUND` / `REPORT_TARGET_AMBIGUOUS` / `VALIDATOR_*` / `FOREIGN_RECEIPT` 是散落字面量，随宿主方法死；`delegate.ts` 的 `REVIEW_*` / `TASK_*` 码不动。

### D3. `policy.ts`

删：`legacyDecidePolicy`（`:184-238`）、`subagentDelegatesToChildren`（`:87-93`）、`idleWaitRefusal`（`:110-129`）、`LEGACY_ORCHESTRATION_TOOLS`（`:32-39`）、`PolicyInput.legacyDelegation` / `authorizedWaitId` 两字段与 `:168` 的旗标分派；`ROOT_TOOLS` 里的 `"planner_recover"`；`@deprecated` 别名 `ORCHESTRATION_TOOLS`（`:22`）与 `AUDIT_TOOLS`（`:49`）——顺手收掉（grep 全仓确认无残留引用）。留：`decidePolicy` 新路径逐字、`IDLE_TOOLS`、`QUESTION_TOOLS`、`buildTaskSpecRepair` 拼接（非委派工具的拒绝仍带修复提示）。

### D4. `task.ts` / `report.ts` / `roles.ts` / `review.ts` / `usage.ts`

- `task.ts`：删 `extractTaskSpec*`（含 `extractTaskSpecDetails`）、`topLevelJsonCandidates`、`inferTaskRoleFromAgent`；`buildTaskSpecRepair` 内的 subagent 分支与 `:1121`「Embed this in the subagent task prompt」文案删（05 已记），`buildTaskSpecRepair` / `appendTaskSpecRepair` 本体留。`ROLE_TOOL_PROFILES` / `MUTATING_TOOLS` / `roleAllowsMutatingTools` / `DEFAULT_EXPLORATION_BUDGET`（若在本文件）若只被被删符号消费则级联删。
- `report.ts`：删 `jsonCandidates`、`scanBalancedObjects`、`extractFinalAssistantText`、`extractWorkerReport`、`repair*` 一族、`normalizeWorkerReport` 的修复分支（若修复分支即全部则整函数删——`validateWorkerReport` / `validateWorkerReportIdentity` / `stableStringify` 留）。
- `roles.ts`：删 `TASK_ID_RE`、`promptTaskIds`、`resolveDelegationTarget`、`isReportOnlyPrompt`、`extractTaskPacket`、`stampCanonicalTaskId`、`stripDelegationKeys`、`applyRoleDelegation`、模块级 `prepareRoleDelegation`、`stampReportOnlyCorrectionInput`、`inferRoleFromAgent` re-export；`./review.ts` import 收敛到 `buildFreshReviewerTask` 的残留需求（若 prepare 系列删完无引用则整行删）。留：`ROLE_AGENTS`、`buildTaskPacket`、`oracleSuiteMode`。
- `review.ts`：删 `extractReviewRequest` / `extractReviewResult` / `validateReviewRequest`；`REVIEWER_PROMPT` 末尾的「Return only a ReviewResult JSON object: {…}」样例段缩成一句「Respond with a ReviewResult JSON object.」（结构化返回下字段枚举由 launcher schema 约束）；`orchestrate.ts` 的 `reviewAttribution` 原件删（`reviewAttributionOf` 已是权威）。
- `usage.ts`：`exportSessionEvidence` 的 `runRecords` / `acceptance` 选项与 `buildAcceptanceEvidenceMatrix` 块（`:1781`）删，`SessionEvidenceExport` / `SessionEvidenceExportOptions` 同步收缩；`./acceptance.ts` import 整行删。`childUsageFromValue` 留（delegate.ts 在用）。其余若出现只服务收据路径的导出（交回时列），级联删。

### D5. 测试处置（逐文件）

**整删**：`notify.test.mjs`、`completion.test.mjs`、`e2e.pi-subagents.test.mjs`（旧 prompt 合同对 pi-subagents 的 e2e，新链 e2e 由 10 的宿主验收承担）、`rs04.test.mjs`（completion + normalizeWorkerReport + floors 派发）、`rs05.test.mjs` + `rs05-identity.test.mjs`（EVENT_FIXTURES / run-record 身份）、`rr05.test.mjs`（classifyHostAction + resume）、`rt03.test.mjs`（report 修复/抽取；若有 validate* 幸存用例可留文件，无则删）、`rt04.test.mjs`（探索预算 + extractTaskSpecDetails）、`nx02-03.test.mjs`（detached output + notify 工具）、`tests/` 整树、`test-fixtures.ts`。
**重剪（文件留，用例删）**：
- `index.test.mjs`——先删 `:14` 的旗标行，跑测试，凡是只有旧链语义才成立的用例全删。预期幸存面：PLANNER_PROMPT 断言（`:1690-1713`，注意 reviewer 句已含 planner_delegate 措辞）、`filterPlannerTools` / `restorePlannerTools`、read 上限、guard on/off、`/planner-only` 子命令、verdict 工具、git 工具、拒绝形状（按新语义）、usage/session 渲染。
- `orchestrate.test.mjs`（8,615 行）——同理：删一切 arrange 路径经被删入口的用例。预期幸存：verdict 记录 / 状态渲染 / ledger 恢复 / 并发 API 的薄一层。若剪完残余接近零，允许整文件删——交回时说明取舍。
- `task.test.mjs` / `report.test.mjs` / `roles.test.mjs` / `review.test.mjs`——删被删符号的用例（review.test.mjs 含 06 承接项点名的 `extractReviewResult` 段）。
- `policy.test.mjs` / `policy-cutover.test.mjs`——删 `legacyDecidePolicy` 用例与 `policy-cutover.test.mjs` 的旗标段（含 `:171-203`），cutover 文件的第 (3) 例改写为「无旗标世界里的纯拒绝」。
- `usage.test.mjs` / `ledger-store.test.mjs` / `rs01.test.mjs` / `rs02*.test.mjs` / `rs03.test.mjs` / `nx01.test.mjs` / `nx04-06.test.mjs` / `nx10-attribution.test.mjs` / `rt06.test.mjs`——按同一规则剪：arrange 经被删入口或被删模块的用例删，直测保活面（TaskStore / ledger / evidence / export 新形状）的留。`nx09-scope.test.mjs` 预期整留（scope 归一化与委派无关）。
**规则**：拿不准的用例删——新链覆盖在 `delegate.test.mjs` 与 `policy-cutover.test.mjs`；剪出的空洞若为保活行为，记进交回而不是为本票补测。

### D6. `package.json` / `architecture.test.mjs` / `naming.test.mjs`

- `files`：删 `notify.ts` / `completion.ts` / `reservations.ts` / `acceptance-claims.ts` / `acceptance.ts`（若删）；确认 `delegate.ts` / `subagent-delegation-contract.ts` 在列。
- `scripts.test`：删已删测试文件条目；`test:e2e` 删；`test:release` 改写但**必须仍含 `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1`**（architecture.test.mjs 有断言）。
- `architecture.test.mjs`：reservations.ts 的 C37/C16 断言删，`pkg.files.includes("reservations.ts")` 类断言改为对被删文件的**否定**断言（防复活）；其余包合同断言留。
- `naming.test.mjs`：若枚举/安装清单里点到被删文件，同步。

### 已知缺口（本票明确不补，逐条写进交回；10 或新票决定去留）

- **K1 session-root 硬顶失去执行点。** `evaluateSessionRootBudget` 的 launch 期拒绝只在 `beginDelegationInner`（`:2550` / `:2772-2788`）；删后 `message_end` 的 soft/hard 披露仍在（`index.ts:1573-1589`），但 paid delegation 不再被拦。`delegate.ts` 无任何预算门。
- **K2 BudgetReservations 整体消失**——按 taskId 的累计 token/cost 预占（`reservations.ts` + `:2583` / `:2804` 调用点）随链死；新链没有按次委派的预算占位。K1/K2 是同一个「新链预算门」后续票的输入。
- **K3 探索工具预算死**（`recordExplorationToolCall` / floorLimits.toolBudget）——新链子进程的工具预算只能等 07/G3 的 `toolBudget` 接线。
- **K4 recovery view / runRecords 死**——跨 workspace 绑定诊断能力消失；若 10 需要，按 store-first（`task.executions[].runId`）重建，不是恢复旧机制。
- **K5 acceptance evidence matrix 死**（`acceptance-claims.ts` + `acceptance.ts` + export 的 matrix 块）——注册表枚举的是旧合同行为，多数已随本票删除。
- **K6 `automaticOracleDispatch` 死**——reviewing 后不再自动 steer 一个 oracle 建议；Root 自行 `planner_delegate(role: "validator")`。

## 单测

本票是净删除，不新增用例。`delegate.test.mjs` / `policy-cutover.test.mjs` 是新链的既有覆盖，原则上不动；若剪出来的空洞让某个**保活**公共 API 完全无测，在交回里列出，不在本票补。

## 验收

```sh
npm run typecheck && npm test                                          # exit 0
git grep -n 'PI_PLANNER_ONLY_LEGACY_SUBAGENT'                          # 0
git grep -nE 'from "\./(notify|completion|reservations|acceptance-claims|acceptance|test-fixtures)\.ts"'  # 0
git grep -nE '\b(beginDelegationInner?|prepareRoleDelegation|handleSubagentResult|handleAsyncNotify|registerCompletionReceipt|recoverPendingRun|reingestOriginalReport|reconcilePendingDelegations|authorizedWaitId|resolveValidatorReviewedTask|ingestCompletionReceipt|extractReviewResult|extractReviewRequest|validateReviewRequest|extractWorkerReport|extractTaskSpecDetails?|topLevelJsonCandidates|inferTaskRoleFromAgent|jsonCandidates|scanBalancedObjects|extractFinalAssistantText|normalizeWorkerReport|TASK_ID_RE|promptTaskIds|resolveDelegationTarget|isReportOnlyPrompt|extractTaskPacket|stampCanonicalTaskId|stripDelegationKeys|applyRoleDelegation|stampReportOnlyCorrectionInput|planner_recover|BudgetReservations|ACCEPTANCE_CLAIMS|RunRecordStore|classifyHostAction|isDelegationCall|isExecutionCreatingAction|compositeWorkflowBlockReason|parseSubagentNotify|readChildMeta|childFromMeta|tempRootFromAsyncDir)\b' -- '*.ts' '*.mjs'   # 0
git diff -- '*.ts' | grep -E '^\+.*(JSON\.parse|\.match\(|new RegExp|\.split\()'   # 0 行——固定条：本票不新增任何对 prompt / 子进程输出文本的解析
wc -l *.ts *.test.mjs                                                  # 交回时给出前后对比（基线 22,899 / 27,563）
node -e 'const p=require("./package.json");for(const f of["notify.ts","completion.ts","reservations.ts","acceptance-claims.ts","acceptance.ts","test-fixtures.ts"])if(p.files.includes(f))throw new Error("stale files entry: "+f);if(!p.files.includes("delegate.ts"))throw new Error("delegate.ts missing")'
```

不做宿主运行（10 收）；不自测「拒绝后行为」——cutover 行为已由 05 B 的宿主检查钉死。

## 交回

验收命令原样输出；orchestrate.ts 删除前后的公共方法清单（标注每条去留依据）；私有级联最终清单；LOC 前后对比；K1–K6 各自的处置确认（「删了」/「留了替代」）；测试文件处置表（每文件：整删 / 剪了哪些段 / 整留）；`git diff --stat`；以及两点说明：
1. `renderTaskStatus` 的「Persisted run provenance」与「Delegations:」两段最终形态。
2. `exportSessionEvidence` 新 payload 与旧 payload 的字段差（10 与任何下游消费者要知道）。

## 不做

- 不给 `delegate.ts` 加预算门 / 探索预算 / model·thinking·toolBudget·timeoutMs（K1–K3 的补救是另一张票或 10）。
- 不改 `types.ts` 的合同类型（孤儿别名留给 10）。
- 不动 README / README.zh-CN / CONTEXT.md（10 收）。
- 不动 `delegate.ts` 编排语义；顺手清理仅限：`ROLE_AGENTS.reviewer ?? "reviewer"` 不可达兜底（06 观察）可删，`renderDelegationOutcome` 的 verdict/decision 行序**不调**（观察项，10 决定）。
- 不恢复、不重建任何收据期能力的替代实现（K4 的 store-first 重建是后续票的事）。
- 不动 `.scratch/`、docs/。

## 承接项

- **07**：不受影响（新链 UPDATE/CANCEL）；本票后 `delegate.ts` 是唯一委派入口，07 的改动面更小。
- **10**：K1–K6 去留；`exportSessionEvidence` 新形状；宿主端到端验收；README/CONTEXT 更新（含 Delegation 词条去「packet」措辞、Verdict 流程）。
- **新票候选**：「新链预算门」——把 session-root 硬顶与（若需要）按 taskId 累计预占接到 `runDelegation` 的 launch 前；输入是 K1/K2 的确认与 10 的观察。

## Comments

**2026-09-15 展开（Devin，规划方）。** 由一段话 stub 展开为完整票面。写票时核过：旧链全部入口的生产调用点只剩 index.ts 的八个挂点与测试旗标；`recordRootVerdict` / `renderTaskStatus` / `exportEvidence` / OrchestratorDeps / 指纹清单五处保活侧耦合已逐条定位；`jsonCandidates` / `extractFinalAssistantText` / `validateReviewRequest` 的最后消费者均为将删符号；`buildRunRecord`/`summarizeRuns`/`renderRunSummary` 与 usage.children 渲染分支是幸存面。最大的行为变化是 K1/K2（预算执行点随 beginDelegationInner 死）——有意为之，交 10 / 新票，不在本票补门。
