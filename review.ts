/**
 * Review lifecycle: verdict derivation, bounded correction loop, and the
 * evidence-driven review policy (spec §7, §8, §10, §19).
 *
 * The extension never declares work done on the worker's behalf. It computes
 * what the parent must do next and hands back a decision plus guidance.
 */

import { MAX_RECOVERY_ATTEMPTS, MAX_REPORT_CORRECTIONS, MAX_REVIEW_ROUNDS, isTerminalTaskState } from "./types.ts";
import type {
	FindingCategory,
	FindingSeverity,
	ReviewEvidencePacket,
	ReviewFinding,
	ReviewRequest,
	ReviewResult,
	ReviewVerdict,
	TaskCompletionKind,
	TaskSpec,
	TaskState,
	WorkerReport,
} from "./types.ts";
import { evidenceAction } from "./evidence.ts";
import type { EvidenceComparison } from "./evidence.ts";
import { jsonCandidates, stableStringify } from "./report.ts";
import { TASK_TRANSITIONS } from "./task.ts";
import type { TaskRecord, TaskStore } from "./task.ts";

const REVIEW_VERDICTS: readonly ReviewVerdict[] = ["pass", "request_changes", "blocked"];

export type ReviewAction =
	| "accept"
	| "request_changes"
	| "revalidate"
	| "report_correction"
	| "review_pending"
	| "blocked";

/**
 * E02 — structured class of the failure a decision responds to. It decides
 * the next action and whether code-correction rounds are consumed:
 * implementation → Worker correction (bounded rounds); environment → blocked,
 * no round; contract → report-only correction (own counter); evidence →
 * bounded automatic recovery or blocked with recovery conditions.
 */
export type ReviewFailureClass = "implementation" | "environment" | "contract" | "evidence";

export interface ReviewDecision {
	action: ReviewAction;
	nextState: TaskState;
	/** Round this decision lands on after the correction is consumed. */
	round: number;
	/** True when acting on this decision uses up one of MAX_REVIEW_ROUNDS. */
	consumesRound: boolean;
	reason: string;
	guidance: string[];
	/** E02 — structured class of the failure this decision responds to. */
	failureClass?: ReviewFailureClass;
	/** E02 — stable machine-readable reason code. */
	reasonCode?: string;
	/** E02 — evidence-state key granted this automatic recovery attempt. */
	evidenceKey?: string;
	/** RT-02 — completion attribution for successor-owned drift. */
	completionKind?: TaskCompletionKind;
}

/**
 * E02 — structured key of one evidence state: task revision plus the
 * comparison's path-level facts. Reason text is deliberately excluded — text
 * equality is neither necessary nor sufficient for "no progress".
 */
export function evidenceStateKey(comparison: EvidenceComparison, reportRevision: number): string {
	return stableStringify({
		revision: reportRevision,
		verifiable: comparison.verifiable,
		truth: comparison.truthPaths,
		undeclared: comparison.undeclaredPaths,
		extra: comparison.extraDeclaredPaths,
		missing: comparison.missingPaths,
		overlapping: comparison.overlappingPaths,
		unrelated: comparison.unrelatedPaths,
		drift: comparison.freshness?.driftPaths ?? null,
		headChanged: comparison.freshness?.headChanged ?? null,
		boundary: comparison.boundaryRef ?? null,
	});
}

