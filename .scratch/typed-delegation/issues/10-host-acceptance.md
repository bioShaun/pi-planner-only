# 10: 宿主端到端验收 —— 新链跑完一个 Task 的完整生命周期，收 06/07/08 的承接项，更新 README / CONTEXT

Status: done（2026-09-16；六轮 herdr-pair，三处宿主暴露缺陷已修并复验；交回 ../10-handback.md；工作树未提交）
Blocked by: 07（done，工作树未提交——本票开工前须先提交 07）、08（done，ce1cea1）
Type: task

**What to build：** 三块。(A) **宿主验收**：在一个一次性的真实 git 仓库上，用新链把一个 Task 从 `planner_delegate`(worker) → Root 证据比对 → `planner_delegate`(reviewer) → `planner_verdict` → `git_commit` 跑通，正例一条、反例两条，采 jsonl / 账本前后 / usage，并断言 04 交回的 `ownerRootSessionId` 一致性；同时观察票 03 记下的 worker 过度验证（建 hello.txt 用了 28 个 tool call）是否与 packet 文本有关。(B) **承接项收口**：REVIEWER_PROMPT 尾段收缩并重跑 06 的检查 3b；三处 08 留下的孤儿（`RootVerdictRefusalKind.child-pending`、`structuredDelegationMode` 与其 env、report.ts 无消费者导出）按本票裁定删除；K1–K9 / G1–G4 逐项落为「已收 / 记入 README 限制 / 另开票」。(C) **文档**：README.md / README.zh-CN.md / CONTEXT.md 的 Delegation 词条去掉「packet」措辞、加 Verdict 流程、usage export 新形状（K7）、写锁语义（K9）、release gate 现状（K8）。

设计与去向表见 [spec.md 轮 3](../spec.md)。承接来源：[08 交回](../08-handback.md)、[07 交回](../07-handback.md)、[06](06-reviewer-structured.md) 已知缺口段、[04](04-delegate-core.md) 复核第 2 条。

## 现状（写票时核过的事实）

1. **文档仍是旧链措辞。** CONTEXT.md:57「**Delegation**: Launching a child with a role, a bounded packet…」；README.md:135-153 讲 reviewer「packet」、「The parent extracts it, compacts anything over 12k characters… Common deviations are automatically normalised, with applied repairs echoed in a `Report normalised:` line」——这一整段描述的是 08 删掉的 `extractWorkerReport` / `normalizeWorkerReport` / `compactWorkerReport` 路径，**现已不真**（launcher 校验结构化返回，零解析、零修复）。README.zh-CN.md:94 同义。CONTEXT.md:46 的 **ReviewRequest** 词条本身仍对（它是 `buildReviewRequest` 一向渲染的对象），只是「packet」一词要换。
2. **REVIEWER_PROMPT 尾段**（review.ts，`Return only a ReviewResult JSON object:` + 7 行字段枚举样例）在 06 之后是冗余的：字段与枚举由 launcher 的 `REVIEW_RESULT_SCHEMA` 约束，prompt 里的样例只是提示。06 的检查 3b 是在当前 prompt 上验的，08 明确不动它、把改写 + 3b 重跑绑给本票。
3. **三处 08 孤儿**：`types.ts:540` 的 `"child-pending"` 成员（产生它的分支已删，注释仍说 transient）；`orchestrate.ts:262/306-307/1291-1296` 的 `structuredDelegationMode` 字段 + `readStructuredDelegationMode()` + env `PI_PLANNER_ONLY_STRUCTURED_DELEGATION` + `types.ts:531` `DEFAULT_STRUCTURED_DELEGATION_MODE`（全部只在构造器赋值，无读者；orchestrate.test.mjs:178 传了它）；report.ts 的 `compactWorkerReport` / `renderWorkerReport` / `renderValidationResults` / `workerReportShapeReminder` / `isToolCallId` / `isWorkerReport` / `stripContractReminders` 在 `.scratch/` 之外无生产消费者。
4. **`git_commit` 的门**（index.ts:715-724）在目标仓库跑 `npm run typecheck` 与 `npm test`，任一非 0 即拒绝——探针仓库必须自带能过的 `package.json`（两个脚本都 `node -e "process.exit(0)"`），否则正例走不到最后一步。`git_commit` 还要求 Task `state === "completed"`、真值路径在 `executions[].truthPaths/committedPaths`、无门外脏路径。
5. **04 复核第 2 条**：新链 usage 行的 `ownerRootSessionId = deps.ownerRunId`，index.ts:779 取 `ctx.sessionManager?.getSessionId?.() || PROCESS_OWNER_RUN_ID`——后者是进程级随机 UUID；旧链取 provenance 的 sessionId。宿主上二者应相等；若 `getSessionId` 不可用会把一个杜撰 owner 写进账本，本票要断言。
6. **07 的宿主验证发现**：`/exit` 在工具回合中是 steering；结构化委派子代理进程内运行；取消宽限实测 0.12 s。都要进文档限制段或词条。
7. **宿主脚本化方式**（05/07 已用）：`pi -ne -e ~/.pi/agent/npm/node_modules/pi-subagents -e /public/pi/pi-planner-only/index.ts --mode json -p '<逐字提示>' --session-id <name>` 多轮追加同一 session；状态用 host-05/render-status.mjs 渲染；账本 md5 每步取基线。TUI 只在需要 Esc 时用（本票不需要，07 已验）。
8. **release gate**：`test:release` = typecheck + test（K8）；没有 host contract 门。本票不恢复 e2e，宿主验收就是 post-08 的契约覆盖，产物落盘为证。

