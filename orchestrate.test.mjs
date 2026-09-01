import assert from "node:assert/strict";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { hashStatus } from "./evidence.ts";

// --------------------------------------------------------------------------
// Fixture: a GitRunner seam whose responses tests can override mid-flight, so
// an "external edit" can happen between a worker report and a Root verdict.
// --------------------------------------------------------------------------

const BASE = "/repo";
const cleanStatus = [
	"1 .M N... 100644 100644 100644 1111111 2222222 src/parser.ts",
	"",
].join("\n");
const cleanHash = hashStatus(cleanStatus);

const gitDefaults = new Map([
	["rev-parse --git-dir", ".git\n"],
	["rev-parse HEAD", "abc1234\n"],
	["status --porcelain=v2 --branch", cleanStatus],
	["diff HEAD --stat", " src/parser.ts | 2 +-\n"],
]);
const gitOverrides = new Map();
const gitRunner = async (args) => {
	const key = args.join(" ");
	const stdout = gitOverrides.has(key) ? gitOverrides.get(key) : gitDefaults.get(key) ?? "";
	return { stdout, stderr: "", code: 0 };
};

function specFor(taskId, role = "worker", cwd = `/fixture/${taskId}`) {
	return {
		taskId,
		objective: `implement ${taskId}`,
		cwd,
		role,
		scope: { allowedPaths: ["src/parser.ts"] },
		constraints: ["no new deps"],
		acceptanceCriteria: ["tests pass"],
		validation: { required: true, commands: ["npm test"] },
		expectedEvidence: { changedFiles: true, tests: true },
		stopConditions: ["ask if ambiguous"],
	};
}

function reportFor(taskId, toolCallId) {
	return {
		version: 1,
		taskId,
		status: "completed",
		summary: "Implemented the change.",
		changedFiles: ["src/parser.ts"],
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "1 passed" }],
		evidence: {
			cwd: `/fixture/${taskId}`,
			taskId,
			workerRunId: toolCallId,
			baseGitRef: "abc1234",
			finalGitRef: "abc1234",
			gitStatusHash: cleanHash,
			changedPaths: ["src/parser.ts"],
			gitAvailable: true,
			generatedAt: "2026-09-01T10:00:00.000Z",
		},
		risks: [],
		unresolved: [],
	};
}

function workerResult(toolCallId, report, wrapped = false) {
	const text = wrapped
		? `Working on it...\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\nDone.`
		: JSON.stringify(report);
	return { toolCallId, toolName: "subagent", input: {}, content: [{ type: "text", text }], isError: false };
}

function reviewerResult(toolCallId, taskId, verdict = "pass") {
	return {
		toolCallId,
		toolName: "subagent",
		input: {},
		content: [{
			type: "text",
			text: JSON.stringify({ taskId, verdict, summary: `${verdict} from reviewer`, evidenceFresh: true, findings: [] }),
		}],
		isError: false,
	};
}

