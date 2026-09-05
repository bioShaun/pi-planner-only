import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PlannerOrchestrator, isDelegationCall } from "./orchestrate.ts";
import { TaskStore } from "./task.ts";
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
		["workflowScript", { agent: "worker", task: JSON.stringify(specFor("T-20260905-801")), workflowScript: "await worker(); await reviewer();" }],
		["workflowScriptPath", { agent: "worker", task: JSON.stringify(specFor("T-20260905-802")), workflowScriptPath: "./compose.js" }],
		["workflow", { agent: "worker", task: JSON.stringify(specFor("T-20260905-803")), workflow: "worker-then-reviewer" }],
		["tasks", { agent: "worker", task: JSON.stringify(specFor("T-20260905-804")), tasks: [{ agent: "worker" }, { agent: "reviewer" }] }],
		["chain", { agent: "worker", task: JSON.stringify(specFor("T-20260905-805")), chain: [{ agent: "worker" }, { agent: "reviewer" }] }],
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
				task: JSON.stringify(specFor("T-20260905-800")),
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
	assert.equal(ok.task.taskId, "T-20260905-800");
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
	const taskId = "T-20260905-450";
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
	const taskId = "T-20260905-451";
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
		{ toolCallId: "call-s2", input: { task: JSON.stringify(specFor("T-20260905-710")) } },
		BASE,
	);
	assert.equal(ok.block, undefined);
	assert.equal(ok.task.taskId, "T-20260905-710");

	// validators are invocations, not Tasks, even in strict mode
	const validator = await orch.beginDelegation(
		{ toolCallId: "call-s3", input: { agent: "oracle", task: "double-check the claim" } },
		BASE,
	);
	assert.equal(validator.block, undefined);
	assert.equal(validator.task, undefined);
	assert.ok((validator.warnings ?? []).some((warning) =>
		warning === "Planner-only: validator delegation names no Task under review; delegate the worker first, then re-delegate validation naming its taskId.",
	));
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
	const original = specFor("T-20260905-500");
	setCleanTree();
	const delegated = await orch.beginDelegation(
		{ toolCallId: "call-500", input: { task: JSON.stringify(original) } },
		BASE,
	);
	assert.equal(delegated.task.taskId, "T-20260905-500");

	setDirtyTree();
	const workerOutcome = await orch.handleSubagentResult(workerResult("call-500", reportFor("T-20260905-500", "call-500")));
	assert.match(workerOutcome.content[0].text, /decision: review_pending/);

	// review via a reviewer TaskSpec payload and via a ReviewRequest packet
	const specCall = await orch.beginDelegation(
		{ toolCallId: "call-501", input: { agent: "reviewer", task: JSON.stringify(specFor("T-20260905-500", "reviewer")) } },
		BASE,
	);
	assert.equal(specCall.task.taskId, "T-20260905-500");
	const specReview = await orch.handleSubagentResult(reviewerResult("call-501", "T-20260905-500", "request_changes"));
	assert.match(specReview.content[0].text, /decision: request_changes/);

	const packetCall = await orch.beginDelegation(
		{ toolCallId: "call-502", input: { agent: "reviewer", task: JSON.stringify({
			version: 1,
			taskId: "T-20260905-500",
			reportTaskId: "T-20260905-500",
			reviewMode: "fresh",
			workerReport: reportFor("T-20260905-500", "call-500"),
		}) } },
		BASE,
	);
	assert.equal(packetCall.task.taskId, "T-20260905-500");
	await orch.handleSubagentResult(reviewerResult("call-502", "T-20260905-500", "pass"));

	const task = orch.store.require("T-20260905-500");
	assert.equal(task.role, "worker");
	assert.equal(task.spec.role, "worker");
	assert.equal(task.spec.objective, original.objective);
	assert.equal(task.spec.taskId, "T-20260905-500");
}

// --------------------------------------------------------------------------
// §P0-1 — a structurally valid report for the wrong task is not a report
// --------------------------------------------------------------------------

{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-600", "T-20260905-600");
	const foreign = { ...reportFor("T-20260905-600", "call-600"), taskId: "T-20260905-999" };
	foreign.evidence = { ...foreign.evidence, taskId: "T-20260905-999" };
	const outcome = await orch.handleSubagentResult(workerResult("call-600", foreign));
	assert.match(outcome.content[0].text, /failed the task identity check/);
	assert.match(outcome.content[0].text, /report-only correction/);
	assert.equal(orch.store.require("T-20260905-600").reports.length, 0, "the foreign report must not be stored");
}

// --------------------------------------------------------------------------
// §P0-3 — no stale evidence crosses the PASS boundary
// --------------------------------------------------------------------------

// No race: a PASS right after a fresh report completes the task.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-610", "T-20260905-610");
	await orch.handleSubagentResult(workerResult("call-610", reportFor("T-20260905-610", "call-610")));
	assert.equal(orch.store.require("T-20260905-610").state, "reviewing");

	const outcome = await orch.recordRootVerdict(orch.store.require("T-20260905-610"), "pass", "verified locally");
	assert.equal(outcome.decision.action, "accept");
	assert.equal(outcome.task.state, "completed");
	assert.match(outcome.evidence, /^fresh/);
}

