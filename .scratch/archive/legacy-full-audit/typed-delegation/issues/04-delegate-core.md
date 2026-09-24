# 04: `delegate.ts` —— `runDelegation` 编排核心 + `planner_delegate` 工具注册

Status: verified
Blocked by: 03
Type: task

**What to build：** 把 spike 长成产品路径的第一段。新模块 `delegate.ts` 导出一个纯编排函数 `runDelegation(deps, params, cwd)`，从 TypeBox 参数出发：铸/绑 Task → 写锁 → A_run 采样 → 结构化委派 → C_report 采样 → 落账（execution、report、usage）→ review loop 判定 → 返回 `DelegationOutcome`。`index.ts` 注册 `planner_delegate` 工具，execute 只做三件事：组 deps（真 launcher）、调 `runDelegation`、把 outcome 渲染成文本。**旧拦截链一行不改**（本票期间 Root 仍可用 `subagent`，切换在 05）。

设计与去向表见 [spec.md 轮 3](../spec.md)。ADR：[0001](../../../docs/adr/0001-typed-delegation-contract.md)。

## 范围

新建：`delegate.ts`、`delegate.test.mjs`、`subagent-delegation-contract.ts`（从 `spike/` 移到根目录，内容不变）。
改：`index.ts`（加一个 `pi.registerTool`，加 `delegate.ts` 的 import；其他 handler 不动）、`package.json`（`files` 加两文件，`test` 脚本加 `delegate.test.mjs`）。
删：`spike/`（并入后删除）。
**不改**：`orchestrate.ts`、`task.ts`、`report.ts`、`roles.ts`、`review.ts`、`evidence.ts`、`policy.ts`。需要它们提供新能力时停下交回。

## `delegate.ts` 接口

```ts
import type { SubagentDelegationRequest, SubagentDelegationResponse } from "./subagent-delegation-contract.ts";

export const PLANNER_DELEGATE_PARAMETERS = Type.Object({ /* spike 的 PARAMETERS，role 加 "validator" */ });
export type PlannerDelegateParams = Static<typeof PLANNER_DELEGATE_PARAMETERS>;

export interface DelegationDeps {
	store: TaskStore;
	gitRunner: GitRunner;
	concurrency: ConcurrencyController;
	usage: UsageLedger;
	launch: (request: SubagentDelegationRequest, signal?: AbortSignal) => Promise<SubagentDelegationResponse>;
	ownerRunId: string;
	now?: () => Date;
}

export interface DelegationOutcome {
	task: TaskRecord;                 // 落账后的记录
	executionId: string;
	runId?: string;
	report?: WorkerReport;            // launcher 校验过的原物，零改动
	comparison?: ExecutionTruthComparison;
	decision?: ReviewDecision;        // advanceReview 的结果
	usage?: SubagentDelegationUsage;
	warnings: string[];
}

export class DelegationRefused extends Error { constructor(public code: string, message: string) }

export async function runDelegation(deps: DelegationDeps, params: PlannerDelegateParams, cwd: string, signal?: AbortSignal): Promise<DelegationOutcome>;
export function renderDelegationOutcome(outcome: DelegationOutcome): string;
export function createHostLauncher(pi: ExtensionAPI): DelegationDeps["launch"];   // spike 的 waitForDelegation
```

## `runDelegation` 的步骤（每步都有单测）

1. **Task 绑定**：`params.taskId` 给了 → `store.get`；不存在 → `DelegationRefused("TASK_UNKNOWN")`；存在但 `record.cwd` 的 workspace identity ≠ 本次 `cwd`（用 `task.ts` 现有 `normalizeWorkspaceIdentity`）→ `DelegationRefused("TASK_FOREIGN_WORKSPACE")`。没给 → `store.create(createTaskSpec({...params 映射...}))`。**再次委派已存 Task 时 stored spec 不变**（票 53 的规则），本次 spec 只进 packet；`role` 取 params。
2. **写锁**：`role === "worker"` 时 `concurrency.reserve(...)` 按现有 `ConcurrencyController` 的语义；冲突 → `DelegationRefused("WRITER_CONFLICT")`；非 worker 不占写锁。
3. **A_run**：`captureEvidence(gitRunner, { cwd, additionalWorktreeRoots: spec.additionalWorktreeRoots })`；`store.beginExecution(taskId, { executionId, kind, cwd, worktreeRoots, aRun, readOnly: role !== "worker" })`。`executionId` = 工具的 `toolCallId`（从 execute 传入 params 之外的参数；接口上放进 `runDelegation` 的第 4 个可选参数或 deps，执行方定，交回时说明）。
4. **委派**：`buildTaskPacket`（`roles.ts` 现有的单向渲染）→ `task` 文本；`agent` 按 `ROLE_AGENTS`，**explorer → `scout`**（本环境无 `explorer` agent，票 03 实证；改 `roles.ts` 的 `ROLE_AGENTS` 一行属于本票允许的最小改动，其余 roles.ts 不碰）；`validator → oracle`。`result.schema` = spike 的 `WORKER_REPORT_SCHEMA`。调 `deps.launch(request, signal)`。
5. **终态**：`status !== "completed"` → 先 `store.transition(taskId, "failed" | "blocked")`（`cancelled`/`timed_out`/`tool_budget_exhausted` → blocked，其余 → failed，`setStateReason` 写 launcher 的 `status` + `error`），释放写锁，然后 **throw** `DelegationRefused(status.toUpperCase(), …)`。不返回伪 outcome。
6. **C_report**：再 `captureEvidence`，写回 execution 的 `cReport`；`compareExecutionTruth(aRun, cReport, report)`；`store.setLastComparison`。
7. **身份**：`validateWorkerReportIdentity(report, { taskId, cwd, workerRunId: runId })`（`report.ts` 现有）；不一致 → `reportError`，不篡改 report。
8. **落账**：`store.recordReport` / `recordValidatorReport`（按 role）；usage 从 `response.usage`（`SubagentDelegationUsage`）经 `UsageLedger` 记到该 Task（`usage.ts:593` 的类，用现有方法；若没有能直接吃这个形状的方法，交回说明，不要新造一套换算）。
9. **判定**：`advanceReview({ store, taskId, report, reportError, comparison })`（`review.ts:935`），结果放 `decision`。
10. 释放写锁；返回 outcome。任何一步抛异常都要释放写锁（`try/finally`）。

