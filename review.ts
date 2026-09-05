/**
 * Review lifecycle: verdict derivation, bounded correction loop, and the
 * evidence-driven review policy (spec §7, §8, §10, §19).
 *
 * The extension never declares work done on the worker's behalf. It computes
 * what the parent must do next and hands back a decision plus guidance.
 */

import { MAX_REPORT_CORRECTIONS, MAX_REVIEW_ROUNDS, isTerminalTaskState } from "./types.ts";
import type {
	FindingCategory,
	FindingSeverity,
	ReviewEvidencePacket,
	ReviewFinding,
	ReviewRequest,
	ReviewResult,
	ReviewVerdict,
	TaskSpec,
	TaskState,
	WorkerReport,
} from "./types.ts";
import { evidenceAction } from "./evidence.ts";
import type { EvidenceComparison } from "./evidence.ts";
import { jsonCandidates } from "./report.ts";
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

export interface ReviewDecision {
	action: ReviewAction;
	nextState: TaskState;
	/** Round this decision lands on after the correction is consumed. */
	round: number;
	/** True when acting on this decision uses up one of MAX_REVIEW_ROUNDS. */
	consumesRound: boolean;
	reason: string;
	guidance: string[];
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

export interface FreshReviewerTaskInput {
	taskId: string;
	/** The Task's original spec, shown read-only. Never a reviewer spec. */
	spec?: TaskSpec;
	report?: WorkerReport;
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

function blockedDecision(reason: string, round: number): ReviewDecision {
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
	};
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
				consumesRound: true,
				reason,
				guidance: [
					"Do not accept this result and do not treat it as failure.",
					`Delegate exactly one report-only correction for task ${task.taskId}:`,
					'"Do not modify files. Return only a valid WorkerReport for task <id>."',
					"A second malformed report blocks the task.",
				],
			};
		}
		return blockedDecision(`worker report could not be obtained: ${reason}`, round);
	}

	if (input.report && input.report.status === "blocked") {
		return {
			action: "blocked",
			nextState: "blocked",
			round,
			consumesRound: false,
			reason: "worker reported blocked",
			guidance: [
				"A blocked worker is not a failed worker.",
				"Re-plan: supply the missing dependency, credential, or decision, or ask the user.",
				"Delegate a new bounded TaskSpec only once the blocker is resolved.",
			],
		};
	}

	if (input.report && input.report.status === "failed") {
		if (round < MAX_REVIEW_ROUNDS) {
			return {
				action: "request_changes",
				nextState: "changes_requested",
				round: round + 1,
				consumesRound: true,
				reason: `worker reported failed: ${input.report.summary}`,
				guidance: [
					"Do not patch the failure in the parent.",
					"Delegate a new bounded TaskSpec with the failure summary, the exit codes, and a narrower objective.",
					`This is correction ${round + 1} of ${MAX_REVIEW_ROUNDS}.`,
				],
			};
		}
		return blockedDecision(`worker failed repeatedly: ${input.report?.summary ?? "no summary"}`, round);
	}

	if (input.comparison && evidenceAction(input.comparison) === "revalidate") {
		if (round < MAX_REVIEW_ROUNDS) {
			return {
				action: "revalidate",
				nextState: "changes_requested",
				round: round + 1,
				consumesRound: true,
				reason: `evidence is stale: ${input.comparison.reasons.join("; ")}`,
				guidance: [
					"Stale evidence must not be accepted.",
					"Inspect the current state with read/grep/git_audit, then re-delegate validation for the affected paths.",
					"The correction must re-run validation, not re-implement the change.",
					`This is correction ${round + 1} of ${MAX_REVIEW_ROUNDS}.`,
				],
			};
		}
		return blockedDecision(`evidence stayed stale: ${input.comparison.reasons.join("; ")}`, round);
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
		case "pass":
			return {
				action: "accept",
				nextState: "completed",
				round,
				consumesRound: false,
				reason: review.summary,
				guidance: ["Task accepted. Summarize the outcome and evidence for the user."],
			};
		case "request_changes":
			if (round < MAX_REVIEW_ROUNDS) {
				return {
					action: "request_changes",
					nextState: "changes_requested",
					round: round + 1,
					consumesRound: true,
					reason: review.summary,
					guidance: [
						...summarizeFindings(review.findings),
						"Delegate a bounded correction. Never patch rejected work in the parent.",
						`This is correction ${round + 1} of ${MAX_REVIEW_ROUNDS}.`,
					],
				};
			}
			return blockedDecision(review.summary, round);
		case "blocked":
			return {
				action: "blocked",
				nextState: "blocked",
				round,
				consumesRound: false,
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
