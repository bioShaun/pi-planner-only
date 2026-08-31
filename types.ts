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

/** Bounds for `git_audit` output. */
export const MAX_GIT_AUDIT_ENTRIES = 200;
export const DEFAULT_GIT_AUDIT_ENTRIES = 20;
export const MAX_GIT_AUDIT_OUTPUT_CHARS = 20000;

export type TaskRole = "worker" | "explorer" | "validator" | "reviewer";

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
 * Git fields are optional: a non-Git directory degrades to changed paths and
 * validation output rather than failing the whole lifecycle.
 */
export interface EvidenceRef {
	cwd: string;
	taskId: string;
	workerRunId: string;
	baseGitRef?: string;
	finalGitRef?: string;
	gitStatusHash?: string;
	changedPaths?: string[];
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
