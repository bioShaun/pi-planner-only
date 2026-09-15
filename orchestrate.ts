/**
 * In-process Orchestration. The Pi host is an adapter; this module owns
 * the Review loop and Task memory writes; Delegation launch lives in
 * delegate.ts (ADR-0001).
 */

import {
	captureEvidence,
	compareEvidence,
	compareExecutionTruth,
	compareFreshness,
	describeComparison,
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
} from "./review.ts";
import type { ReviewDecision } from "./review.ts";
import { LedgerSnapshotStore, SAFE_TASK_ID } from "./ledger-store.ts";
import type { LedgerCorrupt } from "./ledger-store.ts";
import {
	TaskIdAllocator,
	TaskStore,
	executingStaleMinutes,
	isExplicitlyNoValidation,
	isExecutingStale,
	normalizeWorkspaceIdentity,
} from "./task.ts";
import type { TaskRecord } from "./task.ts";
import {
	MAX_LEDGER_RESTORE_PER_SESSION,
	MAX_RECOVERY_ATTEMPTS,
	MAX_REVIEW_ROUNDS,
	isTerminalTaskState,
} from "./types.ts";
import type {
	DelegationKind,
	EvidenceRef,
	LoadedPluginFingerprint,
	ReviewFinding,
	ReviewResult,
	ReviewVerdict,
	RootVerdictRefusal,
	TaskExecutionRecord,
	TaskCompletionKind,
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
}

export type { DelegationKind };


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
		return { restored, corrupt };
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
		this.store.restore(record);
		this.restoredTaskIds.add(record.taskId);
		return { record: this.store.get(record.taskId) ?? record };
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

	/** Record a refused Root verdict as an auditable review event. */
	recordRootVerdictRefusal(task: TaskRecord, verdict: ReviewVerdict, refusal: RootVerdictRefusal): void {
		this.store.recordReview(task.taskId, {
			taskId: task.taskId,
			verdict,
			summary: `refused: ${refusal.reason}`,
			findings: [],
			evidenceFresh: false,
			requestedVerdict: verdict,
			refusedReason: refusal.reason,
			refusalKind: refusal.kind,
			...(task.reports.at(-1)?.evidence?.workerRunId ? { executionId: task.reports.at(-1)?.evidence.workerRunId } : {}),
			source: "root",
		});
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
		if (task.state === "completed" || (task.state !== "report-invalid" && verdict !== "blocked" && task.reports.length === 0)) {
			return {
				kind: "no-report",
				reason: `Task ${task.taskId} has no recorded WorkerReport; a pass or change request needs a report to judge.`,
			};
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

		if (verdict === "pass" && report && !rawJudged) {
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
