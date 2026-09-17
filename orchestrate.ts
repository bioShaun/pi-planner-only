/**
 * In-process Orchestration. The Pi host is an adapter; this module owns
 * the Review loop and Task memory writes; Delegation launch lives in
 * delegate.ts (ADR-0001).
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	captureEvidence,
	compareEvidence,
	compareExecutionTruth,
	compareFreshness,
	describeComparison,
	describeProbeFailures,
	environmentFailureOf,
	isPathInDeclaredScope,
	normalizeEvidencePaths,
	untrackedPathsOf,
} from "./evidence.ts";
import type { EvidenceComparison, FreshnessComparison } from "./evidence.ts";
import {
	captureWorkspaceSnapshot,
	compareSnapshotBinding,
} from "./workspace-snapshot.ts";
import type { GitRunner } from "./git-audit.ts";
import {
	lastWorkerValidationPassed,
	missingTaskSpecValidationCommands,
} from "./roles.ts";
import {
	evaluateSessionRootBudget,
	formatSessionRootBudgetStatus,
	loadHostEnforcement,
	loadSessionRootBudgetConfig,
} from "./floors.ts";
import type { SessionRootBudgetConfig, SessionRootSpend } from "./floors.ts";
import {
	advanceReview,
	validateReviewResultBinding,
	validateReviewResultIdentity,
} from "./review.ts";
import type { ReviewDecision } from "./review.ts";
import { LedgerSnapshotStore, SAFE_TASK_ID } from "./ledger-store.ts";
import type { LedgerCorrupt } from "./ledger-store.ts";
import {
	TaskIdAllocator,
	TaskStore,
	createTaskSpec,
	executingStaleMinutes,
	isExplicitlyNoValidation,
	isExecutingStale,
	isWriterRole,
	normalizeWorkspaceIdentity,
} from "./task.ts";
import type { TaskRecord, WriterConflict } from "./task.ts";
import {
	EXECUTING_STALE_MS,
	MAX_LEDGER_RESTORE_PER_SESSION,
	MAX_RECOVERY_ATTEMPTS,
	MAX_REVIEW_ROUNDS,
	acceptanceModeOf,
	executionNeedsWriterIsolation,
	isFinalTaskState,
	isTerminalTaskState,
} from "./types.ts";
import type {
	AcceptanceMode,
	DelegationKind,
	EvidenceRef,
	ExecutionCapability,
	ExecutionLifecycleStatus,
	GitProbeFailure,
	LoadedPluginFingerprint,
	ReviewFinding,
	ReviewResult,
	ReviewVerdict,
	RootVerdictRefusal,
	TaskExecutionRecord,
	TaskState,
	TaskCompletionKind,
	TaskRole,
	TaskSpec,
	WorkerReport,
} from "./types.ts";
import { emptyTaskUsage, exportSessionEvidence, summarizeTaskBudget } from "./usage.ts";
import type { SessionEvidenceExport } from "./usage.ts";
import { ConcurrencyController } from "./concurrency.ts";

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


function captureEvidenceOptionsFor(
	task: TaskRecord,
	workerRunId: string,
	extra: { baseGitRef?: string; truthPaths?: readonly string[] } = {},
) {
	const roots = additionalWorktreeRootsOf(task);
	const allowed = task.spec?.scope?.allowedPaths ?? [];
	const taskTruth = task.executions.flatMap((e) => e.truthPaths ?? []);
	const extraTruth = extra.truthPaths ?? [];
	const combinedScope = [...new Set([...allowed, ...taskTruth, ...extraTruth])];
	return {
		cwd: task.cwd,
		taskId: task.taskId,
		workerRunId,
		...(extra.baseGitRef ? { baseGitRef: extra.baseGitRef } : {}),
		...(roots ? { additionalWorktreeRoots: roots } : {}),
		...(combinedScope.length > 0 ? { scopePaths: combinedScope } : {}),
	};
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
	const effectiveBase: EvidenceRef = task.baseEvidence ?? (
		report.evidence.baseGitRef && report.evidence.gitAvailable !== false
			? {
				cwd: report.evidence.cwd,
				taskId: report.evidence.taskId,
				workerRunId: "inferred-base",
				baseGitRef: report.evidence.baseGitRef,
				finalGitRef: report.evidence.baseGitRef,
				changedPaths: [],
				gitAvailable: true,
				generatedAt: report.evidence.generatedAt,
			}
			: missingBaseEvidence(task, current.workerRunId)
	);
	return compareEvidence(
		effectiveBase,
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


export interface OrchestratorDeps {
	store?: TaskStore;
	/** Directory that becomes `<ledgerDir>/planner-only/ledger/<taskId>.json`. */
	ledgerDir?: string;
	gitRunner: GitRunner;
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
	/** Session-wide child execution capacity and read/write admission. */
	concurrency?: ConcurrencyController;
	/** Live usage events owned by the adapter; exported alongside restored snapshots. */
	getUsageEntries?: () => readonly unknown[];
	/** Structured delegation enforcement mode ("warn" creates placeholder tasks without spec). */
	structuredDelegationMode?: "warn" | "strict" | "enforce";
}

export type { DelegationKind };

export interface DelegationRecord {
	taskId: string;
	kind: DelegationKind;
	worktrees?: readonly string[];
	lockedAt?: string;
	runId?: string;
	asyncDir?: string;
	agent?: string;
	launchCwd?: string;
	spec?: TaskSpec;
	toolCallId: string;
	packetTruncated?: boolean;
}

export interface DelegationOutcome {
	task?: TaskRecord;
	conflict?: WriterConflict;
	block?: { code?: string; reason: string };
	warnings?: string[];
	content?: { type: string; text: string }[];
}

const RUN_ROOT_DIR_NAMES = new Set(["async-subagent-runs", "nested-subagent-runs"]);

export function tempRootFromAsyncDir(asyncDir: string): string | undefined {
	let current = resolve(asyncDir);
	for (let depth = 0; depth < 6; depth++) {
		const parent = dirname(current);
		if (parent === current) return undefined;
		if (RUN_ROOT_DIR_NAMES.has(basename(current))) return parent;
		current = parent;
	}
	return undefined;
}

export function extractWorkerReport(text: string): WorkerReport | undefined {
	if (!text || typeof text !== "string") return undefined;
	try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object" && parsed.version === 1 && typeof parsed.taskId === "string") {
			return parsed as WorkerReport;
		}
	} catch {}
	const matches = text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g);
	for (const match of matches) {
		try {
			const parsed = JSON.parse(match[1]);
			if (parsed && typeof parsed === "object" && parsed.version === 1 && typeof parsed.taskId === "string") {
				return parsed as WorkerReport;
			}
		} catch {}
	}
	const objMatch = text.match(/\{[\s\S]*"version"\s*:\s*1[\s\S]*"taskId"\s*:\s*"[^"]+"[\s\S]*\}/);
	if (objMatch) {
		try {
			const parsed = JSON.parse(objMatch[0]);
			if (parsed && typeof parsed === "object" && parsed.version === 1 && typeof parsed.taskId === "string") {
				return parsed as WorkerReport;
			}
		} catch {}
	}
	return undefined;
}


export interface RootVerdictOutcome {
	task: TaskRecord;
	decision: ReviewDecision;
	/** Evidence comparison taken at the acceptance boundary, when one ran. */
	evidence?: string;
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

/** Ticket 18 — one row of the read-only `planner_tasks` listing. */
export interface PlannerTaskSummary {
	taskId: string;
	state: TaskState;
	role: TaskRole;
	/** spec.objective, first line, truncated to 120 chars. */
	objective?: string;
	updatedAt: string;
	/** blocked + recovery.required — the next rebind must carry a RecoveryDecision. */
	recoveryRequired: boolean;
	/** memory = session store; ledger = snapshot-only record the restore cap left out. */
	source: "memory" | "ledger";
}

/** Ticket 06 — the read-only `planner_tasks` diagnostics view for one Task. */
export interface PlannerTaskDiagnostics {
	taskId: string;
	state: TaskState;
	stateReason?: string;
	acceptanceMode: AcceptanceMode;
	recovery?: { required: true; reason: string; executionId: string };
	writerHold?: { executionId: string; reason: string; since: string; active: boolean };
	reservations: { id: string; taskId?: string; capability: string; workspaces: string[] }[];
	source: "memory" | "ledger";
	reports: number;
	reviews: number;
	executions: {
		executionId: string;
		kind: DelegationKind;
		status?: ExecutionLifecycleStatus;
		capability: ExecutionCapability | "unknown";
		capabilityBasis?: string;
		runId?: string;
		cwd?: string;
		worktreeRoots?: string[];
		endedReason?: string;
		endedAt?: string;
		terminationConfirmed: boolean;
		confirmationBasis?: string;
		evidenceIncomplete?: boolean;
		reportReceived: boolean;
		reportAccepted: boolean;
		unacceptedReport?: { taskId: string; status: string; summary: string; workerRunId: string; reason: string };
		probeFailures?: GitProbeFailure[];
		guidance: string[];
	}[];
	guidance: string[];
}

export class PlannerOrchestrator {
	readonly store: TaskStore;
	private readonly gitRunner: GitRunner;
	private readonly getSessionRootUsage?: () => SessionRootSpend;
	private sessionRootBudgetConfig?: SessionRootBudgetConfig;
	private readonly concurrency: ConcurrencyController;
	private readonly getUsageEntries?: () => readonly unknown[];

