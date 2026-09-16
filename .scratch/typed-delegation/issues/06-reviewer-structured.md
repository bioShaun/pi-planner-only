# 06: Reviewer 走结构化返回 —— `planner_delegate` 加 `role=reviewer`，ReviewResult 由 launcher 校验直进 `advanceReview`

Status: verified（48a5fc5，审核 2026-09-15）；宿主 3b 保留意见已在 49f3caa 消化（launcher schema 与 validateReviewResult 对齐，见 Comments 末）
Blocked by: 无（04、05 A 段均已落地；05 B 段的宿主检查 3b 在 05 票内跟进）
Type: task

**What to build：** `runDelegation` 增加 reviewer 分支。Root 对一个已有 WorkerReport 的 Task 调 `planner_delegate({ role: "reviewer", taskId })`，`delegate.ts` 用 `buildReviewRequest` 单向渲染 ReviewRequest（含 Root 自己采的 Git 证据包），经结构化委派 API 派给内置 `reviewer` agent，要求子进程按 **ReviewResult 的 JSON schema** 结构化返回；返回值经身份 / 绑定 / 截断三道既有校验后 `store.recordReview` → `advanceReview({ review })`，结果进 `DelegationOutcome.review` 与 `decision`。**零文本解析**：`extractReviewResult` / `extractReviewRequest` 在本票标 `@deprecated`，08 删。

这是 05 B 段的前置：B 段拒掉 `subagent` 之后，reviewer 唯一的路就是这条。

设计与去向表见 [spec.md 轮 3](../spec.md)。ADR：[0001](../../../docs/adr/0001-typed-delegation-contract.md)。

## 现状（写票时核过的事实）

1. **旧链的 reviewer 是「对 Task 的一次调用」，不是 Task、不是 execution。** `types.ts:500-507` 的注释与 `orchestrate.ts:2900-2965` 一致：reviewer 委派不铸 Task、不转状态、不占写锁、不建 execution 记录；只在 `delegations` map 上记一条 `kind: "reviewer"` 并把 `packetBinding`（reviewer 看到的 `reportRevision` / `workspaceDigest`）存到 DelegationRecord 上供回程校验（票 27/32）。新链里 request 与 response 在同一个函数作用域，`packetBinding` 就是个局部变量——这是本票最大的简化。
2. **下行渲染已经是单向的。** `buildReviewRequest`（`review.ts:315`，纯函数）造 ReviewRequest；`buildFreshReviewerTask`（`review.ts:335`）把 `REVIEWER_PROMPT` + ReviewRequest JSON 拼成子进程 task 文本。两者都留（去向表），本票直接用。Git 证据包由 `captureReviewEvidencePacket`（`evidence.ts:733`，模块函数）采；它的 `rounds` / `unresolvedFindings` / `baselineRef` / `attributionIncomplete` 四个输入来自 `orchestrate.ts:1677` 的**私有方法** `reviewAttribution(task)`——纯函数，只读 `task.executions` / `task.findings` / `task.baseEvidence`。
3. **回程校验函数全在 `review.ts`，都是纯的、可直接复用**：`validateReviewResult`（:119）、`validateReviewResultIdentity`（:220）、`validateReviewResultBinding`（:236）、`bindReviewResultFromRequest`（:281）、`advanceReview`（:935，接受 `review`）。旧链回程（`orchestrate.ts:5143-5325`）的顺序是：extract → identity → 「pass 必须有 report」→ binding（用 packetBinding 补省略字段）→ 「pass 不得过截断包」→ 重采证据 + `compareWithRootSamples` + `augmentExecutionEvidence` + `preparePassFindings` + snapshot 绑定检查 → `recordReview` → `setLastComparison` → `advanceReview` → `annotateReviewDecision` → `markRevalidationGranted`。前五步与后四步本票原样搬；中间的「重采证据」一段只搬能用模块函数表达的部分，其余列入「已知缺口」。
4. **ReviewResult 类型（`types.ts:560-585`）有两层字段。** reviewer 可写的：`taskId` / `verdict` / `summary` / `findings[]` / `evidenceFresh` / `reportRevision?` / `workspaceDigest?` / `acknowledgeDrift?` / `attributionGapOverride?`。其余（`requestedVerdict` / `appliedDecision` / `refusedReason` / `refusalKind` / `executionId` / `reportSource` / `completionKind` / `source`）是 Root 侧审计戳，子进程不得写。schema 只镜像前一层，`additionalProperties: false`。三个枚举数组 `REVIEW_VERDICTS` / `FINDING_SEVERITIES` / `FINDING_CATEGORIES` 目前是 `review.ts:30/89/90` 的模块私有常量，本票导出，schema 与 `validateReviewResult` 共用同一份，测试断言二者相等。
5. **新链没有 workspace snapshot。** 旧链在 report 落账时 `store.setSnapshot`（`orchestrate.ts:5473`），accept 时 `compareSnapshotBinding` 判 fresh；`delegate.ts` 从未调 `setSnapshot`，所以经 `planner_delegate` 派的 Task `task.snapshot` 恒为 undefined，`workspaceDigest` 全链缺席。`validateReviewResultBinding` 对缺席 digest 是宽容的（`review.ts:264` 的注释即此意），所以本票不会因此误拒；但 accept 时的新鲜度就只剩 A_run/C_report 与当前采样的比对。见「已知缺口 G1」。
6. **04 的 request 不设 `model` / `thinking` / `toolBudget` / `timeoutMs`**（`delegate.ts:308-317`），子进程用 agent 默认；reviewer 同样。见 G3。

