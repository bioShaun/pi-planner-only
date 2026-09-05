import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PlannerOrchestrator, isDelegationCall } from "./orchestrate.ts";
import { hashStatus } from "./evidence.ts";

// --------------------------------------------------------------------------
// Fixture: a GitRunner seam whose responses tests can override mid-flight, so
// an "external edit" can happen between a worker report and a Root verdict.
// --------------------------------------------------------------------------

const BASE = "/repo";
const emptyStatus = "";
const dirtyStatus = [
	"1 .M N... 100644 100644 100644 1111111 2222222 src/parser.ts",
	"",
].join("\n");
const cleanHash = hashStatus(dirtyStatus);

const gitDefaults = new Map([
	["rev-parse --git-dir", ".git\n"],
	["rev-parse HEAD", "abc1234\n"],
	["status --porcelain=v2 --branch", emptyStatus],
	["diff HEAD --stat", ""],
]);
const gitOverrides = new Map();
const gitRunner = async (args) => {
	const key = args.join(" ");
	const stdout = gitOverrides.has(key) ? gitOverrides.get(key) : gitDefaults.get(key) ?? "";
	return { stdout, stderr: "", code: 0 };
};

function setDirtyTree() {
	gitOverrides.set("status --porcelain=v2 --branch", dirtyStatus);
	gitOverrides.set("diff HEAD --stat", " src/parser.ts | 2 +-\n");
}

function setCleanTree() {
	gitOverrides.delete("status --porcelain=v2 --branch");
	gitOverrides.delete("diff HEAD --stat");
}

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
	setCleanTree();
	const outcome = await orch.beginDelegation(
		{ toolCallId, input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	setDirtyTree();
	return outcome;
}

// Management calls are not delegations, even when they carry workflow data.
assert.equal(isDelegationCall({ action: "list" }), false);
assert.equal(isDelegationCall({ action: "status", id: "x" }), false);
assert.equal(isDelegationCall({ agent: "worker", task: "..." }), true);
assert.equal(isDelegationCall({ workflowScript: "..." }), true);
assert.equal(isDelegationCall({ action: "validate", workflowScript: "..." }), false);
assert.equal(isDelegationCall({ action: "validate", tasks: [{ agent: "worker" }] }), false);
assert.equal(isDelegationCall({ action: "list", chain: [{ agent: "reviewer" }] }), false);
assert.equal(isDelegationCall({ tasks: [{ agent: "worker" }] }), true);
assert.equal(isDelegationCall({ chain: [{ agent: "reviewer" }] }), true);
assert.equal(isDelegationCall({ tasks: [] }), false);
assert.equal(isDelegationCall({ chain: [] }), false);
assert.equal(isDelegationCall({ action: "status", tasks: [{ agent: "worker" }] }), false);

// Composite execution workflows fail closed before launch. Do not parse the script.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const cases = [
		["workflowScript", { agent: "worker", task: JSON.stringify(specFor("T-20260903-801")), workflowScript: "await worker(); await reviewer();" }],
		["workflowScriptPath", { agent: "worker", task: JSON.stringify(specFor("T-20260903-802")), workflowScriptPath: "./compose.js" }],
		["workflow", { agent: "worker", task: JSON.stringify(specFor("T-20260903-803")), workflow: "worker-then-reviewer" }],
		["tasks", { agent: "worker", task: JSON.stringify(specFor("T-20260903-804")), tasks: [{ agent: "worker" }, { agent: "reviewer" }] }],
		["chain", { agent: "worker", task: JSON.stringify(specFor("T-20260903-805")), chain: [{ agent: "worker" }, { agent: "reviewer" }] }],
	];
	for (const [label, input] of cases) {
		const blocked = await orch.beginDelegation({ toolCallId: `call-${label}`, input }, BASE);
		assert.ok(blocked.block, `${label} must fail closed before launch`);
		assert.match(blocked.block.reason, /composite/i);
		assert.match(blocked.block.reason, /cannot audit or rewrite/);
		assert.match(blocked.block.reason, /does not parse workflowScript/);
		assert.match(blocked.block.reason, /independent direct call \{agent, task\}/);
		assert.match(blocked.block.reason, /Wait for the worker WorkerReport/);
		assert.match(blocked.block.reason, /latest TaskSpec, WorkerReport, and Root Git evidence/);
		assert.match(blocked.block.reason, new RegExp(label));
		assert.doesNotMatch(blocked.block.reason, /await worker\(\); await reviewer/);
	}
	assert.equal(orch.store.list().length, 0, "composite execution must not create a task");
}

