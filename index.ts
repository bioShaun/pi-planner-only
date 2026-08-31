import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	ORCHESTRATION_TOOLS,
	READ_ONLY_TOOLS,
	decidePolicy,
} from "./policy.ts";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR
	? resolve(process.env.PI_CODING_AGENT_DIR)
	: join(homedir(), ".pi", "agent");
const OFF_MARKER = join(AGENT_DIR, "planner-only.off");
const STATUS_KEY = "planner-only";
const IS_SUBAGENT = process.env.PI_SUBAGENT_CHILD === "1";
const PLANNER_SAFE_TOOLS = new Set([
	...READ_ONLY_TOOLS,
	...ORCHESTRATION_TOOLS,
	"subagent",
]);

const PLANNER_PROMPT = `[PLANNER-ONLY MODE]
You are the parent orchestrator. Your responsibilities are limited to planning,
delegation, arbitration, and review.

Rules:
- Delegate all implementation, file mutation, command execution, tests, builds,
  deployments, API actions, and other operational work through the subagent tool.
- You may inspect evidence with read-only tools while planning or reviewing.
- Give each child a self-contained task with objective, cwd, authority/edit
  boundary, relevant files and constraints, acceptance criteria, validation,
  expected evidence, and stop/ask conditions.
- Require concise conclusions plus verifiable evidence such as changed paths,
  tests and exit codes, validation output, commit/diff references, or URLs.
- Review child results and inspect relevant files. If work is incomplete or
  incorrect, delegate a bounded correction. Never patch it directly.
- Keep one writer per cwd. Use isolated worktrees for concurrent writers.
- The hard tool guard enforces these rules. Do not try alternate tools or shell
  tricks to bypass it.`;

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
	// marker check as a second boundary if a future launcher explicitly includes
	// this extension; workers must retain their configured tool access.
	if (IS_SUBAGENT) return;

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
		if (!decision.block) return;
		if (ctx.hasUI) ctx.ui.notify(`Blocked parent tool: ${event.toolName}`, "warning");
		return { block: true, reason: decision.reason };
	});

	pi.registerCommand("planner-only", {
		description: "Show, enable, or temporarily disable planner-only mode",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase() || "status";
			if (action === "status") {
				ctx.ui.notify(`Planner-only mode is ${isDisabled() ? "off" : "on"}.`, "info");
				return;
			}
			if (action === "on") {
				await rm(OFF_MARKER, { force: true });
				restrictActiveTools();
				updateStatus(ctx);
				ctx.ui.notify("Planner-only mode enabled.", "info");
				return;
			}
			if (action === "off") {
				await mkdir(dirname(OFF_MARKER), { recursive: true });
				await writeFile(OFF_MARKER, "Disabled by /planner-only off\n", "utf8");
				restoreSuppressedTools();
				updateStatus(ctx);
				ctx.ui.notify("Planner-only mode disabled. Run /planner-only on to re-enable it.", "warning");
				return;
			}
			ctx.ui.notify("Usage: /planner-only [status|on|off]", "warning");
		},
	});
}