## 范围

改：`delegate.ts`（`PLANNER_DELEGATE_PARAMETERS.role` 加 `"reviewer"`；新增 `REVIEW_RESULT_SCHEMA`；`runDelegation` 加 reviewer 分支；`DelegationOutcome` 加 `review?`；`renderDelegationOutcome` 渲染 review）、`review.ts`（导出三个枚举数组；新增纯函数 `reviewAttributionOf`；`extractReviewRequest` / `extractReviewResult` 加 `@deprecated`）、`index.ts`（`planner_delegate` 的 `details` 加 `review`；工具 description 提 reviewer）、`delegate.test.mjs`。
**不改**：`orchestrate.ts`、`task.ts`、`report.ts`、`roles.ts`、`evidence.ts`、`workspace-snapshot.ts`、`policy.ts`。需要它们提供新能力时停下交回。`orchestrate.ts:1677` 的 `reviewAttribution` **不删不改**，本票在 `review.ts` 放一份纯函数副本，08 删 orchestrate 那份。

## 设计

### D1. `REVIEW_RESULT_SCHEMA`（`delegate.ts`，与 `WORKER_REPORT_SCHEMA` 并排）

```ts
export const REVIEW_RESULT_SCHEMA = structuredClone(Type.Object(
	{
		taskId: Type.String({ pattern: TASK_ID_PATTERN }),
		verdict: Type.Unsafe<ReviewVerdict>({ type: "string", enum: [...REVIEW_VERDICTS] }),
		summary: Type.String(),
		evidenceFresh: Type.Boolean(),
		findings: Type.Array(Type.Object(
			{
				severity: Type.Unsafe<FindingSeverity>({ type: "string", enum: [...FINDING_SEVERITIES] }),
				category: Type.Unsafe<FindingCategory>({ type: "string", enum: [...FINDING_CATEGORIES] }),
				description: Type.String({ minLength: 1 }),
				requestedChange: Type.Optional(Type.String()),
				evidence: Type.Optional(Type.Array(Type.String())),
			},
			{ additionalProperties: false },
		)),
		reportRevision: Type.Optional(Type.Integer({ minimum: 1 })),
		workspaceDigest: Type.Optional(Type.String()),
		acknowledgeDrift: Type.Optional(Type.Object(
			{ successorTaskId: Type.Optional(Type.String()), commit: Type.Optional(Type.Boolean()) },
			{ additionalProperties: false },
		)),
		attributionGapOverride: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
)) as SubagentDelegationJsonSchemaObject;
```

用 `Type.Unsafe({ enum })` 而不是 `Type.Union(Literal)`：得到的是 `enum: [...]` 平数组，测试可以直接与导出的枚举数组 `deepEqual`，launcher 侧也更省。`structuredClone` 的理由同 `WORKER_REPORT_SCHEMA` 上方注释（TypeBox 的 `~kind` 标记会让 launcher 报 `result.schema must be plain JSON data.`，票 03 实证）。

### D2. 参数

`role` 的 union 加 `Type.Literal("reviewer")`，description 加一句：「reviewer reviews an existing Task's latest WorkerReport; taskId is required and objective / scope / constraints / acceptanceCriteria / validation / instructions are ignored — the Task's stored spec is the reviewer's context.」其余字段形状不动（保持 schema 单一对象，不做按 role 的条件必填；reviewer 调用时 Root 照样填 `objective`，本票忽略——见「承接项」的 prompt 提示）。

### D3. `runDelegation` 的 reviewer 分支（每步有单测）

在现有第 1 步「Task 绑定」之后按 `role === "reviewer"` 分叉；下面 R1–R9 是该分叉的全部内容，worker / explorer / validator 路径一行不动。