async function delegateWorker(orch, toolCallId, taskId) {
	return orch.beginDelegation(
		{ toolCallId, input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
}

// --------------------------------------------------------------------------
// §P1-3 — structured delegation modes
// --------------------------------------------------------------------------

// strict mode blocks a worker delegation that carries no TaskSpec
{
	const orch = new PlannerOrchestrator({ gitRunner, structuredDelegationMode: "strict" });
	const blocked = await orch.beginDelegation(
		{ toolCallId: "call-s1", input: { agent: "worker", task: "just do it, no spec attached" } },
		BASE,
	);
	assert.ok(blocked.block, "strict mode must block a spec-less worker delegation");
	assert.match(blocked.block.reason, /without an embedded TaskSpec/);
	assert.match(blocked.block.reason, /PI_PLANNER_ONLY_STRUCTURED_DELEGATION=warn/);
	assert.equal(orch.store.list().length, 0, "no task may be created for a blocked delegation");

	// strict mode still accepts a structured worker delegation
	const ok = await orch.beginDelegation(
		{ toolCallId: "call-s2", input: { task: JSON.stringify(specFor("T-20260901-710")) } },
		BASE,
	);
	assert.equal(ok.block, undefined);
	assert.equal(ok.task.taskId, "T-20260901-710");

	// validators are warned, not blocked, even in strict mode
	const validator = await orch.beginDelegation(
		{ toolCallId: "call-s3", input: { agent: "oracle", task: "double-check the claim" } },
		BASE,
	);
	assert.equal(validator.block, undefined);
	assert.ok((validator.warnings ?? []).some((warning) => /without an embedded TaskSpec/.test(warning)));
}

// warn mode (the default) lets a spec-less worker through with a warning
{
	const orch = new PlannerOrchestrator({ gitRunner, structuredDelegationMode: "warn" });
	const outcome = await orch.beginDelegation(
		{ toolCallId: "call-w1", input: { agent: "worker", task: "no spec here either" } },
		BASE,
	);
	assert.equal(outcome.block, undefined);
	assert.ok((outcome.warnings ?? []).some((warning) => /role worker delegated without an embedded TaskSpec/.test(warning)));
	assert.ok(outcome.task);

	// the default constructor reads the environment override
	process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION = "strict";
	try {
		const fromEnv = new PlannerOrchestrator({ gitRunner });
		assert.equal(fromEnv.structuredDelegationMode, "strict");
	} finally {
		delete process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION;
	}
	const defaults = new PlannerOrchestrator({ gitRunner });
	assert.equal(defaults.structuredDelegationMode, "warn");
}

// --------------------------------------------------------------------------
// §P1-1 — a reviewer invocation never mutates the Task's original TaskSpec
// --------------------------------------------------------------------------

{
	const orch = new PlannerOrchestrator({ gitRunner });
	const original = specFor("T-20260901-500");
	const delegated = await orch.beginDelegation(
		{ toolCallId: "call-500", input: { task: JSON.stringify(original) } },
		BASE,
	);
	assert.equal(delegated.task.taskId, "T-20260901-500");

	const workerOutcome = await orch.handleSubagentResult(workerResult("call-500", reportFor("T-20260901-500", "call-500")));
	assert.match(workerOutcome.content[0].text, /decision: review_pending/);

	// review via a reviewer TaskSpec payload and via a ReviewRequest packet
	const specCall = await orch.beginDelegation(
		{ toolCallId: "call-501", input: { agent: "reviewer", task: JSON.stringify(specFor("T-20260901-500", "reviewer")) } },
		BASE,
	);
	assert.equal(specCall.task.taskId, "T-20260901-500");
	const specReview = await orch.handleSubagentResult(reviewerResult("call-501", "T-20260901-500", "request_changes"));
	assert.match(specReview.content[0].text, /decision: request_changes/);

	const packetCall = await orch.beginDelegation(
		{ toolCallId: "call-502", input: { agent: "reviewer", task: JSON.stringify({
			version: 1,
			taskId: "T-20260901-500",
			reportTaskId: "T-20260901-500",
			reviewMode: "fresh",
			workerReport: reportFor("T-20260901-500", "call-500"),
		}) } },
		BASE,
	);
	assert.equal(packetCall.task.taskId, "T-20260901-500");
	await orch.handleSubagentResult(reviewerResult("call-502", "T-20260901-500", "pass"));

	const task = orch.store.require("T-20260901-500");
	assert.equal(task.role, "worker");
	assert.equal(task.spec.role, "worker");
	assert.equal(task.spec.objective, original.objective);
	assert.equal(task.spec.taskId, "T-20260901-500");
}

// --------------------------------------------------------------------------
// §P0-1 — a structurally valid report for the wrong task is not a report
// --------------------------------------------------------------------------

{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-600", "T-20260901-600");
	const foreign = { ...reportFor("T-20260901-600", "call-600"), taskId: "T-20260901-999" };
	foreign.evidence = { ...foreign.evidence, taskId: "T-20260901-999" };
	const outcome = await orch.handleSubagentResult(workerResult("call-600", foreign));
	assert.match(outcome.content[0].text, /failed the task identity check/);
	assert.match(outcome.content[0].text, /report-only correction/);
	assert.equal(orch.store.require("T-20260901-600").reports.length, 0, "the foreign report must not be stored");
}

// --------------------------------------------------------------------------
// §P0-3 — no stale evidence crosses the PASS boundary
// --------------------------------------------------------------------------

// No race: a PASS right after a fresh report completes the task.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-610", "T-20260901-610");
	await orch.handleSubagentResult(workerResult("call-610", reportFor("T-20260901-610", "call-610")));
	assert.equal(orch.store.require("T-20260901-610").state, "reviewing");

	const outcome = await orch.recordRootVerdict(orch.store.require("T-20260901-610"), "pass", "verified locally");
	assert.equal(outcome.decision.action, "accept");
	assert.equal(outcome.task.state, "completed");
	assert.match(outcome.evidence, /^fresh/);
}

// Race: an external edit lands between the report and the Root PASS, so the
// PASS must be rejected and the task forced back into validation.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-611", "T-20260901-611");
	await orch.handleSubagentResult(workerResult("call-611", reportFor("T-20260901-611", "call-611")));

	// external edit: HEAD moves after the worker returned
	gitOverrides.set("rev-parse HEAD", "def5678\n");
	try {
		const outcome = await orch.recordRootVerdict(orch.store.require("T-20260901-611"), "pass", "accepting late");
		assert.equal(outcome.decision.action, "revalidate");
		assert.match(outcome.decision.reason, /evidence is stale/);
		assert.match(outcome.evidence, /HEAD changed/);
		assert.equal(outcome.task.state, "changes_requested");
		assert.notEqual(outcome.task.state, "completed");
	} finally {
		gitOverrides.delete("rev-parse HEAD");
	}
}

