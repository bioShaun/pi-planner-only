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
	SUBAGENT_DELEGATION_UPDATE_EVENT,
	type SubagentDelegationCancel,
	type SubagentDelegationJsonSchemaObject,
	type SubagentDelegationRequest,
	type SubagentDelegationResponse,
	type SubagentDelegationTerminalResponse,
	type SubagentDelegationUpdate,
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
	EvidenceRef,
	ExecutionEndedReason,
	ExecutionLifecycleStatus,
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

/**
 * WRC P0-A — host terminal status → execution endedReason (spec §2).
 * `worker_runaway` is never produced here: only the monitor marks that.
 */
const TERMINAL_ENDED_REASON: Record<string, ExecutionEndedReason> = {
	cancelled: "operator_cancel",
	interrupted: "operator_cancel",
	timed_out: "timeout",
	tool_budget_exhausted: "tool_budget",
	failed: "provider_failure",
	structured_output_failed: "tool_error",
	acceptance_failed: "tool_error",
	invalid_request: "launch_failure",
	unavailable_context: "provider_failure",
	duplicate_node: "launch_failure",
};

/** P0-A default quiescence wait after an identity-matched terminal (spec §3). */
export const DEFAULT_QUIESCENCE_WAIT_MS = 10_000;
const DEFAULT_QUIESCENCE_SAMPLE_GAP_MS = 250;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Two worktree samples prove quiescence when the status hash and every
 * dirty-path content hash agree (spec §3 predicate (c)).
 */
function worktreeSamplesQuiet(a: EvidenceRef, b: EvidenceRef): boolean {
	if (a.gitStatusHash !== b.gitStatusHash) return false;
	const aHashes = a.dirtyPathHashes ?? {};
	const bHashes = b.dirtyPathHashes ?? {};
	const aKeys = Object.keys(aHashes);
	const bKeys = Object.keys(bHashes);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every((key) => aHashes[key] === bHashes[key]);
}

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
 * requestedVerdict, source, …) are not in the contract. `Type.Unsafe({enum})`
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

export interface DelegationLaunchHooks {
	/** 每条按身份三元组过滤后的 UPDATE。调用方不得阻塞。 */
	onUpdate?: (update: SubagentDelegationUpdate) => void;
	/**
	 * WRC P0-A — an identity-matched terminal that arrived after the cancel
	 * grace already rejected the wait. The launcher keeps its RESPONSE
	 * subscription alive for exactly this; the callback finalizes the
	 * execution once (usage, C_terminal, release). Must not throw.
	 */
	onLateTerminal?: (response: SubagentDelegationTerminalResponse) => void;
}

export interface DelegationDeps {
	store: TaskStore;
	gitRunner: GitRunner;
	concurrency: ConcurrencyController;
	usage: UsageLedger;
	launch: (request: SubagentDelegationRequest, signal?: AbortSignal, hooks?: DelegationLaunchHooks) => Promise<SubagentDelegationResponse>;
	ownerRunId: string;
	now?: () => Date;
	/** P0-A stop-confirmation wait after an identity-matched terminal (spec §3). */
	quiescenceWaitMs?: number;
	/** Gap between the two confirmatory worktree samples. */
	quiescenceSampleGapMs?: number;
}

/** WRC P0-A — structured abnormal-termination details returned instead of a thrown refusal (spec §3). */
export interface DelegationTermination {
	/** Host terminal status, when one arrived; absent on grace-expiry or pre-launch abort. */
	status?: string;
	/** Why the execution ended (mapped from the terminal status; never "normal" here). */
	reason: ExecutionEndedReason;
	/** Lifecycle state at return; absent for reviewer invocations, which hold no execution. */
	executionStatus?: ExecutionLifecycleStatus;
	terminationConfirmed: boolean;
	confirmationBasis?: string;
	quiescenceWaitMs?: number;
	quiescenceWaitSource?: "default" | "config";
	/** Stop-evidence sampling failed — the writer hold stays until resolved or manually handled. */
	evidenceIncomplete?: boolean;
	/** Residual worktree sample after confirmed quiescence. */
	cTerminal?: EvidenceRef;
	/** Whether the terminal's usage was accounted; false means only the observed lower bound stands. */
	usageComplete: boolean;
	error?: string;
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
	/** P0-A — present when the execution ended abnormally (cancel, timeout, failure, stop unconfirmed). */
	termination?: DelegationTermination;
	warnings: string[];
}