- **R1 绑定与前置。** `params.taskId` 缺 → `DelegationRefused("TASK_REQUIRED")`；不存在 → `TASK_UNKNOWN`；workspace 不符 → `TASK_FOREIGN_WORKSPACE`（三者复用现有判定）。`isTerminalTaskState(task.state)` → `REVIEW_TERMINAL`；`task.reports.length === 0` → `REVIEW_NO_REPORT`（旧链是回程才拒 pass，本票前移：没有 report 就没有可审的东西，也没有 `reportRevision` 可绑）。blocked / failed / changes_requested / reviewing 都允许审。以上拒绝都在 `launch` 之前，`launch` 调用计数为 0。
- **R2 不做的事。** 不 `concurrency.reserve`，不 `beginExecution`，不 `captureEvidence` 做 A_run，不 `transition`。reviewer 是对 Task 的一次调用。
- **R3 组 ReviewRequest。**
  ```ts
  const attribution = reviewAttributionOf(task);                       // review.ts 新增纯函数，见 D4
  const git = await captureReviewEvidencePacket(deps.gitRunner, task.cwd, task.lastComparison, {
    ...(attribution.baselineRef ? { baselineRef: attribution.baselineRef } : {}),
    ...(task.spec?.additionalWorktreeRoots?.length ? { additionalWorktreeRoots: task.spec.additionalWorktreeRoots } : {}),
    ...(attribution.rounds.length > 0 ? { rounds: attribution.rounds } : {}),
    ...(attribution.unresolvedFindings.length > 0 ? { unresolvedFindings: attribution.unresolvedFindings } : {}),
    ...(attribution.attributionIncomplete ? { attributionIncomplete: attribution.attributionIncomplete } : {}),
  });
  const report = task.reports.at(-1)!;
  const packetInput: FreshReviewerTaskInput = {
    taskId: task.taskId, spec: task.spec, report,
    reportRevision: task.reports.length,
    ...(task.snapshot ? { workspaceDigest: task.snapshot.digest } : {}),
    ...(task.lastComparison ? { evidence: describeComparison(task.lastComparison) } : {}),
    git,
  };
  const packetBinding = { reportRevision: task.reports.length, ...(task.snapshot ? { workspaceDigest: task.snapshot.digest } : {}) };
  const packetTruncated = git.patchTruncated === true || (git.patchOmittedPaths?.length ?? 0) > 0;
  ```
  `describeComparison` 是 `evidence.ts:1906` 的导出。`additionalWorktreeRoots` 从 `task.spec` 取（旧链 `additionalWorktreeRootsOf(task)` 是模块私有函数，其实现就是读 spec；若执行方发现它还读别处，停下交回）。
- **R4 request。** `agent: ROLE_AGENTS.reviewer`（= `"reviewer"`）、`task: buildFreshReviewerTask(packetInput)`、`context: "fresh"`、`cwd: task.cwd`、`result: { kind: "structured", schema: REVIEW_RESULT_SCHEMA }`。`params.objective` 等**不进 task 文本**（测试断言）。
- **R5 终态。** `status !== "completed"` → **不转 Task 状态**（与旧链一致：reviewer 失败从不改 Task），直接 `throw DelegationRefused(status.toUpperCase(), …)`；`launch` 抛异常同样原样上抛。usage 不落账（与 04 一致，见 G4）。
- **R6 校验（顺序固定，任一失败：usage 先落账，review 不落账，Task 不变，然后 throw）。**
  1. `response.result.kind !== "structured"` 或 `validateReviewResult(value)` 非空 → `REVIEW_INVALID`（launcher 已按 schema 校过，这是零成本的二道闸，不是解析）。
  2. `review = { ...value, source: "reviewer" }`；`validateReviewResultIdentity(review, task.taskId)` → `REVIEW_IDENTITY`。
  3. `fresh = deps.store.require(task.taskId)`（launch 之后重读）；`currentBinding = { reportRevision: fresh.reports.length, ...(fresh.snapshot ? { workspaceDigest: fresh.snapshot.digest } : {}) }`；`bound = bindReviewResultFromRequest(review, packetBinding)`；`validateReviewResultBinding(bound, currentBinding)` → `REVIEW_BINDING`。
  4. `bound.verdict === "pass" && packetTruncated` → `REVIEW_PACKET_TRUNCATED`（request_changes / blocked 照常落账）。
