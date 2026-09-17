/**
 * `planner_delegate` / `planner_redelegate` — the typed Root/child delegation path (ADR-0001,
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
import { performance } from "node:perf_hooks";
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
	ExecutionEnvelope,
	ExecutionLifecycleStatus,
	FindingCategory,
	FindingSeverity,
	RecoveryDecision,
	ReviewResult,
	ReviewVerdict,
	RunawayObservation,
	RunawaySignal,
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

/** P0-B — validate the explicit envelope before launch (spec §4: no defaults). */
function validateEnvelope(raw: PlannerDelegationParams["envelope"], toolName = "planner_delegate"): ExecutionEnvelope | undefined {
	if (raw === undefined) return undefined;
	const check = (name: string, value: number | undefined): number | undefined => {
		if (value === undefined) return undefined;
		const normalized = Math.floor(value);
		if (!Number.isFinite(value) || normalized <= 0) {
			throw new DelegationRefused("ENVELOPE_INVALID", `${toolName} refused: envelope.${name} must normalize to a positive finite integer, got ${value}`);
		}
		return normalized;
	};
	const maxTokens = check("maxTokens", raw.maxTokens);
	const maxWallMs = check("maxWallMs", raw.maxWallMs);
	if (maxTokens === undefined && maxWallMs === undefined) {
		throw new DelegationRefused("ENVELOPE_INVALID", `${toolName} refused: envelope requires at least one of maxTokens / maxWallMs`);
	}
	return { ...(maxTokens !== undefined ? { maxTokens } : {}), ...(maxWallMs !== undefined ? { maxWallMs } : {}), source: "delegation-param" };
}

/** P0-B — actions wired for planner_redelegate re-execution. */
const DELEGATE_RECOVERY_ACTIONS = new Set(["retry_same_plan", "fix_environment"]);
/** P0-B — actions that need P1 machinery and are refused until then. */
const P1_RECOVERY_ACTIONS = new Set(["narrow_task", "add_information", "repair_protocol", "change_model", "change_tool_strategy"]);

/**
 * P0-B — validate a RecoveryDecision against a Task's recovery requirement
 * (spec §5). Shared by planner_redelegate (re-execution actions) and
 * planner_abort (abort, ADR-0003). Returns a refusal message, or undefined
 * when the decision is admissible.
 */
export function validateRecoveryDecision(
	task: TaskRecord,
	decision: RecoveryDecision | undefined,
	allowedActions: ReadonlySet<string>,
): string | undefined {
	const required = task.recovery;
	if (!required?.required) {
		return decision === undefined
			? `planner_delegate refused: Task ${task.taskId} is ${task.state}; start a new Task instead`
			: `recovery is only admissible while the Task flags recovery.required (Task ${task.taskId} does not)`;
	}
	if (decision === undefined) {
		return `Task ${task.taskId} requires a RecoveryDecision: execution ${required.executionId} ended abnormally (${required.reason}); submit recovery{executionId, action, reason, worktreeDecision} or abort via planner_abort`;
	}
	if (decision.executionId !== required.executionId) {
		return `recovery.executionId ${decision.executionId} does not match the abnormal execution ${required.executionId}`;
	}
	if (required.consumedBy !== undefined) {
		return `recovery for execution ${required.executionId} was already consumed by ${required.consumedBy}`;
	}
	if (decision.action === "abort" && !allowedActions.has("abort")) {
		return "recovery action abort goes through planner_abort, not planner_redelegate";
	}
	if (!allowedActions.has(decision.action)) {
		return P1_RECOVERY_ACTIONS.has(decision.action)
			? `recovery action ${decision.action} is not wired in P0 — it needs P1 ExecutionContract/ExecutionControls`
			: `unknown recovery action ${decision.action}; P0 wires ${[...allowedActions].join(", ")}`;
	}
	if (typeof decision.reason !== "string" || decision.reason.trim() === "") {
		return "recovery.reason must name a concrete basis for the retry";
	}
	const evidenceKey = (refs: string[] | undefined) => [...new Set(refs ?? [])].sort().join("\u0000");
	const duplicate = (task.recoveryHistory ?? []).find(
		(entry) =>
			entry.action === decision.action
			&& entry.worktreeDecision === decision.worktreeDecision
			&& evidenceKey(entry.evidenceRefs) === evidenceKey(decision.evidenceRefs),
	);
	if (duplicate) {
		return `an equivalent recovery decision (${decision.action} / same evidence and worktree decision) was already consumed by ${duplicate.consumedBy}; rewording the reason is not a new basis`;
	}
	return undefined;
}