	private readonly snapshots?: LedgerSnapshotStore;
	private runSessionId: string;
	private loadedProvenance?: LoadedPluginFingerprint;
	private readonly delegations = new Map<string, DelegationRecord>();
	private readonly processedRunIds = new Set<string>();
	private readonly supersededIds = new Set<string>();
	private readonly structuredDelegationMode?: "warn" | "strict" | "enforce";
	/**
	 * E01 — Tasks whose record came from the ledger. A restored record missing
	 * per-execution A_run/C_report material cannot be verified and must not
	 * complete through the automatic PASS gate; only fresh evidence from a new
	 * execution (or a new Task) recovers it.
	 */
	private readonly restoredTaskIds = new Set<string>();
	/** Per-task: snapshot unreadable, so remaining balance must not be claimed. */
	private readonly untrustedBalances = new Map<string, string>();

	constructor(deps: OrchestratorDeps) {
		this.runSessionId = process.env.PI_SESSION_ID?.trim()
			|| deps.loadedProvenance?.sessionId?.trim()
			|| "unknown-session";
		this.loadedProvenance = deps.loadedProvenance;
		if (deps.store) {
			this.store = deps.store;
		} else if (deps.ledgerDir) {
			const snapshots = new LedgerSnapshotStore(deps.ledgerDir);
			this.snapshots = snapshots;
			this.store = new TaskStore({
				allocator: new TaskIdAllocator(deps.ledgerDir),
				onPersist: (record) => snapshots.write(record),
				onRemove: (taskId) => snapshots.remove(taskId),
			});
		} else {
			this.store = new TaskStore();
		}
		this.gitRunner = deps.gitRunner;
		this.getSessionRootUsage = deps.getSessionRootUsage;
		this.sessionRootBudgetConfig = deps.sessionRootBudgetConfig
			?? (deps.getSessionRootUsage ? loadSessionRootBudgetConfig() : undefined);
		this.concurrency = deps.concurrency ?? new ConcurrencyController();
		this.getUsageEntries = deps.getUsageEntries;
		this.structuredDelegationMode = deps.structuredDelegationMode;
	}

	setLoadedProvenance(provenance: LoadedPluginFingerprint): void {
		this.loadedProvenance = { ...provenance, capabilities: [...provenance.capabilities] };
		if (this.runSessionId === "unknown-session" && provenance.sessionId.trim()
			&& provenance.sessionId.trim() !== "unknown" && provenance.sessionId.trim() !== "unknown-session") {
			this.runSessionId = provenance.sessionId.trim();
		}
	}


	getLoadedProvenance(): LoadedPluginFingerprint | undefined {
		return this.loadedProvenance ? { ...this.loadedProvenance, capabilities: [...this.loadedProvenance.capabilities] } : undefined;
	}


	private depsUsageEntries(): readonly unknown[] {
		return this.getUsageEntries?.() ?? [];
	}

