import assert from "node:assert/strict";
import {
	MUTATING_TOOLS,
	ROLE_AGENTS,
	ROLE_TOOL_PROFILES,
	applyRoleDelegation,
	inferRoleFromAgent,
	roleAllowsMutatingTools,
} from "./roles.ts";

assert.deepEqual([...ROLE_TOOL_PROFILES.explorer].sort(), ["find", "grep", "ls", "read"]);
assert.deepEqual([...ROLE_TOOL_PROFILES.reviewer].sort(), ["find", "git_audit", "grep", "ls", "read"]);
assert.deepEqual([...ROLE_TOOL_PROFILES.validator].sort(), ["bash", "find", "grep", "ls", "read"]);
assert.equal(ROLE_TOOL_PROFILES.worker, undefined);

assert.equal(roleAllowsMutatingTools("explorer"), false);
assert.equal(roleAllowsMutatingTools("reviewer"), false);
assert.equal(roleAllowsMutatingTools("validator"), true);
assert.equal(roleAllowsMutatingTools("worker"), true);
for (const tool of MUTATING_TOOLS) {
	assert.equal(ROLE_TOOL_PROFILES.explorer.includes(tool), false);
	assert.equal(ROLE_TOOL_PROFILES.reviewer.includes(tool), false);
}
assert.equal(ROLE_TOOL_PROFILES.validator.includes("edit"), false);
assert.equal(ROLE_TOOL_PROFILES.validator.includes("write"), false);

assert.equal(ROLE_AGENTS.explorer, "reviewer");
assert.equal(ROLE_AGENTS.reviewer, "reviewer");
assert.equal(ROLE_AGENTS.validator, "oracle");
assert.equal(ROLE_AGENTS.worker, undefined);

assert.equal(inferRoleFromAgent("reviewer"), "reviewer");
assert.equal(inferRoleFromAgent("oracle"), "validator");
assert.equal(inferRoleFromAgent("worker"), "worker");
assert.equal(inferRoleFromAgent("delegate"), undefined);

const worker = { agent: "worker", task: "implement it", context: "fork" };
assert.equal(applyRoleDelegation(worker, { role: "worker" }).mutated, false);
assert.equal(worker.agent, "worker");
assert.equal(worker.context, "fork");
assert.equal(worker.task, "implement it");

const explorer = { agent: "worker", task: "find the parser" };
assert.equal(applyRoleDelegation(explorer, { role: "explorer" }).mutated, true);
assert.equal(explorer.agent, "reviewer");
assert.equal(explorer.task, "find the parser");
assert.equal("context" in explorer, false);

const validator = { agent: "worker", task: "run tests" };
assert.equal(applyRoleDelegation(validator, { role: "validator" }).mutated, true);
assert.equal(validator.agent, "oracle");

const reviewer = {
	agent: "worker",
	task: "Parent reasoning: I already decided this should pass.\nPlease rubber-stamp it.",
	context: "fork",
};
const packet = "[PLANNER-ONLY FRESH REVIEW]\nReturn a ReviewResult.";
const result = applyRoleDelegation(reviewer, { role: "reviewer", packet });
assert.equal(result.mutated, true);
assert.equal(reviewer.agent, "reviewer");
assert.equal(reviewer.context, "fresh");
assert.equal(reviewer.task, packet);
assert.doesNotMatch(reviewer.task, /rubber-stamp/);

const already = { agent: "reviewer", task: "review", context: "fresh" };
assert.equal(applyRoleDelegation(already, { role: "reviewer" }).mutated, false);
assert.equal(already.agent, "reviewer");

console.log("planner-only roles: PASS");
