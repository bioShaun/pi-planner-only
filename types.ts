/**
 * Core v0.2 data structures for the planner-only orchestration layer.
 *
 * The parent process stays a planner/reviewer. Everything that executes is a
 * subagent, so the only thing crossing the boundary in either direction is one
 * of these shapes: `TaskSpec` going down, `WorkerReport` coming back up.
 */

/** WorkerReport wire version. Bump only with a migration. */
export const WORKER_REPORT_VERSION = 1;

/**
 * Root must never receive a worker's full reasoning, shell transcript or test
 * log. Reports above this budget are compacted before they reach the parent.
 */
export const MAX_WORKER_REPORT_CHARS = 12000;

/**
 * Worker initial run is round 0, so this permits three requested fixes before
 * the loop is declared blocked.
 */
export const MAX_REVIEW_ROUNDS = 3;

/** A malformed report gets one report-only correction, then blocks. */
export const MAX_REPORT_CORRECTIONS = 1;

/**
 * E02 — automatic recovery/revalidation retries per Task, on top of the
 * one-per-state rule: the same evidence state is auto-revalidated at most
 * once, and a Task grants at most this many automatic recovery attempts in
 * total. The counter lives on the Task record, so reason-text rewrites and
 * restarts cannot reset it.
 */
export const MAX_RECOVERY_ATTEMPTS = 3;

/**
 * Soft cap on how many intact ledger snapshots session_start restores into the
 * live TaskStore (ticket 38 / F6). Corrupt quarantine placeholders are separate.
 */
export const MAX_LEDGER_RESTORE_PER_SESSION = 64;

/** Tasks that remain executing this long no longer hold a writer lock. */
export const EXECUTING_STALE_MS = (() => {
	const configured = Number(process.env.PI_PLANNER_ONLY_EXECUTING_STALE_MS);
	return Number.isFinite(configured) && configured > 0 ? configured : 30 * 60 * 1000;
})();

/** Bounds for `git_audit` output. */
export const MAX_GIT_AUDIT_ENTRIES = 200;
export const DEFAULT_GIT_AUDIT_ENTRIES = 20;
export const MAX_GIT_AUDIT_OUTPUT_CHARS = 20000;

/** RF-1 — cap on dirty paths hashed per Evidence sample for the T3 baseline comparison. */
export const MAX_BASELINE_HASH_PATHS = 200;

export type TaskRole = "worker" | "explorer" | "validator" | "reviewer";

/** What a delegation *is*: the role of the child invocation, not the Task's role. */
export type DelegationKind = "worker" | "reviewer" | "explorer" | "validator";

export type WorkerStatus = "completed" | "partial" | "blocked" | "failed";

export type ValidationType =
	| "test"
	| "build"
	| "lint"
	| "typecheck"
	| "manual"
	| "other";

export type ValidationStatus = "passed" | "failed" | "not-run";

export type TaskState =
	| "planning"
	| "executing"
	| "reviewing"
	| "changes_requested"
	| "blocked"
	| "completed"
	| "failed";

export type ReviewMode = "root" | "fresh";

export type ReviewVerdict = "pass" | "request_changes" | "blocked";

export type FindingSeverity = "blocker" | "major" | "minor" | "info";

export type FindingCategory =
	| "correctness"
	| "scope"
	| "test"
	| "safety"
	| "regression"
	| "maintainability"
	| "other";

export interface TaskScope {
	allowedPaths?: string[];
	forbiddenPaths?: string[];
}

export interface TaskValidation {
	required: boolean;
	commands?: string[];
	expected?: string[];
}

export interface ExpectedEvidence {
	changedFiles?: boolean;
	diffStat?: boolean;
	gitRef?: boolean;
	tests?: boolean;
}

/**
 * Point-in-time fingerprint of the workspace a worker report refers to.
 *
 * Git fields are optional: a Worker may omit `gitStatusHash` and `finalGitRef`.
 * Root computes authoritative attribution from its own A and C samples; Worker
 * Git fingerprints are declaration data for cross-checking only.
 */