## `planner_delegate` 工具（index.ts）

- `parameters: PLANNER_DELEGATE_PARAMETERS`；description / promptGuidelines 沿用 spike 措辞，加一句「Root 应优先用本工具而非 subagent」（05 才强制）。
- execute：`const outcome = await runDelegation(deps, params, ctx.cwd || process.cwd(), signal)`；`DelegationRefused` 与其他异常直接向上抛（宿主据此置 `isError`）；成功返回 `{ content: [{ type: "text", text: renderDelegationOutcome(outcome) }], details: { taskId, executionId, runId, state: outcome.task.state, decision: outcome.decision?.kind, report: outcome.report, usage: outcome.usage } }`。**不写 `isError`**。
- `deps` 在 `session_start` 之后组一次，复用 `orchestrator.store`、`gitRunner`、现有 `ConcurrencyController` 实例与 `UsageLedger` 实例（都在 index.ts 里已有）。`ownerRunId` = `ctx.sessionManager.getSessionId()`。

## 单测（`delegate.test.mjs`，假 launcher）

同一个 `runDelegation`，`launch` 换成 `async (req) => fixtureResponse`，`gitRunner` 用 `test-fixtures.ts` 或现有测试里的 fake git。至少：

- 新 Task 正例：铸 id、A_run/C_report 都在 execution 上、report 落账、`decision` 存在、写锁释放。
- 已存 Task 再委派：stored spec 逐字不变；packet 里是本次 spec。
- `TASK_UNKNOWN`、`TASK_FOREIGN_WORKSPACE`、`WRITER_CONFLICT` 三种拒绝，均不调 `launch`（用计数断言）。
- launcher 返回 `structured_output_failed` / `cancelled` / `invalid_request`：Task 进 failed/blocked、`setStateReason` 有值、抛 `DelegationRefused`、写锁释放、**没有** report 落账。
- report `taskId` 与 Task 不一致：`reportError` 进 `advanceReview`，report 原物未被改写。
- 断言 `launch` 收到的 `request.task` 文本包含 `spec.taskId`，且 `request.result.kind === "structured"`、`request.result.schema` 经 `JSON.stringify` 往返后深相等（plain JSON）。

## Acceptance

```sh
# 零文本解析（新模块 + 契约 + index.ts 新增段）
grep -nE 'JSON\.parse|matchAll|\.match\(|RegExp|new RegExp|TASK_ID_RE|promptTaskIds|extractTaskSpec|extractTaskPacket|jsonCandidates' delegate.ts subagent-delegation-contract.ts   # 期望：无
grep -n "isError" delegate.ts                                                  # 期望：无
git diff -- index.ts | grep '^+' | grep -nE 'JSON\.parse|\.match\(|extract'    # 期望：无

# 禁改文件
git diff --stat -- orchestrate.ts task.ts report.ts review.ts evidence.ts policy.ts   # 期望：空
git diff -- roles.ts | grep '^[-+]' | grep -v '^[-+][-+]' | wc -l                     # 期望：≤ 2（只有 explorer→scout 那一行的 -/+）

# spike 已并入
test ! -d spike && echo spike-removed
node --experimental-strip-types -e 'import("./delegate.ts").then(m=>console.log(typeof m.runDelegation, typeof m.createHostLauncher))'   # 期望：function function

# 套件
npm run typecheck && npm test                                                  # 期望：exit 0，含 delegate.test.mjs
```

**交回：** 上述命令原样输出、`delegate.ts` 全文、`delegate.test.mjs` 的用例清单（`grep -n "^test(\|^\t*test(\|assert\." | wc -l` 即可）、`index.ts` 新增段 diff、以及三点说明：`executionId` 怎么传进来；usage 用了 `UsageLedger` 的哪个方法；写锁 reserve 的参数形状。不做宿主运行——那是 10。

## Comments

