import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { PlannerOrchestrator, isDelegationCall } from "./orchestrate.ts";
import { createTaskSpec, isExecutingStale } from "./task.ts";
import { TaskStore } from "./task.ts";
import { hashStatus, workspaceSummaryDigest } from "./evidence.ts";

// Fixture ids are stamped 2026-09-05; pin the store clock so id replacement
// never depends on the wall clock of the machine running the suite.
const FIXED_NOW = () => new Date(2026, 8, 5);
const pinnedStore = () => new TaskStore({ now: FIXED_NOW });

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

function reviewerResult(toolCallId, taskId, verdict = "pass", overrides = {}) {
	return {
		toolCallId,
		toolName: "subagent",
		input: {},
		content: [{
			type: "text",
			text: JSON.stringify({
				taskId,
				verdict,
				summary: `${verdict} from reviewer`,
				evidenceFresh: true,
				findings: [],
				// D09 — echo what the ReviewRequest packet said: the report revision
				// plus the workspace snapshot digest the reviewer was shown. Call
				// sites pass the Task's current snapshot digest via overrides.
				reportRevision: 1,
				...overrides,
			}),
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "strict" });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
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
		const fromEnv = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		assert.equal(fromEnv.structuredDelegationMode, "strict");
	} finally {
		delete process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION;
	}
	const defaults = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	assert.equal(defaults.structuredDelegationMode, "warn");
}

// --------------------------------------------------------------------------
// §P1-1 — a reviewer invocation never mutates the Task's original TaskSpec
// --------------------------------------------------------------------------

{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const specReview = await orch.handleSubagentResult(reviewerResult("call-501", "T-20260905-500", "request_changes", { workspaceDigest: orch.store.require("T-20260905-500").snapshot?.digest }));
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
	await orch.handleSubagentResult(reviewerResult("call-502", "T-20260905-500", "pass", { workspaceDigest: orch.store.require("T-20260905-500").snapshot?.digest }));

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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await delegateWorker(orch, "call-612", "T-20260905-612");
	await orch.handleSubagentResult(workerResult("call-612", reportFor("T-20260905-612", "call-612")));

	gitOverrides.set("rev-parse HEAD", "def5678\n");
	try {
		await orch.beginDelegation(
			{ toolCallId: "call-612-r", input: { agent: "reviewer", task: JSON.stringify(specFor("T-20260905-612", "reviewer")) } },
			BASE,
		);
		const outcome = await orch.handleSubagentResult(reviewerResult("call-612-r", "T-20260905-612", "pass", { workspaceDigest: orch.store.require("T-20260905-612").snapshot?.digest }));
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await delegateWorker(orch, "call-613", "T-20260905-613");
	await orch.handleSubagentResult(workerResult("call-613", reportFor("T-20260905-613", "call-613")));

	await orch.beginDelegation(
		{ toolCallId: "call-613-r", input: { agent: "reviewer", task: JSON.stringify(specFor("T-20260905-613", "reviewer")) } },
		BASE,
	);
	const outcome = await orch.handleSubagentResult(reviewerResult("call-613-r", "T-20260905-613", "pass", { workspaceDigest: orch.store.require("T-20260905-613").snapshot?.digest }));
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await delegateWorker(orch, "call-614", "T-20260905-614");
	await orch.handleSubagentResult(workerResult("call-614", reportFor("T-20260905-614", "call-614")));
	const outcome = await orch.recordRootVerdict(orch.store.require("T-20260905-614"), "pass", "verified locally", { source: "root" });
	assert.equal(outcome.decision.action, "accept");
	assert.equal(outcome.task.state, "completed");
	assert.equal(outcome.task.reviews.at(-1).source, "root");
}

// request_changes with findings: round increments, guidance lists the findings
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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

// blocked with no report is allowed even while a child is pending (escape
// hatch); pass is not
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await delegateWorker(orch, "call-616", "T-20260905-616");
	const pending = orch.store.require("T-20260905-616");
	assert.match(orch.rootVerdictRefusal(pending, "pass"), /no recorded WorkerReport/);
	assert.equal(orch.rootVerdictRefusal(pending, "blocked"), undefined, "blocked must stay available while a child is pending");
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const reviewerOutcome = await orch.handleSubagentResult(reviewerResult("call-617-r", "T-20260905-617", "request_changes", { workspaceDigest: orch.store.require("T-20260905-617").snapshot?.digest }));
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
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

// Unbound explorer delegation creates no Task at all: it is recorded as the
// `unbound-explorer-` placeholder (mirroring `unbound-validator-`) and returns
// only the standalone warning, with no evidence sampling.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	const before = orch.store.list().length;
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-914-explore-unbound",
			input: { agent: "explorer", task: "Survey the repo and report findings." },
		},
		BASE,
	);
	assert.equal(outcome.task, undefined);
	assert.deepEqual(outcome.warnings, [
		"Planner-only: explorer delegation is not attached to any Task; its output is returned as-is.",
	]);
	assert.equal(orch.store.list().length, before);
	assert.deepEqual(orch.getDelegation("call-914-explore-unbound"), {
		taskId: "unbound-explorer-call-914-explore-unbound",
		kind: "explorer",
		asyncRequested: false,
		agent: "explorer",
	});
}

// An explorer delegation that names an existing Task id still binds to it.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	const taskId = "T-20260905-915";
	await delegateWorker(orch, "call-915", taskId);
	const before = orch.store.list().length;
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-915-explore",
			input: { agent: "explorer", task: `Investigate task ${taskId} and report findings.` },
		},
		BASE,
	);
	assert.equal(outcome.task?.taskId, taskId);
	assert.equal(orch.store.list().length, before);
	assert.equal(orch.getDelegation("call-915-explore")?.taskId, taskId);
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await delegateWorker(orch, "call-l2-sha", "T-20260905-232");
	const outcome = await orch.handleSubagentResult(
		workerResult("call-l2-sha", reportFor("T-20260905-232", "call-l2-sha")),
	);
	assert.match(outcome.content[0].text, /evidence: .* base abc1234/);
}

// L-2: abandon clears base; RF-6 failed-launch re-bind does not
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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

// L-1: lenient normalisation on the validator path echoes Report normalised:
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-303";
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-l3-w3", input: { task: JSON.stringify(specFor(taskId, "worker", BASE)) } },
		BASE,
	);
	setDirtyTree();
	const workerReport = {
		...reportFor(taskId, "call-l3-w3"),
		evidence: { ...reportFor(taskId, "call-l3-w3").evidence, cwd: BASE },
	};
	await orch.handleSubagentResult(workerResult("call-l3-w3", workerReport));
	await orch.beginDelegation(
		{
			toolCallId: "call-l3-v3",
			input: { agent: "oracle", task: JSON.stringify(specFor(taskId, "validator", BASE)) },
		},
		BASE,
	);
	// version "1" is accepted but repaired to 1 by the lenient normaliser
	const validatorReport = reportFor(taskId, "call-l3-v3");
	validatorReport.version = "1";
	validatorReport.evidence = { ...validatorReport.evidence, cwd: BASE };
	const repaired = await orch.handleSubagentResult(workerResult("call-l3-v3", validatorReport));
	assert.ok(repaired.content[0].text.startsWith(`[PLANNER-ONLY] Validator result for task ${taskId}`));
	assert.match(repaired.content[0].text, /Report normalised: version "1" → 1/);
	assert.equal(orch.store.require(taskId).validatorReports.length, 1);

	// an already-valid validator report gets no Report normalised: line
	await orch.beginDelegation(
		{
			toolCallId: "call-l3-v3b",
			input: { agent: "oracle", task: JSON.stringify(specFor(taskId, "validator", BASE)) },
		},
		BASE,
	);
	const validReport = reportFor(taskId, "call-l3-v3b");
	validReport.evidence = { ...validReport.evidence, cwd: BASE };
	const clean = await orch.handleSubagentResult(workerResult("call-l3-v3b", validReport));
	assert.ok(clean.content[0].text.startsWith(`[PLANNER-ONLY] Validator result for task ${taskId}`));
	assert.doesNotMatch(clean.content[0].text, /Report normalised:/);
	assert.equal(orch.store.require(taskId).validatorReports.length, 2);
}

// L-3: no resolvable Task — warning only; later result is the unknown-task path
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
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

// R15/T4 finding: a worker that guesses gitStatusHash and workerRunId is accepted with fresh evidence
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-234";
	await delegateWorker(orch, "call-t4-guess", taskId);
	const base = reportFor(taskId, "call-t4-guess");
	const guessed = {
		...base,
		evidence: {
			...base.evidence,
			workerRunId: "call-914-explore-unbound",
			gitStatusHash: "uncommitted worktree changes only; nothing staged or committed",
		},
	};
	const outcome = await orch.handleSubagentResult(workerResult("call-t4-guess", guessed));
	const text = outcome.content[0].text;
	assert.doesNotMatch(text, /failed the task identity check/);
	assert.doesNotMatch(text, /working tree changed since the report/);
	assert.match(text, /Report normalised: .*workerRunId "call-914-explore-unbound" → call-t4-guess/);
	const task = orch.store.require(taskId);
	assert.equal(task.reports.length, 1);
	assert.equal(task.reports[0].evidence.workerRunId, "call-t4-guess");
	// the guessed hash is dropped; the stored binding is Root's own report-time sample
	assert.equal(task.reports[0].evidence.gitStatusHash, cleanHash);
	assert.equal(task.state, "reviewing");
}