const FINDING_SEVERITIES: readonly FindingSeverity[] = ["blocker", "major", "minor", "info"];
const FINDING_CATEGORIES: readonly FindingCategory[] = [
	"correctness",
	"scope",
	"test",
	"safety",
	"regression",
	"maintainability",
	"other",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * §8.1 — blockers and majors require changes; minors and info alone are the
 * parent's call and default to a pass.
 */
export function deriveVerdict(findings: readonly ReviewFinding[]): ReviewVerdict {
	if (findings.some((finding) => finding.severity === "blocker" || finding.severity === "major")) {
		return "request_changes";
	}
	return "pass";
}

export function validateReviewResult(value: unknown): string[] {
	if (!isPlainObject(value)) return ["ReviewResult must be an object"];
	const errors: string[] = [];
	if (!isNonEmptyString(value.taskId)) errors.push("taskId must be a non-empty string");
	if (!isNonEmptyString(value.verdict) || !REVIEW_VERDICTS.includes(value.verdict as ReviewVerdict)) {
		errors.push(`verdict must be one of ${REVIEW_VERDICTS.join(", ")}`);
	}
	if (typeof value.summary !== "string") errors.push("summary must be a string");
	if (typeof value.evidenceFresh !== "boolean") errors.push("evidenceFresh must be a boolean");
	if (value.acknowledgeDrift !== undefined) {
		if (!isPlainObject(value.acknowledgeDrift)) {
			errors.push("acknowledgeDrift must be an object when present");
		} else {
			const acknowledgement = value.acknowledgeDrift as Record<string, unknown>;
			if (acknowledgement.successorTaskId !== undefined && !isNonEmptyString(acknowledgement.successorTaskId)) {
				errors.push("acknowledgeDrift.successorTaskId must be a non-empty string when present");
			}
			if (acknowledgement.commit !== undefined && typeof acknowledgement.commit !== "boolean") {
				errors.push("acknowledgeDrift.commit must be a boolean when present");
			}
			if (acknowledgement.successorTaskId === undefined && acknowledgement.commit !== true) {
				errors.push("acknowledgeDrift must name successorTaskId or set commit=true");
			}
		}
	}
	if (!Array.isArray(value.findings)) errors.push("findings must be an array");
	else {
		value.findings.forEach((finding, index) => {
			if (!isPlainObject(finding)) {
				errors.push(`findings[${index}] must be an object`);
				return;
			}
			if (
				!isNonEmptyString(finding.severity) ||
				!FINDING_SEVERITIES.includes(finding.severity as FindingSeverity)
			) {
				errors.push(`findings[${index}].severity must be one of ${FINDING_SEVERITIES.join(", ")}`);
			}
			if (
				!isNonEmptyString(finding.category) ||
				!FINDING_CATEGORIES.includes(finding.category as FindingCategory)
			) {
				errors.push(`findings[${index}].category must be one of ${FINDING_CATEGORIES.join(", ")}`);
			}
			if (!isNonEmptyString(finding.description)) {
				errors.push(`findings[${index}].description must be a non-empty string`);
			}
		});
	}
	return errors;
}

export function isReviewResult(value: unknown): value is ReviewResult {
	return validateReviewResult(value).length === 0;
}

export const REVIEWER_PROMPT = `[PLANNER-ONLY FRESH REVIEW]

You are an isolated reviewer for task {TASK_ID}.

You may inspect files using read, grep, find, and ls.
Git evidence is supplied by Root in the review packet.
Do not assume you can execute git or shell commands.
You may not edit, write, or run shell commands, and you may not fix anything.

Review only the candidate paths in this packet:
- taskSpec.scope.allowedPaths
- evidencePacket.attributedFiles or changedFiles
- workerReport.changedFiles
The packet may include a bounded patch against the task's start baseline.
If evidencePacket.patchTruncated is true or patchOmittedPaths is non-empty,
the packet is partial: request more evidence or return verdict blocked.
Never treat a partial packet as a complete review.
The ReviewRequest is your only input: spec, WorkerReport, snapshot digest, and bounded patch.
Do not git log, do not npm test, do not re-probe the repository tree.
Inspect attributed changed files first.
Do not run a codebase health scan or unbounded grep.
Precise extra-path searches are allowed only to verify a specific changed caller or contract.
After checking acceptance criteria, changed paths, and verification evidence, stop.
If this packet lacks enough scope or evidence to locate the change, return verdict blocked.
Do not compensate with a repository-wide scan.

Return only a ReviewResult JSON object:

  {"taskId":"{TASK_ID}","verdict":"pass|request_changes|blocked",
   "summary":"...","evidenceFresh":true,
   "findings":[{"severity":"blocker|major|minor|info",
   "category":"correctness|scope|test|safety|regression|maintainability|other",
   "description":"...","requestedChange":"..."}]}

Verdict rules: any blocker or major finding means request_changes.
Minor or info findings alone may still pass. Do not modify files.`;

export function reviewerPrompt(taskId: string): string {
	return REVIEWER_PROMPT.replaceAll("{TASK_ID}", taskId);
}

/**
 * §P0-2 — a ReviewResult is only meaningful for the task the review was
 * delegated for. A verdict must never be applied to another task.
 */
export function validateReviewResultIdentity(
	review: ReviewResult,
	expectedTaskId: string,
): string[] {
	if (review.taskId === expectedTaskId) return [];
	return [
		`ReviewResult taskId mismatch: expected ${expectedTaskId}, got ${review.taskId}`,
	];
}

/**
 * FR-03 / D09 — a ReviewResult is only meaningful for the report revision and
 * workspace summary it was shown. A stale reviewer PASS must never complete a
 * Task that has a newer report, and a pass that does not name its bindings is
 * refused rather than defaulted to current.
 */
export function validateReviewResultBinding(
	review: ReviewResult,
	expected: { reportRevision: number; workspaceDigest?: string },
): string[] {
	const errors: string[] = [];
	if (review.reportRevision !== undefined && review.reportRevision !== expected.reportRevision) {
		errors.push(
			`ReviewResult reportRevision mismatch: it reviewed revision ${review.reportRevision}, but the latest report is revision ${expected.reportRevision}`,
		);
	}
	if (
		review.workspaceDigest !== undefined &&
		expected.workspaceDigest !== undefined &&
		review.workspaceDigest !== expected.workspaceDigest
	) {
		errors.push(
			"ReviewResult workspaceDigest mismatch: the reviewed workspace summary does not match the latest report",
		);
	}
	if (review.verdict === "pass") {
		if (review.reportRevision === undefined) {
			errors.push(
				"ReviewResult is missing reportRevision; a pass must name the report revision it reviewed",
			);
		}
		// workspaceDigest is conditional on the ReviewRequest: roles.ts only
		// writes it when the Task has a bound snapshot. A pass must not be
		// refused for omitting a field the packet never carried.
		if (review.workspaceDigest === undefined && expected.workspaceDigest !== undefined) {
			errors.push(
				"ReviewResult is missing workspaceDigest; a pass must name the workspace summary it reviewed",
			);
		}
	}
	return errors;
}

/**
 * Ticket 27 / 32 — fill omitted FR-03/D09 bindings from `expected`, which the
 * caller must take from the ReviewRequest packet this reviewer was shown
 * (DelegationRecord.packetBinding). Do not pass the Task's record-time
 * revision/digest: that would stamp a stale omitted pass as current. Explicit
 * values are kept so a mismatch still refuses. workspaceDigest is only filled
 * when the packet carried one (no bound snapshot → leave omitted).
 */
export function bindReviewResultFromRequest(
	review: ReviewResult,
	expected: { reportRevision: number; workspaceDigest?: string },
): ReviewResult {
	return {
		...review,
		...(review.reportRevision === undefined ? { reportRevision: expected.reportRevision } : {}),
		...(review.workspaceDigest === undefined && expected.workspaceDigest !== undefined
			? { workspaceDigest: expected.workspaceDigest }
			: {}),
	};
}

export interface FreshReviewerTaskInput {
	taskId: string;
	/** The Task's original spec, shown read-only. Never a reviewer spec. */
	spec?: TaskSpec;
	report?: WorkerReport;
	/** Report revision shown to the reviewer (task.reports.length at packet time). */
	reportRevision?: number;
	/** Workspace summary digest of the shown report. */
	workspaceDigest?: string;
	/** Freshness summary of the last Root-side evidence comparison. */
	evidence?: string;
	/** Bounded Git-read sample taken by Root (reviewer children have no git). */
	git?: ReviewEvidencePacket;
}

/**
 * Build the ReviewRequest a Fresh Reviewer is invoked with.
 *
 * Deliberately transient: it names the Task and carries the original spec plus
 * the latest report, so reviewing never mutates the Task itself.
 */
export function buildReviewRequest(input: FreshReviewerTaskInput): ReviewRequest {
	return {
		version: 1,
		taskId: input.taskId,
		reportTaskId: input.report?.taskId ?? input.taskId,
		reviewMode: "fresh",
		...(input.spec ? { taskSpec: input.spec } : {}),
		...(input.report ? { workerReport: input.report } : {}),
		...(input.reportRevision !== undefined ? { reportRevision: input.reportRevision } : {}),
		...(input.workspaceDigest ? { workspaceDigest: input.workspaceDigest } : {}),
		...(input.evidence ? { evidenceSummary: input.evidence } : {}),
		...(input.git ? { evidencePacket: input.git } : {}),
	};
}

/**
 * §11.4 — reviewer input is a ReviewRequest, never the parent's reasoning
 * transcript: the original TaskSpec, the latest WorkerReport, and Root's
 * evidence refs.
 */
export function buildFreshReviewerTask(input: FreshReviewerTaskInput): string {
	return [
		reviewerPrompt(input.taskId),
		"",
		"You receive only the ReviewRequest below: the original TaskSpec (read-only),",
		"the latest WorkerReport, and Root's Git evidence.",
		"Do not assume any parent reasoning not present here.",
		"",
		"ReviewRequest:",
		"```json",
		JSON.stringify(buildReviewRequest(input), null, 2),
		"```",
	].join("\n");
}

export function validateReviewRequest(value: unknown): string[] {
	if (!isPlainObject(value)) return ["ReviewRequest must be an object"];
	const errors: string[] = [];
	if (value.version !== 1) errors.push("version must be 1");
	if (!isNonEmptyString(value.taskId)) errors.push("taskId must be a non-empty string");
	if (!isNonEmptyString(value.reportTaskId)) {
		errors.push("reportTaskId must be a non-empty string");
	}
	if (value.reviewMode !== "fresh") errors.push("reviewMode must be fresh");
	return errors;
}

/**
 * Pull the ReviewRequest Root embedded in a reviewer delegation prompt. The
 * packet is the only place the reviewer's task identity is declared, so a
 * malformed one is ignored rather than guessed at.
 */
export function extractReviewRequest(text: string): ReviewRequest | undefined {
	if (typeof text !== "string" || !text.trim()) return undefined;
	for (const candidate of jsonCandidates(text)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(candidate);
		} catch {
			continue;
		}
		if (
			!isPlainObject(parsed) ||
			!("reviewMode" in parsed) ||
			!("reportTaskId" in parsed)
		) {
			continue;
		}
		if (validateReviewRequest(parsed).length === 0) return parsed as unknown as ReviewRequest;
	}
	return undefined;
}

