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
	SUBAGENT_DELEGATION_STARTED_EVENT,
	SUBAGENT_DELEGATION_UPDATE_EVENT,
	type SubagentDelegationCancel,
	type SubagentDelegationJsonSchemaObject,
	type SubagentDelegationRequest,
	type SubagentDelegationResponse,
	type SubagentDelegationStarted,
	type SubagentDelegationTerminalResponse,
	type SubagentDelegationUpdate,
	type SubagentDelegationUsage,
} from "./subagent-delegation-contract.ts";
import type { GitRunner } from "./git-audit.ts";
import type { ConcurrencyController, ConcurrencyReservation } from "./concurrency.ts";
import { captureEvidence, captureReviewEvidencePacket, compareEvidence, compareExecutionTruth, compareFreshness, describeComparison, describeProbeFailures, environmentFailureOf } from "./evidence.ts";
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
import { loadExecutionDefaults, REQUEST_EXECUTION_RESERVE_MS } from "./execution-defaults.ts";
import type { RequestTimingObservation } from "./request-control.ts";
import { acceptanceModeOf, isFinalTaskState, isTerminalTaskState } from "./types.ts";
import { READ_ONLY_TOOLS } from "./policy.ts";
import type {
	AcceptanceMode,
	DelegationKind,
	EvidenceRef,
	ExecutionCapability,
	ExecutionEndedReason,
	ExecutionEnvelope,
	RequestExecutionBudget,
	ExecutionToolBudget,
	ExecutionLifecycleStatus,
	FindingCategory,
	FindingSeverity,
	GitProbeFailure,
	RecoveryDecision,
	ReviewResult,
	ReviewVerdict,
	RunawayObservation,
	RunawaySignal,
	TaskFinding,
	TaskExecutionRecord,
	TaskLaunchRefusal,
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

export const REPORT_ONLY_AGENT = "planner-report-only";
export const REPORT_ONLY_TOOL_BUDGET: Readonly<ExecutionToolBudget> = Object.freeze({ hard: 1, block: "*" });
export const REPORT_ONLY_DEFINITION = {
	description: "Planner-only report correction: submits one structured WorkerReport and has no other tools",
	systemPromptMode: "replace" as const,
	inheritProjectContext: false,
	inheritGlobalContext: false,
	inheritSkills: false,
	allowNestedSubagents: false,
	completionGuard: false,
	tools: [] as string[],
	systemPrompt: [
		"Return only the structured WorkerReport requested by the supplied task context.",
		"Do not inspect or modify the workspace and do not perform any other action.",
	].join("\n"),
};

const REPORT_DECLARATION_FINDINGS = new Set<TaskFinding["kind"]>(["undeclared", "over-declared", "missing"]);

/**
 * A closed report-only child cannot inspect the workspace. Give it only the
 * typed report material and bounded Root evidence already held by the Task.
 * Caller prose is diagnostic input inside this envelope, never authority for
 * the origin or evidence facts.
 */
function buildReportOnlyRepairInstructions(
	task: TaskRecord,
	origin: TaskExecutionRecord,
	callerInstructions: string,
): string {
	const priorReport = origin.unacceptedReport
		?? origin.lateReport
		?? (origin.reportIndex !== undefined ? task.reports[origin.reportIndex] : task.reports.at(-1));
	const cumulativeTruthPaths = [...new Set(task.executions
		.filter((item) => !item.auxiliary && !item.reportOnly)
		.flatMap((item) => item.truthPaths ?? []))];
	return JSON.stringify({
		kind: "report-only-correction-context",
		originExecutionId: origin.executionId,
		priorTypedReport: priorReport ?? null,
		rootEvidence: {
			aRun: origin.aRun,
			cReport: origin.cReport,
			originTruthPaths: origin.truthPaths ?? [],
			cumulativeTruthPaths,
			declarationFindings: task.findings
				.filter((finding) => finding.executionId === origin.executionId && finding.status === "open"
					&& REPORT_DECLARATION_FINDINGS.has(finding.kind))
				.map((finding) => ({ kind: finding.kind, paths: finding.paths, note: finding.note })),
		},
		callerInstructions: callerInstructions.trim(),
		rules: [
			"Repair only the WorkerReport declaration from the supplied typed report and Root evidence.",
			"Do not invent missing work, validation, evidence, or workspace facts.",
			"Submit exactly one structured WorkerReport and perform no other action.",
		],
	}, null, 2);
}

/** A `failed` terminal whose child never ran (no turn, no wall time) is a launch-time rejection, not a provider fault. */
function terminalEndedReason(terminal: { status: string; usage?: { turns: number; durationMs: number } }): ExecutionEndedReason {
	if (terminal.status === "failed" && terminal.usage && terminal.usage.turns === 0 && terminal.usage.durationMs === 0) return "launch_failure";
	return TERMINAL_ENDED_REASON[terminal.status] ?? "provider_failure";
}

/** P0-A default quiescence wait after an identity-matched terminal (spec §3). */
export const DEFAULT_QUIESCENCE_WAIT_MS = 10_000;
const DEFAULT_QUIESCENCE_SAMPLE_GAP_MS = 250;

/**
 * Ticket 02 — the plugin-owned restricted reader. Builtin `scout` declares
 * bash+write, so it can never prove read-only behavior; the trusted binding
 * is this runtime-registered agent whose declared tool list is the entire
 * proof — every mutation entry point is absent by construction. index.ts
 * registers it with pi-subagents at session start and only supplies
 * `restrictedReaderAgent` on `DelegationDeps` when registration succeeded.
 */
export const RESTRICTED_READER_AGENT = "planner-scout";

/** The declared tool allowlist — the capability proof itself. */
export const RESTRICTED_READER_TOOLS = ["read", "grep", "find", "ls"] as const;

/**
 * Register a plugin-owned runtime agent with pi-subagents. The definitions
 * opt out of the completion-guard text heuristic (`completionGuard: false`,
 * pi-subagents ≤ 0.70.0); pi-subagents removed that field in #2356 (main
 * 2026-09-20) and its registry rejects unknown fields, so a rejection naming
 * `completionGuard` is retried once without it. Any other failure, or a
 * missing owner, leaves the agent unregistered. Returns true only when the
 * owner accepted the definition.
 */
export function registerPluginRuntimeAgent(
	emit: (event: string, request: unknown) => void,
	name: string,
	definition: Record<string, unknown>,
): boolean {
	const attempt = (candidate: Record<string, unknown>): { ok?: boolean; error?: unknown; registration?: unknown } | undefined => {
		const request: { version: number; name: string; definition: unknown; result?: { ok?: boolean; error?: unknown; registration?: unknown } } = {
			version: 1,
			name,
			definition: candidate,
		};
		emit("pi-subagents:runtime-agent-register:v1", request);
		return request.result;
	};
	const first = attempt(definition);
	if (first?.ok === true && first.registration !== undefined) return true;
	if (first?.ok === false && "completionGuard" in definition) {
		const message = first.error instanceof Error ? first.error.message : String(first.error ?? "");
		if (/unknown fields?:[^.]*\bcompletionGuard\b/.test(message)) {
			const { completionGuard: _dropped, ...withoutGuard } = definition;
			const second = attempt(withoutGuard);
			return second?.ok === true && second.registration !== undefined;
		}
	}
	return false;
}

/**
 * The agent definition index.ts hands to the runtime-agent registry. The
 * declared tool allowlist is the capability proof; pi-subagents' completion
 * guard is a text heuristic over Root-authored spec prose (e.g. "do not
 * create, modify, or delete") that can misread a read-only observation task
 * as an implementation task and refuse the launch, so it is disabled here.
 */
export const RESTRICTED_READER_DEFINITION = {
	description: "Planner-only read-only Explorer: inspects the workspace and reports findings; cannot modify anything",
	systemPromptMode: "replace" as const,
	inheritProjectContext: true,
	inheritSkills: false,
	completionGuard: false,
	tools: [...RESTRICTED_READER_TOOLS],
	systemPrompt: [
		"You are a read-only observation Explorer running inside pi.",
		"You may ONLY use read, grep, find, and ls. You have no shell, no edit, no write, and no delegation tool.",
		"Inspect the workspace, gather the requested information, and return your findings in the structured result.",
		"Never modify, create, or delete anything. If the task requires changes, report that requirement instead of attempting it.",
	].join("\n"),
};

/**
 * Ticket 02 — the single capability classifier. One decision feeds launch
 * admission, stop confirmation, cancellation, persistence, and restore, so
 * no path can disagree about what an execution could have mutated.
 *
 * Only the plugin-owned restricted binding earns `restricted-reader`: the
 * classification never consults the Task's role text, the model's
 * self-report, or a `readOnly` flag — a shell-capable Validator stays a
 * writer even though its execution is recorded readOnly.
 */
function classifyExecutionCapability(
	role: DelegationKind,
	restrictedReaderAgent: string | undefined,
): { capability: ExecutionCapability; basis: string; agent?: string } {
	if (role === "explorer") {
		if (restrictedReaderAgent === undefined) {
			return {
				capability: "unknown",
				basis: "no trusted restricted-reader binding is registered in this host",
			};
		}
		return {
			capability: "restricted-reader",
			basis: `agent '${restrictedReaderAgent}' bound with declared tools [${RESTRICTED_READER_TOOLS.join(", ")}] — no shell, edit, write, or fan-out entry point`,
			agent: restrictedReaderAgent,
		};
	}
	// worker and validator children keep their full tool surface; the
	// reviewer fork holds no execution at all, so this arm is defensive.
	return {
		capability: "writer",
		basis: role === "validator"
			? "validator oracle may execute validation commands; writer isolation applies"
			: "child retains shell/edit/write tools; writer isolation applies",
	};
}

/**
 * Ticket 04 — can the captured A_run support a writer's evidence contract?
 * Only a sample that is itself provably unusable refuses: git unavailable,
 * the status probe failed, a declared root unreadable, or the content
 * snapshot incomplete. An ambiguous-but-usable sample (e.g. unborn HEAD on a
 * fresh repo) still launches — the existing comparison judges it.
 */
export function writerEvidenceAdmissible(sample: EvidenceRef): boolean {
	return sample.gitAvailable !== false
		&& sample.statusProbeFailed !== true
		&& (sample.unavailableWorktreeRoots?.length ?? 0) === 0
		&& sample.snapshotGap === undefined;
}

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

/** Validate an explicit envelope without raising either caller-supplied bound. */
function validateEnvelope(raw: PlannerDelegationParams["envelope"], toolName = "planner_delegate"): ExecutionEnvelope | undefined {
	if (raw === undefined) return undefined;
	const check = (name: string, value: number | undefined): number | undefined => {
		if (value === undefined) return undefined;
		const normalized = Math.floor(value);
		if (!Number.isFinite(value) || !Number.isSafeInteger(normalized) || normalized <= 0) {
			throw new DelegationRefused("ENVELOPE_INVALID", `${toolName} refused: envelope.${name} must normalize to a positive finite integer, got ${value}`);
		}
		return normalized;
	};
	const maxTokens = check("maxTokens", raw.maxTokens);
	const maxWallMs = check("maxWallMs", raw.maxWallMs);
	const maxReadOnlyTools = check("maxReadOnlyTools", raw.maxReadOnlyTools);
	let preparationTokensShare: number | undefined;
	if (raw.preparationTokensShare !== undefined) {
		if (!Number.isFinite(raw.preparationTokensShare) || raw.preparationTokensShare <= 0 || raw.preparationTokensShare > 1) {
			throw new DelegationRefused("ENVELOPE_INVALID", `${toolName} refused: envelope.preparationTokensShare must be greater than 0 and at most 1, got ${raw.preparationTokensShare}`);
		}
		if (maxTokens === undefined) {
			throw new DelegationRefused("ENVELOPE_INVALID", `${toolName} refused: envelope.preparationTokensShare requires envelope.maxTokens`);
		}
		preparationTokensShare = raw.preparationTokensShare;
	}
	if (maxTokens === undefined && maxWallMs === undefined && maxReadOnlyTools === undefined && preparationTokensShare === undefined) {
		throw new DelegationRefused("ENVELOPE_INVALID", `${toolName} refused: envelope requires at least one configured bound`);
	}
	return {
		...(maxTokens !== undefined ? { maxTokens } : {}),
		...(maxWallMs !== undefined ? { maxWallMs } : {}),
		...(maxReadOnlyTools !== undefined ? { maxReadOnlyTools } : {}),
		...(preparationTokensShare !== undefined ? { preparationTokensShare } : {}),
		source: "delegation-param",
	};
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
	acceptanceMode: Type.Optional(
		Type.Union([Type.Literal("worktree"), Type.Literal("observation")], {
			description: "Ticket 03 — acceptance contract, creation-time only. Default \"worktree\". \"observation\" (role=explorer only) accepts a read-only informational report without Git worktree evidence; use it for information-gathering tasks, especially in non-Git directories. Never claim code-change verification under it.",
		}),
	),
	envelope: Type.Optional(
		Type.Object({
			maxTokens: Type.Optional(Type.Number({ description: "Cancel the child when cumulative UPDATE tokens exceed this. Snapshot input+output, no cache." })),
			maxWallMs: Type.Optional(Type.Number({ description: "Cancel the child when wall-clock since launch exceeds this many ms." })),
			maxReadOnlyTools: Type.Optional(Type.Number({ description: "Worker-only: cancel after this many consecutive observed read-only tool calls before the first write-capable tool." })),
			preparationTokensShare: Type.Optional(Type.Number({ description: "Worker-only: cancel when pre-write tokens exceed this share of maxTokens. Requires maxTokens." })),
		}, {
			description: "Runaway envelope. When omitted on an ordinary execution, finite program/operator defaults apply (maxTokens 100000, maxWallMs 600000 unless operator-configured). An explicit envelope replaces default/token inheritance. The effective wall bound is capped at the original Request remainder minus a provisional 60000ms reserve; token-only envelopes receive that Request-derived wall cap.",
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
		description: "Delegation role. worker implements; explorer does read-only recon (restricted-reader agent, no shell/edit/write); validator runs an oracle verdict. Reviews of an existing Task go through planner_redelegate with role=reviewer.",
	}),
	...DELEGATION_SPEC_PARAMETERS,
});

/**
 * planner_redelegate — bind-only surface over an existing Task. The stored
 * TaskSpec is authoritative; this surface only selects an invocation role and
 * may add temporary instructions, an explicit envelope, or recovery.
 */
export const PLANNER_REDELEGATE_PARAMETERS = Type.Object({
	taskId: Type.String({
		pattern: TASK_ID_PATTERN,
		description: "Canonical id of an existing Task, verbatim from a prior planner_delegate result's details.taskId. Never construct one.",
	}),
	role: Type.Union([Type.Literal("worker"), Type.Literal("explorer"), Type.Literal("validator"), Type.Literal("reviewer")], {
		description: "Invocation role. worker implements a correction round; explorer does read-only recon (restricted-reader agent, no shell/edit/write); validator runs an oracle verdict; reviewer reviews the bound Task's latest WorkerReport. This never changes the stored TaskSpec role.",
	}),
	instructions: Type.Optional(Type.String({ description: "Temporary prose appended to this child packet only; it never changes the stored TaskSpec." })),
	envelope: DELEGATION_SPEC_PARAMETERS.envelope,
	recovery: DELEGATION_RECOVERY_PARAMETER,
});

export type PlannerDelegateParams = Static<typeof PLANNER_DELEGATE_PARAMETERS>;
export type PlannerRedelegateParams = Static<typeof PLANNER_REDELEGATE_PARAMETERS>;
/**
 * The shape `runDelegation` consumes: both tool surfaces converge here. The
 * adapter strips any taskId/recovery a non-validating host passed through
 * planner_delegate, so reaching this type with a taskId means a rebind call.
 * `acceptanceMode` is declared here (not on the rebind schema) so the runtime
 * can still refuse a pass-through from a non-validating host.
 */
export type PlannerDelegationParams = Partial<Omit<PlannerDelegateParams, "role">> & Omit<PlannerRedelegateParams, "taskId"> & {
	taskId?: string;
	acceptanceMode?: AcceptanceMode;
	/** Legacy passthrough fields accepted only for runtime stripping on rebind. */
	objective?: string;
	cwd?: string;
	scope?: { allowedPaths?: string[]; forbiddenPaths?: string[] };
	constraints?: string[];
	acceptanceCriteria?: string[];
	validation?: { required: boolean; commands?: string[] };
};

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
	/** Synchronous final-admission hook, called immediately before REQUEST emit. */
	beforeDispatch?: (request: SubagentDelegationRequest) => void;
	/** Durable observation at the outbound REQUEST boundary, before listeners run. */
	onRequest?: (request: SubagentDelegationRequest) => void;
	/** Best-effort notification that REQUEST emit returned. Must not throw. */
	onDispatch?: (request: SubagentDelegationRequest) => void;
	/** Local receipt of an identity-matched launcher STARTED event. */
	onStarted?: (started: SubagentDelegationStarted) => void;
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
	/**
	 * Ticket 02 — the name of the host-registered restricted reader agent
	 * (RESTRICTED_READER_AGENT when index.ts's registration succeeded). When
	 * absent, role=explorer is refused before launch: there is no trusted
	 * read-only binding to prove the execution cannot mutate.
	 */
	restrictedReaderAgent?: string;
	/** Registered tools:[] agent used exclusively for a pending report correction. */
	reportOnlyAgent?: string;
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
	/** One validated default snapshot for this invocation. */
	executionDefaults?: ExecutionEnvelope;
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
	/** Ticket 01 — per-operation Git probe failures observed in the stop samples. */
	probeFailures?: GitProbeFailure[];
	/** Ticket 05 — a structured report value arrived on this terminal. */
	reportReceived?: boolean;
	/** Ticket 05 — a received report was admitted to the Task's report sequence. */
	reportAccepted?: boolean;
	/** A real writer reservation exists (concurrency-held); absent for readers and reviewers. */
	writerHold?: boolean;
	/** Residual worktree sample after confirmed quiescence. */
	cTerminal?: EvidenceRef;
	/** Whether the terminal's usage was accounted; false means only the observed lower bound stands. */
	usageComplete: boolean;
	/** P0-B — which envelope bound tripped (signal/observed/limit) plus its config source. */
	anomaly?: RunawayObservation & { source: string };
	error?: string;
	/** Program-owned launcher exception code, never extracted from error prose. */
	errorCode?: string;
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
	/** Program-selected causal predecessor; never a tool parameter. */
	previousExecutionId?: string;
	/** An old execution's late terminal passed the existing quiescence check. */
	onLateStopConfirmed?: () => void;
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
	/** Request identity that admitted this execution. */
	requestId?: string;
	/** Reads closure only from that original Request, including durable history. */
	requestClosure?: () => { requestId: string; requestClosed: string; requestClosedAt: string } | undefined;
	/** Fresh admission observation of that original Request, supplied only by the public host. */
	requestObservation?: () => RequestTimingObservation;
}