- **R7 accept 时的证据重采（三种 verdict 都做，只有 pass 会被它挡）。**
  ```ts
  const latest = fresh.executions.filter((e) => !e.auxiliary && !e.reportOnly && e.reportIndex === fresh.reports.length - 1).at(-1);
  const current = await captureEvidence(deps.gitRunner, sampleOptions(`review-${executionId}`));   // sampleOptions 是 worker 分支的闭包（delegate.ts:285）；reviewer 分支照同一形状另写一份，cwd / additionalWorktreeRoots / scopePaths 全从 task.spec 取
  const comparison = latest
    ? compareEvidence(latest.aRun, current, report, { ...(fresh.spec?.scope ? { scope: fresh.spec.scope } : {}), ...(roots ? { additionalWorktreeRoots: roots } : {}), ...(latest.readOnly ? { readOnly: true } : {}) })
    : undefined;
  if (comparison) deps.store.setLastComparison(task.taskId, comparison);
  if (!latest) warnings.push(`report revision ${fresh.reports.length} has no per-execution evidence record; a pass cannot be judged fresh`);
  ```
  `latest` 找不到时（只可能是旧链造的 Task 或 ledger 恢复不全）：**pass → `REVIEW_NO_EXECUTION_EVIDENCE`**，request_changes / blocked 照常。执行方交回时说明：`decideReview` 在 `review.verdict === "pass"` 且 `comparison` 为 undefined 时走哪条分支（`review.ts:807-845`）——若它本来就不会 accept，这条拒绝可以改成只 warning；若会 accept，拒绝必须留。
- **R8 落账与判定。** `deps.store.recordReview(task.taskId, bound)` → `advanceReview({ store, taskId, report, ...(comparison ? { comparison } : {}), review: bound })` → `deps.store.annotateReviewDecision(taskId, decision.action)` → `decision.action === "revalidate" && decision.evidenceKey` 时 `deps.store.markRevalidationGranted(taskId, decision.evidenceKey)`。这四步与 `orchestrate.ts:5297-5310` 逐一对应。
- **R9 usage。** `childUsageFromValue(response.usage, "reviewer", { runId, toolCallId: executionId, agent, model, thinking, source: "sync-details", pending: false, taskId, executionId, ownerRootSessionId: deps.ownerRunId })` → `deps.usage.recordChild`。注意这里 `executionId` 是工具的 toolCallId，但 reviewer **没有** execution 记录；执行方 `grep -n executionId usage.ts ledger-store.ts` 看消费方是否按 executionId 反查 execution，交回时说明（若有反查，改传 `undefined` 并说明）。

**Outcome：** `DelegationOutcome` 加 `review?: ReviewResult`；reviewer 分支返回 `{ task: reviewed, executionId, runId, review: bound, comparison: undefined, decision, usage, warnings }`（`report` 不放——那是 worker 的产物，放了 Root 会误读成「reviewer 交了 report」）。

### D4. `review.ts` 改动

- `export const REVIEW_VERDICTS / FINDING_SEVERITIES / FINDING_CATEGORIES`（只加 `export`，值不动）。
- 新增 `export function reviewAttributionOf(task: TaskRecord): { baselineRef?: string; rounds: ReviewRoundAttribution[]; unresolvedFindings: string[]; attributionIncomplete?: string }`——`orchestrate.ts:1677-1735` 私有方法的函数体**逐字**搬过来（它不引用 `this` 以外的实例状态；若发现引用了，停下交回）。`review.ts` 已 import `TaskRecord` 类型。
- `extractReviewRequest` / `extractReviewResult` 上加 `/** @deprecated ticket 06 — legacy text path (orchestrate.ts only); deleted in ticket 08. */`。不改实现。
- `buildFreshReviewerTask` / `buildReviewRequest` / `REVIEWER_PROMPT` 不动。`REVIEWER_PROMPT` 末尾那段「Return only a ReviewResult JSON object: {…}」在结构化返回下多余但无害（launcher 用 schema 约束输出），本票不改，08 顺手缩。

### D5. `index.ts`

- `planner_delegate` 的 `details` 加 `review: outcome.review`；description 里「worker, explorer, and validator tasks」改为「worker, explorer, validator, and reviewer tasks」；`promptGuidelines` 加一句「role=reviewer takes taskId and reviews the Task's latest WorkerReport; the launcher-validated ReviewResult arrives in details.review.」
- `renderDelegationOutcome`：有 `review` 时追加 `review: <verdict> (evidenceFresh: <bool>) — <summary>` 与 `summarizeFindings(review.findings)` 各行（`review.ts:425` 现有导出）。

### 已知缺口（本票明确不补，逐条写进交回；10 决定去留）