/**
 * Pull a ReviewResult out of a fresh reviewer's output. Reviewers return a
 * different shape than workers, so this is keyed on `verdict` + `findings`.
 */
export function extractReviewResult(text: string): { review?: ReviewResult; error?: string } {
	if (typeof text !== "string" || !text.trim()) return { error: "reviewer returned no output" };

	let bestErrors: string[] | undefined;
	let sawShape = false;

	for (const candidate of jsonCandidates(text)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(candidate);
		} catch {
			continue;
		}
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed) ||
			!("verdict" in parsed) ||
			!("findings" in parsed)
		) {
			continue;
		}
		sawShape = true;
		const errors = validateReviewResult(parsed);
		if (errors.length === 0) return { review: parsed as ReviewResult };
		if (!bestErrors || errors.length < bestErrors.length) bestErrors = errors;
	}

	if (bestErrors) return { error: `invalid ReviewResult: ${bestErrors.join("; ")}` };
	if (sawShape) return { error: "invalid ReviewResult" };
	return { error: "reviewer output did not contain a ReviewResult object" };
}

export function summarizeFindings(findings: readonly ReviewFinding[]): string[] {
	if (findings.length === 0) return ["Findings: (none)"];
	return [
		`Findings (${findings.length}):`,
		...findings.map((finding) => {
			const change = finding.requestedChange ? ` → requested: ${finding.requestedChange}` : "";
			return `- [${finding.severity}] ${finding.category}: ${finding.description}${change}`;
		}),
	];
}