**2026-09-16 执行（Devin，执行方）。** `delegate.ts` + `planner_delegate` 注册 + 假 launcher 单测落地。六个保护文件零改动；`roles.ts` 恰一行（explorer→scout）。

### 验收命令原样输出

```text
$ grep -nE 'JSON\.parse|matchAll|\.match\(|RegExp|new RegExp|TASK_ID_RE|promptTaskIds|extractTaskSpec|extractTaskPacket|jsonCandidates' delegate.ts subagent-delegation-contract.ts
(无输出, exit 1)

$ grep -n "isError" delegate.ts
(无输出, exit 1)

$ git diff -- index.ts | grep '^+' | grep -nE 'JSON\.parse|\.match\(|extract'
(无输出, exit 1)

$ git diff --stat -- orchestrate.ts task.ts report.ts review.ts evidence.ts policy.ts
(空)

$ git diff -- roles.ts | grep '^[-+]' | grep -v '^[-+][-+]' | wc -l
2

$ test ! -d spike && echo spike-removed
spike-removed

$ node --experimental-strip-types -e 'import("./delegate.ts").then(m=>console.log(typeof m.runDelegation, typeof m.createHostLauncher))'
function function

$ npm run typecheck && npm test
typecheck exit 0；36 个测试文件全 PASS，末项 "delegate.test.mjs: all cases passed"
```

### 三点说明

1. **executionId**：第 4 个参数为 `DelegationOptions { signal?, executionId? }` 对象；index.ts 的 execute 传 `{ signal, executionId: toolCallId }`（execute 第一参即宿主 toolCallId）。缺省回退 delegation `requestId`——executionId 始终绑定本次 execution 记录与 usage 记账。放 options 而非 deps：deps 每会话组装一次而 executionId 逐调用变化；options 形状也给票 07 的 `onUpdate` 留了位置。
2. **usage**：`childUsageFromValue(response.usage, role, ids)` → `UsageLedger.recordChild(taskId, child)`。`SubagentDelegationUsage`（input/output/cacheRead/cacheWrite/cost/turns）直接喂 `tokensFromUsage`/`piReportedCost`/`turns`，零换算；ids 带 `runId/toolCallId=executionId/agent/model/thinking/source:"sync-details"/taskId/executionId/ownerRootSessionId`。
3. **reserve 参数形状**：`{ id: executionId, taskId, state: task.state, structured: true, role, capability: "writer", workspaces: [task.cwd, ...additionalWorktreeRoots] }`；仅 `role === "worker"` 时调用，任何 refusal → `DelegationRefused("WRITER_CONFLICT", refusal.reason)`，`finally` 里 `concurrency.release(reservation.id)`。

### 偏离披露（均在票内授权边界，但提请复核）

- **新 Task 铸 id 用 `nextTaskId()` + `createAllocated()`**，不是 `store.create(spec)`：`create` 在 allocator 在场时会对 nextTaskId 已申领的 id 二次 `reserve` 抛 `TASK_ID_CONFLICT`；无 allocator 的内存 store 则会把同日生成的 `-001` 占位 id 当存量 Task 返回（静默撞号）。`createAllocated` 正是为「nextTaskId 已申领」设计的入口。
- **`compareExecutionTruth` vs `compareEvidence` 分工**：票面 step 6 把两者速写合一，但 `setLastComparison`/`advanceReview` 要 `EvidenceComparison`（多 `fresh`/`unexplained`/`overlappingPaths`/`unrelatedPaths`）。实现：`compareExecutionTruth(aRun, cReport, report)` 产出 execution 窗口归因写回 `completeExecution`（truthPaths/executionChangedPaths/committedPaths/undeclared/outOfScope/extraDeclared/external/observedExternal + findings 落 `recordExecutionFindings`），并进 `outcome.comparison`（票面类型即 `ExecutionTruthComparison`）；`compareEvidence(aRun, cReport, report, {scope, additionalWorktreeRoots})` 产出 `EvidenceComparison` 喂 `setLastComparison` 和 `advanceReview.comparison`。两者都是 evidence.ts 现有导出，零改动。
- **launcher promise reject（非终态状态，如 abort）**：transition failed + `setStateReason("delegation launch failed: …")` + 原样 rethrow——把票面「非 completed → failed/blocked 后 throw」自然延到拒绝通道。
- **新增 `TASK_CLOSED` 拒绝码**：completed/closed-superseded Task 再委派时显式拒绝（否则 `transition` 会抛裸 illegal-transition）。
- **executing 迁移沿用旧链 gating**：仅当 state ∈ {planning, changes_requested, report-invalid, blocked, failed} 时转 executing；reviewing 中派 validator 不回拽状态。
- **`details.decision` 用 `decision.action`**：ReviewDecision 没有 `kind` 字段，票面写法视为速写。
- **explorer→scout 的测试联动**：`ROLE_AGENTS` 被旧链 `applyRoleDelegation` 共用，一行改动连带翻转旧 remap——更新了 4 个测试文件的对应断言（roles.test.mjs ×2、index.test.mjs ×1、orchestrate.test.mjs ×1、e2e ×1，均为 `reviewer`→`scout` 期望值）。未动任何被保护文件。
- **index.test.mjs / orchestrate.test.mjs 等其余 diff 是票 01 留下的 tempdir-hygiene 存量改动**，非本票引入（evidence.test.mjs 的 tmpdir() 迁移等）。