- **G1 snapshot 绑定。** 新链无 `setSnapshot`，`workspaceDigest` 全链缺席；accept 新鲜度只靠 R7 的 A_run 对当前采样比对。若 10 认为必须，另开票把 `captureWorkspaceSnapshot` / `setSnapshot` 接到 `delegate.ts` 的 worker 分支（report 落账处）；否则 08 连 `workspace-snapshot.ts` 一起评估。
- **G2 `augmentExecutionEvidence` / `preparePassFindings` 未搬。** 二者是 orchestrate 私有方法，深耦合 `executionForLatestReport` / `openFindings` / `resolveFindings`。后果：一个有「已用证据恢复的 open finding」的 Task，reviewer pass 后 `decideReview` 会给 revalidate / blocked 而不是 accept——**保守方向**，不会错误接受。10 的宿主验收若撞到，再开票。
- **G3 `model` / `thinking` / `toolBudget` / `timeoutMs`** 不设（04 继承）。role-models / floors 的接入不在本票。
- **G4 非 completed 终态的 usage 不落账**（04 继承；cancelled / timed_out 的子进程也花了钱）。07 做 cancel 时一并处理。

## 单测（`delegate.test.mjs`，假 launcher；用现有 worker 正例先把 Task 推到 reviewing）

1. **pass 正例**：fixture ReviewResult 省略 `reportRevision`（模拟 reviewer 没写）。断言：`launches[1].agent === "reviewer"`；`launches[1].result.schema` 与 `REVIEW_RESULT_SCHEMA` deepEqual；task 文本含 `"reportRevision": 1` 且**不含** `params.objective` 的字符串；`outcome.review.source === "reviewer"`、`outcome.review.reportRevision === 1`（从 packetBinding 补的）；`task.reviews.length === 1`；`decision.action === "accept"`、`task.state === "completed"`；`task.executions.length` 与审前相同；`concurrency.reserve` 调用计数不变；usage 记了一条 `kind === "reviewer"`。
2. **request_changes**：一个 `major` finding → `task.state === "changes_requested"`，review 落账，`decision.action` 为对应动作。
3. **前置拒绝**：`TASK_REQUIRED`（无 taskId）、`REVIEW_NO_REPORT`（新铸 Task 直接审）、`REVIEW_TERMINAL`（completed 的 Task）——三者 `launch` 计数 0。
4. **身份**：fixture `taskId` 指向别的 Task → 抛 `REVIEW_IDENTITY`；`reviews.length` 不变、state 不变、usage 已记。
5. **绑定**：先跑两轮 worker（两条 report），fixture 显式 `reportRevision: 1` → `REVIEW_BINDING`；不带 `reportRevision` 的 pass → 补成 2 → accept。
6. **截断包**：假 gitRunner 让 `captureReviewEvidencePacket` 产出 `patchTruncated: true`（照 `evidence.test.mjs` 里现有的造法）；pass → `REVIEW_PACKET_TRUNCATED`；同一包上的 request_changes → 落账。
7. **launcher 非 completed**（`structured_output_failed`）：抛出；Task 仍 reviewing；`reviews.length === 0`。
8. **schema 镜像**：`REVIEW_RESULT_SCHEMA.properties.verdict.enum` deepEqual `REVIEW_VERDICTS`，severity / category 同理；`required` 恰为 `["taskId","verdict","summary","evidenceFresh","findings"]`（与 `validateReviewResult` 的必填一致）；`additionalProperties === false`；`JSON.parse(JSON.stringify(schema))` deepEqual schema（无 `~kind`）。
9. **无 execution 记录的 pass**：手工往 store 塞一条没有 execution 的 report（或用 `store.recordReport` 直接落）→ pass → `REVIEW_NO_EXECUTION_EVIDENCE`（或按 R7 交回说明降级为 warning）。

`index.test.mjs`：若有断言 `planner_delegate` 注册参数的用例，role enum 加 `reviewer`；没有则不加。

## 验收

```sh
npm run typecheck && npm test                                                    # exit 0
grep -n 'extractReviewResult\|extractReviewRequest' delegate.ts                  # 0
grep -n '@deprecated' review.ts                                                  # 恰 2 处：extractReviewRequest / extractReviewResult
grep -n 'export const REVIEW_VERDICTS\|export const FINDING_SEVERITIES\|export const FINDING_CATEGORIES\|export function reviewAttributionOf' review.ts   # 4 处
git diff -- '*.ts' | grep -E '^\+.*(JSON\.parse|\.match\(|new RegExp|\.split\()' # 0 行——固定条：本票没有新增任何对 prompt / 子进程输出文本的解析
git diff --stat                                                                  # delegate.ts delegate.test.mjs review.ts index.ts（index.test.mjs 视情况）
node --experimental-strip-types --input-type=module -e 'const {REVIEW_RESULT_SCHEMA}=await import("./delegate.ts");const s=JSON.stringify(REVIEW_RESULT_SCHEMA);console.log(s.length, s.includes("~kind"))'   # <n> false
```

