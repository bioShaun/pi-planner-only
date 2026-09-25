import assert from "node:assert/strict";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { preflightEffectiveModel } from "./role-models.ts";

const registry = {
	getAvailable: () => [
		{ provider: "moon", id: "luna" },
		{ provider: "root", id: "kimi" },
	],
};
const pricing = { rates: { "moon/luna": {}, "root/kimi": {} } };
const spec = (taskId) => JSON.stringify({
	version: 1,
	taskId,
	objective: "RS-03 regression",
	cwd: "/repo",
	role: "worker",
	scope: { allowedPaths: [] },
	constraints: [],
	acceptanceCriteria: [],
	validation: { required: false },
	expectedEvidence: {},
	stopConditions: [],
});


// A12: model and thinking provenance is resolved independently, including
// model-only, thinking-only, ignored TaskSpec, and role-policy-shaped inputs.
{
	const modelOnly = preflightEffectiveModel({ input: { model: "moon/luna" }, hostThinking: "high", registry });
	assert.equal(modelOnly.effective?.modelSource, "explicit");
	assert.equal(modelOnly.effective?.thinkingSource, undefined);
	assert.equal(modelOnly.effective?.thinking, undefined);

	const thinkingOnly = preflightEffectiveModel({ input: { thinking: "low" }, hostModel: { provider: "moon", id: "luna" }, registry });
	assert.equal(thinkingOnly.effective?.modelSource, "host-default");
	assert.equal(thinkingOnly.effective?.thinkingSource, "explicit");
	assert.equal(thinkingOnly.effective?.thinking, "low");

	// Ticket 43: TaskSpec model/thinking never become effective sources.
	const taskSpec = preflightEffectiveModel({
		input: {},
		taskSpecModel: "moon/luna",
		taskSpecThinking: "medium",
		hostModel: { provider: "root", id: "kimi" },
		hostThinking: "high",
		registry,
	});
	assert.equal(taskSpec.effective?.modelSource, "host-default");
	assert.equal(taskSpec.effective?.thinkingSource, "host-default");
	assert.equal(taskSpec.effective?.model, "kimi");
	assert.equal(taskSpec.effective?.thinking, "high");
	assert.deepEqual(taskSpec.ignored, { source: "task-spec", model: "moon/luna", thinking: "medium" });

	const rolePolicy = preflightEffectiveModel({
		input: {},
		roleResolution: { role: "worker", model: "moon/luna", thinking: "low" },
		registry,
	});
	assert.equal(rolePolicy.effective?.modelSource, "role-policy");
	assert.equal(rolePolicy.effective?.thinkingSource, "role-policy");
}





console.log("rs03: PASS");