export interface DecideReviewInput {
	task: TaskRecord;
	report?: WorkerReport;
	reportError?: string;
	comparison?: EvidenceComparison;
	review?: ReviewResult;
}

function blockedDecision(
	reason: string,
	round: number,
	opts: { failureClass?: ReviewFailureClass; reasonCode?: string } = {},
): ReviewDecision {
	return {
		action: "blocked",
		nextState: "blocked",
		round,
		consumesRound: false,
		reason,
		guidance: [
			`Automatic correction stopped after ${round} review round(s) (max ${MAX_REVIEW_ROUNDS}).`,
			"Report to the user: what was completed, what is unresolved, how many corrections ran, the last evidence, and why the loop stopped.",
			"Do not fix it in the parent. Ask the user how to proceed or delegate with a materially different plan.",
		],
		...(opts.failureClass ? { failureClass: opts.failureClass } : {}),
		...(opts.reasonCode ? { reasonCode: opts.reasonCode } : {}),
	};
}

export function buildUndeclaredCorrectionGuidance(
	task: TaskRecord,
	comparison?: EvidenceComparison,
): string[] {
	const comp = comparison ?? task.lastComparison;
	const undeclared = comp?.undeclaredPaths ?? [];
	if (undeclared.length === 0) return [];

	const targetState = task.baseEvidence?.finalGitRef
		? `Target state: commit ${task.baseEvidence.finalGitRef}.`
		: "Target state: clean working tree matching baseline snapshot.";

	const pathsStr = undeclared.join(", ");
	const revertAdvice = `Revert undeclared paths (${pathsStr}) rather than committing them.`;

	return [targetState, revertAdvice];
}