不做宿主运行——05 B 段的检查 3 之后会接一个 reviewer 正例（B 段票面届时补一条检查 3b），10 做端到端。

## 交回

七条验收命令原样输出；`delegate.ts` reviewer 分支全文（R1–R9 对应行号）；`review.ts` diff；`delegate.test.mjs` 用例清单；以及四点说明：
1. R9：usage 行的 `executionId` 是否被 `usage.ts` / `ledger-store.ts` 的消费方反查 execution；最终传了什么。
2. R7：`decideReview` 对「pass 且无 comparison」的实际分支，`REVIEW_NO_EXECUTION_EVIDENCE` 留还是降级。
3. `reviewAttributionOf` 搬运时是否有除 `task` 以外的依赖。
4. 正例 fixture 的 `buildFreshReviewerTask` 文本字节数（reviewer 包大小，10 看 worker 过度验证问题时要参照）。

## 不做

- 不改 `orchestrate.ts` / `task.ts` / `report.ts` / `roles.ts` / `evidence.ts` / `workspace-snapshot.ts` / `policy.ts`。
- 不删 `extractReviewRequest` / `extractReviewResult`、不删 `orchestrate.ts` 的 reviewer 回程与 `reviewAttribution`（08）。
- 不补 G1–G4。
- 不改 `PLANNER_PROMPT`（Roles 句已在 05 A 段改为「reviewer → builtin reviewer」，措辞对新链同样成立；B 段若需再改，在 B 段）。
- 不做宿主运行。

## 承接项

- **05 B 段**：宿主检查加 3b「对检查 3 的 Task 派 `role=reviewer`，断言 `details.review.verdict` 存在、`task.reviews` 有一条 `source: "reviewer"`、会话中无 `subagent` 调用」。
- **05 B 段 / 10**：Root 在 reviewer 调用时仍要填 `objective` 等被忽略的字段（D2）。若宿主上 Root 因此困惑，B 段的 `promptGuidelines` 加一句「for role=reviewer pass objective "review" and empty arrays」；或另开小票把这些字段改为可选并在 runDelegation 里对非 reviewer 角色拒绝缺省——本票不做。
- **07**：G4（非 completed 终态的 usage）。
- **08**：删除清单加 `review.test.mjs:114-121`（`extractReviewResult` 用例）、`REVIEWER_PROMPT` 末尾的 JSON 样例段、`orchestrate.ts` 的 `reviewAttribution` 原件。
- **10**：G1 / G2 / G3 的去留。

## Comments

**2026-09-15 实现回执（Devin，执行方）。** commit `48a5fc5`；diffstat 恰 `delegate.ts` / `delegate.test.mjs` / `review.ts` / `index.ts` 四个文件（`index.test.mjs` 没有 planner_delegate 参数断言，按票面未动）。验收七条全过：`npm run typecheck` exit 0；`npm test` exit 0（37 文件，含 delegate.test.mjs 新增 9 组用例）；`extractReviewResult|extractReviewRequest` 在 delegate.ts 0 命中；`@deprecated` 在 review.ts 恰 2 处（:430/:456）；四个导出命中 :31/:90/:91/:304；`git diff -- '*.ts'` 新增行无 `JSON.parse` / `.match(` / `new RegExp` / `.split(`；`REVIEW_RESULT_SCHEMA` 序列化 1064 字节、无 `~kind`。

四点说明：

1. **R9**：`usage.ts:1633` 的导出确实按 `run.executionId` 反查 `task.executions`（`ledger-store.ts` 无此字段）。reviewer 没有 TaskExecutionRecord，usage 行只带 `toolCallId`（= 宿主 toolCallId）与 `taskId` / `ownerRootSessionId`，`executionId` 不传——避免一条指向不存在 execution 的假绑定。
2. **R7**：`decideReview` 对「pass 且无 comparison」会径直落 `accept`——stale 块要求 `input.comparison` 非空（review.ts:648），truthFindings 块同理（:730），verdict switch 的 pass 分支（:827）不再问证据。**拒绝保留为 `REVIEW_NO_EXECUTION_EVIDENCE`**，未降级。
3. **`reviewAttributionOf`** 逐字搬自 `orchestrate.ts:1677-1728`，只读 `task.executions` / `task.findings` / `task.baseEvidence`，无 `this` 以外的依赖；原件未动，08 删。
4. **包大小**：正例 fixture 的 `buildFreshReviewerTask` 文本 3804 字节（committed repo、单 execution、无 findings 的最小包）。

与票面的偏差（按意图收敛）：