/**
 * ADR-0002 — the delegation surface is split in two. `planner_delegate` only
 * mints: its schema has no taskId/recovery keys, so a hallucinated id cannot
 * reach the binding path. `planner_redelegate` only binds: taskId is
 * required, verbatim, never constructed. Both derive from these shared field
 * definitions so the TaskSpec shape stays identical.
 */
const DELEGATION_SPEC_PARAMETERS = {
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
		commands: Type.Optional(Type.Array(Type.String(), {
			description: "Required and must contain at least one non-empty command when validation.required is true. Each entry is a shell command starting with a program name or path, not an instruction sentence.",
		})),
	}),
	instructions: Type.Optional(
		Type.String({
			description: "Extra prose passed down to the child verbatim. Never read back.",
		}),
	),
	envelope: Type.Optional(
		Type.Object({
			maxTokens: Type.Optional(Type.Number({ description: "Cancel the child when cumulative UPDATE tokens exceed this. Snapshot input+output, no cache." })),
			maxWallMs: Type.Optional(Type.Number({ description: "Cancel the child when wall-clock since launch exceeds this many ms." })),
		}, {
			description: "P0-B runaway envelope. Explicit only — when omitted the monitor observes but never cancels.",
		}),
	),
};

const DELEGATION_RECOVERY_PARAMETER = Type.Optional(
	Type.Object({
		executionId: Type.String({ minLength: 1 }),
		action: Type.String({ minLength: 1, description: "P0 wired: retry_same_plan | fix_environment. abort goes through planner_abort; the rest need P1." }),
		reason: Type.String({ minLength: 1 }),
		evidenceRefs: Type.Optional(Type.Array(Type.String())),
		worktreeDecision: Type.Union([Type.Literal("keep"), Type.Literal("manual")]),
	}, {
		description: "RecoveryDecision (spec §5): required to re-execute a Task whose recovery.required is set.",
	}),
);

/**
 * planner_delegate — mint-only surface. No taskId, no recovery, no reviewer
 * role: a reviewer invocation only exists over an existing Task, and recovery
 * only makes sense on a bound Task. Anything else is a new Task.
 */
export const PLANNER_DELEGATE_PARAMETERS = Type.Object({
	role: Type.Union([Type.Literal("worker"), Type.Literal("explorer"), Type.Literal("validator")], {
		description: "Delegation role. worker implements; explorer does read-only recon (scout agent); validator runs an oracle verdict. Reviews of an existing Task go through planner_redelegate with role=reviewer.",
	}),
	...DELEGATION_SPEC_PARAMETERS,
});

/**
 * planner_redelegate — bind-only surface over an existing Task: correction
 * rounds, reviewer invocations, and recovery re-executions. taskId is
 * required and must name a real record; the explicit id binds verbatim
 * (delegate.ts binding contract, ticket 53).
 */
export const PLANNER_REDELEGATE_PARAMETERS = Type.Object({
	taskId: Type.String({
		pattern: TASK_ID_PATTERN,
		description: "Canonical id of an existing Task, verbatim from a prior planner_delegate result's details.taskId. Never construct one.",
	}),
	role: Type.Union([Type.Literal("worker"), Type.Literal("explorer"), Type.Literal("validator"), Type.Literal("reviewer")], {
		description: "Delegation role. worker implements a correction round; explorer does read-only recon (scout agent); validator runs an oracle verdict; reviewer reviews the bound Task's latest WorkerReport — objective / scope / constraints / acceptanceCriteria / validation / instructions are ignored, the Task's stored spec is the reviewer's context.",
	}),
	...DELEGATION_SPEC_PARAMETERS,
	recovery: DELEGATION_RECOVERY_PARAMETER,
});

