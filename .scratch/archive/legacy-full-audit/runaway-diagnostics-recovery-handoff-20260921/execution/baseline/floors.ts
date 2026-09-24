/**
 * Session-root cumulative budget and host-enforcement declarations.
 *
 * The per-delegation floor machinery (DEFAULT_FLOORS, resolveEffectiveLimits,
 * exploration-probe fixtures) was removed in the WRC P0-B verdict: nothing
 * enforced it on the structured delegation path. Per-execution anomaly bounds
 * now live on the explicit `envelope` delegation parameter (spec §4).
 */

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
			`Budget configuration error: ${envVar} is set but empty; must be a positive finite number (> 0).`,
		);
	}
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(
			`Budget configuration error: ${envVar}="${raw}" is invalid; must be a positive finite number (> 0).`,
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
 * Ticket 40 — session-level root cumulative budget.
 *
 * Off by default. When enabled, soft/hard caps are derived from the
 * single-Task initial-worker base × multipliers. Soft warns; hard refuses
 * new paid delegations at the beginDelegation gate.
 * Never kills the current root turn.
 */
export interface SessionRootBudgetConfig {
	/** Soft/hard gate at beginDelegation. Off unless the operator opts in. */
	readonly enabled: boolean;
	readonly softMultiplier: number;
	readonly hardMultiplier: number;
	readonly softTokens: number;
	readonly hardTokens: number;
	readonly softCostUsd: number;
	readonly hardCostUsd: number;
	/** The single-Task base this config was derived from. */
	readonly baseTokens: number;
	readonly baseCostUsd: number;
}

export const DEFAULT_SESSION_ROOT_BUDGET_ENABLED = false;

export const DEFAULT_SESSION_ROOT_MULTIPLIERS = Object.freeze({
	soft: 3,
	hard: 5,
});

export const SESSION_ROOT_BUDGET_ENV_VARS = {
	ENABLED: "PI_PLANNER_ONLY_SESSION_ROOT_BUDGET",
	SOFT_MULTIPLIER: "PI_PLANNER_ONLY_SESSION_ROOT_SOFT_MULTIPLIER",
	HARD_MULTIPLIER: "PI_PLANNER_ONLY_SESSION_ROOT_HARD_MULTIPLIER",
} as const;

/**
 * The session budget base reuses the former worker-initial floor env vars so
 * existing operator configuration keeps working (P0-B floors verdict).
 */
const SESSION_ROOT_BASE_ENV_VARS = {
	TOKENS: "PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD",
	COST_USD: "PI_PLANNER_ONLY_FLOOR_WORKER_COST_USD_HARD",
} as const;

const DEFAULT_SESSION_ROOT_BASE = Object.freeze({
	tokens: 100_000,
	costUsd: 0.50,
});

export function loadSessionRootBudgetConfig(
	env: NodeJS.ProcessEnv = process.env,
): SessionRootBudgetConfig {
	const enabled = readEnforcementFlag(
		env[SESSION_ROOT_BUDGET_ENV_VARS.ENABLED],
		SESSION_ROOT_BUDGET_ENV_VARS.ENABLED,
		DEFAULT_SESSION_ROOT_BUDGET_ENABLED,
	);
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
	const baseTokens = parsePositiveFiniteNumber(
		SESSION_ROOT_BASE_ENV_VARS.TOKENS,
		env[SESSION_ROOT_BASE_ENV_VARS.TOKENS],
		DEFAULT_SESSION_ROOT_BASE.tokens,
	);
	const baseCostUsd = parsePositiveFiniteNumber(
		SESSION_ROOT_BASE_ENV_VARS.COST_USD,
		env[SESSION_ROOT_BASE_ENV_VARS.COST_USD],
		DEFAULT_SESSION_ROOT_BASE.costUsd,
	);
	return Object.freeze({
		enabled,
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

export function sessionRootBudgetWithEnabled(
	config: SessionRootBudgetConfig,
	enabled: boolean,
): SessionRootBudgetConfig {
	if (config.enabled === enabled) return config;
	return Object.freeze({ ...config, enabled });
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
	if (!config.enabled) {
		return { level: "ok", spend, config };
	}
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
	];
	if (!config.enabled) {
		lines.push(
			`  会话 root 预算未开启。运行 /planner-only budget on 启用（软顶 ×${config.softMultiplier} / 硬顶 ×${config.hardMultiplier}）。`,
		);
	} else {
		lines.push(
			`  软顶 ×${config.softMultiplier}: tokens=${config.softTokens}, 费用 ${money4(config.softCostUsd)}（警告，不阻止委派）`,
			`  硬顶 ×${config.hardMultiplier}: tokens=${config.hardTokens}, 费用 ${money4(config.hardCostUsd)}（拒绝新的受控付费委派；不掐断当前 root 回合）`,
		);
	}
	lines.push(
		`  其中 untasked: turns=${spend.untaskedTurns}, tokens=${spend.untaskedTokens}, 费用 ${spend.untaskedCostUsd === undefined && spend.untaskedTurns > 0 ? "不可知" : money4(spend.untaskedCostUsd ?? 0, spend.currency)}`,
	);
	if (config.enabled && spend.currency !== "USD") {
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