- `REVIEW_RESULT_SCHEMA` 的断言用 `as unknown as`（与 `WORKER_REPORT_SCHEMA` 一致）——`TObject` 与 `Record<string, unknown>` 互相不可直接 `as`。
- R6.1 新增拒绝码 `REVIEW_INVALID`（票面六个之外）：`result.kind` 非 structured 或 `validateReviewResult` 非空时的二道闸，usage 已落、review 不落。
- usage 在 `status === "completed"` 之后、所有回程校验之前统一落账一次——等价于票面的「任一失败 usage 先落账」，且覆盖 R7 的 `REVIEW_NO_EXECUTION_EVIDENCE`。
- 测试 helper 的 `gitRunner` 按调用方 `cwd` 执行（既有 `makeDeps` 忽略 cwd，多 root 探测会错跑主 repo）；fixture 仓库先 seed 一个 commit——unborn HEAD 下 `aRun.finalGitRef` 缺席会让每个包都 attributionIncomplete。

已知缺口（本票明确不补，逐条）：**G1** 新链无 workspace snapshot，`workspaceDigest` 全链缺席，accept 新鲜度只剩 A_run↔当前采样比对；**G2** `augmentExecutionEvidence` / `preparePassFindings` 未搬，带 open finding 的 Task 被 pass 时偏保守（revalidate/blocked 而非 accept）；**G3** request 不设 `model` / `thinking` / `toolBudget` / `timeoutMs`；**G4** 非 completed 终态不落 usage（07 收）。

**2026-09-15 验收（Claude，审核方）。判定：通过。** 七条验收命令在审核方本机独立复跑（日志 `.scratch/typed-delegation/06-review-typecheck.log` / `06-review-npm.log`）：`npm run typecheck` exit 0；`npm test` exit 0（05 B 落地后为 38 文件，`delegate.test.mjs: all cases passed`）；`delegate.ts` 中 `extractReviewResult|extractReviewRequest` 0 命中；`@deprecated` 恰 `review.ts:430/:456`；四个导出命中 `:31/:90/:91/:304`；`git diff 10d8509 48a5fc5 -- '*.ts'` 新增行 0 条 `JSON.parse` / `.match(` / `new RegExp` / `.split(`；diffstat 恰 `delegate.ts` / `delegate.test.mjs` / `review.ts` / `index.ts`（+736/−11）；`REVIEW_RESULT_SCHEMA` 序列化 1064 字节、无 `~kind`。与回执逐项一致。

逐点核对（`delegate.ts:539` `runReviewInvocation`，按 R 标注行号）：
- **R1** `:547-561`：`REVIEW_TERMINAL` 用 `isTerminalTaskState`，`TERMINAL_TASK_STATES` 只有 `completed` / `closed-superseded`（`types.ts:598`），所以 blocked / failed / changes_requested / reviewing 都可审，与票面一致；`REVIEW_NO_REPORT` 在 launch 前。`TASK_REQUIRED` 提到绑定之前（`:275`），拒绝不消耗 id——比票面更早，接受。
- **R2**：分支内无 `reserve` / `beginExecution` / `transition`；`captureEvidence` 只在 R7 采当前样，不采 A_run。
- **R3** `:563-589` 与票面逐字对应；`spec` 用条件展开（`FreshReviewerTaskInput.spec` 本就可选，`review.ts:360`），不是偏差。
- **R4** `:591-603`：`agent: "reviewer"`、`context: "fresh"`、structured schema；`delegate.test.mjs:492` 断言 `objective` 标记串不进包。
- **R5** `:605-613`；**R9** `:615-633` 放在 R6 之前——等价票面「任一失败 usage 先落账」，且覆盖 R7 的拒绝，接受。
- **R6** `:635-667` 顺序 `REVIEW_INVALID` → `REVIEW_IDENTITY` → 重读 store → `REVIEW_BINDING` → `REVIEW_PACKET_TRUNCATED`。`REVIEW_INVALID` 是票面外新增码，只在 launcher 已校过的值上做二道闸，不是解析，接受。
- **R7** `:669-705`：`scopePaths` 形状与 worker 分支（`:345-357`）一致，来源改为 `task.spec`；`latest` 用 `fresh.executions` 过滤 `!auxiliary && !reportOnly && reportIndex === reports.length-1`；`REVIEW_NO_EXECUTION_EVIDENCE` 保留（见说明 2）。
- **R8** `:707-717` 四步与 `orchestrate.ts:5297-5310` 逐一对应。
- **`reviewAttributionOf`**：审核方把 `orchestrate.ts:1677` 原件与 `review.ts:304` 副本去掉一层缩进与 `this.` 后 diff，52 行逐字相同。
- **`index.ts`** 三处（description / promptGuidelines / `details.review`）与 D5 一致；`index.test.mjs` 无 `planner_delegate` 参数断言，未动正确。
- **单测九组**（`delegate.test.mjs:462-748`）与票面 1–9 一一对应；schema 镜像（`:709-722`）用导出数组 deepEqual，`required` 与 `additionalProperties` 都断了。

