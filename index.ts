import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	AUDIT_TOOLS,
	ORCHESTRATION_TOOLS,
	READ_ONLY_TOOLS,
	decidePolicy,
} from "./policy.ts";
import { GIT_AUDIT_OPERATIONS, runGitAudit } from "./git-audit.ts";
import type { GitAuditCommandResult, GitAuditRequest } from "./git-audit.ts";
import { captureEvidence, compareEvidence, describeComparison } from "./evidence.ts";
import type { GitRunner } from "./evidence.ts";
import {
	TASK_TRANSITIONS,
	TaskStore,
	compactWorkerReport,
	createTaskSpec,
	extractWorkerReport,
	findWriterConflict,
	jsonCandidates,
	renderWorkerReport,
	validateTaskSpec,
} from "./task.ts";
import type { TaskRecord, WriterConflict } from "./task.ts";
import { applyRoleDelegation, inferRoleFromAgent } from "./roles.ts";
import { buildFreshReviewerTask, decideReview, extractReviewResult, reviewerPrompt, summarizeFindings } from "./review.ts";
import type { ReviewDecision } from "./review.ts";
import {
	MAX_REVIEW_ROUNDS,
	MAX_WORKER_REPORT_CHARS,
	WORKER_REPORT_VERSION,
	isTerminalTaskState,
} from "./types.ts";
import type {
	EvidenceRef,
	ReviewMode,
	ReviewResult,
	ReviewVerdict,
	TaskSpec,
	WorkerReport,
} from "./types.ts";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR
	? resolve(process.env.PI_CODING_AGENT_DIR)
	: join(homedir(), ".pi", "agent");
const OFF_MARKER = join(AGENT_DIR, "planner-only.off");
const STATUS_KEY = "planner-only";
const IS_SUBAGENT = process.env.PI_SUBAGENT_CHILD === "1";
const PLANNER_SAFE_TOOLS = new Set([
	...READ_ONLY_TOOLS,
	...ORCHESTRATION_TOOLS,
	...AUDIT_TOOLS,
	"subagent",
]);

/** Worker output kept as a fallback when a report cannot be parsed at all. */
const RAW_OUTPUT_FALLBACK_CHARS = 4000;
const GIT_TIMEOUT_MS = 15_000;

const PLANNER_PROMPT = `[PLANNER-ONLY MODE]

You are the root orchestrator.

You may:
- plan
- delegate
- inspect using read-only tools
- review
- arbitrate

You may not:
- edit files
- write files
- execute general shell commands
- implement fixes directly

For executable work, create a bounded TaskSpec and delegate it through subagent.
Embed the full TaskSpec JSON in the task prompt so the worker can echo back its
taskId:

  {"taskId":"T-YYYYMMDD-NNN","objective":"...","cwd":"...","role":"worker",
   "scope":{},"constraints":[],"acceptanceCriteria":[],
   "validation":{"required":true,"commands":[]},
   "expectedEvidence":{"changedFiles":true,"diffStat":true,"tests":true},
   "stopConditions":[]}

Every worker must return a WorkerReport containing:
- version: ${WORKER_REPORT_VERSION}
- taskId
- status: completed | partial | blocked | failed
- concise summary
- changedFiles
- validation entries with type, status, exit codes
- evidence reference
- risks
- unresolved items

Before accepting work:
1. verify WorkerReport task identity
2. verify evidence freshness
3. inspect relevant files and git state with read/grep/find/ls/git_audit
4. evaluate acceptance criteria
5. PASS or REQUEST_CHANGES

Role in TaskSpec is enforced at launch: explorer/reviewer remap to the builtin reviewer agent (read/grep/find/ls), validator remaps to oracle (bash, no edits), worker keeps its agent. Reviewer children always start with context=fresh and a bounded packet — never a fork of this session.

Use git_audit for read-only git inspection. It is the only git access you have.
Never trust a worker that reports its own PASS; inspect the evidence yourself.
Stale evidence must not be accepted: re-delegate validation instead.

Never fix rejected work yourself. Delegate a bounded correction.
Stop automatic correction after ${MAX_REVIEW_ROUNDS} review rounds; the loop
reports blocked and asks the user how to proceed.

Use /planner-only task to inspect lifecycle state and /planner-only review to
record a verdict or switch to an isolated fresh reviewer.`;

