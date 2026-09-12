/**
 * In-process Orchestration. The Pi host is an adapter; this module owns
 * Delegation launch, the Review loop, and Task memory writes.
 */

import { existsSync } from "node:fs";
import { isAbsolute, resolve, join } from "node:path";
import {
	captureEvidence,
	captureReviewEvidencePacket,
	compareEvidence,
	compareExecutionTruth,
	compareFreshness,
	describeComparison,
	describeFreshness,
	normalizeEvidencePaths,
	untrackedPathsOf,
} from "./evidence.ts";
import type { EvidenceComparison, ExecutionTruthComparison, FreshnessComparison } from "./evidence.ts";
import {
	captureWorkspaceSnapshot,
	compareSnapshotBinding,
} from "./workspace-snapshot.ts";
import type { GitRunner } from "./git-audit.ts";
import {
	inferRoleFromAgent,
	MISSING_VALIDATION_DEFINITION_REASON,
	hasMissingRequiredValidationCommands,
	hasFullSuiteRequest,
	delegationPrompt,
	lastWorkerValidationPassed,
	missingTaskSpecValidationCommands,
	ORACLE_CONTRACT_MARKER,
	ORACLE_SUITE_CONFLICT_WARNING,
	oracleSuiteMode,
	bindReportOnlyFallback,
	prepareRoleDelegation,
	promptTaskIds,
	resolveDelegationTarget,
	stampCanonicalTaskId,
	stampReportOnlyCorrectionInput,
	stripDelegationKeys,
} from "./roles.ts";
import type { ContextReuseOutcome, DelegationTarget, PrepareRoleDelegationOptions } from "./roles.ts";
import {
	evaluateSessionRootBudget,
	formatFloorLimitsSummary,
	formatSessionRootBudgetRefusal,
	formatSessionRootBudgetSoftWarning,
	formatSessionRootBudgetStatus,
	loadHostEnforcement,
	loadSessionRootBudgetConfig,
	recordExplorationToolCall,
	emptyExplorationBudget,
	isExplorationToolCall,
	resolveEffectiveLimits,
} from "./floors.ts";
import type { SessionRootBudgetConfig, SessionRootSpend } from "./floors.ts";
import type { DelegationRateKind } from "./usage.ts";
import { loadRoleModelPolicy, requestedRoleModel, resolveRoleModel, compareResolvedRoleModel, preflightEffectiveModel } from "./role-models.ts";
import type { ModelPreflightContext, RoleModelResolution } from "./role-models.ts";
import type { EffectiveLimits } from "./floors.ts";
import {
	ASYNC_PREVIEW_TRUNCATED_REASON,
	PREVIEW_TRUNCATED_MARKER,
	is403RateLimit,
	parseSubagentNotify,
	readChildMeta,
	readLargestRunOutput,
	tempRootFromAsyncDir,
} from "./notify.ts";
import {
	compactWorkerReport,
	extractWorkerReport,
	renderValidationResults,
	renderWorkerReport,
	validateWorkerReportIdentity,
	workerReportShapeReminder,
} from "./report.ts";
import {
	advanceReview,
	extractReviewRequest,
	extractReviewResult,
	summarizeFindings,
	bindReviewResultFromRequest,
	validateReviewResultBinding,
	validateReviewResultIdentity,
} from "./review.ts";
import type { ReviewDecision } from "./review.ts";
import { LedgerSnapshotStore, SAFE_TASK_ID } from "./ledger-store.ts";
import { OutputResolver, outputDigest, normalizeCompletionReceipt, RunRecordStore } from "./completion.ts";
import type { CompletionReceipt, OutputReference, OutputResolution, RunRecord, TerminalErrorClass, TerminalSource } from "./completion.ts";
import type { LedgerCorrupt } from "./ledger-store.ts";
import {
	TaskIdAllocator,
	TaskIdentityError,
	TaskStore,
	TASKSPEC_EXAMPLE_SENTINEL,
	appendTaskSpecRepair,
	buildTaskSpecRepair,
	createTaskSpec,
	executingStaleMinutes,
	extractTaskSpec,
	extractTaskSpecDetails,
	hasGeneratedTaskId,
	isExplicitlyNoValidation,
	isExecutingStale,
	isHolderStale,
	isWriterRole,
	normalizeWorkspaceIdentity,
} from "./task.ts";
import type { TaskRecord, WriterConflict } from "./task.ts";
import {
	DEFAULT_STRUCTURED_DELEGATION_MODE,
	EXECUTING_STALE_MS,
	MAX_LEDGER_RESTORE_PER_SESSION,
	MAX_RECOVERY_ATTEMPTS,
	MAX_REVIEW_ROUNDS,
	MAX_WORKER_REPORT_CHARS,
	canRebindNamedTask,
	isFinalTaskState,
	isTerminalTaskState,
} from "./types.ts";
import type {
	DelegationKind,
	EvidenceRef,
	LoadedPluginFingerprint,
	ReviewFinding,
	ReviewResult,
	ReviewRoundAttribution,
	ReviewVerdict,
	StructuredDelegationMode,
	TaskExecutionRecord,
	TaskCompletionKind,
	TaskFinding,
	TaskRole,
	WorkerReport,
	RecoveryBindingCheck,
} from "./types.ts";
import { emptyTaskUsage, exportSessionEvidence, summarizeTaskBudget } from "./usage.ts";
import type { SessionEvidenceExport } from "./usage.ts";
import { BudgetReservations } from "./reservations.ts";
import type { ReservationBudget } from "./reservations.ts";
import { ConcurrencyController } from "./concurrency.ts";

export interface PlannerRecoveryResult {
	status: "recorded" | "pending" | "unbound" | "identity-conflict" | "duplicate";
	taskId?: string;
	runId?: string;
	code?: string;
	executionState?: string;
	ingestionState?: string;
	nextAction?: string;
	retryable?: boolean;
	message?: string;
	bindingCheck?: RecoveryBindingCheck;
}

interface RunBindingResolution {
	status: "bound" | "identity-conflict" | "unbound";
	task?: TaskRecord;
	executionId?: string;
	check: RecoveryBindingCheck;
}

/** Worker output kept as a fallback when a report cannot be parsed at all. */
const RAW_OUTPUT_FALLBACK_CHARS = 4000;
const PROSE_ONLY_REPORT_ERROR = "worker output did not contain a WorkerReport object";
const TASK_ID_SHAPE = /^T-(\d{8})-\d{3}$/;

function terminalErrorClassFor(exitCode?: number, providerError = false, outputMissing = false): TerminalErrorClass | undefined {
	if (providerError) return "provider-error";
	if (exitCode !== undefined && exitCode !== 0) return "process-error";
	if (outputMissing) return "missing-report";
	return undefined;
}

