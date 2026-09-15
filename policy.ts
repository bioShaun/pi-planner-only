import { isSafeAuditCommand } from "./git-audit.ts";
import { appendTaskSpecRepair, buildTaskSpecRepair } from "./task.ts";

export { isSafeAuditCommand };

export const READ_ONLY_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
]);

/**
 * Ticket 05 B — the only orchestration-shaped tools still admitted
 * post-cutover. The asynchronous receipt tools (bg_wait, subagent_wait,
 * subagent_supervisor, contact_supervisor) served the legacy delegation
 * chain and are refused outright now.
 */
export const QUESTION_TOOLS = new Set(["question", "questionnaire"]);

/**
 * Ticket 05 B — the Idle-for-gather allowlist: Root may start a Delegation,
 * record a Verdict, or inspect Git. `git_commit` gates itself on a completed
 * Task, and a completed Task is never live, so it must be admitted while Idle.
 */
export const IDLE_TOOLS = new Set(["planner_delegate", "planner_verdict", "git_audit", "git_commit"]);

/**
 * First-class tools this extension registers for Root itself.
 * Unlike the leftover `bash` allowlist, these are present in the parent's
 * schema, not just tolerated on a stale call.
 */
export const ROOT_TOOLS = new Set(["git_audit", "planner_verdict", "planner_delegate"]);

export interface PolicyInput {
	toolName: string;
	input?: unknown;
	isChild: boolean;
	disabled: boolean;
	/** R01 — adapter workspace (`ctx.cwd || process.cwd()`), used by the example JSON. */
	cwd?: string;
	/**
	 * R02 — whether `activeForCwd(adapter cwd)` has a live (non-final) Task:
	 * the gather phase. The adapter always sets this; when it is absent the
	 * live allowlist applies (only the adapter's own store-read failure
	 * yields Idle, which fails closed).
	 */
	liveTask?: boolean;
}

export interface PolicyDecision {
	block: boolean;
	reason?: string;
}

function getCommand(input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const command = (input as { command?: unknown }).command;
	return typeof command === "string" ? command.trim() : "";
}

function blockedReason(toolName: string): string {
	return [
		`Planner-only guard: the parent process may not call '${toolName}' directly.`,
		"The parent owns planning, delegation, arbitration, and review only.",
		"Delegate execution with planner_delegate. Include the objective, cwd, edit boundary, constraints, acceptance criteria, validation, and required evidence in the call.",
		"When the worker returns, review its evidence with read/grep/find/ls. Delegate any fixes instead of editing or running commands in the parent.",
		"Use '/planner-only off' for an explicit temporary override.",
	].join("\n");
}

/**
 * R02 — Idle-for-gather refusal: no inspect tools, no Git-read, no general
 * shell, no mutation, no generic wait/supervisor calls. Post-cutover Root may
 * start a Delegation, record a Verdict, inspect Git with git_audit, or ask a
 * question.
 */
function idleBlockReason(toolName: string): string {
	return [
		`Planner-only guard (idle for gather): the parent process may not call '${toolName}' while no Task is live for this cwd.`,
		"New gather starts with one Delegation: inspect tools, Git-read, and a general shell are refused so they cannot substitute for it.",
		"Name the skill or lookup in the TaskSpec constraints and let the Worker follow them. Record a Verdict with planner_verdict, inspect Git with git_audit, or ask a question.",
	].join("\n");
}

/**
 * Ticket 05 B — the post-cutover refusal for the legacy delegation surface.
 * Static text by design: the refused input is a prompt, and this path never
 * reads it, so no TaskSpec repair is appended.
 */
function delegationCutoverReason(toolName: string): string {
	return [
		`Planner-only guard: the parent process may not call '${toolName}'.`,
		"Delegation goes through planner_delegate (role, objective, scope, constraints, acceptanceCriteria, validation); its result carries the WorkerReport in details.",
		"There is no asynchronous wait: planner_delegate returns when the child finishes.",
	].join("\n");
}

/**
 * Ticket 05 B — post-cutover policy. subagent and bg_wait are refused
 * outright regardless of input or phase; the live allowlist is inspect +
 * question + Root tools, and the Idle-for-gather allowlist is IDLE_TOOLS +
 * question tools.
 */
export function decidePolicy(policy: PolicyInput): PolicyDecision {
	if (policy.isChild || policy.disabled) return { block: false };

	const toolName = policy.toolName;
	if (toolName === "subagent" || toolName === "bg_wait") {
		return { block: true, reason: delegationCutoverReason(toolName) };
	}
	const liveTask = policy.liveTask ?? true;
	if (liveTask) {
		if (READ_ONLY_TOOLS.has(toolName) || QUESTION_TOOLS.has(toolName) || ROOT_TOOLS.has(toolName)) return { block: false };
		if (toolName === "bash" && isSafeAuditCommand(getCommand(policy.input))) return { block: false };
		return { block: true, reason: appendTaskSpecRepair(blockedReason(toolName), buildTaskSpecRepair({ toolName, input: policy.input, cwd: policy.cwd })) };
	}
	if (IDLE_TOOLS.has(toolName) || QUESTION_TOOLS.has(toolName)) return { block: false };
	return { block: true, reason: appendTaskSpecRepair(idleBlockReason(toolName), buildTaskSpecRepair({ toolName, input: policy.input, cwd: policy.cwd })) };
}
