/**
 * Default floor budgets and resolution rules for bounded delegations and initial workers.
 *
 * All floor default numbers must be defined here in DEFAULT_FLOORS and nowhere else.
 */

export interface BoundedFloorConfig {
	readonly toolBudgetHard: number;
	readonly tokensHard: number;
	readonly costUsdHard: number;
}

export interface WorkerInitialFloorConfig {
	readonly tokensHard: number;
	readonly costUsdHard: number;
}

export interface FloorConfig {
	readonly bounded: BoundedFloorConfig;
	readonly workerInitial: WorkerInitialFloorConfig;
}

/**
 * Frozen default values per spec:
 * - Bounded (correction worker, report-correction worker, validator, explorer):
 *   toolBudget.hard = 20, usageBudget.tokens.hard = 40000, usageBudget.costUsd.hard = 0.10
 * - Worker Initial (reports.length === 0 or no Task):
 *   no default toolBudget, usageBudget.tokens.hard = 100000, usageBudget.costUsd.hard = 0.50
 * - Reviewer: no default floor
 */
export const DEFAULT_FLOORS: FloorConfig = Object.freeze({
	bounded: Object.freeze({
		toolBudgetHard: 20,
		tokensHard: 40_000,
		costUsdHard: 0.10,
	}),
	workerInitial: Object.freeze({
		tokensHard: 100_000,
		costUsdHard: 0.50,
	}),
});

export const FLOOR_ENV_VARS = {
	BOUNDED_TOOL_HARD: "PI_PLANNER_ONLY_FLOOR_BOUNDED_TOOL_HARD",
	BOUNDED_TOKENS_HARD: "PI_PLANNER_ONLY_FLOOR_BOUNDED_TOKENS_HARD",
	BOUNDED_COST_USD_HARD: "PI_PLANNER_ONLY_FLOOR_BOUNDED_COST_USD_HARD",
	WORKER_TOKENS_HARD: "PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD",
	WORKER_COST_USD_HARD: "PI_PLANNER_ONLY_FLOOR_WORKER_COST_USD_HARD",
} as const;

function parsePositiveFiniteNumber(
	envVar: string,
	raw: string | undefined,
	defaultValue: number,
): number {
	if (raw === undefined) {
		return defaultValue;
	}
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new Error(
			`Floor configuration error: ${envVar} is set but empty; must be a positive finite number (> 0).`,
		);
	}
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(
			`Floor configuration error: ${envVar}="${raw}" is invalid; must be a positive finite number (> 0).`,
		);
	}
	return parsed;
}

/**
 * Load and validate floor config from environment variables.
 * If any floor env var is set but empty, non-finite, or <= 0, throws an Error.
 */
export function loadFloorConfig(env: NodeJS.ProcessEnv = process.env): FloorConfig {
	return {
		bounded: {
			toolBudgetHard: parsePositiveFiniteNumber(
				FLOOR_ENV_VARS.BOUNDED_TOOL_HARD,
				env[FLOOR_ENV_VARS.BOUNDED_TOOL_HARD],
				DEFAULT_FLOORS.bounded.toolBudgetHard,
			),
			tokensHard: parsePositiveFiniteNumber(
				FLOOR_ENV_VARS.BOUNDED_TOKENS_HARD,
				env[FLOOR_ENV_VARS.BOUNDED_TOKENS_HARD],
				DEFAULT_FLOORS.bounded.tokensHard,
			),
			costUsdHard: parsePositiveFiniteNumber(
				FLOOR_ENV_VARS.BOUNDED_COST_USD_HARD,
				env[FLOOR_ENV_VARS.BOUNDED_COST_USD_HARD],
				DEFAULT_FLOORS.bounded.costUsdHard,
			),
		},
		workerInitial: {
			tokensHard: parsePositiveFiniteNumber(
				FLOOR_ENV_VARS.WORKER_TOKENS_HARD,
				env[FLOOR_ENV_VARS.WORKER_TOKENS_HARD],
				DEFAULT_FLOORS.workerInitial.tokensHard,
			),
			costUsdHard: parsePositiveFiniteNumber(
				FLOOR_ENV_VARS.WORKER_COST_USD_HARD,
				env[FLOOR_ENV_VARS.WORKER_COST_USD_HARD],
				DEFAULT_FLOORS.workerInitial.costUsdHard,
			),
		},
	};
}

export type LimitSource = "floor" | "caller" | "taskSpec" | "balance";

export interface EffectiveLimit {
	readonly value: number;
	readonly source: LimitSource;
}

export interface EffectiveLimits {
	toolBudget?: EffectiveLimit;
	tokens?: EffectiveLimit;
	costUsd?: EffectiveLimit;
}