// Race: an external edit lands between the report and the Root PASS, so the
// PASS must be rejected and the task forced back into validation.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-611", "T-20260905-611");
	await orch.handleSubagentResult(workerResult("call-611", reportFor("T-20260905-611", "call-611")));

	// external edit: HEAD moves after the worker returned
	gitOverrides.set("rev-parse HEAD", "def5678\n");
	try {
		const outcome = await orch.recordRootVerdict(orch.store.require("T-20260905-611"), "pass", "accepting late");
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
	await delegateWorker(orch, "call-612", "T-20260905-612");
	await orch.handleSubagentResult(workerResult("call-612", reportFor("T-20260905-612", "call-612")));

	gitOverrides.set("rev-parse HEAD", "def5678\n");
	try {
		await orch.beginDelegation(
			{ toolCallId: "call-612-r", input: { agent: "reviewer", task: JSON.stringify(specFor("T-20260905-612", "reviewer")) } },
			BASE,
		);
		const outcome = await orch.handleSubagentResult(reviewerResult("call-612-r", "T-20260905-612", "pass"));
		assert.match(outcome.content[0].text, /decision: revalidate/);
		assert.equal(orch.store.require("T-20260905-612").state, "changes_requested");
		assert.notEqual(orch.store.require("T-20260905-612").state, "completed");
	} finally {
		gitOverrides.delete("rev-parse HEAD");
	}
}

// When the workspace really is fresh, a Fresh Reviewer pass completes the task
// on the strength of Root's own sample, not the reviewer's flag.
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-613", "T-20260905-613");
	await orch.handleSubagentResult(workerResult("call-613", reportFor("T-20260905-613", "call-613")));

	await orch.beginDelegation(
		{ toolCallId: "call-613-r", input: { agent: "reviewer", task: JSON.stringify(specFor("T-20260905-613", "reviewer")) } },
		BASE,
	);
	const outcome = await orch.handleSubagentResult(reviewerResult("call-613-r", "T-20260905-613", "pass"));
	assert.match(outcome.content[0].text, /decision: accept/);
	assert.equal(orch.store.require("T-20260905-613").state, "completed");
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
	const taskId = "T-20260905-601";
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
	assert.match(receipt.content[0].text, /Async delegation for task T-20260905-601 has started/);
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
	const taskId = "T-20260905-602";
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
	const taskId = "T-20260905-603";
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
	const taskId = "T-20260905-604";
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
	const taskId = "T-20260905-605";
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
	for (const [call, taskId, runId] of [["call-x1", "T-20260905-611", "x1x1x1x1-0000-0000-0000-0000000000x1"], ["call-x2", "T-20260905-612", "x2x2x2x2-0000-0000-0000-0000000000x2"]]) {
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
	const outcome = await orch.handleAsyncNotify(asyncNotify(undefined, JSON.stringify(reportFor("T-20260905-612", "call-x2"))));
	assert.match(outcome.content[0].text, /taskId: T-20260905-612/);
	assert.equal(orch.pendingDelegationCount(), 1);
}

// --------------------------------------------------------------------------
// v0.3 V-1: recordRootVerdict provenance, findings, and §3 step-2 refusals
// --------------------------------------------------------------------------

// pass with fresh evidence records source "root" and accepts
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-614", "T-20260905-614");
	await orch.handleSubagentResult(workerResult("call-614", reportFor("T-20260905-614", "call-614")));
	const outcome = await orch.recordRootVerdict(orch.store.require("T-20260905-614"), "pass", "verified locally", { source: "root" });
	assert.equal(outcome.decision.action, "accept");
	assert.equal(outcome.task.state, "completed");
	assert.equal(outcome.task.reviews.at(-1).source, "root");
}

// request_changes with findings: round increments, guidance lists the findings
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-615", "T-20260905-615");
	await orch.handleSubagentResult(workerResult("call-615", reportFor("T-20260905-615", "call-615")));
	const findings = [
		{ severity: "major", category: "test", description: "no empty-input case", requestedChange: "add a case" },
		{ severity: "minor", category: "maintainability", description: "naming is unclear" },
	];
	const outcome = await orch.recordRootVerdict(orch.store.require("T-20260905-615"), "request_changes", "coverage gap", { findings, source: "root" });
	assert.equal(outcome.decision.action, "request_changes");
	assert.equal(outcome.task.state, "changes_requested");
	assert.equal(outcome.task.reviewRound, 1);
	assert.match(outcome.decision.guidance.join("\n"), /\[major\] test: no empty-input case → requested: add a case/);
	assert.match(outcome.decision.guidance.join("\n"), /\[minor\] maintainability: naming is unclear/);
	const stored = outcome.task.reviews.at(-1);
	assert.equal(stored.source, "root");
	assert.equal(stored.findings.length, 2);
	// Root revising its own verdict after the correction is not an override
	await delegateWorker(orch, "call-615b", "T-20260905-615");
	await orch.handleSubagentResult(workerResult("call-615b", reportFor("T-20260905-615", "call-615b")));
	const second = await orch.recordRootVerdict(orch.store.require("T-20260905-615"), "pass", "fixed", { source: "root" });
	assert.equal(second.task.state, "completed");
	assert.equal(second.task.overrides.length, 0, "no override when the previous verdict was Root's own");
}