	/** Export only Tasks and usage belonging to this Root session (ticket 08 K7: no run-level evidence). */
	exportEvidence(rootSessionId = this.runSessionId): SessionEvidenceExport {
		return exportSessionEvidence({
			rootSessionId,
			tasks: this.store.list(),
			usageEntries: this.depsUsageEntries(),
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


	private needsWriterIsolation(record: TaskRecord): boolean {
		return record.writerHold !== undefined || (record.executions ?? []).some((execution) =>
			["cancel_requested", "stopping", "stop_unconfirmed"].includes(execution.status ?? "")
			&& execution.terminationConfirmed !== true
			&& executionNeedsWriterIsolation(execution),
		);
	}

	private restoreRecord(record: TaskRecord): TaskRecord {
		this.store.restore(record);
		this.restoredTaskIds.add(record.taskId);
		const restored = this.store.require(record.taskId);
		// WRC P0-A — an execution whose stop was in flight when the host
		//    ended never got its confirmation; hold the workspace
		//    conservatively, same as a persisted hold.
		// Ticket 02 — the hold synthesis only applies to executions that could
		//    have mutated the workspace. A recorded restricted reader is exempt
		//    (it held no claim and could not write); an execution missing the
		//    capability field stays conservative.
		for (const execution of restored.executions) {
			const status = execution.status ?? "";
			if (status === "cancel_requested" || status === "stopping" || status === "stop_unconfirmed") {
				if (execution.terminationConfirmed !== true && !restored.writerHold && executionNeedsWriterIsolation(execution)) {
					this.store.setWriterHold(restored.taskId, {
						executionId: execution.executionId,
						reason: `stop was in flight (${status}) when the host ended; residual state unsampled`,
						since: new Date().toISOString(),
					});
					break;
				}
				if (executionNeedsWriterIsolation(execution)) break;
			}
		}
		// WRC P0-A — a persisted writer hold survives restart: re-register
		// it so workspace admission keeps refusing a second writer instead
		// of trusting a lost in-memory reservation.
		const hold = restored.writerHold;
		if (hold) {
			this.concurrency.hold({
				id: `writerhold:${hold.executionId}`,
				taskId: restored.taskId,
				role: "worker",
				capability: "writer",
				workspaces: [restored.cwd, ...(restored.spec?.additionalWorktreeRoots ?? [])],
				reservedAt: hold.since,
			});
		}
		return restored;
	}

	restoreFromLedger(): { restored: number; corrupt: LedgerCorrupt[] } {
		if (!this.snapshots) return { restored: 0, corrupt: [] };
		const { records, corrupt } = this.snapshots.readAll();
		// Cap + filter (ticket 38 / F6): empty-cwd snapshots without a TaskSpec are
		// ghost placeholders; restoring every historical Task unbounded floods the
		// session store. Restore every isolation-bearing record, then the freshest
		// ordinary records up to the soft cap.
		const sorted = records
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
			});
		const isolated = sorted.filter((record) => this.needsWriterIsolation(record));
		const eligible = [
			...isolated,
			...sorted.filter((record) => !this.needsWriterIsolation(record)).slice(0, MAX_LEDGER_RESTORE_PER_SESSION),
		];
		let restored = 0;
		for (const record of eligible) {
			if (this.store.get(record.taskId)) continue;
			this.restoreRecord(record);
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
		return { restored, corrupt };
	}

	/**
	 * Ticket 18 — live (non-final) Tasks of one workspace, from the session
	 * store *and* the ledger: the restore cap keeps only the freshest records
	 * in memory, so a live-but-aged Task may exist only on disk. An in-memory
	 * record always wins over its snapshot (memory is newer). Listing is pure
	 * — nothing is restored into the store; a later bind lazily restores by id
	 * (ticket 47). Records with an empty cwd — quarantine placeholders — are
	 * never listed (ticket 47's rule: an on-demand read is never a
	 * cross-workspace or untrusted entry point).
	 */
	listLiveTasks(cwd: string): PlannerTaskSummary[] {
		const workspace = normalizeWorkspaceIdentity(cwd);
		// "Live" here means *operable*: non-final states, plus a blocked Task
		// flagged recovery.required — final for gather, but still rebindable
		// through planner_redelegate with a RecoveryDecision. A plain blocked
		// Task (no pending recovery) is dead and stays unlisted.
		const isLiveHere = (record: TaskRecord) =>
			record.cwd !== ""
			&& (!isFinalTaskState(record.state) || (record.state === "blocked" && record.recovery?.required === true))
			&& normalizeWorkspaceIdentity(record.cwd) === workspace;
		const inMemory = this.store.list().filter(isLiveHere);
		const memoryIds = new Set(this.store.list().map((task) => task.taskId));
		const ledgerOnly: TaskRecord[] = [];
		if (this.snapshots) {
			try {
				for (const record of this.snapshots.readAll().records) {
					if (!memoryIds.has(record.taskId) && isLiveHere(record)) ledgerOnly.push(record);
				}
			} catch {
				// An unreadable ledger narrows the listing to memory; corrupt
				// snapshots are already reported through the restore path.
			}
		}
		const summarize = (source: PlannerTaskSummary["source"]) => (record: TaskRecord): PlannerTaskSummary => {
			const objective = record.spec?.objective?.split(/\r?\n/, 1)[0]?.slice(0, 120);
			return {
				taskId: record.taskId,
				state: record.state,
				role: record.role,
				...(objective ? { objective } : {}),
				updatedAt: record.updatedAt,
				recoveryRequired: record.state === "blocked" && record.recovery?.required === true,
				source,
			};
		};
		return [...inMemory.map(summarize("memory")), ...ledgerOnly.map(summarize("ledger"))]
			.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
	}

	/**
	 * Ticket 06 — read-only diagnostics for one Task, reachable without
	 * delegating a child. Resolves from the session store first, then the
	 * ledger snapshot read-only (no adoption, no restore side effects), and
	 * keeps the same workspace boundary as the delegation lookup.
	 */
	describeTaskDiagnostics(
		cwd: string,
		taskId: string,
		executionId?: string,
	): { diagnostics: PlannerTaskDiagnostics } | { error: string; reason: string } {
		let record = this.store.get(taskId);
		let source: "memory" | "ledger" | undefined = record ? "memory" : undefined;
		if (!record && this.snapshots) {
			try {
				const { records } = this.snapshots.readAll();
				const found = records.find((candidate) => candidate.taskId === taskId);
				if (found) {
					record = found;
					source = "ledger";
				}
			} catch {
				// An unreadable ledger is reported as unknown below.
			}
		}
		if (!record || !source) {
			return {
				error: "TASK_UNKNOWN",
				reason: `planner_tasks: unknown Task ${taskId}; pass the canonical taskId verbatim from a prior planner_delegate result, or call planner_tasks without an id to list live Tasks`,
			};
		}
		if (record.cwd && normalizeWorkspaceIdentity(record.cwd) !== normalizeWorkspaceIdentity(cwd)) {
			return {
				error: "TASK_FOREIGN_WORKSPACE",
				reason: `Task ${record.taskId} belongs to workspace ${record.cwd}, not ${cwd}; call planner_tasks from that workspace`,
			};
		}
		const reservations = this.concurrency.status().reservations
			.filter((item) => item.taskId === record!.taskId || item.id === record!.writerHold?.executionId || item.id === `writerhold:${record!.writerHold?.executionId}`);
		const holdActive = record.writerHold !== undefined
			&& reservations.some((item) => item.id === `writerhold:${record!.writerHold!.executionId}`);
		const executions = (record.executions ?? [])
			.filter((execution) => executionId === undefined || execution.executionId === executionId)
			.map((execution) => {
				const sampleFailures = [
					...(execution.aRun.probeFailures ?? []),
					...(execution.cReport?.probeFailures ?? []),
					...(execution.stopSamples ?? []).flatMap((sample) => sample.probeFailures ?? []),
				];
				const reportReceived = execution.reportIndex !== undefined
					|| execution.validatorReportIndex !== undefined
					|| execution.unacceptedReport !== undefined
					|| execution.lateReport !== undefined;
				const reportAccepted = execution.reportIndex !== undefined || execution.validatorReportIndex !== undefined;
				const guidance: string[] = [];
				if (execution.status === "running" || execution.status === "stopping" || execution.status === "cancel_requested") {
					guidance.push("execution is still in flight or its stop was never confirmed; it did not end cleanly");
				}
				if (execution.status === "stop_unconfirmed") {
					guidance.push(execution.capability === "restricted-reader"
						? "stop unconfirmed — no matched terminal; the reader holds no workspace reservation"
						: "launched and ended abnormally or stop evidence incomplete; the writer isolation stays held");
				}
				if (execution.evidenceIncomplete === true) {
					guidance.push("stop-evidence sampling failed — residual workspace state is unknown");
				}
				if (execution.unacceptedReport) {
					guidance.push(`a structured report was received but not admitted (${execution.unacceptedReportReason ?? "reason not recorded"})`);
				}
				if (execution.lateReport) {
					guidance.push("a completed report arrived after a cancel request; it is kept as lateReport evidence only");
				}
				if (reportAccepted) {
					guidance.push(`report admitted as ${execution.validatorReportIndex !== undefined ? "validator" : "worker"} revision ${(execution.validatorReportIndex ?? execution.reportIndex)! + 1}`);
				}
				if (execution.status === "failed" && execution.confirmationBasis === "no-launch") {
					guidance.push("the execution never launched — a pre-launch check refused it");
				}
				return {
					executionId: execution.executionId,
					kind: execution.kind,
					...(execution.status ? { status: execution.status } : {}),
					capability: execution.capability ?? "unknown",
					...(execution.capabilityBasis ? { capabilityBasis: execution.capabilityBasis } : {}),
					...(execution.runId ? { runId: execution.runId } : {}),
					...(execution.cwd ? { cwd: execution.cwd } : {}),
					...(execution.worktreeRoots?.length ? { worktreeRoots: [...execution.worktreeRoots] } : {}),
					...(execution.endedReason ? { endedReason: execution.endedReason } : {}),
					...(execution.endedAt ? { endedAt: execution.endedAt } : {}),
					terminationConfirmed: execution.terminationConfirmed === true,
					...(execution.confirmationBasis ? { confirmationBasis: execution.confirmationBasis } : {}),
					...(execution.evidenceIncomplete === true ? { evidenceIncomplete: true } : {}),
					reportReceived,
					reportAccepted,
					...(execution.unacceptedReport
						? {
							unacceptedReport: {
								taskId: execution.unacceptedReport.taskId,
								status: execution.unacceptedReport.status,
								summary: execution.unacceptedReport.summary.slice(0, 200),
								workerRunId: execution.unacceptedReport.evidence?.workerRunId ?? "",
								reason: execution.unacceptedReportReason ?? "not recorded",
							},
						}
						: {}),
					...(sampleFailures.length ? { probeFailures: sampleFailures } : {}),
					guidance,
				};
			});
		const guidance: string[] = [];
		if (executions.length === 0) {
			guidance.push(executionId === undefined
				? "never launched — no execution records exist on this Task"
				: `no execution ${executionId} on this Task`);
		}
		if (record.writerHold) {
			guidance.push(holdActive
				? `writer hold active for execution ${record.writerHold.executionId} (${record.writerHold.reason})`
				: `writer hold recorded for execution ${record.writerHold.executionId} but no live reservation exists — restart state drift`);
		}
		if (record.recovery?.required === true) {
			guidance.push(`recovery required: ${record.recovery.reason}; submit planner_redelegate recovery or planner_abort for execution ${record.recovery.executionId}`);
		}
		if (source === "ledger") {
			guidance.push("read from the ledger snapshot — the record was not restored into this session's store");
		}
		return {
			diagnostics: {
				taskId: record.taskId,
				state: record.state,
				...(record.stateReason ? { stateReason: record.stateReason.slice(0, 400) } : {}),
				acceptanceMode: acceptanceModeOf(record),
				...(record.recovery?.required === true
					? { recovery: { required: true, reason: record.recovery.reason, executionId: record.recovery.executionId } }
					: {}),
				...(record.writerHold ? { writerHold: { ...record.writerHold, active: holdActive } } : {}),
				reservations: reservations.map((item) => ({
					id: item.id,
					...(item.taskId ? { taskId: item.taskId } : {}),
					capability: item.capability,
					workspaces: [...item.workspaces],
				})),
				source,
				reports: record.reports?.length ?? 0,
				reviews: record.reviews?.length ?? 0,
				executions,
				guidance,
			},
		};
	}

	/**
	 * Ticket 47 — a delegation lookup that is not blinded by the session restore
	 * cap. `restoreFromLedger()` only adopts the freshest
	 * MAX_LEDGER_RESTORE_PER_SESSION records, so a canonical Task id the operator
	 * names by hand can be absent from memory even though its ledger record
	 * exists. Resolving it on demand keeps a *named* Task distinguishable from an
	 * unnamed one, instead of silently degrading to the active Task.
	 *
	 * On-demand records must pass the workspace check: this lookup must never
	 * become a new cross-workspace binding entry. Records already in memory keep
	 * their existing (unfiltered) behaviour — that is ticket 46's scope.
	 */
	private delegationLookup(cwd: string | undefined): {
		lookup: (taskId: string) => TaskRecord | undefined;
		/** Why a named id did not resolve. The record existing but being unusable
		 * must not read as "unknown Task". */
		notes: Map<string, string>;
		/** Ticket 46 — ids that resolve to more than one Task through aliases. */
		ambiguous: Map<string, string[]>;
	} {
		const cache = new Map<string, TaskRecord | undefined>();
		const notes = new Map<string, string>();
		const ambiguous = new Map<string, string[]>();
		const lookup = (taskId: string): TaskRecord | undefined => {
			if (cache.has(taskId)) return cache.get(taskId);
			// Ticket 46 — an alias claimed by several Tasks resolves to none of them.
			const candidates = this.store.resolveCandidates(taskId);
			if (candidates.length > 1) {
				const taskIds = candidates.map((candidate) => candidate.taskId);
				ambiguous.set(taskId, taskIds);
				notes.set(taskId, `Resolves to ${taskIds.length} Tasks as an alias (${taskIds.join(", ")}), so no single Task can be meant`);
				cache.set(taskId, undefined);
				return undefined;
			}
			let found: TaskRecord | undefined = candidates[0];
			if (!found) {
				const restored = this.restoreTaskOnDemand(taskId, cwd);
				found = restored.record;
				if (!found && restored.note) notes.set(taskId, restored.note);
			}
			cache.set(taskId, found);
			return found;
		};
		return { lookup, notes, ambiguous };
	}

	/**
	 * Ticket 47 — read one Task snapshot from the ledger and adopt it when the
	 * workspace matches. A read error and a cross-workspace record both surface
	 * as "not adopted" so the caller fails closed rather than binding elsewhere.
	 */
	private restoreTaskOnDemand(
		taskId: string,
		cwd: string | undefined,
	): { record?: TaskRecord; note?: string } {
		if (!this.snapshots) return {};
		// Without a workspace there is nothing to validate the record against;
		// adopting it could bind across workspaces, so refuse to resolve.
		if (!cwd) return { note: "the delegation carries no workspace to validate it against" };
		let record: TaskRecord | undefined;
		try {
			const { records } = this.snapshots.readAll();
			record = records.find((candidate) => candidate.taskId === taskId)
				?? records.find((candidate) => Array.isArray(candidate.aliases) && candidate.aliases.includes(taskId));
		} catch {
			return { note: "could not be read from the ledger" };
		}
		if (!record) return {};
		if (
			record.cwd
			&& normalizeWorkspaceIdentity(record.cwd) !== normalizeWorkspaceIdentity(cwd)
		) {
			return {
				// Ticket 50 — written so a refusal that prefixes `Task ${id} ${note}`
				// reads as a sentence: the Task exists, it simply belongs elsewhere.
				note: `belongs to workspace ${record.cwd}, while this delegation runs in ${cwd}; cross-workspace binding is refused`,
			};
		}
		return { record: this.restoreRecord(record) };
	}


	resolveWriterHold(taskId: string): TaskRecord {
		const task = this.store.require(taskId);
		if (!task.writerHold) return task;
		this.concurrency.release(task.writerHold.executionId);
		this.concurrency.release(`writerhold:${task.writerHold.executionId}`);
		return this.store.clearWriterHold(taskId);
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

	pendingDelegationCount(): number {
		return this.delegations.size;
	}

	getDelegation(toolCallId: string): DelegationRecord | undefined {
		return this.delegations.get(toolCallId);
	}

	listDelegations(): { toolCallId: string; record: DelegationRecord }[] {
		return [...this.delegations.entries()].map(([toolCallId, record]) => ({ toolCallId, record }));
	}

	hasPendingDelegation(taskId: string): boolean {
		const canonical = this.store.get(taskId)?.taskId ?? taskId;
		for (const record of this.delegations.values()) {
			if (record.taskId === canonical) return true;
		}
		return false;
	}

	private isLiveWriterStale(taskId: string, now = this.store.now().getTime()): boolean {
		for (const record of this.delegations.values()) {
			if (record.taskId === taskId && isWriterRole(record.kind) && record.lockedAt) {
				const held = Date.parse(record.lockedAt);
				if (Number.isFinite(held) && now - held >= EXECUTING_STALE_MS) return true;
			}
		}
		const holder = this.store.get(taskId);
		return Boolean(holder && isExecutingStale(holder, now));
	}

	private writerConflict(cwd: string, role: DelegationKind): WriterConflict {
		if (!isWriterRole(role)) return { conflict: false };
		const target = normalizeWorkspaceIdentity(cwd);
		for (const record of this.delegations.values()) {
			if (!isWriterRole(record.kind)) continue;
			if (!record.worktrees?.includes(target)) continue;
			const holder = this.store.get(record.taskId);
			if (holder && isFinalTaskState(holder.state)) continue;
			const stale = holder && this.isLiveWriterStale(record.taskId);
			return {
				conflict: true,
				taskId: record.taskId,
				reason: [
					`Planner-only guard: task ${record.taskId} already holds the write lock for ${target}.`,
					stale
						? `That lock has been held for over ${executingStaleMinutes()} minutes and its child run has not been confirmed exited; reconcile the run (or abandon the task) before starting another writer.`
						: "Keep one writable invocation per worktree; even a second call on the same Task must wait.",
					"Wait for that run's result to release the lock, or delegate this one into a separate worktree.",
				].join("\n"),
			};
		}
		return { conflict: false };
	}

	private noteStaleHolder(conflict: WriterConflict, againstTaskId?: string): void {
		if (!conflict.conflict || !conflict.taskId) return;
		const holder = this.store.get(conflict.taskId);
		if (!holder) return;
		if (holder.stateReason && holder.stateReason.includes("needs reconcile")) return;
		if (!this.isLiveWriterStale(conflict.taskId)) return;
		this.store.setStateReason(
			holder.taskId,
			`needs reconcile: write lock held past the stale duration without a confirmed child exit (lock held against ${againstTaskId ? `task ${againstTaskId}` : "a new writer"})`,
		);
	}

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

	private async reconcileBeforeLock(taskId: string, warnings: string[]): Promise<void> {
		const canonical = this.store.get(taskId)?.taskId ?? taskId;
		for (const [toolCallId, record] of [...this.delegations]) {
			if (record.taskId !== canonical) continue;
			if (await this.reconcileDelegation(toolCallId, record)) {
				warnings.push(
					`Planner-only: the previous pending child for task ${taskId} had already finished; its saved result was consumed before this delegation started.`,
				);
			}
		}
	}

	private async supersedePendingDelegations(
		taskId: string,
		keepToolCallId: string,
		warnings: string[],
		options?: { protectWriters?: boolean },
	): Promise<void> {
		for (const [toolCallId, record] of [...this.delegations]) {
			if (toolCallId === keepToolCallId || record.taskId !== taskId) continue;
			if (await this.reconcileDelegation(toolCallId, record)) {
				warnings.push(
					`Planner-only: the previous pending child for task ${taskId} had already finished; its saved result was consumed before this delegation started.`,
				);
				continue;
			}
			if (options?.protectWriters && isWriterRole(record.kind)) {
				warnings.push(
					`Planner-only: the pending writable child run ${record.runId ?? toolCallId} for task ${taskId} is not known stopped; review will run in parallel without superseding the writer.`,
				);
				continue;
			}
			this.delegations.delete(toolCallId);
			this.supersededIds.add(toolCallId);
			if (record.runId) this.supersededIds.add(record.runId);
			warnings.push(
				`Planner-only: this re-delegation supersedes the pending child run ${record.runId ?? toolCallId} for task ${taskId}; a late notice for it will be ignored.`,
			);
		}
	}

	private async reconcileDelegation(toolCallId: string, record: DelegationRecord): Promise<boolean> {
		if (!record.runId || this.processedRunIds.has(record.runId)) return false;
		const dirs: string[] = [];
		if (record.asyncDir) {
			const root = tempRootFromAsyncDir(record.asyncDir);
			if (root) dirs.push(join(root, "artifacts"));
		}
		if (record.launchCwd) {
			dirs.push(join(record.launchCwd, ".pi", "subagents", "artifacts"));
		}
		dirs.push(join(process.cwd(), ".pi", "subagents", "artifacts"));

		const agents = [...new Set([record.agent, "worker", "oracle", "validator", "reviewer", "explorer"].filter(Boolean))] as string[];
		let meta: { runId: string; agent: string; exitCode?: number } | undefined;
		let metaDir: string | undefined;

		for (const dir of dirs) {
			if (!existsSync(dir)) continue;
			for (const agent of agents) {
				const names = [`${record.runId}_${agent}_meta.json`, `${record.runId}_${agent}_0_meta.json`];
				for (const name of names) {
					const p = join(dir, name);
					if (existsSync(p)) {
						try {
							const parsed = JSON.parse(readFileSync(p, "utf8"));
							if (parsed && parsed.exitCode !== undefined) {
								meta = parsed;
								metaDir = dir;
								break;
							}
						} catch {}
					}
				}
				if (meta) break;
			}
			if (meta) break;
		}

		if (!meta || meta.exitCode === undefined) return false;

		let report: WorkerReport | undefined;
		const candidates = ["result.json", "output.json", `${record.runId}.json`];
		if (metaDir) {
			const outputDir = join(metaDir, "outputs", record.runId);
			if (existsSync(outputDir)) {
				for (const cand of candidates) {
					const cp = join(outputDir, cand);
					if (existsSync(cp)) {
						try {
							const content = readFileSync(cp, "utf8");
							report = extractWorkerReport(content);
							if (report) break;
						} catch {}
					}
				}
			}
		}

		if (report) {
			this.store.recordReport(record.taskId, report);
			await this.bindSnapshotForLatestReport(this.store.require(record.taskId), record.runId ?? toolCallId);
			const task = this.store.get(record.taskId);
			if (task && task.state === "executing") {
				this.store.transition(record.taskId, "reviewing");
			}
			this.processedRunIds.add(record.runId);
			this.delegations.delete(toolCallId);
			return true;
		}

		if (meta.exitCode !== 0) {
			this.processedRunIds.add(record.runId);
			this.delegations.delete(toolCallId);
			const task = this.store.get(record.taskId);
			if (task && !isFinalTaskState(task.state)) {
				this.store.transition(record.taskId, "failed");
			}
			return true;
		}

		return false;
	}

	async reconcilePendingDelegations(taskId?: string): Promise<number> {
		let count = 0;
		for (const [toolCallId, record] of [...this.delegations]) {
			if (taskId && record.taskId !== taskId) continue;
			if (await this.reconcileDelegation(toolCallId, record)) {
				count += 1;
			}
		}
		return count;
	}

	async beginDelegation(
		event: { toolCallId: string; input?: unknown },
		baseCwd: string = process.cwd(),
	): Promise<DelegationOutcome> {
		const rawInput = event.input ?? {};
		const inputRecord = (typeof rawInput === "object" && rawInput !== null)
			? (rawInput as Record<string, unknown>)
			: { task: String(rawInput) };

		let parsedTask: Record<string, unknown> | undefined;
		if (typeof inputRecord.task === "object" && inputRecord.task !== null) {
			parsedTask = inputRecord.task as Record<string, unknown>;
		} else if (typeof inputRecord.task === "string") {
			try {
				const candidate = JSON.parse(inputRecord.task.trim());
				if (candidate && typeof candidate === "object") parsedTask = candidate;
			} catch {}
		}

		const agent = typeof inputRecord.agent === "string" ? inputRecord.agent.trim().toLowerCase() : undefined;
		let role: DelegationKind = "worker";
		if (agent === "oracle" || agent === "validator") {
			role = "validator";
		} else if (agent === "reviewer") {
			role = "reviewer";
		} else if (agent === "scout" || agent === "explorer") {
			role = "explorer";
		} else if (typeof inputRecord.role === "string") {
			role = inputRecord.role as DelegationKind;
		} else if (typeof parsedTask?.role === "string") {
			role = parsedTask.role as DelegationKind;
		}

		const rawCwd = (parsedTask && typeof parsedTask.cwd === "string" && parsedTask.cwd.trim())
			? parsedTask.cwd.trim()
			: (typeof inputRecord.cwd === "string" && inputRecord.cwd.trim())
				? inputRecord.cwd.trim()
				: baseCwd;
		const cwd = resolve(baseCwd, rawCwd);

		const explicitTaskId = (parsedTask && typeof parsedTask.taskId === "string")
			? parsedTask.taskId.trim()
			: (typeof inputRecord.taskId === "string")
				? inputRecord.taskId.trim()
				: undefined;

		let task: TaskRecord | undefined = explicitTaskId ? this.store.get(explicitTaskId) : undefined;

		if (role === "validator") {
			if (!task) {
				const placeholderId = explicitTaskId ?? `unbound-validator-${event.toolCallId}`;
				task = this.store.get(placeholderId) ?? this.store.create(createTaskSpec({
					objective: typeof parsedTask?.objective === "string" ? parsedTask.objective : "validation",
					cwd,
					role: "validator",
				}, placeholderId));
			}
		} else if (!task) {
			if (explicitTaskId && parsedTask) {
				task = this.store.create(createTaskSpec(parsedTask as unknown as any, explicitTaskId));
			} else if (this.structuredDelegationMode === "warn" || !parsedTask) {
				const nextId = this.store.nextTaskId();
				const objective = typeof inputRecord.task === "string"
					? inputRecord.task
					: typeof parsedTask?.objective === "string"
						? parsedTask.objective
						: "unstructured task";
				task = this.store.createAllocated(nextId, createTaskSpec({ objective, cwd, role }, nextId));
			} else {
				const nextId = this.store.nextTaskId();
				task = this.store.createAllocated(nextId, createTaskSpec(parsedTask as unknown as any, nextId));
			}
		}

		const warnings: string[] = [];

		if (isWriterRole(role)) {
			const wts = [task.cwd || cwd];
			if (role === "validator" && cwd && normalizeWorkspaceIdentity(cwd) !== normalizeWorkspaceIdentity(task.cwd || cwd)) {
				wts.push(cwd);
			}
			if (task.spec?.additionalWorktreeRoots) {
				wts.push(...task.spec.additionalWorktreeRoots);
			}
			const worktrees = [...new Set(wts.map(normalizeWorkspaceIdentity))];

			// Step 1: Reconcile same-Task pending children from child-run artifacts
			await this.reconcileBeforeLock(task.taskId, warnings);

			// Step 2: Refuse before launch if live writable Delegation still holds worktree and child is not known stopped
			const conflict = await this.refuseOrClearWriteLocks(worktrees, role, warnings, task.taskId);
			if (conflict.conflict) {
				return { task, conflict, ...(warnings.length ? { warnings } : {}) };
			}

			// Step 3: Supersede leftover same-Task waiters
			await this.supersedePendingDelegations(task.taskId, event.toolCallId, warnings);

			// Step 4: Register new Delegation as lock holder
			this.delegations.set(event.toolCallId, {
				taskId: task.taskId,
				kind: role,
				worktrees,
				lockedAt: this.store.now().toISOString(),
				agent,
				launchCwd: cwd,
				spec: task.spec,
				toolCallId: event.toolCallId,
			});

			// Step 5: Transition Task to executing only when lifecycle requires it
			if (role === "worker" && (task.state === "planning" || task.state === "changes_requested")) {
				this.store.transition(task.taskId, "executing");
			}

			return { task: this.store.require(task.taskId), ...(warnings.length ? { warnings } : {}) };
		}

		// Non-writable: reviewer or explorer
		if (role === "reviewer") {
			await this.supersedePendingDelegations(task.taskId, event.toolCallId, warnings, { protectWriters: true });
			const rawPacket = (parsedTask && typeof parsedTask === "object") ? parsedTask : inputRecord;
			const isTruncated = Boolean(
				inputRecord.packetTruncated === true ||
				rawPacket?.packetTruncated === true ||
				(rawPacket?.evidencePacket && typeof rawPacket.evidencePacket === "object" && (
					(rawPacket.evidencePacket as any).patchTruncated === true ||
					(Array.isArray((rawPacket.evidencePacket as any).patchOmittedPaths) && (rawPacket.evidencePacket as any).patchOmittedPaths.length > 0)
				))
			);
			this.delegations.set(event.toolCallId, {
				taskId: task.taskId,
				kind: "reviewer",
				agent: "reviewer",
				launchCwd: cwd,
				toolCallId: event.toolCallId,
				packetTruncated: isTruncated,
			});
			return { task: this.store.require(task.taskId), ...(warnings.length ? { warnings } : {}) };
		}

		// explorer
		this.delegations.set(event.toolCallId, {
			taskId: task?.taskId ?? "unbound-explorer",
			kind: "explorer",
			agent: agent ?? "explorer",
			launchCwd: cwd,
			toolCallId: event.toolCallId,
		});
		return { task: task ? this.store.require(task.taskId) : undefined, ...(warnings.length ? { warnings } : {}) };
	}

	async handleSubagentResult(
		event: {
			toolCallId: string;
			toolName?: string;
			input?: unknown;
			content?: { type?: string; text?: string }[];
			isError?: boolean;
			details?: Record<string, unknown>;
		},
	): Promise<{ content: { type: "text"; text: string }[] } | undefined> {
		const delegation = this.delegations.get(event.toolCallId);
		if (!delegation) return undefined;

		const text = Array.isArray(event.content)
			? event.content.map((c) => c.text ?? "").join("\n")
			: "";

		if (event.isError) {
			const extracted = extractWorkerReport(text);
			if (!extracted) {
				if (delegation.runId) {
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
								text,
								"The run has not been confirmed stopped, so the write lock stays held and the task stays executing.",
								"Wait for the completion notice or the run artifacts; until then Root may record a blocked verdict.",
							].join("\n"),
						}],
					};
				}

				this.delegations.delete(event.toolCallId);
				const task = this.store.get(delegation.taskId);
				if (task && !isFinalTaskState(task.state)) {
					this.store.transition(task.taskId, "failed");
				}
				return {
					content: [{
						type: "text",
						text: `[PLANNER-ONLY] Delegation for task ${delegation.taskId} failed to launch.\n${text}`,
					}],
				};
			}
		}

