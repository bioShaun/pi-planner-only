/**
 * In-process Orchestration. The Pi host is an adapter; this module owns
 * Delegation launch, the Review loop, and Task memory writes.
 */

import { resolve } from "node:path";
import {
	captureEvidence,
	captureReviewEvidencePacket,
	compareEvidence,
	describeComparison,
} from "./evidence.ts";
import type { GitRunner } from "./git-audit.ts";
import {
	prepareRoleDelegation,
	resolveDelegationTarget,
} from "./roles.ts";
import type { PrepareRoleDelegationOptions } from "./roles.ts";
import {
	ASYNC_PREVIEW_TRUNCATED_REASON,
	PREVIEW_TRUNCATED_MARKER,
	parseSubagentNotify,
	readLargestRunOutput,
} from "./notify.ts";
import {
	compactWorkerReport,
	extractWorkerReport,
	renderWorkerReport,
	validateWorkerReportIdentity,
} from "./report.ts";
import {
	advanceReview,
	extractReviewResult,
	reviewerPrompt,
	summarizeFindings,
	validateReviewResultIdentity,
} from "./review.ts";
import type { ReviewDecision } from "./review.ts";
import {
	TaskStore,
	createTaskSpec,
	findWriterConflict,
	isExecutingStale,
} from "./task.ts";
import type { TaskRecord, WriterConflict } from "./task.ts";
import {
	DEFAULT_STRUCTURED_DELEGATION_MODE,
	EXECUTING_STALE_MS,
	MAX_REVIEW_ROUNDS,
	MAX_WORKER_REPORT_CHARS,
	isTerminalTaskState,
} from "./types.ts";
import type {
	EvidenceRef,
	ReviewFinding,
	ReviewResult,
	ReviewVerdict,
	StructuredDelegationMode,
	WorkerReport,
} from "./types.ts";

/** Worker output kept as a fallback when a report cannot be parsed at all. */
const RAW_OUTPUT_FALLBACK_CHARS = 4000;

function missingBaseEvidence(task: TaskRecord, workerRunId: string): EvidenceRef {
	return {
		cwd: task.cwd,
		taskId: task.taskId,
		workerRunId,
		gitAvailable: false,
		generatedAt: new Date(0).toISOString(),
	};
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
}

export interface OrchestratorDeps {
	store?: TaskStore;
	gitRunner: GitRunner;
	structuredDelegationMode?: StructuredDelegationMode;
}

/**
 * What a delegation *is*: the role of the child invocation, not the role of the
 * Task. A Task keeps the role it was created with through worker, reviewer, and
 * validation runs (§P1-1).
 */
export type DelegationKind = "worker" | "reviewer" | "explorer" | "validator";

export interface DelegationRecord {
	taskId: string;
	kind: DelegationKind;
	asyncRequested?: boolean;
	runId?: string;
	asyncDir?: string;
	/** Child agent named in the delegation input; used to match single-run notices that carry no runId. */
	agent?: string;
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
	if (detailString(eventDetails(event), "asyncId")) return true;
	if (delegation.asyncRequested) return true;
	if (!text) return false;
	try {
		const value = JSON.parse(text) as Record<string, unknown>;
		return Boolean(value && typeof value === "object" &&
			["runId", "run_id", "runDir", "runDirectory", "handle"].some((key) => key in value));
	} catch {
		// Real asyncByDefault receipts are prose, so continue to marker detection.
	}
	const markers = [
		/^Async:\s+\S+\s+\[[0-9a-f-]{8,}\]/im,
		/detached and running in the background/i,
		/^Run fan-out:/im,
		/^Mission:\s+[0-9a-f-]{8,}/im,
	];
	return markers.filter((marker) => marker.test(text)).length >= 2;
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
	/** toolCallId -> delegated task + invocation kind. */
	private readonly delegations = new Map<string, DelegationRecord>();
	/** runIds whose subagent-notify (or sync result) has already been consumed. */
	private readonly processedRunIds = new Set<string>();

	constructor(deps: OrchestratorDeps) {
		this.store = deps.store ?? new TaskStore();
		this.gitRunner = deps.gitRunner;
		this.structuredDelegationMode =
			deps.structuredDelegationMode ?? readStructuredDelegationMode();
	}