// blocked with no report is allowed once no delegation is pending; pass is not
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-616", "T-20260905-616");
	const pending = orch.store.require("T-20260905-616");
	assert.match(orch.rootVerdictRefusal(pending, "pass"), /no recorded WorkerReport/);
	assert.match(orch.rootVerdictRefusal(pending, "blocked"), /still pending/);
	// malformed worker output consumes the delegation without recording a report
	await orch.handleSubagentResult({
		toolCallId: "call-616",
		toolName: "subagent",
		content: [{ type: "text", text: "I tried but gave up." }],
	});
	assert.equal(orch.store.require("T-20260905-616").reports.length, 0);
	assert.match(orch.rootVerdictRefusal(orch.store.require("T-20260905-616"), "pass"), /no recorded WorkerReport/);
	assert.equal(orch.rootVerdictRefusal(orch.store.require("T-20260905-616"), "blocked"), undefined);
	const outcome = await orch.recordRootVerdict(orch.store.require("T-20260905-616"), "blocked", "worker cannot proceed", { source: "root" });
	assert.equal(outcome.decision.action, "blocked");
	assert.equal(outcome.task.state, "blocked");
}

// fresh mode: Root arbitrates, it does not pre-empt
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-617", "T-20260905-617");
	await orch.handleSubagentResult(workerResult("call-617", reportFor("T-20260905-617", "call-617")));
	orch.store.setReviewMode("T-20260905-617", "fresh");
	assert.match(orch.rootVerdictRefusal(orch.store.require("T-20260905-617"), "pass"), /fresh review mode/);
	// request_changes and blocked never widen acceptance and stay allowed
	assert.equal(orch.rootVerdictRefusal(orch.store.require("T-20260905-617"), "request_changes"), undefined);
	assert.equal(orch.rootVerdictRefusal(orch.store.require("T-20260905-617"), "blocked"), undefined);

	// while the reviewer run is pending, even arbitration must wait
	await orch.beginDelegation(
		{ toolCallId: "call-617-r", input: { agent: "reviewer", task: JSON.stringify(specFor("T-20260905-617", "reviewer")) } },
		BASE,
	);
	assert.match(orch.rootVerdictRefusal(orch.store.require("T-20260905-617"), "pass"), /still pending/);

	// the reviewer requests changes; Root's pass is then recorded as an override
	const reviewerOutcome = await orch.handleSubagentResult(reviewerResult("call-617-r", "T-20260905-617", "request_changes"));
	assert.match(reviewerOutcome.content[0].text, /decision: request_changes/);
	assert.equal(orch.store.require("T-20260905-617").reviews.at(-1).source, "reviewer");
	assert.equal(orch.rootVerdictRefusal(orch.store.require("T-20260905-617"), "pass"), undefined);
	const outcome = await orch.recordRootVerdict(orch.store.require("T-20260905-617"), "pass", "finding out of scope", { source: "root" });
	assert.equal(outcome.decision.action, "accept");
	const task = orch.store.require("T-20260905-617");
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
	const taskId = "T-20260905-661";
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
	const taskId = "T-20260905-662";
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
	const taskId = "T-20260905-663";
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

// Explorer delegation without a TaskSpec binds to the named live Task and
// emits a STANDALONE attachment warning: explorers skip the "without an
// embedded TaskSpec" base warning, so there is no warning to append the
// suffix to.
{
	const orch = new PlannerOrchestrator({ gitRunner, structuredDelegationMode: "warn" });
	const taskId = "T-20260905-913";
	await delegateWorker(orch, "call-913", taskId);
	const before = orch.store.list().length;
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-913-explore",
			input: { agent: "explorer", task: `Investigate task ${taskId} and report findings.` },
		},
		BASE,
	);
	assert.equal(outcome.task.taskId, taskId);
	assert.ok(
		(outcome.warnings ?? []).some((warning) =>
			warning === `Planner-only: attached to task ${taskId} named in the prompt`,
		),
		outcome.warnings?.join(" | "),
	);
	assert.ok(
		!(outcome.warnings ?? []).some((warning) => /without an embedded TaskSpec/.test(warning)),
		outcome.warnings?.join(" | "),
	);
	assert.equal(orch.store.list().length, before);
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

// --------------------------------------------------------------------------
// L-1 — lenient WorkerReport normalisation
// --------------------------------------------------------------------------

