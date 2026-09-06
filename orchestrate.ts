/**
 * In-process Orchestration. The Pi host is an adapter; this module owns
 * Delegation launch, the Review loop, and Task memory writes.
 */

import { resolve, join } from "node:path";
import {
	captureEvidence,
	captureReviewEvidencePacket,
	compareEvidence,
	describeComparison,
} from "./evidence.ts";
import type { GitRunner } from "./git-audit.ts";
import {
	inferRoleFromAgent,
	delegationPrompt,
	prepareRoleDelegation,
	promptTaskIds,
	resolveDelegationTarget,
} from "./roles.ts";
import type { DelegationTarget, PrepareRoleDelegationOptions } from "./roles.ts";
import {
	ASYNC_PREVIEW_TRUNCATED_REASON,
	PREVIEW_TRUNCATED_MARKER,
	parseSubagentNotify,
	readChildMeta,
	readLargestRunOutput,
	tempRootFromAsyncDir,
} from "./notify.ts";
import {
	compactWorkerReport,
	extractWorkerReport,
	renderValidationResults,
	renderWorkerReport,
	validateWorkerReportIdentity,
} from "./report.ts";
import {
	advanceReview,
	extractReviewRequest,
	extractReviewResult,
	summarizeFindings,
	validateReviewResultIdentity,
} from "./review.ts";
import type { ReviewDecision } from "./review.ts";
import {
	TaskStore,
	createTaskSpec,
	extractTaskSpec,
	findWriterConflict,
	isExecutingStale,
} from "./task.ts";
import type { TaskRecord, WriterConflict } from "./task.ts";
import {
	DEFAULT_STRUCTURED_DELEGATION_MODE,
	EXECUTING_STALE_MS,
	MAX_REVIEW_ROUNDS,
	MAX_WORKER_REPORT_CHARS,
	canRebindNamedTask,
	isFinalTaskState,
} from "./types.ts";
import type {
	DelegationKind,
	EvidenceRef,
	ReviewFinding,
	ReviewResult,
	ReviewVerdict,
	StructuredDelegationMode,
	WorkerReport,
} from "./types.ts";

/** Worker output kept as a fallback when a report cannot be parsed at all. */
const RAW_OUTPUT_FALLBACK_CHARS = 4000;
const PROSE_ONLY_REPORT_ERROR = "worker output did not contain a WorkerReport object";
const TASK_ID_SHAPE = /^T-(\d{8})-\d{3}$/;

