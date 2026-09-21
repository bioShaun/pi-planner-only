import type { TaskRole } from "./types.ts";

export type RoleModelRole = "root" | "reviewer" | "worker" | "explorer" | "validator";

export interface RoleModelConfig {
	model?: string;
	thinking?: string;
	/** Explicitly configured alternatives, tried in order by model preflight. */
	fallbacks?: RoleModelConfig[];
	fallback?: RoleModelConfig[];
}

export interface RoleModelPolicy {
	enabled: boolean;
	roles: Partial<Record<RoleModelRole, RoleModelConfig>>;
}

export type ModelSelectionSource = "explicit" | "role-policy" | "role-policy-fallback" | "host-default";

/** Audit-only: TaskSpec once carried model/thinking; they are never effective (ticket 43). */
export type IgnoredModelSelectionSource = "task-spec";

export interface RoleModelResolution {
	role: RoleModelRole;
	model: string;
	thinking?: string;
	/** Sources are optional for compatibility with callers that construct resolutions. */
	modelSource?: ModelSelectionSource;
	thinkingSource?: ModelSelectionSource;
	fallbacks?: RoleModelConfig[];
}

export interface ModelRegistryLike {
	getAvailable?: () => readonly unknown[];
	getAll?: () => readonly unknown[];
	getError?: () => string | undefined;
}

export interface ModelPreflightContext {
	input: Record<string, unknown>;
	roleResolution?: Pick<RoleModelResolution, "role" | "model" | "thinking" | "fallbacks" | "modelSource" | "thinkingSource">;
	rolePolicy?: RoleModelPolicy;
	/**
	 * Nested TaskSpec model/thinking, if any. Accepted only for ignore-audit
	 * provenance — never becomes the effective model/thinking (ticket 43).
	 */
	taskSpecModel?: string;
	taskSpecThinking?: string;
	hostModel?: { provider?: string; id?: string };
	/** Builtin agent/role whose host default is being inspected. */
	hostAgent?: string;
	agentOverrides?: Record<string, unknown>;
	/** Host global default used when no role/agent override exists. */
	defaultModel?: { provider?: string; id?: string } | string;
	hostThinking?: string;
	registry?: ModelRegistryLike;
	pricing?: { rates: Record<string, unknown> };
}

export interface ModelPreflightResult {
	status: "verified" | "blocked" | "unverified";
	effective?: { provider?: string; model: string; thinking?: string; source: ModelSelectionSource; modelSource: ModelSelectionSource; thinkingSource?: ModelSelectionSource };
	error?: { code: "MODEL_UNAVAILABLE"; source: ModelSelectionSource; requested: string; candidates: string[]; verification: "verified" | "unverified"; message: string };
	/** Present when TaskSpec carried model/thinking that were ignored for effective resolution. */
	ignored?: { source: IgnoredModelSelectionSource; model?: string; thinking?: string };
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
	const expectedThinking = resolved.thinking?.trim();
	return {
		actualModel,
		actualThinking,
		unknownModel,
		unknownThinking,
		mismatch: (!unknownModel && actualModel !== resolved.model.trim())
			|| (Boolean(expectedThinking) && !unknownThinking && actualThinking !== expectedThinking),
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
		const fallbackRaw = env[`PI_PLANNER_ONLY_MODEL_${suffix}_FALLBACK`] ?? env[`PI_PLANNER_ONLY_MODEL_${suffix}_FALLBACKS`];
		const fallbackThinking = env[`PI_PLANNER_ONLY_THINKING_${suffix}_FALLBACK`];
		const fallbacks = parseConfiguredFallbacks(fallbackRaw, fallbackThinking);
		if (model !== undefined || thinking !== undefined || fallbacks.length > 0) {
			roles[role] = {
				...(model !== undefined ? { model } : {}),
				...(thinking !== undefined ? { thinking } : {}),
				...(fallbacks.length > 0 ? { fallbacks } : {}),
			};
		}
	}
	return { enabled, roles };
}

function parseConfiguredFallbacks(raw: string | undefined, thinking: string | undefined): RoleModelConfig[] {
	if (!raw?.trim()) return [];
	let values: unknown = raw.split(",").map((value) => value.trim()).filter(Boolean);
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) values = parsed;
	} catch {
		// Comma-separated model ids are the intentionally simple env form.
	}
	if (!Array.isArray(values)) return [];
	return values.map((value) => {
		if (typeof value === "string") return { model: value, ...(thinking?.trim() ? { thinking: thinking.trim() } : {}) };
		if (!value || typeof value !== "object") return {};
		const rec = value as Record<string, unknown>;
		return {
			...(typeof rec.model === "string" ? { model: rec.model } : {}),
			...(typeof rec.thinking === "string" ? { thinking: rec.thinking } : thinking?.trim() ? { thinking: thinking.trim() } : {}),
		};
	}).filter((value) => Boolean(value.model));
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
	const fallbacks = config?.fallbacks ?? config?.fallback;
	input.model = model;
	input.thinking = thinking;
	return { role, model, thinking, ...(fallbacks?.length ? { fallbacks } : {}) };
}