function t1BaselineReport(taskId, toolCallId) {
	return {
		version: "1",
		taskId,
		status: "completed",
		summary: "Implemented the change.",
		changedFiles: [{ path: "src/parser.ts", change: "modified" }],
		unresolvedItems: ["docs later"],
		validation: [{ command: "npm test", type: "npm test", status: "passed", exitCode: 0, summary: "1 passed" }],
		evidence: {
			cwd: `/fixture/${taskId}`,
			workerRunId: toolCallId,
			baseGitRef: "abc1234",
			finalGitRef: "abc1234",
			gitStatusHash: cleanHash,
			changedPaths: ["src/parser.ts"],
			gitAvailable: true,
			generatedAt: "2026-09-01T10:00:00.000Z",
		},
		risks: [],
	};
}

// L-1: T1 first-report fixture is accepted in one pass; Task reaches reviewing; decision contains Report normalised:
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-l1-t1", "T-20260905-181");
	const outcome = await orch.handleSubagentResult(workerResult("call-l1-t1", t1BaselineReport("T-20260905-181", "call-l1-t1")));
	const text = outcome.content[0].text;
	assert.match(text, /Report normalised:/);
	const task = orch.store.require("T-20260905-181");
	assert.equal(task.state, "reviewing");
	assert.equal(task.reports.length, 1);
	assert.equal(task.reports[0].version, 1);
	assert.deepEqual(task.reports[0].changedFiles, ["src/parser.ts"]);
	assert.deepEqual(task.reports[0].unresolved, ["docs later"]);
	assert.equal(task.reports[0].validation[0].type, "test");
	assert.equal(task.reports[0].evidence.taskId, "T-20260905-181");
}

// L-1: evidence.taskId mismatching taskId is still rejected and counts one report correction
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-l1-mm", "T-20260905-182");
	const report = {
		...reportFor("T-20260905-182", "call-l1-mm"),
		evidence: { ...reportFor("T-20260905-182", "call-l1-mm").evidence, taskId: "T-OTHER" },
	};
	const outcome = await orch.handleSubagentResult(workerResult("call-l1-mm", report));
	assert.match(outcome.content[0].text, /not a valid WorkerReport|evidence\.taskId must match/);
	assert.equal(orch.store.require("T-20260905-182").reports.length, 0);
	assert.equal(orch.store.require("T-20260905-182").reportCorrections, 1);
}

// L-1: already-valid report has repairs [] and the decision text has no Report normalised line
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-l1-ok", "T-20260905-183");
	const outcome = await orch.handleSubagentResult(workerResult("call-l1-ok", reportFor("T-20260905-183", "call-l1-ok")));
	assert.doesNotMatch(outcome.content[0].text, /Report normalised:/);
	assert.equal(orch.store.require("T-20260905-183").state, "reviewing");
	assert.equal(orch.store.require("T-20260905-183").reports.length, 1);
}

// --------------------------------------------------------------------------
// L-4 — Root can close blocked/failed Tasks; refusals never name a slash
// --------------------------------------------------------------------------

const ROOT_MAY_STILL_JUDGE = "Root may still judge the last recorded report and evidence with git_audit and record planner_verdict, or re-delegate with the same TaskSpec.";

// L-4: Task blocked with one report and fresh evidence: planner_verdict(pass) → completed
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-l4-fresh", "T-20260905-401");
	await orch.handleSubagentResult(workerResult("call-l4-fresh", reportFor("T-20260905-401", "call-l4-fresh")));
	const blocked = await orch.recordRootVerdict(orch.store.require("T-20260905-401"), "blocked", "stop for now", { source: "root" });
	assert.equal(blocked.task.state, "blocked");
	assert.equal(orch.rootVerdictRefusal(orch.store.require("T-20260905-401"), "pass"), undefined);
	const outcome = await orch.recordRootVerdict(orch.store.require("T-20260905-401"), "pass", "looks good after all", { source: "root" });
	assert.equal(outcome.decision.action, "accept");
	assert.equal(outcome.task.state, "completed");
}

// L-4: blocked with report but stale evidence: revalidate, not completed
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-l4-stale", "T-20260905-402");
	await orch.handleSubagentResult(workerResult("call-l4-stale", reportFor("T-20260905-402", "call-l4-stale")));
	await orch.recordRootVerdict(orch.store.require("T-20260905-402"), "blocked", "pause", { source: "root" });
	gitOverrides.set("rev-parse HEAD", "def5678\n");
	try {
		const outcome = await orch.recordRootVerdict(orch.store.require("T-20260905-402"), "pass", "accepting late", { source: "root" });
		assert.equal(outcome.decision.action, "revalidate");
		assert.notEqual(outcome.task.state, "completed");
	} finally {
		gitOverrides.delete("rev-parse HEAD");
	}
}

// L-4: blocked with no report: pass refused with no-WorkerReport text; blocked verdict accepted
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-l4-nr", "T-20260905-403");
	await orch.handleSubagentResult({
		toolCallId: "call-l4-nr",
		toolName: "subagent",
		content: [{ type: "text", text: "gave up" }],
	});
	orch.store.transition("T-20260905-403", "blocked");
	const task = orch.store.require("T-20260905-403");
	assert.equal(task.reports.length, 0);
	assert.match(orch.rootVerdictRefusal(task, "pass"), /no recorded WorkerReport/);
	assert.equal(orch.rootVerdictRefusal(task, "blocked"), undefined);
	const outcome = await orch.recordRootVerdict(task, "blocked", "cannot proceed", { source: "root" });
	assert.equal(outcome.decision.action, "blocked");
	assert.equal(outcome.task.state, "blocked");
}

