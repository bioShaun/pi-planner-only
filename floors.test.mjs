import assert from "node:assert/strict";
import {
	DEFAULT_FLOORS,
	DEFAULT_HOST_ENFORCEMENT,
	FLOOR_ENV_VARS,
	formatFloorLimitsSummary,
	HOST_ENFORCEMENT_ENV_VARS,
	loadFloorConfig,
	loadHostEnforcement,
	resolveEffectiveLimits,
} from "./floors.ts";

// 1. Frozen default constants
assert.equal(DEFAULT_FLOORS.bounded.toolBudgetHard, 20);
assert.equal(DEFAULT_FLOORS.bounded.tokensHard, 40_000);
assert.equal(DEFAULT_FLOORS.bounded.costUsdHard, 0.10);
assert.equal(DEFAULT_FLOORS.workerInitial.tokensHard, 100_000);
assert.equal(DEFAULT_FLOORS.workerInitial.costUsdHard, 0.50);

// 2. Default env loading
{
	const config = loadFloorConfig({});
	assert.deepEqual(config, DEFAULT_FLOORS);
}

// 3. Env overrides
{
	const env = {
		PI_PLANNER_ONLY_FLOOR_BOUNDED_TOOL_HARD: "15",
		PI_PLANNER_ONLY_FLOOR_BOUNDED_TOKENS_HARD: "35000",
		PI_PLANNER_ONLY_FLOOR_BOUNDED_COST_USD_HARD: "0.08",
		PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD: "80000",
		PI_PLANNER_ONLY_FLOOR_WORKER_COST_USD_HARD: "0.40",
	};
	const config = loadFloorConfig(env);
	assert.equal(config.bounded.toolBudgetHard, 15);
	assert.equal(config.bounded.tokensHard, 35000);
	assert.equal(config.bounded.costUsdHard, 0.08);
	assert.equal(config.workerInitial.tokensHard, 80000);
	assert.equal(config.workerInitial.costUsdHard, 0.40);
}

// 4. Invalid env values reject startup (do NOT silently fall back)
for (const envVar of Object.values(FLOOR_ENV_VARS)) {
	// Empty string
	assert.throws(
		() => loadFloorConfig({ [envVar]: "" }),
		(err) => err instanceof Error && err.message.includes(envVar) && err.message.includes("empty"),
		`empty string for ${envVar} must throw`,
	);

	// Whitespace only
	assert.throws(
		() => loadFloorConfig({ [envVar]: "   " }),
		(err) => err instanceof Error && err.message.includes(envVar),
		`whitespace string for ${envVar} must throw`,
	);

	// Non-numeric
	assert.throws(
		() => loadFloorConfig({ [envVar]: "not-a-number" }),
		(err) => err instanceof Error && err.message.includes(envVar) && err.message.includes("invalid"),
		`non-numeric string for ${envVar} must throw`,
	);

	// Zero
	assert.throws(
		() => loadFloorConfig({ [envVar]: "0" }),
		(err) => err instanceof Error && err.message.includes(envVar) && err.message.includes("invalid"),
		`zero for ${envVar} must throw`,
	);

	// Negative
	assert.throws(
		() => loadFloorConfig({ [envVar]: "-5" }),
		(err) => err instanceof Error && err.message.includes(envVar) && err.message.includes("invalid"),
		`negative value for ${envVar} must throw`,
	);

	// NaN / Infinity
	assert.throws(
		() => loadFloorConfig({ [envVar]: "NaN" }),
		(err) => err instanceof Error && err.message.includes(envVar),
	);
	assert.throws(
		() => loadFloorConfig({ [envVar]: "Infinity" }),
		(err) => err instanceof Error && err.message.includes(envVar),
	);
}

// 5. Resolution for Reviewer: no default floors
{
	const limits = resolveEffectiveLimits({ role: "reviewer" });
	assert.equal(limits.toolBudget, undefined);
	assert.equal(limits.tokens, undefined);
	assert.equal(limits.costUsd, undefined);
}

// 6. Resolution for Explorer & Validator: bounded floors by default
{
	const explorerLimits = resolveEffectiveLimits({ role: "explorer" });
	assert.deepEqual(explorerLimits.toolBudget, { value: 20, source: "floor" });
	assert.deepEqual(explorerLimits.tokens, { value: 40_000, source: "floor" });
	assert.deepEqual(explorerLimits.costUsd, { value: 0.10, source: "floor" });

	const validatorLimits = resolveEffectiveLimits({ role: "validator" });
	assert.deepEqual(validatorLimits.toolBudget, { value: 20, source: "floor" });
	assert.deepEqual(validatorLimits.tokens, { value: 40_000, source: "floor" });
	assert.deepEqual(validatorLimits.costUsd, { value: 0.10, source: "floor" });
}