## 范围

**改**：`review.ts`（REVIEWER_PROMPT 尾段）、`types.ts`（删 `child-pending` 成员、删 `StructuredDelegationMode` / `DEFAULT_STRUCTURED_DELEGATION_MODE`——本票是 08 指定的裁定点）、`orchestrate.ts`（删 structuredDelegationMode 字段/构造器赋值/`readStructuredDelegationMode`/deps 字段）、`report.ts`（删无消费者导出及其私有 helper）、对应测试（`orchestrate.test.mjs:178` 去掉该 deps 字段；`report.test.mjs` / `roles.test.mjs` 里只测被删导出的块删；`review.test.mjs` 若断言 prompt 尾段样例则改）、README.md、README.zh-CN.md、CONTEXT.md。
**不改**：`delegate.ts` 编排语义（除非宿主验收暴露缺陷，那是新一轮的返工，不是本票预设）、`policy.ts`、`floors.ts`、`concurrency.ts`、`usage.ts`。
**新建**：`.scratch/typed-delegation/host-10/`（探针仓库与全部证据）、`../10-handback.md`。

## 承接项裁定（本票执行，交回逐条确认）

| 项 | 裁定 |
|---|---|
| K1 session-root 硬顶无执行点 / K2 累计预占消失 | **另开票「新链预算门」**（不在本票）。README「Usage accounting」段加一句限制：硬顶目前只披露不拦截。 |
| K3 探索工具预算 / G3 model·thinking·toolBudget·timeoutMs | **另开票「Request 字段接线」**。README 加一句：新链暂不传 model/thinking/toolBudget/timeoutMs。 |
| K4 recovery view / runRecords | **已收，不重建。** `TaskRecord.recoveryBinding` 与 renderTaskStatus 的「Recovery binding」行是死显示：本票删该行；`recoveryBinding` 类型字段随 `child-pending` 一起在 types.ts 清理。 |
| K5 acceptance matrix | 已收，不重建。 |
| K6 automaticOracleDispatch | 已收；PLANNER_PROMPT 已写 Root 自派 validator，README「Roles」表补一句。 |
| K7 export 瘦身 | README「Usage accounting」的 `usage export` 说明改为新形状（statuses.task/workerReport/reviewResult/rootVerdict/refusalKind、findings、usage、breakdown、unattributed；无 linkage/requirements/evidenceMatrix/analysis）。 |
| K8 release gate | 不恢复 e2e；README「Tests」段写明 `test:release` = typecheck + test，宿主契约由本票的验收产物覆盖（host-10/）。 |
| K9 写锁收窄 | **接受**：只有 worker 竞争 workspace。README/CONTEXT Delegation 词条写成「at most one worker per cwd」。 |
| G1 snapshot 绑定 | 宿主验收正例观察 accept 是否只靠 A_run↔当前采样；不缺则不补，缺则另开票。本票不接 `captureWorkspaceSnapshot`。 |
| G2 augmentExecutionEvidence 未搬 | 反例 2 专门制造「已用证据恢复的 open finding」：若 reviewer pass 后进 revalidate/blocked 而非 accept，记为保守行为并另开票；不在本票搬。 |
| G4 | 07 已收。 |
| `child-pending` 孤儿 | 删。 |
| `structuredDelegationMode` | 删（字段、env、默认常量、类型）。 |
| report.ts 孤儿导出 | 删（含只服务它们的私有 helper 与测试块）。 |
| `/exit` 是 steering | README 限制段加一句。 |
| REVIEWER_PROMPT 尾段 | 收缩为一句 `Respond with a ReviewResult JSON object; the launcher validates its shape.`，保留「Verdict rules」两句与「Do not modify files」。 |

