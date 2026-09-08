/**
 * In-process Orchestration. The Pi host is an adapter; this module owns
 * Delegation launch, the Review loop, and Task memory writes.
 */

import { resolve, join } from "node:path";
import {
	captureEvidence,
	captureReviewEvidencePacket,
	compareEvidence,
	describeComparison,
	untrackedPathsOf,
} from "./evidence.ts";
import type { EvidenceComparison } from "./evidence.ts";
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
	prepareRoleDelegation,
	promptTaskIds,
	resolveDelegationTarget,
	stripDelegationKeys,
} from "./roles.ts";
import type { ContextReuseOutcome, DelegationTarget, PrepareRoleDelegationOptions } from "./roles.ts";
import { formatFloorLimitsSummary, resolveEffectiveLimits } from "./floors.ts";
import { loadRoleModelPolicy, requestedRoleModel, resolveRoleModel, compareResolvedRoleModel } from "./role-models.ts";
import type { EffectiveLimits } from "./floors.ts";
import {
	ASYNC_PREVIEW_TRUNCATED_REASON,
	PREVIEW_TRUNCATED_MARKER,
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
import {
	TaskStore,
	createTaskSpec,
	executingStaleMinutes,
	extractTaskSpec,
	extractTaskSpecDetails,
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
	MAX_REVIEW_ROUNDS,
	MAX_WORKER_REPORT_CHARS,
	canRebindNamedTask,
	isFinalTaskState,
} from "./types.ts";
import type {
	DelegationKind,
	EvidenceRef,
	ReviewFinding,
	ReviewResult,
	ReviewVerdict,
	StructuredDelegationMode,
	WorkerReport,
} from "./types.ts";

/** Worker output kept as a fallback when a report cannot be parsed at all. */
const RAW_OUTPUT_FALLBACK_CHARS = 4000;
const PROSE_ONLY_REPORT_ERROR = "worker output did not contain a WorkerReport object";
const TASK_ID_SHAPE = /^T-(\d{8})-\d{3}$/;

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

function compareWithRootSamples(
	task: TaskRecord,
	current: EvidenceRef,
	report: WorkerReport,
) {
	return compareEvidence(
		task.baseEvidence ?? missingBaseEvidence(task, current.workerRunId),
		current,
		report,
		task.spec?.scope ? { scope: task.spec.scope } : {},
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
	gitRunner: GitRunner;
	structuredDelegationMode?: StructuredDelegationMode;
	/**
	 * Where child-run artifacts (`<runId>_<agent>_meta.json`, saved outputs)
	 * live. The Pi adapter supplies session/cwd-derived directories; reconcile
	 * needs them to detect runs that finished without delivering a notice.
	 */
	artifactDirs?: () => readonly string[];
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
	/** Child agent named in the delegation input; used to match single-run notices that carry no runId. */
	agent?: string;
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
	contextOverridden?: boolean;
	reuseReason?: string;
	floorLimits?: EffectiveLimits;
	floorSummary?: string;
	/** Root prompt requested a full suite while the actual validator suite is bounded. */
	oracleSuiteConflict?: boolean;
}

export interface DelegationHistoryEntry {
	toolCallId: string;
	runId?: string;
	role: DelegationKind;
	requested?: { model?: string; thinking?: string };
	resolved?: { model: string; thinking: string };
	actual?: { model: string; thinking: string };
	model?: string;
	thinking?: string;
	mismatch?: boolean;
	contextOverridden?: boolean;
	reuseReason?: string;
	floorSummary?: string;
}

export interface DelegationOutcome {
	task?: TaskRecord;
	conflict?: WriterConflict;
	/** Set when the delegation must not launch at all. */
	block?: { reason: string };
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

export class PlannerOrchestrator {
	readonly store: TaskStore;
	readonly structuredDelegationMode: StructuredDelegationMode;
	private readonly gitRunner: GitRunner;
	private readonly artifactDirs: () => readonly string[];
	/** toolCallId -> delegated task + invocation kind. */
	private readonly delegations = new Map<string, DelegationRecord>();
	/** runIds whose subagent-notify (or sync result) has already been consumed. */
	private readonly processedRunIds = new Set<string>();
	/** taskId -> history of all delegations for that task. */
	private readonly delegationHistory = new Map<string, DelegationHistoryEntry[]>();

	private roleModelMismatchRecorded = false;
	private roleModelPolicyEnabled = false;

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
		this.store = deps.store ?? new TaskStore();
		this.gitRunner = deps.gitRunner;
		this.artifactDirs = deps.artifactDirs ?? (() => []);
		this.structuredDelegationMode =
			deps.structuredDelegationMode ?? readStructuredDelegationMode();
	}

	pendingDelegationCount(): number {
		return this.delegations.size;
	}

	getDelegation(toolCallId: string): DelegationRecord | undefined {
		return this.delegations.get(toolCallId);
	}

	listDelegations(): { toolCallId: string; record: DelegationRecord }[] {
		return [...this.delegations.entries()].map(([toolCallId, record]) => ({ toolCallId, record }));
	}

	/**
	 * Remap the child agent and, for reviewers, replace the payload with a
	 * ReviewRequest packet. Async because Root samples Git evidence for the
	 * packet: reviewer children have no `git_audit` of their own (§P1-2).
	 */
	async prepareRoleDelegation(rawInput: unknown): Promise<void> {
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
		const cwd = task?.cwd;
		if (target?.role === "reviewer" && cwd) {
			options.git = await captureReviewEvidencePacket(
				this.gitRunner,
				cwd,
				task.lastComparison,
				// The patch is bounded against the Task's start baseline, not the
				// current HEAD, so committed Task changes stay reviewable (R03).
				{ ...(task.baseEvidence?.finalGitRef ? { baselineRef: task.baseEvidence.finalGitRef } : {}) },
			);
			if (task.lastComparison) {
				options.evidence = describeComparison(task.lastComparison);
			}
		}
		prepareRoleDelegation(rawInput, lookup, options);
	}

	async beginDelegation(
		event: { toolCallId: string; input?: unknown },
		baseCwd: string,
	): Promise<DelegationOutcome> {
		const input = event.input ?? {};
		const composite = compositeWorkflowBlockReason(input);
		if (composite) {
			return { block: { reason: composite } };
		}
		const rawCwd = (input as { cwd?: unknown }).cwd;
		const cwd = typeof rawCwd === "string" && rawCwd.trim()
			? resolve(baseCwd, rawCwd.trim())
			: baseCwd;
		const inputRecord = input as Record<string, unknown>;
		const target = resolveDelegationTarget(input, (taskId) => this.store.get(taskId));
		const role = target?.role ?? "worker";
		const roleModelPolicy = loadRoleModelPolicy();
		this.roleModelPolicyEnabled = roleModelPolicy.enabled;
		if (roleModelPolicy.enabled && this.roleModelMismatchRecorded) {
			return { block: { reason: "Planner-only guard: role model policy mismatch recorded; further controlled launches are stopped." } };
		}
		const requested = requestedRoleModel(inputRecord);
		let resolved: { model: string; thinking: string } | undefined;
		if (roleModelPolicy.enabled) {
			try {
				resolved = resolveRoleModel(roleModelPolicy, role, inputRecord);
			} catch (error) {
				return { block: { reason: error instanceof Error ? error.message : String(error) } };
			}
		}
		const spec = target?.spec;
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
		const warnings: string[] = [];

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
			return {
				block: {
					reason: [
						`Planner-only guard: embedded TaskSpec is invalid (${specDetails.errors.join("; ")}).`,
						"Embed a valid TaskSpec JSON in the subagent task prompt.",
					].join("\n"),
				},
			};
		}

	if (target?.role === "validator" && hasMissingRequiredValidationCommands(specDetails.spec ?? spec ?? target?.task?.spec)) {
		return { block: { reason: MISSING_VALIDATION_DEFINITION_REASON } };
	}

	// A Reviewer is an invocation over an existing Task: it must not create,
		// rebind, or transition one.
		if (target?.role === "reviewer") {
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
			this.delegations.set(event.toolCallId, {
				taskId,
				kind: "reviewer",
				asyncRequested: isAsyncInput(input),
				...(isExplicitAsyncFalse(input) ? { asyncExplicitFalse: true } : {}),
				...(inputAgent(input) ? { agent: inputAgent(input) } : {}),
				...(packetTruncated ? { packetTruncated: true } : {}),
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
			let validatorConflict = await this.refuseOrClearWriteLock(cwd, "validator", warnings, reviewed.taskId);
			if (!validatorConflict.conflict
				&& normalizeWorkspaceIdentity(cwd) !== normalizeWorkspaceIdentity(reviewed.cwd)) {
				validatorConflict = await this.refuseOrClearWriteLock(reviewed.cwd, "validator", warnings, reviewed.taskId);
			}
			if (validatorConflict.conflict) {
				return { task: reviewed, conflict: validatorConflict, ...(warnings.length ? { warnings } : {}) };
			}
			await this.supersedePendingDelegations(reviewed.taskId, event.toolCallId, warnings);
			this.delegations.set(event.toolCallId, {
				taskId: reviewed.taskId,
				kind: "validator",
				asyncRequested: isAsyncInput(input),
				...(isExplicitAsyncFalse(input) ? { asyncExplicitFalse: true } : {}),
				...(inputAgent(input) ? { agent: inputAgent(input) } : {}),
				worktrees: [...new Set([
					normalizeWorkspaceIdentity(cwd),
					normalizeWorkspaceIdentity(reviewed.cwd),
				])],
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
		if (spec) {
			const existing = this.store.get(spec.taskId);
			if (existing) {
				task = existing;
				this.store.bindSpec(
					existing.taskId,
					spec.taskId === existing.taskId ? spec : { ...spec, taskId: existing.taskId },
				);
			} else if (shouldReplaceTaskId(spec.taskId, this.store.now())) {
				const generated = this.store.nextTaskId();
				const storedSpec = { ...spec, taskId: generated };
				task = this.store.create(storedSpec, spec.taskId);
				warnings.push(
					`Planner-only: TaskSpec id ${spec.taskId} replaced by ${generated} (generated); ${spec.taskId} is kept as an alias`,
				);
			} else {
				task = this.store.create(spec);
				this.store.bindSpec(task.taskId, spec);
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
						...(accountingTask ? { accountingTaskId: accountingTask.taskId } : {}),
						asyncRequested: isAsyncInput(input),
						...(isExplicitAsyncFalse(input) ? { asyncExplicitFalse: true } : {}),
						...(inputAgent(input) ? { agent: inputAgent(input) } : {}),
						...(floorLimits ? { floorLimits } : {}),
						...(floorSummary ? { floorSummary } : {}),
					});
					this.recordHistory(`unbound-explorer-${event.toolCallId}`, {
						toolCallId: event.toolCallId,
						role: "explorer",
					...(roleModelPolicy.enabled ? { requested, resolved } : {}),
						...(floorSummary ? { floorSummary } : {}),
					});
					return {
						warnings: [
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

		// Reconcile same-Task pending children from child-run artifacts before
		// contending for the lock: a finished run whose notice was lost is
		// consumed and recorded, never mistaken for a live writer.
		await this.reconcileBeforeLock(task.taskId, warnings);

		// FR-04 — write coordination follows actual write ability, not the
		// presence of a TaskSpec: a warn-mode unstructured worker and a
		// shell-capable validator take the same lock as a structured worker.
		const conflict = await this.refuseOrClearWriteLock(task.cwd, role, warnings, task.taskId);
		if (conflict.conflict) {
			return { task, conflict, ...(warnings.length ? { warnings } : {}) };
		}

		if (["planning", "changes_requested", "blocked", "failed"].includes(task.state)) {
			this.store.transition(task.taskId, "executing");
		}

		task = this.store.require(task.taskId);
		if (role !== "explorer" && this.store.baseRoundEnded(task.taskId)) {
			// A report was recorded against the current base: that review round
			// is over and the next one gets its own A.
			this.store.clearBaseEvidence(task.taskId);
			task = this.store.require(task.taskId);
		}
		if (role !== "explorer" && !task.baseEvidence) {
			const base: EvidenceRef = await captureEvidence(this.gitRunner, {
				cwd: task.cwd,
				taskId: task.taskId,
				workerRunId: event.toolCallId,
			});
			this.store.setBaseEvidence(task.taskId, base);
		}
		// A writable begin was gated by writerConflict above; a read-only role
		// was not, so protect live writable waiters from supersede (ticket 01).
		await this.supersedePendingDelegations(task.taskId, event.toolCallId, warnings, isWriterRole(role) ? {} : { protectWriters: true });
		this.delegations.set(event.toolCallId, {
			taskId: task.taskId,
			kind: role,
			asyncRequested: isAsyncInput(event.input),
			...(isExplicitAsyncFalse(event.input) ? { asyncExplicitFalse: true } : {}),
			...(inputAgent(event.input) ? { agent: inputAgent(event.input) } : {}),
			// Writable invocations become the lock holder for the Task's
			// worktree; explorers hold nothing.
			...(isWriterRole(role) ? {
				worktrees: [normalizeWorkspaceIdentity(task.cwd)],
				lockedAt: this.store.now().toISOString(),
			} : {}),
			...(contextOverridden ? { contextOverridden: true } : {}),
			...(reuseOutcome?.reason ? { reuseReason: reuseOutcome.reason } : {}),
			...(floorLimits ? { floorLimits } : {}),
			...(floorSummary ? { floorSummary } : {}),
		});
		this.recordHistory(task.taskId, {
			toolCallId: event.toolCallId,
			role,
			...(roleModelPolicy.enabled ? { requested, resolved } : {}),
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
		if (evidence) {
			const sha7 = current.baseEvidence?.finalGitRef?.slice(0, 7);
			lines.push(`evidence: ${evidence}${sha7 ? ` base ${sha7}` : ""}`);
		}
		lines.push(`reason: ${decision.reason}`);
		lines.push("");
		lines.push(...decision.guidance);
		return lines.join("\n");
	}

	renderTaskStatus(task: TaskRecord): string {
		const report = task.reports.at(-1);
		const taskSpecValidationComplete = missingTaskSpecValidationCommands(task.spec, report).length === 0
			&& (task.spec?.validation?.commands?.length ?? 0) > 0;
		const lines = [
			`Task: ${task.taskId}`,
			`State: ${task.state}`,
			`Worker round: ${task.reviewRound}/${MAX_REVIEW_ROUNDS}`,
			`Review mode: ${task.reviewMode}`,
			...(isExecutingStale(task) ? [`Lock: stale (executing for over ${executingStaleMinutes()} minutes; the child has not been confirmed exited — reconcile or abandon before writing)`] : []),
			`Evidence: ${report ? (task.lastComparison ? describeComparison(task.lastComparison) : "not compared") : "no report yet"}`,
			...(isExplicitlyNoValidation(task.spec) ? ["Validation: not required (TaskSpec 明确不要求验证)"] : []),
			...(report && !isExplicitlyNoValidation(task.spec) && lastWorkerValidationPassed(report) && task.lastComparison?.fresh === true && taskSpecValidationComplete ? ["Validation: passed"] : []),
			`Changed files: ${report?.changedFiles.length ?? 0}`,
			...(task.validatorReports.length > 0 ? [`Validator reports: ${task.validatorReports.length}`] : []),
		];
		if (task.aliases.length > 0) {
			lines.push(`aliases: ${task.aliases.join(", ")} (Root-provided id is kept as alias; canonical id is ${task.taskId})`);
		}
		if (task.stateReason) lines.push(`State reason: ${task.stateReason}`);
		if (task.reviews.length > 0) {
			lines.push(`Reviews: ${task.reviews.map((review) => `${review.verdict} (${review.source ?? "reviewer"})`).join(", ")}`);
		}
		if (task.overrides.length > 0) {
			lines.push(`Overrides: ${task.overrides.length}`);
		}
		const history = this.delegationHistory.get(task.taskId) ?? [];
		const children = task.usage?.children ?? [];
		const policyEnabled = loadRoleModelPolicy().enabled;
		const delegationsToShow: Array<{ role: string; model: string; thinking: string; requested?: string; resolved?: string; actual?: string; mismatch?: boolean }> = [];
		if (history.length > 0) {
			for (const h of history) {
				const child = children.find((c) => (h.runId && c.runId === h.runId) || (h.toolCallId && c.toolCallId === h.toolCallId));
				const rawModel = child?.model ?? h.model;
				const rawThinking = child?.thinking ?? h.thinking ?? (rawModel?.includes(":") ? rawModel.slice(rawModel.lastIndexOf(":") + 1) : undefined);
				if (policyEnabled && h.resolved) {
					const actual = h.actual ?? { model: "未知", thinking: "未知" };
					delegationsToShow.push({ role: h.role, model: actual.model, thinking: actual.thinking, requested: `${h.requested?.model ?? "未指定"} (thinking: ${h.requested?.thinking ?? "未指定"})`, resolved: `${h.resolved.model} (thinking: ${h.resolved.thinking})`, actual: `${actual.model} (thinking: ${actual.thinking})`, mismatch: h.mismatch });
				} else {
					delegationsToShow.push({ role: h.role, model: rawModel ?? "unknown", thinking: rawThinking ?? "unknown" });
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
			}
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
		if (task.state === "completed") {
			return `Task ${task.taskId} is already completed; verdicts are final. Start a new Task with a new TaskSpec for further work.`;
		}
		if (verdict !== "blocked" && task.reports.length === 0) {
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
		const now = this.store.now().getTime();
		for (const record of this.delegations.values()) {
			if (record.taskId !== taskId || !isWriterRole(record.kind)) continue;
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

	/**
	 * Consume same-Task pending children from child-run artifacts before the
	 * write lock is taken, so a finished leftover is not refused as a live writer.
	 */
	private async reconcileBeforeLock(taskId: string, warnings: string[]): Promise<void> {
		for (const [toolCallId, record] of [...this.delegations]) {
			if (record.taskId !== taskId) continue;
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
		for (const record of this.delegations.values()) {
			if (record.taskId === taskId) return true;
		}
		return false;
	}

	private delegationArtifactDirs(record: DelegationRecord): string[] {
		const dirs = [...this.artifactDirs()];
		if (record.asyncDir) {
			const root = tempRootFromAsyncDir(record.asyncDir);
			if (root) dirs.push(join(root, "artifacts"));
		}
		return dirs;
	}

	/**
	 * Consume one pending Delegation whose child run is already terminal
	 * (numeric exitCode in its meta file) but whose completion notice never
	 * arrived. The saved output is fed through the normal result path, so a
	 * finished run records its WorkerReport / validator result instead of
	 * deadlocking the Task. Idempotent: the runId is marked processed first.
	 * Returns true when the delegation was consumed.
	 */
	private async reconcileDelegation(toolCallId: string, record: DelegationRecord): Promise<boolean> {
		if (!record.runId || this.processedRunIds.has(record.runId)) return false;
		const dirs = this.delegationArtifactDirs(record);
		const agents = [...new Set([record.agent, KIND_DEFAULT_AGENTS[record.kind]]
			.filter((name): name is string => Boolean(name)))];
		let meta: ReturnType<typeof readChildMeta> = undefined;
		for (const agent of agents) {
			meta = readChildMeta(dirs, record.runId, agent);
			if (meta?.exitCode !== undefined) break;
		}
		if (!meta || meta.exitCode === undefined) return false;
		this.processedRunIds.add(record.runId);
		this.delegations.delete(toolCallId);
		const task = this.store.get(record.taskId);
		if (!task) return true;
		const text = readLargestRunOutput(record.asyncDir, record.runId) ?? "";
		if (record.kind === "validator") await this.handleValidatorResult(task, text, record);
		else if (record.kind === "reviewer") await this.handleReviewerResult(task, text, record);
		else if (record.kind === "explorer") { /* explorer output returned as-is */ }
		else await this.handleWorkerResult(task, text, toolCallId, { delegation: record });
		return true;
	}

	/**
	 * Reconcile pending Delegations (optionally one Task's) against child-run
	 * artifacts. Terminal runs are consumed; live or artifact-less runs stay
	 * pending. Returns how many delegations were consumed.
	 */
	async reconcilePendingDelegations(taskId?: string): Promise<number> {
		let reconciled = 0;
		for (const [toolCallId, record] of [...this.delegations]) {
			if (taskId && record.taskId !== taskId) continue;
			if (await this.reconcileDelegation(toolCallId, record)) reconciled += 1;
		}
		return reconciled;
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
			this.delegations.delete(toolCallId);
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
		options: { findings?: ReviewFinding[]; source?: ReviewResult["source"] } = {},
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
			const currentSample = await captureEvidence(this.gitRunner, {
				cwd: current.cwd,
				taskId: current.taskId,
				workerRunId: report.evidence.workerRunId,
				...(current.baseEvidence?.finalGitRef
					? { baseGitRef: current.baseEvidence.finalGitRef }
					: {}),
			});
			comparison = compareWithRootSamples(current, currentSample, report);
			// Ticket 10 — acceptance compares the workspace snapshot digest, not
			// HEAD/status hashes. Unknown or stale bindings refuse the PASS.
			comparison = this.foldSnapshotBindingIntoComparison(
				current,
				currentSample,
				comparison,
				`verdict-${report.evidence.workerRunId}`,
			);
			this.store.setLastComparison(current.taskId, comparison);
			evidence = describeComparison(comparison);
		}

		const review: ReviewResult = {
			taskId: task.taskId,
			verdict,
			summary,
			findings: options.findings ?? [],
			evidenceFresh: comparison ? comparison.fresh : true,
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
		const text = resultText(event);
		const isBudgetStop = isBudgetStopEvent(event, text);
		if (isBudgetStop || (event.isError && !extractWorkerReport(text, { expectedTaskId: delegation.taskId, expectedWorkerRunId: event.toolCallId }).report)) {
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
			this.delegations.delete(event.toolCallId);
			const task = this.store.get(delegation.taskId);
			const firstLine = (text.split(/\r?\n/, 1)[0] ?? "").trim();
			if (task && !isFinalTaskState(task.state)) {
				this.store.transition(task.taskId, "failed");
				this.store.setStateReason(task.taskId, isBudgetStop ? `subagent stopped: ${firstLine || "budget limit reached"}` : `delegation launch failed: ${firstLine}`);
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
		this.delegations.delete(event.toolCallId);
		const receiptId = runIdFromReceipt(event);
		if (receiptId) {
			this.processedRunIds.add(receiptId);
			const historyList = this.delegationHistory.get(delegation.taskId);
			const entry = historyList?.find((d) => d.toolCallId === event.toolCallId);
			if (entry) entry.runId = receiptId;
		}
		if (delegation.runId) this.processedRunIds.add(delegation.runId);

		if (delegation.kind === "explorer") {
			return { content: [{ type: "text", text }] };
		}

		const task = this.store.get(delegation.taskId);
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
				? this.handleValidatorResult(task, text, delegation)
				: this.handleWorkerResult(task, text, event.toolCallId, { delegation });
	}

	async handleAsyncNotify(
		content: string,
	): Promise<{ content: { type: "text"; text: string }[] } | undefined> {
		const parsed = parseSubagentNotify(content);
		if (!parsed) return;
		let outcome: { content: { type: "text"; text: string }[] } | undefined;
		for (const found of this.matchAsyncDelegations(parsed)) {
			const runId = found.record.runId;
			if (runId) this.processedRunIds.add(runId);
			this.delegations.delete(found.toolCallId);
			const fileText = runId ? readLargestRunOutput(found.record.asyncDir, runId) : undefined;
			const chosen = fileText ?? parsed.preview;

			if (found.record.kind === "explorer") {
				outcome = { content: [{ type: "text", text: chosen }] };
				continue;
			}

			const isBudgetOrStopped = parsed.status === "stopped"
				|| chosen.toLowerCase().includes("toolbudget")
				|| chosen.toLowerCase().includes("usagebudget");
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
				outcome = await this.handleValidatorResult(task, chosen, found.record);
				continue;
			}

			const truncatedWithoutFile = !fileText &&
				(parsed.truncated || chosen.includes(PREVIEW_TRUNCATED_MARKER));
			if (truncatedWithoutFile) {
				outcome = await this.handleWorkerResult(task, chosen, found.toolCallId, {
					forceReportError: ASYNC_PREVIEW_TRUNCATED_REASON,
					delegation: found.record,
				});
				continue;
			}
			outcome = await this.handleWorkerResult(task, chosen, found.toolCallId, { delegation: found.record });
		}
		return outcome;
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
		if (byRunId.length > 0) return byRunId;

		if (parsed.taskIdHint) {
			// A worker echoes the id it was delegated, which may be a model-chosen
			// alias; resolve it through the store before comparing.
			const hintId = this.store.get(parsed.taskIdHint)?.taskId ?? parsed.taskIdHint;
			const byTask = pending.filter(({ record }) => record.taskId === hintId);
			if (byTask.length === 1) return byTask;
			if (byTask.length > 1) return [];
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
		// Task that has a newer report. Ticket 27: omitted bindings are filled
		// from the ReviewRequest this reviewer was shown; an explicit mismatch
		// is still refused. HEAD/status hashes are not a substitute: a missing
		// bound snapshot is unknown, never a digest of porcelain.
		const expectedBinding = {
			reportRevision: task.reports.length,
			...(task.snapshot ? { workspaceDigest: task.snapshot.digest } : {}),
		};
		const boundReview = bindReviewResultFromRequest(review, expectedBinding);
		const bindingErrors = validateReviewResultBinding(boundReview, expectedBinding);
		if (bindingErrors.length > 0) {
			return {
				content: [{
					type: "text",
					text: [
						`[PLANNER-ONLY] Reviewer verdict was rejected: ${bindingErrors.join("; ")}.`,
						"The verdict was not recorded and no task state changed.",
						`Re-delegate review for task ${task.taskId} so the reviewer receives the current ReviewRequest.`,
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
			const currentSample = await captureEvidence(this.gitRunner, {
				cwd: task.cwd,
				taskId: task.taskId,
				workerRunId: report.evidence.workerRunId,
				...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
			});
			comparison = compareWithRootSamples(task, currentSample, report);
			if (review.verdict === "pass") {
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
				if (binding.state !== "fresh") {
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

	private async handleWorkerResult(
		task: TaskRecord,
		text: string,
		toolCallId: string,
		options: { forceReportError?: string; delegation?: DelegationRecord } = {},
	): Promise<{ content: { type: "text"; text: string }[] }> {
		const extracted = options.forceReportError
			? { error: options.forceReportError, repairs: [] as string[] }
			: extractWorkerReport(text, {
				expectedTaskId: task.taskId,
				...(toolCallId ? { expectedWorkerRunId: toolCallId } : {}),
			});
		let report: WorkerReport | undefined;
		let compacted = false;
		let identityErrors: string[] = [];

		if (extracted.report) {
			// §P0-1 — a valid report for the wrong task is not a report.
			identityErrors = validateWorkerReportIdentity(extracted.report, {
				taskId: task.taskId,
				...(task.aliases.length > 0 ? { aliases: task.aliases } : {}),
				...(toolCallId ? { workerRunId: toolCallId } : {}),
			});
			if (identityErrors.length === 0) {
				const canonical = rewriteReportToCanonical(extracted.report, task, extracted.repairs);
				const result = compactWorkerReport(canonical, MAX_WORKER_REPORT_CHARS);
				report = result.report;
				compacted = result.compacted;
			}
		}

		const reportError = report
			? undefined
			: identityErrors.length > 0
				? `task identity rejected: ${identityErrors.join("; ")}`
				: extracted.error;

		const current = await captureEvidence(this.gitRunner, {
			cwd: task.cwd,
			taskId: task.taskId,
			workerRunId: toolCallId,
			...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
		});
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
		}
		const comparison = report
			? compareWithRootSamples(task, current, report)
			: undefined;
		if (comparison) this.store.setLastComparison(task.taskId, comparison);
		const { decision } = advanceReview({
			store: this.store,
			taskId: task.taskId,
			...(report ? { report } : {}),
			...(reportError ? { reportError } : {}),
			...(comparison ? { comparison } : {}),
		});

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
				"Do not accept it. Delegate exactly one report-only correction:",
				`"Do not modify files. Return only a valid WorkerReport for task ${task.taskId}."`,
				...(reportError === PROSE_ONLY_REPORT_ERROR && decision.action === "report_correction"
					? [`JSON only: ${workerReportShapeReminder(task.taskId)}`]
					: []),
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

	private handleValidatorResult(
		task: TaskRecord,
		text: string,
		delegation?: DelegationRecord,
	): { content: { type: "text"; text: string }[] } {
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
