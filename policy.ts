import { isSafeAuditCommand } from "./git-audit.ts";

export { isSafeAuditCommand };

export const READ_ONLY_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
]);

export const ORCHESTRATION_TOOLS = new Set([
	"bg_wait",
	"subagent_wait",
	"subagent_supervisor",
	"contact_supervisor",
	"question",
	"questionnaire",
]);

/**
 * First-class tools this extension registers for Root itself.
 * Unlike the leftover `bash` allowlist, these are present in the parent's
 * schema, not just tolerated on a stale call.
 */
export const ROOT_TOOLS = new Set(["git_audit", "planner_verdict"]);

/** @deprecated Alias for ROOT_TOOLS, kept for one release. */
export const AUDIT_TOOLS = ROOT_TOOLS;

export interface PolicyInput {
	toolName: string;
	input?: unknown;
	isChild: boolean;
	disabled: boolean;
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

function subagentDelegatesToChildren(input: unknown): boolean {
	if (!input || typeof input !== "object") return true;
	const params = input as { gate?: unknown; workflow?: unknown };
	if (typeof params.gate === "string" && params.gate.trim()) return false;
	if (typeof params.workflow === "string" && params.workflow.trim()) return false;
	return true;
}

function blockedReason(toolName: string): string {
	return [
		`Planner-only guard: the parent process may not call '${toolName}' directly.`,
		"The parent owns planning, delegation, arbitration, and review only.",
		"Delegate execution to a worker with the subagent tool. Include the objective, cwd, edit boundary, constraints, acceptance criteria, validation, and required evidence in the task.",
		"When the worker returns, review its evidence with read/grep/find/ls. Delegate any fixes instead of editing or running commands in the parent.",
		"Use '/planner-only off' for an explicit temporary override.",
	].join("\n");
}

export function decidePolicy(policy: PolicyInput): PolicyDecision {
	if (policy.isChild || policy.disabled) return { block: false };

	const toolName = policy.toolName;
	if (toolName === "subagent" && subagentDelegatesToChildren(policy.input)) {
		return { block: false };
	}
	if (
		READ_ONLY_TOOLS.has(toolName) ||
		ORCHESTRATION_TOOLS.has(toolName) ||
		ROOT_TOOLS.has(toolName)
	) {
		return { block: false };
	}

	if (toolName === "bash" && isSafeAuditCommand(getCommand(policy.input))) {
		return { block: false };
	}

	return { block: true, reason: blockedReason(toolName) };
}