// A Fresh Reviewer's pass verdict with evidenceFresh=true is advisory only:
// Root still samples the workspace at acceptance, and stale evidence there
// forces revalidation instead of completion.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-612", "T-20260901-612");
	await orch.handleSubagentResult(workerResult("call-612", reportFor("T-20260901-612", "call-612")));

	gitOverrides.set("rev-parse HEAD", "def5678\n");
	try {
		await orch.beginDelegation(
			{ toolCallId: "call-612-r", input: { agent: "reviewer", task: JSON.stringify(specFor("T-20260901-612", "reviewer")) } },
			BASE,
		);
		const outcome = await orch.handleSubagentResult(reviewerResult("call-612-r", "T-20260901-612", "pass"));
		assert.match(outcome.content[0].text, /decision: revalidate/);
		assert.equal(orch.store.require("T-20260901-612").state, "changes_requested");
		assert.notEqual(orch.store.require("T-20260901-612").state, "completed");
	} finally {
		gitOverrides.delete("rev-parse HEAD");
	}
}

// When the workspace really is fresh, a Fresh Reviewer pass completes the task
// on the strength of Root's own sample, not the reviewer's flag.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-613", "T-20260901-613");
	await orch.handleSubagentResult(workerResult("call-613", reportFor("T-20260901-613", "call-613")));

	await orch.beginDelegation(
		{ toolCallId: "call-613-r", input: { agent: "reviewer", task: JSON.stringify(specFor("T-20260901-613", "reviewer")) } },
		BASE,
	);
	const outcome = await orch.handleSubagentResult(reviewerResult("call-613-r", "T-20260901-613", "pass"));
	assert.match(outcome.content[0].text, /decision: accept/);
	assert.equal(orch.store.require("T-20260901-613").state, "completed");
}

console.log("planner-only orchestration: PASS");