// Empty composite fields do not block a direct {agent, task} call.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const ok = await orch.beginDelegation(
		{
			toolCallId: "call-800",
			input: {
				agent: "worker",
				task: JSON.stringify(specFor("T-20260903-800")),
				workflowScript: "  ",
				workflowScriptPath: "",
				workflow: "",
				tasks: [],
				chain: [],
			},
		},
		BASE,
	);
	assert.equal(ok.block, undefined);
	assert.equal(ok.task.taskId, "T-20260903-800");
}

// Management/validate with action keeps current behavior even with composite fields.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-807",
			input: { action: "validate", workflowScript: "await worker(); await reviewer();", tasks: [{ agent: "worker" }] },
		},
		BASE,
	);
	assert.equal(outcome.block, undefined, "validate with action must not use the composite execution block");
}

// Async launch receipts remain pending and do not spend correction or rounds.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260901-450";
	await orch.beginDelegation({
		toolCallId: "call-450",
		input: { async: true, task: JSON.stringify(specFor(taskId)) },
	}, BASE);
	const before = orch.store.require(taskId);
	const result = await orch.handleSubagentResult({
		toolCallId: "call-450",
		toolName: "subagent",
		input: { async: true },
		content: [{ type: "text", text: JSON.stringify({ runId: "run-450" }) }],
	});
	assert.match(result.content[0].text, /Await the run result/);
	const after = orch.store.require(taskId);
	assert.equal(after.state, "executing");
	assert.equal(after.reportCorrections, before.reportCorrections);
	assert.equal(after.reviewRound, before.reviewRound);
}

// asyncByDefault prose receipts remain pending without an async input flag.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260901-451";
	await orch.beginDelegation({ toolCallId: "call-451", input: { task: JSON.stringify(specFor(taskId)) } }, BASE);
	const before = orch.store.require(taskId);
	const receipt = [
		"Run fan-out: 1/64 used, 63 remaining",
		"Async: worker [28ac4dc2-8071-450d-8e39-8e1c014ece3d]",
		"",
		"The async run is detached and running in the background.",
		"Mission: 4afdb39f-689d-4d1e-9aad-816e8c76eca1 (active)",
	].join("\\n");
	await orch.handleSubagentResult({ toolCallId: "call-451", toolName: "subagent", content: [{ type: "text", text: receipt }] });
	const after = orch.store.require(taskId);
	assert.equal(after.state, "executing");
	assert.equal(after.reportCorrections, before.reportCorrections);
	assert.equal(after.reviewRound, before.reviewRound);
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
	setCleanTree();
	const delegated = await orch.beginDelegation(
		{ toolCallId: "call-500", input: { task: JSON.stringify(original) } },
		BASE,
	);
	assert.equal(delegated.task.taskId, "T-20260901-500");

	setDirtyTree();
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

// pi-subagents 0.65.1 formatSingleCompletion for a single run: no `Child runs:`
// line (that only exists for workflow children), so the runId never appears.
function asyncNotify(_runId, preview) {
	return `Background task completed: **worker**\n\n${preview}`;
}

function truncatedPreview() {
	return `{"version":1,"taskId":"partial ...[preview truncated]`;
}

// B1. receipt with details.runId, then subagent-notify preview holds a valid WorkerReport
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-b1";
	const runId = "run-b1-00000000-0000-0000-000000000001";
	await delegateWorker(orch, "call-b1", taskId);
	const receipt = await orch.handleSubagentResult({
		toolCallId: "call-b1",
		toolName: "subagent",
		details: { asyncId: runId, runId, asyncDir: "/no-such-async-dir" },
		content: [{
			type: "text",
			text: `Async: worker [${runId}]\nThe async run is detached and running in the background.`,
		}],
	});
	assert.match(receipt.content[0].text, /Async delegation for task T-20260905-b1 has started/);
	assert.equal(orch.store.require(taskId).state, "executing");
	assert.equal(orch.store.require(taskId).reports.length, 0);

	const outcome = await orch.handleAsyncNotify(asyncNotify(runId, JSON.stringify(reportFor(taskId, "call-b1"))));
	assert.match(outcome.content[0].text, /\[PLANNER-ONLY REVIEW STATE\]/);
	const task = orch.store.require(taskId);
	assert.equal(task.reports.length, 1);
	assert.notEqual(task.state, "executing");
	assert.equal(orch.pendingDelegationCount(), 0);
}