function localDateStamp(now: Date): string {
	const year = String(now.getFullYear());
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}${month}${day}`;
}

function shouldReplaceTaskId(taskId: string, now: Date): boolean {
	const match = TASK_ID_SHAPE.exec(taskId);
	if (!match) return true;
	return match[1] !== localDateStamp(now);
}

function rewriteReportToCanonical(
	report: WorkerReport,
	task: TaskRecord,
	repairs: string[],
): WorkerReport {
	if (report.taskId === task.taskId && report.evidence.taskId === task.taskId) return report;
	const from = report.taskId;
	repairs.push(`taskId ${from} → ${task.taskId}`);
	return {
		...report,
		taskId: task.taskId,
		evidence: { ...report.evidence, taskId: task.taskId },
	};
}

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
 * FR-01 — bind a recorded report to the Root sample taken when it was
 * validated. These fields are Root-owned: at the acceptance boundary
 * compareEvidence re-samples and detects content drift the worker could never
 * declare (same status/HEAD, different bytes).
 */
function bindReportToSample(report: WorkerReport, sample: EvidenceRef): WorkerReport {
	if (sample.gitAvailable === false) return report;
	return {
		...report,
		evidence: {
			...report.evidence,
			...(sample.finalGitRef ? { finalGitRef: sample.finalGitRef } : {}),
			...(sample.gitStatusHash ? { gitStatusHash: sample.gitStatusHash } : {}),
			...(sample.dirtyPathHashes ? { dirtyPathHashes: sample.dirtyPathHashes } : {}),
		},
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
	isError?: boolean;
}

export interface OrchestratorDeps {
	store?: TaskStore;
	gitRunner: GitRunner;
	structuredDelegationMode?: StructuredDelegationMode;
	/**
	 * Where child-run artifacts (`<runId>_<agent>_meta.json`, saved outputs)
	 * live. The Pi adapter supplies session/cwd-derived directories; reconcile
	 * needs them to detect runs that finished without delivering a notice.
	 */
	artifactDirs?: () => readonly string[];
}

export type { DelegationKind };

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

/** The subagent agent name each delegation kind launches by default. */
const KIND_DEFAULT_AGENTS: Record<DelegationKind, string> = {
	worker: "worker",
	reviewer: "reviewer",
	explorer: "explorer",
	validator: "oracle",
};

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
	private readonly artifactDirs: () => readonly string[];
	/** toolCallId -> delegated task + invocation kind. */
	private readonly delegations = new Map<string, DelegationRecord>();
	/** runIds whose subagent-notify (or sync result) has already been consumed. */
	private readonly processedRunIds = new Set<string>();

	constructor(deps: OrchestratorDeps) {
		this.store = deps.store ?? new TaskStore();
		this.gitRunner = deps.gitRunner;
		this.artifactDirs = deps.artifactDirs ?? (() => []);
		this.structuredDelegationMode =
			deps.structuredDelegationMode ?? readStructuredDelegationMode();
	}

	pendingDelegationCount(): number {
		return this.delegations.size;
	}

	getDelegation(toolCallId: string): DelegationRecord | undefined {
		return this.delegations.get(toolCallId);
	}

	listDelegations(): { toolCallId: string; record: DelegationRecord }[] {
		return [...this.delegations.entries()].map(([toolCallId, record]) => ({ toolCallId, record }));
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

		// A Validator is an invocation over an existing Task: it must not create,
		// rebind, transition, or sample.
		if (target?.role === "validator" || inferRoleFromAgent(inputAgent(input)) === "validator") {
			const reviewed = this.resolveValidatorReviewedTask(input, cwd, target);
			if (!reviewed) {
				const prompt = delegationPrompt(input);
				const specId = (target?.spec ?? extractTaskSpec(prompt))?.taskId;
				const named = promptTaskIds(prompt);
				const placeholder = specId
					?? (named.length === 1 ? named[0] : undefined)
					?? `unbound-validator-${event.toolCallId}`;
				this.delegations.set(event.toolCallId, {
					taskId: placeholder,
					kind: "validator",
					asyncRequested: isAsyncInput(input),
					...(inputAgent(input) ? { agent: inputAgent(input) } : {}),
				});
				return {
					warnings: [
						"Planner-only: validator delegation names no Task under review; delegate the worker first, then re-delegate validation naming its taskId.",
					],
				};
			}
			const specId = (target?.spec ?? extractTaskSpec(delegationPrompt(input)))?.taskId;
			if (specId && specId !== reviewed.taskId) {
				warnings.push(
					`Planner-only: validator TaskSpec id ${specId} ignored; validating task ${reviewed.taskId}`,
				);
			}
			this.delegations.set(event.toolCallId, {
				taskId: reviewed.taskId,
				kind: "validator",
				asyncRequested: isAsyncInput(input),
				...(inputAgent(input) ? { agent: inputAgent(input) } : {}),
			});
			return {
				task: reviewed,
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
			const existing = this.store.get(spec.taskId);
			if (existing) {
				task = existing;
				this.store.bindSpec(
					existing.taskId,
					spec.taskId === existing.taskId ? spec : { ...spec, taskId: existing.taskId },
				);
			} else if (shouldReplaceTaskId(spec.taskId, this.store.now())) {
				const generated = this.store.nextTaskId();
				const storedSpec = { ...spec, taskId: generated };
				task = this.store.create(storedSpec, spec.taskId);
				warnings.push(
					`Planner-only: TaskSpec id ${spec.taskId} replaced by ${generated} (generated); ${spec.taskId} is kept as an alias`,
				);
			} else {
				task = this.store.create(spec);
				this.store.bindSpec(task.taskId, spec);
			}
		} else {
			const named = target?.namedTaskIds ?? [];
			const liveNamed = target?.task && canRebindNamedTask(target.task.state)
				? target.task
				: undefined;
			if (liveNamed) {
				task = liveNamed;
				// Roles with no base warning (e.g. explorer) would silently lose
				// the attachment notice, so emit it standalone in that case.
				if (warnings.length > 0) {
					warnings[warnings.length - 1] += `; attached to task ${liveNamed.taskId} named in the prompt`;
				} else {
					warnings.push(`Planner-only: attached to task ${liveNamed.taskId} named in the prompt`);
				}
			} else {
				const active = this.store.active();
				if (
					named.length === 0
					&& active
					&& active.cwd === cwd
					&& (active.state === "changes_requested" || active.state === "reviewing")
				) {
					task = active;
					if (warnings.length > 0) {
						warnings[warnings.length - 1] += `; attached to active task ${active.taskId}`;
					} else {
						warnings.push(`Planner-only: attached to active task ${active.taskId}`);
					}
				} else if (role === "explorer") {
					// An explorer binds to no Task: it is read-only and needs no
					// writer contract, so mirror the unbound-validator placeholder
					// instead of creating a placeholder Task for a read-only pass.
					this.delegations.set(event.toolCallId, {
						taskId: `unbound-explorer-${event.toolCallId}`,
						kind: "explorer",
						asyncRequested: isAsyncInput(input),
						...(inputAgent(input) ? { agent: inputAgent(input) } : {}),
					});
					return {
						warnings: [
							"Planner-only: explorer delegation is not attached to any Task; its output is returned as-is.",
						],
					};
				} else {
					task = this.store.create(createTaskSpec({
						objective: "(unspecified — parent did not embed a TaskSpec)",
						cwd,
					}));
					if (named.length >= 1) {
						warnings.push(
							`Planner-only: prompt names task ${named.join(", ")} but no single live Task matched`,
						);
					}
				}
			}
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

		task = this.store.require(task.taskId);
		if (role !== "explorer" && this.store.baseRoundEnded(task.taskId)) {
			// A report was recorded against the current base: that review round
			// is over and the next one gets its own A.
			this.store.clearBaseEvidence(task.taskId);
			task = this.store.require(task.taskId);
		}
		if (role !== "explorer" && !task.baseEvidence) {
			const base: EvidenceRef = await captureEvidence(this.gitRunner, {
				cwd: task.cwd,
				taskId: task.taskId,
				workerRunId: event.toolCallId,
			});
			this.store.setBaseEvidence(task.taskId, base);
		}
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

	/**
	 * §5 — first match wins: ReviewRequest.taskId; an embedded TaskSpec whose
	 * id (or alias) is an existing Task; exactly one distinct known Task named
	 * in the prompt; otherwise the active Task in this cwd with a report.
	 */
	private resolveValidatorReviewedTask(
		input: unknown,
		cwd: string,
		target: DelegationTarget | undefined,
	): TaskRecord | undefined {
		const prompt = delegationPrompt(input);
		const request = extractReviewRequest(prompt);
		const spec = target?.spec ?? extractTaskSpec(prompt);
		if (request?.taskId) return this.store.get(request.taskId);
		if (spec?.taskId) {
			const existing = this.store.get(spec.taskId);
			if (existing) return existing;
		}
		const unique: TaskRecord[] = [];
		const seen = new Set<string>();
		for (const id of promptTaskIds(prompt)) {
			const found = this.store.get(id);
			if (found && !seen.has(found.taskId)) {
				seen.add(found.taskId);
				unique.push(found);
			}
		}
		if (unique.length === 1) return unique[0] as TaskRecord;
		const active = this.store.active();
		if (active && active.cwd === cwd && active.reports.length >= 1) return active;
		return undefined;
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
		if (evidence) {
			const sha7 = current.baseEvidence?.finalGitRef?.slice(0, 7);
			lines.push(`evidence: ${evidence}${sha7 ? ` base ${sha7}` : ""}`);
		}
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
			...(task.validatorReports.length > 0 ? [`Validator reports: ${task.validatorReports.length}`] : []),
		];
		if (task.aliases.length > 0) lines.push(`aliases: ${task.aliases.join(", ")}`);
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
	 *
	 * A live pending child blocks pass/request_changes, but never `blocked`:
	 * the escape hatch must stay open even when a completion notice was lost.
	 */
	rootVerdictRefusal(task: TaskRecord, verdict: ReviewVerdict): string | undefined {
		if (task.state === "completed") {
			return `Task ${task.taskId} is already completed; verdicts are final. Start a new Task with a new TaskSpec for further work.`;
		}
		if (verdict !== "blocked" && task.reports.length === 0) {
			return `Task ${task.taskId} has no recorded WorkerReport; a pass or change request needs a report to judge.`;
		}
		if (verdict !== "blocked" && this.hasPendingDelegation(task.taskId)) {
			return `Task ${task.taskId} has a child run still pending; wait for its result before recording a verdict.`;
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

	private delegationArtifactDirs(record: DelegationRecord): string[] {
		const dirs = [...this.artifactDirs()];
		if (record.asyncDir) {
			const root = tempRootFromAsyncDir(record.asyncDir);
			if (root) dirs.push(join(root, "artifacts"));
		}
		return dirs;
	}

	/**
	 * Consume one pending Delegation whose child run is already terminal
	 * (numeric exitCode in its meta file) but whose completion notice never
	 * arrived. The saved output is fed through the normal result path, so a
	 * finished run records its WorkerReport / validator result instead of
	 * deadlocking the Task. Idempotent: the runId is marked processed first.
	 * Returns true when the delegation was consumed.
	 */
	private async reconcileDelegation(toolCallId: string, record: DelegationRecord): Promise<boolean> {
		if (!record.runId || this.processedRunIds.has(record.runId)) return false;
		const dirs = this.delegationArtifactDirs(record);
		const agents = [...new Set([record.agent, KIND_DEFAULT_AGENTS[record.kind]]
			.filter((name): name is string => Boolean(name)))];
		let meta: ReturnType<typeof readChildMeta> = undefined;
		for (const agent of agents) {
			meta = readChildMeta(dirs, record.runId, agent);
			if (meta?.exitCode !== undefined) break;
		}
		if (!meta || meta.exitCode === undefined) return false;
		this.processedRunIds.add(record.runId);
		this.delegations.delete(toolCallId);
		const task = this.store.get(record.taskId);
		if (!task) return true;
		const text = readLargestRunOutput(record.asyncDir, record.runId) ?? "";
		if (record.kind === "validator") await this.handleValidatorResult(task, text);
		else if (record.kind === "reviewer") await this.handleReviewerResult(task, text);
		else await this.handleWorkerResult(task, text, toolCallId);
		return true;
	}

	/**
	 * Reconcile pending Delegations (optionally one Task's) against child-run
	 * artifacts. Terminal runs are consumed; live or artifact-less runs stay
	 * pending. Returns how many delegations were consumed.
	 */
	async reconcilePendingDelegations(taskId?: string): Promise<number> {
		let reconciled = 0;
		for (const [toolCallId, record] of [...this.delegations]) {
			if (taskId && record.taskId !== taskId) continue;
			if (await this.reconcileDelegation(toolCallId, record)) reconciled += 1;
		}
		return reconciled;
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
		// A finished child run whose notice was lost must be consumed before any
		// verdict, so the newest WorkerReport is what Root actually judges.
		await this.reconcilePendingDelegations(task.taskId);

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

		if (task.state === "blocked" || task.state === "failed") {
			this.store.transition(task.taskId, "reviewing");
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
		const text = resultText(event);
		if (event.isError && !extractWorkerReport(text, { expectedTaskId: delegation.taskId, expectedWorkerRunId: event.toolCallId }).report) {
			this.delegations.delete(event.toolCallId);
			const task = this.store.get(delegation.taskId);
			const firstLine = (text.split(/\r?\n/, 1)[0] ?? "").trim();
			if (task && !isFinalTaskState(task.state)) {
				this.store.transition(task.taskId, "failed");
				task.stateReason = `delegation launch failed: ${firstLine}`;
			}
			return {
				content: [{
					type: "text",
					text: [
						`[PLANNER-ONLY] Delegation for task ${delegation.taskId} failed to launch.`,
						truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
						"Fix the delegation input and re-delegate with the same TaskSpec.",
					].join("\n"),
				}],
			};
		}
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

		return delegation.kind === "reviewer"
			? this.handleReviewerResult(task, text)
			: delegation.kind === "validator"
				? this.handleValidatorResult(task, text)
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
			if (found.record.kind === "validator") {
				outcome = await this.handleValidatorResult(task, chosen);
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
			// A worker echoes the id it was delegated, which may be a model-chosen
			// alias; resolve it through the store before comparing.
			const hintId = this.store.get(parsed.taskIdHint)?.taskId ?? parsed.taskIdHint;
			const byTask = pending.filter(({ record }) => record.taskId === hintId);
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
			? { error: options.forceReportError, repairs: [] as string[] }
			: extractWorkerReport(text, {
				expectedTaskId: task.taskId,
				...(toolCallId ? { expectedWorkerRunId: toolCallId } : {}),
			});
		let report: WorkerReport | undefined;
		let compacted = false;
		let identityErrors: string[] = [];

		if (extracted.report) {
			// §P0-1 — a valid report for the wrong task is not a report.
			identityErrors = validateWorkerReportIdentity(extracted.report, {
				taskId: task.taskId,
				...(task.aliases.length > 0 ? { aliases: task.aliases } : {}),
				...(toolCallId ? { workerRunId: toolCallId } : {}),
			});
			if (identityErrors.length === 0) {
				const canonical = rewriteReportToCanonical(extracted.report, task, extracted.repairs);
				const result = compactWorkerReport(canonical, MAX_WORKER_REPORT_CHARS);
				report = result.report;
				compacted = result.compacted;
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
		if (report) {
			// Bind before recording so the stored report carries Root's own
			// report-time content hashes for the acceptance-boundary comparison.
			report = bindReportToSample(report, current);
			this.store.recordReport(task.taskId, report);
		}
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
						...(reportError === PROSE_ONLY_REPORT_ERROR && decision.action === "report_correction"
							? [`JSON only: {"version":1,"taskId":"${task.taskId}","status":"completed|partial|blocked|failed","summary":"...","changedFiles":[],"validation":[],"evidence":{"taskId":"${task.taskId}"},"risks":[],"unresolved":[]}`]
							: []),
						"",
						"--- worker output ---",
						truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
						...(decision.action === "blocked"
							? ["Root may still judge the last recorded report and evidence with git_audit and record planner_verdict, or re-delegate with the same TaskSpec."]
							: []),
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
					...(extracted.repairs.length > 0
						? [`Report normalised: ${extracted.repairs.join("; ")}`]
						: []),
					"",
					renderWorkerReport(report, {
						round: latest.reviewRound,
						maxRounds: MAX_REVIEW_ROUNDS,
						state: latest.state,
						evidence: evidenceLabel,
						reviewMode: task.reviewMode,
					}),
					...(compacted ? ["", "Note: the report exceeded the parent context budget and was compacted. Re-inspect details with read/grep/git_audit if needed."] : []),
				].join("\n"),
			}],
		};
	}

	private handleValidatorResult(
		task: TaskRecord,
		text: string,
	): { content: { type: "text"; text: string }[] } {
		const extracted = extractWorkerReport(text, { expectedTaskId: task.taskId });
		let report: WorkerReport | undefined;
		if (extracted.report) {
			const identityErrors = validateWorkerReportIdentity(extracted.report, {
				taskId: task.taskId,
				...(task.aliases.length > 0 ? { aliases: task.aliases } : {}),
			});
			if (identityErrors.length === 0) {
				report = rewriteReportToCanonical(extracted.report, task, extracted.repairs);
				this.store.recordValidatorReport(task.taskId, report);
			}
		}

		if (!report) {
			return {
				content: [{
					type: "text",
					text: [
						`[PLANNER-ONLY] Validator output for task ${task.taskId} is not a WorkerReport; judge it directly.`,
						truncate(text, RAW_OUTPUT_FALLBACK_CHARS),
					].join("\n"),
				}],
			};
		}

		const passed = report.validation.filter((item) => item.status === "passed").length;
		const failed = report.validation.filter((item) => item.status === "failed").length;
		const notRun = report.validation.filter((item) => item.status === "not-run").length;
		const latest = this.store.require(task.taskId);
		return {
			content: [{
				type: "text",
				text: [
					`[PLANNER-ONLY] Validator result for task ${task.taskId} recorded: ${report.validation.length} validation entries, ${passed} passed, ${failed} failed, ${notRun} not-run.`,
					...(extracted.repairs.length > 0
						? [`Report normalised: ${extracted.repairs.join("; ")}`]
						: []),
					...renderValidationResults(report.validation),
					"",
					"Verify task identity, evidence freshness, and acceptance criteria.",
					"Inspect the changed files and git state with read/grep/git_audit.",
					"Record the verdict with the planner_verdict tool: {verdict, summary, findings?}.",
					latest.reviewMode === "fresh"
						? "A fresh reviewer is expected: delegate the review first; call planner_verdict only to arbitrate its result."
						: "Root review is active; record the verdict yourself with planner_verdict.",
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