// renderTaskStatus lists validator reports when present, omits the line when absent
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-235";
	await delegateWorker(orch, "call-validator-status", taskId);
	const withoutValidator = orch.renderTaskStatus(orch.store.require(taskId));
	assert.doesNotMatch(withoutValidator, /Validator reports:/);

	await orch.store.recordValidatorReport(taskId, reportFor(taskId, "call-validator-status"));
	const withValidator = orch.renderTaskStatus(orch.store.require(taskId));
	assert.match(withValidator, /Validator reports: 1/);
	const lines = withValidator.split("\n");
	const changedIndex = lines.findIndex((line) => line.startsWith("Changed files:"));
	assert.equal(lines[changedIndex + 1], "Validator reports: 1");
}

// --------------------------------------------------------------------------
// I-1 — compress Root-facing worker result; no reviewer template
// --------------------------------------------------------------------------

const t6TwoPathStatus = [
	"1 .M N... 100644 100644 100644 1111111 2222222 orchestrate.ts",
	"1 .M N... 100644 100644 100644 1111111 3333333 orchestrate.test.mjs",
	"",
].join("\n");

function specT6(taskId) {
	return {
		...specFor(taskId, "worker", BASE),
		scope: { allowedPaths: ["orchestrate.ts", "orchestrate.test.mjs"] },
	};
}

function reportT6(taskId) {
	return {
		version: 1,
		taskId,
		status: "completed",
		summary: "handleValidatorResult now echoes `Report normalised: <repairs joined by \"; \">` immediately after the recorded line when extracted.repairs is non-empty (mirroring handleWorkerResult); added one orchestrate.test.mjs block covering a version-\"1\" repaired validator report (line present) and an already-valid one (line absent).",
		changedFiles: ["orchestrate.ts", "orchestrate.test.mjs"],
		validation: [
			{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "All 13 suites PASS including orchestration; new L-1 validator normalisation test passes." },
			{ command: "npm run typecheck", type: "typecheck", status: "passed", exitCode: 0, summary: "tsc --noEmit clean." },
		],
		evidence: {
			cwd: BASE,
			taskId,
			gitStatusHash: "uncommitted working tree: M orchestrate.ts, M orchestrate.test.mjs; nothing staged, nothing committed",
			changedPaths: ["orchestrate.ts", "orchestrate.test.mjs"],
			gitAvailable: true,
			generatedAt: "2026-09-05T10:00:00.000Z",
		},
		risks: [
			"Repair wording for version is `version \"1\" → 1` per report.ts normalizeWorkerReport (formatRaw leaves strings as-is); if repair phrasing changes, the regex must follow.",
			"Test asserts validatorReports length grows to 2 across both sub-cases; harmless, but couples to store shape.",
		],
		unresolved: [],
	};
}

// I-1: T6-shaped accepted worker result is ≤ 2300 UTF-8 bytes and has no reviewer template
{
	const store = new TaskStore({ now: () => new Date(2026, 8, 5) });
	const orch = new PlannerOrchestrator({ store, gitRunner });
	const embeddedId = "T-20260101-001";
	const canonical = "T-20260905-001";
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-i1-t6", input: { task: JSON.stringify(specT6(embeddedId)) } },
		BASE,
	);
	assert.equal(orch.store.require(embeddedId).taskId, canonical);
	gitOverrides.set("status --porcelain=v2 --branch", t6TwoPathStatus);
	gitOverrides.set("diff HEAD --stat", " orchestrate.ts | 2 +-\n orchestrate.test.mjs | 2 +-\n");
	const outcome = await orch.handleSubagentResult(workerResult("call-i1-t6", reportT6(embeddedId)));
	const text = outcome.content[0].text;
	const bytes = Buffer.byteLength(text, "utf8");
	assert.ok(bytes <= 2300, `T6-shaped worker result is ${bytes} UTF-8 bytes`);
	assert.doesNotMatch(text, /Reviewer prompt template for an isolated fresh review:/);
	assert.doesNotMatch(text, /You are an isolated reviewer/);
	assert.doesNotMatch(text, /\[PLANNER-ONLY FRESH REVIEW\]/);
	assert.match(text, /\[PLANNER-ONLY REVIEW STATE\]/);
	assert.match(text, /decision: review_pending/);
	assert.match(text, /evidence: fresh \(attributed 2 paths\)/);
	assert.match(text, /Report normalised:/);
	assert.match(text, /evidence\.gitStatusHash/);
	assert.match(text, /evidence\.workerRunId missing/);
	assert.match(text, /taskId T-20260101-001 → T-20260905-001/);
	assert.match(text, /taskId: T-20260905-001/);
	assert.match(text, /status: completed/);
	assert.match(text, /Summary: handleValidatorResult now echoes/);
	assert.match(text, /orchestrate\.ts/);
	assert.match(text, /orchestrate\.test\.mjs/);
	assert.match(text, /- \[passed\] test: npm test exit 0/);
	assert.match(text, /- \[passed\] typecheck: npm run typecheck exit 0/);
	assert.match(text, /Repair wording for version/);
	assert.match(text, /Unresolved: \(none\)/);
	const stored = orch.store.require(canonical).reports[0];
	assert.equal(stored.taskId, canonical);
	assert.equal(stored.changedFiles.length, 2);
	assert.equal(stored.validation.length, 2);
	assert.equal(stored.risks.length, 2);
	setCleanTree();
}

// --------------------------------------------------------------------------
// I-2 — reactive JSON reminder after the first prose-only report strike
// --------------------------------------------------------------------------

const jsonReminder = (taskId) =>
	`JSON only: {"version":1,"taskId":"${taskId}","status":"completed|partial|blocked|failed","summary":"...","changedFiles":[],"validation":[],"evidence":{"taskId":"${taskId}"},"risks":[],"unresolved":[]}`;
const rawResult = (toolCallId, text) => ({
	toolCallId,
	toolName: "subagent",
	input: {},
	content: [{ type: "text", text }],
	isError: false,
});

// First prose-only strike gets the exact reminder; a valid correction is accepted normally.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-601";
	await delegateWorker(orch, "call-i2-prose", taskId);
	const first = await orch.handleSubagentResult(rawResult("call-i2-prose", "Implemented and tested successfully."));
	assert.match(first.content[0].text, /worker output did not contain a WorkerReport object/);
	assert.ok(first.content[0].text.includes(jsonReminder(taskId)));
	assert.equal(first.content[0].text.split("JSON only:").length - 1, 1);
	assert.equal(orch.store.require(taskId).reportCorrections, 1);

	// Immediately follows the existing report-only correction instruction
	const lines = first.content[0].text.split("\n");
	const instructionIdx = lines.findIndex((l) => l.includes(`Return only a valid WorkerReport for task ${taskId}`));
	assert.ok(instructionIdx >= 0, "instruction line present");
	assert.equal(lines[instructionIdx + 1], jsonReminder(taskId), "reminder immediately follows instruction");

	// Injected bytes accounted for in returned text
	const reminderBytes = Buffer.byteLength(jsonReminder(taskId), "utf8");
	const textBytes = Buffer.byteLength(first.content[0].text, "utf8");
	assert.ok(textBytes >= reminderBytes, `returned text must account for ${reminderBytes} reminder bytes`);
	const withoutReminder = first.content[0].text.replace(`\n${jsonReminder(taskId)}`, "");
	assert.equal(textBytes - Buffer.byteLength(withoutReminder, "utf8"), reminderBytes + 1);

	await orch.beginDelegation(
		{
			toolCallId: "call-i2-corrected",
			input: { agent: "worker", task: `Do not modify files. Return only a valid WorkerReport for task ${taskId}.` },
		},
		BASE,
	);
	const corrected = reportFor(taskId, "call-i2-corrected");
	const accepted = await orch.handleSubagentResult(workerResult("call-i2-corrected", corrected));
	assert.match(accepted.content[0].text, /decision: review_pending/);
	assert.equal(orch.store.require(taskId).reports.length, 1);
}

// Canonical task ID is substituted when task was delegated with an alias
{
	const store = new TaskStore({ now: () => new Date(2026, 8, 5) });
	const orch = new PlannerOrchestrator({ store, gitRunner });
	const aliasId = "T-20260101-001";
	const canonical = "T-20260905-001";
	await orch.beginDelegation(
		{ toolCallId: "call-i2-alias", input: { task: JSON.stringify(specFor(aliasId)) } },
		BASE,
	);
	assert.equal(orch.store.require(aliasId).taskId, canonical);
	const outcome = await orch.handleSubagentResult(rawResult("call-i2-alias", "done implement"));
	assert.ok(outcome.content[0].text.includes(jsonReminder(canonical)));
	assert.doesNotMatch(outcome.content[0].text, new RegExp(aliasId));
}

// Subsequent valid JSON report requiring normalisation is accepted in one pass
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-607";
	await delegateWorker(orch, "call-i2-norm-prose", taskId);
	await orch.handleSubagentResult(rawResult("call-i2-norm-prose", "Prose strike 1"));
	await orch.beginDelegation(
		{
			toolCallId: "call-i2-norm-fix",
			input: { agent: "worker", task: `Do not modify files. Return only a valid WorkerReport for task ${taskId}.` },
		},
		BASE,
	);
	const normalisable = {
		version: "1",
		taskId,
		status: "done",
		summary: "Normalized fix",
		changed_files: ["src/parser.ts"],
		validation: [],
		evidence: { taskId },
		risks: [],
		unresolved: [],
	};
	const outcome = await orch.handleSubagentResult(workerResult("call-i2-norm-fix", normalisable));
	assert.match(outcome.content[0].text, /Report normalised:/);
	assert.match(outcome.content[0].text, /status "done" → completed/);
	assert.match(outcome.content[0].text, /decision: review_pending/);
	assert.equal(orch.store.require(taskId).reports.length, 1);
}

