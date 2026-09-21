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
 * RS-01 — Loaded plugin version and identity fingerprint.
 * Captured once from loaded build in memory, distinct from disk HEAD.
 */
export interface LoadedPluginFingerprint {
	version: 1;
	loadedFingerprint: string;
	sourcePath: string;
	packageVersion: string;
	hostVersion: string;
	subagentVersion: string;
	sessionId: string;
	workspaceId: string;
	capabilities: string[];
	diskHead: string;
	loadedAt: string;
	recordedAt?: string;
}

/** E02 — automatic recovery/revalidation retries per Task, on top of the
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

/** Ticket 06 — bounds for `planner_tasks` diagnostics output. */
export const MAX_TASK_DIAGNOSTIC_EXECUTIONS = 20;
export const MAX_TASK_DIAGNOSTIC_PROBE_FAILURES = 10;
export const MAX_TASK_DIAGNOSTIC_GUIDANCE = 12;
export const MAX_TASK_DIAGNOSTICS_TEXT_CHARS = 20000;

/** RF-1 — cap on dirty paths hashed per Evidence sample for the T3 baseline comparison. */
export const MAX_BASELINE_HASH_PATHS = 200;

/** Ticket 09 — cap on directory entries expanded during scope pre-expansion. */
export const MAX_SCOPE_EXPAND_ENTRIES = 2000;

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
	| "report-invalid"
	| "blocked"
	| "completed"
	| "closed-superseded"
	| "failed";

export type ReviewMode = "root" | "fresh";

export type ReviewVerdict = "pass" | "request_changes" | "blocked";

export type TaskCompletionKind = "superseded" | "committed"