// 7. Resolution for Worker initial: usage floor only, no default toolBudget
{
	const workerInitLimits = resolveEffectiveLimits({ role: "worker", reportsCount: 0 });
	assert.equal(workerInitLimits.toolBudget, undefined, "initial worker must have no default toolBudget");
	assert.deepEqual(workerInitLimits.tokens, { value: 100_000, source: "floor" });
	assert.deepEqual(workerInitLimits.costUsd, { value: 0.50, source: "floor" });

	// Worker without reportsCount specified defaults to initial worker
	const defaultWorkerLimits = resolveEffectiveLimits({ role: "worker" });
	assert.equal(defaultWorkerLimits.toolBudget, undefined);
	assert.deepEqual(defaultWorkerLimits.tokens, { value: 100_000, source: "floor" });
	assert.deepEqual(defaultWorkerLimits.costUsd, { value: 0.50, source: "floor" });
}

// 8. Resolution for Bounded Worker (reportsCount > 0: correction / report-correction)
{
	const boundedWorkerLimits = resolveEffectiveLimits({ role: "worker", reportsCount: 1 });
	assert.deepEqual(boundedWorkerLimits.toolBudget, { value: 20, source: "floor" });
	assert.deepEqual(boundedWorkerLimits.tokens, { value: 40_000, source: "floor" });
	assert.deepEqual(boundedWorkerLimits.costUsd, { value: 0.10, source: "floor" });
}

// 9. Stricter caller wins
{
	const limits = resolveEffectiveLimits({
		role: "worker",
		reportsCount: 1,
		callerToolBudget: { hard: 10 },
		callerUsageBudget: {
			tokens: { hard: 25_000 },
			costUsd: { hard: 0.05 },
		},
	});
	assert.deepEqual(limits.toolBudget, { value: 10, source: "caller" });
	assert.deepEqual(limits.tokens, { value: 25_000, source: "caller" });
	assert.deepEqual(limits.costUsd, { value: 0.05, source: "caller" });
}

// 10. Stricter TaskSpec wins
{
	const limits = resolveEffectiveLimits({
		role: "worker",
		reportsCount: 1,
		taskSpecBudget: {
			tokens: 20_000,
			costUsd: 0.04,
		},
	});
	assert.deepEqual(limits.toolBudget, { value: 20, source: "floor" });
	assert.deepEqual(limits.tokens, { value: 20_000, source: "taskSpec" });
	assert.deepEqual(limits.costUsd, { value: 0.04, source: "taskSpec" });
}

// 11. Looser caller or TaskSpec cannot raise the floor (floor wins)
{
	const limits = resolveEffectiveLimits({
		role: "worker",
		reportsCount: 1,
		callerToolBudget: { hard: 50 },
		callerUsageBudget: {
			tokens: { hard: 200_000 },
			costUsd: { hard: 1.0 },
		},
		taskSpecBudget: {
			tokens: 300_000,
			costUsd: 2.0,
		},
	});
	assert.deepEqual(limits.toolBudget, { value: 20, source: "floor" });
	assert.deepEqual(limits.tokens, { value: 40_000, source: "floor" });
	assert.deepEqual(limits.costUsd, { value: 0.10, source: "floor" });
}

// 12. Caller toolBudget on initial worker is retained without comparing to 20
{
	const limits = resolveEffectiveLimits({
		role: "worker",
		reportsCount: 0,
		callerToolBudget: { hard: 50 },
	});
	assert.deepEqual(limits.toolBudget, { value: 50, source: "caller" });
	assert.deepEqual(limits.tokens, { value: 100_000, source: "floor" });
	assert.deepEqual(limits.costUsd, { value: 0.50, source: "floor" });
}

// 13. Summary formatting
{
	const summary = formatFloorLimitsSummary({
		toolBudget: { value: 20, source: "floor" },
		tokens: { value: 40_000, source: "floor" },
		costUsd: { value: 0.10, source: "floor" },
	});
	assert.equal(summary, "toolBudget.hard=20 (floor), usageBudget.tokens.hard=40000 (floor), usageBudget.costUsd.hard=0.1 (floor)");
}

{
	const summary = formatFloorLimitsSummary({
		toolBudget: { value: 10, source: "caller" },
		tokens: { value: 25_000, source: "taskSpec" },
		costUsd: { value: 0.10, source: "floor" },
	});
	assert.equal(summary, "toolBudget.hard=10 (caller), usageBudget.tokens.hard=25000 (taskSpec), usageBudget.costUsd.hard=0.1 (floor)");
}