function nextActionForTerminalError(errorClass: TerminalErrorClass | undefined): string | undefined {
	if (errorClass === "provider-error") return "do-not-retry-provider";
	if (errorClass === "process-error") return "inspect-process-error";
	if (errorClass === "missing-report") return "retry-output-reconcile";
	return undefined;
}
function localDateStamp(now: Date): string {
	const year = String(now.getFullYear());
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}${month}${day}`;
}

function shouldReplaceTaskId(taskId: string, now: Date): boolean {
	const match = TASK_ID_SHAPE.exec(taskId);
	if (!match) return true;
	return match[1] !== localDateStamp(now);
}

function rewriteReportToCanonical(
	report: WorkerReport,
	task: TaskRecord,
	repairs: string[],
): WorkerReport {
	if (report.taskId === task.taskId && report.evidence.taskId === task.taskId) return report;
	const from = report.taskId;
	repairs.push(`taskId ${from} → ${task.taskId}`);
	return {
		...report,
		taskId: task.taskId,
		evidence: { ...report.evidence, taskId: task.taskId },
	};
}

function missingBaseEvidence(task: TaskRecord, workerRunId: string): EvidenceRef {
	return {
		cwd: task.cwd,
		taskId: task.taskId,
		workerRunId,
		gitAvailable: false,
		generatedAt: new Date(0).toISOString(),
	};
}

/**
 * FR-01 — bind a recorded report to the Root sample taken when it was
 * validated. These fields are Root-owned: at the acceptance boundary
 * compareEvidence re-samples and detects content drift the worker could never
 * declare (same status/HEAD, different bytes).
 */
function bindReportToSample(report: WorkerReport, sample: EvidenceRef): WorkerReport {
	if (sample.gitAvailable === false) return report;
	return {
		...report,
		evidence: {
			...report.evidence,
			...(sample.finalGitRef ? { finalGitRef: sample.finalGitRef } : {}),
			...(sample.gitStatusHash ? { gitStatusHash: sample.gitStatusHash } : {}),
			...(sample.dirtyPathHashes ? { dirtyPathHashes: sample.dirtyPathHashes } : {}),
		},
	};
}

/**
 * Ticket 10 — the snapshot's verification inputs: the task's exact scope
 * paths plus every path Git reports changed in the sample window.
 *
 * Ticket 20 narrows "paths Git reports changed" to verification inputs:
 * untracked paths outside the task scope (session dirs, isolated agent dirs,
 * `.pi/`) are runtime noise every delegation rewrites, so they never enter
 * the digest. In-scope untracked paths stay (E02), and an empty scope stays
 * empty rather than widening to the whole untracked tree. Scope paths are
 * always sampled directly, so dropping an untracked entry that merely
 * contains an in-scope path loses no coverage.
 */
function snapshotPathsFor(task: TaskRecord, sample: EvidenceRef): string[] {
	const paths = new Set<string>();
	const allowedKeys = new Set((task.spec?.scope?.allowedPaths ?? []).map(snapshotPathKey));
	const untrackedKeys = new Set(untrackedPathsOf(sample).map(snapshotPathKey));
	for (const path of task.spec?.scope?.allowedPaths ?? []) paths.add(path);
	for (const path of sample.changedPaths ?? []) {
		if (untrackedKeys.has(snapshotPathKey(path)) && !allowedKeys.has(snapshotPathKey(path))) continue;
		paths.add(path);
	}
	return [...paths];
}

/** Match key for scope vs. porcelain text: `/`-separated, no `./` or trailing `/`. */
function snapshotPathKey(path: string): string {
	let key = path.replace(/\\/g, "/");
	while (key.startsWith("./")) key = key.slice(2);
	while (key.endsWith("/")) key = key.slice(0, -1);
	return key;
}

function additionalWorktreeRootsOf(task: TaskRecord): readonly string[] | undefined {
	const roots = task.spec?.additionalWorktreeRoots;
	return roots?.length ? roots : undefined;
}

/**
 * Write-lock identities a writable invocation over `task` holds: the Task cwd
 * plus every declared additional worktree root, since the Worker may edit any
 * of them (Variant C).
 */
function lockWorktreesOf(task: TaskRecord, ...extraCwds: string[]): string[] {
	return [...new Set([
		...extraCwds.map((cwd) => normalizeWorkspaceIdentity(cwd)),
		normalizeWorkspaceIdentity(task.cwd),
		...(additionalWorktreeRootsOf(task) ?? []).map((root) => normalizeWorkspaceIdentity(root)),
	])];
}

function captureEvidenceOptionsFor(
	task: TaskRecord,
	workerRunId: string,
	extra: { baseGitRef?: string } = {},
) {
	const roots = additionalWorktreeRootsOf(task);
	return {
		cwd: task.cwd,
		taskId: task.taskId,
		workerRunId,
		...(extra.baseGitRef ? { baseGitRef: extra.baseGitRef } : {}),
		...(roots ? { additionalWorktreeRoots: roots } : {}),
	};
}

/**
 * E02 — whether the environment itself made this sample unverifiable: Git
 * unavailable, status probe failed, or a declared root unreadable. Structured,
 * so the retry classification never matches on reason text.
 */
function environmentFailureOf(...samples: readonly EvidenceRef[]): boolean {
	return samples.some((sample) =>
		sample.gitAvailable === false
		|| sample.statusProbeFailed === true
		|| (sample.unavailableWorktreeRoots?.length ?? 0) > 0,
	);
}

function attributionExecutionForLatestReport(task: TaskRecord): TaskExecutionRecord | undefined {
	const revision = task.reports.length - 1;
	if (revision < 0) return undefined;
	return [...task.executions].reverse().find((execution) => execution.reportIndex === revision);
}

function attributionReadOnlyForLatestReport(task: TaskRecord): boolean {
	const latest = attributionExecutionForLatestReport(task);
	if (!latest) return false;
	if (!latest.reportOnly) return latest.readOnly === true;
	const origin = task.executions.find((execution) => execution.executionId === latest.previousExecutionId);
	return origin?.readOnly === true;
}

function compareWithRootSamples(
	task: TaskRecord,
	current: EvidenceRef,
	report: WorkerReport,
	options: { reportOnly?: boolean; readOnly?: boolean } = {},
) {
	const roots = additionalWorktreeRootsOf(task);
	return compareEvidence(
		task.baseEvidence ?? missingBaseEvidence(task, current.workerRunId),
		current,
		report,
		{
			...(task.spec?.scope ? { scope: task.spec.scope } : {}),
			...(options.reportOnly !== undefined
				? { reportOnly: options.reportOnly }
				: task.reports.length > 0 && attributionExecutionForLatestReport(task)?.reportOnly
					? { reportOnly: true }
				: {}),
			...(options.readOnly !== undefined
				? { readOnly: options.readOnly }
				: { readOnly: attributionReadOnlyForLatestReport(task) }),
			...(roots ? { additionalWorktreeRoots: roots } : {}),
		},
	);
}

export interface SubagentEvent {
	toolCallId: string;
	toolName?: string;
	input?: unknown;
	content?: readonly { type: string; text?: string }[];
	details?: unknown;
	isError?: boolean;
}

export interface OrchestratorDeps {
	store?: TaskStore;
	/** Directory that becomes `<ledgerDir>/planner-only/ledger/<taskId>.json`. */
	ledgerDir?: string;
	gitRunner: GitRunner;
	structuredDelegationMode?: StructuredDelegationMode;
	/**
	 * Where child-run artifacts (`<runId>_<agent>_meta.json`, saved outputs)
	 * live. The Pi adapter supplies session/cwd-derived directories; reconcile
	 * needs them to detect runs that finished without delivering a notice.
	 */
	artifactDirs?: () => readonly string[];
	/**
	 * Ticket 40 — session-level root cumulative spend for the soft/hard gate.
	 * Supplied by the Pi adapter from the session root spend snapshot; absent in
	 * unit tests that do not exercise the session root budget.
	 */
	getSessionRootUsage?: () => SessionRootSpend;
	/**
	 * Ticket 40 — validated soft/hard multipliers. The adapter resolves multipliers
	 * at startup so malformed env values fail there, then may toggle `enabled`
	 * in-session via `/planner-only budget on|off`. When absent it is loaded on
	 * construction (only if getSessionRootUsage is supplied).
	 */
	sessionRootBudgetConfig?: SessionRootBudgetConfig;
	/** Loaded build/session provenance attached to durable execution records. */
	loadedProvenance?: LoadedPluginFingerprint;
	/** Ticket 40 — price class of the model a delegation would launch with. The
	 * hard gate refuses "paid" and "unknown" launches but lets "free" (verified zero-rate) ones through.
	 * Absent: every non-reviewer launch is treated as paid. */
	delegationRateKind?: (model: string | undefined) => DelegationRateKind;
	/** Live host model registry/defaults. When absent, legacy unit callers skip host verification. */
	getModelPreflightContext?: () => Omit<ModelPreflightContext, "input"> | undefined;
	/** Session-wide child execution capacity and read/write admission. */
	concurrency?: ConcurrencyController;
	/** Optional receipt-side accounting hook; called once per distinct run receipt. */
	recordCompletionUsage?: (taskId: string, receipt: CompletionReceipt, toolCallId: string) => void;
	/** RT-06 — host adapter hook for a policy-approved automatic oracle handoff. */
	automaticOracleDispatch?: (task: TaskRecord) => void;

	/** Completion persistence crash-point hook used by integration tests and hosts. */
	runRecordFault?: (point: "before-report" | "after-report") => void;
}

export type { DelegationKind };

export interface DelegationRecord {
	taskId: string;
	kind: DelegationKind;
	/** Task to receive usage when this invocation's behavioral taskId is synthetic. */
	accountingTaskId?: string;
	asyncRequested?: boolean;
	asyncExplicitFalse?: boolean;
	runId?: string;
	asyncDir?: string;
	outputRef?: OutputReference;
	/** Child agent named in the delegation input; used to match single-run notices that carry no runId. */
	agent?: string;
	/**
	 * R02 — the adapter workspace this delegation launched from, normalized
	 * for comparison. An exact-id Idle recovery is authorized only from the
	 * same workspace, including for unbound Explorer calls.
	 */
	launchCwd?: string;
	/**
	 * R02 — how this Explorer invocation owns its Task: a Task it created or
	 * continues (`standalone`), an assisted Worker/Validator Task
	 * (`auxiliary`), or no Task at all (`unbound`).
	 */
	explorerOwnership?: "standalone" | "auxiliary" | "unbound";
	/**
	 * Normalized worktree identities this invocation holds the write lock for.
	 * Set only for writable kinds (worker, validator): the lock is owned by the
	 * live Delegation, not by the Task's executing state.
	 */
	worktrees?: readonly string[];
	/** ISO timestamp when this invocation acquired the write lock. */
	lockedAt?: string;
	/** The ReviewRequest packet this reviewer invocation carries was truncated; a PASS over it is ineligible. */
	packetTruncated?: boolean;
	/**
	 * Bindings from the ReviewRequest packet this reviewer actually received.
	 * Used only to fill omitted ReviewResult fields; validation still compares
	 * against the Task at record time.
	 */
	packetBinding?: { reportRevision: number; workspaceDigest?: string };
	contextOverridden?: boolean;
	reuseReason?: string;
	/**
	 * Budget reserved for this invocation at launch. Ticket 15 charges these
	 * amounts as debt while the child's real usage is unknown, so that a child
	 * which burned real money cannot leave the gate reading a full balance.
	 * Absent when the Task has no cumulative budget (nothing was reserved).
	 */
	grantedTokens?: number;
	grantedCostUsd?: number;
	floorLimits?: EffectiveLimits;
	floorSummary?: string;
	/** Root prompt requested a full suite while the actual validator suite is bounded. */
	oracleSuiteConflict?: boolean;
	/** Explicit report-only correction marker. */
	reportOnly?: boolean;
	/** Host action that created this delegation, when applicable. */
	action?: HostActionKind;
	/** Distinct execution identity; normal delegations use their toolCallId. */
	executionId?: string;
	previousRunId?: string;
	previousExecutionId?: string;
	/** Report-only repairs are explicitly read-only at the delegation boundary. */
	readOnlyRepair?: boolean;
	/** Host control acknowledgement is not terminal. */
	interruptRequested?: boolean;
}

export interface DelegationHistoryEntry {
	toolCallId: string;
	runId?: string;
	role: DelegationKind;
	requested?: { model?: string; thinking?: string };
	resolved?: { model: string; thinking?: string };
	actual?: { model: string; thinking: string };
	model?: string;
	thinking?: string;
	mismatch?: boolean;
	contextOverridden?: boolean;
	reuseReason?: string;
	floorSummary?: string;
	/** RR-07 final model preflight attribution, including fallback selection. */
	preflight?: { model: string; thinking: string; source: string; verification: string };
	failureReason?: string;
	retryReason?: string;
}

export interface DelegationOutcome {
	task?: TaskRecord;
	conflict?: WriterConflict;
	/** Set when the delegation must not launch at all. */
	block?: { reason: string; code?: string; details?: unknown };
	warnings?: string[];
}

export interface RootVerdictOutcome {
	task: TaskRecord;
	decision: ReviewDecision;
	/** Evidence comparison taken at the acceptance boundary, when one ran. */
	evidence?: string;
}

const COMPOSITE_SCALAR_KEYS = ["workflowScript", "workflowScriptPath", "workflow"] as const;
const COMPOSITE_ARRAY_KEYS = ["tasks", "chain"] as const;

/** The subagent agent name each delegation kind launches by default. */
const KIND_DEFAULT_AGENTS: Record<DelegationKind, string> = {
	worker: "worker",
	reviewer: "reviewer",
	explorer: "explorer",
	validator: "oracle",
};

/** Classify host actions before applying the delegation admission gate. */
export type HostActionKind = "management" | "control" | "execution";

export function classifyHostAction(input: unknown): HostActionKind | undefined {
	if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
	const action = (input as Record<string, unknown>).action;
	if (typeof action !== "string" || !action.trim()) return undefined;
	const normalized = action.trim().toLowerCase();
	if (normalized === "resume") return "execution";
	if (["interrupt", "stop", "steer"].includes(normalized)) return "control";
	return "management";
}

/** True only for actions that create a child execution and need admission. */
export function isExecutionCreatingAction(input: unknown): boolean {
	return classifyHostAction(input) === "execution";
}

export function isDelegationCall(input: unknown): boolean {
	if (!input || typeof input !== "object") return false;
	const value = input as Record<string, unknown>;
	if (typeof value.action === "string" && value.action.trim()) return false;
	if (["agent", "task", "workflowScript", "workflowScriptPath", "workflow"]
		.some((key) => key in value && value[key] !== undefined && value[key] !== null &&
			(typeof value[key] !== "string" || value[key].trim() !== ""))) {
		return true;
	}
	return COMPOSITE_ARRAY_KEYS.some((key) => Array.isArray(value[key]) && value[key].length > 0);
}

function isNonEmptyCompositeScalar(value: unknown): boolean {
	if (typeof value === "string") return value.trim() !== "";
	if (value == null) return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object") return Object.keys(value).length > 0;
	return true;
}

/**
 * Planner-only cannot audit or rewrite internal composite workflow steps.
 * Execution calls fail closed; management/validate calls that carry `action`
 * are left unchanged.
 */
export function compositeWorkflowBlockReason(input: unknown): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const value = input as Record<string, unknown>;
	if (typeof value.action === "string" && value.action.trim()) return undefined;

	const detected: string[] = [];
	for (const key of COMPOSITE_SCALAR_KEYS) {
		if (isNonEmptyCompositeScalar(value[key])) detected.push(key);
	}
	for (const key of COMPOSITE_ARRAY_KEYS) {
		if (Array.isArray(value[key]) && value[key].length > 0) detected.push(key);
	}
	if (detected.length === 0) return undefined;
	return [
		"Planner-only guard: composite subagent workflow is rejected before launch.",
		`Detected: ${detected.join(", ")}.`,
		"Planner-only cannot audit or rewrite internal workflow steps and does not parse workflowScript.",
		"Each lifecycle stage must use an independent direct call {agent, task}.",
		"Wait for the worker WorkerReport, then call the reviewer directly so it receives the latest TaskSpec, WorkerReport, and Root Git evidence.",
	].join("\n");
}

function resultText(event: { content?: readonly { type: string; text?: string }[] }): string {
	if (!Array.isArray(event.content)) return "";
	return event.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function truncate(value: string, limit: number): string {
	if (value.length <= limit) return value;
	return `${value.slice(0, limit)}\n… (truncated, ${value.length} chars total)`;
}

function isAsyncInput(input: unknown): boolean {
	return Boolean(input && typeof input === "object" && (input as Record<string, unknown>).async === true);
}

function isExplicitAsyncFalse(input: unknown): boolean {
	return Boolean(input && typeof input === "object" && (input as Record<string, unknown>).async === false);
}

function inputAgent(input: unknown): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const agent = (input as { agent?: unknown }).agent;
	return typeof agent === "string" && agent.trim() ? agent.trim().toLowerCase() : undefined;
}

function eventDetails(event: SubagentEvent): Record<string, unknown> {
	const details = event.details;
	return details !== null && typeof details === "object" && !Array.isArray(details)
		? details as Record<string, unknown>
		: {};
}

function detailString(details: Record<string, unknown>, key: string): string | undefined {
	const value = details[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasCompletionEvidence(details: Record<string, unknown>): boolean {
	if (details.outputState === "present" || details.outputState === "absent") return true;
	if (details.outputRef && typeof details.outputRef === "object") return true;
	if (details.artifactPaths && typeof details.artifactPaths === "object") return true;
	if (details.terminal && typeof details.terminal === "object") return true;
	const results = details.results;
	if (Array.isArray(results) && results.length > 0) {
		for (const item of results) {
			if (item && typeof item === "object") {
				const r = item as Record<string, unknown>;
				if (typeof r.exitCode === "number" || (typeof r.outputState === "string" && r.outputState.trim() !== "")) {
					return true;
				}
			}
		}
	}
	const mission = details.mission;
	if (mission && typeof mission === "object") {
		const m = mission as Record<string, unknown>;
		if (m.status === "completed" || details.missionStatus === "completed") {
			return true;
		}
	}
	return false;
}

function looksLikeWorkerReport(text: string): boolean {
	return text.includes('"version"') && text.includes('"taskId"');
}

/**
 * pi-subagents marks both launch receipts (background single/workflow and
 * detached foreground) with `details.asyncId`; completed foreground results
 * carry `runId` but never `asyncId`.
 */
function receiptRunId(event: SubagentEvent): string | undefined {
	const details = eventDetails(event);
	return detailString(details, "asyncId") ?? detailString(details, "runId");
}

function isAsyncLaunchReceipt(event: SubagentEvent, delegation: DelegationRecord): boolean {
	const text = resultText(event).trim();
	if (looksLikeWorkerReport(text)) return false;

	const details = eventDetails(event);

	// 1. details 带 asyncId → 异步回执
	if (detailString(details, "asyncId")) return true;

	// 2. 否则 details 带 runId 且带完成证据（results 条目的退出码或 outputState，或 mission 状态为已完成）→ 已完成前台结果，按角色分流
	if (detailString(details, "runId") && hasCompletionEvidence(details)) {
		return false;
	}

	// 3. 调用方显式 async:false 时禁止任何散文启发式
	const explicitAsyncFalse = delegation.asyncExplicitFalse === true ||
		(Boolean(event.input) && typeof event.input === "object" && (event.input as Record<string, unknown>).async === false);
	if (explicitAsyncFalse) {
		return false;
	}

	if (!text) return false;

	// 4. Prose heuristics (if retained): only markers with unique async semantics
	// (such as "detached and running in the background"); foreground markers removed.
	try {
		const value = JSON.parse(text) as Record<string, unknown>;
		if (value && typeof value === "object" &&
			["runId", "run_id", "runDir", "runDirectory", "handle"].some((key) => key in value)) {
			return true;
		}
	} catch {
		// Real asyncByDefault receipts are prose, so continue to marker detection.
	}
	const markers = [
		/^Async:\s+\S+\s+\[[0-9a-f-]{8,}\]/im,
		/detached and running in the background/i,
		/async delegation.*has started/i,
	];
	return markers.some((marker) => marker.test(text));
}

function prependOracleSuiteConflict(text: string, delegation?: DelegationRecord): string {
	if (!delegation?.oracleSuiteConflict || text.startsWith(ORACLE_SUITE_CONFLICT_WARNING)) return text;
	return `${ORACLE_SUITE_CONFLICT_WARNING}\n${text}`;
}

function isBudgetStopEvent(event: SubagentEvent, text: string): boolean {
	const details = eventDetails(event);
	const status = typeof details?.status === "string" ? details.status.toLowerCase() : "";
	if (status === "stopped") return true;
	const lower = text.toLowerCase();
	return lower.includes("toolbudget") || lower.includes("usagebudget");
}

function runIdFromReceipt(event: SubagentEvent): string | undefined {
	const fromDetails = receiptRunId(event);
	if (fromDetails) return fromDetails;
	const text = resultText(event).trim();
	try {
		const value = JSON.parse(text) as Record<string, unknown>;
		for (const key of ["runId", "run_id", "asyncId"] as const) {
			if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
		}
	} catch {
		const match = text.match(/^Async:\s+\S+\s+\[([^\]]+)\]/m);
		if (match?.[1]) return match[1];
	}
	return undefined;
}

function untrustedPlaceholder(taskId: string): TaskRecord {
	return {
		taskId,
		role: "worker",
		cwd: "",
		state: "planning",
		reviewRound: 0,
		reviewMode: "root",
		reports: [],
		validatorReports: [],
		reviews: [],
		overrides: [],
		aliases: [],
		successors: [],
		reportCorrections: 0,
		executions: [],
		findings: [],
		recoveryAttempts: 0,
		recoveryStates: [],
		usage: emptyTaskUsage(),
		createdAt: "1970-01-01T00:00:00.000Z",
		updatedAt: "1970-01-01T00:00:00.000Z",
		stateReason: "ledger snapshot unreadable",
	};
}

export class PlannerOrchestrator {
	readonly store: TaskStore;
	readonly structuredDelegationMode: StructuredDelegationMode;
	private readonly gitRunner: GitRunner;
	private readonly artifactDirs: () => readonly string[];
	private readonly getSessionRootUsage?: () => SessionRootSpend;
	private sessionRootBudgetConfig?: SessionRootBudgetConfig;
	private readonly delegationRateKind: (model: string | undefined) => DelegationRateKind;
	private readonly getModelPreflightContext?: () => Omit<ModelPreflightContext, "input"> | undefined;
	private readonly concurrency: ConcurrencyController;
	private readonly recordCompletionUsage?: (taskId: string, receipt: CompletionReceipt, toolCallId: string) => void;
	private readonly automaticOracleDispatch?: (task: TaskRecord) => void;
	private readonly automaticOracleTasks = new Set<string>();

	private readonly delegations = new Map<string, DelegationRecord>();
	private readonly explorationBudgets = new Map<string, ReturnType<typeof emptyExplorationBudget>>();
	private readonly reservations = new BudgetReservations();
	/**
	 * runIds whose subagent-notify (or sync result) has already been consumed.
	 * Intentionally unbounded for the session (ticket 38): eviction would let a
	 * replayed completion notice settle twice — this Set is the settlement
	 * idempotency key. Memory upper bound is O(delegations in this session);
	 * a new session allocates a fresh orchestrator and drops both Sets.
	 */
	private readonly processedRunIds = new Set<string>();
	/**
	 * toolCallIds whose launch the host confirmed never happened.
	 * Same intentional unbounded session policy as processedRunIds (ticket 38).
	 */
	private readonly confirmedNotLaunchedIds = new Set<string>();
	/** taskId -> history of all delegations for that task. */
	private readonly delegationHistory = new Map<string, DelegationHistoryEntry[]>();
	private readonly snapshots?: LedgerSnapshotStore;
	/** RR-02 durable execution/ingestion state, separate from Task review state. */
	private readonly runRecords?: RunRecordStore;
	private runSessionId: string;
	private readonly runWorkspaceId: string;
	private loadedProvenance?: LoadedPluginFingerprint;
	/**
	 * E01 — Tasks whose record came from the ledger. A restored record missing
	 * per-execution A_run/C_report material cannot be verified and must not
	 * complete through the automatic PASS gate; only fresh evidence from a new
	 * execution (or a new Task) recovers it.
	 */
	private readonly restoredTaskIds = new Set<string>();
	/** Per-task: snapshot unreadable, so remaining balance must not be claimed. */
	private readonly untrustedBalances = new Map<string, string>();

	private roleModelMismatchRecorded = false;
	private roleModelPolicyEnabled = false;
	private modelPreflightUnverifiedWarningEmitted = false;

	noteDelegationModel(taskId: string, runIdOrToolCallId: string, model?: string, thinking?: string): void {
		const targetId = this.store.get(taskId)?.taskId ?? taskId;
		const list = this.delegationHistory.get(targetId);
		if (!list) return;
		const found = list.find((d) => d.toolCallId === runIdOrToolCallId || (d.runId && d.runId === runIdOrToolCallId));
		if (!found) return;
		const actual = { model: model?.trim() || "未知", thinking: thinking?.trim() || "未知" };
		found.actual = actual;
		found.model = actual.model;
		found.thinking = actual.thinking;
		if (found.resolved) {
			const comparison = compareResolvedRoleModel(found.resolved, actual);
			found.mismatch = comparison.mismatch;
			if (comparison.mismatch && this.roleModelPolicyEnabled) this.roleModelMismatchRecorded = true;
		}
	}

	private recordHistory(taskId: string, entry: DelegationHistoryEntry): void {
		let list = this.delegationHistory.get(taskId);
		if (!list) {
			list = [];
			this.delegationHistory.set(taskId, list);
		}
		list.push(entry);
	}

	constructor(deps: OrchestratorDeps) {
		this.runSessionId = process.env.PI_SESSION_ID?.trim()
			|| deps.loadedProvenance?.sessionId?.trim()
			|| "unknown-session";
		this.runWorkspaceId = normalizeWorkspaceIdentity(deps.ledgerDir ?? process.cwd());
		this.loadedProvenance = deps.loadedProvenance;
		if (deps.store) {
			this.store = deps.store;
		} else if (deps.ledgerDir) {
			const snapshots = new LedgerSnapshotStore(deps.ledgerDir);
			this.snapshots = snapshots;
			this.runRecords = new RunRecordStore(join(deps.ledgerDir, "planner-only", "run-state"), {
				...(deps.runRecordFault ? { fault: deps.runRecordFault } : {}),
			});
			this.runRecords.load();
			this.store = new TaskStore({
				allocator: new TaskIdAllocator(deps.ledgerDir),
				onPersist: (record) => snapshots.write(record),
			});
		} else {
			this.store = new TaskStore();
		}
		this.gitRunner = deps.gitRunner;
		this.artifactDirs = deps.artifactDirs ?? (() => []);
		this.getSessionRootUsage = deps.getSessionRootUsage;
		this.sessionRootBudgetConfig = deps.sessionRootBudgetConfig
			?? (deps.getSessionRootUsage ? loadSessionRootBudgetConfig() : undefined);
		this.delegationRateKind = deps.delegationRateKind ?? (() => "unknown");
		this.getModelPreflightContext = deps.getModelPreflightContext;
		this.concurrency = deps.concurrency ?? new ConcurrencyController();
		this.recordCompletionUsage = deps.recordCompletionUsage;
		this.automaticOracleDispatch = deps.automaticOracleDispatch;
		this.structuredDelegationMode =
			deps.structuredDelegationMode ?? readStructuredDelegationMode();
	}

	setLoadedProvenance(provenance: LoadedPluginFingerprint): void {
		this.loadedProvenance = { ...provenance, capabilities: [...provenance.capabilities] };
		if (this.runSessionId === "unknown-session" && provenance.sessionId.trim()) {
			this.runSessionId = provenance.sessionId.trim();
		}
	}

	/** Resolve a run only when its durable record belongs to this Root session. */
	taskIdForSessionRun(runId: string): string | undefined {
		const id = runId.trim();
		if (!id) return undefined;
		const delegation = [...this.delegations.values()].find((record) => record.runId === id);
		if (delegation) return this.store.get(delegation.taskId)?.taskId;
		const record = this.runRecords?.list().find((item) => item.runId === id && item.sessionId === this.runSessionId);
		return record ? this.store.get(record.taskId)?.taskId : undefined;
	}

	getLoadedProvenance(): LoadedPluginFingerprint | undefined {
		return this.loadedProvenance ? { ...this.loadedProvenance, capabilities: [...this.loadedProvenance.capabilities] } : undefined;
	}

	getRunRecords(): RunRecord[] {
		return this.runRecords?.list() ?? [];
	}

	/** Export only executions belonging to this Root session. */
	exportEvidence(rootSessionId = this.runSessionId, sourceFingerprint?: string): SessionEvidenceExport {
		return exportSessionEvidence({
			rootSessionId,
			tasks: this.store.list(),
			runRecords: this.getRunRecords(),
			...(sourceFingerprint ? { sourceFingerprint } : {}),
		});
	}


	setLoadedFingerprint(info: LoadedPluginFingerprint): void {
		this.setLoadedProvenance(info);
	}

	getLoadedFingerprint(): LoadedPluginFingerprint | undefined {
		return this.getLoadedProvenance();
	}

	setSessionRootBudgetConfig(config: SessionRootBudgetConfig): void {
		this.sessionRootBudgetConfig = config;
	}



	restoreFromLedger(): { restored: number; corrupt: LedgerCorrupt[] } {
		if (!this.snapshots) return { restored: 0, corrupt: [] };
		const { records, corrupt } = this.snapshots.readAll();
		// Cap + filter (ticket 38 / F6): empty-cwd snapshots without a TaskSpec are
		// ghost placeholders; restoring every historical Task unbounded floods the
		// session store. Prefer the freshest eligible records up to the soft cap.
		const eligible = records
			.filter((record) => {
				if (record.cwd && record.cwd.trim() !== "") return true;
				if (record.spec) return true;
				return false;
			})
			.sort((left, right) => {
				const delta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
				return Number.isFinite(delta) && delta !== 0
					? delta
					: left.taskId.localeCompare(right.taskId);
			})
			.slice(0, MAX_LEDGER_RESTORE_PER_SESSION);
		let restored = 0;
		for (const record of eligible) {
			if (this.store.get(record.taskId)) continue;
			this.store.restore(record);
			this.restoredTaskIds.add(record.taskId);
			restored += 1;
		}
		for (const item of corrupt) {
			this.untrustedBalances.set(item.taskId, item.reason);
			this.snapshots.quarantine(item.taskId, item.reason);
			if (SAFE_TASK_ID.test(item.taskId) && !this.store.get(item.taskId)) {
				this.store.restore(untrustedPlaceholder(item.taskId));
				this.restoredTaskIds.add(item.taskId);
			}
		}
		for (const record of this.runRecords?.list() ?? []) {
			const task = this.store.get(record.taskId);
			const recoveryCheck = this.resolveRunBinding(record.runId ?? "", record.workspaceId).check;
			if (task) task.recoveryBinding = recoveryCheck;
			if (!task || !record.runId || this.delegations.has(record.executionId)) continue;
			const kind = record.role === "validator" || record.role === "reviewer" || record.role === "explorer"
				? record.role
				: "worker";
			this.delegations.set(record.executionId, {
				taskId: task.taskId,
				kind,
				action: "execution",
				executionId: record.executionId,
				runId: record.runId,
				previousRunId: record.previousRunId,
				agent: record.agent,
				launchCwd: task.cwd,
				...(record.outputRef ? { outputRef: record.outputRef } : {}),
			});
			if (record.ingestionState === "recorded" || record.ingestionState === "unavailable") {
				this.processedRunIds.add(record.runId);
			}
		}
		return { restored, corrupt };
	}

	private releaseRunSlot(task: TaskRecord | undefined, executionId: string, toolCallId: string): boolean {
		let alreadyReleased = false;
		if (task && this.runRecords) {
			const current = this.runRecords.get(this.runSessionId, this.runWorkspaceIdFor(task), executionId);
			alreadyReleased = current?.slotReleased === true;
			if (alreadyReleased) return false;
			if (current) {
				this.runRecords.put({ ...current, slotReleased: true, slotReleasedAt: new Date().toISOString() });
			}
		}
		// Map deletion is idempotent; the durable marker above is the authority
		// that prevents a reloaded receipt from counting a second release.
		this.concurrency.release(toolCallId);
		this.reservations.release(task?.taskId ?? "", toolCallId);
		return !alreadyReleased;
	}

	private endDelegation(toolCallId: string): void {
		const record = this.delegations.get(toolCallId);
		const task = record ? this.store.get(record.taskId) : undefined;
		this.releaseRunSlot(task, record ? this.executionIdFor(record, toolCallId) : toolCallId, toolCallId);
		this.delegations.delete(toolCallId);
	}

	/** Record an inspection call against the Task's unified exploration budget. */
	recordExplorationToolCall(taskId: string, toolName: string, input?: unknown): { used: number; limit: number; notice?: string } {
		const current = this.explorationBudgets.get(taskId) ?? emptyExplorationBudget();
		const result = recordExplorationToolCall(current, toolName, input);
		this.explorationBudgets.set(taskId, result.budget);
		return { used: result.budget.used, limit: result.budget.limit, ...(result.notice ? { notice: result.notice } : {}) };
	}

	/** True when a call belongs to the plugin-side exploration budget. */
	isExplorationToolCall(toolName: string, input?: unknown): boolean {
		return isExplorationToolCall(toolName, input);
	}

	explorationBudgetStatus(taskId: string): { used: number; limit: number; softNotified: boolean; hardNotified: boolean } {
		const budget = this.explorationBudgets.get(taskId) ?? emptyExplorationBudget();
		return { ...budget };
	}

	/** Current child capacity and workspace reservations for /planner-only status. */
	renderConcurrencyStatus(): string {
		const status = this.concurrency.status();
		const lines = [`Concurrency: ${status.occupied}/${status.limit} occupied, ${status.available} available (source: ${status.source})`];
		for (const item of status.reservations) {
			lines.push(`  - ${item.taskId ?? "unbound"} execution=${item.id} role=${item.role} capability=${item.capability} workspace=${item.workspaces.join(", ") || "none"}`);
		}
		return lines.join("\n");
	}

	setConcurrencyLimit(limit: number): { ok: true } | { ok: false; error: string } { return this.concurrency.setSessionLimit(limit); }
	setConcurrencySavedLimit(limit: number): { ok: true } | { ok: false; error: string } { return this.concurrency.setSavedLimit(limit); }
	resetConcurrencyLimit(): void { this.concurrency.resetSessionLimit(); }
	getConcurrencyStatus() { return this.concurrency.status(); }

	private untrustedLedgerRefusal(taskId: string): string {
		const reason = this.untrustedBalances.get(taskId) ?? "unreadable snapshot";
		return [
			`Planner-only guard: task ${taskId} ledger snapshot unreadable`,
			"余额无法确认，拒绝新的受控启动。",
			`原因: ${reason}`,
		].join("\n");
	}

	private cumulativeBudgetRefusal(taskId: string, budget: ReservationBudget, refusal: { dimension: "tokens" | "costUsd" }): string {
		const inFlight = this.reservations.inFlight(taskId);
		const limit = (dimension: "tokens" | "costUsd"): string => {
			const item = budget[dimension];
			return item.limit === undefined ? "未设" : dimension === "tokens" ? String(item.limit) : item.limit.toFixed(4);
		};
		return [
			`Planner-only guard: task ${taskId} cumulative budget exhausted (${refusal.dimension}).`,
			`已知消耗: tokens=${budget.tokens.known}, 费用 $${budget.costUsd.known.toFixed(4)}`,
			`在途预留: tokens=${inFlight.tokens}, 费用 $${inFlight.costUsd.toFixed(4)}`,
			`未知项: tokens ${budget.tokens.unknownParts} 项, 费用 ${budget.costUsd.unknownParts} 项`,
			`上限: tokens=${limit("tokens")}, 费用 $${limit("costUsd")}`,
			"本次受控启动被拒绝；结束在途子进程或提高 cumulativeBudget 后重试。",
		].join("\n");
	}

	pendingDelegationCount(): number {
		return this.delegations.size;
	}

	getDelegation(toolCallId: string): DelegationRecord | undefined {
		return this.delegations.get(toolCallId);
	}

	/** Resolve the execution record id used by a delegation. */
	private executionIdFor(record: DelegationRecord, toolCallId: string): string {
		return record.executionId ?? toolCallId;
	}

	/**
	 * Resolve a run without guessing. Every candidate is retained for the
	 * recovery view; a run seen in another workspace or more than once is an
	 * identity conflict, never an unbound continuation.
	 */
	private resolveRunBinding(runId: string, cwd: string): RunBindingResolution {
		const id = runId.trim();
		const workspace = normalizeWorkspaceIdentity(cwd);
		if (!id) {
			return {
				status: "unbound",
				check: { status: "unbound", reason: "runId is required", runId: id, workspaceId: workspace },
			};
		}
		const candidates: Array<{ task: TaskRecord; executionId: string; workspaceId: string }> = [];
		const seen = new Set<string>();
		const add = (task: TaskRecord, executionId: string, workspaceId = task.cwd): void => {
			const normalized = normalizeWorkspaceIdentity(workspaceId);
			const key = `${task.taskId}\u0000${executionId}\u0000${normalized}`;
			if (seen.has(key)) return;
			seen.add(key);
			candidates.push({ task, executionId, workspaceId: normalized });
		};
		for (const task of this.store.list()) {
			for (const execution of task.executions) {
				if (execution.runId === id) add(task, execution.executionId, task.cwd);
			}
		}
		for (const record of this.runRecords?.list() ?? []) {
			if (record.runId !== id) continue;
			const task = this.store.get(record.taskId);
			if (!task) continue;
			const execution = task.executions.find((item) =>
				item.executionId === record.executionId || item.runId === id,
			);
			if (execution) add(task, execution.executionId, record.workspaceId || task.cwd);
		}
		if (candidates.length === 0) {
			return {
				status: "unbound",
				check: { status: "unbound", reason: "no persisted execution is bound to this runId", runId: id, workspaceId: workspace },
			};
		}
		const mismatched = candidates.filter((candidate) => candidate.workspaceId !== workspace);
		if (candidates.length !== 1 || mismatched.length > 0) {
			const details = candidates.map((candidate) => `${candidate.task.taskId}/${candidate.executionId}@${candidate.workspaceId}`).join(", ");
			return {
				status: "identity-conflict",
				check: {
					status: "identity-conflict",
					reason: mismatched.length > 0
						? `runId has conflicting workspace history; requested ${workspace}, candidates: ${details}`
						: `runId has multiple candidate identities: ${details}`,
					runId: id,
					workspaceId: workspace,
				},
			};
		}
		const candidate = candidates[0];
		return {
			status: "bound",
			task: candidate.task,
			executionId: candidate.executionId,
			check: {
				status: "bound",
				reason: "exact persisted run, Task, execution, and workspace binding",
				runId: id,
				taskId: candidate.task.taskId,
				executionId: candidate.executionId,
				workspaceId: workspace,
				canonical: { taskId: candidate.task.taskId, executionId: candidate.executionId, workspaceId: workspace },
			},
		};
	}

	/** Return one auditable binding check for every persisted run-state record. */
	getRecoveryView(cwd?: string): RecoveryBindingCheck[] {
		const checks: RecoveryBindingCheck[] = [];
		const seen = new Set<string>();
		for (const record of this.runRecords?.list() ?? []) {
			const check = this.resolveRunBinding(record.runId ?? "", cwd ?? record.workspaceId).check;
			const key = `${record.sessionId}\u0000${record.workspaceId}\u0000${record.executionId}`;
			if (seen.has(key)) continue;
			seen.add(key);
			checks.push({ ...check, taskId: check.taskId ?? record.taskId, executionId: check.executionId ?? record.executionId, workspaceId: check.workspaceId ?? record.workspaceId });
		}
		return checks;
	}

	renderRecoveryView(cwd?: string): string {
		const checks = this.getRecoveryView(cwd);
		if (checks.length === 0) return "Recovery bindings: none";
		return ["Recovery bindings:", ...checks.map((check) =>
			`- ${check.status}: run=${check.runId ?? "unknown"}; task=${check.taskId ?? "unknown"}; execution=${check.executionId ?? "unknown"}; workspace=${check.workspaceId ?? "unknown"}; reason=${check.reason}`,
		)].join("\\n");
	}

	private resumeRunId(input: unknown): string | undefined {
		if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
		const record = input as Record<string, unknown>;
		for (const key of ["id", "runId", "previousRunId"]) {
			if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
		}
		return undefined;
	}

	/** Shared receipt-ingestion entry for wait, notify, recovery, and reload. */
	ingestCompletionReceipt(
		value: unknown,
		source: "sync" | "bg-wait" | "notify" | "reconcile" = "bg-wait",
		options: {
			resolution?: OutputResolution;
			failure?: { code: string; message: string; reason: string; provider?: boolean };
		} = {},
	): CompletionReceipt | undefined {
		const receipt = normalizeCompletionReceipt(value, source);
		if (!receipt?.runId) return receipt;
		const found = [...this.delegations.entries()].find(([, record]) =>
			record.runId === receipt.runId || record.executionId === receipt.executionId ||
			(record.action === "execution" && record.previousRunId !== undefined && receipt.previousRunId === record.previousRunId));
		const durable = found ? undefined : this.runRecords?.findByRunId(receipt.runId);
		if (!found && !durable) return receipt;
		const toolCallId = found?.[0] ?? durable?.executionId ?? receipt.executionId ?? receipt.runId;
		const record = found?.[1];
		const taskId = record?.taskId ?? durable?.taskId;
		if (!taskId) return receipt;
		if (receipt.taskIdHint && (this.store.get(receipt.taskIdHint)?.taskId ?? receipt.taskIdHint) !== taskId) return receipt;
		if (record?.previousRunId && receipt.previousRunId && record.previousRunId !== receipt.previousRunId) return receipt;
		if (record?.previousRunId && !receipt.previousRunId) receipt.previousRunId = record.previousRunId;
		if (record && receipt.previousRunId && record.previousRunId === undefined) record.previousRunId = receipt.previousRunId;
		if (record?.outputRef) receipt.outputRef = receipt.outputRef ?? record.outputRef;
		if (record) {
			if (receipt.outputRef) record.outputRef = receipt.outputRef;
			record.runId = receipt.runId;
		}
		const executionId = record ? this.executionIdFor(record, toolCallId) : durable?.executionId ?? toolCallId;
		const task = this.store.get(taskId);
		if (task) {
			const isTerminal = Boolean(receipt.terminal?.state && receipt.terminalSource);
			const failure = options.failure;
			const errorClass = failure
				? terminalErrorClassFor(receipt.terminal?.exitCode, failure.provider === true, true)
				: terminalErrorClassFor(receipt.terminal?.exitCode, false, isTerminal && receipt.outputState !== "present");
			const resolution = options.resolution;
			const ingestionPatch = resolution
				? resolution.kind === "loaded"
					? { ingestionState: "loaded" as const, outputDigest: resolution.digest, lastError: undefined }
					: {
						ingestionState: resolution.kind === "pending" ? "output-pending" as const : "unavailable" as const,
						...(resolution.kind === "pending" ? { terminalErrorClass: "missing-report" as const, nextAction: "retry-output-reconcile" } : {}),
						lastError: { code: resolution.code, message: `output resolution ${resolution.code}` },
					}
				: {};
			this.updateRunRecord(task, executionId, {
				runId: receipt.runId,
				...(receipt.previousRunId ? { previousRunId: receipt.previousRunId } : {}),
				...(receipt.outputRef ? { outputRef: receipt.outputRef } : {}),
				...(receipt.terminal?.exitCode !== undefined ? { exitCode: receipt.terminal.exitCode } : {}),
				...(isTerminal ? { executionState: "terminal", terminalSource: receipt.terminalSource } : { executionState: "running" }),
				...(errorClass ? { terminalErrorClass: errorClass, nextAction: nextActionForTerminalError(errorClass) } : {}),
				...ingestionPatch,
				...(failure ? {
					executionState: "terminal" as const,
					ingestionState: "unavailable" as const,
					terminalReason: failure.reason,
					terminalErrorClass: terminalErrorClassFor(receipt.terminal?.exitCode, failure.provider === true, true),
					nextAction: nextActionForTerminalError(terminalErrorClassFor(receipt.terminal?.exitCode, failure.provider === true, true)),
					lastError: { code: failure.code, message: failure.message },
				} : {}),
			});
			this.store.completeExecution(task.taskId, executionId, { runId: receipt.runId });
			if (failure && !isFinalTaskState(task.state)) {
				this.store.transition(task.taskId, "failed");
				this.store.setStateReason(task.taskId, failure.reason);
			}
			if (isTerminal) this.releaseRunSlot(task, executionId, toolCallId);
			if (this.recordCompletionUsage && receipt.usage !== undefined) {
				this.recordCompletionUsage(task.taskId, receipt, toolCallId);
			}
		}
		return receipt;
	}

	registerCompletionReceipt(value: unknown): CompletionReceipt | undefined {
		return this.ingestCompletionReceipt(value, "bg-wait");
	}

	/**
	 * Re-ingest an already persisted run artifact without starting a model.
	 * The run id and workspace must resolve to one existing execution; active
	 * Task fallback is intentionally not used.
	 */
	async reingestOriginalReport(
		runId: string,
		cwd: string,
		expectedTaskId?: string,
	): Promise<PlannerRecoveryResult> {
		const id = typeof runId === "string" ? runId.trim() : "";
		const workspace = normalizeWorkspaceIdentity(cwd);
		if (!id) return { status: "unbound", code: "RUN_UNBOUND", retryable: false, message: "runId is required" };
		const binding = this.resolveRunBinding(id, cwd);
		if (binding.status === "identity-conflict") {
			return {
				status: "identity-conflict",
				runId: id,
				code: "RUN_IDENTITY_CONFLICT",
				retryable: false,
				message: binding.check.reason,
				bindingCheck: binding.check,
			};
		}
		if (binding.status === "unbound" || !binding.task || !binding.executionId) {
			return { status: "unbound", runId: id, code: "RUN_UNBOUND", retryable: false, message: binding.check.reason, bindingCheck: binding.check };
		}
		const resolvedBinding = { task: binding.task, executionId: binding.executionId };
		const resolvedExpectedTaskId = expectedTaskId !== undefined
			? this.store.get(expectedTaskId)?.taskId ?? expectedTaskId
			: undefined;
		if (resolvedExpectedTaskId !== undefined && resolvedExpectedTaskId !== binding.task.taskId) {
			return {
				status: "unbound",
				taskId: expectedTaskId,
				runId: id,
				code: "FOREIGN_RECEIPT",
				retryable: false,
				message: `runId is bound to task ${binding.task.taskId}, not ${expectedTaskId}`,
			};
		}
		if (resolvedExpectedTaskId !== undefined && this.store.list().every((task) => task.taskId !== resolvedExpectedTaskId)) {
			return { status: "unbound", taskId: expectedTaskId, runId: id, code: "RUN_UNBOUND", retryable: false, message: "taskId is not a canonical persisted Task id" };
		}
		const execution = this.store.executionById(binding.task.taskId, binding.executionId);
		if (!execution) return { status: "unbound", taskId: binding.task.taskId, runId: id, code: "RUN_UNBOUND", retryable: false, message: "bound execution record is missing" };
		const persisted = this.runRecords?.findByRunId(id, workspace);
		const existingIngestion = persisted?.ingestionState;
		if (existingIngestion === "loaded" && execution.reportIndex !== undefined && persisted && this.runRecords) {
			this.runRecords.commitReport(persisted, execution.reportIndex + 1);
			return {
				status: "recorded",
				taskId: binding.task.taskId,
				runId: id,
				executionState: "terminal",
				ingestionState: "recorded",
				retryable: false,
				message: "recovered a report commit that completed before its final run-state write",
			};
		}
		if (execution.reportIndex !== undefined || existingIngestion === "recorded") {
			return {
				status: "duplicate",
				taskId: binding.task.taskId,
				runId: id,
				code: "RUN_ALREADY_RECORDED",
				executionState: persisted?.executionState ?? "terminal",
				ingestionState: existingIngestion ?? "recorded",
				retryable: false,
				message: "this run has already been recorded; no report or correction was added",
			};
		}
		if (persisted?.terminalErrorClass === "provider-error") {
			return {
				status: "duplicate",
				taskId: binding.task.taskId,
				runId: id,
				code: "PROVIDER_403_RATE_LIMIT",
				executionState: persisted.executionState,
				ingestionState: persisted.ingestionState,
				retryable: false,
				nextAction: "do-not-retry-provider",
				message: "provider terminal error has no report to correct; do not retry the provider automatically",
			};
		}
		if (existingIngestion === "report-invalid") {
			return {
				status: "duplicate",
				taskId: binding.task.taskId,
				runId: id,
				code: "REPORT_SCHEMA_INVALID",
				executionState: persisted?.executionState ?? "terminal",
				ingestionState: existingIngestion,
				retryable: false,
				message: "this terminal run already failed report validation; no correction was added",
			};
		}
		let outputRef = persisted?.outputRef;
		if (!outputRef) {
			const delegation = [...this.delegations.values()].find((record) => record.runId === id && record.taskId === resolvedBinding.task.taskId);
			outputRef = delegation?.outputRef;
		}
		this.ingestCompletionReceipt({
			runId: id,
			terminal: { state: "completed", exitCode: 0 },
			terminalSource: "reconcile",
			outputState: outputRef ? "present" : "unknown",
			...(outputRef ? { outputRef } : {}),
		}, "reconcile");
		if (!outputRef && /^[A-Za-z0-9_.-]+$/.test(id)) {
			const agent = KIND_DEFAULT_AGENTS[execution.kind];
			const candidates = this.artifactDirs().flatMap((dir) => [
				join(dir, `${id}_${agent}_output.md`),
				join(dir, `${id}_${agent}_output.json`),
				join(dir, "outputs", id, "result.json"),
				join(dir, "outputs", id, "output.json"),
				join(dir, "outputs", id, "output.md"),
			]);
			const found = candidates.filter((path) => existsSync(path));
			if (found.length > 1) {
				return { status: "pending", taskId: binding.task.taskId, runId: id, code: "OUTPUT_AMBIGUOUS", executionState: persisted?.executionState ?? "terminal", ingestionState: "unavailable", nextAction: "retry-output-reconcile", retryable: true, message: "more than one deterministic legacy artifact is bound to this run" };
			}
			if (found.length === 1) outputRef = { outputPath: found[0] };
		}
		if (!outputRef) {
			return { status: "pending", taskId: binding.task.taskId, runId: id, code: "OUTPUT_PENDING", executionState: persisted?.executionState ?? "terminal", ingestionState: persisted?.ingestionState ?? "output-pending", nextAction: "retry-output-reconcile", retryable: true, message: "no bound completion output is available yet" };
		}
		const trustedRoots = [...this.artifactDirs(), binding.task.cwd].filter(Boolean);
		const resolution = new OutputResolver({ trustedRoots }).resolve({
			version: 1,
			source: "reconcile",
			runId: id,
			observedAt: new Date().toISOString(),
			outputState: "present",
			...(persisted?.agent || execution.kind ? { agent: persisted?.agent ?? KIND_DEFAULT_AGENTS[execution.kind] } : {}),
			outputRef,
		});
		if (resolution.kind !== "loaded") {
			this.markRunIngestion(binding.task, binding.executionId, resolution);
			return { status: "pending", taskId: binding.task.taskId, runId: id, code: resolution.code, executionState: persisted?.executionState ?? "terminal", ingestionState: resolution.kind === "pending" ? "output-pending" : "unavailable", nextAction: resolution.kind === "pending" ? "retry-output-reconcile" : "inspect-process-error", retryable: resolution.kind === "pending", message: `bound output resolution returned ${resolution.code}` };
		}
		const delegation: DelegationRecord = {
			taskId: binding.task.taskId,
			kind: execution.kind,
			action: "execution",
			executionId: binding.executionId,
			runId: id,
			previousRunId: execution.previousRunId,
		};
		await this.ingestCompletionResult(binding.task, resolution.text, binding.executionId, { delegation }, resolution);
		this.processedRunIds.add(id);
		const active = [...this.delegations.entries()].find(([, item]) => item.runId === id);
		if (active) this.endDelegation(active[0]);
		const recorded = this.store.executionById(binding.task.taskId, binding.executionId)?.reportIndex !== undefined;
		return recorded
			? { status: "recorded", taskId: binding.task.taskId, runId: id, executionState: "terminal", ingestionState: "recorded", retryable: false, message: "bound run output was re-ingested" }
			: { status: "pending", taskId: binding.task.taskId, runId: id, code: "REPORT_SCHEMA_INVALID", executionState: "terminal", ingestionState: "report-invalid", retryable: false, message: "bound output did not produce a recordable WorkerReport" };
	}
	/** True when handleSubagentResult classified this call as a confirmed start failure. */
	wasConfirmedNotLaunched(toolCallId: string): boolean {
		return this.confirmedNotLaunchedIds.has(toolCallId);
	}

	listDelegations(): { toolCallId: string; record: DelegationRecord }[] {
		return [...this.delegations.entries()].map(([toolCallId, record]) => ({ toolCallId, record }));
	}

	/**
	 * E01 — the cumulative attribution a Fresh Reviewer must see: per-round
	 * windows, the earliest trustworthy baseline ref, and the findings that
	 * survived earlier rounds. A chain with missing material is truncated, so
	 * a PASS over it is ineligible.
	 */
	private reviewAttribution(task: TaskRecord): {
		baselineRef?: string;
		rounds: ReviewRoundAttribution[];
		unresolvedFindings: string[];
		attributionIncomplete?: string;
	} {
		const executions = task.executions.filter((execution) => !execution.auxiliary && !execution.reportOnly);
		const rounds: ReviewRoundAttribution[] = executions.map((execution) => ({
			executionId: execution.executionId,
			role: execution.kind,
			...(execution.runId ? { runId: execution.runId } : {}),
			...(execution.reportIndex !== undefined ? { reportRevision: execution.reportIndex + 1 } : {}),
			...(execution.aRun.finalGitRef ? { aRef: execution.aRun.finalGitRef } : {}),
			...(execution.cReport?.finalGitRef ? { cRef: execution.cReport.finalGitRef } : {}),
			attributedFiles: execution.truthPaths ?? [],
			...(execution.executionChangedPaths?.length ? { executionChangedFiles: execution.executionChangedPaths } : {}),
			...(execution.committedPaths?.length ? { committedFiles: execution.committedPaths } : {}),
			...(execution.observedExternalPaths?.length ? { observedExternalFiles: execution.observedExternalPaths } : {}),
			undeclaredFiles: execution.undeclaredPaths ?? [],
			outOfScopeFiles: execution.outOfScopePaths ?? [],
			...(execution.freshness
				? {
					freshness: execution.freshness.fresh
						? "fresh" as const
						: execution.freshness.verifiable ? "stale" as const : "unknown" as const,
				}
				: {}),
		}));
		const incomplete: string[] = [];
		if (executions.length === 0) {
			incomplete.push("no per-execution attribution record exists for this Task");
		}
		for (const execution of executions) {
			if (!execution.aRun.finalGitRef) incomplete.push(`execution ${execution.executionId} has no A_run ref`);
			if (!execution.cReport) incomplete.push(`execution ${execution.executionId} has no C_report sample`);
		}
		const baselineRef = executions.find((execution) => execution.aRun.finalGitRef)?.aRun.finalGitRef
			?? task.baseEvidence?.finalGitRef;
		const unresolvedFindings = task.findings
			.filter((finding) => finding.status === "open")
			.map((finding) =>
				`${finding.kind}: ${finding.paths.join(", ") || "revised workspace"}${
					finding.evidenceResolvedBy ? " (restore proven; review confirmation pending)" : ""
				}`,
			);
		return {
			...(baselineRef ? { baselineRef } : {}),
			rounds,
			unresolvedFindings,
			...(incomplete.length > 0 ? { attributionIncomplete: incomplete.join("; ") } : {}),
		};
	}

	/**
	 * Remap the child agent and, for reviewers, replace the payload with a
	 * ReviewRequest packet. Async because Root samples Git evidence for the
	 * packet: reviewer children have no `git_audit` of their own (§P1-2).
	 */
	async prepareRoleDelegation(rawInput: unknown, baseCwd?: string): Promise<void> {
		if (compositeWorkflowBlockReason(rawInput)) return;
		const lookup = (taskId: string): TaskRecord | undefined => this.store.get(taskId);
		const target = resolveDelegationTarget(rawInput, lookup);
		const options: PrepareRoleDelegationOptions = {};
		const requestedOracleMode = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
			? (rawInput as Record<string, unknown>).oracleMode
			: undefined;
		if (requestedOracleMode === "bounded" || requestedOracleMode === "full") {
			options.oracleMode = requestedOracleMode;
		}
		const active = this.store.active();
		const task = target?.task ?? (active && (active.state === "changes_requested" || active.state === "reviewing") ? active : undefined);
		if (task) {
			options.reportsCount = task.reports.length;
		}
		const fallback = target?.task ?? this.reportOnlyFallbackTask(this.delegationCwd(rawInput, baseCwd));
		if (fallback) options.fallbackTask = fallback;
		const cwd = task?.cwd;
		if (target?.role === "reviewer" && cwd) {
			const attribution = this.reviewAttribution(task);
			options.git = await captureReviewEvidencePacket(
				this.gitRunner,
				cwd,
				task.lastComparison,
				// The patch is bounded against the Task's start baseline, not the
				// current HEAD, so committed Task changes stay reviewable (R03).
				{
					...(attribution.baselineRef ? { baselineRef: attribution.baselineRef } : {}),
					...(additionalWorktreeRootsOf(task)
						? { additionalWorktreeRoots: additionalWorktreeRootsOf(task) }
						: {}),
					...(attribution.rounds.length > 0 ? { rounds: attribution.rounds } : {}),
					...(attribution.unresolvedFindings.length > 0
						? { unresolvedFindings: attribution.unresolvedFindings }
						: {}),
					...(attribution.attributionIncomplete
						? { attributionIncomplete: attribution.attributionIncomplete }
						: {}),
				},
			);
			if (task.lastComparison) {
				options.evidence = describeComparison(task.lastComparison);
			}
		}
		prepareRoleDelegation(rawInput, lookup, options);
	}

	/** Delegation cwd resolved against the Root cwd; undefined when neither is known. */
	private delegationCwd(rawInput: unknown, baseCwd: string | undefined): string | undefined {
		const rawCwd = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
			? (rawInput as { cwd?: unknown }).cwd
			: undefined;
		const rel = typeof rawCwd === "string" && rawCwd.trim() ? rawCwd.trim() : undefined;
		if (baseCwd) return rel ? resolve(baseCwd, rel) : baseCwd;
		return rel && isAbsolute(rel) ? rel : undefined;
	}

	/**
	 * Ticket 42 — the Task an unnamed report-only correction may bind to: the
	 * live Task of the delegation's own workspace. Without a known cwd nothing
	 * is offered rather than guessing across workspaces.
	 */
	private reportOnlyFallbackTask(cwd: string | undefined): TaskRecord | undefined {
		if (!cwd) return undefined;
		const candidate = this.store.activeForCwd(cwd);
		if (!candidate) return undefined;
		return candidate.state === "changes_requested" || candidate.state === "report-invalid" || candidate.state === "reviewing" || candidate.state === "executing"
			? candidate
			: undefined;
	}

	/**
	 * E01 — the latest execution that carries Task attribution: worker rounds
	 * only. Report-only corrections and auxiliary validator/explorer runs link
	 * to this chain but never replace its window.
	 */
	private latestAttributionExecution(task: TaskRecord): TaskExecutionRecord | undefined {
		for (let index = task.executions.length - 1; index >= 0; index -= 1) {
			const execution = task.executions[index] as TaskExecutionRecord;
			if (!execution.auxiliary && !execution.reportOnly) return execution;
		}
		return undefined;
	}

	/** E01 — the execution that produced report revision `task.reports.length`. */
	private executionForLatestReport(task: TaskRecord): TaskExecutionRecord | undefined {
		const revision = task.reports.length - 1;
		if (revision < 0) return undefined;
		for (let index = task.executions.length - 1; index >= 0; index -= 1) {
			const execution = task.executions[index] as TaskExecutionRecord;
			if (execution.reportIndex === revision) return execution;
		}
		return undefined;
	}

	private runWorkspaceIdFor(task: TaskRecord): string {
		return normalizeWorkspaceIdentity(task.cwd || this.runWorkspaceId);
	}

	private updateRunRecord(
		task: TaskRecord,
		executionId: string,
		patch: Partial<RunRecord>,
	): void {
		if (!this.runRecords) return;
		const current = this.runRecords.get(this.runSessionId, this.runWorkspaceIdFor(task), executionId);
		if (!current) return;
		const next = { ...current, ...patch, taskId: task.taskId };
		const link = {
			taskId: task.taskId,
			executionId,
			...(next.runId ? { hostRunId: next.runId } : {}),
			...(next.reportRevision !== undefined ? { reportRevision: next.reportRevision } : {}),
		};
		const identityIndex = [...(next.identityIndex ?? []).filter((item) => item.executionId !== executionId), link];
		this.runRecords.put({ ...next, identityIndex });
	}

	private registerRunRecord(
		task: TaskRecord,
		executionId: string,
		kind: DelegationKind,
		options: { runId?: string; previousRunId?: string; reportOnly?: boolean; auxiliary?: boolean } = {},
	): void {
		if (!this.runRecords) return;
		this.runRecords.put({
			version: 1,
			sessionId: this.runSessionId,
			workspaceId: this.runWorkspaceIdFor(task),
			taskId: task.taskId,
			executionId,
			...(options.runId ? { runId: options.runId } : {}),
			...(options.previousRunId ? { previousRunId: options.previousRunId } : {}),
			agent: KIND_DEFAULT_AGENTS[kind],
			role: kind,
			loadedProvenance: this.getLoadedProvenance(),
			identityIndex: [{
				taskId: task.taskId,
				executionId,
				...(options.runId ? { hostRunId: options.runId } : {}),
			}],
			executionState: "launching",
			ingestionState: "waiting",
			...(options.reportOnly || options.auxiliary ? {} : {}),
		});
	}

	/** Mark output as terminal without implying that a report was recorded. */
	private markRunTerminal(task: TaskRecord, executionId: string, reason?: string, source: TerminalSource = "report-only"): void {
		const current = this.runRecords?.get(this.runSessionId, this.runWorkspaceIdFor(task), executionId);
		this.updateRunRecord(task, executionId, {
			executionState: "terminal",
			ingestionState: current?.ingestionState ?? "waiting",
			terminalSource: source,
			...(reason ? { terminalReason: reason } : {}),
		});
		this.releaseRunSlot(task, executionId, executionId);
	}

	private markRunIngestion(task: TaskRecord, executionId: string, resolution: OutputResolution): void {
		if (resolution.kind === "loaded") {
			this.updateRunRecord(task, executionId, {
				executionState: "terminal",
				ingestionState: "loaded",
				outputDigest: resolution.digest,
				lastError: undefined,
			});
			return;
		}
		this.updateRunRecord(task, executionId, {
			ingestionState: resolution.kind === "pending" ? "output-pending" : "unavailable",
			...(resolution.kind === "pending" ? { terminalErrorClass: "missing-report", nextAction: "retry-output-reconcile" } : {}),
			lastError: { code: resolution.code, message: `output resolution ${resolution.code}` },
		});
	}
	/**
	 * E01 — start this execution's evidence record from Root's own A_run. A
	 * report-only correction keeps the original attribution window; a normal
	 * execution starts a new one linked to the previous.
	 */
	private beginExecutionRecord(
		task: TaskRecord,
		executionId: string,
		kind: DelegationKind,
		aRun: EvidenceRef,
		options: {
			reportOnly?: boolean;
			/** Capability recorded from the trusted launch binding, not the report. */
			readOnly?: boolean;
			auxiliary?: boolean;
			runId?: string;
			previousRunId?: string;
			previousExecutionId?: string;
		} = {},
	): void {
		const prior = this.latestAttributionExecution(task);
		if (!options.reportOnly) {
			// A new baseline after drift is the explicit recovery path: the
			// drifted paths are now part of the revision under review, so the
			// drift finding awaits review confirmation instead of blocking.
			const driftPaths = this.store
				.openFindings(task.taskId)
				.filter((finding) => finding.kind === "drift" && !finding.evidenceResolvedBy)
				.flatMap((finding) => finding.paths);
			if (driftPaths.length > 0) {
				this.store.markFindingEvidenceResolved(task.taskId, driftPaths, executionId, ["drift"]);
			}
		}
		this.store.beginExecution(task.taskId, {
			executionId,
			kind,
			cwd: task.cwd,
			worktreeRoots: lockWorktreesOf(task),
			aRun,
			...(options.runId ? { runId: options.runId } : {}),
			...(options.previousRunId ? { previousRunId: options.previousRunId } : {}),
			...(options.reportOnly ? { reportOnly: true } : {}),
			...(options.readOnly ? { readOnly: true } : {}),
			...(options.auxiliary ? { auxiliary: true } : {}),
			...(options.previousExecutionId
				? { previousExecutionId: options.previousExecutionId }
				: prior ? { previousExecutionId: prior.executionId } : {}),
		});
		this.registerRunRecord(task, executionId, kind, {
			...(options.runId ? { runId: options.runId } : {}),
			...(options.reportOnly ? { reportOnly: true } : {}),
			...(options.auxiliary ? { auxiliary: true } : {}),
			...(options.previousRunId
				? { previousRunId: options.previousRunId }
				: prior?.runId ? { previousRunId: prior.runId } : {}),
		});
	}

	/** E01 — record this execution's C_report; kept even when the report cannot be parsed. */
	private completeExecutionSample(
		task: TaskRecord,
		executionId: string,
		cReport: EvidenceRef,
		patch: Partial<Omit<TaskExecutionRecord, "taskId" | "executionId">> = {},
	): void {
		this.store.completeExecution(task.taskId, executionId, { cReport, ...patch });
	}

	/**
	 * E01 — bind a recorded report to its execution's truth window and refresh
	 * this revision's findings. A report-only correction reuses the original
	 * execution's window; drift during the correction is handled by freshness.
	 */
	private recordReportExecutionTruth(
		task: TaskRecord,
		execution: TaskExecutionRecord,
		cReport: EvidenceRef,
		report: WorkerReport,
		reportIndex: number,
	): void {
		const origin = execution.reportOnly
			? this.store.executionById(task.taskId, execution.previousExecutionId ?? "")
			: execution;
		const originMissing = execution.reportOnly && !origin;
		// A report-only correction is valid only when its prior attribution
		// execution is present. Never let the correction's own A/C window become
		// the attribution window: that would make an omitted change look clean.
		const truthRun = originMissing ? { ...execution.aRun, gitAvailable: false } : origin?.aRun ?? execution.aRun;
		const truthBase = originMissing ? { ...cReport, gitAvailable: false } : origin?.cReport ?? cReport;
		const roots = additionalWorktreeRootsOf(task);
		// The final report declares cumulative delivery: paths attributed to
		// earlier rounds may be restated without becoming findings.
		const priorTruthPaths = task.executions
			.filter((item) => item !== execution && !item.auxiliary && item.truthPaths?.length)
			.flatMap((item) => item.truthPaths ?? []);
		const truth = compareExecutionTruth(truthRun, truthBase, originMissing ? undefined : report, {
			...(task.spec?.scope ? { scope: task.spec.scope } : {}),
			...(roots ? { additionalWorktreeRoots: roots } : {}),
			...(execution.reportOnly ? { reportOnly: true } : {}),
			...(origin?.readOnly === true ? { readOnly: true } : {}),
			...(priorTruthPaths.length > 0 ? { priorTruthPaths } : {}),
		});
		this.store.completeExecution(task.taskId, execution.executionId, {
			reportIndex,
			truthPaths: truth.truthPaths,
			executionChangedPaths: truth.executionChangedPaths,
			committedPaths: truth.committedPaths,
			observedExternalPaths: truth.observedExternalPaths,
			undeclaredPaths: truth.undeclaredPaths,
			outOfScopePaths: truth.outOfScopePaths,
			extraDeclaredPaths: truth.extraDeclaredPaths,
			externalPaths: truth.externalPaths,
		});
		const findingOwner = execution.reportOnly && origin ? origin.executionId : execution.executionId;
		if (!originMissing) {
			this.store.recordExecutionFindings(
				task.taskId,
				findingOwner,
				truth.findings,
				this.store.now().toISOString(),
				// Declaration findings are recomputed as a set: a repaired report
				// clears the finding kinds it no longer trips.
				["undeclared", "scope", "over-declared", "missing"],
			);
		}
		// A path dirty at A_run and clean at C_report (without being committed)
		// was restored in this window; an earlier scope finding on it now has
		// evidence of the restore, and a review still has to confirm it.
		if (truth.verifiable) {
			const dirtyAtStart = new Set(
				normalizeEvidencePaths(truthRun.changedPaths ?? [], truthRun.repoRoot ?? truthRun.cwd),
			);
			const dirtyNow = new Set(
				normalizeEvidencePaths(cReport.changedPaths ?? [], cReport.repoRoot ?? cReport.cwd),
			);
			const committedNow = new Set(
				normalizeEvidencePaths(cReport.committedPaths ?? [], cReport.repoRoot ?? cReport.cwd),
			);
			const restored = [...dirtyAtStart].filter(
				(path) => !dirtyNow.has(path) && !committedNow.has(path),
			);
			if (restored.length > 0) {
				this.store.markFindingEvidenceResolved(task.taskId, restored, execution.executionId);
			}
		}
	}

	private successorAttribution(
		task: TaskRecord,
		currentSample: EvidenceRef,
		freshness: FreshnessComparison,
	): { kind: TaskCompletionKind; successorTaskId?: string; paths: string[] } | undefined {
		if (!freshness.verifiable || freshness.fresh) return undefined;
		const successors = [...new Set([
			...(task.successors ?? []),
			...this.store.list()
				.filter((candidate) => (candidate.spec?.parentTaskId ?? candidate.spec?.commitOf ?? candidate.parentTaskId) === task.taskId)
				.map((candidate) => candidate.taskId),
		])];
		const candidates = this.store.list().filter((candidate) =>
			successors.includes(candidate.taskId)
			&& isTerminalTaskState(candidate.state),
		);
		if (candidates.length === 0) return undefined;
		const successorPaths = new Set(
			candidates.flatMap((candidate) => candidate.executions.flatMap((execution) => execution.truthPaths ?? [])),
		);
		if (successorPaths.size === 0) return undefined;
		const driftPaths = freshness.driftPaths.map((path) => normalizeEvidencePaths([path], currentSample.repoRoot ?? currentSample.cwd)[0]);
		if (driftPaths.length > 0 && driftPaths.every((path) => successorPaths.has(path))) {
			const owner = candidates.find((candidate) =>
				driftPaths.every((path) => candidate.executions.some((execution) => (execution.truthPaths ?? []).includes(path))),
			);
			return { kind: "superseded", paths: driftPaths, ...(owner ? { successorTaskId: owner.taskId } : {}) };
		}
		const committedPaths = (currentSample.committedPaths ?? [])
			.map((path) => normalizeEvidencePaths([path], currentSample.repoRoot ?? currentSample.cwd)[0]);
		if (
			freshness.headChanged
			&& currentSample.changedPaths?.length === 0
			&& committedPaths.length > 0
			&& committedPaths.every((path) => successorPaths.has(path))
		) {
			const owner = candidates.find((candidate) =>
				committedPaths.every((path) => candidate.executions.some((execution) => (execution.truthPaths ?? []).includes(path))),
			);
			return { kind: "committed", paths: committedPaths, ...(owner ? { successorTaskId: owner.taskId } : {}) };
		}
		return undefined;
	}
	/**
	 * E01 — replace the legacy mixed A↔C comparison with the per-execution
	 * contract when execution material exists:
	 *   Truth/scope  = compareExecutionTruth(A_run, C_report, report)
	 *   Freshness    = compareFreshness(C_report, C_now)
	 * Findings survive later rounds and must block PASS until a review closes
	 * them; missing material fails closed instead of being guessed from the
	 * current tree.
	 */
	private async augmentExecutionEvidence(
		task: TaskRecord,
		currentSample: EvidenceRef,
		comparison: EvidenceComparison,
	): Promise<EvidenceComparison> {
		const report = task.reports.at(-1);
		if (!report) return comparison;
		const latest = this.executionForLatestReport(task);
		if (!latest) {
			const reason = `report revision ${task.reports.length} has no per-execution A_run/C_report evidence record`;
			return {
				...comparison,
				verifiable: false,
				missingMaterials: reason,
				reasons: [...comparison.reasons, `missing execution evidence — ${reason}`],
			};
		}
		const origin = latest.reportOnly
			? this.store.executionById(task.taskId, latest.previousExecutionId ?? "")
			: latest;
		if (latest.reportOnly && !origin) {
			const reason = `report-only execution ${latest.executionId} has no linked prior execution ${latest.previousExecutionId ?? "(missing)"}; attribution cannot be verified`;
			this.store.completeExecution(task.taskId, latest.executionId, {
				freshness: { verifiable: false, fresh: false, reasons: [reason], driftPaths: [] },
			});
			return {
				...comparison,
				verifiable: false,
				fresh: false,
				missingMaterials: reason,
				reasons: [...comparison.reasons, `missing execution evidence — ${reason}`],
			};
		}
		const truthRun = origin?.aRun ?? latest.aRun;
		const truthBase = origin?.cReport ?? latest.cReport;
		const roots = additionalWorktreeRootsOf(task);
		const priorTruthPaths = task.executions
			.filter((item) => item !== latest && !item.auxiliary && !item.reportOnly && item.truthPaths?.length)
			.flatMap((item) => item.truthPaths ?? []);
		const truth = compareExecutionTruth(truthRun, truthBase ?? currentSample, report, {
			...(task.spec?.scope ? { scope: task.spec.scope } : {}),
			...(roots ? { additionalWorktreeRoots: roots } : {}),
			...(latest.reportOnly ? { reportOnly: true } : {}),
			...(origin?.readOnly === true ? { readOnly: true } : {}),
			...(priorTruthPaths.length > 0 ? { priorTruthPaths } : {}),
		});
		const correctionWindowFresh = latest.reportOnly && latest.cReport
			? compareFreshness(latest.aRun, latest.cReport, {
				...(roots ? { additionalWorktreeRoots: roots } : {}),
				...(task.spec?.scope ? { scope: task.spec.scope } : {}),
			}).fresh
			: false;
		const freshnessBase = latest.reportOnly && correctionWindowFresh ? latest.cReport : truthBase;
		let freshness: FreshnessComparison = freshnessBase
			? compareFreshness(freshnessBase, currentSample, {
				...(roots ? { additionalWorktreeRoots: roots } : {}),
				...(task.spec?.scope ? { scope: task.spec.scope } : {}),
			})
			: {
				verifiable: false,
				fresh: false,
				reasons: [`execution ${latest.executionId} has no C_report sample; freshness cannot be verified`],
				driftPaths: [],
				headChanged: false,
			};
		const successorAttribution = truth.findings.length === 0
			? this.successorAttribution(task, currentSample, freshness)
			: undefined;
		if (successorAttribution) {
			freshness = {
				...freshness,
				fresh: true,
				driftPaths: [],
				reasons: [
					...freshness.reasons,
					`${successorAttribution.kind} by successor${successorAttribution.successorTaskId ? ` ${successorAttribution.successorTaskId}` : ""}`,
				],
			};
			this.store.recordExecutionFindings(
				task.taskId,
				latest.executionId,
				[{ kind: successorAttribution.kind, paths: successorAttribution.paths }],
				this.store.now().toISOString(),
				["drift", "superseded", "committed"],
			);
			this.store.markFindingEvidenceResolved(
				task.taskId,
				successorAttribution.paths,
				latest.executionId,
				["superseded", "committed"],
			);
		}
		this.store.completeExecution(task.taskId, latest.executionId, {
			freshness: {
				verifiable: freshness.verifiable,
				fresh: freshness.fresh,
				reasons: freshness.reasons,
				driftPaths: freshness.driftPaths,
			},
		});
		if (latest.reportOnly && correctionWindowFresh && freshness.verifiable && freshness.fresh) {
			// A report-only C_report is a new, Root-sampled baseline for freshness.
			// Resolve only stale drift proved by that baseline; attribution findings
			// from the original Worker window remain open and blocking.
			const driftPaths = this.store
				.openFindings(task.taskId)
				.filter((finding) => finding.kind === "drift" && !finding.evidenceResolvedBy)
				.flatMap((finding) => finding.paths);
			if (driftPaths.length > 0) {
				this.store.markFindingEvidenceResolved(task.taskId, driftPaths, latest.executionId, ["drift"]);
			}
		}
		if (freshness.verifiable && !freshness.fresh) {
			this.store.setExecutionDrift(task.taskId, latest.executionId, {
				detectedAt: this.store.now().toISOString(),
				paths: freshness.driftPaths,
				reasons: freshness.reasons,
			});
			this.store.recordExecutionFindings(
				task.taskId,
				latest.executionId,
				[{ kind: "drift", paths: freshness.driftPaths }],
				this.store.now().toISOString(),
			);
		}

		// Scope classification for the shared comparison fields: an undeclared
		// in-scope path is overlapping (under-report), an out-of-scope one is
		// an independent scope finding.
		const pathCwd = currentSample.cwd || task.cwd;
		const allowedPaths = new Set(normalizeEvidencePaths(task.spec?.scope?.allowedPaths ?? [], pathCwd));
		for (const root of roots ?? []) {
			for (const path of task.spec?.scope?.allowedPaths ?? []) {
				if (!isAbsolute(path)) allowedPaths.add(normalizeEvidencePaths([path], root)[0]);
			}
		}
		const hasAllowList = allowedPaths.size > 0;
		const overlappingPaths = truth.undeclaredPaths.filter((path) => !hasAllowList || allowedPaths.has(path));
		const unrelatedPaths = truth.undeclaredPaths.filter((path) => hasAllowList && !allowedPaths.has(path));

		const open = this.store.openFindings(task.taskId);
		const reasons = [...truth.reasons, ...freshness.reasons];
		for (const finding of open) {
			reasons.push(
				`evidence finding (${finding.kind}): ${finding.paths.length > 0 ? finding.paths.join(", ") : "workspace revision changed"}${
					finding.evidenceResolvedBy ? " [restore proven; needs review confirmation]" : ""
				}`,
			);
		}
		const verifiable = truth.verifiable && freshness.verifiable;
		const fresh = verifiable
			&& truth.findings.length === 0
			&& !truth.declarationMismatch
			&& freshness.fresh
			&& open.length === 0;
		// Over-declaration and vanished declared changes make the report itself
		// unreliable (legacy semantics): the comparison is unexplained, not just
		// finding-bearing. Under-report and scope findings are repairs, not
		// revalidations, and stay unexplained=false. A report that claims
		// another cwd than the one its result arrived in is equally unreliable.
		const unreliable = truth.declarationMismatch
			|| truth.findings.some(
				(finding) => finding.kind === "over-declared" || finding.kind === "missing",
			);
		// The comparison shows the Task's cumulative delivery: every
		// attribution window up to and including this revision, deduped.
		const cumulative = [...new Set([...priorTruthPaths, ...truth.truthPaths])].sort();
		return {
			verifiable,
			fresh,
			reasons,
			truthPaths: cumulative,
			undeclaredPaths: truth.undeclaredPaths,
			extraDeclaredPaths: truth.extraDeclaredPaths,
			overlappingPaths,
			unrelatedPaths,
			missingPaths: truth.missingPaths,
			unexplained: !verifiable || !freshness.fresh || unreliable,
			truthFindings: open.map((finding) => ({ kind: finding.kind, paths: finding.paths })),
			missingMaterials: comparison.missingMaterials,
			freshness,
			boundaryRef: currentSample.finalGitRef,
			...(successorAttribution ? { supersession: successorAttribution } : {}),
		} as EvidenceComparison;
	}

	/**
	 * E01 — close evidence-proven findings once a PASS review confirms them.
	 * Findings with no proving evidence stay open and keep blocking PASS.
	 */
	private preparePassFindings(
		task: TaskRecord,
		comparison: EvidenceComparison | undefined,
	): EvidenceComparison | undefined {
		if (!comparison) return comparison;
		if (comparison.missingMaterials) return comparison;
		if (comparison.freshness && (!comparison.freshness.verifiable || !comparison.freshness.fresh)) {
			return comparison;
		}
		const open = this.store.openFindings(task.taskId);
		if (open.length === 0) return comparison;
		if (open.some((finding) => !finding.evidenceResolvedBy)) return comparison;
		this.store.resolveFindings(task.taskId, `pass-revision-${task.reports.length}`);
		// The findings were the only blocker: the comparison is fresh again now
		// that the review has confirmed the evidence-proven restores.
		return {
			...comparison,
			fresh: comparison.verifiable && (comparison.freshness?.fresh ?? true),
			reasons: comparison.reasons.filter((reason) => !reason.startsWith("evidence finding")),
			truthFindings: [],
		};
	}

	async beginDelegation(
		event: { toolCallId: string; input?: unknown },
		baseCwd: string,
	): Promise<DelegationOutcome> {
		try {
			const outcome = await this.beginDelegationInner(event, baseCwd);
			if (outcome.block) {
				// A reservation is provisional until a delegation record is created.
				// Release it before returning every blocked launch outcome.
				this.concurrency.release(event.toolCallId);
				this.reservations.releaseByToolCall(event.toolCallId);
			}
			return outcome;
		} finally {
			// Reservations happen before the launch decision. Any path that returns
			// without recording a delegation must return its reservation as well.
			const record = this.delegations.get(event.toolCallId);
			if (!record) {
				this.reservations.releaseByToolCall(event.toolCallId);
				this.concurrency.release(event.toolCallId);
			} else {
				// Ticket 15: stamp the granted budget here rather than at the five
				// delegations.set sites, for the same reason endDelegation is the one
				// release point -- a per-site copy is a per-site chance to forget.
				const grant = this.reservations.grantFor(event.toolCallId);
				if (grant?.tokens !== undefined) record.grantedTokens = grant.tokens;
				if (grant?.costUsd !== undefined) record.grantedCostUsd = grant.costUsd;
			}
		}
	}

	private async beginDelegationInner(
		event: { toolCallId: string; input?: unknown },
		baseCwd: string,
	): Promise<DelegationOutcome> {
		const input = event.input ?? {};
		// Ticket 42 — stamp explicit reportOnly before composite/target checks so
		// machine-generated corrections bind even when prepareRoleDelegation was skipped.
		stampReportOnlyCorrectionInput(input);
		const composite = compositeWorkflowBlockReason(input);
		if (composite) {
			return { block: { reason: composite } };
		}
		const inputRecord = input as Record<string, unknown>;
		const hostAction = classifyHostAction(input);
		const resume = hostAction === "execution";
		const rawCwd = (input as { cwd?: unknown }).cwd;
		const cwd = typeof rawCwd === "string" && rawCwd.trim()
			? resolve(baseCwd, rawCwd.trim())
			: baseCwd;
		let resumeBinding: { task: TaskRecord; executionId: string; runId: string } | undefined;
		let target = resolveDelegationTarget(input, (taskId) => this.store.get(taskId));
		if (resume) {
			const previousRunId = this.resumeRunId(input);
			const binding = previousRunId ? this.resolveRunBinding(previousRunId, cwd) : undefined;
			if (!previousRunId || !binding || binding.status === "unbound" || !binding.task || !binding.executionId) {
				const conflict = binding?.status === "identity-conflict";
				return {
					block: {
						code: conflict ? "RUN_IDENTITY_CONFLICT" : "RUN_UNBOUND",
						reason: `${conflict ? "RUN_IDENTITY_CONFLICT" : "RUN_UNBOUND"}: resume requires an exact persisted run association for ${previousRunId ?? "the supplied id"}; ${binding?.check.reason ?? "no active Task was guessed."}`,
					},
				};
			}
			resumeBinding = { task: binding.task, executionId: binding.executionId, runId: previousRunId };
			target = { role: "worker", taskId: binding.task.taskId, task: binding.task };
		}
		if (inputRecord.reportOnly === true) {
			target = bindReportOnlyFallback(target, this.reportOnlyFallbackTask(cwd));
			const namedTaskIds = target?.namedTaskIds ?? [];
			const explicitTaskId = target?.taskId ?? target?.spec?.taskId;
			if (!target) {
				return {
					block: {
						code: "REPORT_TARGET_UNBOUND",
						reason: "Planner-only guard: report-only correction has no verifiable Task target; embed the canonical TaskSpec or taskId before resubmission.",
					},
				};
			}
			if (explicitTaskId && !target.task) {
				return {
					block: {
						code: "REPORT_TARGET_UNBOUND",
						reason: `Planner-only guard: report-only correction targets unknown Task ${explicitTaskId}; no placeholder Task is created. Bind an existing canonical task or alias explicitly.`,
					},
				};
			}
			if (namedTaskIds.length > 0 && !target.task) {
				const code = namedTaskIds.length > 1 ? "REPORT_TARGET_AMBIGUOUS" : "REPORT_TARGET_UNBOUND";
				return {
					block: {
						code,
						reason: namedTaskIds.length > 1
							? `Planner-only guard: report-only correction names multiple Task ids (${namedTaskIds.join(", ")}); target selection is ambiguous and no placeholder Task is created. Embed one canonical TaskSpec or taskId.`
							: `Planner-only guard: report-only correction names unknown Task ${namedTaskIds[0]}; no placeholder Task is created. Embed a canonical TaskSpec or taskId for an existing Task.`,
					},
				};
			}
			if ((explicitTaskId || namedTaskIds.length > 0) && target.task && !canRebindNamedTask(target.task.state)) {
				return {
					block: {
						code: "REPORT_TARGET_UNBOUND",
						reason: `Planner-only guard: report-only correction targets Task ${target.task.taskId}, whose state is ${target.task.state}; no placeholder Task is created and terminal Tasks cannot receive corrections.`,
					},
				};
			}
		}
		// R02 — the role stamped by prepareRoleDelegation survives the agent
		// remap, so an unstructured explorer still registers as one.
		const stampedRole = typeof inputRecord.__delegationRole === "string" && inputRecord.__delegationRole
			? (inputRecord.__delegationRole as TaskRole)
			: undefined;
		const role = stampedRole ?? target?.role ?? "worker";
		// Reserve capacity before any Task, budget, evidence, or writer mutation.
		// Reader/reader overlap is safe in phase one; every other overlapping
		// capability is conservatively serialized by the controller.
		const embeddedTaskLooksInvalid = typeof inputRecord.task === "string" && (() => {
			try {
				const rawTask = inputRecord.task as string;
				const jsonText = rawTask.match(/\{[\s\S]*\}/)?.[0];
				if (!jsonText) return false;
				const candidate = JSON.parse(jsonText) as Record<string, unknown>;
				if (!candidate || typeof candidate !== "object") return false;
				if ("taskId" in candidate && (!candidate.objective || typeof candidate.objective !== "string" || !candidate.objective.trim())) return true;
				const validation = candidate.validation;
				if (!validation || typeof validation !== "object") return false;
				const validationRecord = validation as Record<string, unknown>;
				if ("required" in validationRecord && typeof validationRecord.required !== "boolean") return true;
				return validationRecord.required === true && (!Array.isArray(validationRecord.commands) || validationRecord.commands.length === 0);
			} catch {
				return false;
			}
		})();
		const warnings: string[] = [];
		if ((!hostAction || hostAction === "execution") && !embeddedTaskLooksInvalid && !(role === "validator" && !target?.task && !target?.spec)) {
			const reservationTaskId = target?.task?.taskId ?? target?.taskId;
			const declaredRoots = target?.task?.spec?.additionalWorktreeRoots
				?? (target?.spec?.additionalWorktreeRoots ?? []);
			const admissionCwd = target?.task?.cwd ?? target?.spec?.cwd ?? cwd;
			const capability: "reader" | "reviewer" | "writer" = role === "explorer" ? "reader" : role === "reviewer" ? "reviewer" : "writer";
			const admissionWorkspaces = role === "explorer" && target?.task ? [] : [admissionCwd, ...declaredRoots];
			for (const reservation of this.concurrency.status().reservations) {
				const reservationTask = reservation.taskId ? this.store.get(reservation.taskId) : undefined;
				if (reservation.taskId && (!reservationTask || isFinalTaskState(reservationTask.state))) {
					this.concurrency.release(reservation.id);
				}
			}
			const admissionRequest = {
				id: event.toolCallId,
				...(reservationTaskId ? { taskId: reservationTaskId } : {}),
				...(target?.task ? { state: target.task.state } : {}),
				structured: Boolean(target?.spec),
				role,
				capability,
				workspaces: admissionWorkspaces,
			};
			let admission = this.concurrency.reserve(admissionRequest);
			if (admission.refusal) {
				if (admission.refusal.code === "WORKSPACE_CONFLICT") {
					if (role !== "reviewer" && this.getSessionRootUsage) {
						const sessionEvaluation = evaluateSessionRootBudget(this.getSessionRootUsage(), this.sessionRootBudgetConfig);
						if (sessionEvaluation.level === "hard" && this.delegationRateKind(requestedRoleModel(inputRecord).model) !== "free") {
							return { block: { reason: formatSessionRootBudgetRefusal(sessionEvaluation) } };
						}
					}
					const conflictingReservationId = admission.refusal.conflictingIds?.[0];
					const conflictingTaskId = conflictingReservationId
						? this.concurrency.get(conflictingReservationId)?.taskId ?? conflictingReservationId
						: undefined;
					if (conflictingTaskId) {
						await this.reconcileBeforeLock(conflictingTaskId, warnings);
						admission = this.concurrency.reserve(admissionRequest);
					}
				}
				if (admission.refusal?.code === "WORKSPACE_CONFLICT") {
					const conflictingReservationId = admission.refusal.conflictingIds?.[0];
					const conflictingTaskId = conflictingReservationId
						? this.concurrency.get(conflictingReservationId)?.taskId ?? conflictingReservationId
						: undefined;
					if (conflictingTaskId) {
						this.noteStaleHolder(
							{ conflict: true, taskId: conflictingTaskId, reason: admission.refusal.reason },
							target?.task?.taskId ?? target?.spec?.taskId,
						);
					}
					// Keep a rejected structured launch inspectable for a later retry,
					// without creating or mutating a Task when it already exists.
					if (target?.spec && !target.task) {
						const createTask = this.store.create.bind(this.store);
						createTask(target.spec);
					}
					// Preserve the more actionable cumulative-budget refusal when a
					// retry is both workspace-conflicting and already exhausted.
					const conflictTask = target?.task;
					const conflictBudget = (conflictTask?.spec as unknown as { cumulativeBudget?: unknown } | undefined)?.cumulativeBudget;
					if (role !== "reviewer" && conflictTask?.usage && conflictBudget && typeof conflictBudget === "object") {
						const budget = summarizeTaskBudget(conflictTask.usage, conflictBudget as Parameters<typeof summarizeTaskBudget>[1]);
						const budgetReservation = this.reservations.reserve(conflictTask.taskId, budget, { toolCallId: event.toolCallId });
						if (budgetReservation.refused) {
							return { block: { reason: this.cumulativeBudgetRefusal(conflictTask.taskId, budget, budgetReservation.refused) } };
						}
					}
					return {
						conflict: {
							conflict: true,
							taskId: admission.refusal.conflictingIds?.[0],
							reason: `${admission.refusal.reason}; occupied=${admission.refusal.occupied}, limit=${admission.refusal.limit}, available=${admission.refusal.available}. The conflicting run's write lock has not been confirmed exited; retry after a trusted child terminal event.`,
						},
					};
				}
				if (admission.refusal) {
					return {
						block: {
							code: admission.refusal.code,
							details: admission.refusal,
							reason: `${admission.refusal.reason}; occupied=${admission.refusal.occupied}, limit=${admission.refusal.limit}, available=${admission.refusal.available}. Retry after a trusted child terminal event.`,
						},
					};
				}
			}
		}
		const roleModelPolicy = loadRoleModelPolicy();
		this.roleModelPolicyEnabled = roleModelPolicy.enabled;
		if (roleModelPolicy.enabled && this.roleModelMismatchRecorded) {
			this.concurrency.release(event.toolCallId);
			stripDelegationKeys(input);
			return { block: { reason: "Planner-only guard: role model policy mismatch recorded; further controlled launches are stopped." } };
		}
		const requested = requestedRoleModel(inputRecord);
		let resolved: RoleModelResolution | undefined;
		if (roleModelPolicy.enabled) {
			try {
				resolved = resolveRoleModel(roleModelPolicy, role, inputRecord);
			} catch (error) {
				this.concurrency.release(event.toolCallId);
				stripDelegationKeys(input);
				return { block: { reason: error instanceof Error ? error.message : String(error) } };
			}
		}
		const reportOnlyInput = inputRecord.reportOnly === true;
		const spec = target?.spec
			?? (reportOnlyInput && target?.task?.spec
				? { ...target.task.spec, reportOnly: true }
				: undefined);

		// RR-07: verify when the host exposes a registry; otherwise record
		// unverified-and-continue before any session budget, reservation, evidence,
		// or writer-lock side effect can occur.
		let preflightSummary: { model: string; thinking: string; source: string; verification: string } | undefined;
		const preflightContext = this.getModelPreflightContext?.();
		if (!preflightContext) {
			if (this.getModelPreflightContext && !this.modelPreflightUnverifiedWarningEmitted) {
				this.modelPreflightUnverifiedWarningEmitted = true;
				warnings.push("Planner-only: model preflight is unverified on this host because no modelRegistry is exposed; continuing launch.");
			}
		} else {
			const specRecord = spec && typeof spec === "object" ? spec as unknown as Record<string, unknown> : undefined;
			const nestedSpec = inputRecord.taskSpec && typeof inputRecord.taskSpec === "object"
				? inputRecord.taskSpec as Record<string, unknown>
				: undefined;
			const taskSpecModel = typeof specRecord?.model === "string"
				? specRecord.model
				: typeof nestedSpec?.model === "string" ? nestedSpec.model : undefined;
			const taskSpecThinking = typeof specRecord?.thinking === "string"
				? specRecord.thinking
				: typeof nestedSpec?.thinking === "string" ? nestedSpec.thinking : undefined;
			const preflight = preflightEffectiveModel({
				...preflightContext,
				hostAgent: role,
				input: inputRecord,
				...(resolved ? { roleResolution: resolved } : {}),
				...(roleModelPolicy.enabled ? { rolePolicy: roleModelPolicy } : {}),
				...(taskSpecModel ? { taskSpecModel } : {}),
				...(taskSpecThinking ? { taskSpecThinking } : {}),
			});
			if (preflight.effective) {
				const effectiveModel = preflight.effective.provider
					? `${preflight.effective.provider}/${preflight.effective.model}`
					: preflight.effective.model;
				preflightSummary = {
					model: effectiveModel,
					thinking: preflight.effective.thinking ?? "unknown",
					source: preflight.effective.source,
					verification: preflight.status,
				};
				// A host default is already resolved by the downstream host. Keep it
				// out of the input so the host can apply settings.json fallbacks. Each
				// explicit field is independent: model-only must not acquire host thinking.
				if (preflight.effective.modelSource !== "host-default") inputRecord.model = effectiveModel;
				if (preflight.effective.thinkingSource !== "host-default" && preflight.effective.thinking !== undefined) {
					inputRecord.thinking = preflight.effective.thinking;
				}
			}
			if (preflight.status !== "verified") {
				const error = preflight.error;
				const detail = error
					? `${error.code}: model=${error.requested}; source=${error.source}; verification=${error.verification}; candidates=${error.candidates.join(", ") || "none"}; ${error.message}`
					: "MODEL_UNAVAILABLE: effective model preflight was unavailable";
				if (preflight.status === "unverified") {
					warnings.push(`Planner-only: model preflight is unverified; continuing launch. ${detail}`);
				} else {
					this.concurrency.release(event.toolCallId);
					stripDelegationKeys(input);
					return {
						block: {
							reason: `Planner-only guard: ${detail}`,
							...(error ? { code: error.code, details: error } : { code: "MODEL_UNAVAILABLE" }),
						},
					};
				}
			}
			if (preflight.effective) {
				resolved = {
					role,
					model: preflight.effective.provider
						? `${preflight.effective.provider}/${preflight.effective.model}`
						: preflight.effective.model,
					thinking: preflight.effective.thinking,
				};
			}
		}

		const promptNow = delegationPrompt(input);
		const requestedOracleMode = inputRecord.oracleMode === "full" || inputRecord.oracleMode === "bounded"
			? inputRecord.oracleMode
			: oracleSuiteMode();
		// After prepareRoleDelegation the prompt is a wrapped packet; do not
		// scan it. Root full-suite requests are recorded on __oracleSuiteConflict
		// from the original prose. Direct beginDelegation still scans unwrapped text.
		const alreadyWrapped = promptNow.startsWith(ORACLE_CONTRACT_MARKER);
		const targetSpec = target?.task?.spec ?? target?.spec;
		const targetReport = target?.task?.reports.at(-1);
		const missingCmds = missingTaskSpecValidationCommands(targetSpec, targetReport);
		const reqCmds = targetSpec?.validation?.commands ?? [];
		const properSubsetMissing = reqCmds.length > 0 && missingCmds.length > 0 && missingCmds.length < reqCmds.length;
		const completeTaskSpecValidation = reqCmds.length > 0 && missingCmds.length === 0;
		const oracleSuiteConflict = role === "validator"
			&& requestedOracleMode === "bounded"
			&& lastWorkerValidationPassed(targetReport)
			&& target?.task?.lastComparison?.fresh === true
			&& completeTaskSpecValidation
			&& !properSubsetMissing
			&& !alreadyWrapped
			&& hasFullSuiteRequest(promptNow);

		const contextOverridden = Boolean((input as Record<string, unknown>).__contextOverridden);
		const reuseOutcome = (input as Record<string, unknown>).__reuseOutcome as ContextReuseOutcome | undefined;
		let floorLimits = (input as Record<string, unknown>).__floorLimits as EffectiveLimits | undefined;
		if (!floorLimits) {
			floorLimits = resolveEffectiveLimits({
				role,
				reportsCount: target?.task?.reports.length ?? 0,
				callerToolBudget: (input as Record<string, unknown>).toolBudget,
				callerUsageBudget: (input as Record<string, unknown>).usageBudget,
				taskSpecBudget: spec?.budget,
			});
		}
		const budgetTask = target?.task;
		const firstDelegationTask = !budgetTask && spec?.cumulativeBudget && typeof spec.cumulativeBudget === "object"
			? { taskId: spec.taskId, usage: emptyTaskUsage(), spec, reports: [] as TaskRecord["reports"] }
			: undefined;
		const gateTask = budgetTask ?? firstDelegationTask;
		// Ticket 40: session-level root cumulative soft/hard gate. Soft warns;
		// hard refuses new paid delegations. Reviewer stays exempt so Tasks can close.
		// Never kills the current root turn or session — only the launch gate fires.
		if (role !== "reviewer" && this.getSessionRootUsage) {
			const evaluation = evaluateSessionRootBudget(this.getSessionRootUsage(), this.sessionRootBudgetConfig);
			const launchModel = resolved?.model ?? requested.model;
			if (evaluation.level === "hard") {
				if (this.delegationRateKind(launchModel) !== "free") {
					if (input && typeof input === "object" && !Array.isArray(input)) {
						delete (input as Record<string, unknown>).usageBudget;
						delete (input as Record<string, unknown>).__floorLimits;
					}
					return { block: { reason: formatSessionRootBudgetRefusal(evaluation) } };
				}
				warnings.push(formatSessionRootBudgetStatus(evaluation));
			} else if (evaluation.level === "soft") {
				warnings.push(formatSessionRootBudgetSoftWarning(evaluation));
			}
		}
		const untrustedTaskId = target?.task?.taskId ?? target?.taskId ?? spec?.taskId;
		// Reviewer stays exempt: an unreadable ledger must not prevent closing the Task.
		if (role !== "reviewer" && untrustedTaskId && this.untrustedBalances.has(untrustedTaskId)) {
			if (input && typeof input === "object" && !Array.isArray(input)) {
				delete (input as Record<string, unknown>).usageBudget;
				delete (input as Record<string, unknown>).__floorLimits;
			}
			return { block: { reason: this.untrustedLedgerRefusal(untrustedTaskId) } };
		}
		const cumulativeBudget = (gateTask?.spec as unknown as { cumulativeBudget?: unknown } | undefined)?.cumulativeBudget;
		// Reviewer does not reserve or consume the balance gate; exhausted Tasks must still be closable.
		if (role !== "reviewer" && gateTask?.usage && cumulativeBudget && typeof cumulativeBudget === "object") {
			const budget = summarizeTaskBudget(gateTask.usage, cumulativeBudget as Parameters<typeof summarizeTaskBudget>[1]);
			const reservation = this.reservations.reserve(gateTask.taskId, budget, {
				toolCallId: event.toolCallId,
				...(floorLimits?.tokens ? { tokens: floorLimits.tokens.value } : {}),
				...(floorLimits?.costUsd ? { costUsd: floorLimits.costUsd.value } : {}),
			});
			if (reservation.refused) {
				if (input && typeof input === "object" && !Array.isArray(input)) {
					delete (input as Record<string, unknown>).usageBudget;
					delete (input as Record<string, unknown>).__floorLimits;
				}
				return { block: { reason: this.cumulativeBudgetRefusal(gateTask.taskId, budget, reservation.refused) } };
			}
			floorLimits = resolveEffectiveLimits({
				role,
				reportsCount: gateTask.reports.length,
				callerToolBudget: inputRecord.toolBudget,
				callerUsageBudget: inputRecord.usageBudget,
				taskSpecBudget: spec?.budget,
				balanceTokens: reservation.grant?.tokens,
				balanceCostUsd: reservation.grant?.costUsd,
			});
			const usageBudget = inputRecord.usageBudget && typeof inputRecord.usageBudget === "object" && !Array.isArray(inputRecord.usageBudget)
				? structuredClone(inputRecord.usageBudget) as Record<string, unknown>
				: {};
			if (floorLimits.tokens) {
				const existingTokens = usageBudget.tokens && typeof usageBudget.tokens === "object" && !Array.isArray(usageBudget.tokens)
					? usageBudget.tokens as Record<string, unknown>
					: {};
				usageBudget.tokens = { ...existingTokens, hard: floorLimits.tokens.value };
			}
			if (floorLimits.costUsd) {
				const existingCostUsd = usageBudget.costUsd && typeof usageBudget.costUsd === "object" && !Array.isArray(usageBudget.costUsd)
					? usageBudget.costUsd as Record<string, unknown>
					: {};
				usageBudget.costUsd = { ...existingCostUsd, hard: floorLimits.costUsd.value };
			}
			if (floorLimits.tokens || floorLimits.costUsd) inputRecord.usageBudget = usageBudget;
		}
		const floorSummary = floorLimits ? formatFloorLimitsSummary(floorLimits) : undefined;
		const oracleConflict = oracleSuiteConflict || inputRecord.__oracleSuiteConflict === true;
		if (oracleConflict) {
			warnings.push(ORACLE_SUITE_CONFLICT_WARNING);
		}
		stripDelegationKeys(input);
		if (contextOverridden) {
			warnings.push(
				"Planner-only: context 'fork' overridden to 'fresh' (worker/validator default to isolated fresh context; specify reuse in TaskSpec or packet)",
			);
		}
		if (reuseOutcome && !reuseOutcome.reused && reuseOutcome.reason) {
			warnings.push(
				`Planner-only: context reuse request rejected (${reuseOutcome.reason}); started with fresh context.`,
			);
		}

		const prompt = delegationPrompt(input);
		const specDetails = extractTaskSpecDetails(prompt, cwd);
		if (target?.role !== "reviewer" && specDetails.hasCharacteristics && !specDetails.spec) {
			// R01 — the refusal shares the Policy example renderer: still no Task,
			// no child, but the reason carries a validating TaskSpec JSON built
			// from the invalid candidate's own fields.
			return {
				block: {
					reason: appendTaskSpecRepair(
						[
							`Planner-only guard: embedded TaskSpec is invalid (${specDetails.errors.join("; ")}).`,
							"Embed a valid TaskSpec JSON in the subagent task prompt.",
						].join("\n"),
						buildTaskSpecRepair({
							toolName: "subagent",
							input: event.input,
							cwd,
							submitted: specDetails.candidate as Record<string, unknown> | undefined,
						}),
					),
				},
			};
		}

	if (target?.role === "validator" && hasMissingRequiredValidationCommands(specDetails.spec ?? spec ?? target?.task?.spec)) {
		return { block: { reason: MISSING_VALIDATION_DEFINITION_REASON } };
	}

	// A Reviewer is an invocation over an existing Task: it must not create,
		// rebind, or transition one. R02 — key on the effective role (the stamp
		// survives the agent remap), not on the remapped target alone.
		if (role === "reviewer" && target?.role === "reviewer") {
			const taskId = target.taskId;
			if (!taskId) {
				return {
					warnings: [
						"Planner-only: reviewer delegation has no taskId. Embed a ReviewRequest or TaskSpec with the taskId so the verdict can be matched to the Task.",
					],
				};
			}
			const task = this.store.get(taskId);
			if (!task) {
				warnings.push(
					`Planner-only: reviewer delegation targets unknown task ${taskId}. Delegate the worker first, then re-delegate review.`,
				);
			}
			if (target.request && target.request.reportTaskId !== taskId) {
				warnings.push(
					`Planner-only: ReviewRequest reportTaskId ${target.request.reportTaskId} does not match task ${taskId}.`,
				);
			}
			// A reviewer begin holds no writer-conflict guard, so supersede must not
			// drop a live writable waiter beside it (ticket 01).
			if (task) {
				await this.supersedePendingDelegations(task.taskId, event.toolCallId, warnings, { protectWriters: true });
			}
			// Ticket 02 — a PASS over a truncated review packet is ineligible. Root
			// knows the packet it sent, so the truncation facts are captured here
			// and enforced when the verdict returns.
			const packet = extractReviewRequest(delegationPrompt(input));
			const packetTruncated = packet?.evidencePacket?.patchTruncated === true
				|| (packet?.evidencePacket?.patchOmittedPaths?.length ?? 0) > 0;
			const packetBinding = packet !== undefined && typeof packet.reportRevision === "number"
				? {
					reportRevision: packet.reportRevision,
					...(packet.workspaceDigest !== undefined ? { workspaceDigest: packet.workspaceDigest } : {}),
				}
				: undefined;
			this.delegations.set(event.toolCallId, {
				taskId,
				kind: "reviewer",
				launchCwd: cwd,
				asyncRequested: isAsyncInput(input),
				...(isExplicitAsyncFalse(input) ? { asyncExplicitFalse: true } : {}),
				...(inputAgent(input) ? { agent: inputAgent(input) } : {}),
				...(packetTruncated ? { packetTruncated: true } : {}),
				...(packetBinding ? { packetBinding } : {}),
				...(contextOverridden ? { contextOverridden: true } : {}),
				...(reuseOutcome?.reason ? { reuseReason: reuseOutcome.reason } : {}),
				...(floorLimits ? { floorLimits } : {}),
				...(floorSummary ? { floorSummary } : {}),
			});
			this.recordHistory(taskId, {
				toolCallId: event.toolCallId,
				role: "reviewer",
				...(roleModelPolicy.enabled ? { requested, resolved } : {}),
				...(contextOverridden ? { contextOverridden: true } : {}),
				...(reuseOutcome?.reason ? { reuseReason: reuseOutcome.reason } : {}),
				...(floorSummary ? { floorSummary } : {}),
			});
			return {
				...(task ? { task } : {}),
				...(warnings.length ? { warnings } : {}),
			};
		}

		// A Validator is an invocation over an existing Task: it must not create,
		// rebind, transition, or sample. It can run a general shell, so it is
		// writable and contends for the same write lock (FR-04).
		if (target?.role === "validator" || inferRoleFromAgent(inputAgent(input)) === "validator") {
			const reviewed = this.resolveValidatorReviewedTask(input, cwd, target);
			if (!reviewed) {
				const prompt = delegationPrompt(input);
				const specId = (target?.spec ?? extractTaskSpec(prompt))?.taskId;
				const named = promptTaskIds(prompt);
				const syntheticId = `unbound-validator-${event.toolCallId}`;
				const placeholder = specId
					?? (named.length === 1 ? named[0] : undefined)
					?? syntheticId;
				const unboundConflict = await this.refuseOrClearWriteLock(cwd, "validator", warnings);
				if (unboundConflict.conflict) {
					return { conflict: unboundConflict, ...(warnings.length ? { warnings } : {}) };
				}
				// Only the synthetic placeholder is a ghost id. specId and a
				// single named id are declared Task ids: hang usage there, even
				// when they differ from (or are missing in) the store. Never
				// copy explorer's `?? active` fallback — that would re-attribute
				// onto another cwd's Task.
				const accountingTask = placeholder === syntheticId
					? this.store.activeForCwd(cwd)
					: undefined;
				this.delegations.set(event.toolCallId, {
					taskId: placeholder,
					kind: "validator",
					launchCwd: cwd,
					...(accountingTask ? { accountingTaskId: accountingTask.taskId } : {}),
					asyncRequested: isAsyncInput(input),
					...(isExplicitAsyncFalse(input) ? { asyncExplicitFalse: true } : {}),
					...(inputAgent(input) ? { agent: inputAgent(input) } : {}),
					// An unbound validator can still run a general shell: it holds
					// the write lock for the worktree it was pointed at.
					worktrees: [normalizeWorkspaceIdentity(cwd)],
					lockedAt: this.store.now().toISOString(),
					...(contextOverridden ? { contextOverridden: true } : {}),
					...(reuseOutcome?.reason ? { reuseReason: reuseOutcome.reason } : {}),
					...(floorLimits ? { floorLimits } : {}),
					...(floorSummary ? { floorSummary } : {}),
					...(oracleConflict ? { oracleSuiteConflict: true } : {}),
				});
				this.recordHistory(placeholder, {
					toolCallId: event.toolCallId,
					role: "validator",
					...(roleModelPolicy.enabled ? { requested, resolved } : {}),
					...(contextOverridden ? { contextOverridden: true } : {}),
					...(reuseOutcome?.reason ? { reuseReason: reuseOutcome.reason } : {}),
					...(floorSummary ? { floorSummary } : {}),
				});
				warnings.push(
					"Planner-only: validator delegation names no Task under review; delegate the worker first, then re-delegate validation naming its taskId.",
				);
				return { warnings };
			}
			const specId = (target?.spec ?? extractTaskSpec(delegationPrompt(input)))?.taskId;
			if (specId && specId !== reviewed.taskId) {
				warnings.push(
					`Planner-only: validator TaskSpec id ${specId} ignored; validating task ${reviewed.taskId}`,
				);
			}
			// The validator writes in its own cwd, but the work under review is
			// also locked: collide on either (D02/D06). A lost completion notice
			// is reconciled from child-run artifacts before contending for the
			// lock, so a finished run is never mistaken for a live writer.
			await this.reconcileBeforeLock(reviewed.taskId, warnings);
			const validatorWorktrees = lockWorktreesOf(reviewed, cwd);
			const validatorConflict = await this.refuseOrClearWriteLocks(validatorWorktrees, "validator", warnings, reviewed.taskId);
			if (validatorConflict.conflict) {
				return { task: reviewed, conflict: validatorConflict, ...(warnings.length ? { warnings } : {}) };
			}
			await this.supersedePendingDelegations(reviewed.taskId, event.toolCallId, warnings);
			// E01 — a validator is auxiliary: its A_run/C_report record any
			// writes it makes without ever resetting the Worker attribution.
			const validatorSample = await captureEvidence(
				this.gitRunner,
				captureEvidenceOptionsFor(reviewed, event.toolCallId),
			);
			this.beginExecutionRecord(reviewed, event.toolCallId, "validator", validatorSample, {
				auxiliary: true,
			});
			this.delegations.set(event.toolCallId, {
				taskId: reviewed.taskId,
				kind: "validator",
				launchCwd: cwd,
				asyncRequested: isAsyncInput(input),
				...(isExplicitAsyncFalse(input) ? { asyncExplicitFalse: true } : {}),
				...(inputAgent(input) ? { agent: inputAgent(input) } : {}),
				worktrees: validatorWorktrees,
				lockedAt: this.store.now().toISOString(),
				...(contextOverridden ? { contextOverridden: true } : {}),
				...(reuseOutcome?.reason ? { reuseReason: reuseOutcome.reason } : {}),
				...(floorLimits ? { floorLimits } : {}),
				...(floorSummary ? { floorSummary } : {}),
				...(oracleConflict ? { oracleSuiteConflict: true } : {}),
			});
			this.recordHistory(reviewed.taskId, {
				toolCallId: event.toolCallId,
				role: "validator",
				...(roleModelPolicy.enabled ? { requested, resolved } : {}),
				...(contextOverridden ? { contextOverridden: true } : {}),
				...(reuseOutcome?.reason ? { reuseReason: reuseOutcome.reason } : {}),
				...(floorSummary ? { floorSummary } : {}),
			});
			return {
				task: reviewed,
				...(warnings.length ? { warnings } : {}),
			};
		}

		if (!spec) {
			const detail = `role ${role} delegated without an embedded TaskSpec; task identity, scope, acceptance criteria, and the WorkerReport contract are unverified.`;
			if (
				role === "worker"
				&& (this.structuredDelegationMode === "strict" || process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW === "1")
			) {
				return {
					block: {
						reason: [
							`Planner-only guard: ${detail}`,
							"Embed the full TaskSpec JSON in the subagent task prompt.",
							// Strict review mode outranks the structured-delegation switch:
							// when it is on, telling the parent to set
							// PI_PLANNER_ONLY_STRUCTURED_DELEGATION=warn would not lift
							// the block, so never print that hint here.
							...(process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW === "1"
								? ["Strict mode (PI_PLANNER_ONLY_REQUIRE_REVIEW=1) requires objective, scope, and acceptanceCriteria in the embedded TaskSpec."]
								: ["Set PI_PLANNER_ONLY_STRUCTURED_DELEGATION=warn to allow unstructured worker delegations."]),
						].join("\n"),
					},
				};
			}
			// Explorer is read-only and needs no writer contract; validator and
			// worker are told, but not blocked, in warn mode.
			if (role !== "explorer") warnings.push(`Planner-only: ${detail}`);
		}

		let task: TaskRecord;
		// R02 — Explorer ownership is fixed at accepted launch, before any
		// state change: a Task this invocation creates or continues is
		// standalone, an assisted Worker/Validator Task is auxiliary, and an
		// unstructured Explorer binds nothing (unbound).
		let explorerOwnership: "standalone" | "auxiliary" | "unbound" | undefined;
		if (spec) {
			// reportOnly is invocation-scoped: the persisted TaskSpec never carries
			// it, so later normal delegations do not inherit report-only leniency.
			const { reportOnly: _invocationOnly, ...persisted } = spec;
			const existing = hasGeneratedTaskId(spec) ? undefined : this.store.get(spec.taskId);
			if (existing) {
				task = existing;
				if (role === "explorer") {
					explorerOwnership = existing.standaloneExplorer ? "standalone" : "auxiliary";
				}
				this.store.bindSpec(
					existing.taskId,
					spec.taskId === existing.taskId ? persisted : { ...persisted, taskId: existing.taskId },
				);
		} else if (hasGeneratedTaskId(spec) || shouldReplaceTaskId(spec.taskId, this.store.now())) {
			const generated = this.store.nextTaskId();
			const storedSpec = { ...persisted, taskId: generated };
			// R01 — the example sentinel is never stored as an alias, so pasting
			// the same example JSON a second time starts a new Task instead of
			// rebinding to the first one.
			const alias = spec.taskId === TASKSPEC_EXAMPLE_SENTINEL || hasGeneratedTaskId(spec) ? undefined : spec.taskId;
			task = this.store.createAllocated(generated, storedSpec, alias);
			if (role === "explorer") task.standaloneExplorer = true;
			if (role === "explorer") explorerOwnership = "standalone";
			this.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);
			warnings.push(
				alias
					? `Planner-only: TaskSpec id ${spec.taskId} replaced by ${generated} (generated); ${spec.taskId} is kept as an alias`
					: `Planner-only: TaskSpec id ${spec.taskId} replaced by ${generated} (generated); the example sentinel is not stored as an alias`,
			);
		} else {
				task = this.store.create(persisted);
				if (role === "explorer") task.standaloneExplorer = true;
				if (role === "explorer") explorerOwnership = "standalone";
				this.store.bindSpec(task.taskId, persisted);
			}
			if (specDetails.titleAliasUsed) {
				task.titleAliasUsed = true;
				warnings.push("Planner-only: TaskSpec used 'title' as alias for 'objective'");
			}
		} else {
			const named = target?.namedTaskIds ?? [];
			const liveNamed = target?.task && canRebindNamedTask(target.task.state)
				? target.task
				: undefined;
			if (liveNamed) {
				task = liveNamed;
				if (role === "explorer") {
					explorerOwnership = liveNamed.standaloneExplorer ? "standalone" : "auxiliary";
				}
				// Roles with no base warning (e.g. explorer) would silently lose
				// the attachment notice, so emit it standalone in that case.
				if (warnings.length > 0) {
					warnings[warnings.length - 1] += `; attached to task ${liveNamed.taskId} named in the prompt`;
				} else {
					warnings.push(`Planner-only: attached to task ${liveNamed.taskId} named in the prompt`);
				}
			} else {
				const active = this.store.active();
				if (
					named.length === 0
					&& active
					&& active.cwd === cwd
					&& (active.state === "changes_requested" || active.state === "reviewing")
				) {
					task = active;
					if (role === "explorer") explorerOwnership = "auxiliary";
					if (warnings.length > 0) {
						warnings[warnings.length - 1] += `; attached to active task ${active.taskId}`;
					} else {
						warnings.push(`Planner-only: attached to active task ${active.taskId}`);
					}
				} else if (role === "explorer") {
					// An explorer binds to no Task: it is read-only and needs no
					// writer contract, so mirror the unbound-validator placeholder
					// instead of creating a placeholder Task for a read-only pass.
					const accountingTask = this.store.activeForCwd(cwd) ?? active;
					this.delegations.set(event.toolCallId, {
						taskId: `unbound-explorer-${event.toolCallId}`,
						kind: "explorer",
						explorerOwnership: "unbound",
						launchCwd: cwd,
						...(accountingTask ? { accountingTaskId: accountingTask.taskId } : {}),
						asyncRequested: isAsyncInput(input),
						...(isExplicitAsyncFalse(input) ? { asyncExplicitFalse: true } : {}),
						...(inputAgent(input) ? { agent: inputAgent(input) } : {}),
						...(floorLimits ? { floorLimits } : {}),
						...(floorSummary ? { floorSummary } : {}),
					});
					this.concurrency.setTaskId(event.toolCallId, `unbound-explorer-${event.toolCallId}`);
					this.recordHistory(`unbound-explorer-${event.toolCallId}`, {
						toolCallId: event.toolCallId,
						role: "explorer",
					...(roleModelPolicy.enabled ? { requested, resolved } : {}),
						...(floorSummary ? { floorSummary } : {}),
					});
					return {
						warnings: [
							...warnings,
							"Planner-only: explorer delegation is not attached to any Task; its output is returned as-is.",
						],
					};
				} else {
					task = this.store.create(createTaskSpec({
						objective: "(unspecified — parent did not embed a TaskSpec)",
						cwd,
					}));
					task.isPlaceholder = true;
					if (named.length >= 1) {
						warnings.push(
							`Planner-only: prompt names task ${named.join(", ")} but no single live Task matched`,
						);
					}
				}
			}
		}
		this.store.ensureCwd(task.taskId, cwd);
		task = this.store.require(task.taskId);
		const exampleTaskIds = [target?.taskId, spec?.taskId]
			.filter((taskId): taskId is string => taskId === TASKSPEC_EXAMPLE_SENTINEL);
		stampCanonicalTaskId(input, task.taskId, exampleTaskIds);
		this.concurrency.setTaskId(event.toolCallId, task.taskId);
		// R02 — an auxiliary Explorer never advances, supersedes, or re-samples
		// the assisted Task: parallel inspection must leave the other work's
		// lifecycle, baseline, and pending writers exactly as they are.
		const auxiliaryExplorer = role === "explorer" && explorerOwnership === "auxiliary";

		// Reconcile same-Task pending children from child-run artifacts before
		// contending for the lock: a finished run whose notice was lost is
		// consumed and recorded, never mistaken for a live writer.
		if (!auxiliaryExplorer) {
			await this.reconcileBeforeLock(task.taskId, warnings);
		}

		// FR-04 — write coordination follows actual write ability, not the
		// presence of a TaskSpec: a warn-mode unstructured worker and a
		// shell-capable validator take the same lock as a structured worker.
		const workerWorktrees = lockWorktreesOf(task);
		const conflict = await this.refuseOrClearWriteLocks(workerWorktrees, role, warnings, task.taskId);
		if (conflict.conflict) {
			return { task, conflict, ...(warnings.length ? { warnings } : {}) };
		}

		let priorLaunchFailure: string | undefined;
		if (!auxiliaryExplorer && ["planning", "changes_requested", "report-invalid", "blocked", "failed"].includes(task.state)) {
			priorLaunchFailure = task.stateReason?.startsWith("delegation launch failed:") ? task.stateReason : undefined;
			this.store.transition(task.taskId, "executing");
			if (priorLaunchFailure) {
				this.store.setStateReason(task.taskId, `retry launch succeeded; previous failure preserved: ${priorLaunchFailure}`);
			}
		}

		task = this.store.require(task.taskId);
		const executionReportOnly = inputRecord.reportOnly === true || spec?.reportOnly === true;
		const isStandaloneExplorer = role === "explorer" && explorerOwnership === "standalone";
		const executionId = resumeBinding ? `execution-${event.toolCallId}` : event.toolCallId;
		if (role !== "explorer" && !isStandaloneExplorer && this.store.baseRoundEnded(task.taskId)) {
			// A report was recorded against the current base: that review round
			// is over and the next one gets its own A.
			this.store.clearBaseEvidence(task.taskId);
			task = this.store.require(task.taskId);
		}
		let roundSample: EvidenceRef | undefined;
		if ((role !== "explorer" || isStandaloneExplorer) && !task.baseEvidence) {
			roundSample = await captureEvidence(
				this.gitRunner,
				captureEvidenceOptionsFor(task, event.toolCallId),
			);
			this.store.setBaseEvidence(task.taskId, roundSample);
		}
		// E01 — every actual execution gets its own A_run. The round base is
		// reused when it was just taken; otherwise (correction round after an
		// unparsed report, report-only rebuild) this execution starts its own
		// window, so an old round baseline can never absorb later history.
		if (role !== "reviewer") {
			const executionSample = roundSample ?? await captureEvidence(
				this.gitRunner,
				captureEvidenceOptionsFor(task, event.toolCallId),
			);
			this.beginExecutionRecord(task, executionId, role, executionSample, {
				...(executionReportOnly ? { reportOnly: true } : {}),
				// Explorer and report-only repair launches are read-only by the
				// trusted orchestration binding; reports cannot assert this later.
				...((role === "explorer" || executionReportOnly) ? { readOnly: true } : {}),
				...(role === "validator" || (role === "explorer" && !isStandaloneExplorer)
					? { auxiliary: true }
					: {}),
				...(resumeBinding ? {
					previousRunId: resumeBinding.runId,
					previousExecutionId: resumeBinding.executionId,
				} : {}),
			});
			task = this.store.require(task.taskId);
		}
		// A writable begin was gated by writerConflict above; a read-only role
		// was not, so protect live writable waiters from supersede (ticket 01).
		if (!auxiliaryExplorer) {
			await this.supersedePendingDelegations(task.taskId, event.toolCallId, warnings, isWriterRole(role) ? {} : { protectWriters: true });
		}
		const inputRec = (event.input && typeof event.input === "object" && !Array.isArray(event.input))
			? event.input as Record<string, unknown>
			: undefined;
		const reportOnly = inputRec?.reportOnly === true || spec?.reportOnly === true;
		if (reportOnly && role === "worker") {
			// Native resume cannot reduce a retained worker's tool ceiling. A
			// report-only packet therefore uses the builtin read-only agent while
			// retaining worker report semantics in Orchestration.
			inputRecord.agent = "reviewer";
		}
		this.delegations.set(event.toolCallId, {
			taskId: task.taskId,
			kind: role,
			action: hostAction,
			executionId,
			...(resumeBinding ? {
				previousRunId: resumeBinding.runId,
				previousExecutionId: resumeBinding.executionId,
			} : {}),
			...(executionReportOnly ? { readOnlyRepair: true } : {}),
			launchCwd: cwd,
			...(explorerOwnership ? { explorerOwnership } : {}),
			asyncRequested: isAsyncInput(event.input),
			...(isExplicitAsyncFalse(event.input) ? { asyncExplicitFalse: true } : {}),
			...(inputAgent(event.input) ? { agent: inputAgent(event.input) } : {}),
			// Writable invocations become the lock holder for the Task's
			// worktree; explorers hold nothing.
			...(isWriterRole(role) ? {
				worktrees: workerWorktrees,
				lockedAt: this.store.now().toISOString(),
			} : {}),
			...(contextOverridden ? { contextOverridden: true } : {}),
			...(reuseOutcome?.reason ? { reuseReason: reuseOutcome.reason } : {}),
			...(floorLimits ? { floorLimits } : {}),
			...(floorSummary ? { floorSummary } : {}),
			...(reportOnly ? { reportOnly: true } : {}),
		});
		this.recordHistory(task.taskId, {
			toolCallId: event.toolCallId,
			role,
			...(roleModelPolicy.enabled ? { requested, resolved } : {}),
			...(preflightSummary ? { preflight: preflightSummary } : {}),
			...(priorLaunchFailure ? { retryReason: priorLaunchFailure } : {}),
			...(reuseOutcome?.reason ? { reuseReason: reuseOutcome.reason } : {}),
			...(floorSummary ? { floorSummary } : {}),
		});
		return {
			task: this.store.require(task.taskId),
			...(warnings.length ? { warnings } : {}),
		};
	}

	/**
	 * §5 — first match wins: ReviewRequest.taskId; an embedded TaskSpec whose
	 * id (or alias) is an existing Task; exactly one distinct known Task named
	 * in the prompt; otherwise the active Task in this cwd with a report.
	 */
	private resolveValidatorReviewedTask(
		input: unknown,
		cwd: string,
		target: DelegationTarget | undefined,
	): TaskRecord | undefined {
		const prompt = delegationPrompt(input);
		const request = extractReviewRequest(prompt);
		const spec = target?.spec ?? extractTaskSpec(prompt);
		if (request?.taskId) return this.store.get(request.taskId);
		if (target?.taskId) {
			const namedTarget = this.store.get(target.taskId);
			if (namedTarget) return namedTarget;
		}
		if (spec?.taskId) {
			const existing = this.store.get(spec.taskId);
			if (existing) return existing;
		}
		const unique: TaskRecord[] = [];
		const seen = new Set<string>();
		for (const id of promptTaskIds(prompt)) {
			const found = this.store.get(id);
			if (found && !seen.has(found.taskId)) {
				seen.add(found.taskId);
				unique.push(found);
			}
		}
		if (unique.length === 1) return unique[0] as TaskRecord;
		const active = this.store.active();
		if (active && active.cwd === cwd && active.reports.length >= 1) return active;
		return undefined;
	}

	renderDecisionBlock(
		task: TaskRecord,
		decision: ReviewDecision,
		evidence?: string,
	): string {
		const current = this.store.require(task.taskId);
		const lines: string[] = ["[PLANNER-ONLY REVIEW STATE]"];
		lines.push(`taskId: ${task.taskId}`);
		if (current.aliases.length > 0) {
			lines.push(`aliases: ${current.aliases.join(", ")} (Root-provided id is kept as alias; canonical id is ${task.taskId})`);
		}
		lines.push(`state: ${current.state}`);
		lines.push(`round: ${current.reviewRound}/${MAX_REVIEW_ROUNDS}`);
		lines.push(`review mode: ${task.reviewMode}`);
		if (task.titleAliasUsed || current.titleAliasUsed) {
			lines.push("note: TaskSpec used 'title' as alias for 'objective'");
		}
		lines.push(`decision: ${decision.action}`);
	if (decision.failureClass) {
		lines.push(`failure: ${decision.failureClass}${decision.reasonCode ? ` (${decision.reasonCode})` : ""}`);
	}
		if (evidence) {
			const sha7 = current.baseEvidence?.finalGitRef?.slice(0, 7);
			lines.push(`evidence: ${evidence}${sha7 ? ` base ${sha7}` : ""}`);
		}
		lines.push(`reason: ${decision.reason}`);
		lines.push("");
		lines.push(...decision.guidance);
		return lines.join("\n");
	}

	/**
	 * Ticket 40 — session root budget disclosure for /planner-only status.
	 * Returns undefined when the adapter did not supply getSessionRootUsage.
	 */
	renderSessionRootBudgetStatus(): string | undefined {
		if (!this.getSessionRootUsage) return undefined;
		const evaluation = evaluateSessionRootBudget(this.getSessionRootUsage(), this.sessionRootBudgetConfig);
		return formatSessionRootBudgetStatus(evaluation);
	}

	renderTaskStatus(task: TaskRecord): string {
		const report = task.reports.at(-1);
		const latestExecution = task.executions.at(-1);
		const persistedRun = latestExecution && this.runRecords
			? this.runRecords.list().find((record) => record.taskId === task.taskId && record.executionId === latestExecution.executionId)
			: undefined;
		const persistedProvenance = persistedRun?.loadedProvenance;
		const provenanceState = persistedProvenance === undefined
			? "unknown (persisted run has no loaded provenance)"
			: this.loadedProvenance && persistedProvenance.loadedFingerprint === this.loadedProvenance.loadedFingerprint ? "same loaded build" : "different loaded build";
		const taskSpecValidationComplete = missingTaskSpecValidationCommands(task.spec, report).length === 0
			&& (task.spec?.validation?.commands?.length ?? 0) > 0;
		const prov = this.loadedProvenance;
		const provenanceLine = prov
			? `Loaded provenance: fingerprint=${prov.loadedFingerprint}; source=${prov.sourcePath}; package=${prov.packageVersion}; host=${prov.hostVersion}; subagents=${prov.subagentVersion}; session=${prov.sessionId}; workspace=${prov.workspaceId}; capabilities=${prov.capabilities.join(",")}; disk HEAD=${prov.diskHead}`
			: "Loaded provenance: unknown";
		const lines = [
			`Task: ${task.taskId}`,
			`State: ${task.state}`,
			`Worker round: ${task.reviewRound}/${MAX_REVIEW_ROUNDS}`,
			`Review mode: ${task.reviewMode}`,
			provenanceLine,
			`Persisted run provenance: ${provenanceState}`,
			...(task.recoveryBinding ? [`Recovery binding: ${task.recoveryBinding.status}; ${task.recoveryBinding.reason}`] : []),
			...(isExecutingStale(task) ? [`Lock: stale (executing for over ${executingStaleMinutes()} minutes; the child has not been confirmed exited — reconcile or abandon before writing)`] : []),
			`Evidence: ${report ? (task.lastComparison ? describeComparison(task.lastComparison) : "not compared") : task.rawReport ? "raw report retained; Root verdict is available" : "no report yet"}`,
			...(task.rawReport ? [`Raw report: retained from execution ${task.rawReport.executionId}; ${task.rawReport.error}`] : []),
			...(isExplicitlyNoValidation(task.spec) ? ["Validation: not required (TaskSpec 明确不要求验证)"] : []),
			...(report && !isExplicitlyNoValidation(task.spec) && lastWorkerValidationPassed(report) && task.lastComparison?.fresh === true && taskSpecValidationComplete ? ["Validation: passed"] : []),
			`Changed files: ${report?.changedFiles.length ?? 0}`,
			...(this.snapshots?.writeErrorFor(task.taskId) ? ["Ledger write: 本会话无法写入该 taskId 的账本（writeErrorFor）"] : []),
			...(task.validatorReports.length > 0 ? [`Validator reports: ${task.validatorReports.length}`] : []),
		];
		if (task.aliases.length > 0) {
			lines.push(`aliases: ${task.aliases.join(", ")} (Root-provided id is kept as alias; canonical id is ${task.taskId})`);
		}
		if (task.state === "blocked") {
			lines.push(
				"Blocked lifecycle: still accepts Root planner_verdict; late child receipts are parked into history only (no reopen); abandon → failed is allowed.",
			);
			if (task.sealedAt) lines.push(`Sealed at: ${task.sealedAt}`);
		}
		if (task.stateReason) lines.push(`State reason: ${task.stateReason}`);
		if (task.reviews.length > 0) {
			lines.push(`Reviews: ${task.reviews.map((review) => `${review.verdict} (${review.source ?? "reviewer"})`).join(", ")}`);
		}
		const openFindings = task.findings.filter((finding) => finding.status === "open");
		if (openFindings.length > 0) {
			lines.push(`Evidence findings: ${openFindings.length} open`);
			for (const finding of openFindings) {
				lines.push(
					`  - ${finding.kind}: ${finding.paths.join(", ") || "revised workspace"}${
						finding.evidenceResolvedBy ? " (restore proven; review confirmation pending)" : ""
					}`,
				);
			}
		}
		if (task.executions.length > 0) {
			const attribution = task.executions.filter((execution) => !execution.auxiliary).length;
			lines.push(`Executions: ${task.executions.length} (${attribution} attribution windows)`);
		}
		if (task.recoveryAttempts > 0) {
			lines.push(`Recoveries: ${task.recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS} automatic attempts used`);
		}
		if (task.overrides.length > 0) {
			lines.push(`Overrides: ${task.overrides.length}`);
		}
		const history = this.delegationHistory.get(task.taskId) ?? [];
		const children = task.usage?.children ?? [];
		const policyEnabled = loadRoleModelPolicy().enabled;
		const delegationsToShow: Array<{ role: string; model: string; thinking: string; requested?: string; resolved?: string; actual?: string; mismatch?: boolean; failureReason?: string }> = [];
		if (history.length > 0) {
			for (const h of history) {
				const child = children.find((c) => (h.runId && c.runId === h.runId) || (h.toolCallId && c.toolCallId === h.toolCallId));
				const rawModel = child?.model ?? h.model;
				const rawThinking = child?.thinking ?? h.thinking ?? (rawModel?.includes(":") ? rawModel.slice(rawModel.lastIndexOf(":") + 1) : undefined);
				if (policyEnabled && h.resolved) {
					const actual = h.actual ?? { model: "未知", thinking: "未知" };
					delegationsToShow.push({ role: h.role, model: actual.model, thinking: actual.thinking, requested: `${h.requested?.model ?? "未指定"} (thinking: ${h.requested?.thinking ?? "未指定"})`, resolved: `${h.resolved.model} (thinking: ${h.resolved.thinking})`, actual: `${actual.model} (thinking: ${actual.thinking})`, mismatch: h.mismatch, ...(h.failureReason ? { failureReason: h.failureReason } : {}) });
				} else {
					delegationsToShow.push({ role: h.role, model: rawModel ?? "unknown", thinking: rawThinking ?? "unknown", ...(h.failureReason ? { failureReason: h.failureReason } : {}) });
				}
			}
		} else if (children.length > 0) {
			for (const c of children) {
				const rawModel = c.model;
				const rawThinking = c.thinking ?? (rawModel?.includes(":") ? rawModel.slice(rawModel.lastIndexOf(":") + 1) : undefined);
				delegationsToShow.push({ role: c.kind, model: rawModel ?? "unknown", thinking: rawThinking ?? "unknown" });
			}
		}
		if (delegationsToShow.length > 0) {
			lines.push("Delegations:");
			for (const d of delegationsToShow) {
				if (d.requested !== undefined && d.resolved !== undefined && d.actual !== undefined) {
					lines.push(`  - ${d.role}: requested=${d.requested}; resolved=${d.resolved}; actual=${d.actual}${d.mismatch ? "; 不匹配" : ""}`);
				} else {
					lines.push(`  - ${d.role}: ${d.model} (thinking: ${d.thinking})`);
				}
				if (d.failureReason) lines.push(`    launch failure: ${d.failureReason}`);
			}
		}
		const untrustedReason = this.untrustedBalances.get(task.taskId);
		if (untrustedReason) {
			lines.push("Budget: 余额不可信（账本快照无法读取，拒绝把剩余当作可信数字）");
			lines.push(`  原因: ${untrustedReason}`);
		} else if (task.usage !== undefined) {
			const budget = summarizeTaskBudget(task.usage, task.spec?.cumulativeBudget);
			const money = (value: number): string => `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(4)}`;
			// Ticket 15: part of 已用 can be debt -- an estimate charged for a child
			// whose real spend is unknown. It counts against the gate, so it is shown
			// inside 已用, but it is never shown as if it had been measured.
			const dimensionLine = (label: string, dimension: { limit?: number; known: number; unknownParts: number; debt: number; remaining?: number }, format: (value: number) => string): string => {
				const debtNote = dimension.debt > 0
					? `（其中 ${format(dimension.debt)} 是 ${dimension.unknownParts} 个未知项按授予额度估算，非实测）`
					: dimension.unknownParts > 0 ? `（不含 ${dimension.unknownParts} 个未知项）` : "";
				if (dimension.limit === undefined) return `  ${label}: 已用 ${format(dimension.known)}${debtNote}，未设累计上限，未知项 ${dimension.unknownParts} 项`;
				const overBudget = (dimension.remaining ?? 0) < 0 ? "（已超支）" : "";
				// The debt note sits on 已用, the figure it qualifies. Parked after 剩余
				// it reads as if the estimate were part of what is left.
				return `  ${label}: 已用 ${format(dimension.known)}${debtNote} / 上限 ${format(dimension.limit)}，剩余 ${format(dimension.remaining ?? 0)}，未知项 ${dimension.unknownParts} 项${overBudget}`;
			};
			// Ticket 14 clause 6 / ticket 17 clause 1: a configured limit is only a hard
			// stop where the host actually halts the child. Enforcement is an explicit
			// operator declaration (default: none), so an undeclared dimension is
			// reported as post-hoc observation instead of being read as a hard cap.
			const enforcement = loadHostEnforcement();
			const enforcementNote = (enforced: boolean): string =>
				enforced ? "；宿主在上限处强制停止" : "；宿主未强制该维度，仅事后观测";
			if (!budget.configured) {
				lines.push(`Budget: 未设累计上限（已知消耗 tokens=${budget.tokens.known}，费用 ${money(budget.costUsd.known)}；未知项 tokens ${budget.tokens.unknownParts} 项、费用 ${budget.costUsd.unknownParts} 项）`);
			} else {
				lines.push("Budget (累计):");
				if (budget.tokens.limit !== undefined) {
					lines.push(dimensionLine("tokens", budget.tokens, (value) => String(value)) + enforcementNote(enforcement.tokens));
				} else {
					lines.push(dimensionLine("tokens", budget.tokens, (value) => String(value)));
				}
				if (budget.costUsd.limit !== undefined) {
					lines.push(dimensionLine("费用", budget.costUsd, money) + enforcementNote(enforcement.costUsd));
				} else {
					lines.push(dimensionLine("费用", budget.costUsd, money));
				}
				const inFlight = this.reservations.inFlight(task.taskId);
				if (inFlight.tokens !== 0 || inFlight.costUsd !== 0) {
					const held = this.reservations.heldCount(task.taskId);
					lines.push(`  在途预留: tokens=${inFlight.tokens}, 费用 $${inFlight.costUsd.toFixed(4)}（${held} 个子进程未回执）`);
				}
				// Ticket 16-c: the stop the gate enforces must be legible here. When the
				// balance is held by in-flight children rather than spent, 剩余 still reads
				// full, so the refusal looks like a bug unless this line says otherwise.
				const stop = this.reservations.wouldRefuse(task.taskId, budget);
				if (stop) {
					const dimension = stop.dimension === "tokens" ? "tokens" : "费用";
					const unaffected = "reviewer 不受此限；status、Root 的 Verdict、已在途子进程的结算都不受影响。";
					lines.push(stop.held > 0
						? `  预算已停止（暂时）: ${dimension} 余额已被 ${this.reservations.heldCount(task.taskId)} 个在途子进程预留占满，新的受控付费委派会被拒绝；子进程回执后未用完的部分会退回。${unaffected}`
						: `  预算已停止: ${dimension} 已用满，新的受控付费委派会被拒绝。${unaffected}`);
				}
				// Root is not a delegated child: the host offers no pre-call control over it,
				// so its spend can only be counted after the fact and the overspend it has
				// already caused must be stated rather than implied by the remaining figure.
				// The overspend below is the TASK's, not necessarily Root's: a child can
				// blow the limit on its own. It is stated on this line because that is
				// where the absence of a pre-call stop is disclosed, so the attribution
				// must be spelled out rather than left to the reader.
				const overspent: string[] = [];
				if ((budget.tokens.remaining ?? 0) < 0) overspent.push(`tokens ${-(budget.tokens.remaining ?? 0)}`);
				if ((budget.costUsd.remaining ?? 0) < 0) overspent.push(`费用 ${money(-(budget.costUsd.remaining ?? 0))}`);
				lines.push(
					`  Root: 无预调用控制，Root 自身消耗只能事后计入（已计入 tokens=${budget.byRole.root?.tokens ?? 0}、费用 ${money(budget.byRole.root?.costUsd ?? 0)}）`
					+ (overspent.length > 0 ? `；本 Task 当前已超额：${overspent.join("、")}` : ""),
				);
			}
			const roles = (Object.entries(budget.byRole) as Array<[string, { calls: number; tokens: number; costUsd: number; costUnknownParts: number }]>)
				.filter(([, usage]) => usage.calls > 0)
				.sort(([left], [right]) => left === "root" ? -1 : right === "root" ? 1 : left.localeCompare(right));
			if (roles.length > 0) {
				lines.push("Budget by role:");
				for (const [role, usage] of roles) {
					const countLabel = role === "root" ? "turns" : "calls";
					const unknown = usage.costUnknownParts > 0 ? `，费用未知 ${usage.costUnknownParts} 项` : "";
					lines.push(`  - ${role}: ${usage.calls} ${countLabel}, tokens=${usage.tokens}, 费用 ${money(usage.costUsd)}${unknown}`);
				}
			}
		}
		if (this.snapshots?.isQuarantined(task.taskId)) {
			lines.push("Ledger quarantine: 本会话拒绝写入该 taskId 的账本（隔离在会话内不解除）");
		}
		return lines.join("\n");
	}

	/**
	 * §3 step 2 — why Root may not record `verdict` on `task` right now.
	 * Returns the refusal reason, or undefined when the verdict may proceed.
	 * The operator's review slash command bypasses every refusal except the
	 * terminal-state one; the `planner_verdict` tool honours them all.
	 *
	 * A live pending child blocks pass/request_changes, but never `blocked`:
	 * the escape hatch must stay open even when a completion notice was lost.
	 */
	rootVerdictRefusal(task: TaskRecord, verdict: ReviewVerdict): string | undefined {
		if (isTerminalTaskState(task.state)) {
			return `Task ${task.taskId} is already ${task.state}; verdicts are final. Start a new Task with a new TaskSpec for further work.`;
		}
		if (task.state === "completed" || (task.state !== "report-invalid" && verdict !== "blocked" && task.reports.length === 0)) {
			return `Task ${task.taskId} has no recorded WorkerReport; a pass or change request needs a report to judge.`;
		}
		if (verdict !== "blocked" && this.hasPendingDelegation(task.taskId)) {
			return `Task ${task.taskId} has a child run still pending; wait for its result before recording a verdict.`;
		}
		if (
			verdict === "pass" &&
			task.reviewMode === "fresh" &&
			!task.reviews.some((review) => (review.source ?? "reviewer") === "reviewer")
		) {
			return `Task ${task.taskId} is in fresh review mode and no reviewer ReviewResult exists yet; delegate the review first — in fresh mode Root arbitrates, it does not pre-empt.`;
		}
		if (
			verdict === "pass" &&
			process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW === "1" &&
			task.reviewMode === "fresh" &&
			(!task.lastComparison || task.lastComparison.truthPaths.length === 0)
		) {
			return `Task ${task.taskId} is in strict fresh review mode and evidence attribution paths are 0; a pass needs non-zero evidence attribution paths.`;
		}
		return undefined;
	}

	/**
	 * D07 / story 36 — a stale lock surfaces as a recorded needs-reconcile
	 * reason on the holder, written through the Task store. Every writable
	 * refuse path (Worker, bound Validator, unbound Validator) must call this;
	 * the lock itself never auto-releases.
	 */
	private noteStaleHolder(conflict: WriterConflict, againstTaskId?: string): void {
		if (!conflict.conflict || !conflict.taskId) return;
		const holder = this.store.get(conflict.taskId);
		if (!holder || holder.stateReason) return;
		if (!this.isLiveWriterStale(conflict.taskId)) return;
		this.store.setStateReason(
			holder.taskId,
			`needs reconcile: write lock held past the stale duration without a confirmed child exit (lock held against ${againstTaskId ? `task ${againstTaskId}` : "a new writer"})`,
		);
	}

	/** Stale follows the live writer's lock age, not Task.updatedAt / executing. */
	private isLiveWriterStale(taskId: string): boolean {
		const canonicalTaskId = this.store.get(taskId)?.taskId ?? taskId;
		const now = this.store.now().getTime();
		for (const record of this.delegations.values()) {
			if (record.taskId !== canonicalTaskId || !isWriterRole(record.kind)) continue;
			if (record.lockedAt) {
				const held = Date.parse(record.lockedAt);
				return Number.isFinite(held) && now - held >= EXECUTING_STALE_MS;
			}
		}
		const holder = this.store.get(taskId);
		return Boolean(holder && isHolderStale(holder, now));
	}

	/**
	 * The write-lock check every writable delegation goes through (FR-04).
	 *
	 * The lock is owned by the live writable Delegation, not by the Task's
	 * executing state: holder lookup sees pending Worker/Validator invocations
	 * even while their Task is reviewing, blocked, or otherwise not executing,
	 * and a reviewing Task with no live writer does not block. A holder whose
	 * Task reached a final state (operator abandon or completion) is a known
	 * stop and releases the lock. Timeout, cancel, and unreadable output are
	 * not stop — the record stays pending and keeps blocking.
	 */
	private writerConflict(cwd: string, role: DelegationKind): WriterConflict {
		if (!isWriterRole(role)) return { conflict: false };
		const target = normalizeWorkspaceIdentity(cwd);
		for (const record of this.delegations.values()) {
			if (!isWriterRole(record.kind)) continue;
			if (!record.worktrees?.includes(target)) continue;
			const holder = this.store.get(record.taskId);
			if (holder && isFinalTaskState(holder.state)) continue;
			return {
				conflict: true,
				taskId: record.taskId,
				reason: [
					`Planner-only guard: task ${record.taskId} already holds the write lock for ${target}.`,
					holder && this.isLiveWriterStale(record.taskId)
						? `That lock has been held for over ${executingStaleMinutes()} minutes and its child run has not been confirmed exited; reconcile the run (or abandon the task) before starting another writer.`
						: "Keep one writable invocation per worktree; even a second call on the same Task must wait.",
					"Wait for that run's result to release the lock, or delegate this one into a separate worktree.",
				].join("\n"),
			};
		}
		return { conflict: false };
	}

	/**
	 * Reconcile a conflicting worktree holder from artifacts, then refuse if
	 * a live writer remains. Used by every writable begin (Worker, bound and
	 * unbound Validator) so a finished leftover is never mistaken for a live
	 * writer, and a stale refuse always records needs-reconcile.
	 */
	private async refuseOrClearWriteLock(
		cwd: string,
		role: DelegationKind,
		warnings: string[],
		againstTaskId?: string,
	): Promise<WriterConflict> {
		let conflict = this.writerConflict(cwd, role);
		if (conflict.conflict && conflict.taskId) {
			await this.reconcileBeforeLock(conflict.taskId, warnings);
			conflict = this.writerConflict(cwd, role);
		}
		if (conflict.conflict) this.noteStaleHolder(conflict, againstTaskId);
		return conflict;
	}

	/** `refuseOrClearWriteLock` over every worktree identity the invocation would hold. */
	private async refuseOrClearWriteLocks(
		worktrees: readonly string[],
		role: DelegationKind,
		warnings: string[],
		againstTaskId?: string,
	): Promise<WriterConflict> {
		for (const worktree of worktrees) {
			const conflict = await this.refuseOrClearWriteLock(worktree, role, warnings, againstTaskId);
			if (conflict.conflict) return conflict;
		}
		return { conflict: false };
	}

	/**
	 * Consume same-Task pending children from child-run artifacts before the
	 * write lock is taken, so a finished leftover is not refused as a live writer.
	 */
	private async reconcileBeforeLock(taskId: string, warnings: string[]): Promise<void> {
		const canonicalTaskId = this.store.get(taskId)?.taskId ?? taskId;
		for (const [toolCallId, record] of [...this.delegations]) {
			if (record.taskId !== canonicalTaskId) continue;
			if (await this.reconcileDelegation(toolCallId, record)) {
				warnings.push(
					`Planner-only: the previous pending child for task ${taskId} had already finished; its saved result was consumed before this delegation started.`,
				);
			}
		}
	}

	/**
	 * The acceptance-boundary snapshot gate, shared by the Root verdict path
	 * and the Reviewer accept path so the two PASS gates cannot drift apart
	 * (tickets 02/10): the workspace snapshot is sampled over the task's
	 * verification inputs and compared with the snapshot bound to the report
	 * under review. A stale, pre-snapshot, or unknown binding is folded into
	 * the comparison as not-fresh, so the PASS cannot complete.
	 */
	private foldSnapshotBindingIntoComparison(
		task: TaskRecord,
		currentSample: EvidenceRef,
		comparison: EvidenceComparison,
		invocationId: string,
	): EvidenceComparison {
		const snapshot = captureWorkspaceSnapshot({
			cwd: task.cwd,
			taskId: task.taskId,
			invocationId,
			paths: snapshotPathsFor(task, currentSample),
		});
		const binding = compareSnapshotBinding(task.snapshot, snapshot, task.reports.length);
		if (binding.state !== "fresh" && binding.reason) {
			return {
				...comparison,
				fresh: false,
				unexplained: true,
				reasons: [...comparison.reasons, binding.reason],
			};
		}
		return comparison;
	}

	private hasPendingDelegation(taskId: string): boolean {
		const canonicalTaskId = this.store.get(taskId)?.taskId ?? taskId;
		for (const record of this.delegations.values()) {
			if (record.taskId === canonicalTaskId) return true;
		}
		return false;
	}

	/**
	 * Ticket 41 — on `blocked`, late child receipts are parked into history only.
	 * No advanceReview, no state advance. sealedAt / state === blocked is the seal.
	 */
	private parkBlockedReceipt(
		task: TaskRecord,
		toolCallId: string,
		kind: DelegationKind,
		preview: string,
	): { content: { type: "text"; text: string }[] } {
		const snippet = preview.replace(/\s+/g, " ").trim().slice(0, 120);
		this.recordHistory(task.taskId, {
			toolCallId,
			role: kind,
			floorSummary: `parked late receipt while blocked${snippet ? `: ${snippet}` : ""}`,
		});
		const reasonNote = `late ${kind} receipt ${toolCallId} parked (blocked sealed)`;
		const existing = task.stateReason ?? "";
		if (!existing.includes(reasonNote)) {
			this.store.setStateReason(
				task.taskId,
				existing ? `${existing}; ${reasonNote}` : reasonNote,
			);
		}
		return {
			content: [{
				type: "text",
				text: [
					`[PLANNER-ONLY] Late ${kind} receipt for blocked task ${task.taskId} was parked into history.`,
					"Task state was not advanced and advanceReview was not called.",
					"Root may still record planner_verdict, or abandon the task to failed.",
				].join("\n"),
			}],
		};
	}

	/** Ticket 41 — sealed blocked Tasks reject state-advancing receipt handling. */
	private isBlockedReceiptSealed(task: TaskRecord | undefined): task is TaskRecord & { state: "blocked" } {
		return Boolean(task && task.state === "blocked");
	}

	private delegationArtifactDirs(record: DelegationRecord): string[] {
		const dirs = [...this.artifactDirs()];
		if (record.asyncDir) {
			const root = tempRootFromAsyncDir(record.asyncDir);
			if (root) dirs.push(join(root, "artifacts"));
		}
		return dirs;
	}

	private resolveDelegationOutput(record: DelegationRecord): OutputResolution {
		if (record.outputRef) {
			const task = this.store.get(record.taskId);
			const trustedRoots = [
				...this.delegationArtifactDirs(record),
				...(task?.cwd ? [task.cwd] : []),
			].filter(Boolean);
			const receipt: CompletionReceipt = {
				version: 1,
				source: "reconcile",
				...(record.runId ? { runId: record.runId } : {}),
				...(record.agent ? { agent: record.agent } : {}),
				observedAt: new Date().toISOString(),
				outputState: "present",
				outputRef: record.outputRef,
			};
			return new OutputResolver({ trustedRoots }).resolve(receipt);
		}
		const text = record.runId ? readLargestRunOutput(record.asyncDir, record.runId) : undefined;
		return text === undefined
			? { kind: "pending", code: "OUTPUT_PENDING", attempted: [] }
			: { kind: "loaded", text, digest: outputDigest(text), source: "legacy-deterministic" };
	}


	/**
	 * Consume one pending Delegation whose child run is already terminal
	 * (numeric exitCode in its meta file) but whose completion notice never
	 * arrived. The saved output is fed through the normal result path, so a
	 * finished run records its WorkerReport / validator result instead of
	 * deadlocking the Task. Idempotent: the runId is marked processed first.
	 * Returns the produced response content when the delegation was consumed
	 * (also delivered for exact-id Idle recovery), undefined otherwise.
	 */
	private async reconcileDelegation(toolCallId: string, record: DelegationRecord): Promise<{ content: { type: "text"; text: string }[] } | undefined> {
		if (!record.runId || this.processedRunIds.has(record.runId)) return undefined;
		const dirs = this.delegationArtifactDirs(record);
		const agents = [...new Set([record.agent, KIND_DEFAULT_AGENTS[record.kind]]
			.filter((name): name is string => Boolean(name)))];
		let meta: ReturnType<typeof readChildMeta> = undefined;
		for (const agent of agents) {
			meta = readChildMeta(dirs, record.runId, agent);
			if (meta?.exitCode !== undefined) break;
		}
		if (!meta || meta.exitCode === undefined) return undefined;
		const task = this.store.get(record.taskId);
		const resolution = this.resolveDelegationOutput(record);
		const is403 = is403RateLimit(meta);
		const termReason = is403
			? (meta.error ?? meta.stopReason ?? "403 permission_error: five-hour usage limit")
			: `exit code ${meta.exitCode}`;
		const failure = resolution.kind !== "loaded" && (meta.exitCode !== 0 || is403)
			? {
				code: is403 ? "PROVIDER_403_RATE_LIMIT" : "EXECUTION_FAILED",
				message: meta.error ?? meta.stopReason ?? termReason,
				reason: is403 ? `provider 403 error (${termReason})` : `child execution failed with exit code ${meta.exitCode}`,
				...(is403 ? { provider: true } : {}),
			}
			: undefined;
		this.ingestCompletionReceipt({
			runId: record.runId,
			terminal: { state: meta.exitCode === 0 ? "completed" : "failed", exitCode: meta.exitCode },
			terminalSource: "host-meta",
			outputState: resolution.kind === "loaded" ? "present" : "unknown",
			...(record.outputRef ? { outputRef: record.outputRef } : {}),
			...(meta.usage !== undefined ? { usage: meta.usage } : {}),
		}, "reconcile", { resolution, ...(failure ? { failure } : {}) });
		if (resolution.kind !== "loaded") {
			if (meta.exitCode !== 0 || is403) {
				this.processedRunIds.add(record.runId);
				this.endDelegation(toolCallId);
				return {
					content: [{
						type: "text",
						text: `[PLANNER-ONLY] Run ${record.runId} for task ${record.taskId} terminated with ${is403 ? "403 rate limit" : `exit code ${meta.exitCode}`}: ${meta.error ?? meta.stopReason ?? "execution failed"}. Slot released. Task marked failed; no automatic model switch.`,
					}],
				};
			}
			return undefined;
		}
		this.processedRunIds.add(record.runId);
		this.endDelegation(toolCallId);
		const text = resolution.text;
		if (!task) {
			// Unbound Explorers never create a Task; keep the saved output.
			if (record.explorerOwnership === "unbound") {
				return { content: [{ type: "text", text }] };
			}
			return { content: [{ type: "text", text: `[PLANNER-ONLY] Run ${record.runId} finished, but its task ${record.taskId} is no longer in the store; the output was not recorded.` }] };
		}
		if (this.isBlockedReceiptSealed(task)) {
			return this.parkBlockedReceipt(task, toolCallId, record.kind, text);
		}
		if (record.kind === "validator") return await this.handleValidatorResult(task, text, record, toolCallId);
		if (record.kind === "reviewer") return await this.handleReviewerResult(task, text, record);
		if (record.kind === "explorer") {
			return this.handleExplorerResult(task, text, toolCallId, record, { content: [{ type: "text", text }] });
		}
		return await this.ingestCompletionResult(task, text, toolCallId, { delegation: record }, {
			kind: "loaded",
			text,
			digest: outputDigest(text),
			source: "reconcile",
		});
	}

	/**
	 * Reconcile pending Delegations (optionally one Task's) against child-run
	 * artifacts. Terminal runs are consumed; live or artifact-less runs stay
	 * pending. Returns how many delegations were consumed.
	 */
	async reconcilePendingDelegations(taskId?: string): Promise<number> {
		let reconciled = 0;
		// Task ids supplied by callers may be model-chosen aliases. Delegation
		// records are always keyed by the canonical Task id, so resolve once
		// before applying the filter while leaving unknown ids unmatched.
		const canonicalTaskId = taskId ? this.store.get(taskId)?.taskId ?? taskId : undefined;
		for (const [toolCallId, record] of [...this.delegations]) {
			if (canonicalTaskId && record.taskId !== canonicalTaskId) continue;
			if (await this.reconcileDelegation(toolCallId, record)) reconciled += 1;
		}
		return reconciled;
	}

	/**
	 * R02 — exact-id Idle recovery authorization, derived only from a
	 * registered pending Delegation: the exact full host run id, launched from
	 * this adapter workspace, not yet consumed. A Task id, accounting id,
	 * provider id, prefix, or caller-supplied path never authorizes; a restored
	 * Task alone never authorizes either.
	 */
	authorizedWaitId(input: unknown, cwd: string): string | undefined {
		const raw = input && typeof input === "object" ? (input as Record<string, unknown>).id : undefined;
		const id = typeof raw === "string" ? raw.trim() : "";
		if (!id) return undefined;
		const target = normalizeWorkspaceIdentity(cwd);
		for (const record of this.delegations.values()) {
			if (record.runId !== id) continue;
			if (this.processedRunIds.has(id)) return undefined;
			if (!record.launchCwd || normalizeWorkspaceIdentity(record.launchCwd) !== target) continue;
			return id;
		}
		return undefined;
	}

	/**
	 * R02 — consume one authorized pending run through the same completion
	 * path as sync results and native notices. Before and after the wait only
	 * this registered run is reconciled against its trusted saved-result
	 * location; a management-only wait response is not completion proof.
	 * Missing metadata or output reports pending/unavailable without broad
	 * scans or new Delegations.
	 */
	async recoverPendingRun(
		input: unknown,
		cwd: string,
	): Promise<{ status: "recovered" | "pending"; content?: { type: "text"; text: string }[]; reason?: string } | undefined> {
		const authorized = this.authorizedWaitId(input, cwd);
		if (!authorized) return undefined;
		for (const [toolCallId, record] of [...this.delegations]) {
			if (record.runId !== authorized) continue;
			const content = await this.reconcileDelegation(toolCallId, record);
			if (content) return { status: "recovered", content: content.content };
			const meta = readChildMeta(
				this.delegationArtifactDirs(record),
				authorized,
				record.agent ?? KIND_DEFAULT_AGENTS[record.kind],
			);
			if (meta?.exitCode !== undefined) {
				// Host meta can become terminal before the saved output is visible.
				// Keep the exact-id wait bounded while the writer flushes its artifact.
				const deadline = Date.now() + 15_000;
				while (Date.now() < deadline) {
					if (this.processedRunIds.has(authorized)) return { status: "recovered", content: [] };
					await new Promise((resolve) => setTimeout(resolve, 250));
					const recovered = await this.reconcileDelegation(toolCallId, record);
					if (recovered) return { status: "recovered", content: recovered.content };
				}
				return {
					status: "pending",
					reason: "the run is terminal but its saved output could not be delivered within the bounded grace period; retry the exact-id bg_wait or inspect the run artifacts",
				};
			}
			return {
				status: "pending",
				reason: "the registered run has not reached a terminal state yet; retry the exact-id bg_wait",
			};
		}
		return undefined;
	}

	/**
	 * A new delegation for a Task replaces that Task's leftover pending
	 * children, so a completion notice always has exactly one waiter instead
	 * of an ambiguous crowd. A superseded record whose run already finished is
	 * reconciled first (its report is kept); the rest are dropped, and a late
	 * notice for them matches nothing and records nothing.
	 *
	 * A writable waiter whose run is not known stopped is never dropped when the
	 * begin holds no writer-conflict guard (reviewer, explorer): the child may
	 * still be writing, and supersede is the last thing that could release the
	 * write lock beside a live writer (ticket 01, stories 9/19). Writable begins
	 * are already gated by writerConflict, so they supersede as before.
	 */
	private async supersedePendingDelegations(
		taskId: string,
		keepToolCallId: string,
		warnings: string[],
		options: { protectWriters?: boolean } = {},
	): Promise<void> {
		for (const [toolCallId, record] of [...this.delegations]) {
			if (toolCallId === keepToolCallId || record.taskId !== taskId) continue;
			if (await this.reconcileDelegation(toolCallId, record)) {
				warnings.push(
					`Planner-only: the previous pending child for task ${taskId} had already finished; its saved result was consumed before this delegation started.`,
				);
				continue;
			}
			if (options.protectWriters && isWriterRole(record.kind)) {
				// Mirror writerConflict's known-stop semantics: operator abandon or
				// another final Task state is a confirmed stop and releases the
				// waiter; anything else (including an unbound placeholder holder)
				// keeps the lock (ticket 01, stories 12/15/19).
				const holder = this.store.get(record.taskId);
				if (!holder || !isFinalTaskState(holder.state)) {
					warnings.push(
						`Planner-only: the pending child run ${record.runId ?? toolCallId} for task ${taskId} is not known stopped; it keeps the write lock and is not superseded. Reconcile or abandon the Task before re-delegating writes.`,
					);
					continue;
				}
			}
			this.endDelegation(toolCallId);
			warnings.push(
				`Planner-only: this re-delegation supersedes the pending child run ${record.runId ?? toolCallId} for task ${taskId}; a late notice for it will be ignored.`,
			);
		}
	}

	/**
	 * Record Root's verdict.
	 *
	 * A `pass` is not trusted from stored state: the workspace is sampled again
	 * right here, at the acceptance boundary, and compared with the latest
	 * WorkerReport. Freshness proved when the worker returned says nothing
	 * about freshness now (§P0-3), and a reviewer's `evidenceFresh` flag never
	 * overrides this check.
	 */
	async recordRootVerdict(
		task: TaskRecord,
		verdict: ReviewVerdict,
		summary: string,
		options: { findings?: ReviewFinding[]; source?: ReviewResult["source"]; acknowledgeDrift?: ReviewResult["acknowledgeDrift"] } = {},
	): Promise<RootVerdictOutcome> {
		// A finished child run whose notice was lost must be consumed before any
		// verdict, so the newest WorkerReport is what Root actually judges.
		await this.reconcilePendingDelegations(task.taskId);

		// §12 — an override is Root disagreeing with a *reviewer*; Root revising
		// its own earlier verdict (or the operator's) is not one.
		const previous = task.reviews.at(-1);
		if (previous && previous.verdict !== verdict && (previous.source ?? "reviewer") === "reviewer") {
			this.store.recordOverride(task.taskId, {
				reviewerVerdict: previous.verdict,
				rootVerdict: verdict,
				reason: summary,
			});
		}

		if (task.state === "blocked" || task.state === "failed") {
			this.store.transition(task.taskId, "reviewing");
		}

		const current = this.store.require(task.taskId);
		const report = current.reports.at(-1);
		let comparison = current.lastComparison;
		let evidence: string | undefined;

		if (verdict === "pass" && report) {
			const currentSample = await captureEvidence(
				this.gitRunner,
				captureEvidenceOptionsFor(current, report.evidence.workerRunId, {
					...(current.baseEvidence?.finalGitRef
						? { baseGitRef: current.baseEvidence.finalGitRef }
						: {}),
				}),
			);
			comparison = compareWithRootSamples(current, currentSample, report);
			// Ticket 10 — acceptance compares the workspace snapshot digest, not
			// HEAD/status hashes. Unknown or stale bindings refuse the PASS.
			comparison = this.foldSnapshotBindingIntoComparison(
				current,
				currentSample,
				comparison,
				`verdict-${report.evidence.workerRunId}`,
			);
			// E01 — freshness of the bound C_report and surviving findings.
			comparison = await this.augmentExecutionEvidence(current, currentSample, comparison);
			comparison = { ...comparison, environmentFailure: environmentFailureOf(currentSample) };
			comparison = this.preparePassFindings(current, comparison) ?? comparison;
			this.store.setLastComparison(current.taskId, comparison);
			evidence = describeComparison(comparison);
		}

		const review: ReviewResult = {
			taskId: task.taskId,
			verdict,
			summary,
			findings: options.findings ?? [],
			evidenceFresh: comparison ? comparison.fresh : true,
			...(report ? { reportRevision: current.reports.length, reportSource: "worker" as const } : current.rawReport ? { reportRevision: current.reports.length + 1, reportSource: "raw-judged" as const } : {}),
			...(options.acknowledgeDrift ? { acknowledgeDrift: options.acknowledgeDrift } : {}),
			...(options.source ? { source: options.source } : {}),
		};
		this.store.recordReview(task.taskId, review);
		const latest = this.store.require(task.taskId);
		const { decision } = advanceReview({
			store: this.store,
			taskId: task.taskId,
			...(latest.reports.at(-1) ? { report: latest.reports.at(-1) as WorkerReport } : {}),
			...(comparison ? { comparison } : {}),
			review,
		});
		return {
			task: this.store.require(task.taskId),
			decision,
			...(evidence ? { evidence } : {}),
		};
	}

	async handleSubagentResult(
		event: SubagentEvent,
	): Promise<{ content: { type: "text"; text: string }[] } | undefined> {
		const delegation = this.delegations.get(event.toolCallId);
		if (!delegation) return;
		const executionId = this.executionIdFor(delegation, event.toolCallId);
		let text = resultText(event);
		const interruptAcknowledged = /interrupt\s+requested/i.test(text)
			&& !hasCompletionEvidence(eventDetails(event))
			&& !eventDetails(event).terminal;
		if (interruptAcknowledged) {
			delegation.interruptRequested = true;
			return { content: [{ type: "text", text: `[PLANNER-ONLY] Interrupt requested for task ${delegation.taskId}; terminal evidence is still required before releasing the writer.` }] };
		}
		const isBudgetStop = isBudgetStopEvent(event, text);
		const stopReport = extractWorkerReport(text, { expectedTaskId: delegation.taskId }).report;
		if ((isBudgetStop && !stopReport) || (event.isError && !stopReport)) {
			// R02 — auxiliary and unbound Explorer errors only record the
			// invocation outcome; the assisted Task's lifecycle is untouched.
			if (delegation.kind === "explorer" && delegation.explorerOwnership !== "standalone") {
				this.endDelegation(event.toolCallId);
				return {
					content: [{
						type: "text",
						text: [
							`[PLANNER-ONLY] Explorer delegation for ${delegation.taskId} failed (auxiliary/unbound; no Task affected).`,
							truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
						].join("\n"),
					}],
				};
			}
			// D07 — an async child with a known runId is not confirmed stopped by
			// an error event alone. Consume a run the artifacts already show
			// terminal; otherwise keep the delegation (and its write lock) until
			// reconcile can prove the run exited. A launch that never produced a
			// run (no receipt, no runId) is a confirmed start failure and unlocks.
			if (delegation.runId && !isBudgetStop) {
				if (await this.reconcileDelegation(event.toolCallId, delegation)) {
					return {
						content: [{
							type: "text",
							text: `[PLANNER-ONLY] Run ${delegation.runId} for task ${delegation.taskId} errored after launch, but its artifacts show a terminal exit; the saved output was consumed.`,
						}],
					};
				}
				return {
					content: [{
						type: "text",
						text: [
							`[PLANNER-ONLY] Error for the async run ${delegation.runId} of task ${delegation.taskId}:`,
							truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
							"The run has not been confirmed stopped, so the write lock stays held and the task stays executing.",
							"Wait for the completion notice or the run artifacts; until then Root may record a blocked verdict.",
						].join("\n"),
					}],
				};
			}
			this.endDelegation(event.toolCallId);
			if (!isBudgetStop) this.confirmedNotLaunchedIds.add(event.toolCallId);
			const task = this.store.get(delegation.taskId);
			if (this.isBlockedReceiptSealed(task)) {
				return this.parkBlockedReceipt(task, event.toolCallId, delegation.kind, text);
			}
			const firstLine = (text.split(/\r?\n/, 1)[0] ?? "").trim();
			if (task && !isFinalTaskState(task.state)) {
				this.store.transition(task.taskId, "failed");
				this.store.setStateReason(task.taskId, isBudgetStop ? `subagent stopped: ${firstLine || "budget limit reached"}` : `delegation launch failed: ${firstLine}`);
			}
			if (task) {
				const failureReason = isBudgetStop ? `subagent stopped: ${firstLine || "budget limit reached"}` : `delegation launch failed: ${firstLine}`;
				const historyEntry = this.delegationHistory.get(task.taskId)?.find((entry) => entry.toolCallId === event.toolCallId);
				if (historyEntry) historyEntry.failureReason = failureReason;
				this.updateRunRecord(task, executionId, {
					executionState: "launch-failed",
					ingestionState: "unavailable",
					lastError: { code: isBudgetStop ? "LAUNCH_STOPPED" : "LAUNCH_FAILED", message: firstLine || "delegation launch failed" },
				});
			}
			const limitsLine = delegation.floorSummary ? `Limits: ${delegation.floorSummary}\n` : "";
			let outputText = [
				isBudgetStop
					? `[PLANNER-ONLY] Subagent for task ${delegation.taskId} stopped: ${firstLine || "budget limit reached"}.`
					: `[PLANNER-ONLY] Delegation for task ${delegation.taskId} failed to launch.`,
				limitsLine,
				truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
				isBudgetStop ? "" : "Fix the delegation input and re-delegate with the same TaskSpec.",
			].filter(Boolean).join("\n");
			if (task?.isPlaceholder) {
				outputText = `[PLANNER-ONLY] Placeholder task ${task.taskId} created (parent did not embed a TaskSpec; canonical id: ${task.taskId}).\n${outputText}`;
			}
			outputText = prependOracleSuiteConflict(outputText, delegation);
			return {
				content: [{
					type: "text",
					text: outputText,
				}],
			};
		}
		if (isAsyncLaunchReceipt(event, delegation)) {
			const runId = runIdFromReceipt(event) ?? delegation.runId;
			const asyncDir = detailString(eventDetails(event), "asyncDir");
			if (runId) {
				delegation.runId = runId;
				const historyList = this.delegationHistory.get(delegation.taskId);
				const entry = historyList?.find((d) => d.toolCallId === event.toolCallId);
				if (entry) entry.runId = runId;
			}
			if (asyncDir) delegation.asyncDir = asyncDir;
			const task = this.store.get(delegation.taskId);
			if (task) {
				this.updateRunRecord(task, executionId, {
					executionState: "running",
					...(runId ? { runId } : {}),
					...(normalizeCompletionReceipt(event.details, "sync")?.outputRef
						? { outputRef: normalizeCompletionReceipt(event.details, "sync")?.outputRef }
						: {}),
				});
				this.store.completeExecution(task.taskId, executionId, {
					...(runId ? { runId } : {}),
				});
			}
			const targetId = task?.taskId ?? delegation.taskId;
			const runIdGuide = runId
				? ` (runId: ${runId}). Await the run result with bg_wait id=${runId}; bg_wait without an id may report empty briefly after launch.`
				: `. Await the run result with bg_wait; note that bg_wait without an id may report empty briefly after launch.`;
			const baseText = `[PLANNER-ONLY] Async delegation for task ${targetId} has started${runIdGuide}`;
			const text = task?.isPlaceholder
				? `[PLANNER-ONLY] Placeholder task ${task.taskId} created (parent did not embed a TaskSpec; canonical id: ${task.taskId}).\n${baseText}`
				: baseText;
			return {
				content: [{
					type: "text",
					text: prependOracleSuiteConflict(text, delegation),
				}],
			};
		}
		const completion = normalizeCompletionReceipt(event.details, "sync");
		if (completion?.runId) delegation.runId = completion.runId;
		if (completion?.outputRef) delegation.outputRef = completion.outputRef;
		if (completion?.inlineOutput !== undefined) {
			text = completion.inlineOutput;
		} else if (completion?.outputRef) {
			const resolution = this.resolveDelegationOutput(delegation);
			if (resolution.kind !== "loaded") {
				const task = this.store.get(delegation.taskId);
				if (task) {
					this.markRunTerminal(task, executionId, completion.terminal?.state ?? "completion received", completion?.terminalSource ?? "report-only");
					this.markRunIngestion(task, executionId, resolution);
				}
				return {
					content: [{ type: "text", text: `[PLANNER-ONLY] Output for task ${delegation.taskId} is ${resolution.code}; complete output remains recoverable through planner_recover.` }],
				};
			}
			text = resolution.text;
		}
		this.endDelegation(event.toolCallId);
		const receiptId = runIdFromReceipt(event);
		if (receiptId) {
			delegation.runId = receiptId;
		}
		if (receiptId) {
			this.processedRunIds.add(receiptId);
			const historyList = this.delegationHistory.get(delegation.taskId);
			const entry = historyList?.find((d) => d.toolCallId === event.toolCallId);
			if (entry) entry.runId = receiptId;
		}
		if (delegation.runId) this.processedRunIds.add(delegation.runId);

		const task = this.store.get(delegation.taskId);
		if (task) {
			this.markRunTerminal(task, executionId, undefined, completion?.terminalSource ?? "report-only");
			this.store.completeExecution(task.taskId, executionId, {
				...(receiptId ? { runId: receiptId } : {}),
			});
		}
		if (this.isBlockedReceiptSealed(task)) {
			return this.parkBlockedReceipt(task, event.toolCallId, delegation.kind, text);
		}

		if (delegation.kind === "explorer") {
			return await this.handleExplorerResult(task, text, event.toolCallId, delegation, { content: [{ type: "text", text }] });
		}

		if (!task) {
			return {
				content: [{
					type: "text",
					text: [
						`[PLANNER-ONLY] Delegation for task ${delegation.taskId} returned, but that task is no longer in the Task store.`,
						"Nothing was recorded. Re-delegate the work with an embedded TaskSpec.",
					].join("\n"),
				}],
			};
		}

		return delegation.kind === "reviewer"
			? this.handleReviewerResult(task, text, delegation)
			: delegation.kind === "validator"
				? this.handleValidatorResult(task, text, delegation, event.toolCallId)
			: this.ingestCompletionResult(task, text, executionId, { delegation }, {
				kind: "loaded",
				text,
				digest: outputDigest(text),
				source: "sync",
			});
	}

	async handleAsyncNotify(
		content: string,
	): Promise<{ content: { type: "text"; text: string }[] } | undefined> {
		const parsed = parseSubagentNotify(content);
		if (!parsed) return;
		let outcome: { content: { type: "text"; text: string }[] } | undefined;
		const outcomes: { content: { type: "text"; text: string }[] }[] = [];
		for (const found of this.matchAsyncDelegations(parsed)) {
			if (outcome) {
				outcomes.push(outcome);
				outcome = undefined;
			}
			const runId = found.record.runId;
			// The notification envelope is the trusted terminal signal; the
			// report-shaped preview below is payload only.
			this.ingestCompletionReceipt({
				runId,
				terminal: { state: parsed.status },
				terminalSource: "host-notify",
				outputState: found.record.outputRef ? "present" : "unknown",
				...(found.record.outputRef ? { outputRef: found.record.outputRef } : {}),
			}, "notify");
			const executionId = this.executionIdFor(found.record, found.toolCallId);
			const resolution = this.resolveDelegationOutput(found.record);
			const hasExplicitReference = Boolean(found.record.outputRef);
			if (hasExplicitReference && resolution.kind !== "loaded") {
				const is403 = is403RateLimit(parsed.status) || is403RateLimit(parsed.preview);
				if (is403) {
					if (runId) this.processedRunIds.add(runId);
					this.ingestCompletionReceipt({
						runId,
						terminal: { state: parsed.status },
						terminalSource: "host-notify",
						outputState: "unknown",
					}, "notify", {
						resolution,
						failure: {
							code: "PROVIDER_403_RATE_LIMIT",
							message: parsed.preview || "provider 403 error",
							reason: "provider 403 error",
							provider: true,
						},
					});
					this.endDelegation(found.toolCallId);
					outcome = { content: [{ type: "text", text: `[PLANNER-ONLY] Subagent for task ${found.record.taskId} terminated with 403 error. Slot released. Task marked failed; no automatic model switch.` }] };
					continue;
				}
				this.ingestCompletionReceipt({
					runId,
					terminal: { state: parsed.status },
					terminalSource: "host-notify",
					outputState: "unknown",
				}, "notify", { resolution });
				outcome = { content: [{ type: "text", text: `[PLANNER-ONLY] Output for task ${found.record.taskId} is ${resolution.code}; retry the same completion or run reconcile.` }] };
				continue;
			}
			// A truncated host preview is evidence that the final body was not
			// delivered. Keep the registered run available for a later receipt or
			// planner_recover; treating the preview as a report would spend a
			// correction and make the missing output unrecoverable.
			if (found.record.kind === "worker" && !hasExplicitReference && parsed.truncated && resolution.kind !== "loaded") {
				this.ingestCompletionReceipt({
					runId,
					terminal: { state: parsed.status },
					terminalSource: "host-notify",
					outputState: "unknown",
				}, "notify", {
					resolution: { kind: "pending", code: "OUTPUT_PENDING", attempted: ["notify:preview-truncated"] },
				});
				outcome = { content: [{ type: "text", text: `[PLANNER-ONLY] Output for task ${found.record.taskId} is OUTPUT_PENDING because the notification preview was truncated; report-only correction remains available after the complete output arrives (async preview truncated).` }] };
				continue;
			}

			if (runId) this.processedRunIds.add(runId);
			this.endDelegation(found.toolCallId);
			const fileText = resolution.kind === "loaded" ? resolution.text : undefined;
			const chosen = fileText ?? parsed.preview;

			const sealedTask = this.store.get(found.record.taskId);
			if (this.isBlockedReceiptSealed(sealedTask)) {
				outcome = this.parkBlockedReceipt(sealedTask, found.toolCallId, found.record.kind, chosen);
				continue;
			}

			const isExplorerInvocation = found.record.kind === "explorer";
			const isStandaloneExplorer = isExplorerInvocation && found.record.explorerOwnership === "standalone";
			// R02 — auxiliary/unbound Explorer notices never touch a Task; a
			// stop only records that invocation's outcome.
			if (isExplorerInvocation && !isStandaloneExplorer) {
				outcome = { content: [{ type: "text", text: chosen }] };
				continue;
			}

			const isBudgetOrStopped = parsed.status === "stopped"
				|| chosen.toLowerCase().includes("toolbudget")
				|| chosen.toLowerCase().includes("usagebudget");
			const is403 = is403RateLimit(chosen) || is403RateLimit(parsed.status);
			if (is403 && !extractWorkerReport(chosen, { expectedTaskId: found.record.taskId }).report) {
				const task = this.store.get(found.record.taskId);
				const firstLine = (chosen.split(/\r?\n/, 1)[0] ?? "").trim();
				const reason = `provider 403 error (${firstLine || "five-hour usage limit"})`;
				this.ingestCompletionReceipt({
					runId,
					terminal: { state: parsed.status },
					terminalSource: "host-notify",
					outputState: "unknown",
				}, "notify", {
					resolution: { kind: "unavailable", code: "OUTPUT_UNAVAILABLE", attempted: ["notify"] },
					failure: {
						code: "PROVIDER_403_RATE_LIMIT",
						message: firstLine || "provider 403 error",
						reason,
						provider: true,
					},
				});
				outcome = {
					content: [{
						type: "text",
						text: `[PLANNER-ONLY] Subagent for task ${found.record.taskId} stopped with 403 error: ${chosen}. Slot released. Task marked failed; no automatic model switch.`,
					}],
				};
				continue;
			}
			if (isBudgetOrStopped && !extractWorkerReport(chosen, { expectedTaskId: found.record.taskId }).report) {
				const task = this.store.get(found.record.taskId);
				if (task && !isFinalTaskState(task.state)) {
					this.store.transition(task.taskId, "failed");
					this.store.setStateReason(task.taskId, `subagent stopped (${parsed.status}): ${chosen.split(/\r?\n/, 1)[0] ?? ""}`);
				}
				const limitsLine = found.record.floorSummary ? `\nLimits: ${found.record.floorSummary}` : "";
				outcome = {
					content: [{
						type: "text",
						text: `[PLANNER-ONLY] Subagent for task ${found.record.taskId} stopped (${parsed.status}): ${chosen}${limitsLine}`,
					}],
				};
				continue;
			}

			const task = this.store.get(found.record.taskId);
			if (!task) continue;

			if (found.record.kind === "reviewer") {
				outcome = await this.handleReviewerResult(task, chosen, found.record);
				continue;
			}
			if (found.record.kind === "validator") {
				outcome = await this.handleValidatorResult(task, chosen, found.record, found.toolCallId);
				continue;
			}
			if (isStandaloneExplorer) {
				outcome = await this.handleStandaloneExplorerResult(task, chosen, found.toolCallId, found.record);
				continue;
			}

			const truncatedWithoutFile = !fileText &&
				(parsed.truncated || chosen.includes(PREVIEW_TRUNCATED_MARKER));
			if (truncatedWithoutFile) {
				outcome = await this.ingestCompletionResult(task, chosen, found.toolCallId, {
					forceReportError: ASYNC_PREVIEW_TRUNCATED_REASON,
					delegation: found.record,
				}, {
					kind: "loaded",
					text: chosen,
					digest: outputDigest(chosen),
					source: "notify",
				});
				continue;
			}
				outcome = await this.ingestCompletionResult(task, chosen, executionId, {
					delegation: found.record,
				}, {
					kind: "loaded",
					text: chosen,
					digest: outputDigest(chosen),
					source: "notify",
				});
		}
		if (outcome) outcomes.push(outcome);
		if (outcomes.length === 0) return undefined;
		return {
			content: outcomes.flatMap((item) => item.content),
		};
	}

	/**
	 * Resolve which pending async delegations a `subagent-notify` notice
	 * answers. pi-subagents only prints `Child runs:` for workflow children, so
	 * a single-run notice is matched by the WorkerReport's own `taskId`, then
	 * by agent name when that leaves exactly one candidate. Ambiguity yields no
	 * match: the notice is left untouched rather than attributed by guess.
	 */
	private matchAsyncDelegations(parsed: {
		runIds: readonly string[];
		agent: string;
		taskIdHint?: string;
	}): { toolCallId: string; record: DelegationRecord }[] {
		const pending = [...this.delegations]
			.map(([toolCallId, record]) => ({ toolCallId, record }))
			.filter(({ record }) => record.runId && !this.processedRunIds.has(record.runId));

		const byRunId = parsed.runIds
			.map((runId) => pending.find(({ record }) => record.runId === runId))
			.filter((found): found is { toolCallId: string; record: DelegationRecord } => Boolean(found));
		// An explicit run identity is authoritative. Unknown or already-consumed
		// run ids are orphan receipts, never permission to fall back by agent.
		if (parsed.runIds.length > 0) return byRunId;

		if (parsed.taskIdHint) {
			// A worker echoes the id it was delegated, which may be a model-chosen
			// alias; resolve it through the store before comparing.
			const hintId = this.store.get(parsed.taskIdHint)?.taskId ?? parsed.taskIdHint;
			const byTask = pending.filter(({ record }) => record.taskId === hintId);
			// An explicit Task identity that is unknown, consumed, or foreign is
			// also authoritative. In particular, do not route an old notice to a
			// newer same-agent Task.
			return byTask.length === 1 ? byTask : [];
		}

		const agent = parsed.agent.trim().toLowerCase();
		const byAgent = pending.filter(({ record }) => {
			const recordAgent = (record.agent ?? KIND_DEFAULT_AGENTS[record.kind])?.toLowerCase();
			return !recordAgent || !agent || recordAgent === agent;
		});
		return byAgent.length === 1 ? byAgent : [];
	}

	private async handleReviewerResult(
		task: TaskRecord,
		text: string,
		record?: DelegationRecord,
	): Promise<{ content: { type: "text"; text: string }[] }> {
		const extracted = extractReviewResult(text);
		if (!extracted.review) {
			return {
				content: [{
					type: "text",
					text: [
						`[PLANNER-ONLY] Reviewer output for task ${task.taskId} is not a valid ReviewResult.`,
						extracted.error ?? "no ReviewResult found",
						"Do not accept it. Re-delegate review with the required ReviewResult JSON shape.",
						"",
						truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
					].join("\n"),
				}],
			};
		}

		let review: ReviewResult = { ...extracted.review, source: "reviewer" };
		const identityErrors = validateReviewResultIdentity(review, task.taskId);
		if (identityErrors.length > 0) {
			return {
				content: [{
					type: "text",
					text: [
						`[PLANNER-ONLY] Reviewer verdict was rejected: ${identityErrors.join("; ")}.`,
						"The verdict was not recorded and no task state changed.",
						`Re-delegate review for task ${task.taskId} with a ReviewResult whose taskId is ${task.taskId}.`,
						"",
						truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
					].join("\n"),
				}],
			};
		}

		// Ticket 02 — a PASS needs a WorkerReport to bind to. Without one there
		// is no report revision and no snapshot digest to name.
		if (review.verdict === "pass" && task.reports.length === 0) {
			return {
				content: [{
					type: "text",
					text: [
						`[PLANNER-ONLY] Reviewer verdict was rejected: task ${task.taskId} has no recorded WorkerReport; a pass needs a report revision and a workspace snapshot digest to bind to.`,
						"The verdict was not recorded and no task state changed.",
						`Delegate the worker for task ${task.taskId} first, then re-delegate review.`,
						"",
						truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
					].join("\n"),
				}],
			};
		}

		// FR-03 / D09 — the verdict is bound to the report revision and the
		// workspace snapshot digest it reviewed. A stale PASS cannot complete a
		// Task that has a newer report. Ticket 27/32: omitted bindings are filled
		// from the ReviewRequest this reviewer was shown (persisted on the
		// DelegationRecord); validation still compares against the Task at
		// record time. A missing packet is not filled from record-time values.
		const currentBinding = {
			reportRevision: task.reports.length,
			...(task.snapshot ? { workspaceDigest: task.snapshot.digest } : {}),
		};
		const packetBinding = record?.packetBinding;
		const hasPacketBinding = packetBinding !== undefined
			&& typeof packetBinding.reportRevision === "number";
		const boundReview = hasPacketBinding
			? bindReviewResultFromRequest(review, packetBinding)
			: review;
		const bindingErrors = validateReviewResultBinding(boundReview, currentBinding);
		if (bindingErrors.length > 0) {
			return {
				content: [{
					type: "text",
					text: [
						`[PLANNER-ONLY] Reviewer verdict was rejected: ${bindingErrors.join("; ")}.`,
						"The verdict was not recorded and no task state changed.",
						hasPacketBinding
							? `Re-delegate review for task ${task.taskId} so the reviewer receives the current ReviewRequest.`
							: `This delegation carries no usable ReviewRequest binding, so omitted bindings were not filled. Re-delegate review for task ${task.taskId} so the reviewer receives the current ReviewRequest.`,
						"",
						truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
					].join("\n"),
				}],
			};
		}
		review = boundReview;

		// Ticket 02 — a truncated or path-omitted packet means the reviewer did
		// not see the full diff against the Task baseline: accepting such a PASS
		// would be cheaper than Root's own verdict. request_changes and blocked
		// still record over a partial packet.
		if (review.verdict === "pass" && record?.packetTruncated) {
			return {
				content: [{
					type: "text",
					text: [
						`[PLANNER-ONLY] Reviewer verdict was rejected: the review packet for task ${task.taskId} was truncated (patchTruncated or omitted patch paths); a pass over a partial packet is not eligible.`,
						"The verdict was not recorded and no task state changed.",
						"Re-delegate review with a complete packet, or return request_changes or blocked for the partial evidence.",
						"",
						truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
					].join("\n"),
				}],
			};
		}

		const report = task.reports.at(-1);
		let comparison: EvidenceComparison | undefined;
		if (report) {
			const currentSample = await captureEvidence(
				this.gitRunner,
				captureEvidenceOptionsFor(task, report.evidence.workerRunId, {
					...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
				}),
			);
			comparison = compareWithRootSamples(task, currentSample, report);
			// E01 — the reviewer re-samples the workspace: the bound C_report
			// must still match it, independently of the content snapshot.
			comparison = await this.augmentExecutionEvidence(this.store.require(task.taskId), currentSample, comparison);
			comparison = { ...comparison, environmentFailure: environmentFailureOf(currentSample) };
			if (review.verdict === "pass") {
				comparison = this.preparePassFindings(task, comparison) ?? comparison;
				// Ticket 02 / story 26 — accept re-samples the workspace. A PASS
				// whose digest does not match (or is unknown / pre-snapshot) is
				// refused the same way a truncated packet is: not recorded, Task
				// state unchanged. request_changes and blocked still record.
				const snapshot = captureWorkspaceSnapshot({
					cwd: task.cwd,
					taskId: task.taskId,
					invocationId: `review-${report.evidence.workerRunId}`,
					paths: snapshotPathsFor(task, currentSample),
				});
				const binding = compareSnapshotBinding(task.snapshot, snapshot, task.reports.length);
				const successorAttribution = Boolean((comparison as EvidenceComparison & { supersession?: unknown } | undefined)?.supersession);
				if (binding.state !== "fresh" && !successorAttribution) {
					const reason = binding.reason ?? "the workspace snapshot at accept time is not fresh";
					return {
						content: [{
							type: "text",
							text: [
								`[PLANNER-ONLY] Reviewer verdict was rejected: ${reason}.`,
								"The verdict was not recorded and no task state changed.",
								`Re-delegate review for task ${task.taskId} after the workspace matches the bound snapshot, or return request_changes or blocked.`,
								"",
								truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
							].join("\n"),
						}],
					};
				}
				// E01 — post-report drift, open findings, and missing material are
				// folded into the comparison above: the review is recorded, but
				// the decision is revalidate/blocked, never accept. A PASS over
				// them is not eligible.
			}
		}

		this.store.recordReview(task.taskId, review);
		if (comparison) this.store.setLastComparison(task.taskId, comparison);
		const { decision } = advanceReview({
			store: this.store,
			taskId: task.taskId,
			...(report ? { report } : {}),
			...(comparison ? { comparison } : {}),
			review,
		});
		return {
			content: [{
				type: "text",
				text: [
					this.renderDecisionBlock(task, decision, comparison ? describeComparison(comparison) : undefined),
					...(record?.floorSummary ? [`Limits: ${record.floorSummary}`] : []),
					"",
					`[FRESH REVIEWER] verdict: ${review.verdict} (evidenceFresh: ${review.evidenceFresh})`,
					review.summary,
					"",
					...summarizeFindings(review.findings),
				].join("\n"),
			}],
		};
	}

	private async ingestCompletionResult(
		task: TaskRecord,
		text: string,
		executionId: string,
		options: { forceReportError?: string; delegation?: DelegationRecord } = {},
		resolution: Extract<OutputResolution, { kind: "loaded" }> = {
			kind: "loaded",
			text,
			digest: outputDigest(text),
			source: "result",
		},
	): Promise<{ content: { type: "text"; text: string }[] }> {
		const current = this.runRecords?.get(this.runSessionId, this.runWorkspaceIdFor(task), executionId);
		const expectedWorkerRunId = options.delegation?.action === "execution"
			? options.delegation.runId ?? executionId
			: executionId;
		const canJournalReport = !options.forceReportError && Boolean(extractWorkerReport(text, {
			expectedTaskId: task.taskId,
			...(expectedWorkerRunId ? { expectedWorkerRunId } : {}),
		}).report);
		if (current && resolution.kind === "loaded" && canJournalReport && this.runRecords) {
			let response: { content: { type: "text"; text: string }[] } | undefined;
			await this.runRecords.commitLoadedAsync(current, resolution, async () => {
				response = await this.handleWorkerResult(task, text, executionId, options);
				return this.store.executionById(task.taskId, executionId)?.reportIndex !== undefined
					? (this.store.executionById(task.taskId, executionId)?.reportIndex ?? 0) + 1
					: this.store.get(task.taskId)?.reports.length ?? 0;
			});
			return response ?? { content: [{ type: "text", text: "" }] };
		}
		this.markRunIngestion(task, executionId, resolution);
		return this.handleWorkerResult(task, text, executionId, options);
	}

	private async handleWorkerResult(
		task: TaskRecord,
		text: string,
		toolCallId: string,
		options: { forceReportError?: string; delegation?: DelegationRecord } = {},
	): Promise<{ content: { type: "text"; text: string }[] }> {
		const expectedWorkerRunId = options.delegation?.action === "execution"
			? options.delegation.runId ?? toolCallId
			: toolCallId;
		const extracted = options.forceReportError
			? { error: options.forceReportError, repairs: [] as string[] }
			: extractWorkerReport(text, {
				expectedTaskId: task.taskId,
				...(expectedWorkerRunId ? { expectedWorkerRunId } : {}),
			});
		let report: WorkerReport | undefined;
		let compacted = false;
		let identityErrors: string[] = [];

		if (extracted.report) {
			// §P0-1 — a valid report for the wrong task is not a report.
			const identityRunId = options.delegation?.action === "execution"
				? options.delegation.runId ?? toolCallId
				: toolCallId;
			identityErrors = validateWorkerReportIdentity(extracted.report, {
				taskId: task.taskId,
				...(task.aliases.length > 0 ? { aliases: task.aliases } : {}),
				...(identityRunId ? { workerRunId: identityRunId } : {}),
			});
			if (identityErrors.length === 0) {
				const canonical = rewriteReportToCanonical(extracted.report, task, extracted.repairs);
				const result = compactWorkerReport(canonical, MAX_WORKER_REPORT_CHARS);
				report = result.report;
				compacted = result.compacted;
			}
		}

		const rawInvalid = !report
			&& extracted.level === "irreparable"
			&& !/(?:taskId|workerRunId).*(?:mismatch|must match)/i.test(extracted.error ?? "");
		const reportError = report
			? undefined
			: identityErrors.length > 0
				? `task identity rejected: ${identityErrors.join("; ")}`
				: extracted.error;

		const current = await captureEvidence(
			this.gitRunner,
			captureEvidenceOptionsFor(task, toolCallId, {
				...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
			}),
		);
		// E01 — the result-receive sample (C_report) is stored even when the
		// report cannot be parsed, so a later report-only correction still has
		// the original execution window to inherit. The window's own delta is
		// attributed without a declaration cross-check (there is no report to
		// compare), so the next execution's cumulative report is not an
		// over-report of work this Task already delivered.
		const execution = this.store.executionById(task.taskId, toolCallId);
		if (execution) this.completeExecutionSample(task, toolCallId, current);
		if (execution) {
			if (!report) {
				this.updateRunRecord(task, toolCallId, {
					executionState: "terminal",
					ingestionState: "report-invalid",
					lastError: { code: "REPORT_SCHEMA_INVALID", message: reportError ?? "invalid WorkerReport" },
				});
			}
		}
		if (!report && execution) {
			const rootsForWindow = additionalWorktreeRootsOf(task);
			const windowTruth = compareExecutionTruth(execution.aRun, current, undefined, {
				...(task.spec?.scope ? { scope: task.spec.scope } : {}),
				...(rootsForWindow ? { additionalWorktreeRoots: rootsForWindow } : {}),
			});
			this.store.completeExecution(task.taskId, toolCallId, {
				truthPaths: windowTruth.truthPaths,
				externalPaths: windowTruth.externalPaths,
			});
		}
		if (report) {
			// Bind before recording so the stored report carries Root's own
			// report-time content hashes for the acceptance-boundary comparison.
			report = bindReportToSample(report, current);
			this.store.recordReport(task.taskId, report);
			// Ticket 10 — bind the workspace snapshot that validated this report.
			const revision = this.store.require(task.taskId).reports.length;
			const snapshot = captureWorkspaceSnapshot({
				cwd: task.cwd,
				taskId: task.taskId,
				invocationId: toolCallId,
				paths: snapshotPathsFor(task, current),
			});
			if (snapshot.state === "fresh" && snapshot.digest) {
				this.store.setSnapshot(task.taskId, {
					version: 1,
					digest: snapshot.digest,
					reportRevision: revision,
					capturedAt: snapshot.capturedAt,
				});
			}
			if (execution) {
				this.updateRunRecord(task, toolCallId, {
					executionState: "terminal",
					ingestionState: "recorded",
					reportRevision: revision,
				});
			}
			if (execution) {
				this.recordReportExecutionTruth(task, execution, current, report, revision - 1);
			}
		}
		if (report && options.delegation?.kind === "worker" && task.spec?.validation.required === true && !this.automaticOracleTasks.has(task.taskId)) {
			this.automaticOracleTasks.add(task.taskId);
			this.automaticOracleDispatch?.(this.store.require(task.taskId));
		}
		let comparison = report
			? compareWithRootSamples(task, current, report, {
				...(options.delegation?.reportOnly ? { reportOnly: true } : {}),
			})
			: undefined;
		if (comparison) {
			comparison = await this.augmentExecutionEvidence(this.store.require(task.taskId), current, comparison);
			comparison = { ...comparison, environmentFailure: environmentFailureOf(current) };
		}
		if (comparison) this.store.setLastComparison(task.taskId, comparison);
		if (!report && rawInvalid) {
			const invalidTask = this.store.require(task.taskId);
			invalidTask.rawReport = {
				executionId: toolCallId,
				text: truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
				error: reportError ?? "invalid WorkerReport",
				receivedAt: this.store.now().toISOString(),
			};
			if (!isFinalTaskState(invalidTask.state) && invalidTask.state !== "report-invalid") {
				this.store.transition(invalidTask.taskId, "report-invalid");
			}
			this.store.setStateReason(invalidTask.taskId, `WorkerReport envelope is irreparable; raw output retained: ${reportError ?? "invalid WorkerReport"}`);
		}
		let decision: ReviewDecision;
		if (rawInvalid) {
			decision = {
				action: "review_pending",
				nextState: "report-invalid",
				round: this.store.require(task.taskId).reviewRound,
				consumesRound: false,
				reason: reportError ?? "invalid WorkerReport",
				guidance: ["Raw WorkerReport output was retained. Root may inspect it and record planner_verdict directly."],
			};
		} else {
			decision = advanceReview({
				store: this.store,
				taskId: task.taskId,
				...(report ? { report } : {}),
				...(reportError ? { reportError } : {}),
				...(comparison ? { comparison } : {}),
			}).decision;
		}

		if (decision.action === "report_correction") {
			const correctionTask = this.store.require(task.taskId);
			if (correctionTask.reportCorrections < 1) {
				correctionTask.reportCorrections += 1;
			}
			this.store.persist(correctionTask);
		}
		if (!report) {
			let outputText = [
				identityErrors.length > 0
					? `[PLANNER-ONLY] Worker output for task ${task.taskId} failed the task identity check.`
					: `[PLANNER-ONLY] Worker output for task ${task.taskId} is not a valid WorkerReport.`,
				reportError ?? "no WorkerReport found",
				...(options.delegation?.reuseReason
					? [`Note: context reuse fell back to fresh (${options.delegation.reuseReason}).`]
					: []),
				...(options.delegation?.contextOverridden
					? ["Note: context 'fork' was overridden to 'fresh'."]
					: []),
				...(options.delegation?.floorSummary
					? [`Limits: ${options.delegation.floorSummary}`]
					: []),
				...(identityErrors.length > 0
					? ["The report was not recorded, and no evidence was accepted from it."]
					: []),
				...(rawInvalid
					? ["The envelope is irreparable but the Task is not blocked. Root may inspect the retained raw output and record planner_verdict directly (pass, request_changes, or blocked).", "Raw judgment is available because this output was a structured but irreparable WorkerReport envelope."]
					: ["Do not accept it. Delegate exactly one report-only correction:", `"Do not modify files. Return only a valid WorkerReport for task ${task.taskId}."`,
						...(reportError === PROSE_ONLY_REPORT_ERROR && decision.action === "report_correction"
							? [`JSON only: ${workerReportShapeReminder(task.taskId)}`]
							: [])]),
				"",
				"--- worker output ---",
				truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
				...(decision.action === "blocked"
					? ["Root may still judge the last recorded report and evidence with git_audit and record planner_verdict, or re-delegate with the same TaskSpec."]
					: []),
			].join("\n");
			if (task.isPlaceholder) {
				outputText = `[PLANNER-ONLY] Placeholder task ${task.taskId} created (parent did not embed a TaskSpec; canonical id: ${task.taskId}).\n${outputText}`;
			}
			return {
				content: [{
					type: "text",
					text: outputText,
				}],
			};
		}

		const evidenceLabel = comparison
			? describeComparison(comparison)
			: current.gitAvailable === false
				? "git evidence unavailable"
				: "not compared";

		const latest = this.store.require(task.taskId);
		let outputText = [
			this.renderDecisionBlock(task, decision, evidenceLabel),
			...(options.delegation?.reuseReason
				? [`Note: context reuse fell back to fresh (${options.delegation.reuseReason}).`]
				: []),
			...(options.delegation?.contextOverridden
				? ["Note: context 'fork' was overridden to 'fresh'."]
				: []),
			...(options.delegation?.floorSummary
				? [`Limits: ${options.delegation.floorSummary}`]
				: []),
			...(extracted.repairs.length > 0
				? [`Report normalised: ${extracted.repairs.join("; ")}`]
				: []),
			...(task.titleAliasUsed || latest.titleAliasUsed
				? ["Note: TaskSpec used 'title' as alias for 'objective'."]
				: []),
			"",
			renderWorkerReport(report, {
				round: latest.reviewRound,
				maxRounds: MAX_REVIEW_ROUNDS,
				state: latest.state,
				evidence: evidenceLabel,
				reviewMode: task.reviewMode,
				workspaceDigest: latest.snapshot?.digest,
			}),
			...(compacted ? ["", "Note: the report exceeded the parent context budget and was compacted. Re-inspect details with read/grep/git_audit if needed."] : []),
		].join("\n");
		if (task.isPlaceholder) {
			outputText = `[PLANNER-ONLY] Placeholder task ${task.taskId} created (parent did not embed a TaskSpec; canonical id: ${task.taskId}).\n${outputText}`;
		}
		return {
			content: [{
				type: "text",
				text: outputText,
			}],
		};
	}

	/**
	 * R02 — resolve one Explorer result by ownership: standalone runs go
	 * through the full WorkerReport/review closure; auxiliary and unbound runs
	 * only return their output and never touch a Task.
	 */
	private async handleExplorerResult(
		task: TaskRecord | undefined,
		text: string,
		toolCallId: string,
		record: DelegationRecord | undefined,
		passthrough: { content: { type: "text"; text: string }[] },
	): Promise<{ content: { type: "text"; text: string }[] }> {
		if (!task || record?.explorerOwnership !== "standalone") return passthrough;
		return await this.handleStandaloneExplorerResult(task, text, toolCallId, record);
	}

	/**
	 * R02 — a standalone Explorer's terminal result closes like a Worker's:
	 * validated WorkerReport + bound Evidence → reviewing → Root
	 * `planner_verdict`. An unchanged workspace is a valid read-only outcome.
	 * A malformed or missing terminal report blocks the Task with a
	 * contract-repair instruction (no report-only round is auto-spent).
	 */
	private async handleStandaloneExplorerResult(
		task: TaskRecord,
		text: string,
		toolCallId: string,
		record: DelegationRecord,
	): Promise<{ content: { type: "text"; text: string }[] }> {
		const extracted = extractWorkerReport(text, {
			expectedTaskId: task.taskId,
			...(toolCallId ? { expectedWorkerRunId: toolCallId } : {}),
		});
		let identityErrors: string[] = [];
		if (extracted.report) {
			identityErrors = validateWorkerReportIdentity(extracted.report, {
				taskId: task.taskId,
				...(task.aliases.length > 0 ? { aliases: task.aliases } : {}),
				...(toolCallId ? { workerRunId: toolCallId } : {}),
			});
		}
		const rawInvalid = !extracted.report
			&& extracted.level === "irreparable"
			&& !/(?:taskId|workerRunId).*(?:mismatch|must match)/i.test(extracted.error ?? "");
		if (!extracted.report || identityErrors.length > 0) {
			// Keep the execution's C_report even for the rejected result.
			const execution = this.store.executionById(task.taskId, toolCallId);
			if (execution) {
				const current = await captureEvidence(
					this.gitRunner,
					captureEvidenceOptionsFor(task, toolCallId, {
						...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
					}),
				);
				this.completeExecutionSample(task, toolCallId, current);
			}
			const reportError = identityErrors.length > 0
				? `task identity rejected: ${identityErrors.join("; ")}`
				: extracted.error ?? "no WorkerReport found";
			if (rawInvalid) {
				const invalidTask = this.store.require(task.taskId);
				invalidTask.rawReport = {
					executionId: toolCallId,
					text: truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
					error: reportError,
					receivedAt: this.store.now().toISOString(),
				};
				if (!isFinalTaskState(invalidTask.state) && invalidTask.state !== "report-invalid") this.store.transition(invalidTask.taskId, "report-invalid");
				this.store.setStateReason(invalidTask.taskId, `standalone explorer envelope is irreparable; raw output retained: ${reportError}`);
				return {
					content: [{ type: "text", text: [
						`[PLANNER-ONLY] Standalone explorer for task ${task.taskId} returned an irreparable envelope; the Task is not blocked.`,
						reportError,
						"Root may inspect the retained raw output and record planner_verdict directly.",
						"",
						truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
					].join("\n") }],
				};
			}
			if (this.store.require(task.taskId).state !== "completed") {
				this.store.transition(task.taskId, "blocked");
				this.store.setStateReason(
					task.taskId,
					`standalone explorer returned no valid WorkerReport (${reportError}); re-delegate the same lookup with the same TaskSpec to retry`,
				);
			}
			return {
				content: [{
					type: "text",
					text: [
						`[PLANNER-ONLY] Standalone explorer for task ${task.taskId} did not return a valid WorkerReport.`,
						reportError,
						"The Task is blocked with a contract-repair instruction; the raw output is kept below for reference.",
						"Recovery: re-delegate the same lookup with the same TaskSpec (a fresh standalone run), or record planner_verdict to close the Task.",
						"",
						truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
					].join("\n"),
				}],
			};
		}
		return await this.ingestCompletionResult(task, text, toolCallId, { delegation: record }, {
			kind: "loaded",
			text,
			digest: outputDigest(text),
			source: "result",
		});
	}

	private async handleValidatorResult(
		task: TaskRecord,
		text: string,
		delegation?: DelegationRecord,
		toolCallId?: string,
	): Promise<{ content: { type: "text"; text: string }[] }> {
		// E01 — record the validator's own C_report. Any files it wrote show up
		// here and break the Worker report's freshness at the acceptance
		// boundary; they never merge into the Worker's attribution window.
		if (toolCallId) {
			const execution = this.store.executionById(task.taskId, toolCallId);
			if (execution) {
				const current = await captureEvidence(
					this.gitRunner,
					captureEvidenceOptionsFor(task, toolCallId, {
						...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
					}),
				);
				this.completeExecutionSample(task, toolCallId, current);
			}
		}
		const extracted = extractWorkerReport(text, { expectedTaskId: task.taskId });
		let report: WorkerReport | undefined;
		if (extracted.report) {
			const identityErrors = validateWorkerReportIdentity(extracted.report, {
				taskId: task.taskId,
				...(task.aliases.length > 0 ? { aliases: task.aliases } : {}),
			});
			if (identityErrors.length === 0) {
				report = rewriteReportToCanonical(extracted.report, task, extracted.repairs);
				this.store.recordValidatorReport(task.taskId, report);
			}
		}
		if (toolCallId) {
			const execution = this.store.executionById(task.taskId, toolCallId);
			if (execution) {
				this.updateRunRecord(task, toolCallId, {
					executionState: "terminal",
					ingestionState: "recorded",
					terminalReason: report ? "validator-recorded" : "judged-directly",
					terminalSource: "report-only",
					lastError: undefined,
				});
			}
		}

		if (!report) {
			let outputText = [
				`[PLANNER-ONLY] Validator output for task ${task.taskId} is not a WorkerReport; judge it directly.`,
				...(delegation?.reuseReason
					? [`Note: context reuse fell back to fresh (${delegation.reuseReason}).`]
					: []),
				...(delegation?.contextOverridden
					? ["Note: context 'fork' was overridden to 'fresh'."]
					: []),
				...(delegation?.floorSummary
					? [`Limits: ${delegation.floorSummary}`]
					: []),
				truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
			].join("\n");
			if (task.isPlaceholder) {
				outputText = `[PLANNER-ONLY] Placeholder task ${task.taskId} created (parent did not embed a TaskSpec; canonical id: ${task.taskId}).\n${outputText}`;
			}
			return {
				content: [{
					type: "text",
					text: prependOracleSuiteConflict(outputText, delegation),
				}],
			};
		}

		const passed = report.validation.filter((item) => item.status === "passed").length;
		const failed = report.validation.filter((item) => item.status === "failed").length;
		const notRun = report.validation.filter((item) => item.status === "not-run").length;
		const latest = this.store.require(task.taskId);
		let validatorOutput = [
			`[PLANNER-ONLY] Validator result for task ${task.taskId} recorded: ${report.validation.length} validation entries, ${passed} passed, ${failed} failed, ${notRun} not-run.`,
			...(delegation?.reuseReason
				? [`Note: context reuse fell back to fresh (${delegation.reuseReason}).`]
				: []),
			...(delegation?.contextOverridden
				? ["Note: context 'fork' was overridden to 'fresh'."]
				: []),
			...(delegation?.floorSummary
				? [`Limits: ${delegation.floorSummary}`]
				: []),
			...(extracted.repairs.length > 0
				? [`Report normalised: ${extracted.repairs.join("; ")}`]
				: []),
			...renderValidationResults(report.validation),
			"",
			"Verify task identity, evidence freshness, and acceptance criteria.",
			"Inspect the changed files and git state with read/grep/git_audit.",
			"Record the verdict with the planner_verdict tool: {verdict, summary, findings?}.",
			latest.reviewMode === "fresh"
				? "A fresh reviewer is expected: delegate the review first; call planner_verdict only to arbitrate its result."
				: "Root review is active; record the verdict yourself with planner_verdict.",
		].join("\n");
		if (task.isPlaceholder) {
			validatorOutput = `[PLANNER-ONLY] Placeholder task ${task.taskId} created (parent did not embed a TaskSpec; canonical id: ${task.taskId}).\n${validatorOutput}`;
		}
		return {
			content: [{
				type: "text",
				text: prependOracleSuiteConflict(validatorOutput, delegation),
			}],
		};
	}
}

function readStructuredDelegationMode(): StructuredDelegationMode {
	return (process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION ?? "")
		.trim()
		.toLowerCase() === "strict"
		? "strict"
		: DEFAULT_STRUCTURED_DELEGATION_MODE;
}