## 设计

### D1. 代码收口（一轮，机械）
1. review.ts：按上表改尾段；`reviewerPrompt()` 不变。
2. types.ts：删 `"child-pending"` 成员与其注释；删 `StructuredDelegationMode` 类型与 `DEFAULT_STRUCTURED_DELEGATION_MODE`；删 `TaskRecord.recoveryBinding`（若定义在 task.ts 则改 task.ts）与 `RecoveryBindingCheck` 类型（若无其他消费者）。
3. orchestrate.ts：删 deps.structuredDelegationMode、类字段、构造器赋值、`readStructuredDelegationMode`；删 renderTaskStatus 的 `task.recoveryBinding` 行。
4. report.ts：删上列 7 个导出与仅服务它们的私有项；`validateWorkerReport` / `validateWorkerReportIdentity` / `stableStringify` 留。
5. 测试：按 08 的规则剪（整块删，不改写）；`git grep` 归零：`child-pending|structuredDelegationMode|STRUCTURED_DELEGATION|recoveryBinding|compactWorkerReport|renderWorkerReport|renderValidationResults|workerReportShapeReminder|isToolCallId|isWorkerReport|stripContractReminders` 在 `*.ts` `*.mjs`（排除 .scratch）为 0。

### D2. 文档（同一轮）
- CONTEXT.md **Delegation**：「Launching a child with a role and a TaskSpec through `planner_delegate`; the child's WorkerReport returns launcher-validated, never parsed from text; at most one worker per cwd.」_Avoid_ 加「packet」。**ReviewRequest** 词条「packet」→「invocation payload」。新增 **Verdict** 流程一句：worker report → Root evidence compare → optional reviewer → `planner_verdict` (pass/request_changes/blocked) → `git_commit` on completed。
- README.md / README.zh-CN.md：重写 :135-153（英）/ :94 起（中）那段——去掉 extract/compact/normalise/`Report normalised:`/「compact JSON shape reminder」全部描述，改为「WorkerReport arrives launcher-validated in `details.report`; a non-completed status is a tool error, not a parse failure」；Roles 表补 K6 一句；Usage accounting 补 K1/K7 两句；Tests 段补 K8；Cancellation 段补 `/exit` 一句；07 写的取消段保留。措辞由本票执行者起草，规划方审。
- 不改 docs/ 下的历史 spec 与 ADR。

### D3. 宿主验收（第二轮，采证）
探针仓库 `.scratch/typed-delegation/host-10/probe/`：`git init`、`package.json`（`name`、`scripts.typecheck` 与 `scripts.test` 都是 `node -e "process.exit(0)"`）、`src/greet.js`（导出 `greet(name)` 返回 `hello <name>`），初始提交。宿主启动见现状 §7，`PI_PLANNER_ONLY=1`，session-id 每例一个。每步前后取账本 md5。

