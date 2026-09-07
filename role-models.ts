import type { TaskRole } from "./types.ts";

export type RoleModelRole = "root" | "reviewer" | "worker" | "explorer" | "validator";

export interface RoleModelConfig {
	model?: string;
	thinking?: string;
}

export interface RoleModelPolicy {
	enabled: boolean;
	roles: Partial<Record<RoleModelRole, RoleModelConfig>>;
}

export interface RoleModelResolution {
	role: RoleModelRole;
	model: string;
	thinking: string;
}

export interface RoleModelComparison {
	actualModel: string;
	actualThinking: string;
	unknownModel: boolean;
	unknownThinking: boolean;
	mismatch: boolean;
}

export function compareResolvedRoleModel(
	resolved: Pick<RoleModelResolution, "model" | "thinking">,
	actual: { model?: unknown; thinking?: unknown } = {},
): RoleModelComparison {
	const actualModel = typeof actual.model === "string" && actual.model.trim() ? actual.model.trim() : "未知";
	const actualThinking = typeof actual.thinking === "string" && actual.thinking.trim() ? actual.thinking.trim() : "未知";
	const unknownModel = actualModel === "未知";
	const unknownThinking = actualThinking === "未知";
	return {
		actualModel,
		actualThinking,
		unknownModel,
		unknownThinking,
		mismatch: (!unknownModel && actualModel !== resolved.model.trim())
			|| (!unknownThinking && actualThinking !== resolved.thinking.trim()),
	};
}

export function requestedRoleModel(input: Record<string, unknown>): RoleModelConfig {
	const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : undefined;
	const thinking = typeof input.thinking === "string" && input.thinking.trim() ? input.thinking.trim() : undefined;
	return { ...(model ? { model } : {}), ...(thinking ? { thinking } : {}) };
}


const ROLES: readonly RoleModelRole[] = ["root", "reviewer", "worker", "explorer", "validator"];
const ENABLED_VALUES = new Set(["1", "true", "on"]);

function roleKey(role: string): RoleModelRole | undefined {
	const normalized = role.trim().toLowerCase();
	return ROLES.includes(normalized as RoleModelRole) ? normalized as RoleModelRole : undefined;
}

export function roleModelPolicyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return ENABLED_VALUES.has((env.PI_PLANNER_ONLY_ROLE_MODELS ?? "").trim().toLowerCase());
}

export function loadRoleModelPolicy(env: NodeJS.ProcessEnv = process.env): RoleModelPolicy {
	const enabled = roleModelPolicyEnabled(env);
	const roles: Partial<Record<RoleModelRole, RoleModelConfig>> = {};
	if (!enabled) return { enabled, roles };
	for (const role of ROLES) {
		const suffix = role.toUpperCase();
		const model = env[`PI_PLANNER_ONLY_MODEL_${suffix}`];
		const thinking = env[`PI_PLANNER_ONLY_THINKING_${suffix}`];
		if (model !== undefined || thinking !== undefined) roles[role] = { ...(model !== undefined ? { model } : {}), ...(thinking !== undefined ? { thinking } : {}) };
	}
	return { enabled, roles };
}

function parseValue(role: RoleModelRole, field: "model" | "thinking", raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (!trimmed || /\s/.test(trimmed)) {
		throw new Error(`Planner-only guard: role model policy cannot resolve ${role} ${field} ${raw}: value must be non-empty and contain no whitespace.`);
	}
	return trimmed;
}

export function resolveRoleModel(
	policy: RoleModelPolicy,
	roleInput: string | TaskRole,
	input: Record<string, unknown>,
): RoleModelResolution | undefined {
	if (!policy.enabled) return undefined;
	const role = roleKey(String(roleInput));
	if (!role) return undefined;
	const config = policy.roles[role];
	const modelRaw = config?.model;
	const thinkingRaw = config?.thinking;
	const missing: string[] = [];
	if (modelRaw === undefined) missing.push("model");
	if (thinkingRaw === undefined) missing.push("thinking");
	if (missing.length) {
		throw new Error(`Planner-only guard: role model policy is enabled but ${role} is missing ${missing.join(" and ")}.`);
	}
	const model = parseValue(role, "model", modelRaw);
	const thinking = parseValue(role, "thinking", thinkingRaw);
	if (!model || !thinking) throw new Error("Planner-only guard: role model policy configuration is incomplete.");
	for (const [field, policyValue] of [["model", model], ["thinking", thinking]] as const) {
		const callerValue = input[field];
		if (typeof callerValue === "string" && callerValue.trim() && callerValue !== policyValue) {
			throw new Error(`Planner-only guard: role model policy conflict for ${role}: caller=${callerValue} policy=${policyValue}.`);
		}
	}
	input.model = model;
	input.thinking = thinking;
	return { role, model, thinking };
}

export function configuredRoleModelSummaries(policy: RoleModelPolicy): string[] {
	return ROLES.filter((role) => policy.roles[role]?.model !== undefined && policy.roles[role]?.thinking !== undefined)
		.map((role) => `${role}: model=${policy.roles[role]?.model} thinking=${policy.roles[role]?.thinking}`);
}

export const ROLE_MODEL_ROLES = ROLES;
