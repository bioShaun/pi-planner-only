/**
 * In-process Orchestration. The Pi host is an adapter; this module owns
 * Delegation launch, the Review loop, and Task memory writes.
 */

import { resolve } from "node:path";
import { captureEvidence, compareEvidence, describeComparison } from "./evidence.ts";
import type { GitRunner } from "./git-audit.ts";
import { prepareRoleDelegation } from "./roles.ts";
import {
	compactWorkerReport,
	extractWorkerReport,
	renderWorkerReport,
} from "./report.ts";
import {
	advanceReview,
	extractReviewResult,
	reviewerPrompt,
	summarizeFindings,
} from "./review.ts";
import type { ReviewDecision } from "./review.ts";
import {
	TaskStore,
	createTaskSpec,
	extractTaskSpec,
	findWriterConflict,
} from "./task.ts";
import type { TaskRecord, WriterConflict } from "./task.ts";
import { MAX_REVIEW_ROUNDS, MAX_WORKER_REPORT_CHARS } from "./types.ts";
import type { EvidenceRef, ReviewResult, ReviewVerdict, WorkerReport } from "./types.ts";
import { delegationPrompt } from "./roles.ts";

/** Worker output kept as a fallback when a report cannot be parsed at all. */
const RAW_OUTPUT_FALLBACK_CHARS = 4000;

export interface SubagentEvent {
	toolCallId: string;
	toolName?: string;
	input?: unknown;
	content?: readonly { type: string; text?: string }[];
}

export interface OrchestratorDeps {
	store?: TaskStore;
	gitRunner: GitRunner;
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

export class PlannerOrchestrator {
	readonly store: TaskStore;
	private readonly gitRunner: GitRunner;
	/** toolCallId -> taskId, so a worker result can be matched to its task. */
	private readonly delegations = new Map<string, string>();

	constructor(deps: OrchestratorDeps) {
		this.store = deps.store ?? new TaskStore();
		this.gitRunner = deps.gitRunner;
	}

	prepareRoleDelegation(rawInput: unknown): void {
		prepareRoleDelegation(rawInput, (taskId) => this.store.get(taskId));
	}

	async beginDelegation(
		event: { toolCallId: string; input?: unknown },
		baseCwd: string,
	): Promise<{ task: TaskRecord; conflict?: WriterConflict }> {
		const input = event.input ?? {};
		const rawCwd = (input as { cwd?: unknown }).cwd;
		const cwd = typeof rawCwd === "string" && rawCwd.trim()
			? resolve(baseCwd, rawCwd.trim())
			: baseCwd;
		const spec = extractTaskSpec(delegationPrompt(input));

		let task: TaskRecord;
		if (spec) {
			task = this.store.get(spec.taskId) ?? this.store.create(spec);
			this.store.bindSpec(task.taskId, spec);
		} else {
			task = this.store.create(createTaskSpec({
				objective: "(unspecified — parent did not embed a TaskSpec)",
				cwd,
			}));
		}
		this.store.ensureCwd(task.taskId, cwd);
		task = this.store.require(task.taskId);

		// Only enforce the write lock when the parent positively declared a
		// writer role via an embedded TaskSpec. An inferred role must not wedge
		// a session that simply delegates twice in the same cwd.
		const conflict = spec
			? findWriterConflict(this.store.list(), task.cwd, task.role, task.taskId)
			: { conflict: false };
		if (conflict.conflict) return { task, conflict };

		if (["planning", "changes_requested", "blocked", "failed"].includes(task.state)) {
			this.store.transition(task.taskId, "executing");
		}

		const base: EvidenceRef = await captureEvidence(this.gitRunner, {
			cwd: task.cwd,
			taskId: task.taskId,
			workerRunId: event.toolCallId,
		});
		this.store.setBaseEvidence(task.taskId, base);
		this.delegations.set(event.toolCallId, task.taskId);
		return { task: this.store.require(task.taskId) };
	}

	renderDecisionBlock(
		task: TaskRecord,
		decision: ReviewDecision,
		evidence?: string,
	): string {
		const current = this.store.require(task.taskId);
		const lines: string[] = ["[PLANNER-ONLY REVIEW STATE]"];
		lines.push(`taskId: ${task.taskId}`);
		lines.push(`state: ${current.state}`);
		lines.push(`round: ${current.reviewRound}/${MAX_REVIEW_ROUNDS}`);
		lines.push(`review mode: ${task.reviewMode}`);
		lines.push(`decision: ${decision.action}`);
		if (evidence) lines.push(`evidence: ${evidence}`);
		lines.push(`reason: ${decision.reason}`);
		lines.push("");
		lines.push(...decision.guidance);
		return lines.join("\n");
	}

	renderTaskStatus(task: TaskRecord): string {
		const report = task.reports.at(-1);
		const lines = [
			`Task: ${task.taskId}`,
			`State: ${task.state}`,
			`Worker round: ${task.reviewRound}/${MAX_REVIEW_ROUNDS}`,
			`Review mode: ${task.reviewMode}`,
			`Evidence: ${report ? (task.lastComparison ? describeComparison(task.lastComparison) : "not compared") : "no report yet"}`,
			`Changed files: ${report?.changedFiles.length ?? 0}`,
		];
		if (task.reviews.length > 0) {
			lines.push(`Reviews: ${task.reviews.map((review) => review.verdict).join(", ")}`);
		}
		if (task.overrides.length > 0) {
			lines.push(`Overrides: ${task.overrides.length}`);
		}
		return lines.join("\n");
	}