const DECLARATION_FINDING_KINDS = new Set(["undeclared", "over-declared", "missing"]);

function isDeclarationOnlyFindings(findings: { kind: string }[]): boolean {
	return findings.length > 0 && findings.every((finding) => DECLARATION_FINDING_KINDS.has(finding.kind));
}

type SupersessionComparison = EvidenceComparison & {
	supersession?: {
		kind: TaskCompletionKind;
		successorTaskId?: string;
	};
};

function supersessionCompletion(
	task: TaskRecord,
	comparison: EvidenceComparison | undefined,
	review: ReviewResult,
): TaskCompletionKind | undefined {
	const metadata = (comparison as SupersessionComparison | undefined)?.supersession;
	if (!metadata) return undefined;
	const acknowledgement = review.acknowledgeDrift;
	if (acknowledgement?.commit === true && metadata.kind === "committed") return "committed";
	if (
		acknowledgement?.successorTaskId
		&& metadata.kind === "superseded"
		&& metadata.successorTaskId === acknowledgement.successorTaskId
		&& (task.successors ?? []).includes(acknowledgement.successorTaskId)
	) return "superseded";
	return metadata.kind;
}

function supersessionAcknowledged(
	task: TaskRecord,
	comparison: EvidenceComparison | undefined,
	review: ReviewResult,
): boolean {
	const metadata = (comparison as SupersessionComparison | undefined)?.supersession;
	const acknowledgement = review.acknowledgeDrift;
	if (!metadata || !acknowledgement) return false;
	if (acknowledgement.commit === true) return metadata.kind === "committed";
	return metadata.kind === "superseded"
		&& metadata.successorTaskId === acknowledgement.successorTaskId
		&& (task.successors ?? []).includes(acknowledgement.successorTaskId ?? "");
}

/**
 * Decide the next lifecycle step for a task under review.
 *
 * Order matters: a missing report, a blocked worker, and stale evidence are all
 * handled before any verdict, because none of them can be resolved by an
 * accept/reject call.
 */