export type PlannerDelegateParams = Static<typeof PLANNER_DELEGATE_PARAMETERS>;
export type PlannerRedelegateParams = Static<typeof PLANNER_REDELEGATE_PARAMETERS>;
/**
 * The shape `runDelegation` consumes: both tool surfaces converge here. The
 * adapter strips any taskId/recovery a non-validating host passed through
 * planner_delegate, so reaching this type with a taskId means a rebind call.
 */
export type PlannerDelegationParams = Omit<PlannerRedelegateParams, "taskId"> & { taskId?: string };

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
	/**
	 * Wall-envelope clock: a monotonic `now()` plus the timer pair. Tests
	 * inject a virtual clock; production defaults to performance.now and the
	 * global timers. Distinct from `now`, which only renders ISO timestamps.
	 */
	wallClock?: {
		now(): number;
		setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
		clearTimeout(handle: ReturnType<typeof setTimeout>): void;
	};
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
	/** P0-B — which envelope bound tripped (signal/observed/limit) plus its config source. */
	anomaly?: RunawayObservation & { source: string };
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
	/**
	 * Display name of the invoking tool surface (planner_delegate /
	 * planner_redelegate); progress, outcome, and refusal text name it. The
	 * refusal codes and the ticket-13/14/15 guidance stay byte-stable — only
	 * the surface name and the mint-vs-bind clause adapt.
	 */
	toolName?: string;
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

