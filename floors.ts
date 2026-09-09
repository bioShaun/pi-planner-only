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
 * Which cumulative-budget dimensions the HOST actually stops a child process at.
 *
 * Default false for both: as of pi-subagents 0.66.0 the only thing proven is
 * that the host ACCEPTS the `usageBudget` parameter shape (ticket 05 note,
 * ticket 36 F1). Nothing has ever proven it halts a child at `hard`. Declaring
 * enforcement is therefore an explicit operator statement, never an inference.
 * A dimension left undeclared is reported as post-hoc observation only.
 */
export interface HostEnforcement {
	readonly tokens: boolean;
	readonly costUsd: boolean;
}

export const HOST_ENFORCEMENT_ENV_VARS = {
	TOKENS: "PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS",
	COST_USD: "PI_PLANNER_ONLY_HOST_ENFORCES_COST_USD",
} as const;

export const DEFAULT_HOST_ENFORCEMENT: HostEnforcement = Object.freeze({
	tokens: false,
	costUsd: false,
});

function readEnforcementFlag(raw: string | undefined, envVar: string, fallback: boolean): boolean {
	if (raw === undefined) return fallback;
	const value = raw.trim();
	if (value === "") {
		throw new Error(
			`Host enforcement configuration error: ${envVar} is set but empty; must be 1 or 0.`,
		);
	}
	if (value === "1") return true;
	if (value === "0") return false;
	throw new Error(
		`Host enforcement configuration error: ${envVar}="${raw}" is invalid; must be 1 or 0.`,
	);
}