- **正例 P1（完整生命周期）**：Root 逐字提示：「用 planner_delegate 派 role=worker：objective「给 src/greet.js 增加导出函数 shout(name)，返回大写的 greet(name) 结果，并在 src/greet.test.js 里用 node:assert 写一个测试；运行 node src/greet.test.js 作为验证」，scope.allowedPaths=["src/greet.js","src/greet.test.js"]，validation={"required":true,"commands":["node src/greet.test.js"]}。worker 返回后，派 role=reviewer（taskId 用返回的 id）。reviewer 返回后，用 planner_verdict 记 pass，然后用 git_commit 提交该 Task。每一步只调一个工具，不要自己改参数，不要自己读文件以外的工具。」采集：4 个 tool_call/tool_result 原文；`/planner-only task <id>` 渲染；账本 `<id>.json` 的 executions/reviews/usage.children；`git log -1 --stat` 与 `git status --porcelain`；usage.jsonl 该 Task 的行。判定：worker `details.report.status === "completed"` 且 `changedFiles` 含两文件；reviewer `details.review.verdict === "pass"`；verdict `details.action`（accept）与 `state === "completed"`；git_commit 成功且只含两文件；**`usage.children[*].ownerRootSessionId` 全等于账本 provenance 的 `sessionId`**（04 承接，任一不等即 FAIL 并贴出两值）。G1 观察：accept 的比对依据（renderDecisionBlock 的 evidence 行）。
- **反例 N1（request_changes → 修正 → pass）**：objective 故意要求「不要写测试」的变体，让 reviewer 有 major finding；Root 按 decision 派一次 worker 修正（同 taskId），再 reviewer，再 verdict pass。判定：Task 经 `changes_requested` 回到 `completed`，`reviewRound` = 2，`git_commit` 成功。
- **反例 N2（G2 观察）**：worker 报告漏报一个改动文件（objective 里要求改 src/greet.js 与 README.md 但 allowedPaths 只列 greet.js）→ Root 证据比对产生 undeclared finding → 派 report-only 修正 → reviewer pass → verdict pass。判定：verdict 后是 accept 还是 revalidate/blocked；后者记 G2 保守行为，不算 FAIL。
- **观察 O1（03 的过度验证）**：P1 的 worker 子会话 tool call 数与其中验证类命令数（从 `<jsonl-stem>/<runId>/run-0/session.jsonl` 数）；对比 buildTaskPacket 的 instructions 文本，判断是否 packet 里的 constraints/acceptanceCriteria 诱导了重复验证。只记录，不改。
- **3b 重跑**：06 票的检查 3b 原文（reviewer 结构化返回：一次 REVIEW_INVALID 后一次通过）在新 REVIEWER_PROMPT 下重跑一次，判定同 06。
- 所有 jsonl 提取用 host-05/extract-calls.mjs 或等价脚本，落盘为 host-10/NN-*.json；不要贴 100 KB 原始捕获。

### D4. 交回文档 `10-handback.md`
承接项表逐项「已收 / 记入文档 / 另开票」；宿主 P1/N1/N2/O1/3b 各自证据与判定；ownerRootSessionId 两值；G1/G2 观察结论；新票候选清单（预算门、Request 字段接线、必要时 G1/G2）。

## 单测
本票不新增用例；D1 的删除只删测试块。`review.test.mjs` 若有断言 prompt 尾段样例的用例，改为断言新句子（这是既有用例随文案改，不是新增）。

## 验收

```sh
npm run typecheck && npm test                                                                 # exit 0
git grep -nE 'child-pending|structuredDelegationMode|STRUCTURED_DELEGATION|recoveryBinding|compactWorkerReport|renderWorkerReport|renderValidationResults|workerReportShapeReminder|isToolCallId|isWorkerReport|stripContractReminders' -- '*.ts' '*.mjs' ':!.scratch'   # 0
git grep -n 'Return only a ReviewResult JSON object' -- review.ts                             # 0
git grep -nE 'packet' -- CONTEXT.md                                                            # 仅允许出现在 _Avoid_ 行
git grep -nE 'Report normalised|compacts anything over|automatically normalised|shape reminder' -- README.md README.zh-CN.md   # 0
git diff -- '*.ts' | grep -E '^\+.*(JSON\.parse|\.match\(|new RegExp|\.split\()'               # 0 行——固定条
/bin/ls .scratch/typed-delegation/host-10/                                                     # P1/N1/N2/O1/3b 证据齐
```

