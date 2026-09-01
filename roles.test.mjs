import assert from "node:assert/strict";
import {
	MUTATING_TOOLS,
	ROLE_AGENTS,
	ROLE_TOOL_PROFILES,
	applyRoleDelegation,
	inferRoleFromAgent,
	prepareRoleDelegation,
	resolveDelegationTarget,
	roleAllowsMutatingTools,
} from "./roles.ts";
import { reviewerPrompt } from "./review.ts";

assert.deepEqual([...ROLE_TOOL_PROFILES.explorer].sort(), ["find", "grep", "ls", "read"]);
// Reviewer children launch with --no-extensions, so git_audit does not exist
// there. Root passes a bounded Git evidence packet instead.
assert.deepEqual([...ROLE_TOOL_PROFILES.reviewer].sort(), ["find", "grep", "ls", "read"]);
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

const reviewerSpec = {
	taskId: "T-20260831-009",
	objective: "review the parser",
	cwd: "/repo",
	role: "reviewer",
	scope: {},
	constraints: [],
	acceptanceCriteria: [],
	validation: { required: false },
	expectedEvidence: {},
	stopConditions: [],
};

{
	const payload = { agent: "worker", task: JSON.stringify(reviewerSpec) };
	prepareRoleDelegation(payload, () => undefined);
	assert.equal(payload.agent, "reviewer");
	assert.equal(payload.context, "fresh");
	assert.match(String(payload.task), /PLANNER-ONLY FRESH REVIEW/);
}

// A reviewer packet names the Task and carries Root's Git evidence
{
	const originalSpec = {
		...reviewerSpec,
		role: "worker",
		objective: "implement the parser",
		acceptanceCriteria: ["empty input returns []"],
	};
	const existing = {
		taskId: "T-20260831-009",
		spec: originalSpec,
		reports: [],
		reviews: [],
		overrides: [],
	};
	const payload = { agent: "reviewer", task: JSON.stringify(reviewerSpec) };
	prepareRoleDelegation(payload, () => existing, {
		git: { gitAvailable: true, head: "abc1234", diffCheck: "no whitespace errors" },
		evidence: "fresh",
	});
	assert.match(payload.task, /"reviewMode": "fresh"/);
	assert.match(payload.task, /"reportTaskId": "T-20260831-009"/);
	assert.match(payload.task, /"evidenceSummary": "fresh"/);
	assert.match(payload.task, /"gitAvailable": true/);
	// the packet shows the Task's original spec, never a reviewer spec
	assert.match(payload.task, /implement the parser/);
	assert.doesNotMatch(payload.task, /"role": "reviewer"/);
}

// The reviewer prompt no longer advertises tools the child cannot have
assert.doesNotMatch(reviewerPrompt("T-20260831-009"), /git_audit/);
assert.match(reviewerPrompt("T-20260831-009"), /Git evidence is supplied by Root/);

// Delegation targets: a ReviewRequest outranks an embedded TaskSpec
{
	const specPayload = {
		agent: "worker",
		task: JSON.stringify({ ...reviewerSpec, role: "worker", objective: "implement" }),
	};
	assert.equal(resolveDelegationTarget(specPayload, () => undefined).role, "worker");

	const request = {
		version: 1,
		taskId: "T-20260831-009",
		reportTaskId: "T-20260831-009",
		reviewMode: "fresh",
		taskSpec: { ...reviewerSpec, role: "worker" },
	};
	const packetPayload = { agent: "reviewer", task: `"reviewMode":"fresh"\n${JSON.stringify(request)}` };
	const target = resolveDelegationTarget(packetPayload, (taskId) => ({ taskId, spec: reviewerSpec }));
	assert.equal(target.role, "reviewer");
	assert.equal(target.taskId, "T-20260831-009");
}

console.log("planner-only roles: PASS");
