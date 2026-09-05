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
	diffStat?: string;
	gitAvailable?: boolean;
	generatedAt: string;
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
	budget?: {
		tokens?: number;
		costUsd?: number;
	};
}

export interface ValidationResult {
	command?: string;
	type: ValidationType;
	status: ValidationStatus;
	exitCode?: number;
	summary: string;
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

/**
 * Bounded Git evidence Root samples for a Fresh Reviewer.
 *
 * Reviewer children launch with `--no-extensions`, so they cannot run
 * `git_audit`. Root is the repository-state authority and passes this packet
 * instead. Full diffs are never sent.
 */
export interface ReviewEvidencePacket {
	gitAvailable: boolean;
	head?: string;
	status?: string;
	changedFiles?: string[];
	diffStat?: string;
	diffCheck?: string;
	/** Authoritative A-to-C paths when a Root comparison is available. */
	attributedFiles?: string[];
	/** truthPaths the Worker did not declare. */
	undeclaredFiles?: string[];
	/** Worker-declared paths absent from the A-to-C delta. */
	extraDeclaredFiles?: string[];
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

export const TERMINAL_TASK_STATES: readonly TaskState[] = ["completed", "blocked", "failed"];

export function isTerminalTaskState(state: TaskState): boolean {
	return TERMINAL_TASK_STATES.includes(state);
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
	turns?: number;
	costUsd?: number;
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