// Empty output, whitespace, and parseable-but-invalid JSON do not get the prose-only reminder.
for (const [suffix, output] of [
	["empty", ""],
	["whitespace", "   \n\t  "],
	["invalid", JSON.stringify({ taskId: "T-20260905-603", status: "unknown" })],
	["invalid-schema", JSON.stringify({ taskId: "T-20260905-603", status: "completed", validation: "not-array" })],
]) {
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = suffix.startsWith("empty") || suffix === "whitespace" ? "T-20260905-602" : "T-20260905-603";
	const callId = `call-i2-${suffix}`;
	await delegateWorker(orch, callId, taskId);
	const outcome = await orch.handleSubagentResult(rawResult(callId, output));
	assert.doesNotMatch(outcome.content[0].text, /JSON only:/);
}

// Identity rejection is not a prose-only strike.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-604";
	await delegateWorker(orch, "call-i2-identity", taskId);
	const report = reportFor(taskId, "call-i2-identity");
	report.evidence.taskId = "T-OTHER";
	const outcome = await orch.handleSubagentResult(workerResult("call-i2-identity", report));
	assert.match(outcome.content[0].text, /identity|evidence\.taskId/);
	assert.doesNotMatch(outcome.content[0].text, /JSON only:/);
}

// A second prose-only strike has exhausted the correction budget and gets no reminder.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-605";
	await delegateWorker(orch, "call-i2-first", taskId);
	await orch.handleSubagentResult(rawResult("call-i2-first", "first prose result"));
	await orch.beginDelegation(
		{
			toolCallId: "call-i2-second",
			input: { agent: "worker", task: `Do not modify files. Return only a valid WorkerReport for task ${taskId}.` },
		},
		BASE,
	);
	const second = await orch.handleSubagentResult(rawResult("call-i2-second", "second prose result"));
	assert.equal(orch.store.require(taskId).state, "blocked");
	assert.doesNotMatch(second.content[0].text, /JSON only:/);
}

// Validator and reviewer malformed output retain their own paths and never get the worker reminder.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-606";
	await delegateWorker(orch, "call-i2-base", taskId);
	await orch.handleSubagentResult(workerResult("call-i2-base", reportFor(taskId, "call-i2-base")));

	await orch.beginDelegation(
		{ toolCallId: "call-i2-validator", input: { agent: "oracle", task: `Validate task ${taskId}` } },
		BASE,
	);
	const validator = await orch.handleSubagentResult(rawResult("call-i2-validator", "validator prose"));
	assert.match(validator.content[0].text, /Validator output/);
	assert.doesNotMatch(validator.content[0].text, /JSON only:/);

	await orch.beginDelegation(
		{ toolCallId: "call-i2-reviewer", input: { agent: "reviewer", task: `Review task ${taskId}` } },
		BASE,
	);
	const reviewer = await orch.handleSubagentResult(rawResult("call-i2-reviewer", "reviewer prose"));
	assert.match(reviewer.content[0].text, /Reviewer output/);
	assert.doesNotMatch(reviewer.content[0].text, /JSON only:/);
}

// --------------------------------------------------------------------------
// Ticket 02 — the PASS boundary refuses content drift, in a real Git repo
// --------------------------------------------------------------------------

function realGitRunnerOf(dir) {
	return async (args, cwd) => {
		const r = spawnSync("git", ["-C", cwd || dir, ...args], { encoding: "utf8" });
		return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? 1 };
	};
}