function envDisablesGuard(): boolean {
	return new Set(["0", "false", "off"]).has(
		(process.env.PI_PLANNER_ONLY || "").trim().toLowerCase(),
	);
}

function isDisabled(): boolean {
	return envDisablesGuard() || existsSync(OFF_MARKER);
}

function updateStatus(ctx: ExtensionContext): void {
	if (IS_SUBAGENT) return;
	ctx.ui.setStatus(
		STATUS_KEY,
		isDisabled()
			? ctx.ui.theme.fg("muted", "planner-only: off")
			: ctx.ui.theme.fg("warning", "planner-only"),
	);
}

export function filterPlannerTools(
	activeTools: readonly string[],
	allTools: readonly string[],
): string[] {
	const allowed = (name: string): boolean => PLANNER_SAFE_TOOLS.has(name);
	return [...new Set([
		...activeTools.filter(allowed),
		...allTools.filter(allowed),
	])];
}

export function restorePlannerTools(
	activeTools: readonly string[],
	suppressedTools: readonly string[],
): string[] {
	return [...new Set([...activeTools, ...suppressedTools])];
}

function sameToolOrder(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((name, index) => name === right[index]);
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

/** Pull a TaskSpec the parent embedded in the subagent task prompt. */
function extractTaskSpec(text: string): TaskSpec | undefined {
	if (!text.trim()) return undefined;
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
			!("objective" in parsed)
		) {
			continue;
		}
		if (validateTaskSpec(parsed).length === 0) return parsed as TaskSpec;
	}
	return undefined;
}

function delegationPrompt(input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const params = input as { task?: unknown; tasks?: unknown; chain?: unknown };
	const parts: string[] = [typeof params.task === "string" ? params.task : ""];
	if (Array.isArray(params.tasks)) {
		parts.push(...params.tasks.map((item) => (item && typeof item === "object" ? String((item as { task?: unknown }).task ?? "") : "")));
	}
	if (Array.isArray(params.chain)) {
		parts.push(...params.chain.map((item) => (item && typeof item === "object" ? String((item as { task?: unknown }).task ?? "") : "")));
	}
	return parts.filter(Boolean).join("\n");
}