	pendingDelegationCount(): number {
		return this.delegations.size;
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
		const cwd = target?.task?.cwd;
		if (target?.role === "reviewer" && cwd) {
			options.git = await captureReviewEvidencePacket(
				this.gitRunner,
				cwd,
				target.task?.lastComparison,
			);
			if (target.task?.lastComparison) {
				options.evidence = describeComparison(target.task.lastComparison);
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
		const target = resolveDelegationTarget(input, (taskId) => this.store.get(taskId));
		const role = target?.role ?? "worker";
		const spec = target?.spec;
		const warnings: string[] = [];

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
			this.delegations.set(event.toolCallId, {
				taskId,
				kind: "reviewer",
				asyncRequested: isAsyncInput(input),
				...(inputAgent(input) ? { agent: inputAgent(input) } : {}),
			});
			return {
				...(task ? { task } : {}),
				...(warnings.length ? { warnings } : {}),
			};
		}

		if (!spec) {
			const detail = `role ${role} delegated without an embedded TaskSpec; task identity, scope, acceptance criteria, and the WorkerReport contract are unverified.`;
			if (role === "worker" && this.structuredDelegationMode === "strict") {
				return {
					block: {
						reason: [
							`Planner-only guard: ${detail}`,
							"Embed the full TaskSpec JSON in the subagent task prompt.",
							"Set PI_PLANNER_ONLY_STRUCTURED_DELEGATION=warn to allow unstructured worker delegations.",
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
		if (conflict.conflict) {
			return { task, conflict, ...(warnings.length ? { warnings } : {}) };
		}

		if (["planning", "changes_requested", "blocked", "failed"].includes(task.state)) {
			this.store.transition(task.taskId, "executing");
		}

		const base: EvidenceRef = await captureEvidence(this.gitRunner, {
			cwd: task.cwd,
			taskId: task.taskId,
			workerRunId: event.toolCallId,
		});
		this.store.setBaseEvidence(task.taskId, base);
		this.delegations.set(event.toolCallId, {
			taskId: task.taskId,
			kind: role,
			asyncRequested: isAsyncInput(event.input),
			...(inputAgent(event.input) ? { agent: inputAgent(event.input) } : {}),
		});
		return {
			task: this.store.require(task.taskId),
			...(warnings.length ? { warnings } : {}),
		};
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
			...(isExecutingStale(task) ? [`Lock: stale (executing for over ${Math.round(EXECUTING_STALE_MS / 60000)} minutes)`] : []),
			`Evidence: ${report ? (task.lastComparison ? describeComparison(task.lastComparison) : "not compared") : "no report yet"}`,
			`Changed files: ${report?.changedFiles.length ?? 0}`,
		];
		if (task.stateReason) lines.push(`State reason: ${task.stateReason}`);
		if (task.reviews.length > 0) {
			lines.push(`Reviews: ${task.reviews.map((review) => `${review.verdict} (${review.source ?? "reviewer"})`).join(", ")}`);
		}
		if (task.overrides.length > 0) {
			lines.push(`Overrides: ${task.overrides.length}`);
		}
		return lines.join("\n");
	}

	/**
	 * §3 step 2 — why Root may not record `verdict` on `task` right now.
	 * Returns the refusal reason, or undefined when the verdict may proceed.
	 * The operator's review slash command bypasses every refusal except the
	 * terminal-state one; the `planner_verdict` tool honours them all.
	 */
	rootVerdictRefusal(task: TaskRecord, verdict: ReviewVerdict): string | undefined {
		if (isTerminalTaskState(task.state)) {
			return `Task ${task.taskId} is already ${task.state}; use /planner-only task reset to reopen.`;
		}
		if (verdict !== "blocked" && task.reports.length === 0) {
			return `Task ${task.taskId} has no recorded WorkerReport; a pass or change request needs a report to judge.`;
		}
		if (this.hasPendingDelegation(task.taskId)) {
			return `Task ${task.taskId} has a worker/reviewer run still pending; wait for its result before recording a verdict.`;
		}
		if (
			verdict === "pass" &&
			task.reviewMode === "fresh" &&
			!task.reviews.some((review) => (review.source ?? "reviewer") === "reviewer")
		) {
			return `Task ${task.taskId} is in fresh review mode and no reviewer ReviewResult exists yet; delegate the review first — in fresh mode Root arbitrates, it does not pre-empt.`;
		}
		return undefined;
	}

	private hasPendingDelegation(taskId: string): boolean {
		for (const record of this.delegations.values()) {
			if (record.taskId === taskId) return true;
		}
		return false;
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

		const current = this.store.require(task.taskId);
		const report = current.reports.at(-1);
		let comparison = current.lastComparison;
		let evidence: string | undefined;

		if (verdict === "pass" && report) {
			comparison = compareWithRootSamples(
				current,
				await captureEvidence(this.gitRunner, {
					cwd: current.cwd,
					taskId: current.taskId,
					workerRunId: report.evidence.workerRunId,
					...(current.baseEvidence?.finalGitRef
						? { baseGitRef: current.baseEvidence.finalGitRef }
						: {}),
				}),
				report,
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
		if (isAsyncLaunchReceipt(event, delegation)) {
			const runId = runIdFromReceipt(event);
			const asyncDir = detailString(eventDetails(event), "asyncDir");
			if (runId) delegation.runId = runId;
			if (asyncDir) delegation.asyncDir = asyncDir;
			const task = this.store.get(delegation.taskId);
			return task ? { content: [{ type: "text", text: `[PLANNER-ONLY] Async delegation for task ${task.taskId} has started. Await the run result before reviewing.` }] } : undefined;
		}
		this.delegations.delete(event.toolCallId);
		if (delegation.runId) this.processedRunIds.add(delegation.runId);

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

		const text = resultText(event);
		return delegation.kind === "reviewer"
			? this.handleReviewerResult(task, text)
			: this.handleWorkerResult(task, text, event.toolCallId);
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
			const task = this.store.get(found.record.taskId);
			if (!task) continue;
			const fileText = runId ? readLargestRunOutput(found.record.asyncDir, runId) : undefined;
			const chosen = fileText ?? parsed.preview;
			const truncatedWithoutFile = !fileText &&
				(parsed.truncated || chosen.includes(PREVIEW_TRUNCATED_MARKER));
			if (truncatedWithoutFile) {
				outcome = await this.handleWorkerResult(task, chosen, found.toolCallId, {
					forceReportError: ASYNC_PREVIEW_TRUNCATED_REASON,
				});
				continue;
			}
			outcome = await this.handleWorkerResult(task, chosen, found.toolCallId);
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
			const byTask = pending.filter(({ record }) => record.taskId === parsed.taskIdHint);
			if (byTask.length === 1) return byTask;
			if (byTask.length > 1) return [];
		}

		const agent = parsed.agent.trim().toLowerCase();
		const byAgent = pending.filter(({ record }) => !record.agent || !agent || record.agent === agent);
		return byAgent.length === 1 ? byAgent : [];
	}

	private async handleReviewerResult(
		task: TaskRecord,
		text: string,
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

		const review: ReviewResult = { ...extracted.review, source: "reviewer" };
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

		this.store.recordReview(task.taskId, review);
		const report = task.reports.at(-1);
		const comparison = report
			? compareWithRootSamples(
				task,
				await captureEvidence(this.gitRunner, {
					cwd: task.cwd,
					taskId: task.taskId,
					workerRunId: report.evidence.workerRunId,
					...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
				}),
				report,
			)
			: undefined;
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
		options: { forceReportError?: string } = {},
	): Promise<{ content: { type: "text"; text: string }[] }> {
		const extracted = options.forceReportError
			? { error: options.forceReportError }
			: extractWorkerReport(text);
		let report: WorkerReport | undefined;
		let compacted = false;
		let identityErrors: string[] = [];

		if (extracted.report) {
			// §P0-1 — a valid report for the wrong task is not a report.
			identityErrors = validateWorkerReportIdentity(extracted.report, {
				taskId: task.taskId,
				...(toolCallId ? { workerRunId: toolCallId } : {}),
			});
			if (identityErrors.length === 0) {
				const result = compactWorkerReport(extracted.report, MAX_WORKER_REPORT_CHARS);
				report = result.report;
				compacted = result.compacted;
				this.store.recordReport(task.taskId, report);
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
			return {
				content: [{
					type: "text",
					text: [
						identityErrors.length > 0
							? `[PLANNER-ONLY] Worker output for task ${task.taskId} failed the task identity check.`
							: `[PLANNER-ONLY] Worker output for task ${task.taskId} is not a valid WorkerReport.`,
						reportError ?? "no WorkerReport found",
						...(identityErrors.length > 0
							? ["The report was not recorded, and no evidence was accepted from it."]
							: []),
						"Do not accept it. Delegate exactly one report-only correction:",
						`"Do not modify files. Return only a valid WorkerReport for task ${task.taskId}."`,
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

		const latest = this.store.require(task.taskId);
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
					reviewerPrompt(task.taskId),
				].join("\n"),
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