export interface EvidenceRef {
	cwd: string;
	taskId: string;
	workerRunId: string;
	baseGitRef?: string;
	finalGitRef?: string;
	gitStatusHash?: string;
	changedPaths?: string[];
	/**
	 * Working-tree blob hashes for paths dirty at sample time, keyed by the
	 * `changedPaths` entry. Sampled once per A/C endpoint (≤ MAX_BASELINE_HASH_PATHS);
	 * deleted or unreadable paths hash to `null`.
	 */
	dirtyPathHashes?: Record<string, string | null>;
	/** Paths changed between baseGitRef and finalGitRef (C only; empty when refs are equal). */
	committedPaths?: string[];
	/** True when the status probe itself failed at sample time; state is unknown, not clean. */
	statusProbeFailed?: boolean;
	/**
	 * Declared additional worktree roots (absolute) that could not be probed
	 * at sample time. A sample missing any declared root is unverifiable: the
	 * state of that root is unknown, never implicitly clean.
	 */
	unavailableWorktreeRoots?: string[];
	/**
	 * Git top-level Root resolved when this sample was taken. Porcelain paths
	 * are relative to the repository root, so a subdirectory `cwd` must be
	 * normalized against this root, not against `cwd`. Absent on samples taken
	 * before the probe could resolve it; callers then fall back to `cwd`.
	 */
	repoRoot?: string;
	diffStat?: string;
	gitAvailable?: boolean;
	generatedAt: string;
}

/**
 * E01 — one actual child execution's Root-owned evidence record.
 *
 * `aRun` is sampled after write-lock and identity checks pass, immediately
 * before the execution starts. `cReport` is sampled when that execution's
 * final result is received (even when the report cannot be parsed). Worker
 * attribution is the pure `diff(A_run, C_report)` window; freshness is the
 * separate `diff(C_report, C_now)` window. Validator and Explorer executions
 * are recorded as auxiliary and never reset the attribution chain.
 */
export interface TaskExecutionRecord {
	/** Host subagent tool-call id for this invocation. */
	executionId: string;
	taskId: string;
	kind: DelegationKind;
	/** Host async run id when the invocation went async. */
	runId?: string;
	/** True for report-only report revision corrections. */
	reportOnly?: boolean;
	/** Host run id resumed by this execution, when applicable. */
	previousRunId?: string;
	/** Previous attribution-bearing execution in this Task's chain. */
	previousExecutionId?: string;
	/** Read-only or auxiliary invocations never carry Task attribution. */
	auxiliary?: boolean;
	cwd: string;
	worktreeRoots: string[];
	/** Root's pre-execution sample (A_run). */
	aRun: EvidenceRef;
	/** Root's result-receive sample (C_report); absent until the final result arrives. */
	cReport?: EvidenceRef;
	/** 0-based index into `TaskRecord.reports` for this execution's report. */
	reportIndex?: number;
	/** 0-based index into `TaskRecord.validatorReports` for validator output. */
	validatorReportIndex?: number;
	/** Attributed A_run→C_report paths (T1/T2/T3 minus runtime noise). */
	truthPaths?: string[];
	/** In-scope attributed paths the declaration omitted. */
	undeclaredPaths?: string[];
	/** Attributed paths outside the TaskSpec scope. */
	outOfScopePaths?: string[];
	/** Declared paths absent from the attributed delta. */
	extraDeclaredPaths?: string[];
	/** Untracked out-of-scope runtime noise: recorded, never attributed. */
	externalPaths?: string[];
	/** Last freshness comparison of C_report against a later boundary sample. */
	freshness?: {
		verifiable: boolean;
		fresh: boolean;
		reasons: string[];
		driftPaths: string[];
	};
	/** Drift that invalidated this execution's freshness and needs explicit recovery. */
	drift?: {
		detectedAt: string;
		paths: string[];
		reasons: string[];
		/** Later execution whose window proved the drifted change was restored. */
		evidenceResolvedBy?: string;
	};
}

export type TaskFindingKind =
	| "undeclared"
	| "scope"
	| "over-declared"
	| "missing"
	| "drift";

/**
 * A Task-level finding that outlives the execution that produced it. Later
 * rounds may prove with their own Evidence that a change was reverted
 * (`evidenceResolvedBy`), but only a recorded review closes the finding — a
 * disappeared net diff never resolves it on its own.
 */
export interface TaskFinding {
	id: string;
	kind: TaskFindingKind;
	executionId: string;
	paths: string[];
	status: "open" | "resolved";
	detectedAt: string;
	note: string;
	evidenceResolvedBy?: string;
	resolvedBy?: string;
}

/** Downward contract: what the worker is allowed and required to do. */
export interface TaskSpec {
	taskId: string;
	objective: string;
	cwd: string;
	role: TaskRole;
	scope: TaskScope;
	constraints: string[];
	acceptanceCriteria: string[];
	validation: TaskValidation;
	expectedEvidence: ExpectedEvidence;
	stopConditions: string[];
	parentEvidenceRef?: EvidenceRef;
	/**
	 * Extra linked Git worktree roots Root must sample for evidence
	 * attribution, in addition to `cwd`. Paths are absolute (resolved when
	 * the TaskSpec is created). Only these declared roots are probed —
	 * siblings of `cwd` are never discovered via `git worktree list` or
	 * directory scanning. Changes under a declared root are recorded as
	 * absolute paths under that root; relative Worker declarations are
	 * remapped onto a declared root when the primary `cwd` resolution is
	 * absent from the sample but the root-relative form is present.
	 */
	additionalWorktreeRoots?: string[];
	budget?: {
		tokens?: number;
		costUsd?: number;
	};
	/**
	 * Cumulative budget for the whole Task: every role, every retry, one balance.
	 * Distinct from `budget`, which bounds a single delegation and keeps its
	 * existing meaning unchanged.
	 */
	cumulativeBudget?: {
		tokens?: number;
		costUsd?: number;
	};
	/**
	 * Explicit report-only correction marker (ticket 42). Prefer this over
	 * sniffing prompt text; machine-generated correction rounds stamp it.
	 */
	reportOnly?: boolean;
}