export interface DriftAcknowledgement {
	successorTaskId?: string;
	commit?: boolean;
}

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
 * Git fingerprints are declaration data only: `gitStatusHash` is recorded but never compared (the worker cannot compute Root's hash); freshness is decided from Root's own samples.
 */

/** Ticket 11: explicit gap recorded when content snapshotting is incomplete. */
export interface SnapshotGap {
	reason: "cap-exceeded" | "hash-failed";
	count?: number;
	limit?: number;
	paths: string[];
}

/**
 * Ticket 01 — the classified reason one fixed Git operation could not be
 * sampled. Classification is evidence-based: a kind is only named when the
 * command result supports it (stderr text, killed flag, a thrown runner);
 * an ambiguous non-zero exit stays `probe-error` rather than being guessed
 * from the code alone.
 */
export type GitProbeFailureKind =
	/** stderr evidence that cwd is not inside a Git worktree. */
	| "not-a-git-repository"
	/** The runner threw before Git produced a result (spawn/exec failure). */
	| "git-startup-failed"
	/** The status probe itself returned non-zero — workspace state unknown. */
	| "status-probe-failed"
	/** The host killed the command (timeout/abort), not a normal exit. */
	| "probe-timed-out"
	/** Git ran (or threw) but the failure cannot be reliably classified. */
	| "probe-error";

/** One bounded, credential-masked Git probe failure observation. */
export interface GitProbeFailure {
	/** The fixed Git operation that failed (e.g. "rev-parse --git-dir"). */
	operation: string;
	kind: GitProbeFailureKind;
	/** The directory the operation ran in — names extra worktree roots. */
	cwd: string;
	/** Exit code when Git ran and returned one. */
	exitCode?: number;
	/** True when the host killed the command rather than it exiting. */
	killed?: boolean;
	/** True when the runner threw before a result existed. */
	startupFailed?: boolean;
	/** Bounded, masked error summary (stderr or thrown message). */
	error?: string;
	/** True when `error` was shortened to fit the bound. */
	truncated?: boolean;
}

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
	/** Ticket 11: explicit attribution evidence gap when snapshot is incomplete */
	snapshotGap?: SnapshotGap;
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
	/**
	 * Ticket 01 — per-operation Git probe failures observed while taking this
	 * sample. Absent on clean samples and on pre-T01 ledgers; readers render
	 * those as "not recorded", never fabricate output.
	 */
	probeFailures?: GitProbeFailure[];
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
/**
 * WRC P0-A (spec §2) — execution lifecycle status. `stop_unconfirmed` means a
 * cancel was requested or a terminal arrived but worktree quiescence was never
 * proven: the writer reservation must stay held. Absent on pre-P0-A ledgers;
 * readers treat a missing status as unknown, never as safely stopped.
 */
export type ExecutionLifecycleStatus =
	| "running"
	| "cancel_requested"
	| "stopping"
	| "stop_unconfirmed"
	| "stopped"
	| "completed"
	| "failed";

/**
 * Ticket 02 — the trusted mutation capability of one execution, classified at
 * launch time from the plugin-controlled agent binding — never from the
 * Task's role or a model's self-report. `restricted-reader` means the bound
 * agent's tool surface provably excludes shell/edit/write; `unknown` is the
 * conservative class for records that predate the field or carry no proof.
 */
export type ExecutionCapability = "writer" | "restricted-reader" | "unknown";

/** WRC P0-A (spec §2) — why an execution ended. An observed reason, not a diagnosis. */
export type ExecutionEndedReason =
	| "normal"
	| "worker_runaway"
	| "preparation_runaway"
	| "operator_cancel"
	| "timeout"
	| "tool_budget"
	| "report_only_tool_budget"
	| "provider_failure"
	| "tool_error"
	| "launch_failure";

/** P0-B — the signal that tripped the runaway monitor. */
export type RunawaySignal = "tokens" | "wall" | "preparation";

/** P0-B — observed value and the envelope limit it crossed. */
export interface RunawayObservation {
	signal: RunawaySignal;
	observed: number;
	limit: number;
}

/**
 * Per-execution anomaly envelope. Explicit caller bounds retain
 * `delegation-param`; omitted bounds on ordinary executions are filled from
 * finite program/operator defaults. `source` is persisted for provenance.
 */
export interface ExecutionEnvelope {
	maxTokens?: number;
	maxWallMs?: number;
	maxReadOnlyTools?: number;
	preparationTokensShare?: number;
	source: "delegation-param" | "default" | "operator-config";
}

export interface ExecutionUpdateSnapshot {
	receivedAt: string;
	ordinal: number;
	tokens?: number;
	toolCount?: number;
	durationMs?: number;
	currentTool?: string;
	currentToolArgs?: string;
	recentTools?: Array<{ tool: string; args: string }>;
	recentOutputLines?: string[];
}

export interface ExecutionTraceSummary {
	firstNonReadOnlyToolOrdinal?: number;
	maxTokenDelta?: number;
	readOnlyToolFraction?: number;
	classifiedToolCalls: number;
	observedToolCalls: number;
	totalToolCalls: number;
	coalescedToolCalls: number;
}

export interface ExecutionUsageSnapshot {
	input: null;
	output: null;
	cacheRead: null;
	cacheWrite: null;
	totalTokens: number;
	snapshot: true;
}

/** ADR-0010 admission observation from the original enclosing Request. */
export interface RequestExecutionBudget {
	requestId: string;
	requestDeadline: string | null;
	remainingMs: number | null;
	observedAt: string;
	reserveMs: number;
	availableMs: number | null;
	unavailableReason?: "request-not-started" | "request-mismatch" | "observation-failed";
}

/** A durable ordinary-execution refusal recorded before any child launch. */
export interface TaskLaunchRefusal {
	executionId: string;
	kind: DelegationKind;
	code: "REQUEST_REMAINING_INSUFFICIENT";
	reason: string;
	originalEnvelope: ExecutionEnvelope;
	requestBudget: RequestExecutionBudget;
	reportOnly?: boolean;
}

/** The exact public launcher tool budget sent with one execution. */
export interface ExecutionToolBudget {
	soft?: number;
	hard: number;
	block?: string[] | "*";
}

/**
 * P0-B — a Root recovery decision (spec §5). P0 wires retry_same_plan /
 * fix_environment through planner_redelegate and abort through
 * planner_verdict; the remaining actions are refused until P1.
 */
export interface RecoveryDecision {
	/** The abnormal execution this decision addresses. */
	executionId: string;
	action: string;
	/** Root's diagnosis — non-empty; identical consumed decisions are refused. */
	reason: string;
	evidenceRefs?: string[];
	/** P0: keep residue for the next execution, or manual (operator resolved it). No automatic rollback. */
	worktreeDecision: "keep" | "manual";
}

/** P0-B — needs_replan metadata on the Task (spec §2). */
export interface TaskRecovery {
	required: boolean;
	reason: string;
	/** The execution that triggered the requirement. */
	executionId: string;
	/** Set to "abort" once a verdict-level abort decision lands. */
	nextAction?: string;
	/** The execution (or "planner_verdict") that consumed the requirement. */
	consumedBy?: string;
}

/** A consumed recovery decision, kept for dedupe of reworded retries. */
export interface RecoveryHistoryEntry extends RecoveryDecision {
	consumedBy: string;
	at: string;
}

export interface TaskExecutionRecord {
	/** Host subagent tool-call id for this invocation. */
	executionId: string;
	taskId: string;
	/** P0-A lifecycle status; `beginExecution` writes `running`. */
	status?: ExecutionLifecycleStatus;
	/** Request that admitted this execution. Absent on old ledgers and non-host unit seams. */
	requestId?: string;
	/** Local wall timestamp at the REQUEST outbound boundary; excludes pre-launch Git capture. */
	launchedAt?: string;
	/** Local receipt time of identity-matched launcher STARTED; null means STARTED was not observed. */
	startedAt?: string | null;
	/** Why this execution ended; absent while running or on old ledgers. */
	endedReason?: ExecutionEndedReason;
	/** When a CANCEL was requested (signal abort or WRC). Never used as endedAt. */
	cancelRequestedAt?: string;
	/** When the execution's terminal state was finalized. */
	endedAt?: string;
	/** Monotonic elapsed time from REQUEST outbound through finalization/quiescence. */
	durationMs?: number;
	/** Documents the two endpoints used by durationMs. */
	durationBasis?: "request-outbound-to-finalization";
	/** Original Request closure that caused cancellation; endedReason retains host semantics. */
	requestClosed?: string;
	requestClosedAt?: string;
	/** Set only when the spec §3 quiescence predicate passed. */
	terminationConfirmed?: boolean;
	/**
	 * P0 basis is only `"terminal+quiet-worktree"`: an identity-matched
	 * terminal plus two identical worktree samples after `quiescenceWaitMs`.
	 * Proves the worktree went quiet in the observation window — nothing more.
	 */
	confirmationBasis?: string;
	/**
	 * Residual worktree sample captured after confirmed quiescence (spec §3
	 * C_terminal). Distinct from cReport: it is evidence of what the aborted
	 * window left behind, not a report boundary.
	 */
	cTerminal?: EvidenceRef;
	/**
	 * A worktree sample taken while quiescence was still unproven. Marked
	 * interim by location: it must never stand in for the final residual
	 * window (cTerminal).
	 */
	interimSample?: EvidenceRef;
	/** Stop-evidence sampling failed; blocks automatic write recovery until resolved or manually handled. */
	evidenceIncomplete?: boolean;
	/** True when the terminal's usage was accounted; false keeps the known lower bound instead of inventing a cost. */
	usageComplete?: boolean;
	/** The finite runaway envelope this ordinary execution ran under. */
	envelope?: ExecutionEnvelope;
	/** Caller/default envelope before the enclosing Request wall cap was applied. */
	originalEnvelope?: ExecutionEnvelope;
	/** True when ADR-0010 lowered or supplied the effective wall dimension. */
	envelopeClamped?: boolean;
	/** Original Request observation used for the admission decision. */
	requestBudget?: RequestExecutionBudget;
	/** Public launcher capability sent on REQUEST; absent for ordinary executions. */
	toolBudget?: ExecutionToolBudget;
	/** Registered closed-tool agent used for a report-only correction. */
	reportOnlyAgent?: string;
	/** Host registration proof behind the report-only agent binding. */
	reportOnlyCapabilityBasis?: string;
	/** Unmodified terminal payload received over the versioned launcher contract. */
	rawTerminal?: Record<string, unknown>;
	/** P0-B — which envelope bound tripped, with the observed value. */
	runawayObservation?: RunawayObservation;
	/** Bounded tail of launcher UPDATE observations. */
	updateTrace?: ExecutionUpdateSnapshot[];
	traceSummary?: ExecutionTraceSummary;
	/** Largest valid UPDATE token total, retained independently of the bounded trace and terminal usage. */
	observedTokenHighWater?: number;
	/** Lower-bound cancellation snapshot; replaced by a real terminal usage record when one arrives. */
	usageSnapshot?: ExecutionUsageSnapshot;
	/**
	 * Ticket 02 — the launch-time trusted capability of this execution
	 * (see `ExecutionCapability`). Absent on pre-T02 ledgers: readers treat a
	 * missing value as `unknown`, never as reader.
	 */
	capability?: ExecutionCapability;
	/** Why this capability classification holds (e.g. the bound agent's tool list). */
	capabilityBasis?: string;
	/**
	 * Ticket 01 — the quiescence stop samples in the order taken (first,
	 * second). Kept so a failed first sample is never overwritten by a clean
	 * second one; `interimSample` stays the latest for compatibility.
	 */
	stopSamples?: EvidenceRef[];
	/**
	 * Ticket 05 — a launcher-validated report received on a terminal that was
	 * never admitted to the report sequence (stop unconfirmed, evidence
	 * refusal, or a non-completed terminal). Diagnostic material only: it
	 * binds taskId/executionId/runId, creates no report revision, and never
	 * advances review.
	 */
	unacceptedReport?: WorkerReport;
	/** Why `unacceptedReport` was not admitted. */
	unacceptedReportReason?: string;
	/**
	 * A `completed` report that arrived after a cancel was already requested
	 * (spec §3 race): collected as evidence, never advances review.
	 */
	lateReport?: WorkerReport;
	kind: DelegationKind;
	/** Host async run id when the invocation went async. */
	runId?: string;
	/** True for report-only report revision corrections. */
	reportOnly?: boolean;
	/** True when the trusted launch binding granted this execution read-only capability. */
	readOnly?: boolean;
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
	/** Root-attributed working-tree changes in this execution window (T1/T3). */
	executionChangedPaths?: string[];
	/** Root-attributed paths committed during this execution window (T2). */
	committedPaths?: string[];
	/** Changes observed during a read-only execution, never claimed as its work. */
	observedExternalPaths?: string[];
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
	| "drift"
	| "superseded"
	| "committed"


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

/**
 * Ticket 03 — how a Task's result is accepted. `worktree` keeps the existing
 * Git-evidence acceptance contract. `observation` authorizes a read-only
 * informational delivery: Git-change verification is excluded from the
 * completion condition, while the report's identity, schema, and declared
 * acceptance inputs are still checked. It never asserts that code changes
 * were verified. Root picks the mode at creation; it is immutable thereafter.
 */
export type AcceptanceMode = "worktree" | "observation";

/** A pre-located evidence fragment supplied to a Worker in its TaskSpec. */
export interface ContextPackEntry {
	path: string;
	startLine?: number;
	endLine?: number;
	summary: string;
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
	/**
	 * Ticket 03 — acceptance contract for this Task, chosen by Root at
	 * creation and immutable thereafter. `worktree` (the default, and the
	 * interpretation of a missing field on older ledgers) requires the Git
	 * evidence acceptance path; `observation` is only admissible on
	 * role=explorer Tasks whose execution is a proven restricted reader.
	 */
	acceptanceMode?: AcceptanceMode;
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
	/** Pre-located evidence fragments supplied by Root or an earlier Explorer. */
	contextPack?: ContextPackEntry[];
	/** Paths that should be read before exploratory discovery begins. */
	readFirst?: string[];
	/**
	 * Explicit parent relationship for a derived correction or commit Task.
	 * The parent record keeps the reciprocal id in `successors`.
	 */
	parentTaskId?: string;
	/** A commit Task declares the Task whose work it commits. */
	commitOf?: string;
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

/**
 * Lossless downward packet. TaskSpec is the authority for permissions and
 * acceptance; the remaining fields preserve the Root's task-specific prose
 * without asking the child model to reconstruct it.
 */
export interface TaskPacket {
	version: 1;
	spec: TaskSpec;
	instructions: string;
	knownFacts: string[];
	artifactRefs: string[];
	priorExecution?: {
		executionId: string;
		endedReason?: string;
		runawayObservation?: RunawayObservation;
		diffStat: { aRun: string | null; terminal: string | null; terminalKind: "cTerminal" | "interimSample" | "unavailable" };
		recentTools: Array<{ tool: string; args: string }>;
		recentOutputLines: string[];
		recoveryReason: string;
	};
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
	executionChangedFiles?: string[];
	committedFiles?: string[];
	observedExternalFiles?: string[];
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
	/** Ticket 01 — per-operation probe failures observed while taking this packet. */
	probeFailures?: GitProbeFailure[];
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
	/** Root-attributed working-tree changes (T1/T3), excluding commits. */
	executionChangedFiles?: string[];
	/** Root-attributed paths committed during the execution window (T2). */
	committedFiles?: string[];
	/** Changes observed by a read-only execution, never claimed as its work. */
	observedExternalFiles?: string[];
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
 * Why a Root verdict request was refused. Classified at the decision point
 * (issue 04) so audits never re-derive the kind by matching prose text.
 */
export type RootVerdictRefusalKind =
	| "terminal-state"       // Task is already completed/closed-superseded
	| "no-report"            // no WorkerReport exists to judge
	| "fresh-review-pending" // fresh mode has no reviewer ReviewResult yet
	| "strict-zero-paths"
	| "child-pending"
	| "attribution-gap-unlock-refused"   // strict fresh mode has 0 evidence attribution paths
	| "observation-inadmissible"       // an observation-acceptance gate failed (report/execution/declared-evidence)
	| "report-identity"                // the bound report revision fails the Task/execution identity check at verdict time
	| "recovery-invalid";              // the RecoveryDecision failed validateRecoveryDecision (planner_abort / redelegate gate)

/** Structured refusal of a Root verdict request: typed kind plus prose for display. */
export interface RootVerdictRefusal {
	kind: RootVerdictRefusalKind;
	/** Human-readable reason. Display only — never re-classified by text matching. */
	reason: string;
}

/** Refused Root verdicts are audit rows, not ReviewResults; they never enter `TaskRecord.reviews`. */
export interface RootVerdictRefusalRecord {
	taskId: string;
	requestedVerdict: ReviewVerdict;
	kind: RootVerdictRefusalKind;
	reason: string;
	executionId?: string;
	at: string;
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
	/** Report revision this verdict reviewed; a pass must name it (FR-03 D09). */
	reportRevision?: number;
	/** Workspace summary the reviewed report was validated against. */
	workspaceDigest?: string;
	reviewedEvidenceRef?: EvidenceRef;
	/** Root audit fields: requested input, applied lifecycle decision, and refusal context. */
	requestedVerdict?: ReviewVerdict;
	appliedDecision?: string;
	executionId?: string;
	reportSource?: "worker" | "raw-judged";
	/** Who the Root explicitly acknowledges as the author of accepted drift. */
	acknowledgeDrift?: DriftAcknowledgement;
	/** Completion attribution for superseded/committed acceptance. */
	completionKind?: TaskCompletionKind;
	source?: "reviewer" | "root" | "operator";
	attributionGapOverride?: boolean;
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
export const FINAL_TASK_STATES: readonly TaskState[] = ["completed", "closed-superseded", "blocked", "failed"];

export const TERMINAL_TASK_STATES: readonly TaskState[] = ["completed", "closed-superseded"];

export function isTerminalTaskState(state: TaskState): boolean {
	return TERMINAL_TASK_STATES.includes(state);
}

/**
 * Ticket 02 — restore/gather-time predicate: does this recorded execution
 * require writer isolation? Only a launch-time proven restricted reader is
 * exempt; a missing field (pre-T02 ledgers) is `unknown` and conservative —
 * `readOnly` and the role name never confer the exemption.
 */
export function executionNeedsWriterIsolation(execution: {
	capability?: ExecutionCapability;
}): boolean {
	return execution.capability !== "restricted-reader";
}

/**
 * Ticket 03 — a Task's persisted acceptance contract. A missing field on
 * pre-T03 ledgers means `worktree`; nothing else may produce `observation`.
 */
export function acceptanceModeOf(task: { spec?: { acceptanceMode?: AcceptanceMode } }): AcceptanceMode {
	return task.spec?.acceptanceMode ?? "worktree";
}

export function isFinalTaskState(state: TaskState): boolean {
	return FINAL_TASK_STATES.includes(state);
}

/**
 * Whether a TaskSpec-less delegation prompt naming exactly one Task id may
 * bind to that Task. Blocked and failed Tasks stay re-bindable because
 * TASK_TRANSITIONS lets them transition back to executing (task.ts); only
 * completed and closed-superseded are true ends of work.
 */
export function canRebindNamedTask(state: TaskState): boolean {
	return !isTerminalTaskState(state);
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

/**
 * Provenance fields that travel together for every child run (issue 05): where
 * the run's transcript came from, which Root owns it, which Task/execution it
 * served, and why it stays unknown when binding evidence is missing. One type
 * so the meta reader (notify), the usage ledger (usage), and the adapter
 * (index) cannot drift apart. `observedInSessionId` is deliberately NOT part
 * of this clump: it records where a scan saw the run and is never ownership.
 */
export interface ChildProvenance {
	/** Session the child's transcript came from, when trusted. */
	sourceSessionId?: string;
	/** Host session id carried by the child metadata, when present. */
	sessionId?: string;
	/** True ownership binding captured at launch, when trusted. */
	ownerRootSessionId?: string;
	/** Task the child was delegated for, when trusted. */
	taskId?: string;
	executionId?: string;
	/** Child transcript path as the host names it (not an Evidence sample). */
	transcriptPath?: string;
	/** Lookup hint derived from the source session when no trusted id exists. */
	sessionHint?: string;
	/** Why the child remains unknown instead of being guessed into a Task/session. */
	unknownReason?: string;
}

export interface ChildUsage extends TokenCounts, ChildProvenance {
	runId?: string;            // async runs; sync runs use toolCallId
	toolCallId?: string;
	kind: DelegationKind;      // worker | reviewer | explorer | validator
	agent?: string;
	model?: string;
	thinking?: string;
	/** Root session in which this child was observed; never an ownership binding. */
	observedInSessionId?: string;
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
	/** Uncategorised UPDATE lower bounds retained until matching terminal usage arrives. */
	snapshots?: Array<ExecutionUsageSnapshot & { kind: DelegationKind; toolCallId: string }>;
	rootModel?: string;        // last Root model seen while this Task was active
	costUnknown: boolean;      // any component lacked a rate
}