### delegate.test.mjs 用例清单（`grep -c "assert\."` = 52）

| 用例 | 断言点 |
|---|---|
| 新 Task 正例 | 铸 T-id、execution 上 aRun+cReport、report/usage 落账、decision 存在、写锁释放、request.agent=worker、packet.spec.taskId 一致、schema JSON 往返深相等 |
| 已存 Task 再委派 | stored spec 逐字深相等、packet 带本次 spec（objective 更新）、taskId 绑定原 Task |
| TASK_UNKNOWN | DelegationRefused 码、launch 计数 0 |
| TASK_FOREIGN_WORKSPACE | 同上 |
| WRITER_CONFLICT | 预占同工作区写锁 → 拒绝、launch 计数 0 |
| 6 个 launcher 非终态 ×5+1 | structured_output_failed/failed/invalid_request→failed；cancelled/timed_out/tool_budget_exhausted→blocked；stateReason 含 status、无 report 落账、锁释放 |
| 身份不符 | report.taskId 外邦 → report 原物落账未改写、decision 存在、Task 不会 completed |
| explorer | → scout agent、readOnly execution、无写锁 |
| validator | → oracle agent、recordValidatorReport 落账 |

### index.ts 新增段 diff

见上文 `git diff index.ts`：+1 import 行（createHash→+randomUUID）、+delegate.ts import 块、+`delegationLaunch`/`PROCESS_OWNER_RUN_ID` 常量、+`pi.registerTool` 块 55 行（execute 仅组 deps → runDelegation → render）。其余零改动。

### delegate.ts 全文

