import assert from "node:assert/strict";
import {
	loadRoleModelPolicy,
	resolveRoleModel,
	roleModelPolicyEnabled,
	compareResolvedRoleModel,
	preflightEffectiveModel,
} from "./role-models.ts";

const env = {
	PI_PLANNER_ONLY_ROLE_MODELS: " true ",
	PI_PLANNER_ONLY_MODEL_WORKER: "policy-test/worker",
	PI_PLANNER_ONLY_THINKING_WORKER: "medium",
};
assert.equal(roleModelPolicyEnabled(env), true);
const policy = loadRoleModelPolicy(env);
const input = {};
assert.deepEqual(resolveRoleModel(policy, "WORKER", input), {
	role: "worker", model: "policy-test/worker", thinking: "medium",
});
const resolved = { role: "worker", model: "policy-test/worker", thinking: "medium" };
assert.deepEqual(compareResolvedRoleModel(resolved, {}), {
	actualModel: "未知", actualThinking: "未知", unknownModel: true, unknownThinking: true, mismatch: false,
});
assert.equal(compareResolvedRoleModel(resolved, { model: " policy-test/worker ", thinking: " medium " }).mismatch, false);
assert.equal(compareResolvedRoleModel(resolved, { model: "policy-test/worker" }).mismatch, false);
assert.equal(compareResolvedRoleModel(resolved, { thinking: "medium" }).mismatch, false);
assert.equal(compareResolvedRoleModel(resolved, { model: "policy-test/worker" }).actualThinking, "未知");
assert.equal(compareResolvedRoleModel(resolved, { thinking: "medium" }).actualModel, "未知");
assert.equal(compareResolvedRoleModel(resolved, { model: "policy-test/worker" }).unknownThinking, true);
assert.equal(compareResolvedRoleModel(resolved, { thinking: "medium" }).unknownModel, true);
assert.equal(compareResolvedRoleModel(resolved, { model: "other/model", thinking: "medium" }).mismatch, true);
assert.equal(compareResolvedRoleModel(resolved, { model: "policy-test/worker", thinking: "high" }).mismatch, true);

assert.deepEqual(input, { model: "policy-test/worker", thinking: "medium" });
assert.throws(() => resolveRoleModel(policy, "reviewer", {}), /reviewer is missing model and thinking/);
assert.throws(() => resolveRoleModel(loadRoleModelPolicy({
	PI_PLANNER_ONLY_ROLE_MODELS: "1",
	PI_PLANNER_ONLY_MODEL_WORKER: " policy-test/worker ",
	PI_PLANNER_ONLY_THINKING_WORKER: "medium level",
}), "worker", {}), /cannot resolve worker thinking medium level/);
assert.throws(() => resolveRoleModel(policy, "worker", { model: "caller/model" }), /conflict for worker: caller=caller\/model policy=policy-test\/worker/);
assert.deepEqual(resolveRoleModel(loadRoleModelPolicy({}), "worker", {}), undefined);

// RR-07 C20/C21: final model attribution and registry verification happen
// against the model that would actually launch, with bounded diagnostics.
{
	const registry = {
		getAvailable: () => [
			{ provider: "openai", id: "gpt-5.6-luna" },
			{ provider: "anthropic", id: "claude-sonnet" },
			{ provider: "unused", id: "third-model" },
		],
		getError: () => undefined,
	};
	const pricing = {
		currency: "USD",
		rates: {
			"openai/gpt-5.6-luna": { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
			"anthropic/claude-sonnet": { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
		},
	};
	assert.deepEqual(
		preflightEffectiveModel({ input: { model: "openai/gpt-5.6-luna", thinking: "high" }, registry, pricing }),
		{
			status: "verified",
			effective: { provider: "openai", model: "gpt-5.6-luna", thinking: "high", source: "explicit" },
		},
	);
	assert.equal(
		preflightEffectiveModel({ input: { model: "missing/model", thinking: "low" }, registry, pricing }).error?.code,
		"MODEL_UNAVAILABLE",
	);
	const unknown = preflightEffectiveModel({ input: { model: "missing/model", thinking: "low" }, registry, pricing });
	assert.equal(unknown.error?.source, "explicit");
	assert.ok((unknown.error?.candidates ?? []).length <= 5);
	assert.deepEqual(
		preflightEffectiveModel({ input: {}, hostModel: { provider: "openai", id: "gpt-5.6-luna" }, hostThinking: "medium", registry, pricing }).effective,
		{ provider: "openai", model: "gpt-5.6-luna", thinking: "medium", source: "host-default" },
	);
	assert.equal(
		preflightEffectiveModel({ input: {}, roleResolution: { role: "worker", model: "openai/gpt-5.6-luna", thinking: "medium" }, registry, pricing }).effective?.source,
		"role-policy",
	);
	assert.equal(
		preflightEffectiveModel({ input: {}, taskSpecModel: "anthropic/claude-sonnet", hostThinking: "low", registry, pricing }).effective?.source,
		"task-spec",
	);
	const unavailable = preflightEffectiveModel({ input: { model: "openai/gpt-5.6-luna" }, registry: { getAvailable: () => { throw new Error("registry unreadable"); } }, pricing });
	assert.equal(unavailable.status, "unverified");
	assert.equal(unavailable.error?.code, "MODEL_UNAVAILABLE");
}

{
	const policy = {
		enabled: true,
		roles: {
			worker: {
			model: "missing/primary",
			thinking: "medium",
			fallbacks: [{ model: "openai/gpt-5.6-luna", thinking: "low" }],
		},
		},
	};
	const result = preflightEffectiveModel({
		input: { model: "missing/primary", thinking: "medium" },
		roleResolution: { role: "worker", model: "missing/primary", thinking: "medium" },
		rolePolicy: policy,
		registry: { getAvailable: () => [{ provider: "openai", id: "gpt-5.6-luna" }] },
	});
	assert.equal(result.status, "verified");
	assert.equal(result.effective?.model, "gpt-5.6-luna");
	assert.equal(result.effective?.source, "role-policy-fallback");
	assert.equal(preflightEffectiveModel({ input: { model: "missing/primary", thinking: "medium" }, roleResolution: { role: "worker", model: "missing/primary", thinking: "medium" }, registry: { getAvailable: () => [{ provider: "openai", id: "other" }] } }).status, "blocked");
}
console.log("role-models: PASS");