export function preflightEffectiveModel(context: ModelPreflightContext): ModelPreflightResult {
	const inputModel = typeof context.input.model === "string" && context.input.model.trim() ? context.input.model.trim() : undefined;
	const inputThinking = typeof context.input.thinking === "string" && context.input.thinking.trim() ? context.input.thinking.trim() : undefined;
	const role = context.roleResolution;
	const roleModel = role?.model?.trim() || undefined;
	// Ticket 43: TaskSpec model/thinking are audit-only and never effective.
	const ignoredTaskSpecModel = context.taskSpecModel?.trim() || undefined;
	const ignoredTaskSpecThinking = context.taskSpecThinking?.trim() || undefined;
	const ignored = (ignoredTaskSpecModel || ignoredTaskSpecThinking)
		? {
			source: "task-spec" as const,
			...(ignoredTaskSpecModel ? { model: ignoredTaskSpecModel } : {}),
			...(ignoredTaskSpecThinking ? { thinking: ignoredTaskSpecThinking } : {}),
		}
		: undefined;
	const withIgnored = <T extends ModelPreflightResult>(result: T): T => (
		ignored ? { ...result, ignored } : result
	);
	const roleKey = role?.role
		?? (typeof context.hostAgent === "string" ? context.hostAgent.trim().toLowerCase() : undefined)
		?? (typeof context.input.__delegationRole === "string" ? context.input.__delegationRole.trim().toLowerCase() : undefined)
		?? (typeof context.input.agent === "string" ? context.input.agent.trim().toLowerCase() : undefined);
	const hostOverride = roleKey ? modelConfigValue(context.agentOverrides?.[roleKey]) : undefined;
	const hostDefault = hostOverride ?? modelConfigValue(context.defaultModel) ?? context.hostModel;
	const defaultModel = hostDefault?.id?.trim() || undefined;
	const modelSource: ModelSelectionSource = roleModel
		? "role-policy"
		: inputModel
			? "explicit"
			: "host-default";
	const modelValue = roleModel || inputModel || defaultModel;
	const thinking = role?.thinking?.trim() || inputThinking
		|| (modelSource === "host-default" ? context.hostThinking?.trim() : undefined);
	const thinkingSource: ModelSelectionSource | undefined = role?.thinking?.trim()
		? "role-policy"
		: inputThinking
			? "explicit"
			: modelSource === "host-default" && context.hostThinking?.trim()
				? "host-default"
				: undefined;
	const provider = roleModel
		? providerFromModel(roleModel)
		: inputModel
			? providerFromModel(inputModel)
			: hostDefault?.provider?.trim() || providerFromModel(defaultModel);
	if (!modelValue) return withIgnored(unavailableModel(modelSource, "(no effective model)", [], "unverified", "host default model is unavailable"));

	const registryState = registryModels(context.registry);
	const candidates = registryState.models.length > 0 ? registryState.models : pricingModels(context.pricing);
	const effective = (value: string, valueSource: ModelSelectionSource = modelSource, valueThinking = thinking, valueThinkingSource: ModelSelectionSource | undefined = thinkingSource) => {
		const result: { provider?: string; model: string; thinking?: string; source: ModelSelectionSource; modelSource?: ModelSelectionSource; thinkingSource?: ModelSelectionSource } = {
			...(providerFromModel(value) || provider ? { provider: providerFromModel(value) || provider } : {}),
			model: modelIdFromModel(value),
			...(valueThinking ? { thinking: valueThinking } : {}),
			source: valueSource,
		};
		// Keep the legacy enumerable shape (`source`) while exposing independent
		// provenance to callers that need field-level attribution.
		Object.defineProperty(result, "modelSource", { value: valueSource, enumerable: false });
		if (valueThinkingSource) Object.defineProperty(result, "thinkingSource", { value: valueThinkingSource, enumerable: false });
		return result as { provider?: string; model: string; thinking?: string; source: ModelSelectionSource; modelSource: ModelSelectionSource; thinkingSource?: ModelSelectionSource };
	};
	if (registryState.unverified) {
		return withIgnored({
			status: "unverified",
			effective: effective(modelValue),
			error: unavailableModel(modelSource, modelValue, candidates, "unverified", registryState.reason ?? "model registry is unavailable").error,
		});
	}
	if (registryState.models.some((candidate) => modelMatches(modelValue, provider, candidate))) {
		return withIgnored({ status: "verified", effective: effective(modelValue) });
	}

	const roleFallbacks = role?.fallbacks ?? (role?.role && context.rolePolicy?.roles[role.role]?.fallbacks)
		?? (role?.role && context.rolePolicy?.roles[role.role]?.fallback) ?? [];
	for (const fallback of roleFallbacks) {
		const fallbackModel = fallback.model?.trim();
		if (!fallbackModel || !registryState.models.some((candidate) => modelMatches(fallbackModel, providerFromModel(fallbackModel), candidate))) continue;
		return withIgnored({
			status: "verified",
			effective: effective(fallbackModel, "role-policy-fallback", fallback.thinking?.trim() || thinking, fallback.thinking?.trim() ? "role-policy-fallback" : thinkingSource),
		});
	}
	return withIgnored(unavailableModel(modelSource, modelValue, candidates, "verified", "effective model is absent from the host model registry"));
}