// Ticket 14A V1-V4 — cumulative balance can only lower usage limits.
{
	const common = {
		role: "worker",
		reportsCount: 1,
		callerToolBudget: { hard: 7 },
		callerUsageBudget: { tokens: { hard: 50_000 }, costUsd: { hard: 0.20 } },
		taskSpecBudget: { tokens: 45_000, costUsd: 0.18 },
	};
	const below = resolveEffectiveLimits({ ...common, balanceTokens: 1_000, balanceCostUsd: 0.01 });
	assert.deepEqual(below.tokens, { value: 1_000, source: "balance" });
	assert.deepEqual(below.costUsd, { value: 0.01, source: "balance" });
	assert.deepEqual(below.toolBudget, { value: 7, source: "caller" });

	const above = resolveEffectiveLimits({ ...common, balanceTokens: 500_000, balanceCostUsd: 2 });
	assert.deepEqual(above.tokens, { value: 40_000, source: "floor" });
	assert.deepEqual(above.costUsd, { value: 0.10, source: "floor" });
	assert.notEqual(above.tokens?.source, "balance");
	assert.notEqual(above.costUsd?.source, "balance");

	const reviewer = resolveEffectiveLimits({
		role: "reviewer",
		callerToolBudget: { hard: 7 },
		callerUsageBudget: { tokens: { hard: 50_000 }, costUsd: { hard: 0.20 } },
		balanceTokens: 1_000,
		balanceCostUsd: 0.01,
	});
	assert.deepEqual(reviewer.tokens, { value: 1_000, source: "balance" });
	assert.deepEqual(reviewer.costUsd, { value: 0.01, source: "balance" });
	assert.deepEqual(reviewer.toolBudget, { value: 7, source: "caller" });
}

// Ticket 14B/17 W1 — undeclared host enforcement is observation-only on both dimensions.
{
	const loaded = loadHostEnforcement({});
	assert.equal(loaded.tokens, false, "W1: default tokens is observation-only");
	assert.equal(loaded.costUsd, false, "W1: default costUsd is observation-only");
}

// Ticket 14B/17 W2 — declaring tokens enforcement must not flip costUsd.
{
	const loaded = loadHostEnforcement({ [HOST_ENFORCEMENT_ENV_VARS.TOKENS]: "1" });
	assert.equal(loaded.tokens, true, "W2: tokens declared enforced");
	assert.equal(loaded.costUsd, false, "W2: costUsd stays observation-only");
}

// Ticket 14B/17 W3 — an explicit "0" is off, not a truthy string.
{
	const loaded = loadHostEnforcement({
		[HOST_ENFORCEMENT_ENV_VARS.TOKENS]: "0",
		[HOST_ENFORCEMENT_ENV_VARS.COST_USD]: "0",
	});
	assert.equal(loaded.tokens, false, "W3: tokens \"0\" is off");
	assert.equal(loaded.costUsd, false, "W3: costUsd \"0\" is off");
}

// Ticket 14B/17 W4 — set-but-empty is fail-closed.
assert.throws(
	() => loadHostEnforcement({ [HOST_ENFORCEMENT_ENV_VARS.TOKENS]: "" }),
	(err) => err instanceof Error && err.message === "Host enforcement configuration error: PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS is set but empty; must be 1 or 0.",
	"W4: empty host-enforcement flag must throw the frozen empty-string message",
);

// Ticket 14B/17 W5 — any value other than 1/0 is fail-closed.
assert.throws(
	() => loadHostEnforcement({ [HOST_ENFORCEMENT_ENV_VARS.TOKENS]: "yes" }),
	(err) => err instanceof Error && err.message === 'Host enforcement configuration error: PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS="yes" is invalid; must be 1 or 0.',
	"W5: invalid host-enforcement flag must throw the frozen invalid-value message",
);

// Ticket 14B/17 W6 — the default declaration is frozen observation-only.
assert.equal(Object.isFrozen(DEFAULT_HOST_ENFORCEMENT), true, "W6: DEFAULT_HOST_ENFORCEMENT is frozen");
assert.equal(DEFAULT_HOST_ENFORCEMENT.tokens, false, "W6: DEFAULT_HOST_ENFORCEMENT.tokens is false");
assert.equal(DEFAULT_HOST_ENFORCEMENT.costUsd, false, "W6: DEFAULT_HOST_ENFORCEMENT.costUsd is false");

console.log("planner-only floors: PASS");