		const details = event.details;
		const runId = typeof details?.runId === "string" ? details.runId : typeof details?.asyncId === "string" ? details.asyncId : undefined;
		const isAsyncReceipt = Boolean(runId || details?.asyncDir);
		if (isAsyncReceipt && !extractWorkerReport(text)) {
			if (runId) delegation.runId = runId;
			if (typeof details?.asyncDir === "string") delegation.asyncDir = details.asyncDir;
			return {
				content: [{
					type: "text",
					text: `[PLANNER-ONLY] Async delegation for task ${delegation.taskId} has started (runId: ${runId ?? "unknown"}).`,
				}],
			};
		}

		this.delegations.delete(event.toolCallId);
		if (delegation.runId) this.processedRunIds.add(delegation.runId);

		const report = extractWorkerReport(text);
		if (report) {
			if (delegation.kind === "validator") {
				this.store.recordValidatorReport(delegation.taskId, report);
			} else {
				this.store.recordReport(delegation.taskId, report);
				await this.bindSnapshotForLatestReport(this.store.require(delegation.taskId), delegation.toolCallId);
				const task = this.store.get(delegation.taskId);
				if (task && task.state === "executing") {
					this.store.transition(task.taskId, "reviewing");
				}
			}
			return {
				content: [{
					type: "text",
					text: `[PLANNER-ONLY REVIEW STATE] Report recorded for task ${delegation.taskId}.`,
				}],
			};
		}