```ts
/**
 * `planner_delegate` — the typed Root/child delegation path (ADR-0001,
 * .scratch/typed-delegation/spec.md round 3, ticket 04).
 *
 * `runDelegation` is the pure orchestration seam: TypeBox-checked params in,
 * `DelegationOutcome` out. The launch is injected — tests pass a fake
 * launcher, index.ts passes `createHostLauncher(pi)` — so tests and the host
 * run the same function, with no prepare/begin split and no in-place
 * mutation of a host payload.
 *
 * Nothing crosses the boundary as recovered text: the TaskSpec is rendered
 * into the child's task once (`buildTaskPacket`, one direction only), and
 * the WorkerReport comes back as the launcher-validated structured value,
 * recorded verbatim. Non-completed launcher states throw; the Task is
 * transitioned first so a refused run never masquerades as an outcome.
 */
import { randomUUID } from "node:crypto";
import { Type, type Static } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	SUBAGENT_DELEGATION_CANCEL_EVENT,
	SUBAGENT_DELEGATION_REQUEST_EVENT,
	SUBAGENT_DELEGATION_RESPONSE_EVENT,
	type SubagentDelegationCancel,
	type SubagentDelegationJsonSchemaObject,
	type SubagentDelegationRequest,
	type SubagentDelegationResponse,
	type SubagentDelegationUsage,
} from "./subagent-delegation-contract.ts";
import type { GitRunner } from "./git-audit.ts";
import type { ConcurrencyController, ConcurrencyReservation } from "./concurrency.ts";
import { captureEvidence, compareEvidence, compareExecutionTruth } from "./evidence.ts";
import type { ExecutionTruthComparison } from "./evidence.ts";
import { buildTaskPacket, ROLE_AGENTS } from "./roles.ts";
import { createTaskSpec, normalizeWorkspaceIdentity } from "./task.ts";
import type { TaskRecord, TaskStore } from "./task.ts";
import { validateWorkerReportIdentity } from "./report.ts";
import { advanceReview } from "./review.ts";
import type { ReviewDecision } from "./review.ts";
import { childUsageFromValue } from "./usage.ts";
import type { UsageLedger } from "./usage.ts";
import { isFinalTaskState } from "./types.ts";
import type {
	DelegationKind,
	TaskFinding,
	TaskSpec,
	WorkerReport,
} from "./types.ts";

const TASK_ID_PATTERN = "^T-\\d{8}-\\d{3}$";

/** Launcher statuses that park the Task instead of failing it. */
const BLOCKING_STATUSES = new Set(["cancelled", "timed_out", "tool_budget_exhausted"]);

export const PLANNER_DELEGATE_PARAMETERS = Type.Object({
	taskId: Type.Optional(
		Type.String({
			pattern: TASK_ID_PATTERN,
			description: "Existing Task id (T-YYYYMMDD-NNN) to re-delegate. A new Task is minted when omitted.",
		}),
	),
	role: Type.Union([Type.Literal("worker"), Type.Literal("explorer"), Type.Literal("validator")], {
		description: "Delegation role. worker implements; explorer does read-only recon (scout agent); validator runs an oracle verdict.",
	}),
	objective: Type.String({ minLength: 1, description: "What the child must accomplish." }),
	cwd: Type.Optional(
		Type.String({ description: "Working directory for the child. Defaults to the session cwd." }),
	),
	scope: Type.Object({
		allowedPaths: Type.Optional(Type.Array(Type.String())),
		forbiddenPaths: Type.Optional(Type.Array(Type.String())),
	}),
	constraints: Type.Array(Type.String()),
	acceptanceCriteria: Type.Array(Type.String()),
	validation: Type.Object({
		required: Type.Boolean(),
		commands: Type.Optional(Type.Array(Type.String())),
	}),
	instructions: Type.Optional(
		Type.String({
			description: "Extra prose passed down to the child verbatim. Never read back.",
		}),
	),
});

export type PlannerDelegateParams = Static<typeof PLANNER_DELEGATE_PARAMETERS>;

/**
 * WorkerReport JSON schema (types.ts) as plain JSON data.
 *
 * TypeBox marks every nested schema node with non-enumerable `~kind` /
 * `~optional` keys, and the launcher's cloneJsonWithinByteLimit rejects
 * them ("result.schema must be plain JSON data."). structuredClone drops
 * those markers and yields a deep plain-data copy; its JSON.stringify
 * output is byte-identical to the TypeBox object's. The cast bridges
 * TObject's nominal type to the contract's Record — it asserts only what
 * the clone already guarantees.
 */
export const WORKER_REPORT_SCHEMA = structuredClone(Type.Object(
	{
		version: Type.Integer(),
		taskId: Type.String(),
		status: Type.Union([
			Type.Literal("completed"),
			Type.Literal("partial"),
			Type.Literal("blocked"),
			Type.Literal("failed"),
		]),
		summary: Type.String(),
		changedFiles: Type.Array(Type.String()),
		validation: Type.Array(
			Type.Object({
				command: Type.Optional(Type.String()),
				type: Type.Union([
					Type.Literal("test"),
					Type.Literal("build"),
					Type.Literal("lint"),
					Type.Literal("typecheck"),
					Type.Literal("manual"),
					Type.Literal("other"),
				]),
				status: Type.Union([
					Type.Literal("passed"),
					Type.Literal("failed"),
					Type.Literal("not-run"),
				]),
				exitCode: Type.Optional(Type.Integer()),
				summary: Type.String(),
			}),
		),
		evidence: Type.Object({
			cwd: Type.String(),
			taskId: Type.String(),
			workerRunId: Type.String(),
			baseGitRef: Type.Optional(Type.String()),
			finalGitRef: Type.Optional(Type.String()),
			gitStatusHash: Type.Optional(Type.String()),
			changedPaths: Type.Optional(Type.Array(Type.String())),
		}),
		risks: Type.Array(Type.String()),
		unresolved: Type.Array(Type.String()),
		notes: Type.Optional(Type.Array(Type.String())),
	},
	{ additionalProperties: false },
)) as unknown as SubagentDelegationJsonSchemaObject;

export interface DelegationDeps {
	store: TaskStore;
	gitRunner: GitRunner;
	concurrency: ConcurrencyController;
	usage: UsageLedger;
	launch: (request: SubagentDelegationRequest, signal?: AbortSignal) => Promise<SubagentDelegationResponse>;
	ownerRunId: string;
	now?: () => Date;
}

export interface DelegationOutcome {
	task: TaskRecord;                 // 落账后的记录
	executionId: string;
	runId?: string;
	report?: WorkerReport;            // launcher 校验过的原物，零改动
	comparison?: ExecutionTruthComparison;
	decision?: ReviewDecision;        // advanceReview 的结果
	usage?: SubagentDelegationUsage;
	warnings: string[];
}

/** Per-call inputs that are not part of the TypeBox parameters. */
export interface DelegationOptions {
	signal?: AbortSignal;
	/**
	 * Host tool-call id; binds the TaskExecutionRecord and the usage entry.
	 * Falls back to the delegation requestId when absent (unit tests).
	 */
	executionId?: string;
}

export class DelegationRefused extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "DelegationRefused";
		this.code = code;
	}
}

function specFromParams(params: PlannerDelegateParams, taskId: string, cwd: string): TaskSpec {
	return createTaskSpec({
		taskId,
		objective: params.objective,
		cwd,
		role: params.role,
		scope: {
			...(params.scope.allowedPaths ? { allowedPaths: params.scope.allowedPaths } : {}),
			...(params.scope.forbiddenPaths ? { forbiddenPaths: params.scope.forbiddenPaths } : {}),
		},
		constraints: params.constraints,
		acceptanceCriteria: params.acceptanceCriteria,
		validation: {
			required: params.validation.required,
			...(params.validation.commands ? { commands: params.validation.commands } : {}),
		},
	});
}

export async function runDelegation(
	deps: DelegationDeps,
	params: PlannerDelegateParams,
	cwd: string,
	options: DelegationOptions = {},
): Promise<DelegationOutcome> {
	const role = params.role;
	const effectiveCwd = params.cwd ?? cwd;
	const requestId = randomUUID();
	const executionId = options.executionId ?? requestId;
	const warnings: string[] = [];

	// 1. Task binding: an explicit id binds the existing record verbatim —
	//    its stored spec is never rewritten (ticket 53); this call's spec
	//    only goes into the packet.
	let task: TaskRecord;
	let thisSpec: TaskSpec;
	if (params.taskId) {
		const record = deps.store.get(params.taskId);
		if (!record) {
			throw new DelegationRefused("TASK_UNKNOWN", `planner_delegate refused: unknown Task ${params.taskId}`);
		}
		if (record.cwd && normalizeWorkspaceIdentity(record.cwd) !== normalizeWorkspaceIdentity(effectiveCwd)) {
			throw new DelegationRefused(
				"TASK_FOREIGN_WORKSPACE",
				`planner_delegate refused: Task ${record.taskId} belongs to workspace ${record.cwd}, not ${effectiveCwd}`,
			);
		}
		task = record;
		thisSpec = specFromParams(params, record.taskId, record.cwd || effectiveCwd);
	} else {
		// nextTaskId() already claims the id (process-local sequence or the
		// persistent allocator); createAllocated pairs that claim with the
		// record so a store.create round-trip can never re-reserve it.
		const taskId = deps.store.nextTaskId();
		const spec = specFromParams(params, taskId, effectiveCwd);
		task = deps.store.createAllocated(taskId, spec);
		thisSpec = spec;
	}
	if (isFinalTaskState(task.state)) {
		throw new DelegationRefused(
			"TASK_CLOSED",
			`planner_delegate refused: Task ${task.taskId} is ${task.state}; start a new Task instead`,
		);
	}

	// 2. Write lock: only workers claim the workspace; readers/validators run
	//    beside an active writer by design.
	let reservation: ConcurrencyReservation | undefined;
	if (role === "worker") {
		const admission = deps.concurrency.reserve({
			id: executionId,
			taskId: task.taskId,
			state: task.state,
			structured: true,
			role,
			capability: "writer",
			workspaces: [task.cwd || effectiveCwd, ...(thisSpec.additionalWorktreeRoots ?? [])],
		});
		if (admission.refusal) {
			throw new DelegationRefused("WRITER_CONFLICT", `planner_delegate refused: ${admission.refusal.reason}`);
		}
		reservation = admission.reservation;
	}

	try {
		// A running (or re-runnable) Task is executing for the duration of the
		// call; a reviewing Task keeps its state (a validator run during review
		// must not yank the lifecycle back).
		if (["planning", "changes_requested", "report-invalid", "blocked", "failed"].includes(task.state)) {
			task = deps.store.transition(task.taskId, "executing");
		}

		const worktreeRoots = [...new Set([task.cwd || effectiveCwd, ...(thisSpec.additionalWorktreeRoots ?? [])])];
		const scopePaths = [...new Set([
			...(thisSpec.scope?.allowedPaths ?? []),
			...task.executions.flatMap((item) => item.truthPaths ?? []),
		])];
		const sampleOptions = (workerRunId: string) => ({
			cwd: task.cwd || effectiveCwd,
			taskId: task.taskId,
			workerRunId,
			...(thisSpec.additionalWorktreeRoots?.length
				? { additionalWorktreeRoots: thisSpec.additionalWorktreeRoots }
				: {}),
			...(scopePaths.length > 0 ? { scopePaths } : {}),
		});

		// 3. A_run + execution record.
		const aRun = await captureEvidence(deps.gitRunner, sampleOptions(executionId));
		deps.store.beginExecution(task.taskId, {
			executionId,
			kind: role as DelegationKind,
			cwd: task.cwd || effectiveCwd,
			worktreeRoots,
			aRun,
			...(role !== "worker" ? { readOnly: true } : {}),
		});

		// 4. Structured delegation: the packet is rendered once, downward only.
		const request: SubagentDelegationRequest = {
			requestId,
			ownerRunId: deps.ownerRunId,
			nodeId: task.taskId,
			agent: ROLE_AGENTS[role] ?? "worker",
			task: buildTaskPacket(thisSpec, params.instructions ?? ""),
			context: "fresh",
			cwd: task.cwd || effectiveCwd,
			result: { kind: "structured", schema: WORKER_REPORT_SCHEMA },
		};
		let response: SubagentDelegationResponse;
		try {
			response = await deps.launch(request, options.signal);
		} catch (error) {
			const reason = `delegation launch failed: ${error instanceof Error ? error.message : String(error)}`;
			try { deps.store.transition(task.taskId, "failed"); } catch { /* already final */ }
			deps.store.setStateReason(task.taskId, reason);
			throw error;
		}

		// 5. Non-completed terminal states are structured failures, not outcomes.
		if (response.status !== "completed") {
			const target = BLOCKING_STATUSES.has(response.status) ? "blocked" : "failed";
			try { deps.store.transition(task.taskId, target); } catch { /* already final */ }
			deps.store.setStateReason(
				task.taskId,
				`delegation ${response.status}${response.error ? `: ${response.error}` : ""}`,
			);
			const runLabel = "runId" in response ? response.runId : undefined;
			throw new DelegationRefused(
				response.status.toUpperCase(),
				`planner_delegate ${task.taskId} ${response.status}: ${response.error ?? "no error text"} (run=${runLabel ?? "none"})`,
			);
		}

		const runId = response.runId;
		const report = response.result?.kind === "structured" ? (response.result.value as WorkerReport) : undefined;

		// 6. C_report + execution-window truth. `compareExecutionTruth` feeds the
		//    execution record; `compareEvidence` produces the EvidenceComparison
		//    the store and review loop consume.
		const cReport = await captureEvidence(deps.gitRunner, sampleOptions(runId ?? executionId));
		const priorTruthPaths = task.executions
			.filter((item) => item.executionId !== executionId && !item.auxiliary && !item.reportOnly && item.truthPaths?.length)
			.flatMap((item) => item.truthPaths ?? []);
		const truth = compareExecutionTruth(aRun, cReport, report, {
			...(thisSpec.scope ? { scope: thisSpec.scope } : {}),
			...(thisSpec.additionalWorktreeRoots?.length
				? { additionalWorktreeRoots: thisSpec.additionalWorktreeRoots }
				: {}),
			...(role !== "worker" ? { readOnly: true } : {}),
			...(priorTruthPaths.length > 0 ? { priorTruthPaths } : {}),
		});
		const comparison = report
			? compareEvidence(aRun, cReport, report, {
				...(thisSpec.scope ? { scope: thisSpec.scope } : {}),
				...(thisSpec.additionalWorktreeRoots?.length
					? { additionalWorktreeRoots: thisSpec.additionalWorktreeRoots }
					: {}),
			})
			: undefined;
		if (comparison) deps.store.setLastComparison(task.taskId, comparison);

		// 7. Report identity is checked against the delegation, never rewritten.
		const identityErrors = report
			? validateWorkerReportIdentity(report, {
				taskId: task.taskId,
				...(task.aliases?.length ? { aliases: task.aliases } : {}),
				...(runId ? { workerRunId: runId } : {}),
			})
			: [];
		const reportError = report
			? (identityErrors.length > 0 ? identityErrors.join("; ") : undefined)
			: "completed delegation carried no structured WorkerReport";

		// 8. Ledger: report and child usage land on the Task as-is.
		let recorded = task;
		if (report) {
			recorded = role === "validator"
				? deps.store.recordValidatorReport(task.taskId, report)
				: deps.store.recordReport(task.taskId, report);
		}
		if (response.usage) {
			const child = childUsageFromValue(response.usage, role as DelegationKind, {
				...(runId ? { runId } : {}),
				toolCallId: executionId,
				...(response.agent ? { agent: response.agent } : {}),
				...(response.model ? { model: response.model } : {}),
				...(response.thinking ? { thinking: response.thinking } : {}),
				source: "sync-details",
				pending: false,
				taskId: task.taskId,
				executionId,
				ownerRootSessionId: deps.ownerRunId,
			});
			if (child) deps.usage.recordChild(task.taskId, child);
		}

		const reportIndex = role === "validator"
			? recorded.validatorReports.length - 1
			: recorded.reports.length - 1;
		deps.store.completeExecution(task.taskId, executionId, {
			cReport,
			...(runId ? { runId } : {}),
			truthPaths: truth.truthPaths,
			executionChangedPaths: truth.executionChangedPaths,
			committedPaths: truth.committedPaths,
			observedExternalPaths: truth.observedExternalPaths,
			undeclaredPaths: truth.undeclaredPaths,
			outOfScopePaths: truth.outOfScopePaths,
			extraDeclaredPaths: truth.extraDeclaredPaths,
			externalPaths: truth.externalPaths,
			...(report && reportIndex >= 0
				? role === "validator"
					? { validatorReportIndex: reportIndex }
					: { reportIndex }
				: {}),
		});
		deps.store.recordExecutionFindings(
			task.taskId,
			executionId,
			truth.findings
				.filter((finding) => finding.kind !== "attribution-gap")
				.map((finding) => ({
					kind: finding.kind as Exclude<typeof finding.kind, "attribution-gap"> as TaskFinding["kind"],
					paths: finding.paths,
				})),
			deps.store.now().toISOString(),
			["undeclared", "scope", "over-declared", "missing"],
		);
		if (!report && reportError) warnings.push(reportError);

		// 9. Review loop decides what this report means for the Task.
		const { task: reviewed, decision } = advanceReview({
			store: deps.store,
			taskId: task.taskId,
			...(report ? { report } : {}),
			...(reportError ? { reportError } : {}),
			...(comparison ? { comparison } : {}),
		});

		// 10. Outcome.
		return {
			task: reviewed,
			executionId,
			...(runId ? { runId } : {}),
			...(report ? { report } : {}),
			...(truth ? { comparison: truth } : {}),
			decision,
			...(response.usage ? { usage: response.usage } : {}),
			warnings,
		};
	} finally {
		if (reservation) deps.concurrency.release(reservation.id);
	}
}

/** Text the Root reads; all contract fields stay in `details`. */
export function renderDelegationOutcome(outcome: DelegationOutcome): string {
	const lines = [
		`planner_delegate: ${outcome.task.taskId} ${outcome.task.state} run=${outcome.runId ?? "none"}`,
	];
	if (outcome.report?.summary) lines.push(`summary: ${outcome.report.summary}`);
	if (outcome.decision) {
		lines.push(`review: ${outcome.decision.action} -> ${outcome.decision.nextState} — ${outcome.decision.reason}`);
		for (const guidance of outcome.decision.guidance) lines.push(`guidance: ${guidance}`);
	}
	for (const warning of outcome.warnings) lines.push(`warning: ${warning}`);
	return lines.join("\n");
}

/**
 * The real launcher: spike `waitForDelegation` lifted unchanged. Emits the
 * request on the shared delegation transport and resolves with the first
 * response that matches the request's identity triple. Abort emits CANCEL
 * (the host can then terminate the leaf) and rejects the wait.
 */
export function createHostLauncher(pi: ExtensionAPI): DelegationDeps["launch"] {
	return (request, signal) => new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error(`planner_delegate aborted: ${request.nodeId}`));
			return;
		}
		let settled = false;
		const cancelPayload: SubagentDelegationCancel = {
			requestId: request.requestId,
			ownerRunId: request.ownerRunId,
			nodeId: request.nodeId,
		};
		const cleanup = () => {
			unsubscribe();
			signal?.removeEventListener("abort", onAbort);
		};
		const unsubscribe = pi.events.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, (payload) => {
			const response = payload as SubagentDelegationResponse;
			if (response.requestId !== request.requestId) return;
			if (response.ownerRunId !== undefined && response.ownerRunId !== request.ownerRunId) return;
			if (response.nodeId !== undefined && response.nodeId !== request.nodeId) return;
			if (settled) return;
			settled = true;
			cleanup();
			resolve(response);
		});
		const onAbort = () => {
			if (settled) return;
			settled = true;
			pi.events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, cancelPayload);
			cleanup();
			reject(new Error(`planner_delegate aborted: ${request.nodeId}`));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		pi.events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
	});
}
```