export class DelegationRefused extends Error {
	readonly code: string;
	readonly taskId?: string;
	readonly details?: Record<string, unknown>;

	constructor(code: string, message: string, taskId?: string, details?: Record<string, unknown>) {
		super(message);
		this.name = "DelegationRefused";
		this.code = code;
		this.taskId = taskId;
		this.details = details;
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
	if (params.objective === undefined || params.scope === undefined || params.constraints === undefined
		|| params.acceptanceCriteria === undefined || params.validation === undefined) {
		throw new DelegationRefused("TASKSPEC_REQUIRED", "planner_delegate refused: a new Task requires objective, scope, constraints, acceptanceCriteria, and validation");
	}
	return createTaskSpec({
		taskId,
		objective: params.objective,
		cwd,
		role: params.role,
		...(params.acceptanceMode !== undefined ? { acceptanceMode: params.acceptanceMode } : {}),
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

function stampWorkerReport(
	rawReport: WorkerReport | undefined,
	stampedRunId: string,
	warnings: string[],
): WorkerReport | undefined {
	if (!rawReport) return undefined;
	const { workerRunId: childSupplied, ...childEvidence } = (rawReport.evidence ?? {}) as unknown as Record<string, unknown>;
	if (childSupplied !== undefined) {
		warnings.push(
			`evidence.workerRunId is stamped by Root from the launcher terminal; the child-supplied value ${JSON.stringify(childSupplied)} was ignored`,
		);
	}
	return {
		...rawReport,
		evidence: {
			...childEvidence,
			workerRunId: stampedRunId,
		} as EvidenceRef,
	};
}

export async function runDelegation(
	deps: DelegationDeps,
	params: PlannerDelegationParams,
	cwd: string,
	options: DelegationOptions = {},
): Promise<DelegationOutcome> {
	const role = params.role;
	const effectiveCwd = params.taskId ? cwd : (params.cwd ?? cwd);
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

	// Ticket 02 — classify the execution's mutation capability from the
	//    binding that will actually run it, before any Task is minted. An
	//    explorer without a proven restricted binding is refused outright:
	//    launching it would create an unknown-capability execution that must
	//    be writer-isolated but holds no reservation.
	const classification = classifyExecutionCapability(role, deps.restrictedReaderAgent);
	if (role === "explorer" && classification.capability !== "restricted-reader") {
		throw new DelegationRefused(
			"READER_CAPABILITY_UNPROVEN",
			`${toolName} refused: role=explorer requires a trusted restricted-reader binding whose declared tools exclude shell/edit/write; ${classification.basis}. The host must register the plugin-owned restricted reader agent (pi-subagents runtime agent support) before explorer delegations can run.`,
		);
	}
	const isRestrictedReader = classification.capability === "restricted-reader";

	// 1. Task binding: an explicit id binds the existing record verbatim. Its
	//    stored spec is both immutable and authoritative for every child packet;
	//    only this invocation's instructions are appended separately.
	let task!: TaskRecord;
	let thisSpec: TaskSpec;
	let recoveryDecision: RecoveryDecision | undefined;
	let reportOnlyGrant = false;
	let reportOnlyOrigin: TaskExecutionRecord | undefined;
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
		const reportCorrectionPending = task.reportCorrections > task.executions.filter((item) => item.reportOnly).length;
		const ignoredDefinitionFields = ["objective", "cwd", "scope", "constraints", "acceptanceCriteria", "validation"]
			.filter((field) => (params as unknown as Record<string, unknown>)[field] !== undefined);
		if (ignoredDefinitionFields.length > 0) {
			warnings.push(`planner_redelegate ignored legacy TaskSpec field(s): ${ignoredDefinitionFields.join(", ")}; Task ${record.taskId} runs from its stored immutable spec`);
		}
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
		if (reportCorrectionPending && (role === "validator" || role === "reviewer")) {
			throw new DelegationRefused(
				"REPORT_CORRECTION_ROLE_REQUIRED",
				`${toolName} refused: Task ${task.taskId} has one pending report-only correction; role=${role} cannot bypass or consume it — use worker, or explorer for an observation Task`,
				task.taskId,
			);
		}
		// Ticket 03 — the acceptance contract is creation-time only: any
		//    attempt to supply it on a bound Task is refused before launch,
		//    and an observation Task admits explorer executions only — a
		//    reviewer, validator, or worker can never borrow the observation
		//    evidence exemption.
		if (params.acceptanceMode !== undefined) {
			throw new DelegationRefused(
				"ACCEPTANCE_MODE_IMMUTABLE",
				`${toolName} refused: acceptanceMode is fixed at Task creation (Task ${record.taskId} is "${acceptanceModeOf(record)}"); create a new Task with planner_delegate to choose a different mode`,
				record.taskId,
			);
		}
		if (acceptanceModeOf(record) === "observation" && role !== "explorer") {
			throw new DelegationRefused(
				"OBSERVATION_EXPLORER_ONLY",
				`${toolName} refused: Task ${record.taskId} is acceptanceMode=observation — only role=explorer executions and planner_verdict are admissible`,
				record.taskId,
			);
		}
		// The reviewer fork: binding is identical, but the call mints no spec
		// of its own — the stored spec is the reviewer's read-only context.
		if (role === "reviewer") {
			if (params.envelope !== undefined) {
				warnings.push("planner_redelegate ignored envelope for role=reviewer; reviewer invocations remain bounded by the enclosing Request");
			}
			const reviewed = await runReviewInvocation(deps, task, { requestId, executionId }, options);
			return { ...reviewed, warnings: [...warnings, ...reviewed.warnings] };
		}
		if (
			task.pendingRevalidationKey
			&& task.revalidationDispatches?.some((item) => item.executionId === executionId)
		) {
			throw new DelegationRefused(
				"REVALIDATION_DISPATCH_REPLAY",
				`${toolName} refused: revalidation execution ${executionId} was already dispatched for Task ${task.taskId}`,
				task.taskId,
			);
		}
		if (!record.spec) {
			throw new DelegationRefused("TASKSPEC_MISSING", `${toolName} refused: Task ${record.taskId} has no stored TaskSpec`, record.taskId);
		}
		thisSpec = record.spec;
		// A report-correction grant is durable Task state. The next Worker
		// execution consumes it by stamping its immutable execution record; no
		// caller-supplied re-delegation field can enable or disable this mode.
		reportOnlyGrant = reportCorrectionPending && (role === "worker" || role === "explorer");
		if (reportOnlyGrant) {
			reportOnlyOrigin = [...task.executions].reverse().find(
				(item) => !item.auxiliary && !item.reportOnly && item.status !== "running" && item.status !== "cancel_requested",
			);
			if (!reportOnlyOrigin?.cReport) {
				throw new DelegationRefused(
					"REPORT_CORRECTION_ORIGIN_MISSING",
					`${toolName} refused: Task ${task.taskId} has a pending report correction but no completed prior execution with A_run/C_report evidence`,
					task.taskId,
				);
			}
			if (deps.reportOnlyAgent !== REPORT_ONLY_AGENT) {
				throw new DelegationRefused(
					"REPORT_ONLY_CAPABILITY_UNPROVEN",
					`${toolName} refused: report-only correction requires the registered ${REPORT_ONLY_AGENT} tools:[] capability; no child was launched`,
					task.taskId,
				);
			}
		}

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
	} else {
		// nextTaskId() already claims the id (process-local sequence or the
		// persistent allocator); createAllocated pairs that claim with the
		// record so a store.create round-trip can never re-reserve it.
		// Minting validates the spec before any reservation or store write.
		const taskId = deps.store.nextTaskId();
		thisSpec = specFromParams(params, taskId, effectiveCwd);
	}

	// Reviewers returned above and remain Request-bounded. Every ordinary
	// execution gets a finite envelope; explicit dimensions stay exact.
	const originalEnvelope = validateEnvelope(params.envelope, toolName)
		?? deps.executionDefaults
		?? loadExecutionDefaults();
	let envelope: ExecutionEnvelope = { ...originalEnvelope };
	let envelopeClamped = false;
	let requestBudget: RequestExecutionBudget | undefined;
	if (recoveryDecision?.action === "retry_same_plan" && envelope.maxTokens !== undefined) {
		const prior = task.executions.find((item) => item.executionId === recoveryDecision.executionId);
		const terminalUsage = prior?.rawTerminal?.usage;
		const terminalObservedTokens = terminalUsage && typeof terminalUsage === "object" && !Array.isArray(terminalUsage)
			&& typeof (terminalUsage as { input?: unknown }).input === "number"
			&& typeof (terminalUsage as { output?: unknown }).output === "number"
			? (terminalUsage as { input: number; output: number }).input + (terminalUsage as { input: number; output: number }).output
			: undefined;
		const tokenObservations = [prior?.observedTokenHighWater, prior?.usageSnapshot?.totalTokens, terminalObservedTokens,
			prior?.runawayObservation?.signal === "tokens" ? prior.runawayObservation.observed : undefined,
			...(prior?.updateTrace ?? []).map((update) => update.tokens),
		].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
		const observedTokens = tokenObservations.length ? Math.max(...tokenObservations) : undefined;
		if (prior && observedTokens !== undefined && envelope.maxTokens < observedTokens) {
			throw new DelegationRefused(
				"RECOVERY_ENVELOPE_BELOW_OBSERVED",
				`${toolName} refused: retry_same_plan maxTokens ${envelope.maxTokens} is below execution ${prior.executionId}'s observed token usage ${observedTokens}; change the plan or create a new Task instead of only lowering the budget`,
				task.taskId,
			);
		}
	}

	// 2. Write lock: capability decides, not the role name — a proven
	//    restricted reader holds no workspace claim; writers, shell-capable
	//    validators, and anything unclassified claim it. A persisted
	//    writerHold outlives both the session and the reservation map: a
	//    stop-unconfirmed workspace admits no second writer (A4).
	let reservation: ConcurrencyReservation | undefined;
	let deferredManualHold: NonNullable<TaskRecord["writerHold"]> | undefined;
	if (!isRestrictedReader) {
		if (params.taskId) {
			if (task.writerHold && recoveryDecision?.worktreeDecision === "manual") {
				deferredManualHold = { ...task.writerHold };
			}
			if (task.writerHold && !deferredManualHold) {
				throw new DelegationRefused(
					"WRITER_HOLD",
					`${toolName} refused: Task ${task.taskId} writer execution ${task.writerHold.executionId} was never confirmed stopped (${task.writerHold.reason}); submit a matching recovery with worktreeDecision=manual only after operator resolution`,
					task.taskId,
				);
			}
			if (!deferredManualHold) {
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
					throw new DelegationRefused(
						admission.refusal.code,
						`${toolName} refused: ${admission.refusal.reason}; Task ${task.taskId} unchanged, no execution was launched`,
						task.taskId,
					);
				}
				reservation = admission.reservation;
			}
		} else {
			// Minting a new Task: reserve concurrency atomically before creating the Task in store.
			const admission = deps.concurrency.reserve({
				id: executionId,
				taskId: thisSpec.taskId,
				state: "planning",
				structured: true,
				role,
				capability: "writer",
				workspaces: [effectiveCwd, ...(thisSpec.additionalWorktreeRoots ?? [])],
			});
			if (admission.refusal) {
				throw new DelegationRefused(
					admission.refusal.code,
					`${toolName} refused: ${admission.refusal.reason}; no Task was created, no execution was launched`,
				);
			}
			reservation = admission.reservation;
			try {
				task = deps.store.createAllocated(thisSpec.taskId, thisSpec);
			} catch (error) {
				if (reservation) {
					deps.concurrency.release(reservation.id);
				}
				throw error;
			}
		}
	} else if (!params.taskId) {
		task = deps.store.createAllocated(thisSpec.taskId, thisSpec);
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
	let requestClosureAtCancel: ReturnType<NonNullable<DelegationOptions["requestClosure"]>>;
	// P0-B — the launcher listens on an internal controller so the runaway
	//    monitor fires the same CANCEL path as the operator's signal; exactly
	//    one control action per execution (spec §3).
	const runController = new AbortController();
	let runaway: RunawayObservation | undefined;
	let maxTokensSeen = -1;
	const updateTrace: NonNullable<TaskExecutionRecord["updateTrace"]> = [];
	let updateOrdinal = 0;
	let priorToolCount = 0;
	let consecutiveReadOnlyTools = 0;
	let preparationComplete = false;
	let classifiedToolCalls = 0;
	let observedToolCalls = 0;
	let readOnlyToolCalls = 0;
	let coalescedToolCalls = 0;
	let firstNonReadOnlyToolOrdinal: number | undefined;
	let priorTokens = 0;
	let maxTokenDelta = 0;
	const traceSummary = (): NonNullable<TaskExecutionRecord["traceSummary"]> => ({
		...(firstNonReadOnlyToolOrdinal !== undefined ? { firstNonReadOnlyToolOrdinal } : {}),
		maxTokenDelta,
		readOnlyToolFraction: classifiedToolCalls > 0 ? readOnlyToolCalls / classifiedToolCalls : 0,
		classifiedToolCalls,
		observedToolCalls,
		totalToolCalls: priorToolCount,
		coalescedToolCalls,
	});
	const persistUsageSnapshot = () => {
		if (maxTokensSeen < 0) return;
		deps.store.finalizeExecution(task.taskId, executionId, {
			usageSnapshot: { input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: maxTokensSeen, snapshot: true },
			usageComplete: false,
		});
		deps.usage.recordChildSnapshot(task.taskId, {
			kind: role as DelegationKind,
			toolCallId: executionId,
			totalTokens: maxTokensSeen,
		});
	};
	const runawayEndedReason = (): ExecutionEndedReason => runaway?.signal === "preparation" ? "preparation_runaway" : "worker_runaway";
	// Ticket 01 (wrc-incident-followups) — elapsed is read from a monotonic
	//    clock, not Date.now: a wall-clock rollback can no longer shrink or
	//    negate it.
	const wallNow = deps.wallClock?.now ?? (() => performance.now());
	const armWallTimer = deps.wallClock?.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
	const disarmWallTimer = deps.wallClock?.clearTimeout ?? ((handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
	let launchStartedAt = 0;
	let executionLaunchedAt: number | undefined;
	const finalTiming = () => executionLaunchedAt === undefined
		? { endedAt: nowIso() }
		: {
			endedAt: nowIso(),
			durationMs: Math.max(0, Math.floor(wallNow() - executionLaunchedAt)),
			durationBasis: "request-outbound-to-finalization" as const,
		};
	const requestClosurePatch = (endedReason: ExecutionEndedReason) => endedReason === "operator_cancel"
		&& requestClosureAtCancel
		&& requestClosureAtCancel.requestId === options.requestId
		? {
			requestClosed: requestClosureAtCancel.requestClosed,
			requestClosedAt: requestClosureAtCancel.requestClosedAt,
		}
		: {};
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
		requestClosureAtCancel = options.requestClosure?.();
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
		if (options.requestObservation) {
			let observation: RequestTimingObservation | undefined;
			try {
				observation = options.requestObservation();
			} catch { /* an unavailable authoritative observation is a durable refusal below */ }
			const requestMismatch = observation !== undefined && options.requestId !== undefined && observation.requestId !== options.requestId;
			const remainingMs = !observation || requestMismatch ? null : observation.remainingMs;
			const availableMs = remainingMs === null
				? null
				: Math.floor(remainingMs - REQUEST_EXECUTION_RESERVE_MS);
			requestBudget = {
				requestId: observation?.requestId ?? options.requestId ?? "unknown",
				requestDeadline: observation?.requestDeadline ?? null,
				remainingMs,
				observedAt: observation?.observedAt ?? nowIso(),
				reserveMs: REQUEST_EXECUTION_RESERVE_MS,
				availableMs,
				...(!observation
					? { unavailableReason: "observation-failed" as const }
					: requestMismatch
					? { unavailableReason: "request-mismatch" as const }
					: observation.unavailableReason ? { unavailableReason: observation.unavailableReason } : {}),
			};
			if (availableMs === null || availableMs <= 0) {
				const reason = availableMs === null
					? `the original Request remainder is unavailable (${requestBudget.unavailableReason ?? "unknown"})`
					: `the original Request has ${remainingMs}ms remaining, which does not exceed the provisional ${REQUEST_EXECUTION_RESERVE_MS}ms reserve`;
				const refusal: TaskLaunchRefusal = {
					executionId,
					kind: role as DelegationKind,
					code: "REQUEST_REMAINING_INSUFFICIENT",
					reason,
					originalEnvelope: { ...originalEnvelope },
					requestBudget,
					...(reportOnlyGrant ? { reportOnly: true } : {}),
				};
				releaseReservation = true;
				deps.store.recordLaunchRefusal(task.taskId, refusal);
				throw new DelegationRefused(
					"REQUEST_REMAINING_INSUFFICIENT",
					`${toolName} refused: Task ${task.taskId} cannot launch because ${reason}. No child allowance, execution grant, correction, recovery, revalidation, or writer hold was consumed.`,
					task.taskId,
					{ launchRefusal: refusal },
				);
			}
			if (originalEnvelope.maxWallMs === undefined || originalEnvelope.maxWallMs > availableMs) {
				envelope = { ...originalEnvelope, maxWallMs: availableMs };
				envelopeClamped = true;
				const originalWall = originalEnvelope.maxWallMs === undefined ? "unbounded" : `${originalEnvelope.maxWallMs}ms`;
				warnings.push(`execution wall envelope clamped to ${availableMs}ms from ${originalWall} using Request ${requestBudget.requestId} remainder ${remainingMs}ms minus provisional reserve ${REQUEST_EXECUTION_RESERVE_MS}ms`);
			}
		}
		if (reportOnlyGrant) {
			// Evidence capture yields. Re-read the durable record immediately
			// before the synchronous beginExecution so concurrent observation
			// calls cannot both consume the Task's single correction grant.
			const freshTask = deps.store.require(task.taskId);
			const correctionStillPending = freshTask.reportCorrections
				> freshTask.executions.filter((item) => item.reportOnly).length;
			if (!correctionStillPending) {
				throw new DelegationRefused(
					"REPORT_CORRECTION_ALREADY_CONSUMED",
					`${toolName} refused: Task ${task.taskId}'s report-only correction was already consumed; no child was launched`,
					task.taskId,
				);
			}
			const freshOrigin = [...freshTask.executions].reverse().find(
				(item) => !item.auxiliary && !item.reportOnly && item.status !== "running" && item.status !== "cancel_requested",
			);
			if (!freshOrigin?.cReport) {
				throw new DelegationRefused(
					"REPORT_CORRECTION_ORIGIN_MISSING",
					`${toolName} refused: Task ${task.taskId} no longer has a completed correction origin; no child was launched`,
					task.taskId,
				);
			}
			task = freshTask;
			reportOnlyOrigin = freshOrigin;
		}
		if (deferredManualHold) {
			// Evidence capture yields, so the manual decision and hold must still
			// be current before this call replaces their reservation. From this
			// read through recovery consumption below, all operations are
			// synchronous; a competing recovery cannot validate the same grant.
			const freshTask = deps.store.require(task.taskId);
			const freshHold = freshTask.writerHold;
			const holdUnchanged = freshHold !== undefined
				&& freshHold.executionId === deferredManualHold.executionId
				&& freshHold.reason === deferredManualHold.reason
				&& freshHold.since === deferredManualHold.since;
			const recoveryRefusal = validateRecoveryDecision(freshTask, recoveryDecision, DELEGATE_RECOVERY_ACTIONS);
			if (!holdUnchanged || recoveryRefusal) {
				throw new DelegationRefused(
					"RECOVERY_REQUIRED",
					`${toolName} refused: Task ${task.taskId}'s manual recovery authorization changed while pre-launch evidence was captured${recoveryRefusal ? ` (${recoveryRefusal})` : ""}; no child was launched`,
					task.taskId,
				);
			}
			task = freshTask;
			const currentManualReservations = deps.concurrency.status().reservations
				.filter((item) => item.id === freshHold.executionId || item.id === `writerhold:${freshHold.executionId}`)
				.map((item) => ({ ...item, workspaces: [...item.workspaces] }));
			const restoreManualReservations = () => {
				for (const held of currentManualReservations) deps.concurrency.hold(held);
			};
			for (const held of currentManualReservations) deps.concurrency.release(held.id);
			// Older in-memory sessions may carry only one of these ids and no
			// status snapshot. Releasing absent ids is harmless.
			deps.concurrency.release(freshHold.executionId);
			deps.concurrency.release(`writerhold:${freshHold.executionId}`);
			try {
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
					throw new DelegationRefused(
						admission.refusal.code,
						`${toolName} refused: ${admission.refusal.reason}; the existing writer hold remains intact and no execution was launched`,
						task.taskId,
					);
				}
				reservation = admission.reservation;
				task = deps.store.clearWriterHold(task.taskId);
			} catch (error) {
				if (!reservation) restoreManualReservations();
				throw error;
			}
		}
		// A refused admission leaves the Task in its prior state. Only an admitted
		// ordinary execution transitions into executing.
		if (["planning", "changes_requested", "report-invalid", "blocked", "failed"].includes(task.state)) {
			task = deps.store.transition(task.taskId, "executing");
		}
		deps.store.beginExecution(task.taskId, {
			executionId,
			...((reportOnlyOrigin?.executionId ?? options.previousExecutionId)
				? { previousExecutionId: reportOnlyOrigin?.executionId ?? options.previousExecutionId }
				: {}),
			kind: role as DelegationKind,
			cwd: task.cwd || effectiveCwd,
			worktreeRoots,
			aRun,
			capability: classification.capability,
			capabilityBasis: classification.basis,
			...(options.requestId ? { requestId: options.requestId } : {}),
			startedAt: null,
			envelope,
			originalEnvelope: { ...originalEnvelope },
			...(requestBudget ? { requestBudget, envelopeClamped } : {}),
			...(reportOnlyGrant ? {
				reportOnly: true,
				toolBudget: { ...REPORT_ONLY_TOOL_BUDGET },
				reportOnlyAgent: REPORT_ONLY_AGENT,
				reportOnlyCapabilityBasis: `runtime registration accepted agent '${REPORT_ONLY_AGENT}' with declared tools []`,
			} : {}),
			...(role !== "worker" ? { readOnly: true } : {}),
			...(role === "validator" ? { auxiliary: true } : {}),
		});
		const reportOnly = deps.store.executionById(task.taskId, executionId)?.reportOnly === true;
		// Ticket 04 — a writer-capable execution cannot be verified once its
		//    required evidence base is already known unusable: refuse before
		//    launch instead of minting a "started but stop unconfirmed" record
		//    and a held reservation. The refusal is a structured environment
		//    block: the temporary reservation releases in `finally`, the
		//    RecoveryDecision (if any) stays unconsumed, and the execution is
		//    honestly recorded as never launched.
		if (!isRestrictedReader && !writerEvidenceAdmissible(aRun)) {
			deps.store.finalizeExecution(task.taskId, executionId, {
				status: "failed",
				endedReason: "launch_failure",
				endedAt: nowIso(),
				terminationConfirmed: true,
				confirmationBasis: "no-launch",
				usageComplete: false,
			});
			try { deps.store.transition(task.taskId, "blocked"); } catch { /* already final */ }
			deps.store.setStateReason(
				task.taskId,
				`writer evidence unavailable before launch: ${describeProbeFailures(aRun.probeFailures)}`,
			);
			deps.store.setRecoveryRequired(task.taskId, {
				reason: `environment cannot supply writer evidence: ${describeProbeFailures(aRun.probeFailures)}; submit recovery{action:"fix_environment"} only after the workspace is a readable Git worktree`,
				executionId,
			});
			releaseReservation = true;
			throw new DelegationRefused(
				"ENVIRONMENT_UNVERIFIABLE",
				[
					`${toolName} refused: Task ${task.taskId} requires writer-isolated evidence but the pre-launch sample cannot support it (${describeProbeFailures(aRun.probeFailures)}).`,
					"No child was launched and no writer hold was created.",
					"Fix the environment — a readable Git worktree at the Task cwd plus every declared additional root — then re-delegate with recovery{action:\"fix_environment\"}; for a read-only observation Task, create it with acceptanceMode=observation and role=explorer instead.",
				].join(" "),
				task.taskId,
			);
		}
		// P0-B — the recovery decision is consumed by the execution it
		//    authorized; the same abnormal execution cannot be recovered twice.
		if (recoveryDecision) {
			deps.store.consumeRecovery(task.taskId, recoveryDecision, executionId);
		}

		// 4. Structured delegation: the packet is rendered once, downward only.
		const requestInstructions = reportOnly && reportOnlyOrigin
			? buildReportOnlyRepairInstructions(task, reportOnlyOrigin, params.instructions ?? "")
			: params.instructions ?? "";
		const priorExecution = recoveryDecision
			? (() => {
				const prior = task.executions.find((item) => item.executionId === recoveryDecision.executionId);
				if (!prior) return undefined;
				const tail = prior.updateTrace ?? [];
				let recentIndex = tail.length - 1;
				while (recentIndex >= 0 && !tail[recentIndex].recentTools?.length) recentIndex -= 1;
				const recentTools = recentIndex >= 0 ? [...tail[recentIndex].recentTools!] : [];
				let recentCount = -1;
				for (const item of tail.slice(Math.max(0, recentIndex))) {
					if (item.toolCount === undefined || item.toolCount <= recentCount) continue;
					recentCount = item.toolCount;
					if (item.currentTool) recentTools.push({ tool: item.currentTool, args: item.currentToolArgs ?? "" });
				}
				return {
					executionId: prior.executionId,
					...(prior.endedReason ? { endedReason: prior.endedReason } : {}),
					...(prior.runawayObservation ? { runawayObservation: prior.runawayObservation } : {}),
					diffStat: {
						aRun: prior.aRun.diffStat ?? null,
						terminal: prior.cTerminal?.diffStat ?? prior.interimSample?.diffStat ?? null,
						terminalKind: prior.cTerminal ? "cTerminal" as const : prior.interimSample ? "interimSample" as const : "unavailable" as const,
					},
					recentTools: recentTools.slice(-8),
					recentOutputLines: [...tail].reverse().find((item) => item.recentOutputLines?.length)?.recentOutputLines?.slice(-20) ?? [],
					recoveryReason: recoveryDecision.reason,
				};
			})()
			: undefined;
		const request: SubagentDelegationRequest = {
			requestId,
			ownerRunId: deps.ownerRunId,
			nodeId: task.taskId,
			agent: reportOnly ? REPORT_ONLY_AGENT : classification.agent ?? ROLE_AGENTS[role] ?? "worker",
			task: buildTaskPacket(thisSpec, requestInstructions, { ...(priorExecution ? { priorExecution } : {}) }),
			context: "fresh",
			cwd: task.cwd || effectiveCwd,
			...(reportOnly ? { toolBudget: { ...REPORT_ONLY_TOOL_BUDGET } } : {}),
			result: { kind: "structured", schema: WORKER_REPORT_SCHEMA },
		};
		// A2 — spec §3 predicate: an identity-matched terminal plus a quiet
		//    worktree, sampled twice after quiescenceWaitMs. A sampling failure
		//    is evidence-incomplete, never clean; both samples are kept so a
		//    failed first sample is never overwritten by a later one (T01).
		const evaluateQuiescence = async (
			terminalRunId?: string,
		): Promise<
			| { confirmed: true; cTerminal: EvidenceRef; samples: EvidenceRef[] }
			| { confirmed: false; interim: EvidenceRef; samples: EvidenceRef[]; evidenceIncomplete?: boolean }
		> => {
			await sleep(quiescenceWaitMs);
			const first = await captureEvidence(deps.gitRunner, sampleOptions(terminalRunId ?? executionId));
			await sleep(quiescenceSampleGapMs);
			const second = await captureEvidence(deps.gitRunner, sampleOptions(terminalRunId ?? executionId));
			const samples = [first, second];
			if (
				first.statusProbeFailed || second.statusProbeFailed
				|| first.gitAvailable === false || second.gitAvailable === false
				|| (first.unavailableWorktreeRoots?.length ?? 0) > 0
				|| (second.unavailableWorktreeRoots?.length ?? 0) > 0
				|| first.snapshotGap !== undefined || second.snapshotGap !== undefined
			) {
				return { confirmed: false, interim: second, samples, evidenceIncomplete: true };
			}
			return worktreeSamplesQuiet(first, second)
				? { confirmed: true, cTerminal: second, samples }
				: { confirmed: false, interim: second, samples };
		};

		// Ticket 02 — a matched terminal plus the trusted restricted binding
		//    proves a reader stopped: it holds no workspace claim and could not
		//    mutate, so no worktree quiescence sample is required. Writers and
		//    unknown capabilities keep the full predicate.
		const confirmStop = async (terminalRunId?: string): Promise<
			| { confirmed: true; basis: string; cTerminal?: EvidenceRef; samples: EvidenceRef[] }
			| { confirmed: false; basis?: undefined; interim: EvidenceRef; samples: EvidenceRef[]; evidenceIncomplete?: boolean }
		> => {
			if (isRestrictedReader) {
				return { confirmed: true, basis: "terminal+restricted-reader", samples: [] };
			}
			const q = await evaluateQuiescence(terminalRunId);
			return q.confirmed
				? { confirmed: true, basis: "terminal+quiet-worktree", cTerminal: q.cTerminal, samples: q.samples }
				: { confirmed: false, interim: q.interim, samples: q.samples, ...(q.evidenceIncomplete ? { evidenceIncomplete: true } : {}) };
		};

		// Ticket 01 — the probe failures observed while deciding a stop.
		const stopProbeFailures = (samples: readonly EvidenceRef[]): GitProbeFailure[] | undefined => {
			const failures = samples.flatMap((sample) => sample.probeFailures ?? []);
			return failures.length > 0 ? failures : undefined;
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
				const q = await confirmStop(late.runId);
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
					? runawayEndedReason()
					: cancelRequestedAt
						? "operator_cancel"
						: reportOnly && late.status === "tool_budget_exhausted"
							? "report_only_tool_budget"
							: terminalEndedReason(late);
				deps.store.finalizeExecution(task.taskId, executionId, {
					status: q.confirmed ? "stopped" : "stop_unconfirmed",
					endedReason,
					...finalTiming(),
					...requestClosurePatch(endedReason),
					terminationConfirmed: q.confirmed,
					...(q.confirmed
						? { confirmationBasis: q.basis, ...(q.cTerminal ? { cTerminal: q.cTerminal } : {}) }
						: { interimSample: q.interim, stopSamples: q.samples }),
					...(q.confirmed === false && q.evidenceIncomplete ? { evidenceIncomplete: true } : {}),
					usageComplete,
					...(usageComplete ? { usageSnapshot: undefined } : {}),
					rawTerminal: structuredClone(late) as unknown as Record<string, unknown>,
					...(late.runId ? { runId: late.runId } : {}),
					...(lateSuccess && late.result?.kind === "structured"
						? { lateReport: stampWorkerReport(late.result.value as WorkerReport, late.runId ?? executionId, warnings) }
						: {}),
				});
				// Only this execution's own reservation/hold may clear — a
				// reader's confirmed stop never releases a writer's hold.
				if (q.confirmed && reservation) {
					deps.concurrency.release(reservation.id);
					if (deps.store.require(task.taskId).writerHold?.executionId === executionId) {
						deps.store.clearWriterHold(task.taskId);
					}
				}
				if (q.confirmed) options.onLateStopConfirmed?.();
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
						wallTimer = armWallTimer(onWallDeadline, Math.min(2_147_483_647, wallLimit, Math.ceil(wallLimit - elapsed)));
						return;
					}
					breach("wall", Math.floor(elapsed), wallLimit);
				};
				// Node overflows longer delays to 1ms. Bound each wake-up;
				// the elapsed-time check still owns the full configured limit.
				wallTimer = armWallTimer(onWallDeadline, Math.min(2_147_483_647, wallLimit));
			}
			response = await deps.launch(request, runController.signal, {
				beforeDispatch: (outbound) => {
					const committed = deps.store.commitRevalidationDispatch(
						task.taskId,
						executionId,
						outbound.requestId,
					);
					if (committed.status === "duplicate") {
						throw new DelegationRefused(
							"REVALIDATION_DISPATCH_REPLAY",
							`${toolName} refused: revalidation execution ${executionId} was already dispatched for Task ${task.taskId}`,
							task.taskId,
						);
					}
				},
				onDispatch: (outbound) => {
					deps.store.markRevalidationRequestObserved(task.taskId, executionId, outbound.requestId);
				},
				onRequest: () => {
					executionLaunchedAt = wallNow();
					try {
						deps.store.finalizeExecution(task.taskId, executionId, {
							launchedAt: nowIso(),
							startedAt: null,
						});
					} catch { /* timing observation cannot change launch admission */ }
				},
				onStarted: () => {
					const execution = deps.store.executionById(task.taskId, executionId);
					if (execution && execution.startedAt === null) {
						deps.store.finalizeExecution(task.taskId, executionId, { startedAt: nowIso() });
					}
				},
				onUpdate: (update) => {
					updateOrdinal += 1;
					const clip = (value: string | undefined, max: number) => value === undefined ? undefined : value.slice(0, max);
					const snapshot = {
						receivedAt: nowIso(),
						ordinal: updateOrdinal,
						...(typeof update.tokens === "number" && Number.isFinite(update.tokens) && update.tokens >= 0 ? { tokens: update.tokens } : {}),
						...(typeof update.toolCount === "number" && Number.isSafeInteger(update.toolCount) && update.toolCount >= 0 ? { toolCount: update.toolCount } : {}),
						...(typeof update.durationMs === "number" && Number.isFinite(update.durationMs) && update.durationMs >= 0 ? { durationMs: Math.floor(update.durationMs) } : {}),
						...(clip(update.currentTool, 120) ? { currentTool: clip(update.currentTool, 120) } : {}),
						...(clip(update.currentToolArgs, 1000) ? { currentToolArgs: clip(update.currentToolArgs, 1000) } : {}),
						...(update.recentTools?.length ? { recentTools: update.recentTools.slice(-8).map((item) => ({ tool: item.tool.slice(0, 120), args: item.args.slice(0, 1000) })) } : {}),
						...((update.recentOutputLines?.length || update.recentOutput) ? { recentOutputLines: (update.recentOutputLines ?? update.recentOutput?.split("\n") ?? []).slice(-20).map((line) => line.slice(0, 1000)) } : {}),
					};
					updateTrace.push(snapshot);
					if (updateTrace.length > 64) updateTrace.splice(0, updateTrace.length - 64);
					if (snapshot.tokens !== undefined) {
						maxTokenDelta = Math.max(maxTokenDelta, Math.max(0, snapshot.tokens - priorTokens));
						priorTokens = Math.max(priorTokens, snapshot.tokens);
						maxTokensSeen = Math.max(maxTokensSeen, snapshot.tokens);
					}
					if (snapshot.toolCount !== undefined && snapshot.toolCount > priorToolCount) {
						const delta = snapshot.toolCount - priorToolCount;
						observedToolCalls += 1;
						if (delta > 1) {
							coalescedToolCalls += delta - 1;
							consecutiveReadOnlyTools = 0;
						}
						if (snapshot.currentTool) {
							classifiedToolCalls += 1;
							if (READ_ONLY_TOOLS.has(snapshot.currentTool)) {
								readOnlyToolCalls += 1;
								consecutiveReadOnlyTools += 1;
							} else {
								preparationComplete = true;
								consecutiveReadOnlyTools = 0;
								firstNonReadOnlyToolOrdinal ??= snapshot.toolCount;
							}
						} else {
							consecutiveReadOnlyTools = 0;
						}
						priorToolCount = snapshot.toolCount;
					}
					try { deps.store.finalizeExecution(task.taskId, executionId, { updateTrace: structuredClone(updateTrace), traceSummary: traceSummary(), ...(maxTokensSeen >= 0 ? { observedTokenHighWater: maxTokensSeen } : {}) }); } catch { /* diagnostics must not break execution */ }
					// P0-B monitor — cumulative token snapshot, max not sum;
					// unknown/regressing counts never reset the observed level.
					const tokens = update.tokens;
					if (typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0) {
						maxTokensSeen = Math.max(maxTokensSeen, tokens);
						if (envelope?.maxTokens !== undefined) {
							if (maxTokensSeen > envelope.maxTokens) breach("tokens", maxTokensSeen, envelope.maxTokens);
						}
					}
					if (role === "worker" && !preparationComplete && !runaway) {
						if (envelope.maxReadOnlyTools !== undefined && consecutiveReadOnlyTools > envelope.maxReadOnlyTools) {
							breach("preparation", consecutiveReadOnlyTools, envelope.maxReadOnlyTools);
						} else if (envelope.preparationTokensShare !== undefined && envelope.maxTokens !== undefined && maxTokensSeen > envelope.maxTokens * envelope.preparationTokensShare) {
							breach("preparation", maxTokensSeen, Math.floor(envelope.maxTokens * envelope.preparationTokensShare));
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
				const abortedReason: ExecutionEndedReason = runaway ? runawayEndedReason() : "operator_cancel";
				if (runaway || cancelRequestedAt) persistUsageSnapshot();
				if (emitted) {
					// Grace expired with no terminal: the stop is unconfirmed. The
					// reservation becomes a persisted hold — released only when a
					// late terminal confirms quiescence (A3/A4).
					deps.store.finalizeExecution(task.taskId, executionId, {
						status: "stop_unconfirmed",
						endedReason: abortedReason,
						...requestClosurePatch(abortedReason),
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
						...finalTiming(),
						...requestClosurePatch(abortedReason),
						terminationConfirmed: true,
						confirmationBasis: "no-launch",
						usageComplete: false,
					});
					releaseReservation = true;
				}
				try { deps.store.transition(task.taskId, "blocked"); } catch { /* already final */ }
				// Ticket 02 — a reader holds nothing: the reason must not claim a
				//    writer hold that does not exist.
				deps.store.setStateReason(
					task.taskId,
					runaway
						? `worker runaway: ${runaway.signal} ${runaway.observed} exceeded envelope ${runaway.limit}; ${emitted ? (reservation ? "stop unconfirmed, writer hold kept" : "stop unconfirmed") : "cancelled before launch"}`
						: emitted
							? reservation
								? "delegation cancelled by operator; no terminal response within grace — stop unconfirmed, writer hold kept"
								: "delegation cancelled by operator; no terminal response within grace — stop unconfirmed"
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
						...(runaway ? { anomaly: { ...runaway, source: envelope.source } } : {}),
						quiescenceWaitMs,
						quiescenceWaitSource,
						usageComplete: false,
						...(emitted && reservation ? { writerHold: true } : {}),
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
				...finalTiming(),
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
					...(typeof (error as { code?: unknown })?.code === "string" ? { errorCode: (error as { code: string }).code } : {}),
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
			// Ticket 05 — a schema-valid structured result on a non-completed
			//    terminal is received-but-unaccepted diagnostic material: kept
			//    on the execution, never admitted to the report sequence.
			//    A completed result arriving after a cancel keeps the existing
			//    lateReport semantics instead.
			const terminalRunId = responseRunId ?? executionId;
			const terminalReport = stampWorkerReport(
				terminal.result?.kind === "structured" ? (terminal.result.value as WorkerReport) : undefined,
				terminalRunId,
				warnings,
			);
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
			if ((runaway || cancelRequestedAt) && !usageComplete) persistUsageSnapshot();
			deps.store.finalizeExecution(task.taskId, executionId, { status: "stopping" });
			const q = await confirmStop(responseRunId);
			const endedReason: ExecutionEndedReason = runaway
				? runawayEndedReason()
				: lateSuccess
					? "operator_cancel"
					: reportOnly && terminal.status === "tool_budget_exhausted"
						? "report_only_tool_budget"
						: terminalEndedReason(terminal);
			deps.store.finalizeExecution(task.taskId, executionId, {
				status: q.confirmed ? "stopped" : "stop_unconfirmed",
				endedReason,
				...finalTiming(),
				...requestClosurePatch(endedReason),
				terminationConfirmed: q.confirmed,
				...(q.confirmed
					? { confirmationBasis: q.basis, ...(q.cTerminal ? { cTerminal: q.cTerminal } : {}) }
					: { interimSample: q.interim, stopSamples: q.samples }),
				...(q.confirmed === false && q.evidenceIncomplete ? { evidenceIncomplete: true } : {}),
				usageComplete,
				rawTerminal: structuredClone(terminal) as unknown as Record<string, unknown>,
				...(responseRunId ? { runId: responseRunId } : {}),
				...(lateSuccess && terminalReport
					? { lateReport: terminalReport }
					: terminalReport
						? { unacceptedReport: terminalReport, unacceptedReportReason: `delegation ended ${terminal.status}; report not admitted` }
						: {}),
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
					...(runaway ? { anomaly: { ...runaway, source: envelope.source } } : {}),
					...(q.confirmed ? { confirmationBasis: q.basis, ...(q.cTerminal ? { cTerminal: q.cTerminal } : {}) } : {}),
					quiescenceWaitMs,
					quiescenceWaitSource,
					...(q.confirmed === false && q.evidenceIncomplete ? { evidenceIncomplete: true } : {}),
					...(q.confirmed === false ? { probeFailures: stopProbeFailures(q.samples) } : {}),
					...(terminalReport ? { reportReceived: true, reportAccepted: false } : {}),
					...(reservation && !q.confirmed ? { writerHold: true } : {}),
					usageComplete,
					...(usageComplete ? { usageSnapshot: undefined } : {}),
					...(terminal.error ? { error: terminal.error } : {}),
				},
				warnings,
			};
		}

		const runId = response.runId;
		const stampedRunId = runId ?? executionId;
		const report = stampWorkerReport(
			response.result?.kind === "structured" ? (response.result.value as WorkerReport) : undefined,
			stampedRunId,
			warnings,
		);

		// 6. C_report + execution-window truth. `compareExecutionTruth` feeds the
		//    execution record; `compareEvidence` produces the EvidenceComparison
		//    the store and review loop consume.
		const cReport = await captureEvidence(deps.gitRunner, sampleOptions(stampedRunId));
		const completionQuiescence = await confirmStop(runId);
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
				...finalTiming(),
				terminationConfirmed: false,
				cReport,
				interimSample: completionQuiescence.interim,
				stopSamples: completionQuiescence.samples,
				...(completionQuiescence.evidenceIncomplete ? { evidenceIncomplete: true } : {}),
				usageComplete,
				rawTerminal: structuredClone(response) as unknown as Record<string, unknown>,
				...(runId ? { runId } : {}),
				// Ticket 05 — the terminal carried a valid report but the stop was
				//    never confirmed: keep it bound to this execution, out of the
				//    report sequence.
				...(report
					? { unacceptedReport: report, unacceptedReportReason: "worktree quiescence was not confirmed; report not admitted" }
					: {}),
			});
			try { deps.store.transition(task.taskId, "blocked"); } catch { /* already final */ }
			deps.store.setStateReason(
				task.taskId,
				report
					? "completed terminal arrived but worktree quiescence was not confirmed; report received but not admitted"
					: "completed terminal arrived but worktree quiescence was not confirmed; report not admitted",
			);
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
					probeFailures: stopProbeFailures(completionQuiescence.samples),
					...(report ? { reportReceived: true, reportAccepted: false } : {}),
					...(reservation ? { writerHold: true } : {}),
					usageComplete,
				},
				warnings,
			};
		}
		const priorTruthPaths = task.executions
			.filter((item) => item.executionId !== executionId && item.executionId !== reportOnlyOrigin?.executionId && !item.auxiliary && !item.reportOnly && item.truthPaths?.length)
			.flatMap((item) => item.truthPaths ?? []);
		const observation = acceptanceModeOf(task) === "observation";
		const truthRun = reportOnlyOrigin?.aRun ?? aRun;
		const truthResult = reportOnlyOrigin?.cReport ?? cReport;
		const truth = compareExecutionTruth(truthRun, truthResult, report, {
			...(thisSpec.scope ? { scope: thisSpec.scope } : {}),
			...(thisSpec.additionalWorktreeRoots?.length
				? { additionalWorktreeRoots: thisSpec.additionalWorktreeRoots }
				: {}),
			...(reportOnly ? { reportOnly: true } : {}),
			...(reportOnly
				? { readOnly: reportOnlyOrigin?.readOnly === true }
				: role !== "worker" ? { readOnly: true } : {}),
			...(priorTruthPaths.length > 0 ? { priorTruthPaths } : {}),
		});
		// Ticket 03 — an observation Task never pretends Git freshness exists:
		//    no comparison is recorded and none is fed to the review loop. The
		//    report's identity/schema and any declared evidence requirements
		//    are still judged at acceptance.
		const comparison = report && !observation
			? compareEvidence(truthRun, truthResult, report, {
				...(thisSpec.scope ? { scope: thisSpec.scope } : {}),
				...(thisSpec.additionalWorktreeRoots?.length
					? { additionalWorktreeRoots: thisSpec.additionalWorktreeRoots }
					: {}),
				...(reportOnly ? { reportOnly: true } : {}),
				...(reportOnly
					? { readOnly: reportOnlyOrigin?.readOnly === true }
					: role !== "worker" ? { readOnly: true } : {}),
				...(priorTruthPaths.length > 0 ? { priorTruthPaths } : {}),
			})
			: undefined;
		if (comparison) {
			// Ticket 04 — a known-unusable evidence base is an environment
			//    failure now, not after a revalidation loop: block instead of
			//    granting a recovery that must fail.
			comparison.environmentFailure = environmentFailureOf(aRun, cReport) || undefined;
			deps.store.setLastComparison(task.taskId, comparison);
		}

		// 7. Report identity is checked against the delegation, never rewritten.
		// runId branch guards restored ledgers at the verdict boundary (orchestrate.ts reportIdentityRefusal);
		// admission path is guaranteed to pass via stamping.
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
		// An identity-mismatched report is received-but-unaccepted material:
		//    it stays bound to this execution for diagnostics but never enters
		//    the report sequence and never binds a reportIndex — an accepted
		//    revision must always name the Task and run that produced it.
		const admittedReport = report && identityErrors.length === 0 ? report : undefined;

		// 8. Ledger: report and child usage land on the Task as-is.
		let recorded = task;
		if (admittedReport) {
			recorded = role === "validator"
				? deps.store.recordValidatorReport(task.taskId, admittedReport)
				: deps.store.recordReport(task.taskId, admittedReport);
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

		const reportIndex = admittedReport
			? role === "validator"
				? recorded.validatorReports.length - 1
				: recorded.reports.length - 1
			: -1;
		deps.store.completeExecution(task.taskId, executionId, {
			status: "completed",
			endedReason: "normal",
			...finalTiming(),
			terminationConfirmed: true,
			confirmationBasis: completionQuiescence.basis,
			usageComplete: response.usage !== undefined,
			rawTerminal: structuredClone(response) as unknown as Record<string, unknown>,
			cReport,
			// A reader's confirmed stop keeps the result-receive sample as its
			//    residual record; writers get the second quiescence sample.
			cTerminal: completionQuiescence.cTerminal ?? cReport,
			...(runId ? { runId } : {}),
			truthPaths: reportOnly ? [] : truth.truthPaths,
			executionChangedPaths: truth.executionChangedPaths,
			committedPaths: truth.committedPaths,
			observedExternalPaths: truth.observedExternalPaths,
			undeclaredPaths: truth.undeclaredPaths,
			outOfScopePaths: truth.outOfScopePaths,
			extraDeclaredPaths: truth.extraDeclaredPaths,
			externalPaths: truth.externalPaths,
			...(admittedReport && reportIndex >= 0
				? role === "validator"
					? { validatorReportIndex: reportIndex }
					: { reportIndex }
				: {}),
			...(report && !admittedReport
				? {
					unacceptedReport: report,
					unacceptedReportReason: `report identity does not match this Task: ${reportError}`,
				}
				: {}),
		});
		deps.store.recordExecutionFindings(
			task.taskId,
			executionId,
			truth.findings
				.filter((finding) => finding.kind !== "attribution-gap"
					&& (!reportOnly || REPORT_DECLARATION_FINDINGS.has(finding.kind as TaskFinding["kind"])))
				.map((finding) => ({
					kind: finding.kind as Exclude<typeof finding.kind, "attribution-gap"> as TaskFinding["kind"],
					paths: finding.paths,
				})),
			deps.store.now().toISOString(),
			reportOnly
				? ["undeclared", "over-declared", "missing"]
				: ["undeclared", "scope", "over-declared", "missing"],
		);
		if (reportOnly && admittedReport && truth.verifiable) {
			const mismatchPaths: Record<"undeclared" | "over-declared" | "missing", Set<string>> = {
				undeclared: new Set(truth.undeclaredPaths),
				"over-declared": new Set(truth.extraDeclaredPaths),
				missing: new Set(truth.missingPaths),
			};
			for (const kind of ["undeclared", "over-declared", "missing"] as const) {
				const resolvedPaths = deps.store.openFindings(task.taskId)
					.filter((finding) => finding.executionId !== executionId && finding.kind === kind
						&& finding.paths.every((path) => !mismatchPaths[kind].has(path)))
					.flatMap((finding) => finding.paths);
				deps.store.markFindingEvidenceResolved(task.taskId, resolvedPaths, executionId, [kind]);
			}
		}
		if (!admittedReport && reportError) warnings.push(reportError);

		// 9. Review loop decides what this report means for the Task.
		const { task: reviewed, decision } = advanceReview({
			store: deps.store,
			taskId: task.taskId,
			...(admittedReport ? { report: admittedReport } : {}),
			...(reportError ? { reportError } : {}),
			...(comparison ? { comparison } : {}),
		});
		if (decision.action === "revalidate" && decision.evidenceKey) {
			deps.store.markRevalidationGranted(task.taskId, decision.evidenceKey);
		}

		// 10. Outcome.
		releaseReservation = true;
		return {
			task: deps.store.require(reviewed.taskId),
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
				reason: terminalEndedReason(response),
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
		.filter((item) => !item.auxiliary && item.reportIndex === fresh.reports.length - 1)
		.at(-1);
	// A corrected revision belongs to the report-only execution, while its
	// work and read-only classification remain bound to the immutable origin.
	const origin = latest?.reportOnly
		? fresh.executions.find((item) => item.executionId === latest.previousExecutionId && !item.auxiliary && !item.reportOnly)
		: latest;
	const priorTruthPaths = origin
		? fresh.executions
			.filter((item) => item.executionId !== origin.executionId && !item.auxiliary && !item.reportOnly && item.truthPaths?.length)
			.flatMap((item) => item.truthPaths ?? [])
		: [];
	let comparison = origin && (!latest?.reportOnly || (origin.cReport && latest.cReport))
		? compareEvidence(origin.aRun, current, report, {
			...(fresh.spec?.scope ? { scope: fresh.spec.scope } : {}),
			...(roots?.length ? { additionalWorktreeRoots: roots } : {}),
			...(latest?.reportOnly ? { reportOnly: true } : {}),
			...(origin.readOnly ? { readOnly: true } : {}),
			...(priorTruthPaths.length > 0 ? { priorTruthPaths } : {}),
		})
		: undefined;
	if (comparison && latest?.reportOnly && origin?.cReport && latest.cReport) {
		const evidenceOptions = {
			...(fresh.spec?.scope ? { scope: fresh.spec.scope } : {}),
			...(roots?.length ? { additionalWorktreeRoots: roots } : {}),
		};
		const truth = compareExecutionTruth(origin.aRun, origin.cReport, report, {
			...evidenceOptions,
			reportOnly: true,
			readOnly: origin.readOnly === true,
			priorTruthPaths,
		});
		const correctionWindowFresh = compareFreshness(origin.cReport, latest.aRun, evidenceOptions).fresh
			&& compareFreshness(latest.aRun, latest.cReport, evidenceOptions).fresh;
		const freshness = compareFreshness(correctionWindowFresh ? latest.cReport : origin.cReport, current, evidenceOptions);
		comparison = {
			...comparison,
			verifiable: comparison.verifiable && truth.verifiable && freshness.verifiable,
			fresh: comparison.fresh && truth.findings.length === 0 && !truth.declarationMismatch && freshness.fresh,
			unexplained: comparison.unexplained || !freshness.verifiable || !freshness.fresh
				|| truth.declarationMismatch || truth.extraDeclaredPaths.length > 0 || truth.missingPaths.length > 0,
			truthPaths: [...new Set([...priorTruthPaths, ...truth.truthPaths])].sort(),
			undeclaredPaths: truth.undeclaredPaths,
			extraDeclaredPaths: truth.extraDeclaredPaths,
			missingPaths: truth.missingPaths,
			truthFindings: truth.findings.map(({ kind, paths }) => ({ kind, paths })),
			freshness,
			reasons: [...comparison.reasons, ...truth.reasons, ...freshness.reasons],
		};
	}
	if (comparison) deps.store.setLastComparison(task.taskId, comparison);
	if (!comparison) {
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
		if (typeof t.error === "string" && t.error.length > 0) lines.push(`error: ${t.error}`);
		if (t.anomaly) {
			lines.push(`anomaly: ${t.anomaly.signal} observed=${t.anomaly.observed} limit=${t.anomaly.limit} (source: ${t.anomaly.source})`);
		}
		if (t.executionStatus === "stop_unconfirmed" && t.writerHold === true) {
			lines.push("writer hold: kept — the workspace stays reserved until a late terminal confirms quiescence or the operator resolves it");
		}
		if (t.evidenceIncomplete) lines.push("warning: stop-evidence sampling failed; residual workspace state is unknown");
		if (t.probeFailures?.length) {
			lines.push(`probe failures: ${describeProbeFailures(t.probeFailures)}`);
		}
		if (t.reportReceived === true && t.reportAccepted === false) {
			lines.push("report: received but not admitted — kept as diagnostic material on the execution record");
		}
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
	/** Optional synchronous admission wrapper used by request-global accounting. */
	beforeDispatch?: (request: SubagentDelegationRequest, local?: DelegationLaunchHooks["beforeDispatch"]) => void;
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
	const launcher: DelegationDeps["launch"] = (request, signal, hooks) => new Promise((resolve, reject) => {
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
			unsubscribeStarted();
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
		const unsubscribeStarted = pi.events.on(SUBAGENT_DELEGATION_STARTED_EVENT, (payload) => {
			if (settled) return;
			const started = payload as SubagentDelegationStarted;
			if (started.requestId !== request.requestId
				|| started.ownerRunId !== request.ownerRunId
				|| started.nodeId !== request.nodeId) return;
			try { hooks?.onStarted?.(started); } catch { /* observation failure cannot disrupt the child */ }
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
			try { pi.events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, cancelPayload); } catch { /* cancellation remains unconfirmed until terminal */ }
			if (settled) return;
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
		try {
			if (options.beforeDispatch) options.beforeDispatch(request, hooks?.beforeDispatch);
			else hooks?.beforeDispatch?.(request);
		} catch (error) {
			cleanup();
			reject(signal?.aborted ? new DelegationAborted(request.nodeId, false) : error);
			return;
		}
		inFlight.set(request.requestId, cancelPayload);
		try { hooks?.onRequest?.(request); } catch { /* observation cannot change launch admission */ }
		try {
			pi.events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
		} catch {
			// A listener may have started the child before a later listener threw.
			// Keep the committed charge and RESPONSE subscription; treat the send as
			// unknown/emitted so runDelegation retains the writer reservation.
			settled = true;
			try { pi.events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, cancelPayload); } catch { /* retain the hold */ }
			unsubscribeUpdate();
			signal?.removeEventListener("abort", onAbort);
			inFlight.delete(request.requestId);
			reject(new DelegationAborted(request.nodeId, true));
			return;
		}
		try { hooks?.onDispatch?.(request); } catch { /* observation cannot undo an emitted request */ }
		// An abort landing between the early check and addEventListener never
		// fires the listener — catch it here so the grace path still runs.
		if (signal?.aborted) onAbort();
	});
	return launcher;
}