// L-4: completed Task refused with the new text; no rootVerdictRefusal string contains /planner-only
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-l4-done", "T-20260905-404");
	await orch.handleSubagentResult(workerResult("call-l4-done", reportFor("T-20260905-404", "call-l4-done")));
	await orch.recordRootVerdict(orch.store.require("T-20260905-404"), "pass", "done", { source: "root" });
	const completed = orch.store.require("T-20260905-404");
	assert.equal(
		orch.rootVerdictRefusal(completed, "pass"),
		"Task T-20260905-404 is already completed; verdicts are final. Start a new Task with a new TaskSpec for further work.",
	);
	const states = ["planning", "executing", "reviewing", "changes_requested", "blocked", "completed", "failed"];
	const verdicts = ["pass", "request_changes", "blocked"];
	for (const state of states) {
		for (const verdict of verdicts) {
			const probe = { ...completed, state, reports: state === "planning" ? [] : completed.reports };
			const refusal = orch.rootVerdictRefusal(probe, verdict);
			if (refusal) assert.doesNotMatch(refusal, /\/planner-only/, `${state} ${verdict}: ${refusal}`);
		}
	}
}

// L-4: exhausted report-corrections text that sends a Task to blocked ends with the Root-may-still-judge sentence
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-l4-ex1", "T-20260905-405");
	await orch.handleSubagentResult({
		toolCallId: "call-l4-ex1",
		toolName: "subagent",
		content: [{ type: "text", text: "no report" }],
	});
	await delegateWorker(orch, "call-l4-ex2", "T-20260905-405");
	const second = await orch.handleSubagentResult({
		toolCallId: "call-l4-ex2",
		toolName: "subagent",
		content: [{ type: "text", text: "still no report" }],
	});
	assert.equal(orch.store.require("T-20260905-405").state, "blocked");
	assert.ok(second.content[0].text.endsWith(ROOT_MAY_STILL_JUDGE), second.content[0].text.slice(-200));
}

// --------------------------------------------------------------------------
// L-2 — base evidence is sampled once per Task
// --------------------------------------------------------------------------

const twoPathStatus = [
	"1 .M N... 100644 100644 100644 1111111 2222222 src/parser.ts",
	"1 .M N... 100644 100644 100644 1111111 3333333 src/parser.test.ts",
	"",
].join("\n");
const twoPathHash = hashStatus(twoPathStatus);

function specT3(taskId) {
	return {
		...specFor(taskId, "worker", BASE),
		scope: { allowedPaths: ["src/parser.ts", "src/parser.test.ts"] },
	};
}

function reportT3(taskId, toolCallId) {
	return {
		...reportFor(taskId, toolCallId),
		changedFiles: ["src/parser.ts", "src/parser.test.ts"],
		evidence: {
			...reportFor(taskId, toolCallId).evidence,
			cwd: BASE,
			baseGitRef: "a1",
			finalGitRef: "a1",
			gitStatusHash: twoPathHash,
			changedPaths: ["src/parser.ts", "src/parser.test.ts"],
		},
	};
}

// L-2 T3: first unrepairable report, correction keeps base A, both paths attributed, no over-reported
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-231";
	gitOverrides.set("rev-parse HEAD", "a1\n");
	try {
		setCleanTree();
		const first = await orch.beginDelegation(
			{ toolCallId: "call-l2-t3a", input: { task: JSON.stringify(specT3(taskId)) } },
			BASE,
		);
		assert.equal(first.task.baseEvidence?.finalGitRef, "a1");
		gitOverrides.set("status --porcelain=v2 --branch", twoPathStatus);
		gitOverrides.set("diff HEAD --stat", " src/parser.ts | 2 +-\n src/parser.test.ts | 2 +-\n");
		const unrepairable = {
			...reportT3(taskId, "call-l2-t3a"),
			status: "unknown",
		};
		const rejected = await orch.handleSubagentResult(workerResult("call-l2-t3a", unrepairable));
		assert.match(rejected.content[0].text, /not a valid WorkerReport/);
		assert.equal(orch.store.require(taskId).reports.length, 0);

		const correction = await orch.beginDelegation(
			{ toolCallId: "call-l2-t3b", input: { task: JSON.stringify(specT3(taskId)) } },
			BASE,
		);
		assert.equal(correction.task.taskId, taskId);
		assert.equal(correction.task.baseEvidence?.finalGitRef, "a1", "correction must not resample the base");
		const accepted = await orch.handleSubagentResult(workerResult("call-l2-t3b", reportT3(taskId, "call-l2-t3b")));
		const comparison = orch.store.require(taskId).lastComparison;
		assert.ok(comparison);
		assert.equal(comparison.extraDeclaredPaths.length, 0);
		assert.doesNotMatch(accepted.content[0].text, /over-reported/);
		assert.equal(comparison.truthPaths.length, 2);
		assert.match(accepted.content[0].text, /base a1/);
	} finally {
		gitOverrides.delete("rev-parse HEAD");
		setCleanTree();
	}
}

