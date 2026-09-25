/**
 * Single source of truth for every `PI_PLANNER_ONLY*` environment setting:
 * the parsing helpers, the defaults, and the typed config they produce.
 */

export interface DelegationLimits {
	timeoutMs: number;
	maxTokens: number;
	startTimeoutMs: number;
	cancelGraceMs: number;
}

export type HandoffMode = "auto" | "confirm";

export interface PlannerConfig {
	limits: DelegationLimits;
	/** Root context size (tokens) that turns the status red and triggers the delegation warning. */
	contextWarnTokens: number;
	/** PI_PLANNER_ONLY=1 forces on, =0 forces off; undefined leaves the decision to the off marker. */
	enabled: boolean | undefined;
	strict: boolean;
	handoffMode: HandoffMode;
}

export const DEFAULT_LIMITS: DelegationLimits = {
	timeoutMs: 600_000,
	maxTokens: 1_500_000,
	startTimeoutMs: 30_000,
	cancelGraceMs: 5_000,
};

export const DEFAULT_CONFIG: PlannerConfig = {
	limits: DEFAULT_LIMITS,
	contextWarnTokens: 150_000,
	enabled: undefined,
	strict: false,
	handoffMode: "auto",
};

const TRUE_VALUES = ["1", "true", "on"];
const FALSE_VALUES = ["0", "false", "off"];

const normalize = (value: string | undefined) => (value ?? "").trim().toLowerCase();

/** Positive integer from `env[name]`, otherwise `fallback`. */
export function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
	const value = Number(env[name]);
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** `true` for 1/true/on, `false` for 0/false/off, otherwise `fallback`. */
export function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean;
export function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback?: undefined): boolean | undefined;
export function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback?: boolean): boolean | undefined {
	const value = normalize(env[name]);
	if (TRUE_VALUES.includes(value)) return true;
	if (FALSE_VALUES.includes(value)) return false;
	return fallback;
}

export function loadLimits(env: NodeJS.ProcessEnv = process.env): DelegationLimits {
	return {
		timeoutMs: intEnv(env, "PI_PLANNER_ONLY_TIMEOUT_MS", DEFAULT_LIMITS.timeoutMs),
		maxTokens: intEnv(env, "PI_PLANNER_ONLY_MAX_TOKENS", DEFAULT_LIMITS.maxTokens),
		startTimeoutMs: intEnv(env, "PI_PLANNER_ONLY_START_TIMEOUT_MS", DEFAULT_LIMITS.startTimeoutMs),
		cancelGraceMs: intEnv(env, "PI_PLANNER_ONLY_CANCEL_GRACE_MS", DEFAULT_LIMITS.cancelGraceMs),
	};
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PlannerConfig {
	return {
		limits: loadLimits(env),
		contextWarnTokens: intEnv(env, "PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS", DEFAULT_CONFIG.contextWarnTokens),
		enabled: boolEnv(env, "PI_PLANNER_ONLY"),
		strict: boolEnv(env, "PI_PLANNER_ONLY_STRICT", DEFAULT_CONFIG.strict),
		handoffMode: normalize(env.PI_PLANNER_ONLY_HANDOFF) === "confirm" ? "confirm" : DEFAULT_CONFIG.handoffMode,
	};
}