export interface ResolveLimitsOptions {
	role: string;
	reportsCount?: number;
	callerToolBudget?: unknown;
	callerUsageBudget?: unknown;
	taskSpecBudget?: unknown;
	balanceTokens?: number;
	balanceCostUsd?: number;
	config?: FloorConfig;
}

function extractPositiveFinite(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return value;
	}
	return undefined;
}

function extractCallerToolHard(input: unknown): number | undefined {
	if (!input || typeof input !== "object") return undefined;
	return extractPositiveFinite((input as { hard?: unknown }).hard);
}

function extractCallerTokensHard(input: unknown): number | undefined {
	if (!input || typeof input !== "object") return undefined;
	const tokens = (input as { tokens?: unknown }).tokens;
	if (!tokens || typeof tokens !== "object") return undefined;
	return extractPositiveFinite((tokens as { hard?: unknown }).hard);
}

function extractCallerCostUsdHard(input: unknown): number | undefined {
	if (!input || typeof input !== "object") return undefined;
	const costUsd = (input as { costUsd?: unknown }).costUsd;
	if (!costUsd || typeof costUsd !== "object") return undefined;
	return extractPositiveFinite((costUsd as { hard?: unknown }).hard);
}

function extractBudgetTokens(budget: unknown): number | undefined {
	if (!budget || typeof budget !== "object") return undefined;
	const b = budget as Record<string, unknown>;
	if (b.usageBudget && typeof b.usageBudget === "object") {
		const res = extractBudgetTokens(b.usageBudget);
		if (res !== undefined) return res;
	}
	if (typeof b.tokens === "number") return extractPositiveFinite(b.tokens);
	if (b.tokens && typeof b.tokens === "object") {
		return extractPositiveFinite((b.tokens as { hard?: unknown }).hard);
	}
	return undefined;
}

function extractBudgetCostUsd(budget: unknown): number | undefined {
	if (!budget || typeof budget !== "object") return undefined;
	const b = budget as Record<string, unknown>;
	if (b.usageBudget && typeof b.usageBudget === "object") {
		const res = extractBudgetCostUsd(b.usageBudget);
		if (res !== undefined) return res;
	}
	if (typeof b.costUsd === "number") return extractPositiveFinite(b.costUsd);
	if (b.costUsd && typeof b.costUsd === "object") {
		return extractPositiveFinite((b.costUsd as { hard?: unknown }).hard);
	}
	return undefined;
}

function extractBudgetTool(budget: unknown): number | undefined {
	if (!budget || typeof budget !== "object") return undefined;
	const b = budget as Record<string, unknown>;
	if (typeof b.toolBudget === "number") return extractPositiveFinite(b.toolBudget);
	if (b.toolBudget && typeof b.toolBudget === "object") {
		return extractPositiveFinite((b.toolBudget as { hard?: unknown }).hard);
	}
	if (typeof b.tools === "number") return extractPositiveFinite(b.tools);
	if (b.tools && typeof b.tools === "object") {
		return extractPositiveFinite((b.tools as { hard?: unknown }).hard);
	}
	return undefined;
}

/**
 * Resolve effective limits across toolBudget, usageBudget.tokens, and usageBudget.costUsd.
 * For each dimension, takes the minimum of valid positive finite values among floor, caller, and taskSpec.
 */