## 交回
见 D4；另附 `git diff --stat`、宿主 5 例的 PASS/FAIL/观察 表、README/CONTEXT 改动段原文。

## 不做
- 不接预算门、不接 Request 字段（另开票）。
- 不恢复 e2e / REQUIRE_CONTRACT。
- 不动 delegate.ts 的编排语义；宿主验收若暴露缺陷，作为返工轮由规划方另下 handoff。
- 不改 docs/ 历史文档与 ADR。

## 承接项
- 新票候选 A「新链预算门」（K1/K2）。B「Request 字段接线：model / thinking / toolBudget / timeoutMs」（K3/G3，依赖 07 的 G4）。C（条件）「snapshot 绑定 / augmentExecutionEvidence 搬迁」（G1/G2，视 P1/N2 观察）。

## Comments

**2026-09-15 展开（规划方）。** 由 stub 展开。核过：README:135-153 整段描述的提取/压缩/修复路径在 08 已删，是现存文档里最大的失真；`git_commit` 的门要求探针仓库自带可过的 npm 脚本，否则正例走不到最后一步；三处 08 孤儿无生产读者；REVIEWER_PROMPT 尾段样例与 launcher schema 重复。K/G 承接项在此一次裁定，避免再往后传。

**2026-09-15 D3 修正（规划方，第 3 轮 handoff 前核对代码）。** 两处票面判定与代码不符，按代码改：(a) P1「reviewer 返回后用 planner_verdict 记 pass」——fresh 模式下 reviewer 的 pass 经 `advanceReview`（review.ts `case "pass"` → `action: "accept"`）直接把 Task 置为 completed；随后的 `planner_verdict pass` 会被 `rootVerdictRefusal` 以 `terminal-state` 拒（orchestrate.ts，`isTerminalTaskState`）。05 宿主 3b 已观察到同一现象（检查 4 被 TASK_CLOSED 拒）。P1 判定改为：reviewer pass 后 `state === "completed"` 且 `reviews[0].appliedDecision === "accept"`；planner_verdict 一步预期被 terminal-state 拒，贴原文；git_commit 直接在 completed 上执行。(b) N1「`reviewRound` = 2」——`reviewRound` 只在 request_changes 消耗一轮时 +1（task.ts `record.reviewRound += 1`），一次 request_changes 后终值为 1；判定改为记录原值、预期 1。N1 的 request_changes 由 Root `planner_verdict` 显式记录（fresh 模式允许 Root 先记 request_changes，只有 pass 要求 reviewer 在前），不依赖 reviewer 恰好给出 major finding。

**2026-09-16 D3 修正二（规划方，宿主第二跑 N1 之后）。** 第二跑（host-10/ b 前缀，fresh 模式）P1 与 3b 通过，`git_commit` 在 completed Task 上成功（第 4 轮 Idle 允许 `git_commit` 的修复验证）；`usage.children[*].ownerRootSessionId` 与会话 id 相等（第 4 轮 provenance 同源修复验证）。N1 卡死根因：evidence.ts `compareExecutionTruth` 把 worker 自填的 `evidence.gitStatusHash` 与 launcher 的 sha256-16 采样比，不等即「working tree changed since the report」→ revalidate；worker 无法算出 launcher 的哈希，填了就死循环（P1/3b 的 worker 恰好没填）。裁定：删该比较块（launcher 自身 cReport/cNow 比较保留），types.ts 注释改为「recorded but never compared」，evidence.test.mjs 第 3 用例改为新语义；用 N1 第三跑验收（第 6 轮）。另记：修正轮 worker 若把 changedFiles 报成任务累计集合会触发「over-reported」→ revalidate；本轮用 packet constraint 绕过，语义（累计 vs 本轮窗口）留新票候选 E。