/** details payload of a progress partial result; `progress: true` marks it non-terminal. */
export interface DelegationProgressDetails {
	taskId: string;
	role: DelegationKind;
	runId?: string;
	currentTool?: string;
	toolCount?: number;
	durationMs?: number;
	tokens?: number;
	progress: true;
}

/** Per-call inputs that are not part of the TypeBox parameters. */
export interface DelegationOptions {
	signal?: AbortSignal;
	/**
	 * Host tool-call id; binds the TaskExecutionRecord and the usage entry.
	 * Falls back to the delegation requestId when absent (unit tests).
	 */
	executionId?: string;
	/** 宿主 execute 的 onUpdate；runDelegation 把 SubagentDelegationUpdate 渲染成 AgentToolResult 局部结果后转发。 */
	onUpdate?: (partial: { content: { type: "text"; text: string }[]; details: DelegationProgressDetails }) => void;
}

export class DelegationRefused extends Error {
	readonly code: string;
	readonly taskId?: string;

	constructor(code: string, message: string, taskId?: string) {
		super(message);
		this.name = "DelegationRefused";
		this.code = code;
		this.taskId = taskId;
	}
}

/**
 * Thrown when the abort grace period elapses without the cancelled terminal
 * response the bridge is expected to send. Distinct from DelegationRefused:
 * the launch was accepted, then cancelled by the operator.
 */
export class DelegationAborted extends Error {
	/** Set by runDelegation's launch catch before rethrow — the Task that was cancelled. */
	taskId?: string;
	/** False when the signal aborted before the REQUEST was emitted — nothing ever ran. */
	readonly requestEmitted: boolean;