export function resolveEffectiveLimits(options: ResolveLimitsOptions): EffectiveLimits {
	const config = options.config ?? loadFloorConfig();

	let floorTool: number | undefined;
	let floorTokens: number | undefined;
	let floorCostUsd: number | undefined;

	if (options.role === "reviewer") {
		// Reviewer: no default floors
	} else if (options.role === "explorer" || options.role === "validator") {
		floorTool = config.bounded.toolBudgetHard;
		floorTokens = config.bounded.tokensHard;
		floorCostUsd = config.bounded.costUsdHard;
	} else if (options.role === "worker") {
		if (options.reportsCount !== undefined && options.reportsCount > 0) {
			// Bounded worker (correction / report correction)
			floorTool = config.bounded.toolBudgetHard;
			floorTokens = config.bounded.tokensHard;
			floorCostUsd = config.bounded.costUsdHard;
		} else {
			// Initial worker: no toolBudget floor
			floorTokens = config.workerInitial.tokensHard;
			floorCostUsd = config.workerInitial.costUsdHard;
		}
	}

	const callerTool = extractCallerToolHard(options.callerToolBudget);
	const callerTokens = extractCallerTokensHard(options.callerUsageBudget);
	const callerCostUsd = extractCallerCostUsdHard(options.callerUsageBudget);

	const specTool = extractBudgetTool(options.taskSpecBudget);
	const specTokens = extractBudgetTokens(options.taskSpecBudget);
	const specCostUsd = extractBudgetCostUsd(options.taskSpecBudget);

	// Dimension 1: toolBudget
	let effectiveTool: EffectiveLimit | undefined;
	if (floorTool !== undefined) {
		const candidates: { value: number; source: LimitSource }[] = [
			{ value: floorTool, source: "floor" },
		];
		if (callerTool !== undefined) candidates.push({ value: callerTool, source: "caller" });
		if (specTool !== undefined) candidates.push({ value: specTool, source: "taskSpec" });

		let best = candidates[0];
		for (let i = 1; i < candidates.length; i++) {
			const c = candidates[i];
			if (c.value < best.value) {
				best = c;
			}
		}
		effectiveTool = best;
	} else {
		if (callerTool !== undefined && (specTool === undefined || callerTool <= specTool)) {
			effectiveTool = { value: callerTool, source: "caller" };
		} else if (specTool !== undefined) {
			effectiveTool = { value: specTool, source: "taskSpec" };
		}
	}

	// Dimension 2: tokens
	let effectiveTokens: EffectiveLimit | undefined;
	if (floorTokens !== undefined) {
		const candidates: { value: number; source: LimitSource }[] = [
			{ value: floorTokens, source: "floor" },
		];
		if (callerTokens !== undefined) candidates.push({ value: callerTokens, source: "caller" });
		if (specTokens !== undefined) candidates.push({ value: specTokens, source: "taskSpec" });
		if (options.balanceTokens !== undefined) candidates.push({ value: options.balanceTokens, source: "balance" });

		let best = candidates[0];
		for (let i = 1; i < candidates.length; i++) {
			const c = candidates[i];
			if (c.value < best.value) {
				best = c;
			}
		}
		effectiveTokens = best;
	} else {
		if (callerTokens !== undefined && (specTokens === undefined || callerTokens <= specTokens)
			&& (options.balanceTokens === undefined || callerTokens <= options.balanceTokens)) {
			effectiveTokens = { value: callerTokens, source: "caller" };
		} else if (specTokens !== undefined && (options.balanceTokens === undefined || specTokens <= options.balanceTokens)) {
			effectiveTokens = { value: specTokens, source: "taskSpec" };
		} else if (options.balanceTokens !== undefined) {
			effectiveTokens = { value: options.balanceTokens, source: "balance" };
		}
	}

	// Dimension 3: costUsd
	let effectiveCostUsd: EffectiveLimit | undefined;
	if (floorCostUsd !== undefined) {
		const candidates: { value: number; source: LimitSource }[] = [
			{ value: floorCostUsd, source: "floor" },
		];
		if (callerCostUsd !== undefined) candidates.push({ value: callerCostUsd, source: "caller" });
		if (specCostUsd !== undefined) candidates.push({ value: specCostUsd, source: "taskSpec" });
		if (options.balanceCostUsd !== undefined) candidates.push({ value: options.balanceCostUsd, source: "balance" });

		let best = candidates[0];
		for (let i = 1; i < candidates.length; i++) {
			const c = candidates[i];
			if (c.value < best.value) {
				best = c;
			}
		}
		effectiveCostUsd = best;
	} else {
		if (callerCostUsd !== undefined && (specCostUsd === undefined || callerCostUsd <= specCostUsd)
			&& (options.balanceCostUsd === undefined || callerCostUsd <= options.balanceCostUsd)) {
			effectiveCostUsd = { value: callerCostUsd, source: "caller" };
		} else if (specCostUsd !== undefined && (options.balanceCostUsd === undefined || specCostUsd <= options.balanceCostUsd)) {
			effectiveCostUsd = { value: specCostUsd, source: "taskSpec" };
		} else if (options.balanceCostUsd !== undefined) {
			effectiveCostUsd = { value: options.balanceCostUsd, source: "balance" };
		}
	}

	return {
		...(effectiveTool !== undefined ? { toolBudget: effectiveTool } : {}),
		...(effectiveTokens !== undefined ? { tokens: effectiveTokens } : {}),
		...(effectiveCostUsd !== undefined ? { costUsd: effectiveCostUsd } : {}),
	};
}

/**
 * Format effective limits with their sources.
 * Example: `toolBudget.hard=20 (floor), usageBudget.tokens.hard=40000 (floor), usageBudget.costUsd.hard=0.1 (floor)`
 */
export function formatFloorLimitsSummary(limits: EffectiveLimits): string {
	const parts: string[] = [];
	if (limits.toolBudget) {
		parts.push(`toolBudget.hard=${limits.toolBudget.value} (${limits.toolBudget.source})`);
	}
	if (limits.tokens) {
		parts.push(`usageBudget.tokens.hard=${limits.tokens.value} (${limits.tokens.source})`);
	}
	if (limits.costUsd) {
		parts.push(`usageBudget.costUsd.hard=${limits.costUsd.value} (${limits.costUsd.source})`);
	}
	return parts.join(", ");
}