export interface ValidationResult {
	command?: string;
	type: ValidationType;
	status: ValidationStatus;
	exitCode?: number;
	summary: string;
	/** Root normalization marker; worker-declared reports omit this field. */
	inferred?: boolean;
}

/** Upward contract: the only structured thing a worker returns. */
export interface WorkerReport {
	version: number;
	taskId: string;
	status: WorkerStatus;
	summary: string;
	changedFiles: string[];
	validation: ValidationResult[];
	evidence: EvidenceRef;
	risks: string[];
	unresolved: string[];
	notes?: string[];
}

/** One `git diff --check` invocation with its outcome kept intact (FR-05 §8.3). */
export interface DiffCheckResult {
	exitCode: number;
	stdout?: string;
	stderr?: string;
}

/** A binary change Root saw in the task window: fingerprint, never a text patch. */
export interface BinaryChange {
	path: string;
	/** Working-tree blob hash, when it could be sampled. */
	fingerprint?: string;
}

/** E01 — one execution round summarized for the Fresh Reviewer packet. */
export interface ReviewRoundAttribution {
	executionId: string;
	role: DelegationKind;
	runId?: string;
	reportRevision?: number;
	/** A_run / C_report head refs for this window. */
	aRef?: string;
	cRef?: string;
	attributedFiles: string[];
	undeclaredFiles: string[];
	outOfScopeFiles: string[];
	freshness?: "fresh" | "stale" | "unknown";
}

/**
 * Bounded Git evidence Root samples for a Fresh Reviewer.
 *
 * Reviewer children launch with `--no-extensions`, so they cannot run
 * `git_audit`. Root is the repository-state authority and passes this packet
 * instead. The patch is bounded against the Task's start baseline; a truncated
 * packet is never presented as complete.
 */
export interface ReviewEvidencePacket {
	gitAvailable: boolean;
	head?: string;
	/** Declared additional worktree roots sampled into this packet (absolute). */
	worktreeRoots?: string[];
	/** Declared roots that could not be sampled; the packet is then truncated. */
	unavailableWorktreeRoots?: string[];
	status?: string;
	changedFiles?: string[];
	diffStat?: string;
	/** Whitespace/conflict-marker check over the working tree (unstaged). */
	diffCheck?: DiffCheckResult;
	/** Same check over the index (staged). */
	diffCheckStaged?: DiffCheckResult;
	/** Task start ref the patch is computed against, when known. */
	baselineRef?: string;
	/** Bounded patch covering staged, unstaged, added, deleted, renamed, and committed Task changes. */
	patch?: string;
	/** Why no patch is included despite a verifiable tree. */
	patchUnavailable?: string;
	/** Files left out of the patch by the size/file budget. */
	patchOmittedPaths?: string[];
	patchTruncated?: boolean;
	patchReturnedFiles?: number;
	patchTotalFiles?: number;
	binaryFiles?: BinaryChange[];
	/** Authoritative A-to-C paths when a Root comparison is available. */
	attributedFiles?: string[];
	/** truthPaths the Worker did not declare. */
	undeclaredFiles?: string[];
	/** Worker-declared paths absent from the A-to-C delta. */
	extraDeclaredFiles?: string[];
	/** E01 — per-execution attribution for the whole Task chain. */
	rounds?: ReviewRoundAttribution[];
	/** E01 — findings that survived earlier rounds and are not yet closed. */
	unresolvedFindings?: string[];
	/** E01 — per-round material is incomplete; a PASS over this packet is ineligible. */
	attributionIncomplete?: string;
}

/**
 * Downward contract for a Fresh Reviewer invocation.
 *
 * A Reviewer is an invocation over a Task, not a Task of its own: this shape
 * carries the original TaskSpec as read-only context and is deliberately
 * transient — it is never persisted in the Task store and never overwrites the
 * Task's spec.
 */