	constructor(nodeId: string, requestEmitted = true) {
		super(`planner_delegate aborted: ${nodeId}`);
		this.name = "DelegationAborted";
		this.requestEmitted = requestEmitted;
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
			return runReviewInvocation(deps, task, { requestId, executionId }, options);
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
	//    beside an active writer by design. A persisted writerHold outlives
	//    both the session and the reservation map: a stop-unconfirmed
	//    workspace admits no second writer (A4).
	let reservation: ConcurrencyReservation | undefined;
	if (role === "worker") {
		if (task.writerHold) {
			throw new DelegationRefused(
				"WRITER_HOLD",
				`planner_delegate refused: Task ${task.taskId} writer execution ${task.writerHold.executionId} was never confirmed stopped (${task.writerHold.reason}); resolve the hold before dispatching another writer`,
				task.taskId,
			);
		}
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

	const nowIso = () => (deps.now ? deps.now() : new Date()).toISOString();
	const quiescenceWaitMs = deps.quiescenceWaitMs ?? DEFAULT_QUIESCENCE_WAIT_MS;
	const quiescenceWaitSource: "default" | "config" = deps.quiescenceWaitMs === undefined ? "default" : "config";
	const quiescenceSampleGapMs = deps.quiescenceSampleGapMs ?? DEFAULT_QUIESCENCE_SAMPLE_GAP_MS;
	// Set true only by a path that proved the execution stopped (or never
	// launched); an unconfirmed stop keeps the reservation held via
	// task.writerHold instead of releasing it in the finally (A4).
	let releaseReservation = false;
	let cancelRequestedAt: string | undefined;
	// P0-A — stamp the cancel request on the execution the moment the signal
	// fires; the launcher emits CANCEL on the same signal.
	const onSignalAbort = () => {
		if (cancelRequestedAt) return;
		cancelRequestedAt = nowIso();
		try {
			deps.store.finalizeExecution(task.taskId, executionId, { status: "cancel_requested", cancelRequestedAt });
		} catch { /* the abort path must not fail on a ledger write */ }
	};
	options.signal?.addEventListener("abort", onSignalAbort, { once: true });
	if (options.signal?.aborted) onSignalAbort();

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
		// A2 — spec §3 predicate: an identity-matched terminal plus a quiet
		//    worktree, sampled twice after quiescenceWaitMs. A sampling failure
		//    is evidence-incomplete, never clean.
		const evaluateQuiescence = async (
			terminalRunId?: string,
		): Promise<
			| { confirmed: true; cTerminal: EvidenceRef }
			| { confirmed: false; interim: EvidenceRef; evidenceIncomplete?: boolean }
		> => {
			await sleep(quiescenceWaitMs);
			const first = await captureEvidence(deps.gitRunner, sampleOptions(terminalRunId ?? executionId));
			await sleep(quiescenceSampleGapMs);
			const second = await captureEvidence(deps.gitRunner, sampleOptions(terminalRunId ?? executionId));
			if (
				first.statusProbeFailed || second.statusProbeFailed
				|| first.gitAvailable === false || second.gitAvailable === false
			) {
				return { confirmed: false, interim: second, evidenceIncomplete: true };
			}
			return worktreeSamplesQuiet(first, second)
				? { confirmed: true, cTerminal: second }
				: { confirmed: false, interim: second };
		};

		// A3 — a terminal arriving after the grace reject still finalizes the
		//    execution exactly once: quiescence, usage, C_terminal, release.
		//    It must never advance review or release twice.
		const settleLateTerminal = (late: SubagentDelegationTerminalResponse): void => {
			void (async () => {
				const execution = deps.store.executionById(task.taskId, executionId);
				if (!execution) return;
				if (execution.status === "stopped" || execution.status === "completed" || execution.status === "failed") return;
				const lateSuccess = late.status === "completed";
				const q = await evaluateQuiescence(late.runId);
				let usageComplete = execution.usageComplete === true;
				if (late.usage && !usageComplete) {
					const child = childUsageFromValue(late.usage, role as DelegationKind, {
						...(late.runId ? { runId: late.runId } : {}),
						toolCallId: executionId,
						...(late.agent ? { agent: late.agent } : {}),
						...(late.model ? { model: late.model } : {}),
						...(late.thinking ? { thinking: late.thinking } : {}),
						source: "sync-details",
						pending: false,
						taskId: task.taskId,
						executionId,
						ownerRootSessionId: deps.ownerRunId,
					});
					if (child) {
						deps.usage.recordChild(task.taskId, { ...child, outcome: "failed" });
						usageComplete = true;
					}
				}
				deps.store.finalizeExecution(task.taskId, executionId, {
					status: q.confirmed ? "stopped" : "stop_unconfirmed",
					endedReason: TERMINAL_ENDED_REASON[late.status] ?? "provider_failure",
					endedAt: nowIso(),
					terminationConfirmed: q.confirmed,
					...(q.confirmed ? { confirmationBasis: "terminal+quiet-worktree", cTerminal: q.cTerminal } : { interimSample: q.interim }),
					...(q.confirmed === false && q.evidenceIncomplete ? { evidenceIncomplete: true } : {}),
					usageComplete,
					...(late.runId ? { runId: late.runId } : {}),
					...(lateSuccess && late.result?.kind === "structured" ? { lateReport: late.result.value as WorkerReport } : {}),
				});
				if (q.confirmed) {
					if (reservation) deps.concurrency.release(reservation.id);
					deps.store.clearWriterHold(task.taskId);
				}
			})().catch(() => {
				/* late finalization is best-effort: the record stays stop_unconfirmed */
			});
		};

		let response: SubagentDelegationResponse;
		try {
			response = await deps.launch(request, options.signal, {
				onUpdate: (update) => options.onUpdate?.(renderDelegationProgress(role as DelegationKind, task.taskId, update)),
				onLateTerminal: settleLateTerminal,
			});
		} catch (error) {
			const aborted = error instanceof DelegationAborted || options.signal?.aborted === true;
			if (aborted) {
				const emitted = !(error instanceof DelegationAborted) || error.requestEmitted;
				if (emitted) {
					// Grace expired with no terminal: the stop is unconfirmed. The
					// reservation becomes a persisted hold — released only when a
					// late terminal confirms quiescence (A3/A4).
					deps.store.finalizeExecution(task.taskId, executionId, {
						status: "stop_unconfirmed",
						endedReason: "operator_cancel",
						...(cancelRequestedAt ? { cancelRequestedAt } : {}),
						usageComplete: false,
					});
					if (reservation) {
						deps.store.setWriterHold(task.taskId, {
							executionId,
							reason: "cancel grace expired without a terminal; writer stop unconfirmed",
							since: nowIso(),
						});
					}
				} else {
					// Aborted before the REQUEST was emitted: nothing ever ran,
					// so there is nothing to confirm.
					deps.store.finalizeExecution(task.taskId, executionId, {
						status: "stopped",
						endedReason: "operator_cancel",
						endedAt: nowIso(),
						terminationConfirmed: true,
						confirmationBasis: "no-launch",
						usageComplete: false,
					});
					releaseReservation = true;
				}
				try { deps.store.transition(task.taskId, "blocked"); } catch { /* already final */ }
				deps.store.setStateReason(
					task.taskId,
					emitted
						? "delegation cancelled by operator; no terminal response within grace — stop unconfirmed, writer hold kept"
						: "delegation cancelled by operator before launch",
				);
				return {
					task: deps.store.require(task.taskId),
					executionId,
					termination: {
						reason: "operator_cancel",
						executionStatus: emitted ? "stop_unconfirmed" : "stopped",
						terminationConfirmed: !emitted,
						...(emitted ? {} : { confirmationBasis: "no-launch" }),
						quiescenceWaitMs,
						quiescenceWaitSource,
						usageComplete: false,
						error: error instanceof Error ? error.message : String(error),
					},
					warnings,
				};
			}
			const reason = `delegation launch failed: ${error instanceof Error ? error.message : String(error)}`;
			// A5 — a launch failure records its provable facts only: no child
			//    ever ran, so no child termination evidence is fabricated.
			deps.store.finalizeExecution(task.taskId, executionId, {
				status: "failed",
				endedReason: "launch_failure",
				endedAt: nowIso(),
				terminationConfirmed: true,
				confirmationBasis: "no-launch",
				usageComplete: false,
			});
			releaseReservation = true;
			try { deps.store.transition(task.taskId, "failed"); } catch { /* already final */ }
			deps.store.setStateReason(task.taskId, reason);
			return {
				task: deps.store.require(task.taskId),
				executionId,
				termination: {
					reason: "launch_failure",
					executionStatus: "failed",
					terminationConfirmed: true,
					confirmationBasis: "no-launch",
					quiescenceWaitMs,
					quiescenceWaitSource,
					usageComplete: false,
					error: reason,
				},
				warnings,
			};
		}

		// 5. Non-completed terminals — and a completed terminal arriving after
		//    the cancel request (A7 race) — are structured outcomes, not
		//    throws. A terminal alone never proves the writer went quiet: the
		//    §3 quiescence predicate decides whether the reservation releases.
		const responseRunId = "runId" in response ? response.runId : undefined;
		const lateSuccess = response.status === "completed" && cancelRequestedAt !== undefined;
		if (response.status !== "completed" || lateSuccess) {
			const terminal = response as SubagentDelegationTerminalResponse;
			const target = lateSuccess || BLOCKING_STATUSES.has(terminal.status) ? "blocked" : "failed";
			try { deps.store.transition(task.taskId, target); } catch { /* already final */ }
			deps.store.setStateReason(
				task.taskId,
				lateSuccess
					? "completed terminal arrived after the cancel request; report collected, review not advanced"
					: `delegation ${terminal.status}${terminal.error ? `: ${terminal.error}` : ""}`,
			);
			// G4: a non-completed terminal can still carry usage — it lands on
			// the same ledger path as completed.
			let usageComplete = false;
			if ("usage" in response && response.usage) {
				const child = childUsageFromValue(response.usage, role as DelegationKind, {
					...(responseRunId ? { runId: responseRunId } : {}),
					toolCallId: executionId,
					...(terminal.agent ? { agent: terminal.agent } : {}),
					...(terminal.model ? { model: terminal.model } : {}),
					...(terminal.thinking ? { thinking: terminal.thinking } : {}),
					source: "sync-details",
					pending: false,
					taskId: task.taskId,
					executionId,
					ownerRootSessionId: deps.ownerRunId,
				});
				if (child) {
					deps.usage.recordChild(task.taskId, { ...child, outcome: "failed" });
					usageComplete = true;
				}
			}
			deps.store.finalizeExecution(task.taskId, executionId, { status: "stopping" });
			const q = await evaluateQuiescence(responseRunId);
			const endedReason: ExecutionEndedReason = lateSuccess
				? "operator_cancel"
				: (TERMINAL_ENDED_REASON[terminal.status] ?? "provider_failure");
			deps.store.finalizeExecution(task.taskId, executionId, {
				status: q.confirmed ? "stopped" : "stop_unconfirmed",
				endedReason,
				endedAt: nowIso(),
				terminationConfirmed: q.confirmed,
				...(q.confirmed ? { confirmationBasis: "terminal+quiet-worktree", cTerminal: q.cTerminal } : { interimSample: q.interim }),
				...(q.confirmed === false && q.evidenceIncomplete ? { evidenceIncomplete: true } : {}),
				usageComplete,
				...(responseRunId ? { runId: responseRunId } : {}),
				...(lateSuccess && terminal.result?.kind === "structured" ? { lateReport: terminal.result.value as WorkerReport } : {}),
			});
			if (reservation) {
				if (q.confirmed) {
					releaseReservation = true;
				} else {
					deps.store.setWriterHold(task.taskId, {
						executionId,
						reason: `stop unconfirmed after ${terminal.status}${q.confirmed === false && q.evidenceIncomplete ? "; stop-evidence sampling failed" : ""}`,
						since: nowIso(),
					});
				}
			}
			return {
				task: deps.store.require(task.taskId),
				executionId,
				...(responseRunId ? { runId: responseRunId } : {}),
				termination: {
					status: terminal.status,
					reason: endedReason,
					executionStatus: q.confirmed ? "stopped" : "stop_unconfirmed",
					terminationConfirmed: q.confirmed,
					...(q.confirmed ? { confirmationBasis: "terminal+quiet-worktree", cTerminal: q.cTerminal } : {}),
					quiescenceWaitMs,
					quiescenceWaitSource,
					...(q.confirmed === false && q.evidenceIncomplete ? { evidenceIncomplete: true } : {}),
					usageComplete,
					...(terminal.error ? { error: terminal.error } : {}),
				},
				warnings,
			};
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
				...(priorTruthPaths.length > 0 ? { priorTruthPaths } : {}),
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
			status: "completed",
			endedReason: "normal",
			endedAt: nowIso(),
			terminationConfirmed: true,
			confirmationBasis: "normal-completion",
			usageComplete: response.usage !== undefined,
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
		releaseReservation = true;
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
		options.signal?.removeEventListener("abort", onSignalAbort);
		// A4 — release only when a path proved the execution stopped; an
		//    unconfirmed stop holds the workspace via task.writerHold instead.
		if (reservation && releaseReservation) deps.concurrency.release(reservation.id);
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
	options: DelegationOptions,
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
	// A launch throw propagates as-is (DelegationAborted included): a
	// reviewer failure never moves the Task.
	const response = await deps.launch(request, options.signal, {
		onUpdate: (update) => options.onUpdate?.(renderDelegationProgress("reviewer", task.taskId, update)),
	});

	// R5 — non-completed statuses are structured outcomes, not throws; nothing
	//    is transitioned. G4: a terminal that still carries usage is recorded
	//    (outcome failed). The reviewer holds no writer, so there is no stop
	//    to confirm.
	if (response.status !== "completed") {
		if ("usage" in response && response.usage) {
			const child = childUsageFromValue(response.usage, "reviewer", {
				...(response.runId ? { runId: response.runId } : {}),
				toolCallId: ids.executionId,
				...(response.agent ? { agent: response.agent } : {}),
				...(response.model ? { model: response.model } : {}),
				...(response.thinking ? { thinking: response.thinking } : {}),
				source: "sync-details",
				pending: false,
				taskId: task.taskId,
				ownerRootSessionId: deps.ownerRunId,
			});
			if (child) deps.usage.recordChild(task.taskId, { ...child, outcome: "failed" });
		}
		return {
			task: deps.store.get(task.taskId) ?? task,
			executionId: ids.executionId,
			...("runId" in response && response.runId ? { runId: response.runId } : {}),
			termination: {
				status: response.status,
				reason: TERMINAL_ENDED_REASON[response.status] ?? "provider_failure",
				terminationConfirmed: true,
				usageComplete: "usage" in response && response.usage !== undefined,
				...("error" in response && response.error ? { error: response.error } : {}),
			},
			warnings,
		};
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
	const priorTruthPaths = latest
		? fresh.executions
			.filter((item) => item.executionId !== latest.executionId && !item.auxiliary && !item.reportOnly && item.truthPaths?.length)
			.flatMap((item) => item.truthPaths ?? [])
		: [];
	const comparison = latest
		? compareEvidence(latest.aRun, current, report, {
			...(fresh.spec?.scope ? { scope: fresh.spec.scope } : {}),
			...(roots?.length ? { additionalWorktreeRoots: roots } : {}),
			...(latest.readOnly ? { readOnly: true } : {}),
			...(priorTruthPaths.length > 0 ? { priorTruthPaths } : {}),
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

/**
 * A SubagentDelegationUpdate rendered as a partial AgentToolResult for the
 * host's onUpdate channel. This is display, not parsing: recentOutputLines
 * are truncated verbatim (slice only — no split/match/JSON), and the child's
 * tool arguments are deliberately never shown — they can carry paths and
 * commands the Root must not read out of the child's shell.
 */
export function renderDelegationProgress(
	role: DelegationKind,
	taskId: string,
	update: SubagentDelegationUpdate,
): { content: { type: "text"; text: string }[]; details: DelegationProgressDetails } {
	const lines = [
		`planner_delegate ${role} ${taskId}: ${Math.round((update.durationMs ?? 0) / 1000)}s · ${update.toolCount ?? 0} tools · ${update.currentTool ?? "…"}`,
	];
	for (const line of (update.recentOutputLines ?? []).slice(0, 3)) {
		lines.push(line.slice(0, 200));
	}
	return {
		content: [{ type: "text", text: lines.join("\n") }],
		details: {
			taskId,
			role,
			...(update.runId ? { runId: update.runId } : {}),
			...(update.currentTool ? { currentTool: update.currentTool } : {}),
			...(update.toolCount !== undefined ? { toolCount: update.toolCount } : {}),
			...(update.durationMs !== undefined ? { durationMs: update.durationMs } : {}),
			...(update.tokens !== undefined ? { tokens: update.tokens } : {}),
			progress: true,
		},
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
	if (outcome.termination) {
		const t = outcome.termination;
		lines.push(
			`termination: ${t.status ?? "no-terminal"} — reason=${t.reason}, confirmed=${t.terminationConfirmed}${t.confirmationBasis ? ` (${t.confirmationBasis})` : ""}${t.executionStatus ? `, execution=${t.executionStatus}` : ""}`,
		);
		if (t.executionStatus === "stop_unconfirmed") {
			lines.push("writer hold: kept — the workspace stays reserved until a late terminal confirms quiescence or the operator resolves it");
		}
		if (t.evidenceIncomplete) lines.push("warning: stop-evidence sampling failed; residual workspace state is unknown");
	}
	for (const warning of outcome.warnings) lines.push(`warning: ${warning}`);
	return lines.join("\n");
}

export interface HostLauncherOptions {
	/**
	 * Grace period after an abort to still accept the terminal response: the
	 * bridge answers CANCEL with a `cancelled` terminal (usage included)
	 * once the child is down. When it elapses the wait rejects with
	 * DelegationAborted.
	 */
	cancelGraceMs?: number;
}

/**
 * Process-local registry of delegations whose REQUEST was emitted but whose
 * wait has not settled — keyed by requestId so `cancelInFlightDelegations`
 * can reach them on shutdown.
 */
const inFlight = new Map<string, SubagentDelegationCancel>();

/**
 * Best-effort CANCEL for every in-flight delegation (session_shutdown use).
 * Returns the number of CANCELs emitted; entries whose bridge is unloaded
 * simply reach no listener.
 */
export function cancelInFlightDelegations(pi: ExtensionAPI): number {
	for (const payload of inFlight.values()) {
		pi.events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, payload);
	}
	return inFlight.size;
}

/**
 * The real launcher: spike `waitForDelegation` extended with UPDATE
 * forwarding and a bounded cancel grace. Emits the request on the shared
 * delegation transport, forwards identity-matched UPDATE payloads to
 * `hooks.onUpdate`, and resolves with the first matching terminal response.
 * Abort emits CANCEL (strict three-key payload — the bridge ignores extras)
 * and then keeps the RESPONSE subscription for `cancelGraceMs` so the
 * `cancelled` terminal — which carries usage — is not dropped; only a
 * grace overrun rejects with DelegationAborted.
 */
export function createHostLauncher(pi: ExtensionAPI, options: HostLauncherOptions = {}): DelegationDeps["launch"] {
	const cancelGraceMs = options.cancelGraceMs ?? 5000;
	return (request, signal, hooks) => new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DelegationAborted(request.nodeId, false));
			return;
		}
		let settled = false;
		let aborting = false;
		let graceTimer: ReturnType<typeof setTimeout> | undefined;
		const cancelPayload: SubagentDelegationCancel = {
			requestId: request.requestId,
			ownerRunId: request.ownerRunId,
			nodeId: request.nodeId,
		};
		const matches = (payload: { requestId: string; ownerRunId?: string; nodeId?: string }) =>
			payload.requestId === request.requestId
			&& (payload.ownerRunId === undefined || payload.ownerRunId === request.ownerRunId)
			&& (payload.nodeId === undefined || payload.nodeId === request.nodeId);
		const cleanup = () => {
			unsubscribeResponse();
			unsubscribeUpdate();
			signal?.removeEventListener("abort", onAbort);
			if (graceTimer !== undefined) clearTimeout(graceTimer);
			inFlight.delete(request.requestId);
		};
		const unsubscribeResponse = pi.events.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, (payload) => {
			const response = payload as SubagentDelegationResponse;
			if (!matches(response)) return;
			if (settled) {
				// A3 — grace already rejected, but the subscription stays live for
				//    exactly this: hand the late terminal to the caller's
				//    finalization once, then unsubscribe. Never resolve twice.
				cleanup();
				if (response.status !== "invalid_request") hooks?.onLateTerminal?.(response);
				return;
			}
			settled = true;
			cleanup();
			resolve(response);
		});
		const unsubscribeUpdate = pi.events.on(SUBAGENT_DELEGATION_UPDATE_EVENT, (payload) => {
			if (settled) return;
			const update = payload as SubagentDelegationUpdate;
			if (!matches(update)) return;
			hooks?.onUpdate?.(update);
		});
		const onAbort = () => {
			if (settled || aborting) return;
			aborting = true;
			pi.events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, cancelPayload);
			graceTimer = setTimeout(() => {
				if (settled) return;
				settled = true;
				// A3 — do NOT unsubscribe RESPONSE: the late terminal must still
				//    reach onLateTerminal so the execution can be finalized and
				//    the writer hold released. Drop only what serves no purpose.
				unsubscribeUpdate();
				signal?.removeEventListener("abort", onAbort);
				inFlight.delete(request.requestId);
				reject(new DelegationAborted(request.nodeId));
			}, cancelGraceMs);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		inFlight.set(request.requestId, cancelPayload);
		pi.events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
		// An abort landing between the early check and addEventListener never
		// fires the listener — catch it here so the grace path still runs.
		if (signal?.aborted) onAbort();
	});
}