// L-2 (R13 review): a recorded report ends the round; the next worker delegation re-samples A
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-233";
	const onePathStatus = [
		"1 .M N... 100644 100644 100644 1111111 2222222 src/parser.ts",
		"",
	].join("\n");
	gitOverrides.set("rev-parse HEAD", "a1\n");
	try {
		setCleanTree();
		const first = await orch.beginDelegation(
			{ toolCallId: "call-l2-r2a", input: { task: JSON.stringify(specT3(taskId)) } },
			BASE,
		);
		assert.equal(first.task.baseEvidence?.finalGitRef, "a1");
		assert.equal(first.task.baseReportCount, 0);
		gitOverrides.set("status --porcelain=v2 --branch", onePathStatus);
		gitOverrides.set("diff HEAD --stat", " src/parser.ts | 2 +-\n");
		const roundOne = {
			...reportT3(taskId, "call-l2-r2a"),
			changedFiles: ["src/parser.ts"],
			evidence: {
				...reportT3(taskId, "call-l2-r2a").evidence,
				gitStatusHash: hashStatus(onePathStatus),
				changedPaths: ["src/parser.ts"],
			},
		};
		const accepted = await orch.handleSubagentResult(workerResult("call-l2-r2a", roundOne));
		assert.doesNotMatch(accepted.content[0].text, /not a valid WorkerReport/);
		assert.equal(orch.store.require(taskId).reports.length, 1);
		await orch.recordRootVerdict(orch.store.require(taskId), "request_changes", "add the test", { source: "root" });
		assert.equal(orch.store.require(taskId).state, "changes_requested");
		assert.equal(orch.store.baseRoundEnded(taskId), true);

		// Round 2 starts on the tree that already carries round 1's edit.
		gitOverrides.set("rev-parse HEAD", "a2\n");
		const second = await orch.beginDelegation(
			{ toolCallId: "call-l2-r2b", input: { task: JSON.stringify(specT3(taskId)) } },
			BASE,
		);
		assert.equal(second.task.taskId, taskId);
		assert.equal(second.task.baseEvidence?.finalGitRef, "a2", "a recorded report must end the round and re-sample the base");
		assert.equal(second.task.baseReportCount, 1);
		gitOverrides.set("status --porcelain=v2 --branch", twoPathStatus);
		gitOverrides.set("diff HEAD --stat", " src/parser.ts | 2 +-\n src/parser.test.ts | 2 +-\n");
		const roundTwo = {
			...reportT3(taskId, "call-l2-r2b"),
			changedFiles: ["src/parser.test.ts"],
			evidence: {
				...reportT3(taskId, "call-l2-r2b").evidence,
				baseGitRef: "a2",
				finalGitRef: "a2",
				changedPaths: ["src/parser.test.ts"],
			},
		};
		const outcome = await orch.handleSubagentResult(workerResult("call-l2-r2b", roundTwo));
		assert.doesNotMatch(outcome.content[0].text, /in-scope paths changed after the report/);
		assert.doesNotMatch(outcome.content[0].text, /over-reported/);
		assert.match(outcome.content[0].text, /base a2/);
	} finally {
		gitOverrides.delete("rev-parse HEAD");
		setCleanTree();
	}
}

// L-2: decision evidence line contains base <sha7>
{
	const orch = new PlannerOrchestrator({ gitRunner });
	await delegateWorker(orch, "call-l2-sha", "T-20260905-232");
	const outcome = await orch.handleSubagentResult(
		workerResult("call-l2-sha", reportFor("T-20260905-232", "call-l2-sha")),
	);
	assert.match(outcome.content[0].text, /evidence: .* base abc1234/);
}