export default function plannerOnly(pi: ExtensionAPI): void {
	// Current pi-subagents launches children with --no-extensions. Keep the child
	// marker check as a second boundary if a future launcher explicitly includes
	// this extension; workers must retain their configured tool access.
	if (IS_SUBAGENT) return;

	const store = new TaskStore();
	/** toolCallId -> taskId, so a worker result can be matched to its task. */
	const delegations = new Map<string, string>();

	const gitRunner: GitRunner = async (args, cwd) => {
		const result = await pi.exec("git", [...args], { cwd, timeout: GIT_TIMEOUT_MS });
		return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code };
	};

	const auditRunner = async (
		args: readonly string[],
		cwd: string,
	): Promise<GitAuditCommandResult> => {
		const result = await pi.exec("git", [...args], { cwd, timeout: GIT_TIMEOUT_MS });
		return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code };
	};

	let suppressedTools: string[] = [];

	const restrictActiveTools = (): void => {
		if (isDisabled()) return;
		const activeTools = pi.getActiveTools();
		const allTools = pi.getAllTools().map((tool) => tool.name);
		suppressedTools = [...new Set([
			...suppressedTools,
			...activeTools.filter((name) => !PLANNER_SAFE_TOOLS.has(name)),
		])];
		const nextTools = filterPlannerTools(activeTools, allTools);
		if (!sameToolOrder(activeTools, nextTools)) pi.setActiveTools(nextTools);
	};

	const restoreSuppressedTools = (): void => {
		if (suppressedTools.length === 0) return;
		const activeTools = pi.getActiveTools();
		const nextTools = restorePlannerTools(activeTools, suppressedTools);
		suppressedTools = [];
		if (!sameToolOrder(activeTools, nextTools)) pi.setActiveTools(nextTools);
	};

	pi.registerTool({
		name: "git_audit",
		label: "Git Audit",
		description: [
			"Read-only git inspection for reviewing worker evidence.",
			`Operations: ${GIT_AUDIT_OPERATIONS.join(", ")}.`,
			"It never mutates the repository; delegate any git write to a worker subagent.",
		].join(" "),
		promptSnippet: "git_audit: read-only git inspection for reviewing worker evidence",
		promptGuidelines: [
			"Use git_audit to verify worker evidence (status, diff, HEAD, log) before accepting or rejecting a WorkerReport.",
			"git_audit cannot mutate the repository; delegate commits, checkouts, and resets to a worker subagent.",
		],
		parameters: Type.Object({
			operation: Type.Union(GIT_AUDIT_OPERATIONS.map((operation) => Type.Literal(operation)), {
				description: `Audit operation. One of: ${GIT_AUDIT_OPERATIONS.join(", ")}.`,
			}),
			cwd: Type.Optional(
				Type.String({ description: "Directory to inspect. Defaults to the current working directory." }),
			),
			staged: Type.Optional(
				Type.Boolean({ description: "For diff-* operations, inspect staged changes instead of the working tree." }),
			),
			maxEntries: Type.Optional(
				Type.Integer({ minimum: 1, description: "For log, how many commits to show." }),
			),
		}),
		async execute(_toolCallId, params: GitAuditRequest, _signal, _onUpdate, ctx) {
			const outcome = await runGitAudit(auditRunner, params, ctx.cwd || process.cwd());
			return {
				content: [{ type: "text", text: outcome.text }],
				details: { operation: outcome.operation, ok: outcome.ok, code: outcome.code },
			};
		},
	});

	const beginDelegation = async (
		event: { toolCallId: string; input?: unknown },
		baseCwd: string,
	): Promise<{ task: TaskRecord; conflict?: WriterConflict }> => {
		const input = event.input ?? {};
		const rawCwd = (input as { cwd?: unknown }).cwd;
		const cwd = typeof rawCwd === "string" && rawCwd.trim()
			? resolve(baseCwd, rawCwd.trim())
			: baseCwd;
		const spec = extractTaskSpec(delegationPrompt(input));

		let task: TaskRecord;
		if (spec) {
			task = store.get(spec.taskId) ?? store.create(spec);
			task.spec = spec;
			task.role = spec.role;
			task.cwd = spec.cwd;
		} else {
			task = store.create(createTaskSpec({ objective: "(unspecified — parent did not embed a TaskSpec)", cwd }));
		}
		if (!task.cwd) task.cwd = cwd;

		// Only enforce the write lock when the parent positively declared a
		// writer role via an embedded TaskSpec. An inferred role must not wedge
		// a session that simply delegates twice in the same cwd.
		const conflict = spec
			? findWriterConflict(store.list(), task.cwd, task.role, task.taskId)
			: { conflict: false };
		if (conflict.conflict) return { task, conflict };

		if (["planning", "changes_requested", "blocked", "failed"].includes(task.state)) {
			store.transition(task.taskId, "executing");
		}

		const base: EvidenceRef = await captureEvidence(gitRunner, {
			cwd: task.cwd,
			taskId: task.taskId,
			workerRunId: event.toolCallId,
		});
		task.baseEvidence = base;
		delegations.set(event.toolCallId, task.taskId);
		return { task };
	};

	const prepareRoleDelegation = (rawInput: unknown): void => {
		if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return;
		const input = rawInput as Record<string, unknown>;
		const spec = extractTaskSpec(delegationPrompt(input));
		const role = spec?.role ?? inferRoleFromAgent(typeof input.agent === "string" ? input.agent : undefined);
		if (!role) return;
		const existing = spec?.taskId ? store.get(spec.taskId) : undefined;
		const packetSpec = spec ?? existing?.spec;
		const packetReport = existing?.reports.at(-1);
		const packet = role === "reviewer" && (packetSpec || packetReport)
			? buildFreshReviewerTask({
				taskId: spec?.taskId ?? existing?.taskId ?? "unknown",
				...(packetSpec ? { spec: packetSpec } : {}),
				...(packetReport ? { report: packetReport } : {}),
				...(existing?.lastComparison ? { evidence: describeComparison(existing.lastComparison) } : {}),
			})
			: undefined;
		applyRoleDelegation(input, { role, ...(packet ? { packet } : {}) });
	};

	const applyDecision = (taskId: string, decision: ReviewDecision): TaskRecord => {
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
	};

	const renderDecisionBlock = (
		task: TaskRecord,
		decision: ReviewDecision,
		evidence?: string,
	): string => {
		const lines: string[] = ["[PLANNER-ONLY REVIEW STATE]"];
		lines.push(`taskId: ${task.taskId}`);
		lines.push(`state: ${store.require(task.taskId).state}`);
		lines.push(`round: ${store.require(task.taskId).reviewRound}/${MAX_REVIEW_ROUNDS}`);
		lines.push(`review mode: ${task.reviewMode}`);
		lines.push(`decision: ${decision.action}`);
		if (evidence) lines.push(`evidence: ${evidence}`);
		lines.push(`reason: ${decision.reason}`);
		lines.push("");
		lines.push(...decision.guidance);
		return lines.join("\n");
	};

	pi.on("session_start", async (_event, ctx) => {
		restrictActiveTools();
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		// A reload tears down this instance before the replacement session starts.
		// Restore its snapshot so the replacement can capture the complete set.
		restoreSuppressedTools();
	});

	pi.on("before_agent_start", async (event) => {
		if (isDisabled()) return;
		restrictActiveTools();
		return { systemPrompt: `${event.systemPrompt}\n\n${PLANNER_PROMPT}` };
	});

	pi.on("tool_call", async (event, ctx) => {
		const decision = decidePolicy({
			toolName: event.toolName,
			input: event.input,
			isChild: IS_SUBAGENT,
			disabled: isDisabled(),
		});
		if (!decision.block) {
			if (event.toolName === "subagent" && !isDisabled()) {
				prepareRoleDelegation(event.input);
				const outcome = await beginDelegation(event, ctx.cwd || process.cwd());
				if (outcome.conflict?.conflict) {
					if (ctx.hasUI) ctx.ui.notify("Blocked concurrent writer for this cwd", "warning");
					return { block: true, reason: outcome.conflict.reason as string };
				}
			}
			return;
		}
		if (ctx.hasUI) ctx.ui.notify(`Blocked parent tool: ${event.toolName}`, "warning");
		return { block: true, reason: decision.reason };
	});

	pi.on("tool_result", async (event, ctx) => {
		if (isDisabled() || event.toolName !== "subagent") return;
		const taskId = delegations.get(event.toolCallId);
		if (!taskId) return;
		delegations.delete(event.toolCallId);

		const task = store.require(taskId);
		const text = resultText(event);

		// A reviewer subagent returns a ReviewResult, not a WorkerReport.
		const extractedReview = extractReviewResult(text);
		if (extractedReview.review) {
			const review = extractedReview.review;
			store.recordReview(taskId, review);
			const report = task.reports.at(-1);
			const comparison = report
				? compareEvidence(report, await captureEvidence(gitRunner, {
						cwd: task.cwd,
						taskId,
						workerRunId: event.toolCallId,
						...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
					}), task.spec?.scope ? { scope: task.spec.scope } : {})
				: undefined;
			if (comparison) task.lastComparison = comparison;
			const decision = decideReview({ task, ...(report ? { report } : {}), ...(comparison ? { comparison } : {}), review });
			applyDecision(taskId, decision);
			return {
				content: [{
					type: "text",
					text: [
						renderDecisionBlock(task, decision, comparison ? describeComparison(comparison) : undefined),
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
			store.recordReport(taskId, report);
		} else if (extractedReview.error && task.reviews.length > 0) {
			// Reviewer output that failed validation: surface why, do not accept.
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

		const current = await captureEvidence(gitRunner, {
			cwd: task.cwd,
			taskId,
			workerRunId: event.toolCallId,
			...(task.baseEvidence?.finalGitRef ? { baseGitRef: task.baseEvidence.finalGitRef } : {}),
		});
		const comparison = report
			? compareEvidence(report, current, task.spec?.scope ? { scope: task.spec.scope } : {})
			: undefined;
		if (comparison) task.lastComparison = comparison;
		const decision = decideReview({
			task,
			...(report ? { report } : {}),
			...(extracted.error ? { reportError: extracted.error } : {}),
			...(comparison ? { comparison } : {}),
		});
		applyDecision(taskId, decision);

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

		return {
			content: [{
				type: "text",
				text: [
					renderDecisionBlock(task, decision, evidenceLabel),
					"",
					renderWorkerReport(report, {
						round: store.require(taskId).reviewRound,
						maxRounds: MAX_REVIEW_ROUNDS,
						state: store.require(taskId).state,
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
	});

	const notify = (ctx: ExtensionContext, message: string, type: "info" | "warning" = "info"): void => {
		if (ctx.hasUI) ctx.ui.notify(message, type);
	};

	const renderTaskStatus = (task: TaskRecord): string => {
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
	};

	pi.registerCommand("planner-only", {
		description: "Show, enable, or temporarily disable planner-only mode; inspect task lifecycle",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const action = (parts[0] ?? "status").toLowerCase();

			if (action === "status") {
				notify(ctx, `Planner-only mode is ${isDisabled() ? "off" : "on"}.`);
				return;
			}
			if (action === "on") {
				await rm(OFF_MARKER, { force: true });
				restrictActiveTools();
				updateStatus(ctx);
				notify(ctx, "Planner-only mode enabled.");
				return;
			}
			if (action === "off") {
				await mkdir(dirname(OFF_MARKER), { recursive: true });
				await writeFile(OFF_MARKER, "Disabled by /planner-only off\n", "utf8");
				restoreSuppressedTools();
				updateStatus(ctx);
				notify(ctx, "Planner-only mode disabled. Run /planner-only on to re-enable it.", "warning");
				return;
			}
			if (action === "task") {
				const task = parts[1] ? store.get(parts[1]) : store.active();
				if (!task) {
					notify(ctx, "No active planner-only task.", "info");
					return;
				}
				notify(ctx, renderTaskStatus(task));
				return;
			}
			if (action === "review") {
				let rest = parts.slice(1);
				let task = store.active();
				if (rest[0] && store.get(rest[0])) {
					task = store.get(rest[0]);
					rest = rest.slice(1);
				}
				if (!task) {
					notify(ctx, "No active planner-only task.", "info");
					return;
				}
				const sub = (rest[0] ?? "").toLowerCase();
				if (!sub) {
					notify(ctx, [
						`Task: ${task.taskId}`,
						`State: ${task.state}`,
						`Round: ${task.reviewRound}/${MAX_REVIEW_ROUNDS}`,
						`Review mode: ${task.reviewMode}`,
						"Usage: /planner-only review [taskId] [root|fresh|pass|request_changes|blocked] [summary]",
					].join("\n"));
					return;
				}
				if (sub === "root" || sub === "fresh") {
					store.setReviewMode(task.taskId, sub as ReviewMode);
					notify(ctx, `Review mode for ${task.taskId} set to ${sub}.`);
					return;
				}
				if (!["pass", "request_changes", "blocked"].includes(sub)) {
					notify(ctx, "Usage: /planner-only review [root|fresh|pass|request_changes|blocked] [summary]", "warning");
					return;
				}
				const verdict = sub as ReviewVerdict;
				const summary = rest.slice(1).join(" ").trim() || `root verdict: ${verdict}`;
				const previous = task.reviews.at(-1);
				if (previous && previous.verdict !== verdict) {
					store.recordOverride(task.taskId, {
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
				store.recordReview(task.taskId, review);
				const decision = decideReview({
					task: store.require(task.taskId),
					...(task.reports.at(-1) ? { report: task.reports.at(-1) as WorkerReport } : {}),
					...(task.lastComparison ? { comparison: task.lastComparison } : {}),
					review,
				});
				applyDecision(task.taskId, decision);
				notify(ctx, renderDecisionBlock(task, decision));
				return;
			}
			notify(ctx, "Usage: /planner-only [status|on|off|task|review] [args]", "warning");
		},
	});
}
