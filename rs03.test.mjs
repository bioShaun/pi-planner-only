import assert from "node:assert/strict";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { preflightEffectiveModel } from "./role-models.ts";
import { applyRoleDelegation, stripDelegationKeys } from "./roles.ts";

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

// A11: the child default is selected from the host override, not Root's model;
// neither omitted field is synthesized into the host payload.
{
	const input = { agent: "worker", task: spec("T-20260912-111") };
	const original = structuredClone(input);
	const orch = new PlannerOrchestrator({
		gitRunner: async () => ({ stdout: "", stderr: "", code: 0 }),
		getModelPreflightContext: () => ({
			hostModel: { provider: "root", id: "kimi" },
			agentOverrides: { worker: { provider: "moon", id: "luna" } },
			registry,
			pricing,
		}),
	});
	await orch.beginDelegation({ toolCallId: "rs03-a11", input }, "/repo");
	assert.equal(input.model, undefined);
	assert.equal(input.thinking, undefined);
	assert.deepEqual(original, { agent: "worker", task: spec("T-20260912-111") });
}

// A12: model and thinking provenance is resolved independently, including
// model-only, thinking-only, TaskSpec, and role-policy-shaped inputs.
{
	const modelOnly = preflightEffectiveModel({ input: { model: "moon/luna" }, hostThinking: "high", registry });
	assert.equal(modelOnly.effective?.modelSource, "explicit");
	assert.equal(modelOnly.effective?.thinkingSource, undefined);
	assert.equal(modelOnly.effective?.thinking, undefined);

	const thinkingOnly = preflightEffectiveModel({ input: { thinking: "low" }, hostModel: { provider: "moon", id: "luna" }, registry });
	assert.equal(thinkingOnly.effective?.modelSource, "host-default");
	assert.equal(thinkingOnly.effective?.thinkingSource, "explicit");
	assert.equal(thinkingOnly.effective?.thinking, "low");

	const taskSpec = preflightEffectiveModel({ input: {}, taskSpecModel: "moon/luna", taskSpecThinking: "medium", registry });
	assert.equal(taskSpec.effective?.modelSource, "task-spec");
	assert.equal(taskSpec.effective?.thinkingSource, "task-spec");

	const rolePolicy = preflightEffectiveModel({
		input: {},
		roleResolution: { role: "worker", model: "moon/luna", thinking: "low" },
		registry,
	});
	assert.equal(rolePolicy.effective?.modelSource, "role-policy");
	assert.equal(rolePolicy.effective?.thinkingSource, "role-policy");
}

// A13: unavailable registry state is a warning/continue condition; only a
// provably absent explicit model in an active registry is blocked.
{
	assert.equal(preflightEffectiveModel({
		input: { agent: "worker" },
		hostModel: { provider: "root", id: "missing-root" },
		agentOverrides: { worker: { provider: "moon", id: "luna" } },
		registry,
	}).status, "verified");
	assert.equal(preflightEffectiveModel({ input: { model: "moon/luna" }, registry: undefined }).status, "unverified");
	assert.equal(preflightEffectiveModel({ input: { model: "moon/luna" }, registry: { getAvailable: () => { throw new Error("unreadable"); } } }).status, "unverified");

	const unavailableOrch = new PlannerOrchestrator({
		gitRunner: async () => ({ stdout: "", stderr: "", code: 0 }),
		getModelPreflightContext: () => ({ registry: { getAvailable: () => { throw new Error("unreadable"); } } }),
	});
	const unavailable = await unavailableOrch.beginDelegation({
		toolCallId: "rs03-a13-unverified",
		input: { agent: "worker", task: spec("T-20260912-114") },
	}, "/repo");
	assert.equal(unavailable.block, undefined);
	assert.ok((unavailable.warnings ?? []).some((warning) => warning.includes("unverified") && warning.includes("continuing launch")));

	const invalid = preflightEffectiveModel({ input: { model: "moon/no-such-model" }, registry });
	assert.equal(invalid.status, "blocked");
	const orch = new PlannerOrchestrator({
		gitRunner: async () => ({ stdout: "", stderr: "", code: 0 }),
		getModelPreflightContext: () => ({ registry }),
	});
	const blockedInput = { agent: "worker", model: "moon/no-such-model", task: spec("T-20260912-113") };
	const blocked = await orch.beginDelegation({ toolCallId: "rs03-a13", input: blockedInput }, "/repo");
	assert.equal(blocked.block?.code, "MODEL_UNAVAILABLE");
	assert.equal(orch.store.get("T-20260912-113"), undefined);
	assert.equal(orch.pendingDelegationCount(), 0);
	assert.equal(orch.getConcurrencyStatus().occupied, 0);
	assert.deepEqual(orch.reservations.inFlight("T-20260912-113"), { tokens: 0, costUsd: 0 });
	assert.equal(orch.reservations.heldCount("T-20260912-113"), 0);
}

// A14: transforms preserve valid host budget fields and do not mutate a
// caller's nested budget objects while diagnostics are stripped before launch.
{
	const input = {
		agent: "worker",
		task: "plain task",
		usageBudget: { tokens: { soft: 100, hard: 500 }, custom: "preserve" },
		extraPayload: { keep: true },
	};
	const originalBudget = structuredClone(input.usageBudget);
	applyRoleDelegation(input, {
		role: "worker",
		budget: { tokens: 1000 },
	});
	assert.equal(input.usageBudget.tokens.soft, 100);
	assert.equal(input.usageBudget.custom, "preserve");
	assert.deepEqual(originalBudget, { tokens: { soft: 100, hard: 500 }, custom: "preserve" });
	assert.equal(input.__floorLimits !== undefined, true);
	input.__delegationRole = "worker";
	input.__oracleSuiteConflict = true;
	input.__reuseOutcome = { reused: true };
	input.__contextOverridden = true;
	input.reuseTaskId = "T-20260912-115";
	input.reuseContext = "diagnostic";
	input.reuseRootHistory = ["history"];
	input.reuse = true;
	const preservedPayload = {
		agent: input.agent,
		task: input.task,
		usageBudget: structuredClone(input.usageBudget),
		extraPayload: structuredClone(input.extraPayload),
		context: input.context,
	};
	stripDelegationKeys(input);
	assert.deepEqual(input, preservedPayload);
	for (const key of ["__delegationRole", "__floorLimits", "__oracleSuiteConflict", "__reuseOutcome", "__contextOverridden", "reuseTaskId", "reuseContext", "reuseRootHistory", "reuse"]) {
		assert.equal(key in input, false, `${key} must be stripped`);
	}
}

console.log("rs03: PASS");