// L-2: abandon clears base; RF-6 failed-launch re-bind does not
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-233";
	await delegateWorker(orch, "call-l2-rf6a", taskId);
	const original = orch.store.require(taskId).baseEvidence?.finalGitRef;
	assert.equal(original, "abc1234");
	await orch.handleSubagentResult({
		toolCallId: "call-l2-rf6a",
		toolName: "subagent",
		isError: true,
		content: [{ type: "text", text: "launch failed: agent missing" }],
	});
	assert.equal(orch.store.require(taskId).state, "failed");
	assert.equal(orch.store.require(taskId).baseEvidence?.finalGitRef, original);
	const rebound = await orch.beginDelegation(
		{ toolCallId: "call-l2-rf6b", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.equal(rebound.task.taskId, taskId);
	assert.equal(rebound.task.baseEvidence?.finalGitRef, original, "RF-6 re-bind must keep the original base");
}

// --------------------------------------------------------------------------
// L-3 — validator is an invocation over the Task under review
// --------------------------------------------------------------------------

// L-3: validator + fresh TaskSpec id while T-…-001 (with a report) is active in cwd
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-301";
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-l3-w", input: { task: JSON.stringify(specFor(taskId, "worker", BASE)) } },
		BASE,
	);
	setDirtyTree();
	const workerReport = {
		...reportFor(taskId, "call-l3-w"),
		evidence: { ...reportFor(taskId, "call-l3-w").evidence, cwd: BASE },
	};
	await orch.handleSubagentResult(workerResult("call-l3-w", workerReport));
	const before = orch.store.require(taskId);
	const beforeLen = orch.store.list().length;
	const beforeBase = before.baseEvidence?.finalGitRef;
	const beforeState = before.state;
	const freshId = "T-20260905-399";
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-l3-v",
			input: {
				agent: "oracle",
				task: JSON.stringify(specFor(freshId, "worker", BASE)),
			},
		},
		BASE,
	);
	assert.equal(orch.store.list().length, beforeLen, "validator must not create a Task");
	assert.equal(outcome.task?.taskId, taskId);
	assert.ok((outcome.warnings ?? []).some((warning) =>
		warning === `Planner-only: validator TaskSpec id ${freshId} ignored; validating task ${taskId}`,
	), outcome.warnings?.join(" | "));
	const after = orch.store.require(taskId);
	assert.equal(after.state, beforeState);
	assert.equal(after.baseEvidence?.finalGitRef, beforeBase);
	assert.equal(orch.getDelegation("call-l3-v")?.kind, "validator");
}

// L-3: valid validator WorkerReport appends validatorReports, not reports
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-302";
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-l3-w2", input: { task: JSON.stringify(specFor(taskId, "worker", BASE)) } },
		BASE,
	);
	setDirtyTree();
	const workerReport = {
		...reportFor(taskId, "call-l3-w2"),
		evidence: { ...reportFor(taskId, "call-l3-w2").evidence, cwd: BASE },
	};
	await orch.handleSubagentResult(workerResult("call-l3-w2", workerReport));
	const reportsBefore = orch.store.require(taskId).reports.length;
	await orch.beginDelegation(
		{
			toolCallId: "call-l3-v2",
			input: { agent: "oracle", task: JSON.stringify({ ...specFor(taskId, "validator", BASE) }) },
		},
		BASE,
	);
	const validatorReport = reportFor(taskId, "call-l3-v2");
	validatorReport.evidence = { ...validatorReport.evidence, cwd: BASE };
	const result = await orch.handleSubagentResult(workerResult("call-l3-v2", validatorReport));
	assert.ok(result.content[0].text.startsWith(`[PLANNER-ONLY] Validator result for task ${taskId}`));
	assert.equal(orch.store.require(taskId).validatorReports.length, 1);
	assert.equal(orch.store.require(taskId).reports.length, reportsBefore);
	assert.equal(orch.store.require(taskId).reportCorrections, 0);
}

// L-3: no resolvable Task — warning only; later result is the unknown-task path
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const beforeLen = orch.store.list().length;
	const outcome = await orch.beginDelegation(
		{ toolCallId: "call-l3-none", input: { agent: "oracle", task: "validate the claim with no task named" } },
		BASE,
	);
	assert.equal(outcome.task, undefined);
	assert.equal(orch.store.list().length, beforeLen);
	assert.equal(
		outcome.warnings?.[0],
		"Planner-only: validator delegation names no Task under review; delegate the worker first, then re-delegate validation naming its taskId.",
	);
	const later = await orch.handleSubagentResult({
		toolCallId: "call-l3-none",
		toolName: "subagent",
		content: [{ type: "text", text: JSON.stringify(reportFor("T-20260905-none", "call-l3-none")) }],
		isError: false,
	});
	assert.match(later.content[0].text, /no longer in the Task store/);
	assert.match(later.content[0].text, /Nothing was recorded/);
	assert.equal(orch.store.list().length, beforeLen);
}

// L-3: planner_verdict(pass) refused while validator pending; accepted after; completed on T-…-001
{
	const orch = new PlannerOrchestrator({ gitRunner });
	const taskId = "T-20260905-304";
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-l3-w4", input: { task: JSON.stringify(specFor(taskId, "worker", BASE)) } },
		BASE,
	);
	setDirtyTree();
	const workerReport = {
		...reportFor(taskId, "call-l3-w4"),
		evidence: { ...reportFor(taskId, "call-l3-w4").evidence, cwd: BASE },
	};
	await orch.handleSubagentResult(workerResult("call-l3-w4", workerReport));
	await orch.beginDelegation(
		{
			toolCallId: "call-l3-v4",
			input: { agent: "oracle", task: JSON.stringify(specFor(taskId, "validator", BASE)) },
		},
		BASE,
	);
	assert.match(
		orch.rootVerdictRefusal(orch.store.require(taskId), "pass"),
		/has a child run still pending/,
	);
	const validatorReport = reportFor(taskId, "call-l3-v4");
	validatorReport.evidence = { ...validatorReport.evidence, cwd: BASE };
	await orch.handleSubagentResult(workerResult("call-l3-v4", validatorReport));
	assert.equal(orch.rootVerdictRefusal(orch.store.require(taskId), "pass"), undefined);
	const closed = await orch.recordRootVerdict(orch.store.require(taskId), "pass", "validated", { source: "root" });
	assert.equal(closed.task.state, "completed");
	assert.equal(closed.task.taskId, taskId);
}