function specFromParams(params: PlannerDelegationParams, taskId: string, cwd: string): TaskSpec {
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
	params: PlannerDelegationParams,
	cwd: string,
	options: DelegationOptions = {},
): Promise<DelegationOutcome> {
	const role = params.role;
	const effectiveCwd = params.cwd ?? cwd;
	const requestId = randomUUID();
	const executionId = options.executionId ?? requestId;
	const warnings: string[] = [];
	// ADR-0002 — refusal text names the surface that was actually called.
	// Ticket 18 — the lookup tool exists now, so unknown-id guidance points at
	// planner_tasks instead of asking the caller to guess or construct.
	const toolName = options.toolName ?? "planner_delegate";

	// A reviewer call only exists over an existing Task — minting one would
	// leave nothing to review. Checked before binding so the refusal never
	// consumes an id.
	if (role === "reviewer" && !params.taskId) {
		throw new DelegationRefused("TASK_REQUIRED", `${toolName} refused: role=reviewer requires taskId of the Task under review`);
	}

	// 1. Task binding: an explicit id binds the existing record verbatim —
	//    its stored spec is never rewritten (ticket 53); this call's spec
	//    only goes into the packet.
	let task: TaskRecord;
	let thisSpec: TaskSpec;
	if (params.taskId) {
		const record = deps.store.get(params.taskId);
		if (!record) {
			const guidance = role === "reviewer"
				? "role=reviewer can only bind an existing Task — call planner_tasks to find its canonical taskId"
				: "call planner_tasks to list live Tasks, or use planner_delegate to create a new one";
			throw new DelegationRefused(
				"TASK_UNKNOWN",
				`${toolName} refused: unknown Task ${params.taskId}; ${guidance}`,
			);
		}
		if (record.cwd && normalizeWorkspaceIdentity(record.cwd) !== normalizeWorkspaceIdentity(effectiveCwd)) {
			const guidance = role === "reviewer"
				? "re-run from that workspace's cwd — call planner_tasks there to list its live Tasks — or pass an existing reviewable Task id in this workspace"
				: "re-run from that workspace's cwd — call planner_tasks there to list its live Tasks — or call planner_delegate to mint a new Task in this workspace";
			throw new DelegationRefused(
				"TASK_FOREIGN_WORKSPACE",
				`${toolName} refused: Task ${record.taskId} belongs to workspace ${record.cwd}, not ${effectiveCwd}; the id belongs to a different workspace's ledger; ${guidance}`,
			);
		}
		task = record;
		// Ticket 03 (wrc-incident-followups) — reject a stray decision for
		// every role before role-specific dispatch. In particular, reviewers
		// must not bypass this gate through the early return below.
		if (!isFinalTaskState(task.state) && params.recovery !== undefined) {
			const stray = params.recovery as { executionId?: unknown; action?: unknown };
			throw new DelegationRefused(
				"RECOVERY_NOT_APPLICABLE",
				[
					`${toolName} refused: recovery is only admissible on a blocked Task flagged recovery.required — Task ${task.taskId} is ${task.state} with no pending requirement.`,
					`received executionId=${typeof stray.executionId === "string" ? stray.executionId : "(missing)"}, action=${typeof stray.action === "string" ? stray.action : "(missing)"}; executionId names the abnormal execution's details.executionId, not a child runId.`,
					"For a correction or review round omit recovery; to abandon a flagged execution use planner_abort.",
				].join(" "),
				task.taskId,
			);
		}
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
	// P0-B — a blocked Task flagged recovery.required only re-executes under a
	// valid RecoveryDecision (spec §5); other final states stay TASK_CLOSED.
	let recoveryDecision: RecoveryDecision | undefined;
	if (isFinalTaskState(task.state)) {
		if (task.state === "blocked" && task.recovery?.required === true) {
			const refusal = validateRecoveryDecision(task, params.recovery as RecoveryDecision | undefined, DELEGATE_RECOVERY_ACTIONS);
			if (refusal) throw new DelegationRefused("RECOVERY_REQUIRED", `${toolName} refused: ${refusal}`, task.taskId);
			recoveryDecision = params.recovery as RecoveryDecision;
		} else {
			throw new DelegationRefused(
				"TASK_CLOSED",
				`${toolName} refused: Task ${task.taskId} is ${task.state}; start a new Task instead`,
				task.taskId,
			);
		}
	}

	// P0-B — the explicit anomaly envelope; validated before launch, never defaulted.
	const envelope = validateEnvelope(params.envelope, toolName);

	// 2. Write lock: workers and validators claim the workspace; readers/explorers
	//    run beside an active writer by design. A persisted writerHold outlives
	//    both the session and the reservation map: a stop-unconfirmed
	//    workspace admits no second writer (A4).
	let reservation: ConcurrencyReservation | undefined;
	if (role === "worker" || role === "validator") {
		if (task.writerHold && recoveryDecision?.worktreeDecision === "manual") {
			deps.concurrency.release(task.writerHold.executionId);
			deps.concurrency.release(`writerhold:${task.writerHold.executionId}`);
			task = deps.store.clearWriterHold(task.taskId);
		}
		if (task.writerHold) {
			throw new DelegationRefused(
				"WRITER_HOLD",
				`${toolName} refused: Task ${task.taskId} writer execution ${task.writerHold.executionId} was never confirmed stopped (${task.writerHold.reason}); submit a matching recovery with worktreeDecision=manual only after operator resolution`,
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
			throw new DelegationRefused("WRITER_CONFLICT", `${toolName} refused: ${admission.refusal.reason}`);
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
	// P0-B — the launcher listens on an internal controller so the runaway
	//    monitor fires the same CANCEL path as the operator's signal; exactly
	//    one control action per execution (spec §3).
	const runController = new AbortController();
	let runaway: RunawayObservation | undefined;
	let maxTokensSeen = -1;
	// Ticket 01 (wrc-incident-followups) — elapsed is read from a monotonic
	//    clock, not Date.now: a wall-clock rollback can no longer shrink or
	//    negate it.
	const wallNow = deps.wallClock?.now ?? (() => performance.now());
	const armWallTimer = deps.wallClock?.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
	const disarmWallTimer = deps.wallClock?.clearTimeout ?? ((handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
	let launchStartedAt = 0;
	let wallTimer: ReturnType<typeof setTimeout> | undefined;
	const stopWallTimer = () => {
		if (wallTimer) disarmWallTimer(wallTimer);
		wallTimer = undefined;
	};
	const breach = (signal: RunawaySignal, observed: number, limit: number) => {
		if (runaway || runController.signal.aborted) return;
		runaway = { signal, observed, limit };
		try {
			deps.store.finalizeExecution(task.taskId, executionId, { runawayObservation: runaway });
		} catch { /* monitoring must not fail the delegation */ }
		runController.abort();
	};
	// P0-A — stamp the cancel request on the execution the moment the signal
	// fires (operator or monitor); the launcher emits CANCEL on the same signal.
	const onSignalAbort = () => {
		if (cancelRequestedAt) return;
		cancelRequestedAt = nowIso();
		try {
			deps.store.finalizeExecution(task.taskId, executionId, { status: "cancel_requested", cancelRequestedAt });
		} catch { /* the abort path must not fail on a ledger write */ }
	};
	runController.signal.addEventListener("abort", onSignalAbort, { once: true });
	const forwardAbort = () => runController.abort();
	options.signal?.addEventListener("abort", forwardAbort, { once: true });
	if (options.signal?.aborted) runController.abort();
	if (runController.signal.aborted) onSignalAbort();

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
			...(envelope ? { envelope } : {}),
			...(role !== "worker" ? { readOnly: true } : {}),
			...(role === "validator" ? { auxiliary: true } : {}),
		});
		// P0-B — the recovery decision is consumed by the execution it
		//    authorized; the same abnormal execution cannot be recovered twice.
		if (recoveryDecision) {
			deps.store.consumeRecovery(task.taskId, recoveryDecision, executionId);
		}

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
				const endedReason: ExecutionEndedReason = runaway
					? "worker_runaway"
					: cancelRequestedAt
						? "operator_cancel"
						: (TERMINAL_ENDED_REASON[late.status] ?? "provider_failure");
				deps.store.finalizeExecution(task.taskId, executionId, {
					status: q.confirmed ? "stopped" : "stop_unconfirmed",
					endedReason,
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
			// P0-B — wall clock is independent of UPDATE heartbeats; a silent child
			//    still trips maxWallMs. Cleared as soon as the launcher returns.
			launchStartedAt = wallNow();
			if (envelope?.maxWallMs !== undefined) {
				const wallLimit = envelope.maxWallMs;
				// Ticket 01 — the deadline callback re-checks elapsed instead of
				//    breaching unconditionally: a timer that fires early re-arms
				//    for the remainder (each re-arm bounded by the limit, so a
				//    backwards clock cannot stretch it). Only a real overrun
				//    breaches, keeping anomaly.observed >= anomaly.limit.
				const onWallDeadline = () => {
					const elapsed = wallNow() - launchStartedAt;
					if (elapsed < wallLimit) {
						wallTimer = armWallTimer(onWallDeadline, Math.min(wallLimit, Math.ceil(wallLimit - elapsed)));
						return;
					}
					breach("wall", Math.floor(elapsed), wallLimit);
				};
				wallTimer = armWallTimer(onWallDeadline, wallLimit);
			}
			response = await deps.launch(request, runController.signal, {
				onUpdate: (update) => {
					// P0-B monitor — cumulative token snapshot, max not sum;
					// unknown/regressing counts never reset the observed level.
					if (envelope?.maxTokens !== undefined) {
						const tokens = update.tokens;
						if (typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0) {
							maxTokensSeen = Math.max(maxTokensSeen, tokens);
							if (maxTokensSeen > envelope.maxTokens) breach("tokens", maxTokensSeen, envelope.maxTokens);
						}
					}
					options.onUpdate?.(renderDelegationProgress(role as DelegationKind, task.taskId, update, options.toolName));
				},
				onLateTerminal: settleLateTerminal,
			});
			stopWallTimer();
		} catch (error) {
			stopWallTimer();
			const aborted = error instanceof DelegationAborted || runController.signal.aborted === true;
			if (aborted) {
				const emitted = !(error instanceof DelegationAborted) || error.requestEmitted;
				const abortedReason: ExecutionEndedReason = runaway ? "worker_runaway" : "operator_cancel";
				if (emitted) {
					// Grace expired with no terminal: the stop is unconfirmed. The
					// reservation becomes a persisted hold — released only when a
					// late terminal confirms quiescence (A3/A4).
					deps.store.finalizeExecution(task.taskId, executionId, {
						status: "stop_unconfirmed",
						endedReason: abortedReason,
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
					// P0-B — needs_replan: a runaway or unconfirmed stop needs a
					//    RecoveryDecision before this Task may execute again.
					deps.store.setRecoveryRequired(task.taskId, {
						reason: runaway
							? `worker runaway: ${runaway.signal} ${runaway.observed} exceeded envelope ${runaway.limit}; stop unconfirmed`
							: "stop unconfirmed — await confirmation or operator resolution",
						executionId,
					});
				} else {
					// Aborted before the REQUEST was emitted: nothing ever ran,
					// so there is nothing to confirm.
					deps.store.finalizeExecution(task.taskId, executionId, {
						status: "stopped",
						endedReason: abortedReason,
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
					runaway
						? `worker runaway: ${runaway.signal} ${runaway.observed} exceeded envelope ${runaway.limit}; ${emitted ? "stop unconfirmed, writer hold kept" : "cancelled before launch"}`
						: emitted
							? "delegation cancelled by operator; no terminal response within grace — stop unconfirmed, writer hold kept"
							: "delegation cancelled by operator before launch",
				);
				return {
					task: deps.store.require(task.taskId),
					executionId,
					termination: {
						reason: abortedReason,
						executionStatus: emitted ? "stop_unconfirmed" : "stopped",
						terminationConfirmed: !emitted,
						...(emitted ? {} : { confirmationBasis: "no-launch" }),
						...(runaway ? { anomaly: { ...runaway, source: "delegation-param" } } : {}),
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
					: runaway
						? `worker runaway: ${runaway.signal} ${runaway.observed} exceeded envelope ${runaway.limit}; delegation ${terminal.status}`
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
				: runaway
					? "worker_runaway"
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
			// P0-B — needs_replan: runaway or an unconfirmed stop requires a
			//    RecoveryDecision before this Task may execute again.
			if (runaway || !q.confirmed) {
				deps.store.setRecoveryRequired(task.taskId, {
					reason: runaway
						? `worker runaway: ${runaway.signal} ${runaway.observed} exceeded envelope ${runaway.limit}${q.confirmed ? "" : "; stop unconfirmed"}`
						: "stop unconfirmed — await confirmation or operator resolution",
					executionId,
				});
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
					...(runaway ? { anomaly: { ...runaway, source: "delegation-param" } } : {}),
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
		const completionQuiescence = await evaluateQuiescence(runId);
		if (!completionQuiescence.confirmed) {
			let usageComplete = false;
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
				if (child) {
					deps.usage.recordChild(task.taskId, { ...child, outcome: "failed" });
					usageComplete = true;
				}
			}
			deps.store.finalizeExecution(task.taskId, executionId, {
				status: "stop_unconfirmed",
				endedReason: "normal",
				endedAt: nowIso(),
				terminationConfirmed: false,
				cReport,
				interimSample: completionQuiescence.interim,
				...(completionQuiescence.evidenceIncomplete ? { evidenceIncomplete: true } : {}),
				usageComplete,
				...(runId ? { runId } : {}),
			});
			try { deps.store.transition(task.taskId, "blocked"); } catch { /* already final */ }
			deps.store.setStateReason(task.taskId, "completed terminal arrived but worktree quiescence was not confirmed; report not admitted");
			if (reservation) {
				deps.store.setWriterHold(task.taskId, {
					executionId,
					reason: `stop unconfirmed after completed${completionQuiescence.evidenceIncomplete ? "; stop-evidence sampling failed" : ""}`,
					since: nowIso(),
				});
			}
			deps.store.setRecoveryRequired(task.taskId, {
				reason: "completed terminal without confirmed worktree quiescence — await confirmation or operator resolution",
				executionId,
			});
			return {
				task: deps.store.require(task.taskId),
				executionId,
				...(runId ? { runId } : {}),
				termination: {
					status: "completed",
					reason: "normal",
					executionStatus: "stop_unconfirmed",
					terminationConfirmed: false,
					quiescenceWaitMs,
					quiescenceWaitSource,
					...(completionQuiescence.evidenceIncomplete ? { evidenceIncomplete: true } : {}),
					usageComplete,
				},
				warnings,
			};
		}
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
			confirmationBasis: "terminal+quiet-worktree",
			usageComplete: response.usage !== undefined,
			cReport,
			cTerminal: completionQuiescence.cTerminal,
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
		stopWallTimer();
		options.signal?.removeEventListener("abort", forwardAbort);
		runController.signal.removeEventListener("abort", onSignalAbort);
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
	const toolName = options.toolName ?? "planner_delegate";

	// R1 — only a non-terminal Task with a WorkerReport is reviewable. The
	//    no-report refusal moved forward from the legacy return path: with no
	//    report there is no revision to bind and nothing to judge.
	if (isTerminalTaskState(task.state)) {
		throw new DelegationRefused(
			"REVIEW_TERMINAL",
			`${toolName} refused: Task ${task.taskId} is ${task.state}; there is nothing left to review`,
		);
	}
	if (task.reports.length === 0) {
		throw new DelegationRefused(
			"REVIEW_NO_REPORT",
			`${toolName} refused: Task ${task.taskId} has no WorkerReport to review`,
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
		onUpdate: (update) => options.onUpdate?.(renderDelegationProgress("reviewer", task.taskId, update, options.toolName)),
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
			`${toolName} refused: reviewer result for ${task.taskId} failed ReviewResult validation: ${shapeErrors.join("; ") || "not a structured value"}`,
		);
	}
	const review: ReviewResult = { ...(value as ReviewResult), source: "reviewer" };
	const identityErrors = validateReviewResultIdentity(review, task.taskId);
	if (identityErrors.length > 0) {
		throw new DelegationRefused("REVIEW_IDENTITY", `${toolName} refused: ${identityErrors.join("; ")}`);
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
		throw new DelegationRefused("REVIEW_BINDING", `${toolName} refused: ${bindingErrors.join("; ")}`);
	}
	if (bound.verdict === "pass" && packetTruncated) {
		throw new DelegationRefused(
			"REVIEW_PACKET_TRUNCATED",
			`${toolName} refused: the review packet for ${task.taskId} was truncated (patchTruncated or omitted patch paths); a pass over a partial packet is not eligible`,
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
				`${toolName} refused: report revision ${fresh.reports.length} of ${task.taskId} has no per-execution A_run/C_report binding; a pass cannot be judged fresh`,
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
	toolName = "planner_delegate",
): { content: { type: "text"; text: string }[]; details: DelegationProgressDetails } {
	const lines = [
		`${toolName} ${role} ${taskId}: ${Math.round((update.durationMs ?? 0) / 1000)}s · ${update.toolCount ?? 0} tools · ${update.currentTool ?? "…"}`,
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
export function renderDelegationOutcome(outcome: DelegationOutcome, toolName = "planner_delegate"): string {
	const lines = [
		`${toolName}: ${outcome.task.taskId} ${outcome.task.state} run=${outcome.runId ?? "none"}`,
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
		if (t.anomaly) {
			lines.push(`anomaly: ${t.anomaly.signal} observed=${t.anomaly.observed} limit=${t.anomaly.limit} (source: ${t.anomaly.source})`);
		}
		if (t.executionStatus === "stop_unconfirmed") {
			lines.push("writer hold: kept — the workspace stays reserved until a late terminal confirms quiescence or the operator resolves it");
		}
		if (t.evidenceIncomplete) lines.push("warning: stop-evidence sampling failed; residual workspace state is unknown");
	}
	if (outcome.task.recovery?.required) {
		const r = outcome.task.recovery;
		lines.push(`recovery.required: ${r.reason} — submit planner_redelegate.recovery{executionId=${r.executionId}, action, reason, worktreeDecision} or planner_abort{executionId=${r.executionId}, reason, worktreeDecision}`);
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
