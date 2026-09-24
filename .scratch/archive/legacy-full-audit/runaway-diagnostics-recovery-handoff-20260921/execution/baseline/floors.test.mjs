import assert from "node:assert/strict";
import {
	DEFAULT_HOST_ENFORCEMENT,
	DEFAULT_SESSION_ROOT_BUDGET_ENABLED,
	DEFAULT_SESSION_ROOT_MULTIPLIERS,
	SESSION_ROOT_BUDGET_ENV_VARS,
	evaluateSessionRootBudget,
	formatSessionRootBudgetRefusal,
	formatSessionRootBudgetSoftWarning,
	formatSessionRootBudgetStatus,
	HOST_ENFORCEMENT_ENV_VARS,
	loadHostEnforcement,
	loadSessionRootBudgetConfig,
	sessionRootBudgetWithEnabled,
} from "./floors.ts";

// WRC P0-B verdict: the per-delegation floor machinery (DEFAULT_FLOORS,
// resolveEffectiveLimits, exploration probe) was dead on the structured path
// and is deleted; per-execution bounds live on the explicit envelope param.
// What remains under test: host-enforcement declarations + session root budget.

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

// Ticket 40 — session root budget derived from workerInitial × multipliers; gate off by default

assert.equal(DEFAULT_SESSION_ROOT_BUDGET_ENABLED, false);
assert.equal(DEFAULT_SESSION_ROOT_MULTIPLIERS.soft, 3);
assert.equal(DEFAULT_SESSION_ROOT_MULTIPLIERS.hard, 5);

const enabledSessionRootEnv = { [SESSION_ROOT_BUDGET_ENV_VARS.ENABLED]: "1" };

{
	const config = loadSessionRootBudgetConfig({});
	assert.equal(config.enabled, false, "session root budget is off unless opted in");
}

{
	const config = loadSessionRootBudgetConfig(enabledSessionRootEnv);
	assert.equal(config.enabled, true);
	assert.equal(config.softMultiplier, 3);
	assert.equal(config.hardMultiplier, 5);
	assert.equal(config.baseCostUsd, 0.50);
	assert.equal(config.baseTokens, 100_000);
	assert.equal(config.softCostUsd, 0.50 * 3);
	assert.equal(config.hardCostUsd, 0.50 * 5);
	assert.equal(config.softTokens, 100_000 * 3);
	assert.equal(config.hardTokens, 100_000 * 5);
}

{
	const config = loadSessionRootBudgetConfig({
		...enabledSessionRootEnv,
		[SESSION_ROOT_BUDGET_ENV_VARS.SOFT_MULTIPLIER]: "2",
		[SESSION_ROOT_BUDGET_ENV_VARS.HARD_MULTIPLIER]: "4",
		PI_PLANNER_ONLY_FLOOR_WORKER_COST_USD_HARD: "0.40",
		PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD: "80000",
	});
	assert.equal(config.softCostUsd, 0.80);
	assert.equal(config.hardCostUsd, 1.60);
	assert.equal(config.softTokens, 160_000);
	assert.equal(config.hardTokens, 320_000);
}

{
	assert.throws(
		() => loadSessionRootBudgetConfig({
			...enabledSessionRootEnv,
			[SESSION_ROOT_BUDGET_ENV_VARS.SOFT_MULTIPLIER]: "5",
			[SESSION_ROOT_BUDGET_ENV_VARS.HARD_MULTIPLIER]: "3",
		}),
		/hard multiplier .* must be >= soft/,
	);
}

{
	assert.throws(
		() => loadSessionRootBudgetConfig({ [SESSION_ROOT_BUDGET_ENV_VARS.ENABLED]: "yes" }),
		/PI_PLANNER_ONLY_SESSION_ROOT_BUDGET.*must be 1 or 0/,
	);
}

{
	const offConfig = loadSessionRootBudgetConfig({});
	const hardSpend = {
		turns: 20, tokens: offConfig.hardTokens, costUsd: offConfig.hardCostUsd, costUnknown: false,
		currency: "USD",
		untaskedTurns: 20, untaskedTokens: offConfig.hardTokens, untaskedCostUsd: offConfig.hardCostUsd,
	};
	const off = evaluateSessionRootBudget(hardSpend, offConfig);
	assert.equal(off.level, "ok", "disabled gate never trips, even above the derived hard cap");
	assert.match(formatSessionRootBudgetStatus(off), /会话 root 预算未开启/);
	assert.match(formatSessionRootBudgetStatus(off), /\/planner-only budget on/);
	assert.doesNotMatch(formatSessionRootBudgetStatus(off), /会话 root 预算已停止/);
	assert.equal(sessionRootBudgetWithEnabled(offConfig, false), offConfig);
	assert.equal(sessionRootBudgetWithEnabled(offConfig, true).enabled, true);
}