export function decideReview(input: DecideReviewInput): ReviewDecision {
	const { task } = input;
	const round = task.reviewRound;

	// An explicit verdict with no report (a blocked ruling, or the operator's
	// override) still lands; only a *missing* verdict goes to report correction.
	if (!input.report && !input.review) {
		const reason = input.reportError ?? "no WorkerReport was returned";
		if (task.reportCorrections < MAX_REPORT_CORRECTIONS) {
			return {
				action: "report_correction",
				nextState: "changes_requested",
				round: round + 1,
				// E02 — a contract failure burns no code-correction round; the
				// report-correction counter (MAX_REPORT_CORRECTIONS) bounds it.
				consumesRound: false,
				failureClass: "contract",
				reasonCode: input.reportError ? "report-invalid" : "report-missing",
				reason,
				guidance: [
					"Do not accept this result and do not treat it as failure.",
					`Delegate exactly one report-only correction for task ${task.taskId}:`,
					'"Do not modify files. Return only a valid WorkerReport for task <id>."',
					"The top-level status must be exactly completed, partial, blocked, or failed.",
					"The validation status must be exactly passed, failed, or not-run.",
					"A second malformed report blocks the task.",
				],
			};
		}
		return blockedDecision(`worker report could not be obtained: ${reason}`, round, {
			failureClass: "contract",
			reasonCode: "report-exhausted",
		});
	}

	if (input.report && input.report.status === "blocked") {
		return {
			action: "blocked",
			nextState: "blocked",
			round,
			consumesRound: false,
			failureClass: "environment",
			reasonCode: "worker-reported-blocked",
			reason: "worker reported blocked",
			guidance: [
				"A blocked worker is not a failed worker; no correction round was consumed.",
				"The worker's missing-dependency report is a diagnostic, not verified environment state — acceptance gates still apply to anything it produced.",
				"Re-plan: supply the missing dependency, credential, or decision, or ask the user.",
				"Delegate a new bounded TaskSpec only once the blocker is resolved.",
			],
		};
	}

	if (input.report && input.report.status === "failed") {
		if (round < MAX_REVIEW_ROUNDS) {
			const undeclaredGuidance = buildUndeclaredCorrectionGuidance(task, input.comparison);
			return {
				action: "request_changes",
				nextState: "changes_requested",
				round: round + 1,
				consumesRound: true,
				failureClass: "implementation",
				reasonCode: "worker-failed",
				reason: `worker reported failed: ${input.report.summary}`,
				guidance: [
					"Do not patch the failure in the parent.",
					...undeclaredGuidance,
					"Delegate a new bounded TaskSpec with the failure summary, the exit codes, and a narrower objective.",
					`This is correction ${round + 1} of ${MAX_REVIEW_ROUNDS}.`,
				],
			};
		}
		return blockedDecision(`worker failed repeatedly: ${input.report?.summary ?? "no summary"}`, round, {
			failureClass: "implementation",
			reasonCode: "worker-failed-exhausted",
		});
	}

	// E02 — a revision whose A_run/C_report material is missing cannot be
	// validated into existence: the Task needs a new revision or a new Task.
	// Checked before any revalidation guidance: re-delegating validation over
	// missing material cannot produce new information.
	if (input.comparison?.missingMaterials) {
		return {
			action: "blocked",
			nextState: "blocked",
			round,
			consumesRound: false,
			failureClass: "evidence",
			reasonCode: "evidence-missing-materials",
			reason: `evidence material missing: ${input.comparison.missingMaterials}`,
			guidance: [
				"The report revision has no per-execution A_run/C_report binding, so its changes and freshness cannot be verified.",
				"Keep this Task blocked; create a new Task with a new TaskSpec if the work must be redelivered.",
				"Do not re-delegate validation over the same missing material.",
			],
		};
	}

	// E02 — evidence problems route by class. Environment failures (git
	// unavailable, probe failed, declared roots unreadable) cannot be fixed by
	// any re-delegation: block without consuming a round. A stale comparison in
	// a NEW evidence state gets one bounded automatic revalidation; the same
	// state never gets a second one, and a Task grants at most
	// MAX_RECOVERY_ATTEMPTS automatic recoveries in total. The attempted state
	// keys are persisted on the Task before any comparison overwrite, so
	// rewritten reason text or a restart cannot reset the bound.
	//
	// The stale override only gates acceptance paths: a Root/reviewer
	// request_changes verdict is Root's own conservative judgment (no PASS, a
	// correction is delegated) and stands even over stale evidence — forcing
	// it into the validation-retry budget would convert a review into a spin.
	const staleOverride = !input.review || input.review.verdict === "pass";
	if (staleOverride && input.comparison && evidenceAction(input.comparison) === "revalidate") {
		const evidenceKey = evidenceStateKey(input.comparison, task.reports.length);
		if (input.comparison.environmentFailure) {
			return {
				action: "blocked",
				nextState: "blocked",
				round,
				consumesRound: false,
				failureClass: "environment",
				reasonCode: "evidence-unverifiable",
				reason: `evidence cannot be verified in this environment: ${input.comparison.reasons.join("; ")}`,
				guidance: [
					"Re-delegating cannot fix an unreadable workspace: this is an environment failure, not a worker failure.",
					"No correction round was consumed.",
					"Recovery: make the Git repository and every declared worktree root readable again, then record a fresh verdict or report — the Task re-opens through the normal verdict path.",
				],
			};
		}
		const stateSeen = task.recoveryStates.includes(evidenceKey);
		const attemptsLeft = task.recoveryAttempts < MAX_RECOVERY_ATTEMPTS;
		if (stateSeen || !attemptsLeft) {
			return {
				action: "blocked",
				nextState: "blocked",
				round,
				consumesRound: false,
				failureClass: "evidence",
				reasonCode: stateSeen ? "evidence-no-progress" : "recovery-limit",
				reason: stateSeen
					? `no progress: this evidence state was already revalidated for report revision ${task.reports.length}`
					: `automatic recovery limit reached (${task.recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS} attempts used)`,
				guidance: [
					`Evidence gap: ${input.comparison.reasons.join("; ")}`,
					"Automatic re-delegation stopped; no correction round was consumed.",
					"Recovery (any one of): a new WorkerReport revision with bound evidence, an actually changed workspace (new HEAD or content), or an explicit operator decision on this Task.",
					"Do not re-delegate validation over the same state.",
				],
			};
		}
		const undeclaredGuidance = buildUndeclaredCorrectionGuidance(task, input.comparison);
		return {
			action: "revalidate",
			nextState: "changes_requested",
			round,
			// E02 — recovery revalidations are bounded by their own persisted
			// counter (recoveryAttempts / MAX_RECOVERY_ATTEMPTS), deliberately
			// separate from the code-correction round budget.
			consumesRound: false,
			failureClass: "evidence",
			reasonCode: "evidence-stale",
			evidenceKey,
			reason: `evidence is stale: ${input.comparison.reasons.join("; ")}`,
			guidance: [
				"Stale evidence must not be accepted.",
				...undeclaredGuidance,
				"Next step: re-delegate validation for the affected paths — one bounded validation; a bounded oracle check is enough when the worker's validation already exited 0.",
				`Automatic recovery attempt ${task.recoveryAttempts + 1} of ${MAX_RECOVERY_ATTEMPTS}.`,
			],
		};
	}

	// E01/E02 — under-report and other declaration gaps are a contract repair
	// (report-only, own counter). Scope and remaining findings still need a
	// Worker correction and consume a code-correction round.
	if ((input.comparison?.truthFindings?.length ?? 0) > 0) {
		const findings = input.comparison?.truthFindings ?? [];
		const label = findings
			.map((finding) => `${finding.kind} [${finding.paths.join(", ") || "revision changed"}]`)
			.join("; ");
		if (isDeclarationOnlyFindings(findings)) {
			if (task.reportCorrections < MAX_REPORT_CORRECTIONS) {
				const undeclaredGuidance = buildUndeclaredCorrectionGuidance(task, input.comparison);
				return {
					action: "report_correction",
					nextState: "changes_requested",
					round,
					consumesRound: false,
					failureClass: "contract",
					reasonCode: "report-undeclared",
					reason: `evidence findings: ${label}`,
					guidance: [
						"Unresolved evidence findings must be repaired in a new revision; a PASS is not eligible.",
						...undeclaredGuidance,
						"Routing: an undeclared-only gap is repaired with one report-only correction that declares the work; out-of-scope changes need a Worker correction that reverts or fixes them.",
						`Delegate exactly one report-only correction for task ${task.taskId}:`,
						'"Do not modify files. Return only a valid WorkerReport for task <id>."',
						"The top-level status must be exactly completed, partial, blocked, or failed.",
						"The validation status must be exactly passed, failed, or not-run.",
					],
				};
			}
			return blockedDecision(`evidence findings unresolved: ${label}`, round, {
				failureClass: "contract",
				reasonCode: "report-exhausted",
			});
		}
		if (round < MAX_REVIEW_ROUNDS) {
			const undeclaredGuidance = buildUndeclaredCorrectionGuidance(task, input.comparison);
			return {
				action: "request_changes",
				nextState: "changes_requested",
				round: round + 1,
				consumesRound: true,
				failureClass: "implementation",
				reasonCode: "evidence-findings",
				reason: `evidence findings: ${label}`,
				guidance: [
					"Unresolved evidence findings must be repaired in a new revision; a PASS is not eligible.",
					...undeclaredGuidance,
					"Routing: an undeclared-only gap is repaired with one report-only correction that declares the work; out-of-scope changes need a Worker correction that reverts or fixes them.",
					`This is correction ${round + 1} of ${MAX_REVIEW_ROUNDS}.`,
				],
			};
		}
		return blockedDecision(`evidence findings unresolved: ${label}`, round, {
			failureClass: "implementation",
			reasonCode: "evidence-findings-exhausted",
		});
	}

	if (!input.review) {
		return {
			action: "review_pending",
			nextState: "reviewing",
			round,
			consumesRound: false,
			reason: "awaiting the parent's review verdict",
			guidance: [
				"Verify task identity, evidence freshness, and acceptance criteria.",
				"Inspect the changed files and git state with read/grep/git_audit.",
				"Record the verdict with the planner_verdict tool: {verdict, summary, findings?}.",
				task.reviewMode === "fresh"
					? "A fresh reviewer is expected: delegate the review first; call planner_verdict only to arbitrate its result."
					: "Root review is active; record the verdict yourself with planner_verdict.",
			],
		};
	}

	const review = input.review;
	switch (review.verdict) {
		case "pass": {
			const completionKind = supersessionCompletion(task, input.comparison, review);
			const explicitlyAcknowledged = review.acknowledgeDrift !== undefined;
			const acknowledged = supersessionAcknowledged(task, input.comparison, review);
			return {
				action: "accept",
				nextState: completionKind ? (explicitlyAcknowledged && acknowledged ? "completed" : "closed-superseded") : "completed",
				round,
				consumesRound: false,
				failureClass: "implementation",
				reasonCode: completionKind ? `review-pass-${completionKind}` : "review-pass",
				reason: review.summary,
				...(completionKind ? { completionKind } : {}),
				guidance: [
					completionKind
						? `Task accepted with ${completionKind} attribution; no evidence recovery is required.`
						: "Task accepted. Summarize the outcome and evidence for the user.",
				],
			};
		}
		case "request_changes":
			if (round < MAX_REVIEW_ROUNDS) {
				const undeclaredGuidance = buildUndeclaredCorrectionGuidance(task, input.comparison);
				return {
					action: "request_changes",
					nextState: "changes_requested",
					round: round + 1,
					consumesRound: true,
					failureClass: "implementation",
					reasonCode: "review-request-changes",
					reason: review.summary,
					guidance: [
						...summarizeFindings(review.findings),
						...undeclaredGuidance,
						"Delegate a bounded correction. Never patch rejected work in the parent.",
						`This is correction ${round + 1} of ${MAX_REVIEW_ROUNDS}.`,
					],
				};
			}
			return blockedDecision(review.summary, round, {
				failureClass: "implementation",
				reasonCode: "review-changes-exhausted",
			});
		case "blocked":
			return {
				action: "blocked",
				nextState: "blocked",
				round,
				consumesRound: false,
				failureClass: "evidence",
				reasonCode: "review-blocked",
				reason: review.summary,
				guidance: [
					"Report the blocker and the evidence to the user.",
					"Do not retry the same plan without a new decision or input from the user.",
				],
			};
	}
}