		if (delegation.kind === "reviewer") {
			const task = this.store.require(delegation.taskId);
			let review: ReviewResult | undefined;
			try {
				const parsed = JSON.parse(text);
				if (parsed && typeof parsed === "object" && typeof parsed.verdict === "string") {
					review = parsed as ReviewResult;
				}
			} catch {}

			if (!review) {
				return {
					content: [{
						type: "text",
						text: `[PLANNER-ONLY] Reviewer delegation finished for task ${delegation.taskId}: invalid review output.`,
					}],
				};
			}

			const identityErrors = validateReviewResultIdentity(review, task.taskId);
			if (identityErrors.length > 0) {
				return {
					content: [{
						type: "text",
						text: `[PLANNER-ONLY] Reviewer verdict rejected: ${identityErrors.join("; ")}. Task state unchanged.`,
					}],
				};
			}

			if (review.verdict === "pass" && delegation.packetTruncated) {
				return {
					content: [{
						type: "text",
						text: `[PLANNER-ONLY] Reviewer verdict was rejected: the review packet for task ${task.taskId} was truncated (patchTruncated or omitted patch paths); a pass over a partial packet is not eligible. The verdict was not recorded and no task state changed.`,
					}],
				};
			}

			const report = task.reports.at(-1);
			if (review.verdict === "pass") {
				if (!report) {
					return {
						content: [{
							type: "text",
							text: `[PLANNER-ONLY] Reviewer verdict rejected: Task ${task.taskId} has no recorded WorkerReport. The verdict was not recorded and no task state changed.`,
						}],
					};
				}
				if (!task.snapshot || task.snapshot.reportRevision !== task.reports.length) {
					return {
						content: [{
							type: "text",
							text: `[PLANNER-ONLY] Reviewer verdict rejected: pre-snapshot report: no workspace snapshot binds the validated report revision ${task.reports.length}. The verdict was not recorded and no task state changed.`,
						}],
					};
				}
				const bindingErrors = validateReviewResultBinding(review, {
					reportRevision: task.reports.length,
					workspaceDigest: task.snapshot.digest,
				});
				if (bindingErrors.length > 0) {
					return {
						content: [{
							type: "text",
							text: `[PLANNER-ONLY] Reviewer verdict rejected: ${bindingErrors.join("; ")}. The verdict was not recorded and no task state changed.`,
						}],
					};
				}
			}

			let currentSample: EvidenceRef | undefined;
			if (report) {
				currentSample = await captureEvidence(
					this.gitRunner,
					captureEvidenceOptionsFor(task, delegation.toolCallId, {
						...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
					}),
				);
			}

			if (review.verdict === "pass" && currentSample) {
				const currentSnapshot = captureWorkspaceSnapshot({
					cwd: task.cwd,
					taskId: task.taskId,
					invocationId: `review-${delegation.toolCallId}`,
					paths: snapshotPathsFor(task, currentSample),
				});
				const binding = compareSnapshotBinding(task.snapshot, currentSnapshot, task.reports.length);
				if (binding.state !== "fresh") {
					return {
						content: [{
							type: "text",
							text: `[PLANNER-ONLY] Reviewer verdict was rejected: ${binding.reason ?? "the workspace snapshot at accept time is not fresh"}. The verdict was not recorded and no task state changed.`,
						}],
					};
				}
			}

			let comparison: EvidenceComparison | undefined;
			if (report && currentSample) {
				comparison = compareWithRootSamples(task, currentSample, report);
				const latestExec = this.executionForLatestReport(task);
				if (latestExec) {
					comparison = await this.augmentExecutionEvidence(task, currentSample, comparison);
				}
				comparison = { ...comparison, environmentFailure: environmentFailureOf(currentSample) };
				if (review.verdict === "pass") {
					comparison = this.preparePassFindings(task, comparison) ?? comparison;
				}
				this.store.setLastComparison(task.taskId, comparison);
			}

			const recordedReview: ReviewResult = {
				...review,
				source: "reviewer",
			};
			this.store.recordReview(task.taskId, recordedReview);
			const { decision } = advanceReview({
				store: this.store,
				taskId: task.taskId,
				...(report ? { report } : {}),
				...(comparison ? { comparison } : {}),
				review: recordedReview,
			});
			this.store.annotateReviewDecision(task.taskId, decision.action);
			if (decision.action === "revalidate" && decision.evidenceKey) {
				this.store.markRevalidationGranted(task.taskId, decision.evidenceKey);
			}

			return {
				content: [{
					type: "text",
					text: `[PLANNER-ONLY] Reviewer verdict for task ${task.taskId}: ${review.verdict}. Action: ${decision.action}.`,
				}],
			};
		}