export interface ReviewRequest {
	version: 1;
	taskId: string;
	/** Task the attached WorkerReport belongs to; equals taskId when in sync. */
	reportTaskId: string;
	reviewMode: "fresh";
	workerReport?: WorkerReport;
	/** Report revision the reviewer is shown (task.reports.length at packet time). */
	reportRevision?: number;
	/** Workspace summary digest of the report the reviewer is shown. */
	workspaceDigest?: string;
	taskSpec?: TaskSpec;
	evidenceSummary?: string;
	evidencePacket?: ReviewEvidencePacket;
}

/**
 * Whether a delegation without an embedded TaskSpec is tolerated.
 * `strict` blocks worker delegations that carry no TaskSpec; `warn` only
 * reports them. Default stays `warn` so existing sessions do not break.
 */
export type StructuredDelegationMode = "warn" | "strict";

export const DEFAULT_STRUCTURED_DELEGATION_MODE: StructuredDelegationMode = "warn";

export interface ReviewFinding {
	severity: FindingSeverity;
	category: FindingCategory;
	description: string;
	requestedChange?: string;
	evidence?: string[];
}

export interface ReviewResult {
	taskId: string;
	verdict: ReviewVerdict;
	summary: string;
	findings: ReviewFinding[];
	evidenceFresh: boolean;
	/** Report revision this verdict reviewed; a pass must name it (FR-03 D09). */
	reportRevision?: number;
	/** Workspace summary the reviewed report was validated against. */
	workspaceDigest?: string;
	reviewedEvidenceRef?: EvidenceRef;
	/** Who recorded this verdict; records from before 0.3 read as "reviewer". */
	source?: "reviewer" | "root" | "operator";
}

/** §12 — root arbitration over a disagreeing reviewer. In-memory only. */
export interface ReviewOverride {
	taskId: string;
	reviewerVerdict: ReviewVerdict;
	rootVerdict: ReviewVerdict;
	reason: string;
	at: string;
}

/** States that remain finished for store.active(), abandon, and usage flush. */
export const FINAL_TASK_STATES: readonly TaskState[] = ["completed", "blocked", "failed"];

/** Verdict-path terminal: only completed is closed to planner_verdict. */
export const TERMINAL_TASK_STATES: readonly TaskState[] = ["completed"];

export function isTerminalTaskState(state: TaskState): boolean {
	return TERMINAL_TASK_STATES.includes(state);
}

export function isFinalTaskState(state: TaskState): boolean {
	return FINAL_TASK_STATES.includes(state);
}

/**
 * Whether a TaskSpec-less delegation prompt naming exactly one Task id may
 * bind to that Task. Blocked and failed Tasks stay re-bindable because
 * TASK_TRANSITIONS lets them transition back to executing (task.ts); only
 * completed is a true end of work.
 */
export function canRebindNamedTask(state: TaskState): boolean {
	return state !== "completed";
}

export interface TokenCounts {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning?: number;
}

export type UsagePhase = "planning" | "executing" | "reviewing";

export interface RootUsage extends TokenCounts {
	turns: number;
	/** Turns whose provider returned all-zero token counts. */
	tokensUnknownTurns: number;
	costUsd?: number;          // undefined when no rate was resolvable for ≥1 turn
	byPhase: Record<UsagePhase, TokenCounts & { turns: number }>;
	/** Bytes of read/grep/find/ls/git_audit tool results Root consumed while the Task was reviewing. */
	reviewLeakBytes: number;
	/** Bytes Orchestration injected into Root (decision blocks, rendered reports, reviewer template). */
	injectedBytes: number;
}

export interface ChildUsage extends TokenCounts {
	runId?: string;            // async runs; sync runs use toolCallId
	toolCallId?: string;
	kind: DelegationKind;      // worker | reviewer | explorer | validator
	agent?: string;
	model?: string;
	thinking?: string;
	outcome?: "succeeded" | "failed" | "unknown";
	turns?: number;
	costUsd?: number;
	/**
	 * Ticket 15: what this child is charged while its real spend is unknown.
	 * Set from the budget granted at launch, so the liability is bounded by
	 * something the plugin actually decided rather than by a guess. It is an
	 * ESTIMATE, not a ceiling: nothing proves the host stops the child at the
	 * granted value (ticket 17). Counted only while the real value is absent,
	 * so a resolved child's stale debt field is inert.
	 */
	costDebtUsd?: number;
	/** As costDebtUsd, for the token dimension; counted only while usage is unresolved. */
	tokensDebt?: number;
	/** Usage not yet resolvable (async run, metadata file absent at consume time). */
	pending: boolean;
	source: "sync-details" | "bg-wait" | "meta-file" | "unavailable";
}

export interface TaskUsage {
	root: RootUsage;
	children: ChildUsage[];
	rootModel?: string;        // last Root model seen while this Task was active
	costUnknown: boolean;      // any component lacked a rate
}
