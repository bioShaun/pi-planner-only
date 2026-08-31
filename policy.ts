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
 * Read-only Git inspection exposed to the parent instead of a general shell.
 * Unlike the `bash` audit allowlist below, this is a first-class tool: it is
 * present in the parent's schema, not just tolerated on a stale call.
 */
export const AUDIT_TOOLS = new Set(["git_audit"]);

const SAFE_GIT_STATUS_FLAGS = new Set([
	"--short",
	"-s",
	"--branch",
	"-b",
	"--porcelain",
	"--porcelain=v1",
	"--porcelain=v2",
]);

const SAFE_GIT_DIFF_FLAGS = new Set([
	"--cached",
	"--staged",
	"--stat",
	"--numstat",
	"--shortstat",
	"--name-only",
	"--name-status",
	"--check",
	"--no-color",
	"--no-ext-diff",
	"--no-textconv",
]);

const SAFE_GIT_LOG_FLAGS = new Set([
	"--oneline",
	"--decorate",
	"--no-decorate",
	"--stat",
	"--no-color",
]);

const SHELL_META = /[;&|`$><\n\r\\]/;

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
	if (typeof params.workflow === "string" && params.workflow !== "review") return false;
	return true;
}

function allFlagsAllowed(tokens: string[], allowed: Set<string>): boolean {
	return tokens.every((token) => allowed.has(token));
}

export function isSafeAuditCommand(command: string): boolean {
	const trimmed = command.trim();
	if (!trimmed || SHELL_META.test(trimmed)) return false;
	if (trimmed === "pwd") return true;

	const tokens = trimmed.split(/\s+/);
	if (tokens[0] !== "git" || tokens.length < 2) return false;

	const subcommand = tokens[1];
	const args = tokens.slice(2);
	if (subcommand === "status") return allFlagsAllowed(args, SAFE_GIT_STATUS_FLAGS);
	if (subcommand === "diff") return allFlagsAllowed(args, SAFE_GIT_DIFF_FLAGS);
	if (subcommand === "log") {
		return args.every((token) =>
			SAFE_GIT_LOG_FLAGS.has(token) ||
			/^-n\d+$/.test(token) ||
			/^--max-count=\d+$/.test(token),
		);
	}

	return false;
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
		AUDIT_TOOLS.has(toolName)
	) {
		return { block: false };
	}

	if (toolName === "bash" && isSafeAuditCommand(getCommand(policy.input))) {
		return { block: false };
	}

	return { block: true, reason: blockedReason(toolName) };
}