// B2. truncated preview + fixture file under temp outputs/<runId>/ is parsed from the file
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-b2";
	const runId = "run-b2-00000000-0000-0000-000000000002";
	const tmp = mkdtempSync(join(process.cwd(), ".planner-only-test-"));
	try {
		// Real pi-subagents layout: asyncDir = <root>/async-subagent-runs/<id>,
		// saved output = <root>/artifacts/outputs/<id>/…
		const asyncDir = join(tmp, "async-subagent-runs", runId);
		mkdirSync(asyncDir, { recursive: true });
		mkdirSync(join(tmp, "artifacts", "outputs", runId), { recursive: true });
		writeFileSync(join(tmp, "artifacts", "outputs", runId, "result.json"), JSON.stringify(reportFor(taskId, "call-b2")));
		await delegateWorker(orch, "call-b2", taskId);
		await orch.handleSubagentResult({
			toolCallId: "call-b2",
			toolName: "subagent",
			details: { asyncId: runId, runId, asyncDir },
			content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
		});
		const outcome = await orch.handleAsyncNotify(asyncNotify(runId, truncatedPreview()));
		assert.match(outcome.content[0].text, /\[PLANNER-ONLY REVIEW STATE\]/);
		assert.doesNotMatch(outcome.content[0].text, /async preview truncated/);
		assert.equal(orch.store.require(taskId).reports.length, 1);
		assert.notEqual(orch.store.require(taskId).state, "executing");
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

// B3. truncated preview and no file → report-only correction, reason contains async preview truncated
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-b3";
	const runId = "run-b3-00000000-0000-0000-000000000003";
	await delegateWorker(orch, "call-b3", taskId);
	await orch.handleSubagentResult({
		toolCallId: "call-b3",
		toolName: "subagent",
		details: { asyncId: runId, runId, asyncDir: join(process.cwd(), ".planner-only-test-missing-async") },
		content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
	});
	const outcome = await orch.handleAsyncNotify(asyncNotify(runId, truncatedPreview()));
	assert.match(outcome.content[0].text, /report-only correction/);
	assert.match(outcome.content[0].text, /async preview truncated/);
	assert.equal(orch.store.require(taskId).reports.length, 0);
}

// B4. processing the same runId twice changes nothing on the second pass
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-b4";
	const runId = "run-b4-00000000-0000-0000-000000000004";
	await delegateWorker(orch, "call-b4", taskId);
	await orch.handleSubagentResult({
		toolCallId: "call-b4",
		toolName: "subagent",
		details: { asyncId: runId, runId, asyncDir: "/no-such-async-dir" },
		content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
	});
	const notify = asyncNotify(runId, JSON.stringify(reportFor(taskId, "call-b4")));
	await orch.handleAsyncNotify(notify);
	const afterFirst = orch.store.require(taskId);
	const reports = afterFirst.reports.length;
	const state = afterFirst.state;
	const corrections = afterFirst.reportCorrections;
	const second = await orch.handleAsyncNotify(notify);
	assert.equal(second, undefined);
	const afterSecond = orch.store.require(taskId);
	assert.equal(afterSecond.reports.length, reports);
	assert.equal(afterSecond.state, state);
	assert.equal(afterSecond.reportCorrections, corrections);
}

// A completed foreground result carries details.runId but never asyncId; it
// must be handled as a result (here: malformed), not parked as a receipt.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-fg";
	await delegateWorker(orch, "call-fg", taskId);
	const outcome = await orch.handleSubagentResult({
		toolCallId: "call-fg",
		toolName: "subagent",
		details: { mode: "single", runId: "fg-run-1", results: [] },
		content: [{ type: "text", text: "done, no report" }],
	});
	assert.match(outcome.content[0].text, /not a valid WorkerReport/);
	assert.equal(orch.pendingDelegationCount(), 0);
}

