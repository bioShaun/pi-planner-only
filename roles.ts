import type { TaskRole } from "./types.ts";
import { extractTaskSpec } from "./task.ts";
import type { TaskRecord } from "./task.ts";
import { buildFreshReviewerTask } from "./review.ts";
import { describeComparison } from "./evidence.ts";

/**
 * §13 — capability profiles. Worker is unbounded (the selected agent keeps its
 * own tools). Restricted roles are enforced by remapping to a builtin agent
 * whose allowlist matches the profile; children launch with `--no-extensions`,
 * so this is the per-child tool ceiling the parent can actually apply.
 */
export const ROLE_TOOL_PROFILES: Record<TaskRole, readonly string[] | undefined> = {
	explorer: ["read", "grep", "find", "ls"],
	reviewer: ["read", "grep", "find", "ls", "git_audit"],
	validator: ["read", "grep", "find", "ls", "bash"],
	worker: undefined,
};

/** Builtin pi-subagents agents whose declared tools match the role profile. */
export const ROLE_AGENTS: Record<TaskRole, string | undefined> = {
	explorer: "reviewer",
	reviewer: "reviewer",
	validator: "oracle",
	worker: undefined,
};

export const MUTATING_TOOLS = ["edit", "write", "bash"] as const;

const AGENT_ROLES: Record<string, TaskRole> = {
	reviewer: "reviewer",
	oracle: "validator",
	worker: "worker",
};

export function roleAllowsMutatingTools(role: TaskRole): boolean {
	const tools = ROLE_TOOL_PROFILES[role];
	if (tools === undefined) return true;
	return tools.some((tool) => (MUTATING_TOOLS as readonly string[]).includes(tool));
}

export function inferRoleFromAgent(agent: string | undefined): TaskRole | undefined {
	if (!agent) return undefined;
	return AGENT_ROLES[agent.trim().toLowerCase()];
}

export interface ApplyRoleDelegationOptions {
	role: TaskRole;
	packet?: string;
}

export interface ApplyRoleDelegationResult {
	mutated: boolean;
	role: TaskRole;
}

/**
 * Mutate a `subagent` tool payload in place so the child launches with the
 * role's builtin agent and, for reviewers, a fresh context plus a bounded task.
 */
export function applyRoleDelegation(
	input: Record<string, unknown>,
	options: ApplyRoleDelegationOptions,
): ApplyRoleDelegationResult {
	let mutated = false;
	const target = ROLE_AGENTS[options.role];
	if (target && input.agent !== target) {
		input.agent = target;
		mutated = true;
	}
	if (options.role === "reviewer") {
		if (input.context !== "fresh") {
			input.context = "fresh";
			mutated = true;
		}
		if (options.packet !== undefined && input.task !== options.packet) {
			input.task = options.packet;
			mutated = true;
		}
	}
	return { mutated, role: options.role };
}

/** Concatenate task/tasks/chain prompts from a subagent payload. */
export function delegationPrompt(input: unknown): string {
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

/**
 * Remap the child agent, and for reviewers replace the payload with a fresh
 * packet. Looks up an existing Task when the prompt embeds a taskId.
 */
export function prepareRoleDelegation(
	rawInput: unknown,
	lookup: (taskId: string) => TaskRecord | undefined,
): void {
	if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return;
	const input = rawInput as Record<string, unknown>;
	const spec = extractTaskSpec(delegationPrompt(input));
	const role = spec?.role ?? inferRoleFromAgent(typeof input.agent === "string" ? input.agent : undefined);
	if (!role) return;
	const existing = spec?.taskId ? lookup(spec.taskId) : undefined;
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
}