// E01 at the acceptance boundary: dirty file content changes after the report
// with identical status/HEAD — PASS must revalidate, not complete.
{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-passbound-"));
	const git = (...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	try {
		git("init", "-q");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		writeFileSync(join(dir, "tracked.txt"), "base\n");
		git("add", ".");
		git("commit", "-m", "base", "-q");

		const runner = realGitRunnerOf(dir);
		const orch = new PlannerOrchestrator({ gitRunner: runner, store: pinnedStore() });
		const spec = { ...specFor("T-20260905-960"), cwd: dir };
		await orch.beginDelegation(
			{ toolCallId: "call-pb-1", input: { task: JSON.stringify(spec) } },
			BASE,
		);
		writeFileSync(join(dir, "tracked.txt"), "worker edit\n");
		const outcome = await orch.handleSubagentResult(workerResult("call-pb-1", {
			version: 1,
			taskId: "T-20260905-960",
			status: "completed",
			summary: "edited tracked.txt",
			changedFiles: ["tracked.txt"],
			validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
			evidence: { cwd: dir, taskId: "T-20260905-960", workerRunId: "call-pb-1", changedPaths: ["tracked.txt"], gitAvailable: true, generatedAt: new Date().toISOString() },
			risks: [],
			unresolved: [],
		}));
		assert.match(outcome.content[0].text, /decision: review_pending/);

		// same porcelain status, different bytes: a fake-fresh PASS must not accept
		writeFileSync(join(dir, "tracked.txt"), "external edit\n");
		const verdict = await orch.recordRootVerdict(orch.store.require("T-20260905-960"), "pass", "accepting");
		assert.equal(verdict.decision.action, "revalidate");
		assert.match(verdict.decision.reason, /content changed since the report/);
		assert.equal(verdict.task.state, "changes_requested");
		assert.notEqual(verdict.task.state, "completed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// E06 at the acceptance boundary: a status probe failure is unknown — PASS revalidates.
{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-passbound-"));
	const git = (...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	try {
		git("init", "-q");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		writeFileSync(join(dir, "tracked.txt"), "base\n");
		git("add", ".");
		git("commit", "-m", "base", "-q");

		let failStatus = false;
		const runner = async (args, cwd) => {
			if (failStatus && args[0] === "status") return { stdout: "", stderr: "fatal: hung", code: 128 };
			return realGitRunnerOf(dir)(args, cwd);
		};
		const orch = new PlannerOrchestrator({ gitRunner: runner, store: pinnedStore() });
		const spec = { ...specFor("T-20260905-961"), cwd: dir };
		await orch.beginDelegation(
			{ toolCallId: "call-pb-2", input: { task: JSON.stringify(spec) } },
			BASE,
		);
		writeFileSync(join(dir, "tracked.txt"), "worker edit\n");
		await orch.handleSubagentResult(workerResult("call-pb-2", {
			version: 1,
			taskId: "T-20260905-961",
			status: "completed",
			summary: "edited tracked.txt",
			changedFiles: ["tracked.txt"],
			validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
			evidence: { cwd: dir, taskId: "T-20260905-961", workerRunId: "call-pb-2", changedPaths: ["tracked.txt"], gitAvailable: true, generatedAt: new Date().toISOString() },
			risks: [],
			unresolved: [],
		}));

		failStatus = true;
		const verdict = await orch.recordRootVerdict(orch.store.require("T-20260905-961"), "pass", "accepting");
		assert.equal(verdict.decision.action, "revalidate");
		assert.match(verdict.decision.reason, /git status probe failed/);
		assert.equal(verdict.task.state, "changes_requested");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// --------------------------------------------------------------------------
// Ticket 03 — all writable Delegations share one write lock
// --------------------------------------------------------------------------

// Two concurrent writable delegations on the same worktree (one via a symlink
// alias): only one obtains the lock; the loser never reaches executing and
// registers no delegation.
{
	const real = mkdtempSync(join(process.cwd(), ".planner-only-wlock-"));
	const aliasParent = mkdtempSync(join(process.cwd(), ".planner-only-wlock-"));
	const alias = join(aliasParent, "wt");
	symlinkSync(real, alias);
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	try {
		setCleanTree();
		const first = await orch.beginDelegation(
			{ toolCallId: "call-wl-1", input: { task: JSON.stringify(specFor("T-20260905-970", "worker", real)) } },
			BASE,
		);
		assert.equal(first.conflict, undefined);
		assert.equal(orch.store.require("T-20260905-970").state, "executing");

		const second = await orch.beginDelegation(
			{ toolCallId: "call-wl-2", input: { task: JSON.stringify(specFor("T-20260905-971", "worker", alias)) } },
			BASE,
		);
		assert.equal(second.conflict?.conflict, true, "symlink alias of a locked worktree must conflict");
		assert.match(second.conflict.reason, /T-20260905-970/);
		assert.equal(orch.store.get("T-20260905-971")?.state, "planning", "no executing state for the loser");
		assert.equal(orch.pendingDelegationCount(), 1, "the loser registers no delegation");
	} finally {
		rmSync(real, { recursive: true, force: true });
		rmSync(aliasParent, { recursive: true, force: true });
	}
}

// A second writable delegation for the same Task while the first is live still
// goes through invocation-level conflict detection.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-wl-3", input: { task: JSON.stringify(specFor("T-20260905-972")) } },
		BASE,
	);
	const again = await orch.beginDelegation(
		{ toolCallId: "call-wl-4", input: { task: JSON.stringify(specFor("T-20260905-972")) } },
		BASE,
	);
	assert.equal(again.conflict?.conflict, true, "same-Task re-entry is not a free pass");
	assert.equal(orch.pendingDelegationCount(), 1);
}

// Warn-mode workers without a TaskSpec still take the write lock.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	setCleanTree();
	const first = await orch.beginDelegation(
		{ toolCallId: "call-wl-5", input: { agent: "worker", task: "no spec attached" } },
		BASE,
	);
	assert.ok(first.task);
	assert.equal(first.task.state, "executing");
	const second = await orch.beginDelegation(
		{ toolCallId: "call-wl-6", input: { agent: "worker", task: "also no spec" } },
		BASE,
	);
	assert.equal(second.conflict?.conflict, true, "unstructured workers contend for the lock");
	assert.equal(orch.pendingDelegationCount(), 1);
}

// A validator (general shell) is writable: it is refused while a worker holds
// the same worktree, even though it carries no edit/write tools.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-wl-7", input: { task: JSON.stringify(specFor("T-20260905-973")) } },
		BASE,
	);
	const validator = await orch.beginDelegation(
		{ toolCallId: "call-wl-8", input: { agent: "oracle", task: JSON.stringify(specFor("T-20260905-973", "validator")) } },
		BASE,
	);
	assert.equal(validator.conflict?.conflict, true, "shell-capable validators take the write lock");
	assert.equal(orch.pendingDelegationCount(), 1);
}

// A validator delegated through an alias of the locked worktree collides too (D06).
{
	const real = mkdtempSync(join(process.cwd(), ".planner-only-wlock-"));
	const aliasParent = mkdtempSync(join(process.cwd(), ".planner-only-wlock-"));
	const alias = join(aliasParent, "wt");
	symlinkSync(real, alias);
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	try {
		setCleanTree();
		await orch.beginDelegation(
			{ toolCallId: "call-wl-9", input: { task: JSON.stringify(specFor("T-20260905-974", "worker", real)) } },
			BASE,
		);
		const validator = await orch.beginDelegation(
			{ toolCallId: "call-wl-10", input: { agent: "oracle", cwd: alias, task: JSON.stringify(specFor("T-20260905-974", "validator")) } },
			BASE,
		);
		assert.equal(validator.conflict?.conflict, true, "an alias of the locked worktree collides for the invocation cwd");
	} finally {
		rmSync(real, { recursive: true, force: true });
		rmSync(aliasParent, { recursive: true, force: true });
	}
}

// --------------------------------------------------------------------------
// Ticket 09 — the write lock outlives stale executing until the child is known stopped
// --------------------------------------------------------------------------

// A stale executing holder still blocks a second writable delegation, and the
// conflict reason demands reconciliation; after the run reconciles, the lock frees.
{
	let clock = new Date(2026, 8, 5, 12, 0, 0);
	const store = new TaskStore({ now: () => clock });
	const orch = new PlannerOrchestrator({ gitRunner, store });
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-t9-1", input: { task: JSON.stringify(specFor("T-20260905-980")) } },
		BASE,
	);
	clock = new Date(2026, 8, 5, 13, 0, 0); // one hour later: past EXECUTING_STALE_MS
	assert.equal(isExecutingStale(orch.store.require("T-20260905-980"), clock.getTime()), true);
	const second = await orch.beginDelegation(
		{ toolCallId: "call-t9-2", input: { task: JSON.stringify(specFor("T-20260905-981", "worker", "/fixture/T-20260905-980")) } },
		BASE,
	);
	assert.equal(second.conflict?.conflict, true, "stale executing must keep blocking");
	assert.match(second.conflict.reason, /not been confirmed exited/);
	// the needs-reconcile note is recorded through the Task store, not in place
	assert.match(
		orch.store.require("T-20260905-980").stateReason ?? "",
		/needs reconcile: executing past the stale duration/,
		"the stale holder's needs-reconcile note is recorded on the holder Task",
	);

	// the child run turns out terminal: reconcile consumes it and the lock frees
	const runId = "run-t9-1";
	const layout = artifactLayout(runId, "worker", 0, reportFor("T-20260905-980", "call-t9-1"));
	await orch.handleSubagentResult(receiptFor("call-t9-1", runId, layout.asyncDir));
	setDirtyTree();
	const consumed = await orch.reconcilePendingDelegations("T-20260905-980");
	assert.equal(consumed, 1);
	assert.equal(orch.store.require("T-20260905-980").state, "reviewing");
	const third = await orch.beginDelegation(
		{ toolCallId: "call-t9-3", input: { task: JSON.stringify(specFor("T-20260905-981", "worker", "/fixture/T-20260905-980")) } },
		BASE,
	);
	assert.equal(third.conflict, undefined, "a reconciled holder no longer blocks");
	rmSync(layout.tmp, { recursive: true, force: true });
}

// An error event for a live async child keeps the lock; only artifacts (or the
// blocked escape hatch) move things forward. Confirmed start failure still unlocks.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-982";
	const runId = "run-t9-2";
	const tmp = mkdtempSync(join(process.cwd(), ".planner-only-t9-"));
	const asyncDir = join(tmp, "async-subagent-runs", runId);
	mkdirSync(asyncDir, { recursive: true });
	try {
		await delegateWorker(orch, "call-t9-4", taskId);
		await orch.handleSubagentResult(receiptFor("call-t9-4", runId, asyncDir));
		const outcome = await orch.handleSubagentResult({
			toolCallId: "call-t9-4",
			toolName: "subagent",
			isError: true,
			content: [{ type: "text", text: "child crashed, maybe" }],
		});
		assert.match(outcome.content[0].text, /not been confirmed stopped/);
		assert.equal(orch.pendingDelegationCount(), 1, "lock stays held for the unconfirmed child");
		assert.equal(orch.store.require(taskId).state, "executing");
		// blocked stays available as the escape hatch
		assert.equal(orch.rootVerdictRefusal(orch.store.require(taskId), "blocked"), undefined);

		// artifacts later show a terminal exit: reconcile consumes the run
		writeFileSync(join(tmp, "artifacts-meta.json"), JSON.stringify({ runId, agent: "worker", exitCode: 0 }));
		mkdirSync(join(tmp, "artifacts"), { recursive: true });
		rmSync(join(tmp, "artifacts-meta.json"));
		writeFileSync(join(tmp, "artifacts", `${runId}_worker_meta.json`), JSON.stringify({ runId, agent: "worker", exitCode: 1 }));
		mkdirSync(join(tmp, "artifacts", "outputs", runId), { recursive: true });
		writeFileSync(join(tmp, "artifacts", "outputs", runId, "result.json"), "no report here");
		assert.equal(await orch.reconcilePendingDelegations(), 1);
		assert.equal(orch.pendingDelegationCount(), 0);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

// Unlock is idempotent when completion and an error both arrive.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-983";
	await delegateWorker(orch, "call-t9-5", taskId);
	await orch.handleSubagentResult(workerResult("call-t9-5", reportFor(taskId, "call-t9-5")));
	assert.equal(orch.pendingDelegationCount(), 0);
	const late = await orch.handleSubagentResult({
		toolCallId: "call-t9-5",
		toolName: "subagent",
		isError: true,
		content: [{ type: "text", text: "late cancel signal" }],
	});
	assert.equal(late, undefined, "a second event for a consumed delegation is a no-op");
	assert.equal(orch.store.require(taskId).state, "reviewing");
}

// --------------------------------------------------------------------------
// Ticket 07 — same-Task re-delegation supersedes leftover pending children
// --------------------------------------------------------------------------

// A re-delegation while a leftover waiter's child is not known stopped is
// refused (the waiter keeps the lock); once the operator abandons the Task, the
// next delegation supersedes the leftover, a late notice for it is ignored, and
// the new run's notice still matches.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-990";
	await delegateWorker(orch, "call-t7-1", taskId);
	await orch.handleSubagentResult(workerResult("call-t7-1", reportFor(taskId, "call-t7-1")));

	// first re-delegation goes async; its notice is lost (zombie waiter)
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-t7-2", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	await orch.handleSubagentResult(receiptFor("call-t7-2", "run-t7-zombie", "/no-such-async-dir"));
	assert.equal(orch.pendingDelegationCount(), 1);

	// the next re-delegation is refused: the leftover waiter's child is not
	// known stopped, so supersede must not launch a second live writer
	const redo = await orch.beginDelegation(
		{ toolCallId: "call-t7-3", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.equal(redo.conflict?.conflict, true, "a leftover waiter that is not known stopped keeps the lock");
	assert.match(redo.conflict.reason, /T-20260905-990/, "the refusal names the holder Task");
	assert.equal(orch.pendingDelegationCount(), 1, "no second waiter beside a live writer");
	assert.ok(orch.getDelegation("call-t7-2"), "the leftover waiter is kept, not superseded");

	// the operator's escape hatch stays open while the child is unconfirmed;
	// abandoning the Task is a known stop and releases the lock, after which
	// the next delegation supersedes the leftover so notices stay unambiguous
	assert.equal(orch.rootVerdictRefusal(orch.store.require(taskId), "blocked"), undefined);
	orch.store.abandon(taskId, "operator abandon");
	const retry = await orch.beginDelegation(
		{ toolCallId: "call-t7-4", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.equal(retry.conflict, undefined, "operator abandon releases the lock");
	assert.ok((retry.warnings ?? []).some((warning) => /supersedes the pending child run/.test(warning)), retry.warnings?.join(" | "));
	assert.equal(orch.pendingDelegationCount(), 1, "at most one waiter per Task");
	assert.equal(orch.getDelegation("call-t7-2"), undefined);

	// a late notice for the superseded run records nothing
	const beforeReports = orch.store.require(taskId).reports.length;
	const beforeState = orch.store.require(taskId).state;
	const late = await orch.handleAsyncNotify(asyncNotify("run-t7-zombie", JSON.stringify(reportFor(taskId, "call-t7-2"))));
	assert.equal(late, undefined);
	assert.equal(orch.store.require(taskId).reports.length, beforeReports);
	assert.equal(orch.store.require(taskId).state, beforeState);

	// a single-run completion notice naming the Task matches the one waiter
	setDirtyTree();
	await orch.handleSubagentResult(receiptFor("call-t7-4", "run-t7-4", "/no-such-async-dir"));
	const outcome = await orch.handleAsyncNotify(asyncNotify(undefined, JSON.stringify(reportFor(taskId, "call-t7-4"))));
	assert.match(outcome.content[0].text, /\[PLANNER-ONLY REVIEW STATE\]/);
	assert.equal(orch.store.require(taskId).reports.length, beforeReports + 1);
	assert.equal(orch.pendingDelegationCount(), 0);
}

// A superseded record whose run already finished is reconciled, not discarded.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-991";
	await delegateWorker(orch, "call-t7-4", taskId);
	await orch.handleSubagentResult(workerResult("call-t7-4", reportFor(taskId, "call-t7-4")));

	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-t7-5", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	const runId = "run-t7-5";
	const layout = artifactLayout(runId, "worker", 0, reportFor(taskId, "call-t7-5"));
	await orch.handleSubagentResult(receiptFor("call-t7-5", runId, layout.asyncDir));

	// the older run finished; the re-delegation must consume its report first
	const redo = await orch.beginDelegation(
		{ toolCallId: "call-t7-6", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.ok((redo.warnings ?? []).some((warning) => /had already finished/.test(warning)), redo.warnings?.join(" | "));
	assert.equal(orch.store.require(taskId).reports.length, 2, "the finished older run is consumed, not discarded");
	assert.equal(orch.pendingDelegationCount(), 1);
	rmSync(layout.tmp, { recursive: true, force: true });
}

// Reviewer re-delegation supersedes a pending reviewer; a late verdict for the
// superseded invocation is not applied.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-992";
	await delegateWorker(orch, "call-t7-7", taskId);
	await orch.handleSubagentResult(workerResult("call-t7-7", reportFor(taskId, "call-t7-7")));

	await orch.beginDelegation(
		{ toolCallId: "call-t7-8", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	await orch.beginDelegation(
		{ toolCallId: "call-t7-9", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	assert.equal(orch.pendingDelegationCount(), 1, "one reviewer waiter remains");
	assert.equal(orch.getDelegation("call-t7-8"), undefined);

	const staleVerdict = await orch.handleSubagentResult(reviewerResult("call-t7-8", taskId, "pass", { workspaceDigest: orch.store.require(taskId).snapshot?.digest }));
	assert.equal(staleVerdict, undefined, "the superseded invocation records nothing");
	await orch.beginDelegation(
		{ toolCallId: "call-t7-10", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
}

// --------------------------------------------------------------------------
// Ticket 04 — the reviewer packet carries the bounded baseline patch
// --------------------------------------------------------------------------

{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-995";
	await delegateWorker(orch, "call-t4-packet", taskId);
	await orch.handleSubagentResult(workerResult("call-t4-packet", reportFor(taskId, "call-t4-packet")));

	// the baseline is the delegation-time A sample (abc1234); give the packet a patch
	gitOverrides.set(
		"diff --patch --no-ext-diff --no-textconv abc1234",
		[
			"diff --git a/src/parser.ts b/src/parser.ts",
			"index 1111111..2222222 100644",
			"--- a/src/parser.ts",
			"+++ b/src/parser.ts",
			"@@ -1,2 +1,2 @@",
			"-const old = 1;",
			"+const fresh = 1;",
			"",
		].join("\n"),
	);
	gitOverrides.set("diff --numstat --no-ext-diff --no-textconv abc1234", "1\t1\tsrc/parser.ts\n");
	const reviewerInput = { agent: "worker", task: JSON.stringify(specFor(taskId, "reviewer")) };
	try {
		await orch.prepareRoleDelegation(reviewerInput);
		assert.equal(reviewerInput.agent, "reviewer");
		assert.ok(reviewerInput.task.includes("+const fresh = 1;"), "the reviewer sees the patch content");
		assert.ok(reviewerInput.task.includes('"baselineRef": "abc1234"'), "the packet names the Task baseline");
		assert.ok(reviewerInput.task.includes('"patchReturnedFiles": 1'), "completeness counts travel with the packet");
		assert.ok(reviewerInput.task.includes("Never treat a partial packet as a complete review"), "the prompt carries the truncation duty");
	} finally {
		gitOverrides.delete("diff --patch --no-ext-diff --no-textconv abc1234");
		gitOverrides.delete("diff --numstat --no-ext-diff --no-textconv abc1234");
	}
}

// --------------------------------------------------------------------------
// Ticket 08 — a reviewer PASS cannot accept a newer WorkerReport
// --------------------------------------------------------------------------

// A stale reviewer PASS (revision N while N+1 exists) is refused, not recorded,
// and Root's fresh-mode arbitration does not inherit it.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-996";
	await delegateWorker(orch, "call-t8-1", taskId);
	await orch.handleSubagentResult(workerResult("call-t8-1", reportFor(taskId, "call-t8-1")));
	orch.store.setReviewMode(taskId, "fresh");

	// a new WorkerReport N+1 is recorded
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-t8-2", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	setDirtyTree();
	await orch.handleSubagentResult(workerResult("call-t8-2", reportFor(taskId, "call-t8-2")));
	assert.equal(orch.store.require(taskId).reports.length, 2);

	// the review is delegated against N+1, but the reviewer returns a PASS for
	// the stored revision N: it must not complete the Task
	await orch.beginDelegation(
		{ toolCallId: "call-t8-1r", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	const stale = await orch.handleSubagentResult(
		reviewerResult("call-t8-1r", taskId, "pass", { reportRevision: 1, workspaceDigest: orch.store.require(taskId).snapshot?.digest }),
	);
	assert.match(stale.content[0].text, /reportRevision mismatch/);
	assert.equal(orch.store.require(taskId).reviews.length, 0, "the stale PASS is not recorded");
	assert.equal(orch.store.require(taskId).state, "reviewing", "the Task does not complete");
	assert.match(
		orch.rootVerdictRefusal(orch.store.require(taskId), "pass"),
		/no reviewer ReviewResult exists yet/,
		"Root does not inherit the stale reviewer PASS as current",
	);
}

// A ReviewResult whose workspace digest does not match the latest report is refused.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-997";
	await delegateWorker(orch, "call-t8-3", taskId);
	await orch.handleSubagentResult(workerResult("call-t8-3", reportFor(taskId, "call-t8-3")));
	await orch.beginDelegation(
		{ toolCallId: "call-t8-3r", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	const mismatched = await orch.handleSubagentResult(
		reviewerResult("call-t8-3r", taskId, "pass", { workspaceDigest: "0123456789abcdef" }),
	);
	assert.match(mismatched.content[0].text, /workspaceDigest mismatch/);
	assert.equal(orch.store.require(taskId).reviews.length, 0);
	assert.equal(orch.store.require(taskId).state, "reviewing");
}

// A pass that names no revision or digest at all is refused, not defaulted.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-998";
	await delegateWorker(orch, "call-t8-4", taskId);
	await orch.handleSubagentResult(workerResult("call-t8-4", reportFor(taskId, "call-t8-4")));
	await orch.beginDelegation(
		{ toolCallId: "call-t8-4r", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	const unbound = await orch.handleSubagentResult({
		toolCallId: "call-t8-4r",
		toolName: "subagent",
		input: {},
		content: [{ type: "text", text: JSON.stringify({ taskId, verdict: "pass", summary: "unbound pass", evidenceFresh: true, findings: [] }) }],
		isError: false,
	});
	assert.match(unbound.content[0].text, /missing reportRevision/);
	assert.match(unbound.content[0].text, /missing workspaceDigest/);
	assert.equal(orch.store.require(taskId).reviews.length, 0);
}

// A well-formed ReviewResult matching task, revision, and digest is still recorded.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-999";
	await delegateWorker(orch, "call-t8-5", taskId);
	await orch.handleSubagentResult(workerResult("call-t8-5", reportFor(taskId, "call-t8-5")));
	await orch.beginDelegation(
		{ toolCallId: "call-t8-5r", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	const outcome = await orch.handleSubagentResult(reviewerResult("call-t8-5r", taskId, "pass", { workspaceDigest: orch.store.require(taskId).snapshot?.digest }));
	assert.match(outcome.content[0].text, /decision: accept/);
	assert.equal(orch.store.require(taskId).state, "completed");
	assert.equal(orch.store.require(taskId).reviews.at(-1).reportRevision, 1);
}

// --------------------------------------------------------------------------
// Ticket 10 — the workspace snapshot is the freshness basis for PASS
// --------------------------------------------------------------------------

// A pre-snapshot report (no snapshot bound) cannot complete via PASS.
{
	const store = new TaskStore({ now: () => new Date(2026, 8, 5) });
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const taskId = "T-20260905-994";
	const task = store.create(createTaskSpec({ objective: "legacy", cwd: BASE }), undefined);
	store.transition(task.taskId, "executing");
	store.recordReport(task.taskId, reportFor(taskId, "call-t10-0"));
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "accepting legacy");
	assert.equal(outcome.decision.action, "revalidate");
	assert.match(outcome.decision.reason, /pre-snapshot report/);
	assert.match(outcome.decision.reason, /a new report is required/);
	assert.notEqual(outcome.task.state, "completed");
}

// A ReviewResult naming a stale workspace digest cannot complete the Task.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-993";
	await delegateWorker(orch, "call-t10-1", taskId);
	await orch.handleSubagentResult(workerResult("call-t10-1", reportFor(taskId, "call-t10-1")));
	await orch.beginDelegation(
		{ toolCallId: "call-t10-1r", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	const staleDigest = await orch.handleSubagentResult(
		reviewerResult("call-t10-1r", taskId, "pass", { workspaceDigest: "ffffffffffffffff" }),
	);
	assert.match(staleDigest.content[0].text, /workspaceDigest mismatch/);
	assert.equal(orch.store.require(taskId).state, "reviewing");
	assert.equal(orch.store.require(taskId).reviews.length, 0);
}

// In a real repo: an mtime-only touch does not block PASS; deleting an
// in-scope file after the report does.
{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-snapbound-"));
	const git = (...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	try {
		git("init", "-q");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		writeFileSync(join(dir, "tracked.txt"), "base\n");
		git("add", ".");
		git("commit", "-m", "base", "-q");

		const runner = realGitRunnerOf(dir);
		const orch = new PlannerOrchestrator({ gitRunner: runner, store: pinnedStore() });
		const spec = { ...specFor("T-20260905-989"), cwd: dir, scope: { allowedPaths: ["tracked.txt"] } };
		await orch.beginDelegation(
			{ toolCallId: "call-t10-2", input: { task: JSON.stringify(spec) } },
			BASE,
		);
		writeFileSync(join(dir, "tracked.txt"), "worker edit\n");
		await orch.handleSubagentResult(workerResult("call-t10-2", {
			version: 1,
			taskId: "T-20260905-989",
			status: "completed",
			summary: "edited tracked.txt",
			changedFiles: ["tracked.txt"],
			validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
			evidence: { cwd: dir, taskId: "T-20260905-989", workerRunId: "call-t10-2", changedPaths: ["tracked.txt"], gitAvailable: true, generatedAt: new Date().toISOString() },
			risks: [],
			unresolved: [],
		}));

		// mtime-only change: the snapshot digest holds, PASS accepts
		const later = new Date(Date.now() + 60_000);
		utimesSync(join(dir, "tracked.txt"), later, later);
		const freshVerdict = await orch.recordRootVerdict(orch.store.require("T-20260905-989"), "pass", "mtime only");
		assert.equal(freshVerdict.decision.action, "accept", "mtime-only drift must not block PASS");
		assert.equal(freshVerdict.task.state, "completed");

		// start over: a new report, then an in-scope file disappears before PASS
		await orch.beginDelegation(
			{ toolCallId: "call-t10-3", input: { task: JSON.stringify({ ...spec, taskId: "T-20260905-988" }) } },
			BASE,
		);
		writeFileSync(join(dir, "tracked.txt"), "worker edit again\n");
		await orch.handleSubagentResult(workerResult("call-t10-3", {
			version: 1,
			taskId: "T-20260905-988",
			status: "completed",
			summary: "edited tracked.txt",
			changedFiles: ["tracked.txt"],
			validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
			evidence: { cwd: dir, taskId: "T-20260905-988", workerRunId: "call-t10-3", changedPaths: ["tracked.txt"], gitAvailable: true, generatedAt: new Date().toISOString() },
			risks: [],
			unresolved: [],
		}));
		rmSync(join(dir, "tracked.txt"));
		const staleVerdict = await orch.recordRootVerdict(orch.store.require("T-20260905-988"), "pass", "accepting a deletion");
		assert.equal(staleVerdict.decision.action, "revalidate");
		assert.ok(
			staleVerdict.decision.reason.includes("workspace snapshot changed since the report")
			|| staleVerdict.decision.reason.includes("content changed since the report"),
			staleVerdict.decision.reason,
		);
		assert.notEqual(staleVerdict.task.state, "completed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

console.log("planner-only orchestration: PASS");

// --------------------------------------------------------------------------
// Ticket 01 — a lost child completion no longer deadlocks Task verdicts
// --------------------------------------------------------------------------

// Real pi-subagents layout: asyncDir = <root>/async-subagent-runs/<id>, saved
// output = <root>/artifacts/outputs/<id>/…, meta = <root>/artifacts/<id>_<agent>_meta.json.
function artifactLayout(runId, agent, exitCode, report) {
	const tmp = mkdtempSync(join(process.cwd(), ".planner-only-reconcile-"));
	const asyncDir = join(tmp, "async-subagent-runs", runId);
	mkdirSync(asyncDir, { recursive: true });
	mkdirSync(join(tmp, "artifacts", "outputs", runId), { recursive: true });
	if (report) writeFileSync(join(tmp, "artifacts", "outputs", runId, "result.json"), JSON.stringify(report));
	writeFileSync(join(tmp, "artifacts", `${runId}_${agent}_meta.json`), JSON.stringify({ runId, agent, exitCode }));
	return { tmp, asyncDir };
}

function receiptFor(toolCallId, runId, asyncDir) {
	return {
		toolCallId,
		toolName: "subagent",
		details: { asyncId: runId, runId, asyncDir },
		content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
	};
}

// A terminal child run is consumed at the verdict boundary instead of refusing forever.
{
	const taskId = "T-20260905-950";
	const runId = "run-rec-1";
	const layout = artifactLayout(runId, "worker", 0, reportFor(taskId, "call-rec-1"));
	const orch = new PlannerOrchestrator({
		gitRunner,
		store: pinnedStore(),
		artifactDirs: () => [join(layout.tmp, "artifacts")],
	});
	try {
		await delegateWorker(orch, "call-rec-1", taskId);
		await orch.handleSubagentResult(workerResult("call-rec-1", reportFor(taskId, "call-rec-1")));
		// a re-delegation goes async; its completion notice is never delivered
		setCleanTree();
		await orch.beginDelegation(
			{ toolCallId: "call-rec-1b", input: { task: JSON.stringify(specFor(taskId)) } },
			BASE,
		);
		await orch.handleSubagentResult(receiptFor("call-rec-1b", runId, layout.asyncDir));
		assert.equal(orch.pendingDelegationCount(), 1);
		const pending = orch.store.require(taskId);
		assert.match(orch.rootVerdictRefusal(pending, "pass"), /still pending/);

		// the child finishes its work and exits; only the notice is lost
		setDirtyTree();
		assert.equal(await orch.reconcilePendingDelegations(), 1);
		assert.equal(orch.pendingDelegationCount(), 0);
		assert.equal(orch.store.require(taskId).reports.length, 2);
		assert.equal(orch.store.require(taskId).state, "reviewing");

		// idempotent: a second reconcile pass does not double-apply the run
		assert.equal(await orch.reconcilePendingDelegations(), 0);
		assert.equal(orch.store.require(taskId).reports.length, 2);

		const outcome = await orch.recordRootVerdict(orch.store.require(taskId), "pass", "reconciled then accepted");
		assert.equal(outcome.task.state, "completed");
	} finally {
		rmSync(layout.tmp, { recursive: true, force: true });
	}
}

// recordRootVerdict reconciles on its own: a blocked verdict consumes a finished
// run first (its WorkerReport is kept), then closes the Task as blocked.
{
	const taskId = "T-20260905-953";
	const runId = "run-rec-4";
	const layout = artifactLayout(runId, "worker", 0, reportFor(taskId, "call-rec-4"));
	const orch = new PlannerOrchestrator({
		gitRunner,
		store: pinnedStore(),
		artifactDirs: () => [join(layout.tmp, "artifacts")],
	});
	try {
		await delegateWorker(orch, "call-rec-4", taskId);
		await orch.handleSubagentResult(receiptFor("call-rec-4", runId, layout.asyncDir));
		const outcome = await orch.recordRootVerdict(orch.store.require(taskId), "blocked", "close it out");
		assert.equal(outcome.task.state, "blocked");
		assert.equal(orch.store.require(taskId).reports.length, 1, "the finished run is consumed, not discarded");
		assert.equal(orch.pendingDelegationCount(), 0);
	} finally {
		rmSync(layout.tmp, { recursive: true, force: true });
	}
}

// A live pending child with no terminal artifacts: pass/request_changes still
// refuse; blocked is accepted as the escape hatch.
{
	const taskId = "T-20260905-951";
	const runId = "run-rec-2";
	const tmp = mkdtempSync(join(process.cwd(), ".planner-only-reconcile-"));
	const asyncDir = join(tmp, "async-subagent-runs", runId);
	mkdirSync(asyncDir, { recursive: true });
	const orch = new PlannerOrchestrator({
		gitRunner,
		store: pinnedStore(),
		artifactDirs: () => [join(tmp, "artifacts")],
	});
	try {
		await delegateWorker(orch, "call-rec-2", taskId);
		await orch.handleSubagentResult(workerResult("call-rec-2", reportFor(taskId, "call-rec-2")));
		setCleanTree();
		await orch.beginDelegation(
			{ toolCallId: "call-rec-2b", input: { task: JSON.stringify(specFor(taskId)) } },
			BASE,
		);
		await orch.handleSubagentResult(receiptFor("call-rec-2b", runId, asyncDir));
		const pending = orch.store.require(taskId);
		assert.match(orch.rootVerdictRefusal(pending, "pass"), /still pending/);
		assert.match(orch.rootVerdictRefusal(pending, "request_changes"), /still pending/);
		assert.equal(orch.rootVerdictRefusal(pending, "blocked"), undefined);
		assert.equal(await orch.reconcilePendingDelegations(), 0, "nothing terminal to reconcile");
		const outcome = await orch.recordRootVerdict(orch.store.require(taskId), "blocked", "child never reported");
		assert.equal(outcome.task.state, "blocked");
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

// A subagent-notify that does arrive after a reconcile is not double-applied.
{
	const taskId = "T-20260905-954";
	const runId = "run-rec-3";
	const layout = artifactLayout(runId, "worker", 0, reportFor(taskId, "call-rec-3"));
	const orch = new PlannerOrchestrator({
		gitRunner,
		store: pinnedStore(),
		artifactDirs: () => [join(layout.tmp, "artifacts")],
	});
	try {
		await delegateWorker(orch, "call-rec-3", taskId);
		await orch.handleSubagentResult(receiptFor("call-rec-3", runId, layout.asyncDir));
		assert.equal(await orch.reconcilePendingDelegations(), 1);
		const before = orch.store.require(taskId);
		const outcome = await orch.handleAsyncNotify(asyncNotify(runId, JSON.stringify(reportFor(taskId, "call-rec-3"))));
		assert.equal(outcome, undefined);
		const after = orch.store.require(taskId);
		assert.equal(after.reports.length, before.reports.length);
		assert.equal(after.state, before.state);
	} finally {
		rmSync(layout.tmp, { recursive: true, force: true });
	}
}

// A terminal validator run reconciles into validatorReports.
{
	const taskId = "T-20260905-952";
	const runId = "run-rec-5";
	const validatorReport = reportFor(taskId, "call-rec-5");
	const layout = artifactLayout(runId, "oracle", 0, validatorReport);
	const orch = new PlannerOrchestrator({
		gitRunner,
		store: pinnedStore(),
		artifactDirs: () => [join(layout.tmp, "artifacts")],
	});
	try {
		setCleanTree();
		await orch.beginDelegation(
			{ toolCallId: "call-rec-5w", input: { task: JSON.stringify(specFor(taskId, "worker", BASE)) } },
			BASE,
		);
		setDirtyTree();
		await orch.handleSubagentResult(workerResult("call-rec-5w", { ...reportFor(taskId, "call-rec-5w"), evidence: { ...reportFor(taskId, "call-rec-5w").evidence, cwd: BASE } }));
		await orch.beginDelegation(
			{ toolCallId: "call-rec-5", input: { agent: "oracle", task: JSON.stringify(specFor(taskId, "validator", BASE)) } },
			BASE,
		);
		await orch.handleSubagentResult(receiptFor("call-rec-5", runId, layout.asyncDir));
		assert.equal(orch.pendingDelegationCount(), 1);
		assert.equal(await orch.reconcilePendingDelegations(), 1);
		assert.equal(orch.store.require(taskId).validatorReports.length, 1);
		assert.equal(orch.pendingDelegationCount(), 0);
	} finally {
		rmSync(layout.tmp, { recursive: true, force: true });
	}
}

// --------------------------------------------------------------------------
// Ticket A2 — the write lock is held by live writable Delegations
// --------------------------------------------------------------------------

// Two validators on one worktree: the second begin is refused before launch
// and no second child is registered; a worker cannot start beside it either.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-820";
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-a2-w", input: { task: JSON.stringify(specFor(taskId, "worker", BASE)) } },
		BASE,
	);
	setDirtyTree();
	await orch.handleSubagentResult(workerResult("call-a2-w", {
		...reportFor(taskId, "call-a2-w"),
		evidence: { ...reportFor(taskId, "call-a2-w").evidence, cwd: BASE },
	}));
	await orch.beginDelegation(
		{ toolCallId: "call-a2-v1", input: { agent: "oracle", task: JSON.stringify(specFor(taskId, "validator", BASE)) } },
		BASE,
	);
	assert.equal(orch.getDelegation("call-a2-v1")?.kind, "validator");
	const second = await orch.beginDelegation(
		{ toolCallId: "call-a2-v2", input: { agent: "oracle", task: JSON.stringify(specFor(taskId, "validator", BASE)) } },
		BASE,
	);
	assert.equal(second.conflict?.conflict, true, "a second validator is refused before launch");
	assert.match(second.conflict.reason, /already holds the write lock/);
	assert.equal(orch.pendingDelegationCount(), 1, "no second child is registered");
	const beside = await orch.beginDelegation(
		{ toolCallId: "call-a2-w2", input: { task: JSON.stringify(specFor("T-20260905-821", "worker", BASE)) } },
		BASE,
	);
	assert.equal(beside.conflict?.conflict, true, "a worker cannot start beside the validator");
	assert.equal(orch.store.get("T-20260905-821")?.state, "planning", "no executing state for the loser");
}

// A Worker begin while the Task is reviewing and a writable Delegation is
// still pending is refused; `blocked` stays recordable (lost-notify, no
// terminal artifacts: the leftover waiter keeps the lock).
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-822";
	await delegateWorker(orch, "call-a2-r1", taskId);
	await orch.handleSubagentResult(workerResult("call-a2-r1", reportFor(taskId, "call-a2-r1")));
	assert.equal(orch.store.require(taskId).state, "reviewing");

	// an async re-delegation whose completion notice is lost: a waiter with a
	// runId and no terminal artifacts — a live writer as far as anyone knows
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-a2-r2", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	await orch.handleSubagentResult(receiptFor("call-a2-r2", "run-a2-r2", "/no-such-async-dir"));
	assert.equal(orch.pendingDelegationCount(), 1);

	const refused = await orch.beginDelegation(
		{ toolCallId: "call-a2-r3", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.equal(refused.conflict?.conflict, true, "a writable begin beside a pending writer is refused");
	assert.match(refused.conflict.reason, new RegExp(taskId), "the refusal names the holder Task");
	assert.equal(orch.pendingDelegationCount(), 1, "the refusal happens before launch");
	assert.equal(await orch.reconcilePendingDelegations(), 0, "no terminal artifacts to reconcile");

	// the escape hatch stays open while the child is unconfirmed
	assert.equal(orch.rootVerdictRefusal(orch.store.require(taskId), "blocked"), undefined);
	const blocked = await orch.recordRootVerdict(orch.store.require(taskId), "blocked", "child never reported");
	assert.equal(blocked.task.state, "blocked");
}

// A Worker begin while the Task is reviewing and only a Reviewer is live is
// allowed: reviewers hold no write lock, so inspection does not stall writers.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-823";
	await delegateWorker(orch, "call-a2-s1", taskId);
	await orch.handleSubagentResult(workerResult("call-a2-s1", reportFor(taskId, "call-a2-s1")));
	await orch.beginDelegation(
		{ toolCallId: "call-a2-s2", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	assert.equal(orch.pendingDelegationCount(), 1);
	setCleanTree();
	const next = await orch.beginDelegation(
		{ toolCallId: "call-a2-s3", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.equal(next.conflict, undefined, "a live reviewer must not block a writer");
	assert.equal(orch.pendingDelegationCount(), 1, "the new worker supersedes the reviewer waiter");
	assert.equal(orch.getDelegation("call-a2-s2"), undefined);
}

// Relative-path aliases of one worktree share the lock.
{
	const real = mkdtempSync(join(process.cwd(), ".planner-only-wlock-"));
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	try {
		setCleanTree();
		const first = await orch.beginDelegation(
			{ toolCallId: "call-a2-p1", input: { task: JSON.stringify(specFor("T-20260905-824", "worker", real)) } },
			BASE,
		);
		assert.equal(first.conflict, undefined);
		const alias = await orch.beginDelegation(
			{ toolCallId: "call-a2-p2", input: { task: JSON.stringify(specFor("T-20260905-825", "worker", `${real}/sub/..`)) } },
			BASE,
		);
		assert.equal(alias.conflict?.conflict, true, "a relative-path alias of the locked worktree collides");
		assert.equal(orch.store.get("T-20260905-825")?.state, "planning", "no executing state for the loser");
	} finally {
		rmSync(real, { recursive: true, force: true });
	}
}

// Lost-notify Worker still executing with terminal artifacts: the next
// same-Task begin consumes the finished run, then starts — it is not a hard
// lock refuse with two waiters.
{
	const taskId = "T-20260905-826";
	const runId = "run-a2-ln";
	const layout = artifactLayout(runId, "worker", 0, reportFor(taskId, "call-a2-ln"));
	const orch = new PlannerOrchestrator({
		gitRunner,
		store: pinnedStore(),
		artifactDirs: () => [join(layout.tmp, "artifacts")],
	});
	try {
		await delegateWorker(orch, "call-a2-ln", taskId);
		await orch.handleSubagentResult(receiptFor("call-a2-ln", runId, layout.asyncDir));
		assert.equal(orch.store.require(taskId).state, "executing");
		assert.equal(orch.pendingDelegationCount(), 1);
		setCleanTree();
		const next = await orch.beginDelegation(
			{ toolCallId: "call-a2-ln2", input: { task: JSON.stringify(specFor(taskId)) } },
			BASE,
		);
		assert.equal(next.conflict, undefined, "a finished leftover is consumed, not refused as a live writer");
		assert.ok((next.warnings ?? []).some((warning) => /had already finished/.test(warning)), next.warnings?.join(" | "));
		assert.equal(orch.store.require(taskId).reports.length, 1, "the finished run's report is kept");
		assert.equal(orch.pendingDelegationCount(), 1, "exactly one waiter — the new delegation");
	} finally {
		rmSync(layout.tmp, { recursive: true, force: true });
	}
}

// --------------------------------------------------------------------------
// Ticket B2 — a Reviewer PASS is snapshot-bound; truncated packets cannot PASS
// --------------------------------------------------------------------------

// A PASS naming a HEAD/status fallback digest instead of the bound snapshot
// digest is refused: those hashes never stand in as PASS identity.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-830";
	await delegateWorker(orch, "call-b2-hd1", taskId);
	await orch.handleSubagentResult(workerResult("call-b2-hd1", reportFor(taskId, "call-b2-hd1")));
	await orch.beginDelegation(
		{ toolCallId: "call-b2-hd2", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	const fallback = await orch.handleSubagentResult(
		reviewerResult("call-b2-hd2", taskId, "pass", {
			workspaceDigest: workspaceSummaryDigest(orch.store.require(taskId).reports.at(-1)),
		}),
	);
	assert.match(fallback.content[0].text, /workspaceDigest mismatch/);
	assert.equal(orch.store.require(taskId).reviews.length, 0, "the fallback PASS is not recorded");
	assert.equal(orch.store.require(taskId).state, "reviewing");
}

// A PASS whose re-sampled snapshot does not match the bound digest does not
// complete the Task (real Git repo, in-scope content changes after the report).
{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-revsnap-"));
	const git = (...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	try {
		git("init", "-q");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		writeFileSync(join(dir, "tracked.txt"), "base\n");
		git("add", ".");
		git("commit", "-m", "base", "-q");

		const runner = realGitRunnerOf(dir);
		const orch = new PlannerOrchestrator({ gitRunner: runner, store: pinnedStore() });
		const spec = { ...specFor("T-20260905-831"), cwd: dir, scope: { allowedPaths: ["tracked.txt"] } };
		await orch.beginDelegation({ toolCallId: "call-b2-rs1", input: { task: JSON.stringify(spec) } }, BASE);
		writeFileSync(join(dir, "tracked.txt"), "worker edit\n");
		await orch.handleSubagentResult(workerResult("call-b2-rs1", {
			version: 1,
			taskId: "T-20260905-831",
			status: "completed",
			summary: "edited tracked.txt",
			changedFiles: ["tracked.txt"],
			validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
			evidence: { cwd: dir, taskId: "T-20260905-831", workerRunId: "call-b2-rs1", changedPaths: ["tracked.txt"], gitAvailable: true, generatedAt: new Date().toISOString() },
			risks: [],
			unresolved: [],
		}));
		const boundDigest = orch.store.require("T-20260905-831").snapshot?.digest;
		assert.ok(boundDigest, "the report must bind a workspace snapshot");

		// an external edit lands after the report; the reviewer echoes the
		// digest it was shown, but accept re-samples and refuses to complete
		writeFileSync(join(dir, "tracked.txt"), "external edit\n");
		await orch.beginDelegation(
			{ toolCallId: "call-b2-rs2", input: { agent: "reviewer", task: JSON.stringify({ ...spec, role: "reviewer" }) } },
			BASE,
		);
		const outcome = await orch.handleSubagentResult(
			reviewerResult("call-b2-rs2", "T-20260905-831", "pass", { workspaceDigest: boundDigest }),
		);
		assert.match(outcome.content[0].text, /decision: revalidate/);
		assert.equal(orch.store.require("T-20260905-831").state, "changes_requested");
		assert.notEqual(orch.store.require("T-20260905-831").state, "completed");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// A PASS over an unknown accept-time snapshot sample (unreadable in-scope
// file) does not complete the Task: truncated sampling cannot look fresh.
{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-revsnap-"));
	const git = (...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	const secret = join(dir, "secret.txt");
	try {
		git("init", "-q");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		writeFileSync(join(dir, "tracked.txt"), "base\n");
		git("add", ".");
		git("commit", "-m", "base", "-q");

		const runner = realGitRunnerOf(dir);
		const orch = new PlannerOrchestrator({ gitRunner: runner, store: pinnedStore() });
		const spec = { ...specFor("T-20260905-832"), cwd: dir, scope: { allowedPaths: ["tracked.txt", "secret.txt"] } };
		await orch.beginDelegation({ toolCallId: "call-b2-un1", input: { task: JSON.stringify(spec) } }, BASE);
		writeFileSync(join(dir, "tracked.txt"), "worker edit\n");
		await orch.handleSubagentResult(workerResult("call-b2-un1", {
			version: 1,
			taskId: "T-20260905-832",
			status: "completed",
			summary: "edited tracked.txt",
			changedFiles: ["tracked.txt"],
			validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
			evidence: { cwd: dir, taskId: "T-20260905-832", workerRunId: "call-b2-un1", changedPaths: ["tracked.txt"], gitAvailable: true, generatedAt: new Date().toISOString() },
			risks: [],
			unresolved: [],
		}));
		const boundDigest = orch.store.require("T-20260905-832").snapshot?.digest;
		assert.ok(boundDigest, "the report must bind a workspace snapshot");

		writeFileSync(secret, "secret\n");
		chmodSync(secret, 0o000);
		await orch.beginDelegation(
			{ toolCallId: "call-b2-un2", input: { agent: "reviewer", task: JSON.stringify({ ...spec, role: "reviewer" }) } },
			BASE,
		);
		const outcome = await orch.handleSubagentResult(
			reviewerResult("call-b2-un2", "T-20260905-832", "pass", { workspaceDigest: boundDigest }),
		);
		assert.match(outcome.content[0].text, /decision: revalidate/);
		assert.notEqual(orch.store.require("T-20260905-832").state, "completed");
	} finally {
		chmodSync(secret, 0o755);
		rmSync(dir, { recursive: true, force: true });
	}
}

// A pre-snapshot WorkerReport cannot complete via a Reviewer PASS.
{
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const taskId = "T-20260905-833";
	const task = store.create(createTaskSpec({ objective: "legacy", cwd: BASE, taskId }), undefined);
	store.transition(task.taskId, "executing");
	store.recordReport(task.taskId, reportFor(taskId, "call-b2-ps1"));
	await orch.beginDelegation(
		{ toolCallId: "call-b2-ps2", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	const outcome = await orch.handleSubagentResult(
		reviewerResult("call-b2-ps2", taskId, "pass", { workspaceDigest: "0123456789abcdef" }),
	);
	assert.match(outcome.content[0].text, /decision: revalidate/);
	assert.match(outcome.content[0].text, /pre-snapshot report/);
	assert.notEqual(store.require(taskId).state, "completed");
}

// A Reviewer PASS with no recorded WorkerReport is refused outright: there is
// no report revision or snapshot digest for it to bind to.
{
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const taskId = "T-20260905-834";
	store.create(createTaskSpec({ objective: "nothing yet", cwd: BASE, taskId }), undefined);
	await orch.beginDelegation(
		{ toolCallId: "call-b2-nr1", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	const outcome = await orch.handleSubagentResult(
		reviewerResult("call-b2-nr1", taskId, "pass", { reportRevision: 0, workspaceDigest: "0123456789abcdef" }),
	);
	assert.match(outcome.content[0].text, /no recorded WorkerReport/);
	assert.equal(store.require(taskId).reviews.length, 0);
	assert.notEqual(store.require(taskId).state, "completed");
}

// A PASS over a truncated packet is refused and Task state is unchanged;
// request_changes still records over the partial evidence.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-835";
	await delegateWorker(orch, "call-b2-tp1", taskId);
	await orch.handleSubagentResult(workerResult("call-b2-tp1", reportFor(taskId, "call-b2-tp1")));
	const boundDigest = orch.store.require(taskId).snapshot?.digest;
	const packet = {
		version: 1,
		taskId,
		reportTaskId: taskId,
		reviewMode: "fresh",
		workerReport: reportFor(taskId, "call-b2-tp1"),
		reportRevision: 1,
		workspaceDigest: boundDigest,
		evidencePacket: { patchTruncated: true, patchOmittedPaths: ["big.txt"], patchReturnedFiles: 1 },
	};
	await orch.beginDelegation(
		{ toolCallId: "call-b2-tp2", input: { agent: "reviewer", task: JSON.stringify(packet) } },
		BASE,
	);
	const pass = await orch.handleSubagentResult(
		reviewerResult("call-b2-tp2", taskId, "pass", { workspaceDigest: boundDigest }),
	);
	assert.match(pass.content[0].text, /truncated/);
	assert.equal(orch.store.require(taskId).reviews.length, 0, "the truncated PASS is not recorded");
	assert.equal(orch.store.require(taskId).state, "reviewing", "Task state is unchanged");

	// non-pass verdicts are unchanged by truncation
	await orch.beginDelegation(
		{ toolCallId: "call-b2-tp3", input: { agent: "reviewer", task: JSON.stringify(packet) } },
		BASE,
	);
	const requestChanges = await orch.handleSubagentResult(
		reviewerResult("call-b2-tp3", taskId, "request_changes", { workspaceDigest: boundDigest }),
	);
	assert.match(requestChanges.content[0].text, /decision: request_changes/);
	assert.equal(orch.store.require(taskId).reviews.length, 1);
	assert.equal(orch.store.require(taskId).state, "changes_requested");
}