// Two pending async delegations and a notice without runId or taskId: no guess.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	for (const [call, taskId, runId] of [["call-x1", "T-20260905-x1", "x1x1x1x1-0000-0000-0000-0000000000x1"], ["call-x2", "T-20260905-x2", "x2x2x2x2-0000-0000-0000-0000000000x2"]]) {
		await delegateWorker(orch, call, taskId);
		await orch.handleSubagentResult({
			toolCallId: call,
			toolName: "subagent",
			details: { asyncId: runId, runId, asyncDir: "/no-such-async-dir" },
			content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
		});
	}
	assert.equal(await orch.handleAsyncNotify(asyncNotify(undefined, "finished without a report")), undefined);
	assert.equal(orch.pendingDelegationCount(), 2);
	// A taskId in the preview disambiguates.
	const outcome = await orch.handleAsyncNotify(asyncNotify(undefined, JSON.stringify(reportFor("T-20260905-x2", "call-x2"))));
	assert.match(outcome.content[0].text, /taskId: T-20260905-x2/);
	assert.equal(orch.pendingDelegationCount(), 1);
}

// --------------------------------------------------------------------------
// v0.3 V-1: recordRootVerdict provenance, findings, and §3 step-2 refusals
// --------------------------------------------------------------------------

// pass with fresh evidence records source "root" and accepts
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-614", "T-20260901-614");
	await orch.handleSubagentResult(workerResult("call-614", reportFor("T-20260901-614", "call-614")));
	const outcome = await orch.recordRootVerdict(orch.store.require("T-20260901-614"), "pass", "verified locally", { source: "root" });
	assert.equal(outcome.decision.action, "accept");
	assert.equal(outcome.task.state, "completed");
	assert.equal(outcome.task.reviews.at(-1).source, "root");
}

// request_changes with findings: round increments, guidance lists the findings
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-615", "T-20260901-615");
	await orch.handleSubagentResult(workerResult("call-615", reportFor("T-20260901-615", "call-615")));
	const findings = [
		{ severity: "major", category: "test", description: "no empty-input case", requestedChange: "add a case" },
		{ severity: "minor", category: "maintainability", description: "naming is unclear" },
	];
	const outcome = await orch.recordRootVerdict(orch.store.require("T-20260901-615"), "request_changes", "coverage gap", { findings, source: "root" });
	assert.equal(outcome.decision.action, "request_changes");
	assert.equal(outcome.task.state, "changes_requested");
	assert.equal(outcome.task.reviewRound, 1);
	assert.match(outcome.decision.guidance.join("\n"), /\[major\] test: no empty-input case → requested: add a case/);
	assert.match(outcome.decision.guidance.join("\n"), /\[minor\] maintainability: naming is unclear/);
	const stored = outcome.task.reviews.at(-1);
	assert.equal(stored.source, "root");
	assert.equal(stored.findings.length, 2);
	// Root revising its own verdict after the correction is not an override
	await delegateWorker(orch, "call-615b", "T-20260901-615");
	await orch.handleSubagentResult(workerResult("call-615b", reportFor("T-20260901-615", "call-615b")));
	const second = await orch.recordRootVerdict(orch.store.require("T-20260901-615"), "pass", "fixed", { source: "root" });
	assert.equal(second.task.state, "completed");
	assert.equal(second.task.overrides.length, 0, "no override when the previous verdict was Root's own");
}

// blocked with no report is allowed once no delegation is pending; pass is not
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-616", "T-20260901-616");
	const pending = orch.store.require("T-20260901-616");
	assert.match(orch.rootVerdictRefusal(pending, "pass"), /no recorded WorkerReport/);
	assert.match(orch.rootVerdictRefusal(pending, "blocked"), /still pending/);
	// malformed worker output consumes the delegation without recording a report
	await orch.handleSubagentResult({
		toolCallId: "call-616",
		toolName: "subagent",
		content: [{ type: "text", text: "I tried but gave up." }],
	});
	assert.equal(orch.store.require("T-20260901-616").reports.length, 0);
	assert.match(orch.rootVerdictRefusal(orch.store.require("T-20260901-616"), "pass"), /no recorded WorkerReport/);
	assert.equal(orch.rootVerdictRefusal(orch.store.require("T-20260901-616"), "blocked"), undefined);
	const outcome = await orch.recordRootVerdict(orch.store.require("T-20260901-616"), "blocked", "worker cannot proceed", { source: "root" });
	assert.equal(outcome.decision.action, "blocked");
	assert.equal(outcome.task.state, "blocked");
}

