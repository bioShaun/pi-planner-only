import assert from "node:assert/strict";
import { loadRoleModelPolicy, resolveRoleModel, roleModelPolicyEnabled, compareResolvedRoleModel } from "./role-models.ts";

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
console.log("role-models: PASS");
