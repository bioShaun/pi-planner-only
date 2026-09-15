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
import { captureEvidence, captureReviewEvidencePacket, compareEvidence, compareExecutionTruth, describeComparison } from "./evidence.ts";
import type { ExecutionTruthComparison } from "./evidence.ts";
import { buildTaskPacket, ROLE_AGENTS } from "./roles.ts";
import { createTaskSpec, normalizeWorkspaceIdentity } from "./task.ts";
import type { TaskRecord, TaskStore } from "./task.ts";
import { validateWorkerReportIdentity } from "./report.ts";
import {
	advanceReview,
	bindReviewResultFromRequest,
	buildFreshReviewerTask,
	FINDING_CATEGORIES,
	FINDING_SEVERITIES,
	REVIEW_VERDICTS,
	reviewAttributionOf,
	summarizeFindings,
	validateReviewResult,
	validateReviewResultBinding,
	validateReviewResultIdentity,
} from "./review.ts";
import type { FreshReviewerTaskInput, ReviewDecision } from "./review.ts";
import { childUsageFromValue } from "./usage.ts";
import type { UsageLedger } from "./usage.ts";
import { isFinalTaskState, isTerminalTaskState } from "./types.ts";
import type {
	DelegationKind,
	FindingCategory,
	FindingSeverity,
	ReviewResult,
	ReviewVerdict,
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
	role: Type.Union([Type.Literal("worker"), Type.Literal("explorer"), Type.Literal("validator"), Type.Literal("reviewer")], {
		description: "Delegation role. worker implements; explorer does read-only recon (scout agent); validator runs an oracle verdict; reviewer reviews an existing Task's latest WorkerReport — taskId is required and objective / scope / constraints / acceptanceCriteria / validation / instructions are ignored, the Task's stored spec is the reviewer's context.",
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

/**
 * ReviewResult JSON schema (types.ts) as plain JSON data — only the fields a
 * reviewer child may write; Root-side audit stamps (appliedDecision,
 * refusalKind, source, …) are not in the contract. `Type.Unsafe({enum})`
 * keeps the enum a flat array so tests can deepEqual it against the same
 * exported constants `validateReviewResult` checks. Same structuredClone
 * rationale as WORKER_REPORT_SCHEMA above.
 */
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
		workspaceDigest: Type.Optional(Type.String({ minLength: 1 })),
		acknowledgeDrift: Type.Optional(Type.Object(
			{ successorTaskId: Type.Optional(Type.String({ minLength: 1 })), commit: Type.Optional(Type.Boolean()) },
			{
				additionalProperties: false,
				description: "Set only when the reviewed work drifted onto a successor Task — name successorTaskId or set commit=true. Omit entirely when there is no drift.",
			},
		)),
		attributionGapOverride: Type.Optional(Type.Boolean()),
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
	review?: ReviewResult;            // reviewer 分支：绑定后的 ReviewResult
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

	// A reviewer call only exists over an existing Task — minting one would
	// leave nothing to review. Checked before binding so the refusal never
	// consumes an id.
	if (role === "reviewer" && !params.taskId) {
		throw new DelegationRefused("TASK_REQUIRED", "planner_delegate refused: role=reviewer requires taskId of the Task under review");
	}

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
		// The reviewer fork: binding is identical, but the call mints no spec
		// of its own — the stored spec is the reviewer's read-only context.
		if (role === "reviewer") {
			return runReviewInvocation(deps, task, { requestId, executionId }, options.signal);
		}
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
			...(role === "validator" ? { auxiliary: true } : {}),
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

/**
 * role=reviewer: one invocation over an existing Task, never an execution —
 * no write lock, no transition, no A_run, no TaskExecutionRecord. The
 * ReviewRequest is rendered one-way from the stored spec, the latest
 * WorkerReport, and Root's own bounded Git packet; the launcher-validated
 * ReviewResult comes back over the same structured channel and feeds
 * `advanceReview` directly (ticket 06). `packetBinding` stays a local: in
 * this chain request and response share one function scope, so the
 * DelegationRecord round-trip the legacy chain needed is not required.
 */
async function runReviewInvocation(
	deps: DelegationDeps,
	task: TaskRecord,
	ids: { requestId: string; executionId: string },
	signal: AbortSignal | undefined,
): Promise<DelegationOutcome> {
	const warnings: string[] = [];

	// R1 — only a non-terminal Task with a WorkerReport is reviewable. The
	//    no-report refusal moved forward from the legacy return path: with no
	//    report there is no revision to bind and nothing to judge.
	if (isTerminalTaskState(task.state)) {
		throw new DelegationRefused(
			"REVIEW_TERMINAL",
			`planner_delegate refused: Task ${task.taskId} is ${task.state}; there is nothing left to review`,
		);
	}
	if (task.reports.length === 0) {
		throw new DelegationRefused(
			"REVIEW_NO_REPORT",
			`planner_delegate refused: Task ${task.taskId} has no WorkerReport to review`,
		);
	}

	// R3 — build the ReviewRequest: stored spec (read-only), latest report,
	//    the revision/digest the verdict binds to, and Root's bounded Git
	//    evidence packet (reviewer children carry no git_audit).
	const attribution = reviewAttributionOf(task);
	const roots = task.spec?.additionalWorktreeRoots;
	const git = await captureReviewEvidencePacket(deps.gitRunner, task.cwd, task.lastComparison, {
		...(attribution.baselineRef ? { baselineRef: attribution.baselineRef } : {}),
		...(roots?.length ? { additionalWorktreeRoots: roots } : {}),
		...(attribution.rounds.length > 0 ? { rounds: attribution.rounds } : {}),
		...(attribution.unresolvedFindings.length > 0 ? { unresolvedFindings: attribution.unresolvedFindings } : {}),
		...(attribution.attributionIncomplete ? { attributionIncomplete: attribution.attributionIncomplete } : {}),
	});
	const report = task.reports.at(-1)!;
	const packetInput: FreshReviewerTaskInput = {
		taskId: task.taskId,
		...(task.spec ? { spec: task.spec } : {}),
		report,
		reportRevision: task.reports.length,
		...(task.snapshot ? { workspaceDigest: task.snapshot.digest } : {}),
		...(task.lastComparison ? { evidence: describeComparison(task.lastComparison) } : {}),
		git,
	};
	const packetBinding = {
		reportRevision: task.reports.length,
		...(task.snapshot ? { workspaceDigest: task.snapshot.digest } : {}),
	};
	const packetTruncated = git.patchTruncated === true || (git.patchOmittedPaths?.length ?? 0) > 0;

	// R4 — the launcher schema-checks the child's ReviewResult.
	const request: SubagentDelegationRequest = {
		requestId: ids.requestId,
		ownerRunId: deps.ownerRunId,
		nodeId: task.taskId,
		agent: ROLE_AGENTS.reviewer ?? "reviewer",
		task: buildFreshReviewerTask(packetInput),
		context: "fresh",
		cwd: task.cwd,
		result: { kind: "structured", schema: REVIEW_RESULT_SCHEMA },
	};
	// A launch throw propagates as-is: a reviewer failure never moves the Task.
	const response = await deps.launch(request, signal);

	// R5 — non-completed statuses are refusals, not outcomes; nothing is
	//    transitioned and (G4) no usage is recorded.
	if (response.status !== "completed") {
		throw new DelegationRefused(
			response.status.toUpperCase(),
			`planner_delegate ${task.taskId} review ${response.status}: ${response.error ?? "no error text"} (run=${"runId" in response ? response.runId : "none"})`,
		);
	}
	const runId = response.runId;

	// R9 — usage lands before any return-side refusal so every refused
	//    verdict is still accounted. `executionId` stays unset: the reviewer
	//    has no TaskExecutionRecord for a consumer to resolve (the usage
	//    export joins run.executionId against task.executions); toolCallId
	//    still carries the host call identity.
	if (response.usage) {
		const child = childUsageFromValue(response.usage, "reviewer", {
			...(runId ? { runId } : {}),
			toolCallId: ids.executionId,
			...(response.agent ? { agent: response.agent } : {}),
			...(response.model ? { model: response.model } : {}),
			...(response.thinking ? { thinking: response.thinking } : {}),
			source: "sync-details",
			pending: false,
			taskId: task.taskId,
			ownerRootSessionId: deps.ownerRunId,
		});
		if (child) deps.usage.recordChild(task.taskId, child);
	}

	// R6 — identity, binding, packet completeness. Every failure below leaves
	//    usage recorded, no review recorded, the Task unchanged.
	const value = response.result?.kind === "structured" ? response.result.value : undefined;
	const shapeErrors = validateReviewResult(value);
	if (response.result?.kind !== "structured" || shapeErrors.length > 0) {
		throw new DelegationRefused(
			"REVIEW_INVALID",
			`planner_delegate refused: reviewer result for ${task.taskId} failed ReviewResult validation: ${shapeErrors.join("; ") || "not a structured value"}`,
		);
	}
	const review: ReviewResult = { ...(value as ReviewResult), source: "reviewer" };
	const identityErrors = validateReviewResultIdentity(review, task.taskId);
	if (identityErrors.length > 0) {
		throw new DelegationRefused("REVIEW_IDENTITY", `planner_delegate refused: ${identityErrors.join("; ")}`);
	}
	// Re-read after the launch: the verdict binds against the Task as it is
	// now; omitted bindings are filled from the packet the reviewer saw.
	const fresh = deps.store.require(task.taskId);
	const currentBinding = {
		reportRevision: fresh.reports.length,
		...(fresh.snapshot ? { workspaceDigest: fresh.snapshot.digest } : {}),
	};
	const bound = bindReviewResultFromRequest(review, packetBinding);
	const bindingErrors = validateReviewResultBinding(bound, currentBinding);
	if (bindingErrors.length > 0) {
		throw new DelegationRefused("REVIEW_BINDING", `planner_delegate refused: ${bindingErrors.join("; ")}`);
	}
	if (bound.verdict === "pass" && packetTruncated) {
		throw new DelegationRefused(
			"REVIEW_PACKET_TRUNCATED",
			`planner_delegate refused: the review packet for ${task.taskId} was truncated (patchTruncated or omitted patch paths); a pass over a partial packet is not eligible`,
		);
	}

	// R7 — accept-time re-sample for every verdict; only a pass can be
	//    stopped by it. scopePaths mirrors the worker branch's shape, sourced
	//    from the Task's stored spec and recorded truth paths.
	const scopePaths = [...new Set([
		...(task.spec?.scope?.allowedPaths ?? []),
		...task.executions.flatMap((item) => item.truthPaths ?? []),
	])];
	const current = await captureEvidence(deps.gitRunner, {
		cwd: task.cwd,
		taskId: task.taskId,
		workerRunId: `review-${ids.executionId}`,
		...(roots?.length ? { additionalWorktreeRoots: roots } : {}),
		...(scopePaths.length > 0 ? { scopePaths } : {}),
	});
	const latest = fresh.executions
		.filter((item) => !item.auxiliary && !item.reportOnly && item.reportIndex === fresh.reports.length - 1)
		.at(-1);
	const comparison = latest
		? compareEvidence(latest.aRun, current, report, {
			...(fresh.spec?.scope ? { scope: fresh.spec.scope } : {}),
			...(roots?.length ? { additionalWorktreeRoots: roots } : {}),
			...(latest.readOnly ? { readOnly: true } : {}),
		})
		: undefined;
	if (comparison) deps.store.setLastComparison(task.taskId, comparison);
	if (!latest) {
		// decideReview accepts a pass with no comparison at all, so the
		// missing per-execution binding must refuse here — a pass over
		// unverifiable material is never eligible.
		warnings.push(`report revision ${fresh.reports.length} has no per-execution evidence record; a pass cannot be judged fresh`);
		if (bound.verdict === "pass") {
			throw new DelegationRefused(
				"REVIEW_NO_EXECUTION_EVIDENCE",
				`planner_delegate refused: report revision ${fresh.reports.length} of ${task.taskId} has no per-execution A_run/C_report binding; a pass cannot be judged fresh`,
			);
		}
	}

	// R8 — record then decide, mirroring the legacy return path.
	const freshReport = fresh.reports.at(-1)!;
	deps.store.recordReview(task.taskId, bound);
	const { task: reviewed, decision } = advanceReview({
		store: deps.store,
		taskId: task.taskId,
		report: freshReport,
		...(comparison ? { comparison } : {}),
		review: bound,
	});
	deps.store.annotateReviewDecision(task.taskId, decision.action);
	if (decision.action === "revalidate" && decision.evidenceKey) {
		deps.store.markRevalidationGranted(task.taskId, decision.evidenceKey);
	}

	return {
		task: reviewed,
		executionId: ids.executionId,
		...(runId ? { runId } : {}),
		review: bound,
		decision,
		...(response.usage ? { usage: response.usage } : {}),
		warnings,
	};
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
	if (outcome.review) {
		lines.push(`review: ${outcome.review.verdict} (evidenceFresh: ${outcome.review.evidenceFresh}) — ${outcome.review.summary}`);
		lines.push(...summarizeFindings(outcome.review.findings));
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