{
	const config = loadSessionRootBudgetConfig(enabledSessionRootEnv);
	const ok = evaluateSessionRootBudget({
		turns: 1, tokens: 100, costUsd: 0.01, costUnknown: false,
		currency: "USD",
		untaskedTurns: 1, untaskedTokens: 100, untaskedCostUsd: 0.01,
	}, config);
	assert.equal(ok.level, "ok");

	const soft = evaluateSessionRootBudget({
		turns: 10, tokens: config.softTokens, costUsd: config.softCostUsd, costUnknown: false,
		currency: "USD",
		untaskedTurns: 10, untaskedTokens: config.softTokens, untaskedCostUsd: config.softCostUsd,
	}, config);
	assert.equal(soft.level, "soft");
	assert.equal(soft.dimension, "costUsd");
	assert.match(formatSessionRootBudgetSoftWarning(soft), /软顶警告/);
	assert.match(formatSessionRootBudgetStatus(soft), /会话 root 预算软顶警告/);

	const hard = evaluateSessionRootBudget({
		turns: 20, tokens: config.hardTokens, costUsd: config.hardCostUsd, costUnknown: false,
		currency: "USD",
		untaskedTurns: 20, untaskedTokens: config.hardTokens, untaskedCostUsd: config.hardCostUsd,
	}, config);
	assert.equal(hard.level, "hard");
	assert.match(formatSessionRootBudgetRefusal(hard), /session root budget exhausted/);
	assert.match(formatSessionRootBudgetRefusal(hard), /不会被掐断/);
	assert.match(formatSessionRootBudgetStatus(hard), /会话 root 预算已停止/);
}

{
	// Unknown cost skips the cost dimension; tokens alone can still trip hard.
	const config = loadSessionRootBudgetConfig(enabledSessionRootEnv);
	const unknownSoftTokens = evaluateSessionRootBudget({
		turns: 2, tokens: config.softTokens, costUsd: undefined, costUnknown: true, currency: "USD",
		untaskedTurns: 2, untaskedTokens: config.softTokens, untaskedCostUsd: undefined,
	}, config);
	assert.equal(unknownSoftTokens.level, "soft");
	assert.equal(unknownSoftTokens.dimension, "tokens");
}

{
	// CNY pricing table: cost is not comparable against USD caps, so only tokens gate.
	const config = loadSessionRootBudgetConfig(enabledSessionRootEnv);
	const cnySoftCost = evaluateSessionRootBudget({
		turns: 3, tokens: 100, costUsd: config.softCostUsd * 100, costUnknown: false, currency: "CNY",
		untaskedTurns: 3, untaskedTokens: 100, untaskedCostUsd: config.softCostUsd * 100,
	}, config);
	assert.equal(cnySoftCost.level, "ok", "40-cny-a: CNY cost above USD soft cap does not trip soft");
	const cnyHardCost = evaluateSessionRootBudget({
		turns: 3, tokens: 100, costUsd: config.hardCostUsd * 100, costUnknown: false, currency: "CNY",
		untaskedTurns: 3, untaskedTokens: 100, untaskedCostUsd: config.hardCostUsd * 100,
	}, config);
	assert.equal(cnyHardCost.level, "ok", "40-cny-b: CNY cost above USD hard cap does not trip hard");
	const cnyTokensHard = evaluateSessionRootBudget({
		turns: 3, tokens: config.hardTokens, costUsd: 0.01, costUnknown: false, currency: "CNY",
		untaskedTurns: 3, untaskedTokens: config.hardTokens, untaskedCostUsd: 0.01,
	}, config);
	assert.equal(cnyTokensHard.level, "hard", "40-cny-c: tokens still gate under CNY");
	assert.equal(cnyTokensHard.dimension, "tokens");
	const status = formatSessionRootBudgetStatus(cnyTokensHard);
	assert.match(status, /¥0\.0100/, "40-cny-d: status renders CNY symbol for spend");
	assert.match(status, /费率表币种为 CNY/, "40-cny-e: status discloses cost dimension not gated");
	assert.doesNotMatch(status.split("\n")[0], /\$/, "40-cny-f: spend line has no dollar sign");
	assert.match(formatSessionRootBudgetRefusal(cnyTokensHard), /¥0\.0100/, "40-cny-g: refusal renders CNY symbol");
}

console.log("planner-only floors: PASS");