四点说明核对：
1. **R9**：`usage.ts:1633` 确按 `run.executionId` 反查 `executions`，`:1637` 的 identityIndex 同理——不传 `executionId` 正确。附带后果（回执没写）：`usage.ts:1630` 导出时 reviewer 行的 `executionId` 落为 `"unknown-execution"`，`toolCallId` 经 `:1654` 仍保留。10 对账时按 `toolCallId + taskId` 找 reviewer 行。
2. **R7**：审核方实看 `review.ts:892` pass 分支——不读 `comparison` 直接 accept；`:713` stale 块与 `:795` truthFindings 块都要求 `comparison` 非空。`REVIEW_NO_EXECUTION_EVIDENCE` 必须留，未降级正确。
3. 逐字，见上。
4. 3804 字节：测试无断言，审核方未复核，按回执采纳。

偏差四条（`as unknown as`、`REVIEW_INVALID`、usage 统一落账点、测试 helper 的 cwd / seed commit）均按意图收敛，接受。G1–G4 原样交 10。

不阻塞的观察（三条，不开票，10 看）：
- `renderDelegationOutcome`（`delegate.ts:740-746`）里 decision 行与 verdict 行都以 `review:` 开头且 decision 在前：Root 先读到 `review: accept -> completed`，再读到 `review: pass (evidenceFresh: …)`。08/10 若嫌绕，把 verdict 行提前。
- `ROLE_AGENTS.reviewer ?? "reviewer"`（`:596`）的兜底不可达（`roles.ts:33` 是字面量）；08 顺手删。
- R7 的 `scopePaths` 读 launch 前的 `task.executions`，`latest` 读 launch 后的 `fresh.executions`；reviewer 不加 execution，并发 worker 落新 report 会被 `REVIEW_BINDING` 拦，无实际差异，记一笔即可。

宿主侧的 reviewer 正例按承接项走 05 B6 检查 3b，采集物进 `.scratch/typed-delegation/host-05/`。

**2026-09-15 宿主 3b 回填（Claude，审核方；采集物 `.scratch/typed-delegation/host-05/40-*` / `42-*`）。** 05 B6 检查 3b 两跑：第二跑 PASS（verdict pass → accept → completed，`reviews` 一条 `source: "reviewer"`、`reportRevision` 由 packetBinding 补成 1，executions 不变，不铸 Task）；**第一跑被 R6.1 `REVIEW_INVALID` 拒**：reviewer（deepseek-v4.1-flash:high）返回 `"acknowledgeDrift":{"commit":false,"successorTaskId":""}`，launcher schema 放行（`successorTaskId: {type:"string"}` 无 minLength），`validateReviewResult` 拒「successorTaskId must be a non-empty string when present」。R6 语义在宿主上按票面成立：usage 已落（`children` 出现 `kind: "reviewer"`、无 `executionId`）、review 不落、Task 不动。

保留意见（不阻塞 verified，建议 08 之前修，一行）：`REVIEW_RESULT_SCHEMA` 比 `validateReviewResult` 松——`acknowledgeDrift.successorTaskId` 应为 `Type.String({ minLength: 1 })`，`workspaceDigest` / `taskId` 同理可加 minLength；validator 的「name successorTaskId 或 commit=true」在 JSON schema 里表达不了，所以 R6.1 仍要留。另可在 schema 或 `REVIEWER_PROMPT` 里说明「无 drift 就省略 `acknowledgeDrift`」，避免模型把可选对象填成空值白跑一次 reviewer。

宿主数据补两条：reviewer 包（`buildFreshReviewerTask` 文本）在真实 Task 上 4857 字节（fixture 3804）；Root 照 D2 填了被忽略字段，没有困惑。

**2026-09-15 保留意见消化（Devin）。** commit `49f3caa`：`delegate.ts` `REVIEW_RESULT_SCHEMA` 的 `acknowledgeDrift.successorTaskId` 与 `workspaceDigest` 加 `minLength: 1`（与 `validateReviewResult` 的非空口径对齐；`taskId` 已有 `TASK_ID_PATTERN`，无需再加），`acknowledgeDrift` 对象加 `description` 说明「无 drift 就整个省略」；「name successorTaskId 或 commit=true」的 OR 仍表达不了，R6.1 保留。`delegate.test.mjs` schema 镜像块新增两条 `minLength` 断言钉住 parity。`npm run typecheck` 与 `npm test`（38 文件）全绿。
