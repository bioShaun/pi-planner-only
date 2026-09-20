import type { ExecutionEnvelope } from "./types.ts";

export const DEFAULT_EXECUTION_MAX_TOKENS = 100_000;
export const DEFAULT_EXECUTION_MAX_WALL_MS = 600_000; // ADR-0008: ten minutes, inside the fifteen-minute Request window
/** ADR-0010: provisional scheduling margin retained for Root validation/review. */
export const REQUEST_EXECUTION_RESERVE_MS = 60_000;

export const EXECUTION_DEFAULT_ENV_VARS = Object.freeze({
	MAX_TOKENS: "PI_PLANNER_ONLY_EXECUTION_MAX_TOKENS",
	MAX_WALL_MS: "PI_PLANNER_ONLY_EXECUTION_MAX_WALL_MS",
});

export class ExecutionDefaultsConfigError extends Error {
	readonly code = "EXECUTION_DEFAULTS_INVALID";

	constructor(message: string) {
		super(message);
		this.name = "ExecutionDefaultsConfigError";
	}
}

function positiveSafeInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): { value: number; configured: boolean } {
	const raw = env[name];
	if (raw === undefined) return { value: fallback, configured: false };
	const normalized = raw.trim();
	if (!/^[1-9]\d*$/.test(normalized)) {
		throw new ExecutionDefaultsConfigError(`${name} must be a positive finite safe integer, got ${JSON.stringify(raw)}`);
	}
	const value = Number(normalized);
	if (!Number.isSafeInteger(value)) {
		throw new ExecutionDefaultsConfigError(`${name} must be a positive finite safe integer, got ${JSON.stringify(raw)}`);
	}
	return { value, configured: true };
}

/** Load one immutable execution-default snapshot for a delegation invocation. */
export function loadExecutionDefaults(env: NodeJS.ProcessEnv = process.env): ExecutionEnvelope {
	const tokens = positiveSafeInteger(env, EXECUTION_DEFAULT_ENV_VARS.MAX_TOKENS, DEFAULT_EXECUTION_MAX_TOKENS);
	const wall = positiveSafeInteger(env, EXECUTION_DEFAULT_ENV_VARS.MAX_WALL_MS, DEFAULT_EXECUTION_MAX_WALL_MS);
	return Object.freeze({
		maxTokens: tokens.value,
		maxWallMs: wall.value,
		source: tokens.configured || wall.configured ? "operator-config" : "default",
	});
}
