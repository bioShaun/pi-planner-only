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
import type { GitAuditRequest, GitRunner } from "./git-audit.ts";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { MAX_REVIEW_ROUNDS, WORKER_REPORT_VERSION } from "./types.ts";
import type { ReviewMode, ReviewVerdict } from "./types.ts";

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

export default function plannerOnly(pi: ExtensionAPI): void {
	// Current pi-subagents launches children with --no-extensions. Keep the child
	// marker check as a second seam if a future launcher explicitly includes
	// this extension; workers must retain their configured tool access.
	if (IS_SUBAGENT) return;

	const gitRunner: GitRunner = async (args, cwd) => {
		const result = await pi.exec("git", [...args], { cwd, timeout: GIT_TIMEOUT_MS });
		return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code };
	};

	const orchestrator = new PlannerOrchestrator({ gitRunner });

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
			const outcome = await runGitAudit(gitRunner, params, ctx.cwd || process.cwd());
			return {
				content: [{ type: "text", text: outcome.text }],
				details: { operation: outcome.operation, ok: outcome.ok, code: outcome.code },
			};
		},
	});

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
				orchestrator.prepareRoleDelegation(event.input);
				const outcome = await orchestrator.beginDelegation(event, ctx.cwd || process.cwd());
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

	pi.on("tool_result", async (event) => {
		if (isDisabled() || event.toolName !== "subagent") return;
		return orchestrator.handleSubagentResult(event);
	});

	const notify = (ctx: ExtensionContext, message: string, type: "info" | "warning" = "info"): void => {
		if (ctx.hasUI) ctx.ui.notify(message, type);
	};

	pi.registerCommand("planner-only", {
		description: "Show, enable, or temporarily disable planner-only mode; inspect task lifecycle",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const action = (parts[0] ?? "status").toLowerCase();
			const store = orchestrator.store;

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
				notify(ctx, orchestrator.renderTaskStatus(task));
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
				const outcome = orchestrator.recordRootVerdict(task, verdict, summary);
				notify(ctx, orchestrator.renderDecisionBlock(outcome.task, outcome.decision));
				return;
			}
			notify(ctx, "Usage: /planner-only [status|on|off|task|review] [args]", "warning");
		},
	});
}