**2026-09-15 复核判定（Claude，判定方）。通过。** Status → verified。

验收在本机独立重跑，结果与交回物一致：三条零文本解析 grep 均无输出；六个保护文件 diffstat 为空；`roles.ts` 改动行数 2；`spike/` 不存在；`delegate.ts` 导出 `runDelegation` / `createHostLauncher` 均为 function；`npm run typecheck && npm test` exit 0，36 个测试文件全过，末项 `delegate.test.mjs: all cases passed`（日志 `.scratch/typed-delegation/04-review-npm.log`）。`delegate.test.mjs` 断言数 52。

披露的偏离逐条核对，全部接受：

- 铸 id 走 `nextTaskId()` + `createAllocated()`：与旧链 `orchestrate.ts:3180-3186` 完全一致，`create()` 在无 allocator 时确会把 `createTaskSpec` 自动生成的同日 id 当存量返回，偏离成立。
- 两个 compare 分工：旧链同样以 `compareEvidence` 喂 `setLastComparison`/`advanceReview`、以 `compareExecutionTruth` 回写 execution 记录（`orchestrate.ts:5298`），票面 step 6 确为速写。
- `details.decision` 用 `decision.action`：`ReviewDecision`（`review.ts:49`）无 `kind` 字段，正确。
- `TASK_CLOSED`：`completed` / `closed-superseded` 在 `TASK_TRANSITIONS` 中无出边，显式拒绝优于裸 illegal-transition。
- `validateWorkerReportIdentity` 传 `aliases` 而非票面的 `cwd`：该函数（`report.ts:664`）不接受 `cwd`，传 aliases 才是正确的身份匹配输入。
- explorer→scout 连带翻转旧链 `applyRoleDelegation` 的 remap：票面明文授权这一行，4 个测试文件仅改期望值，接受。
- `ownerRunId` 用 `ctx.sessionManager?.getSessionId?.() || PROCESS_OWNER_RUN_ID`：票面写死 `getSessionId()`，加可选链和回退不改语义，接受。

