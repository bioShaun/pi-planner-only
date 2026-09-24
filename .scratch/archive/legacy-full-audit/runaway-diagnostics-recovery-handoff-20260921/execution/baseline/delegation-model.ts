import { loadRoleModelPolicy, resolveRoleModel } from "./role-models.ts";
import type { ModelRegistryLike, ModelSelectionSource } from "./role-models.ts";
import type { SubagentDelegationResponse, SubagentDelegationThinking } from "./subagent-delegation-contract.ts";

const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export interface DelegationModel {
	model: string;
	thinking: SubagentDelegationThinking;
	requestedModel: string;
	source: ModelSelectionSource;
}
export interface ModelRouteObservation {
	status: "matched" | "mismatched" | "unknown";
	expected: DelegationModel;
	actualModel?: string;
	actualThinking?: string;
	terminalStatus: SubagentDelegationResponse["status"];
}
export class DelegationModelError extends Error {
	readonly code = "MODEL_ROUTE_UNAVAILABLE";
	constructor(message: string) { super(message); this.name = "DelegationModelError"; }
}

/** Operator policy alone chooses a model. Tool arguments and TaskSpec cannot. */
export function resolveDelegationModel(role: string, registry?: ModelRegistryLike, env: NodeJS.ProcessEnv = process.env): DelegationModel | undefined {
	const policy = loadRoleModelPolicy(env);
	if (!policy.enabled) return undefined;
	try {
		if (typeof registry?.getAvailable !== "function") throw new Error("host available-model registry is required; a catalog alone is insufficient");
		const resolved = resolveRoleModel(policy, role, {});
		if (!resolved || role === "root") throw new Error("a configured child role is required");
		const registryError = registry.getError?.();
		if (registryError) throw new Error(`available-model registry failed: ${registryError}`);
		const available = registry.getAvailable();
		if (!Array.isArray(available)) throw new Error("available-model registry returned no readable model list");
		const ids = new Set(available.map((entry: unknown) => {
			if (typeof entry === "string") return entry.trim();
			if (!entry || typeof entry !== "object") return "";
			const item = entry as { provider?: unknown; id?: unknown };
			return typeof item.provider === "string" && typeof item.id === "string"
				? `${item.provider.trim()}/${item.id.trim()}` : "";
		}));
		// Model IDs are identities, not labels: punctuation, dates and case
		// cannot be discarded. Only operator-declared fallbacks may substitute.
		const candidates = [{ model: resolved.model, thinking: resolved.thinking, source: "role-policy" as const },
			...(resolved.fallbacks ?? []).map(f => ({ model: f.model, thinking: f.thinking?.trim() || resolved.thinking,
				source: "role-policy-fallback" as const }))];
		for (const candidate of candidates) {
			const model = candidate.model?.trim();
			if (!model || !/^[^/\s]+\/\S+$/.test(model) || !ids.has(model)) continue;
			const thinking = candidate.thinking;
			if (!thinking || !THINKING.has(thinking)) throw new Error("thinking must be off, minimal, low, medium, high, xhigh, or max");
			return { model, thinking: thinking as SubagentDelegationThinking, requestedModel: resolved.model, source: candidate.source };
		}
		throw new Error(`configured ${role} provider/model and explicit fallbacks are not in the host's available model registry`);
	} catch (error) {
		throw new DelegationModelError(error instanceof Error ? error.message : "invalid role model policy");
	}
}

/** Compare actual launcher facts, including its supported :thinking suffix. */
export function observeDelegationModel(expected: DelegationModel, terminal: SubagentDelegationResponse): ModelRouteObservation {
	const rawModel = "model" in terminal && typeof terminal.model === "string" ? terminal.model.trim() : "";
	const suffix = rawModel.includes(":") ? rawModel.slice(rawModel.lastIndexOf(":") + 1) : "";
	const suffixThinking = THINKING.has(suffix) ? suffix : undefined;
	const actualModel = suffixThinking ? rawModel.slice(0, rawModel.lastIndexOf(":")) : rawModel;
	const statedThinking = "thinking" in terminal && typeof terminal.thinking === "string" ? terminal.thinking.trim() : undefined;
	const actualThinking = statedThinking || suffixThinking;
	const mismatch = (Boolean(actualModel) && actualModel !== expected.model)
		|| (Boolean(actualThinking) && actualThinking !== expected.thinking)
		|| Boolean(statedThinking && suffixThinking && statedThinking !== suffixThinking);
	return {
		status: mismatch ? "mismatched" : actualModel && actualThinking ? "matched" : "unknown",
		expected,
		...(actualModel ? { actualModel } : {}),
		...(actualThinking ? { actualThinking } : {}),
		terminalStatus: terminal.status,
	};
}

/** Keep usage and typed results diagnostic, but never admit unverified success. */
export function enforceDelegationModel(observation: ModelRouteObservation, terminal: SubagentDelegationResponse): SubagentDelegationResponse {
	if (terminal.status !== "completed" || observation.status === "matched") return terminal;
	return { ...terminal, status: "acceptance_failed", error: `model route ${observation.status}: expected ${observation.expected.model}:${observation.expected.thinking}; actual ${observation.actualModel ?? "unknown"}:${observation.actualThinking ?? "unknown"}; completed result is not accepted` };
}
