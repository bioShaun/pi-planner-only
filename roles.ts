import type { ReviewEvidencePacket, TaskRole, TaskSpec } from "./types.ts";
import { isTerminalTaskState } from "./types.ts";
import { extractTaskSpec } from "./task.ts";
import type { TaskRecord } from "./task.ts";
import { buildFreshReviewerTask, extractReviewRequest } from "./review.ts";
import type { ReviewRequest } from "./types.ts";

/**
 * §13 — capability profiles. Worker is unbounded (the selected agent keeps its
 * own tools). Restricted roles are enforced by remapping to a builtin agent
 * whose allowlist matches the profile. Foreground children do not load
 * ambient extensions, so this is the per-child tool ceiling the parent
 * can actually apply. Background children may load ambient extensions;
 * this extension no-ops when PI_SUBAGENT_CHILD=1.
 *
 * Reviewer children therefore have no `git_audit`: that tool is registered
 * by this extension and is not on the reviewer allowlist. Root passes
 * a bounded Git evidence packet instead (§P1-2).
 */
export const ROLE_TOOL_PROFILES: Record<TaskRole, readonly string[] | undefined> = {
	explorer: ["read", "grep", "find", "ls"],
	reviewer: ["read", "grep", "find", "ls"],
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
	budget?: TaskSpec["budget"];
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
	if (options.budget && input.usageBudget === undefined) {
		const usageBudget: Record<string, unknown> = {};
		if (typeof options.budget.tokens === "number" && Number.isFinite(options.budget.tokens) && options.budget.tokens > 0) {
			usageBudget.tokens = { hard: options.budget.tokens };
		}
		if (typeof options.budget.costUsd === "number" && Number.isFinite(options.budget.costUsd) && options.budget.costUsd > 0) {
			usageBudget.costUsd = { hard: options.budget.costUsd };
		}
		if (Object.keys(usageBudget).length > 0) {
			input.usageBudget = usageBudget;
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

export interface DelegationTarget {
	role: TaskRole;
	taskId?: string;
	task?: TaskRecord;
	/** TaskSpec embedded in the prompt, when the parent supplied one. */
	spec?: TaskSpec;
	/** ReviewRequest embedded in a reviewer packet. */
	request?: ReviewRequest;
	/** Task ids named in the prompt when no TaskSpec/ReviewRequest was embedded. */
	namedTaskIds?: string[];
}

const TASK_ID_RE = /\bT-\d{8}-\d{3}\b/g;

function promptTaskIds(prompt: string): string[] {
	return [...new Set(prompt.match(TASK_ID_RE) ?? [])];
}

/**
 * Resolve the role and Task identity of a delegation payload.
 *
 * A ReviewRequest wins over an embedded TaskSpec: reviewing is an invocation
 * over an existing Task, so the reviewer packet is not a TaskSpec of its own.
 */
export function resolveDelegationTarget(
	rawInput: unknown,
	lookup: (taskId: string) => TaskRecord | undefined,
): DelegationTarget | undefined {
	if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return undefined;
	const input = rawInput as Record<string, unknown>;
	const prompt = delegationPrompt(input);
	const spec = extractTaskSpec(prompt);
	const request = extractReviewRequest(prompt);
	const role = request
		? "reviewer"
		: spec?.role ??
			inferRoleFromAgent(typeof input.agent === "string" ? input.agent : undefined);
	if (!role) return undefined;

	const namedTaskIds = !spec && !request ? promptTaskIds(prompt) : [];
	let taskId = request?.taskId ?? spec?.taskId;
	let task = taskId ? lookup(taskId) : undefined;
	if (!taskId && namedTaskIds.length === 1) {
		const found = lookup(namedTaskIds[0] as string);
		if (found && !isTerminalTaskState(found.state)) {
			taskId = namedTaskIds[0];
			task = found;
		}
	}
	return {
		role,
		...(taskId ? { taskId } : {}),
		...(task ? { task } : {}),
		...(spec ? { spec } : {}),
		...(request ? { request } : {}),
		...(namedTaskIds.length ? { namedTaskIds } : {}),
	};
}

export interface PrepareRoleDelegationOptions {
	/** Bounded Git-read sample for a reviewer packet. Root supplies it. */
	git?: ReviewEvidencePacket;
	/** Freshness summary of the last Root-side evidence comparison. */
	evidence?: string;
}

/**
 * Remap the child agent, and for reviewers replace the payload with a fresh
 * ReviewRequest packet. Looks up an existing Task when the prompt embeds a
 * taskId; the packet shows the Task's *original* spec read-only, so a reviewer
 * invocation never rewrites the unit of work (§P1-1).
 */
export function prepareRoleDelegation(
	rawInput: unknown,
	lookup: (taskId: string) => TaskRecord | undefined,
	options: PrepareRoleDelegationOptions = {},
): void {
	const target = resolveDelegationTarget(rawInput, lookup);
	if (!target) return;
	const input = rawInput as Record<string, unknown>;
	// An existing Task's spec is authoritative; without one the embedded spec is
	// the only description available.
	const packetSpec = target.role === "reviewer"
		? (target.task?.spec ?? target.spec)
		: (target.spec ?? target.task?.spec);
	const report = target.task?.reports.at(-1);
	const packet = target.role === "reviewer" && (packetSpec || report || options.git)
		? buildFreshReviewerTask({
			taskId: target.taskId ?? "unknown",
			...(packetSpec ? { spec: packetSpec } : {}),
			...(report ? { report } : {}),
			...(options.evidence ? { evidence: options.evidence } : {}),
			...(options.git ? { git: options.git } : {}),
		})
		: undefined;
	applyRoleDelegation(input, {
		role: target.role,
		...(packet ? { packet } : {}),
		...(packetSpec?.budget ? { budget: packetSpec.budget } : {}),
	});
}