// fresh mode: Root arbitrates, it does not pre-empt
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-617", "T-20260901-617");
	await orch.handleSubagentResult(workerResult("call-617", reportFor("T-20260901-617", "call-617")));
	orch.store.setReviewMode("T-20260901-617", "fresh");
	assert.match(orch.rootVerdictRefusal(orch.store.require("T-20260901-617"), "pass"), /fresh review mode/);
	// request_changes and blocked never widen acceptance and stay allowed
	assert.equal(orch.rootVerdictRefusal(orch.store.require("T-20260901-617"), "request_changes"), undefined);
	assert.equal(orch.rootVerdictRefusal(orch.store.require("T-20260901-617"), "blocked"), undefined);

	// while the reviewer run is pending, even arbitration must wait
	await orch.beginDelegation(
		{ toolCallId: "call-617-r", input: { agent: "reviewer", task: JSON.stringify(specFor("T-20260901-617", "reviewer")) } },
		BASE,
	);
	assert.match(orch.rootVerdictRefusal(orch.store.require("T-20260901-617"), "pass"), /still pending/);

	// the reviewer requests changes; Root's pass is then recorded as an override
	const reviewerOutcome = await orch.handleSubagentResult(reviewerResult("call-617-r", "T-20260901-617", "request_changes"));
	assert.match(reviewerOutcome.content[0].text, /decision: request_changes/);
	assert.equal(orch.store.require("T-20260901-617").reviews.at(-1).source, "reviewer");
	assert.equal(orch.rootVerdictRefusal(orch.store.require("T-20260901-617"), "pass"), undefined);
	const outcome = await orch.recordRootVerdict(orch.store.require("T-20260901-617"), "pass", "finding out of scope", { source: "root" });
	assert.equal(outcome.decision.action, "accept");
	const task = orch.store.require("T-20260901-617");
	assert.equal(task.state, "completed");
	assert.equal(task.overrides.at(-1).reviewerVerdict, "request_changes");
	assert.equal(task.overrides.at(-1).rootVerdict, "pass");
	assert.equal(task.reviews.at(-1).source, "root");
}

// --------------------------------------------------------------------------
// RF-6 — failed launch is not "has started"
// --------------------------------------------------------------------------

{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-rf6a";
	await delegateWorker(orch, "call-rf6a", taskId);
	const failed = await orch.handleSubagentResult({
		toolCallId: "call-rf6a",
		toolName: "subagent",
		isError: true,
		details: { asyncId: "run-rf6a", runId: "run-rf6a" },
		content: [{ type: "text", text: "Unknown subagent model 'volcengine/glm-5-3-flash'" }],
	});
	assert.match(failed.content[0].text, /failed to launch/);
	assert.doesNotMatch(failed.content[0].text, /has started/);
	assert.equal(orch.store.require(taskId).state, "failed");
	assert.match(orch.store.require(taskId).stateReason, /delegation launch failed: Unknown subagent model/);
	assert.equal(orch.pendingDelegationCount(), 0);
}

{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-rf6s";
	await delegateWorker(orch, "call-rf6s", taskId);
	const failed = await orch.handleSubagentResult({
		toolCallId: "call-rf6s",
		toolName: "subagent",
		isError: true,
		content: [{ type: "text", text: "spawn failed\nmore detail" }],
	});
	assert.match(failed.content[0].text, /failed to launch/);
	assert.match(failed.content[0].text, /Fix the delegation input and re-delegate with the same TaskSpec/);
	assert.equal(orch.store.require(taskId).state, "failed");
	assert.equal(orch.pendingDelegationCount(), 0);
}

{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-rf6ok";
	const runId = "run-rf6-ok";
	await delegateWorker(orch, "call-rf6ok", taskId);
	const receipt = await orch.handleSubagentResult({
		toolCallId: "call-rf6ok",
		toolName: "subagent",
		details: { asyncId: runId, runId, asyncDir: "/no-such-async-dir" },
		content: [{
			type: "text",
			text: `Async: worker [${runId}]\nThe async run is detached and running in the background.`,
		}],
	});
	assert.match(receipt.content[0].text, /has started/);
	assert.equal(orch.store.require(taskId).state, "executing");
	assert.equal(orch.pendingDelegationCount(), 1);
}

// --------------------------------------------------------------------------
// RF-7 — correction prompt without TaskSpec binds to the named live Task
// --------------------------------------------------------------------------