/**
 * Apply a ReviewDecision to the Task store. Decide and apply share this
 * module so round ordering and terminal guards have locality.
 */
export function applyReviewDecision(
	store: TaskStore,
	taskId: string,
	decision: ReviewDecision,
): TaskRecord {
	const task = store.require(taskId);
	if (isTerminalTaskState(task.state)) return task;
	if (task.state !== "reviewing") {
		// A verdict recorded without re-delegating (e.g. via /planner-only
		// review) still passes through the spec's EXECUTING -> REVIEWING hop.
		if (!TASK_TRANSITIONS[task.state].includes("reviewing")) {
			store.transition(taskId, "executing");
		}
		store.transition(taskId, "reviewing");
	}
	if (decision.nextState !== "reviewing" && store.require(taskId).state === "reviewing") {
		store.transition(taskId, decision.nextState);
	}
	if (decision.action === "report_correction") store.useReportCorrection(taskId);
	if (decision.consumesRound) store.incrementRound(taskId);
	// Recovery accounting is performed by the dispatch boundary after a real
	// automatic revalidation launch succeeds; deciding a stale pass alone is
	// deliberately side-effect free.
	if (decision.completionKind) store.setCompletionKind(taskId, decision.completionKind);
	return store.require(taskId);
}

export interface AdvanceReviewInput {
	store: TaskStore;
	taskId: string;
	report?: WorkerReport;
	reportError?: string;
	comparison?: EvidenceComparison;
	review?: ReviewResult;
}

/** Decide then apply. The Review loop's external interface. */
export function advanceReview(input: AdvanceReviewInput): {
	task: TaskRecord;
	decision: ReviewDecision;
} {
	const task = input.store.require(input.taskId);
	const decision = decideReview({
		task,
		...(input.report ? { report: input.report } : {}),
		...(input.reportError ? { reportError: input.reportError } : {}),
		...(input.comparison ? { comparison: input.comparison } : {}),
		...(input.review ? { review: input.review } : {}),
	});
	return { task: applyReviewDecision(input.store, input.taskId, decision), decision };
}