function modelConfigValue(value: unknown): { provider?: string; id?: string } | undefined {
	if (typeof value === "string" && value.trim()) return { id: value.trim(), provider: providerFromModel(value) };
	if (!value || typeof value !== "object") return undefined;
	const rec = value as Record<string, unknown>;
	const id = typeof rec.id === "string" ? rec.id.trim() : typeof rec.model === "string" ? rec.model.trim() : "";
	if (!id) return undefined;
	return { id: modelIdFromModel(id), provider: typeof rec.provider === "string" ? rec.provider.trim() : providerFromModel(id) };
}

function modelIdFromModel(value: string): string {
	const clean = stripThinkingSuffix(value);
	const slash = clean.lastIndexOf("/");
	return slash > 0 ? clean.slice(slash + 1) : clean;
}


function providerFromModel(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const clean = stripThinkingSuffix(value);
	const slash = clean.indexOf("/");
	return slash > 0 ? clean.slice(0, slash) : undefined;
}

function stripThinkingSuffix(value: string): string {
	return value.trim().replace(/:(?:off|minimal|low|medium|high|xhigh)$/i, "");
}

function modelKey(value: string): string {
	return stripThinkingSuffix(value).toLowerCase().replace(/(?:19|20)\d{6}/g, "").replace(/[._-]/g, "");
}

function modelMatches(value: string, provider: string | undefined, candidate: string): boolean {
	const requested = modelKey(value);
	const candidateKey = modelKey(candidate);
	if (requested === candidateKey) return true;
	const requestedBare = requested.includes("/") ? requested.slice(requested.indexOf("/") + 1) : requested;
	const candidateBare = candidateKey.includes("/") ? candidateKey.slice(candidateKey.indexOf("/") + 1) : candidateKey;
	return requestedBare === candidateBare && (!provider || candidateKey.startsWith(`${modelKey(provider)}/`));
}

function registryModels(registry: ModelRegistryLike | undefined): { models: string[]; unverified: boolean; reason?: string } {
	if (!registry) return { models: [], unverified: true, reason: "model registry was not provided" };
	try {
		const error = registry.getError?.();
		if (error) return { models: [], unverified: true, reason: error };
		const raw = registry.getAvailable?.() ?? registry.getAll?.();
		if (!Array.isArray(raw)) return { models: [], unverified: true, reason: "model registry returned no readable model list" };
		const models = raw.map((item) => {
			if (typeof item === "string") return item.trim();
			if (!item || typeof item !== "object") return "";
			const rec = item as Record<string, unknown>;
			const id = typeof rec.id === "string" ? rec.id.trim() : "";
			const provider = typeof rec.provider === "string" ? rec.provider.trim() : "";
			return provider && id ? `${provider}/${id}` : id;
		}).filter(Boolean);
		return { models: [...new Set(models)], unverified: false };
	} catch (error) {
		return { models: [], unverified: true, reason: error instanceof Error ? error.message : String(error) };
	}
}

function pricingModels(pricing: ModelPreflightContext["pricing"]): string[] {
	return pricing?.rates ? Object.keys(pricing.rates).filter(Boolean).slice(0, 5) : [];
}

function unavailableModel(source: ModelSelectionSource, requested: string, candidates: string[], verification: "verified" | "unverified", message: string): ModelPreflightResult {
	const bounded = [...new Set(candidates)].slice(0, 5);
	return {
		status: verification === "unverified" ? "unverified" : "blocked",
		error: {
			code: "MODEL_UNAVAILABLE",
			source,
			requested,
			candidates: bounded,
			verification,
			message,
		},
	};
}
export function configuredRoleModelSummaries(policy: RoleModelPolicy): string[] {
	return ROLES.filter((role) => policy.roles[role]?.model !== undefined && policy.roles[role]?.thinking !== undefined)
		.map((role) => `${role}: model=${policy.roles[role]?.model} thinking=${policy.roles[role]?.thinking}`);
}

export const ROLE_MODEL_ROLES = ROLES;