export function loadHostEnforcement(env: NodeJS.ProcessEnv = process.env): HostEnforcement {
	return Object.freeze({
		tokens: readEnforcementFlag(env[HOST_ENFORCEMENT_ENV_VARS.TOKENS], HOST_ENFORCEMENT_ENV_VARS.TOKENS, DEFAULT_HOST_ENFORCEMENT.tokens),
		costUsd: readEnforcementFlag(env[HOST_ENFORCEMENT_ENV_VARS.COST_USD], HOST_ENFORCEMENT_ENV_VARS.COST_USD, DEFAULT_HOST_ENFORCEMENT.costUsd),
	});
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

/**
 * Ticket 40 — session-level root cumulative budget.
 *
 * Soft/hard caps are derived from the single-Task initial worker delegation
 * floor (workerInitial) × multipliers. Soft warns; hard refuses new paid
 * delegations at the beginDelegation gate. Never kills the current root turn.
 */
export interface SessionRootBudgetConfig {
	readonly softMultiplier: number;
	readonly hardMultiplier: number;
	readonly softTokens: number;
	readonly hardTokens: number;
	readonly softCostUsd: number;
	readonly hardCostUsd: number;
	/** The single-Task delegation floor this config was derived from. */
	readonly baseTokens: number;
	readonly baseCostUsd: number;
}

export const DEFAULT_SESSION_ROOT_MULTIPLIERS = Object.freeze({
	soft: 3,
	hard: 5,
});

export const SESSION_ROOT_BUDGET_ENV_VARS = {
	SOFT_MULTIPLIER: "PI_PLANNER_ONLY_SESSION_ROOT_SOFT_MULTIPLIER",
	HARD_MULTIPLIER: "PI_PLANNER_ONLY_SESSION_ROOT_HARD_MULTIPLIER",
} as const;

export function loadSessionRootBudgetConfig(
	env: NodeJS.ProcessEnv = process.env,
	floors: FloorConfig = loadFloorConfig(env),
): SessionRootBudgetConfig {
	const softMultiplier = parsePositiveFiniteNumber(
		SESSION_ROOT_BUDGET_ENV_VARS.SOFT_MULTIPLIER,
		env[SESSION_ROOT_BUDGET_ENV_VARS.SOFT_MULTIPLIER],
		DEFAULT_SESSION_ROOT_MULTIPLIERS.soft,
	);
	const hardMultiplier = parsePositiveFiniteNumber(
		SESSION_ROOT_BUDGET_ENV_VARS.HARD_MULTIPLIER,
		env[SESSION_ROOT_BUDGET_ENV_VARS.HARD_MULTIPLIER],
		DEFAULT_SESSION_ROOT_MULTIPLIERS.hard,
	);
	if (hardMultiplier < softMultiplier) {
		throw new Error(
			`Session root budget configuration error: hard multiplier (${hardMultiplier}) must be >= soft multiplier (${softMultiplier}).`,
		);
	}
	const baseTokens = floors.workerInitial.tokensHard;
	const baseCostUsd = floors.workerInitial.costUsdHard;
	return Object.freeze({
		softMultiplier,
		hardMultiplier,
		baseTokens,
		baseCostUsd,
		softTokens: baseTokens * softMultiplier,
		hardTokens: baseTokens * hardMultiplier,
		softCostUsd: baseCostUsd * softMultiplier,
		hardCostUsd: baseCostUsd * hardMultiplier,
	});
}

export type SessionRootCurrency = "USD" | "CNY";

export interface SessionRootSpend {
	readonly turns: number;
	readonly tokens: number;
	/** Known cost in `currency`; undefined when any contributing root bucket has unknown cost. */
	readonly costUsd: number | undefined;
	readonly costUnknown: boolean;
	/**
	 * Currency the ledger's pricing table is declared in. The soft/hard cost caps
	 * are USD-denominated, so the cost dimension is only gated when this is USD;
	 * other currencies fall back to the tokens dimension alone.
	 */
	readonly currency: SessionRootCurrency;
	readonly untaskedTurns: number;
	readonly untaskedTokens: number;
	readonly untaskedCostUsd: number | undefined;
}

export type SessionRootBudgetLevel = "ok" | "soft" | "hard";

export interface SessionRootBudgetEvaluation {
	readonly level: SessionRootBudgetLevel;
	/** Which dimension first tripped the hard (or soft) cap, preferring costUsd when both trip. */
	readonly dimension?: "tokens" | "costUsd";
	readonly spend: SessionRootSpend;
	readonly config: SessionRootBudgetConfig;
}

/** True when the spend's cost can be compared against the USD-denominated caps. */
export function sessionRootCostComparable(spend: SessionRootSpend): boolean {
	return spend.currency === "USD" && !spend.costUnknown && spend.costUsd !== undefined;
}

/**
 * Evaluate session root spend against soft (×3) and hard (×5) caps.
 * Hard takes precedence over soft. Cost is skipped when costUnknown or when
 * the ledger currency is not USD.
 */
export function evaluateSessionRootBudget(
	spend: SessionRootSpend,
	config: SessionRootBudgetConfig = loadSessionRootBudgetConfig(),
): SessionRootBudgetEvaluation {
	const costComparable = sessionRootCostComparable(spend);
	const tokensHard = spend.tokens >= config.hardTokens;
	const costHard = costComparable && spend.costUsd !== undefined && spend.costUsd >= config.hardCostUsd;
	if (tokensHard || costHard) {
		return {
			level: "hard",
			dimension: costHard ? "costUsd" : "tokens",
			spend,
			config,
		};
	}
	const tokensSoft = spend.tokens >= config.softTokens;
	const costSoft = costComparable && spend.costUsd !== undefined && spend.costUsd >= config.softCostUsd;
	if (tokensSoft || costSoft) {
		return {
			level: "soft",
			dimension: costSoft ? "costUsd" : "tokens",
			spend,
			config,
		};
	}
	return { level: "ok", spend, config };
}

function money4(value: number, currency: SessionRootCurrency = "USD"): string {
	return `${currency === "CNY" ? "¥" : "$"}${value.toFixed(4)}`;
}

function spendCost(spend: SessionRootSpend): string {
	return spend.costUnknown ? "不可知" : money4(spend.costUsd ?? 0, spend.currency);
}

/** Status / operator disclosure for the session root budget (ticket 40 / E1–E2). */
export function formatSessionRootBudgetStatus(evaluation: SessionRootBudgetEvaluation): string {
	const { spend, config, level } = evaluation;
	const costPart = spend.costUnknown
		? "费用不可知"
		: `费用 ${money4(spend.costUsd ?? 0, spend.currency)}`;
	const lines = [
		`Session root budget (累计 root): turns=${spend.turns}, tokens=${spend.tokens}, ${costPart}`,
		`  软顶 ×${config.softMultiplier}: tokens=${config.softTokens}, 费用 ${money4(config.softCostUsd)}（警告，不阻止委派）`,
		`  硬顶 ×${config.hardMultiplier}: tokens=${config.hardTokens}, 费用 ${money4(config.hardCostUsd)}（拒绝新的受控付费委派；不掐断当前 root 回合）`,
		`  其中 untasked: turns=${spend.untaskedTurns}, tokens=${spend.untaskedTokens}, 费用 ${spend.untaskedCostUsd === undefined && spend.untaskedTurns > 0 ? "不可知" : money4(spend.untaskedCostUsd ?? 0, spend.currency)}`,
	];
	if (spend.currency !== "USD") {
		lines.push(`  费率表币种为 ${spend.currency}，与 USD 计价的费用顶无法直接比较；费用维度不参与门控，仅按 tokens 判定。`);
	}
	if (level === "hard") {
		const dimension = evaluation.dimension === "tokens" ? "tokens" : "费用";
		lines.push(
			`  会话 root 预算已停止: ${dimension} 已达硬顶，新的受控付费委派会被拒绝。reviewer 不受此限；当前 root 回合与已在途子进程不受影响。`,
		);
	} else if (level === "soft") {
		const dimension = evaluation.dimension === "tokens" ? "tokens" : "费用";
		lines.push(
			`  会话 root 预算软顶警告: ${dimension} 已达软顶（×${config.softMultiplier}），新的委派仍允许，但继续派发会逼近硬顶。`,
		);
	}
	return lines.join("\n");
}

/** Refusal text when hard cap blocks a paid delegation. */
export function formatSessionRootBudgetRefusal(evaluation: SessionRootBudgetEvaluation): string {
	const { spend, config, dimension } = evaluation;
	const dim = dimension === "tokens" ? "tokens" : "costUsd";
	return [
		`Planner-only guard: session root budget exhausted (${dim}).`,
		`会话 root 累计: tokens=${spend.tokens}, 费用 ${spendCost(spend)}, turns=${spend.turns}`,
		`硬顶: tokens=${config.hardTokens} (×${config.hardMultiplier}), 费用 ${money4(config.hardCostUsd)} (×${config.hardMultiplier})`,
		`软顶: tokens=${config.softTokens} (×${config.softMultiplier}), 费用 ${money4(config.softCostUsd)} (×${config.softMultiplier})`,
		"本次受控付费委派被拒绝；当前会话与当前 root 回合不会被掐断。reviewer 仍可启动以关闭 Task。",
	].join("\n");
}

/** Soft-cap warning pushed into beginDelegation warnings / operator notify. */
export function formatSessionRootBudgetSoftWarning(evaluation: SessionRootBudgetEvaluation): string {
	const { spend, config, dimension } = evaluation;
	const dim = dimension === "tokens" ? "tokens" : "费用";
	return `Planner-only: 会话 root 预算软顶警告（${dim}）。已累计 tokens=${spend.tokens}, 费用 ${spendCost(spend)}；软顶 tokens=${config.softTokens}/费用 ${money4(config.softCostUsd)}。新的委派仍允许，硬顶为 ×${config.hardMultiplier}。`;
}