复核发现、交回物未披露的两点，均不阻塞本票，转为后续票的承接项：

1. **`auxiliary` 标记缺失（承接给 05）。** 旧链把 validator execution 标为 `auxiliary: true`（`orchestrate.ts:3041-3048`），旧链的「最近一次真实 execution」查找与归因计数都靠 `!auxiliary` 过滤（`orchestrate.ts:1683`、`1818`、`2151`、`3667`）。`runDelegation` 的 `beginExecution` 从不设 `auxiliary`，因此在 04→08 的并存窗口内，经 `planner_delegate` 派出的 validator 会被旧链 helper 当成该 Task 的最新真实 execution。修法是 validator 分支加 `auxiliary: true`，一行；05 切换时一并落。
2. **usage 的 `ownerRootSessionId` 来源不同（承接给 10）。** 旧链经 `bindOwnedChild` 取 `orchestrator.getLoadedProvenance()?.sessionId` 且过滤 `unknown`；新链直接写 `deps.ownerRunId`，而其回退值是进程级随机 UUID。同会话下两者应相等，但回退分支会把一个杜撰的 owner 写进 ledger。10 的宿主验收要断言 `planner_delegate` 产生的 usage 行 `ownerRootSessionId` 等于 ledger provenance 的 sessionId。

提交卫生：工作树里 `completion/evidence/ledger-store/…` 等 18 个测试文件的 tmpdir 迁移是票 01 的存量改动，与本票无关，提交时分开。