		return {
			content: [{
				type: "text",
				text: `[PLANNER-ONLY] Delegation finished for task ${delegation.taskId}.`,
			}],
		};
	}

	async handleAsyncNotify(
		content: string,
	): Promise<{ content: { type: "text"; text: string }[] } | undefined> {
		if (typeof content !== "string" || !content.trim()) return undefined;
		const lines = content.split("\n");
		const first = lines[0] ?? "";
		const single = first.match(
			/^(Background task|Detached foreground task) (completed|failed|paused|stopped): \*\*(.+?)\*\*/,
		);
		const grouped = first.match(/^Background tasks completed \((\d+)\): (.+)$/);
		if (!single && !grouped) return undefined;

		const runIds: string[] = [];
		for (const line of lines) {
			if (line.startsWith("Child runs: ")) {
				const parts = line.slice("Child runs: ".length).split(", ");
				for (const part of parts) {
					const trimmed = part.trim();
					const statusMatch = trimmed.match(/^(.*?)(?: \(([^)]*)\))?$/);
					const raw = statusMatch?.[1] ?? trimmed;
					const separator = raw.indexOf("=");
					const id = (separator >= 0 ? raw.slice(separator + 1) : raw).trim();
					if (id) runIds.push(id);
				}
			}
		}

		const body = lines.slice(2).join("\n");
		const report = extractWorkerReport(body);
		if (report?.evidence?.workerRunId && this.supersededIds.has(report.evidence.workerRunId)) {
			return undefined;
		}
		for (const id of runIds) {
			if (this.supersededIds.has(id)) return undefined;
		}