// --------------------------------------------------------------------------
// L-5 — store issues Task id; model id is alias
// --------------------------------------------------------------------------

// L-5: TaskSpec dated 2026-02-20 on 2026-09-05 is replaced; alias resolves
{
	const store = new TaskStore({ now: () => new Date(2026, 8, 5) });
	const orch = new PlannerOrchestrator({ store, gitRunner });
	const outcome = await orch.beginDelegation(
		{ toolCallId: "call-l5-date", input: { task: JSON.stringify(specFor("T-20260220-001", "worker", BASE)) } },
		BASE,
	);
	assert.equal(outcome.task.taskId, "T-20260905-001");
	assert.deepEqual(outcome.task.aliases, ["T-20260220-001"]);
	assert.equal(orch.store.get("T-20260220-001")?.taskId, "T-20260905-001");
	assert.equal(outcome.task.spec?.taskId, "T-20260905-001");
	assert.ok((outcome.warnings ?? []).some((warning) =>
		warning === "Planner-only: TaskSpec id T-20260220-001 replaced by T-20260905-001 (generated); T-20260220-001 is kept as an alias",
	), outcome.warnings?.join(" | "));
}

// L-5: today's well-formed id is created verbatim, no alias, no warning
{
	const store = new TaskStore({ now: () => new Date(2026, 8, 5) });
	const orch = new PlannerOrchestrator({ store, gitRunner });
	const outcome = await orch.beginDelegation(
		{ toolCallId: "call-l5-today", input: { task: JSON.stringify(specFor("T-20260905-042", "worker", BASE)) } },
		BASE,
	);
	assert.equal(outcome.task.taskId, "T-20260905-042");
	assert.deepEqual(outcome.task.aliases, []);
	assert.equal(outcome.warnings, undefined);
}

// L-5: WorkerReport echoing the alias is stored with the canonical id; unrelated id fails
{
	const store = new TaskStore({ now: () => new Date(2026, 8, 5) });
	const orch = new PlannerOrchestrator({ store, gitRunner });
	await orch.beginDelegation(
		{ toolCallId: "call-l5-alias", input: { task: JSON.stringify(specFor("T-20260220-010", "worker", BASE)) } },
		BASE,
	);
	const canonical = "T-20260905-001";
	assert.equal(orch.store.require("T-20260220-010").taskId, canonical);
	setDirtyTree();
	const aliased = reportFor("T-20260220-010", "call-l5-alias");
	aliased.evidence = { ...aliased.evidence, cwd: BASE, taskId: "T-20260220-010" };
	const accepted = await orch.handleSubagentResult(workerResult("call-l5-alias", aliased));
	assert.match(accepted.content[0].text, /Report normalised: .*taskId T-20260220-010 → T-20260905-001/);
	const stored = orch.store.require(canonical).reports[0];
	assert.equal(stored.taskId, canonical);
	assert.equal(stored.evidence.taskId, canonical);

	await orch.beginDelegation(
		{ toolCallId: "call-l5-bad", input: { task: JSON.stringify(specFor("T-20260905-043", "worker", BASE)) } },
		BASE,
	);
	const foreign = reportFor("T-20260905-999", "call-l5-bad");
	const rejected = await orch.handleSubagentResult(workerResult("call-l5-bad", foreign));
	assert.match(rejected.content[0].text, /failed the task identity check/);
	assert.equal(orch.store.require("T-20260905-043").reports.length, 0);
}

// L-5: correction prompt naming the alias re-binds to the canonical Task (RF-7)
{
	const store = new TaskStore({ now: () => new Date(2026, 8, 5) });
	const orch = new PlannerOrchestrator({ store, gitRunner });
	await orch.beginDelegation(
		{ toolCallId: "call-l5-rf7a", input: { task: JSON.stringify(specFor("T-20260220-020", "worker", BASE)) } },
		BASE,
	);
	const canonical = orch.store.require("T-20260220-020").taskId;
	await orch.handleSubagentResult({
		toolCallId: "call-l5-rf7a",
		toolName: "subagent",
		content: [{ type: "text", text: "not a report" }],
	});
	assert.equal(orch.store.require(canonical).state, "changes_requested");
	const rebound = await orch.beginDelegation(
		{
			toolCallId: "call-l5-rf7b",
			input: { agent: "worker", task: "Do not modify files. Return only a valid WorkerReport for task T-20260220-020." },
		},
		BASE,
	);
	assert.equal(rebound.task.taskId, canonical);
	assert.equal(orch.store.list().length, 1);
}

console.log("planner-only orchestration: PASS");