{
	const orch = new PlannerOrchestrator({ gitRunner, structuredDelegationMode: "warn" });
	const taskId = "T-20260905-902";
	await delegateWorker(orch, "call-902", taskId);
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-902-fix",
			input: {
				agent: "worker",
				task: "Do not modify files. Return only a valid WorkerReport for task T-20260905-902.",
			},
		},
		BASE,
	);
	assert.equal(outcome.task.taskId, taskId);
	assert.ok(
		(outcome.warnings ?? []).some((warning) =>
			/without an embedded TaskSpec/.test(warning)
			&& /attached to task T-20260905-902 named in the prompt/.test(warning),
		),
		outcome.warnings?.join(" | "),
	);
	assert.equal(orch.store.list().length, 1);
}

// Blocked and failed Tasks named in a TaskSpec-less prompt re-bind; the
// delegation moves them back to executing. A completed Task stays excluded:
// a new Task is created instead of attaching.
{
	const orch = new PlannerOrchestrator({ gitRunner, structuredDelegationMode: "warn" });
	const taskId = "T-20260905-910";
	await delegateWorker(orch, "call-910", taskId);
	orch.store.transition(taskId, "blocked");
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-910-fix",
			input: { agent: "worker", task: `Unblock and continue task ${taskId}.` },
		},
		BASE,
	);
	assert.equal(outcome.task.taskId, taskId);
	assert.equal(orch.store.require(taskId).state, "executing");
	assert.ok(
		(outcome.warnings ?? []).some((warning) =>
			/without an embedded TaskSpec/.test(warning)
			&& /attached to task T-20260905-910 named in the prompt/.test(warning),
		),
		outcome.warnings?.join(" | "),
	);
	assert.equal(orch.store.list().length, 1);
}

{
	const orch = new PlannerOrchestrator({ gitRunner, structuredDelegationMode: "warn" });
	const taskId = "T-20260905-911";
	await delegateWorker(orch, "call-911", taskId);
	orch.store.transition(taskId, "failed");
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-911-fix",
			input: { agent: "worker", task: `Retry the failed task ${taskId}.` },
		},
		BASE,
	);
	assert.equal(outcome.task.taskId, taskId);
	assert.equal(orch.store.require(taskId).state, "executing");
	assert.ok(
		(outcome.warnings ?? []).some((warning) =>
			/without an embedded TaskSpec/.test(warning)
			&& /attached to task T-20260905-911 named in the prompt/.test(warning),
		),
		outcome.warnings?.join(" | "),
	);
	assert.equal(orch.store.list().length, 1);
}

{
	const orch = new PlannerOrchestrator({ gitRunner, structuredDelegationMode: "warn" });
	const taskId = "T-20260905-912";
	await delegateWorker(orch, "call-912", taskId);
	orch.store.transition(taskId, "reviewing");
	orch.store.transition(taskId, "completed");
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-912-next",
			input: { agent: "worker", task: `Follow up on task ${taskId}.` },
		},
		BASE,
	);
	assert.notEqual(outcome.task.taskId, taskId);
	assert.equal(orch.store.require(taskId).state, "completed");
	assert.equal(orch.store.list().length, 2);
	assert.ok((outcome.warnings ?? []).some((warning) =>
		/prompt names task T-20260905-912 but no single live Task matched/.test(warning),
	), outcome.warnings?.join(" | "));
}

{
	const orch = new PlannerOrchestrator({ gitRunner, structuredDelegationMode: "warn" });
	const taskId = "T-20260905-903";
	await delegateWorker(orch, "call-903", taskId);
	await orch.handleSubagentResult(workerResult("call-903", reportFor(taskId, "call-903")));
	await orch.recordRootVerdict(orch.store.require(taskId), "request_changes", "needs a fix", { source: "root" });
	assert.equal(orch.store.require(taskId).state, "changes_requested");
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-903-fix",
			input: { agent: "worker", task: "please address the findings", cwd: `/fixture/${taskId}` },
		},
		BASE,
	);
	assert.equal(outcome.task.taskId, taskId);
	assert.ok((outcome.warnings ?? []).some((warning) => /attached to active task T-20260905-903/.test(warning)));
	assert.equal(orch.store.list().length, 1);
}

{
	const orch = new PlannerOrchestrator({ gitRunner, structuredDelegationMode: "warn" });
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-two-ids",
			input: {
				agent: "worker",
				task: "Compare T-20260905-001 with T-20260905-002 and continue.",
			},
		},
		BASE,
	);
	assert.ok(outcome.task);
	assert.ok((outcome.warnings ?? []).some((warning) =>
		/prompt names task T-20260905-001, T-20260905-002 but no single live Task matched/.test(warning),
	));
}

console.log("planner-only orchestration: PASS");