	recordRootVerdict(
		task: TaskRecord,
		verdict: ReviewVerdict,
		summary: string,
	): { task: TaskRecord; decision: ReviewDecision } {
		const previous = task.reviews.at(-1);
		if (previous && previous.verdict !== verdict) {
			this.store.recordOverride(task.taskId, {
				reviewerVerdict: previous.verdict,
				rootVerdict: verdict,
				reason: summary,
			});
		}
		const review: ReviewResult = {
			taskId: task.taskId,
			verdict,
			summary,
			findings: [],
			evidenceFresh: task.lastComparison ? task.lastComparison.fresh : true,
		};
		this.store.recordReview(task.taskId, review);
		const latest = this.store.require(task.taskId);
		const { decision } = advanceReview({
			store: this.store,
			taskId: task.taskId,
			...(latest.reports.at(-1) ? { report: latest.reports.at(-1) as WorkerReport } : {}),
			...(latest.lastComparison ? { comparison: latest.lastComparison } : {}),
			review,
		});
		return { task: this.store.require(task.taskId), decision };
	}

	async handleSubagentResult(
		event: SubagentEvent,
	): Promise<{ content: { type: "text"; text: string }[] } | undefined> {
		const taskId = this.delegations.get(event.toolCallId);
		if (!taskId) return;
		this.delegations.delete(event.toolCallId);

		const task = this.store.require(taskId);
		const text = resultText(event);

		const extractedReview = extractReviewResult(text);
		if (extractedReview.review) {
			const review = extractedReview.review;
			this.store.recordReview(taskId, review);
			const report = task.reports.at(-1);
			const comparison = report
				? compareEvidence(report, await captureEvidence(this.gitRunner, {
						cwd: task.cwd,
						taskId,
						workerRunId: event.toolCallId,
						...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
					}), task.spec?.scope ? { scope: task.spec.scope } : {})
				: undefined;
			if (comparison) this.store.setLastComparison(taskId, comparison);
			const { decision } = advanceReview({
				store: this.store,
				taskId,
				...(report ? { report } : {}),
				...(comparison ? { comparison } : {}),
				review,
			});
			return {
				content: [{
					type: "text",
					text: [
						this.renderDecisionBlock(task, decision, comparison ? describeComparison(comparison) : undefined),
						"",
						`[FRESH REVIEWER] verdict: ${review.verdict} (evidenceFresh: ${review.evidenceFresh})`,
						review.summary,
						"",
						...summarizeFindings(review.findings),
					].join("\n"),
				}],
			};
		}

		const extracted = extractWorkerReport(text);
		let report: WorkerReport | undefined;
		let compacted = false;
		if (extracted.report) {
			const result = compactWorkerReport(extracted.report, MAX_WORKER_REPORT_CHARS);
			report = result.report;
			compacted = result.compacted;
			this.store.recordReport(taskId, report);
		} else if (extractedReview.error && task.reviews.length > 0) {
			return {
				content: [{
					type: "text",
					text: [
						`[PLANNER-ONLY] Reviewer output for task ${taskId} is not a valid ReviewResult.`,
						extractedReview.error,
						"Do not accept it. Re-delegate review with the required ReviewResult JSON shape.",
						"",
						truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
					].join("\n"),
				}],
			};
		}

		const current = await captureEvidence(this.gitRunner, {
			cwd: task.cwd,
			taskId,
			workerRunId: event.toolCallId,
			...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
		});
		const comparison = report
			? compareEvidence(report, current, task.spec?.scope ? { scope: task.spec.scope } : {})
			: undefined;
		if (comparison) this.store.setLastComparison(taskId, comparison);
		const { decision } = advanceReview({
			store: this.store,
			taskId,
			...(report ? { report } : {}),
			...(extracted.error ? { reportError: extracted.error } : {}),
			...(comparison ? { comparison } : {}),
		});

		if (!report) {
			return {
				content: [{
					type: "text",
					text: [
						`[PLANNER-ONLY] Worker output for task ${taskId} is not a valid WorkerReport.`,
						extracted.error ?? "no WorkerReport found",
						"Do not accept it. Delegate exactly one report-only correction:",
						`"Do not modify files. Return only a valid WorkerReport for task ${taskId}."`,
						"",
						"--- worker output ---",
						truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
					].join("\n"),
				}],
			};
		}

		const evidenceLabel = comparison
			? describeComparison(comparison)
			: current.gitAvailable === false
				? "git evidence unavailable"
				: "not compared";

		const latest = this.store.require(taskId);
		return {
			content: [{
				type: "text",
				text: [
					this.renderDecisionBlock(task, decision, evidenceLabel),
					"",
					renderWorkerReport(report, {
						round: latest.reviewRound,
						maxRounds: MAX_REVIEW_ROUNDS,
						state: latest.state,
						evidence: evidenceLabel,
						reviewMode: task.reviewMode,
					}),
					...(compacted ? ["", "Note: the report exceeded the parent context budget and was compacted. Re-inspect details with read/grep/git_audit if needed."] : []),
					"",
					"Reviewer prompt template for an isolated fresh review:",
					reviewerPrompt(taskId),
				].join("\n"),
			}],
		};
	}
}