		const taskIdMatch = body.match(/"taskId"\s*:\s*"([^"\\]{1,200})"/);
		const taskIdHint = taskIdMatch?.[1];

		const pending = [...this.delegations.entries()]
			.map(([toolCallId, record]) => ({ toolCallId, record }))
			.filter(({ record }) => !record.runId || !this.processedRunIds.has(record.runId));

		let matched: { toolCallId: string; record: DelegationRecord } | undefined;
		if (runIds.length > 0) {
			matched = pending.find(({ record }) => record.runId && runIds.includes(record.runId));
		} else if (taskIdHint) {
			const hintId = this.store.get(taskIdHint)?.taskId ?? taskIdHint;
			const byTask = pending.filter(({ record }) => record.taskId === hintId);
			if (byTask.length === 1) {
				matched = byTask[0];
			} else {
				return undefined;
			}
		} else {
			const agentName = single?.[3]?.trim().toLowerCase() ?? "worker";
			const byAgent = pending.filter(({ record }) => (record.agent ?? record.kind).toLowerCase() === agentName);
			if (byAgent.length === 1) matched = byAgent[0];
		}

		if (!matched) return undefined;

		const { toolCallId, record } = matched;
		if (record.runId) this.processedRunIds.add(record.runId);
		this.delegations.delete(toolCallId);

		if (report) {
			this.store.recordReport(record.taskId, report);
			await this.bindSnapshotForLatestReport(this.store.require(record.taskId), record.runId ?? toolCallId);
			const task = this.store.get(record.taskId);
			if (task && task.state === "executing") {
				this.store.transition(record.taskId, "reviewing");
			}
		}

		return {
			content: [{
				type: "text",
				text: `[PLANNER-ONLY REVIEW STATE] Task ${record.taskId} notification consumed.`,
			}],
		};
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
			&& candidate.state === "completed",
		);
		if (candidates.length === 0) return undefined;
		const driftPaths = freshness.driftPaths.map((path) => normalizeEvidencePaths([path], currentSample.repoRoot ?? currentSample.cwd)[0]);
		const contentMatches = (candidate: TaskRecord, paths: readonly string[]): boolean => candidate.executions.some((execution) => {
			const truthPaths = new Set(execution.truthPaths ?? []);
			if (!paths.every((path) => truthPaths.has(path))) return false;
			const reportSample = execution.cReport;
			if (!reportSample) return false;
			return paths.every((path) => {
				const currentHash = currentSample.dirtyPathHashes?.[path];
				const successorHash = reportSample.dirtyPathHashes?.[path];
				if (currentHash !== undefined || successorHash !== undefined) return currentHash === successorHash;
				return currentSample.finalGitRef !== undefined && currentSample.finalGitRef === reportSample.finalGitRef;
			});
		});
		if (driftPaths.length > 0) {
			const owner = candidates.find((candidate) => contentMatches(candidate, driftPaths));
			if (owner) return { kind: "superseded", paths: driftPaths, successorTaskId: owner.taskId };
		}
		const committedPaths = (currentSample.committedPaths ?? [])
			.map((path) => normalizeEvidencePaths([path], currentSample.repoRoot ?? currentSample.cwd)[0]);
		if (freshness.headChanged && currentSample.changedPaths?.length === 0 && committedPaths.length > 0) {
			const owner = candidates.find((candidate) => contentMatches(candidate, committedPaths));
			if (owner) return { kind: "committed", paths: committedPaths, successorTaskId: owner.taskId };
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
		const scopeEntries = task.spec?.scope?.allowedPaths ?? [];
		// Same classifier the evidence side uses. An exact Set of resolved paths
		// cannot express scope semantics: `path.resolve` drops a trailing slash,
		// so an entry "sub/" became "/abs/.../sub" and never matched the files
		// under it -- every in-scope undeclared path fell through to unrelated.
		const inDeclaredScope = (path: string): boolean =>
			isPathInDeclaredScope(path, pathCwd, scopeEntries, roots ?? []);
		const overlappingPaths = truth.undeclaredPaths.filter(inDeclaredScope);
		const unrelatedPaths = truth.undeclaredPaths.filter((path) => !inDeclaredScope(path));

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
				(finding) => finding.kind === "over-declared" || finding.kind === "missing" || finding.kind === "attribution-gap",
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
			truthFindings: [
				...open.map((finding) => ({ kind: finding.kind, paths: finding.paths })),
				...truth.findings.filter((f) => f.kind === "attribution-gap").map((f) => ({ kind: f.kind, paths: f.paths })),
			],
			missingMaterials: comparison.missingMaterials,
			freshness,
			attributionGapPaths: truth.attributionGapPaths,
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

	/**
	 * Ticket 49 — resolve a `planner_verdict` target with the delegation path's
	 * ledger-aware lookup, so a Task beyond the session restore cap is still
	 * addressable by id.
	 *
	 * It never substitutes another Task: the caller falls back to the active Task
	 * only when no id was named at all. The returned `note` explains a miss that is
	 * not simply "unknown" (a record that exists but is unusable, or an alias two
	 * Tasks claim).
	 */
	resolveVerdictTask(taskId: string, cwd: string): { task?: TaskRecord; note?: string } {
		const { lookup, notes, ambiguous } = this.delegationLookup(cwd);
		const task = lookup(taskId);
		if (task) return { task };
		const candidates = ambiguous.get(taskId);
		if (candidates) {
			return {
				note: `Resolves to ${candidates.length} Tasks as an alias (${candidates.join(", ")}), so no verdict can be attributed to one of them`,
			};
		}
		const note = notes.get(taskId);
		return { note: note ? `${note}` : undefined };
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
		const refusals = task.verdictRefusals ?? [];
		if (refusals.length > 0) lines.push(`Refused verdicts: ${refusals.length} (${refusals.map((r) => r.kind).join(", ")})`);
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
			for (const execution of task.executions) {
				if (execution.status === undefined || execution.status === "completed") continue;
				lines.push(
					`  - ${execution.executionId}: ${execution.status}${execution.endedReason ? ` (${execution.endedReason})` : ""}${
						execution.terminationConfirmed === true ? ", stop confirmed" : ""
					}${execution.evidenceIncomplete === true ? ", evidence-incomplete" : ""}${
						execution.capability !== undefined ? `, capability ${execution.capability}` : ""
					}${execution.unacceptedReport !== undefined ? ", report received but not admitted" : ""}`,
				);
				const failures = [
					...(execution.aRun.probeFailures ?? []),
					...(execution.stopSamples ?? []).flatMap((sample) => sample.probeFailures ?? []),
				];
				if (failures.length > 0) lines.push(`    probe failures: ${describeProbeFailures(failures)}`);
			}
		}
		if (task.writerHold) {
			lines.push(
				`Writer hold: kept — execution ${task.writerHold.executionId} stop unconfirmed (${task.writerHold.reason}; since ${task.writerHold.since}); no second writer until resolved`,
			);
		}
		if (task.recovery?.required) {
			lines.push(
				`Recovery required: ${task.recovery.reason} — execution ${task.recovery.executionId}; decide via planner_redelegate.recovery or planner_abort`,
			);
		} else if (task.recovery?.nextAction === "abort") {
			lines.push(`Recovery: aborted — Task left for operator handling (decision by ${task.recovery.consumedBy ?? "planner_abort"})`);
		}
		if (task.recoveryAttempts > 0) {
			lines.push(`Recoveries: ${task.recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS} automatic attempts used`);
		}
		if (task.overrides.length > 0) {
			lines.push(`Overrides: ${task.overrides.length}`);
		}
		// Ticket 08: the child rows come from usage.children (the structured
		// delegation path records them there); the legacy history map is gone.
		const children = task.usage?.children ?? [];
		if (children.length > 0) {
			lines.push("Delegations:");
			for (const c of children) {
				const rawModel = c.model;
				const rawThinking = c.thinking ?? (rawModel?.includes(":") ? rawModel.slice(rawModel.lastIndexOf(":") + 1) : undefined);
				lines.push(`  - ${c.kind}: ${rawModel ?? "unknown"} (thinking: ${rawThinking ?? "unknown"})`);
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

	/** Record a refused Root verdict as an audit row, never a ReviewResult. */
	recordRootVerdictRefusal(task: TaskRecord, verdict: ReviewVerdict, refusal: RootVerdictRefusal): void {
		this.store.recordVerdictRefusal(task.taskId, {
			taskId: task.taskId,
			requestedVerdict: verdict,
			kind: refusal.kind,
			reason: refusal.reason,
			...(task.reports.at(-1)?.evidence?.workerRunId ? { executionId: task.reports.at(-1)?.evidence.workerRunId } : {}),
		});
	}

	/**
	 * Ticket 03 — the observation acceptance gates for a pass verdict.
	 * Worktree evidence is excluded, but the pass still binds the trusted
	 * restricted-reader execution that produced the report, a modification-
	 * free declaration, and every evidence requirement the spec declared.
	 * Returns the structured refusal, or undefined when the pass may proceed.
	 */
	private observationPassBlocker(task: TaskRecord): RootVerdictRefusal | undefined {
		const report = task.reports.at(-1);
		if (!report) return undefined;
		const revision = task.reports.length - 1;
		const producer = [...task.executions].reverse().find((execution) => execution.reportIndex === revision);
		if (!producer) {
			return {
				kind: "observation-inadmissible",
				reason: `report revision ${task.reports.length} has no bound execution record; an observation pass needs the restricted-reader execution that produced it`,
			};
		}
		if (producer.capability !== "restricted-reader") {
			return {
				kind: "observation-inadmissible",
				reason: `report revision ${task.reports.length} was produced by execution ${producer.executionId} with capability "${producer.capability ?? "unknown"}"; an observation pass requires a trusted restricted-reader execution`,
			};
		}
		if (producer.status !== "completed" || producer.terminationConfirmed !== true) {
			return {
				kind: "observation-inadmissible",
				reason: `execution ${producer.executionId} is ${producer.status ?? "unknown"} (terminationConfirmed=${producer.terminationConfirmed === true}); an observation pass needs a confirmed completed reader execution`,
			};
		}
		if (report.changedFiles.length > 0) {
			return {
				kind: "observation-inadmissible",
				reason: `the report declares ${report.changedFiles.length} changed file(s) — an observation Task accepts read-only findings only; produce a worker Task for changes`,
			};
		}
		const attributed = [...new Set([...(producer.truthPaths ?? []), ...(producer.committedPaths ?? [])])];
		if (attributed.length > 0) {
			return {
				kind: "observation-inadmissible",
				reason: `execution ${producer.executionId} has attributed modifications (${attributed.join(", ")}); an observation Task cannot accept produced changes`,
			};
		}
		const expected = task.spec?.expectedEvidence;
		if (expected?.changedFiles === true) {
			return {
				kind: "observation-inadmissible",
				reason: "spec expectedEvidence.changedFiles contradicts observation acceptance — observation Tasks never declare changed files",
			};
		}
		if (expected?.gitRef === true && !report.evidence.finalGitRef && !report.evidence.baseGitRef) {
			return {
				kind: "observation-inadmissible",
				reason: "spec expectedEvidence.gitRef requires a Git ref bound in the report evidence; none was recorded",
			};
		}
		if (expected?.diffStat === true && !report.evidence.diffStat) {
			return {
				kind: "observation-inadmissible",
				reason: "spec expectedEvidence.diffStat requires a diffStat bound in the report evidence; none was recorded",
			};
		}
		if (expected?.tests === true && !report.validation.some((item) => item.status === "passed")) {
			return {
				kind: "observation-inadmissible",
				reason: "spec expectedEvidence.tests requires at least one passed validation entry; none was recorded",
			};
		}
		if (task.spec?.validation?.required === true) {
			const missing = missingTaskSpecValidationCommands(task.spec, report);
			if (missing.length > 0) {
				return {
					kind: "observation-inadmissible",
					reason: `spec validation.required is unmet: no passed entry for ${missing.map((command) => JSON.stringify(command)).join(", ")}`,
				};
			}
		}
		return undefined;
	}

	/**
	 * §3 step 2 — why Root may not record `verdict` on `task` right now.
	 * Returns the structured refusal (typed kind + display prose), or undefined
	 * when the verdict may proceed. Callers must branch on `kind`, never on the
	 * reason text.
	 */
	rootVerdictRefusal(task: TaskRecord, verdict: ReviewVerdict): RootVerdictRefusal | undefined {
		if (isTerminalTaskState(task.state)) {
			return {
				kind: "terminal-state",
				reason: `Task ${task.taskId} is already ${task.state}; verdicts are final. Start a new Task with a new TaskSpec for further work.`,
			};
		}
		// Pre-screen only: this runs before a verdict exists and has no summary or
		// findings to read, so it cannot evaluate the override record. It answers
		// "is an oracle execution present at all?". The authoritative gate — gap
		// reason, snapshot freshness, absence of other open findings, and the
		// documented affected paths — is recordRootVerdict.
		if (verdict === "pass" && task.state === "blocked" && ((task as any).blockedReasonCode === "attribution-gap" || task.stateReason?.includes("attribution gap") || task.stateReason?.includes("attribution-gap"))) {
			const lastValidator = task.validatorReports.at(-1);
			const oraclePassed = Boolean(lastValidator && (lastWorkerValidationPassed(lastValidator) || (lastValidator.status === "completed" && lastValidator.validation.some(v => v.status === "passed" && v.exitCode === 0))));
			if (!oraclePassed) {
				return {
					kind: "attribution-gap-unlock-refused",
					reason: `Task ${task.taskId} is blocked due to attribution-gap; unlock requires an oracle-passed validator execution and explicit override`,
				};
			}
		}
		if (verdict !== "blocked" && this.hasPendingDelegation(task.taskId)) {
			return {
				kind: "child-pending",
				reason: `Task ${task.taskId} still has an active child delegation; wait for its result before recording a ${verdict} verdict, or record blocked to halt the loop.`,
			};
		}
		if (task.state === "completed" || (task.state !== "report-invalid" && verdict !== "blocked" && task.reports.length === 0)) {
			return {
				kind: "no-report",
				reason: `Task ${task.taskId} has no recorded WorkerReport; a pass or change request needs a report to judge.`,
			};
		}
		// Ticket 03 — observation acceptance gates. An observation Task can
		//    never run a reviewer, so the fresh-review gates are exempt; the
		//    pass still binds the restricted-reader execution, a modification-
		//    free report, and every declared evidence requirement.
		if (acceptanceModeOf(task) === "observation") {
			if (verdict === "pass") {
				const blocker = this.observationPassBlocker(task);
				if (blocker) return blocker;
			}
			return undefined;
		}
		if (
			verdict === "pass" &&
			task.reviewMode === "fresh" &&
			!task.reviews.some((review) => (review.source ?? "reviewer") === "reviewer")
		) {
			return {
				kind: "fresh-review-pending",
				reason: `Task ${task.taskId} is in fresh review mode and no reviewer ReviewResult exists yet; delegate the review first — in fresh mode Root arbitrates, it does not pre-empt.`,
			};
		}
		if (
			verdict === "pass" &&
			process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW === "1" &&
			task.reviewMode === "fresh" &&
			(!task.lastComparison || task.lastComparison.truthPaths.length === 0)
		) {
			return {
				kind: "strict-zero-paths",
				reason: `Task ${task.taskId} is in strict fresh review mode and evidence attribution paths are 0; a pass needs non-zero evidence attribution paths.`,
			};
		}
		return undefined;
	}


	/**
	 * FR-01 / Ticket 10 / hardening-gaps Ticket 02:
	 * Bind the workspace snapshot that validated the latest report revision.
	 */
	private async bindSnapshotForLatestReport(task: TaskRecord, invocationId: string): Promise<void> {
		const current = this.store.require(task.taskId);
		const reportRevision = current.reports.length;
		if (reportRevision === 0) return;
		const currentSample = await captureEvidence(
			this.gitRunner,
			captureEvidenceOptionsFor(current, invocationId, {
				...(current.baseEvidence?.finalGitRef ? { baseGitRef: current.baseEvidence.finalGitRef } : {}),
			}),
		);
		const snapshot = captureWorkspaceSnapshot({
			cwd: current.cwd,
			taskId: current.taskId,
			invocationId,
			paths: snapshotPathsFor(current, currentSample),
		});
		if (snapshot.state === "fresh" && snapshot.digest) {
			this.store.setSnapshot(current.taskId, {
				version: 1,
				digest: snapshot.digest,
				reportRevision,
				capturedAt: snapshot.capturedAt,
			});
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
		await this.reconcilePendingDelegations(task.taskId);
		task = this.store.require(task.taskId);
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

		const isGapBlocked = task.state === "blocked" && ((task as any).blockedReasonCode === "attribution-gap" || task.stateReason?.includes("attribution gap") || task.stateReason?.includes("attribution-gap"));
		let gapUnlockApproved = false;

		if (isGapBlocked && verdict === "pass") {
			// Root unlock of attribution-gap blocked task: evaluate conditions (i)-(vi)
			const lastValidator = task.validatorReports.at(-1);
			const oraclePassed = Boolean(lastValidator && (lastWorkerValidationPassed(lastValidator) || (lastValidator.status === "completed" && lastValidator.validation.some(v => v.status === "passed" && v.exitCode === 0))));

			const currentReport = task.reports.at(-1);
			let hasDrift = false;
			let comp = task.lastComparison;
			if (currentReport) {
				const currentSample = await captureEvidence(
					this.gitRunner,
					captureEvidenceOptionsFor(task, currentReport.evidence.workerRunId, {
						...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
					}),
				);
				const freshness = compareFreshness(currentReport.evidence, currentSample);
				hasDrift = !freshness.verifiable || !freshness.fresh || freshness.driftPaths.length > 0 || freshness.headChanged;
			}

			const anyComp = comp as any;
			const otherFindings = (comp?.truthFindings ?? []).filter(f => ["undeclared", "scope", "over-declared", "missing"].includes(f.kind));
			const hasOtherOpenFindings = otherFindings.length > 0
				|| (anyComp?.undeclaredPaths && anyComp.undeclaredPaths.length > 0)
				|| (anyComp?.outOfScopePaths && anyComp.outOfScopePaths.length > 0)
				|| (anyComp?.extraDeclaredPaths && anyComp.extraDeclaredPaths.length > 0)
				|| (anyComp?.missingPaths && anyComp.missingPaths.length > 0);

			const overrideText = [summary, ...(options.findings ?? []).map((f: any) => `${f.category ?? ""} ${f.severity ?? ""} ${f.summary ?? ""} ${JSON.stringify(f)}`)].join(" ");
			const gapPaths: string[] = anyComp?.attributionGapPaths ?? [];
			const namesGapReason = /attribution[- ]gap|baseline incomplete|hash-failed|cap-exceeded/i.test(overrideText);
			const namesSnapshot = /(?:rev|revision|report)\s*\d+/i.test(overrideText) && /(?:status|hash|[0-9a-f]{7,40})/i.test(overrideText);
			const namesOracle = /(?:oracle|validator).*(?:pass|ok)|pass.*(?:oracle|validator)/i.test(overrideText);
			// Fail closed: a gap unlock must document the affected paths, so an
			// empty gap list cannot satisfy this vacuously. A task recorded as
			// attribution-gap whose current comparison names no path has no gap
			// to unlock against; that needs a normal verdict, not this override.
			const namesPaths = gapPaths.length > 0 && gapPaths.every((p: string) => {
				const rel = p.startsWith(task.cwd) ? p.slice(task.cwd.length + 1) : p;
				const base = p.split("/").pop() || p;
				return overrideText.includes(p) || overrideText.includes(rel) || overrideText.includes(base);
			});
			const explicitOverride = (summary.trim().length > 0 || (options.findings && options.findings.length > 0))
				&& namesGapReason && namesSnapshot && namesOracle && namesPaths;

			if (!oraclePassed || hasOtherOpenFindings || hasDrift || !explicitOverride) {
				const refusalReasons: string[] = [];
				if (!oraclePassed) refusalReasons.push("missing passing validator/oracle execution for current revision");
				if (hasOtherOpenFindings) refusalReasons.push("open blocking findings exist (undeclared/scope/over-declared/missing)");
				if (hasDrift) refusalReasons.push("workspace snapshot has drifted");
				if (!explicitOverride) refusalReasons.push("missing explicit override record (must document gap reason, snapshot revision+hash, oracle result, and affected paths)");
				const refusalMsg = refusalReasons.join("; ");
				this.recordRootVerdictRefusal(task, verdict, {
					kind: "attribution-gap-unlock-refused",
					reason: refusalMsg,
				});
				return {
					task: this.store.require(task.taskId),
					decision: {
						action: "blocked",
						nextState: "blocked",
						round: task.reviewRound,
						consumesRound: false,
						failureClass: "evidence",
						reasonCode: "attribution-gap",
						reason: `Root unlock refused: ${refusalMsg}`,
						guidance: [
							"Root may unlock only via explicit override with oracle-backed attribution checks.",
						],
					},
				};
			}
			gapUnlockApproved = true;
		}

		if (task.state === "blocked" || task.state === "failed") {
			this.store.transition(task.taskId, "reviewing");
		}

		const current = this.store.require(task.taskId);
		let report = current.reports.at(-1);
		let rawJudged = false;
		if (!report && current.rawReport) {
			const raw = current.rawReport;
			const rawReport: WorkerReport = {
				version: 1,
				taskId: current.taskId,
				status: verdict === "pass" ? "completed" : verdict === "blocked" ? "blocked" : "partial",
				summary: raw.text,
				changedFiles: [],
				validation: [],
				evidence: {
					cwd: current.cwd,
					taskId: current.taskId,
					workerRunId: raw.executionId,
					generatedAt: raw.receivedAt,
				},
				risks: [raw.error],
				unresolved: [],
			};
			this.store.recordReport(current.taskId, rawReport);
			report = this.store.require(current.taskId).reports.at(-1);
			rawJudged = true;
		}
		let comparison = current.lastComparison;
		let evidence: string | undefined;

		if (verdict === "pass" && report && !rawJudged && acceptanceModeOf(current) === "observation") {
			// Ticket 03 — observation acceptance never fabricates Git freshness:
			// no snapshot binding, no comparison; the verdict binds the report
			// revision and its restricted-reader execution instead.
			comparison = undefined;
			const revision = current.reports.length;
			const producer = [...current.executions].reverse().find((execution) => execution.reportIndex === revision - 1);
			evidence = `observation: report revision ${revision} bound to ${producer ? `${producer.executionId} (restricted-reader, confirmed)` : "no bound execution"}; worktree evidence excluded`;
		} else if (verdict === "pass" && report && !rawJudged) {
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

		if (gapUnlockApproved && comparison) {
			comparison.truthFindings = comparison.truthFindings?.filter(f => f.kind !== "attribution-gap");
			comparison.unexplained = false;
		}

		const review: ReviewResult = {
			taskId: task.taskId,
			verdict,
			summary,
			findings: options.findings ?? [],
			evidenceFresh: comparison ? comparison.fresh : true,
			...(report ? { reportRevision: current.reports.length, reportSource: rawJudged ? "raw-judged" as const : "worker" as const } : {}),
			requestedVerdict: verdict,
			...(report?.evidence?.workerRunId ? { executionId: report.evidence.workerRunId } : {}),
			...(options.acknowledgeDrift ? { acknowledgeDrift: options.acknowledgeDrift } : {}),
			source: gapUnlockApproved ? "root" : (options.source ?? "root"),
			...(gapUnlockApproved ? { attributionGapOverride: true } : {}),
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
		this.store.annotateReviewDecision(task.taskId, decision.action);
		if (decision.action === "revalidate" && decision.evidenceKey) {
			// E02 (spec L106) — a revalidate decision only grants the bounded
			// revalidation; the recovery counter is spent when the revalidation
			// run is actually dispatched (delegate.ts's runDelegation). Verdict rewrites and
			// refused dispatches never consume it.
			this.store.markRevalidationGranted(task.taskId, decision.evidenceKey);
		}
		return {
			task: this.store.require(task.taskId),
			decision,
			...(evidence ? { evidence } : {}),
		};
	}


}
