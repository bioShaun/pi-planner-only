import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { PlannerOrchestrator, isDelegationCall } from "./orchestrate.ts";
import { LedgerSnapshotStore } from "./ledger-store.ts";
import { BudgetReservations } from "./reservations.ts";
import { createTaskSpec, isExecutingStale, isHolderStale } from "./task.ts";
import { TaskStore } from "./task.ts";
import { hashStatus, workspaceSummaryDigest, describeComparison } from "./evidence.ts";
import { extractReviewRequest } from "./review.ts";
import { workerReportShapeReminder } from "./report.ts";
import { emptyTaskUsage } from "./usage.ts";
import { MISSING_VALIDATION_DEFINITION_REASON } from "./roles.ts";

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


// Ticket 11: required validation without commands blocks Validator delegation before
// the oracle contract can substitute ORACLE_SUITE=full/bounded.
{
	const missingCommandsSpec = createTaskSpec({
		objective: "validator definition required",
		cwd: BASE,
		role: "validator",
		validation: { required: true },
	});
	const input = { task: JSON.stringify(missingCommandsSpec) };
	const orch = new PlannerOrchestrator({ store: pinnedStore(), gitRunner });
	await orch.prepareRoleDelegation(input);
	assert.doesNotMatch(input.task, /ORACLE_SUITE=(?:full|bounded)/);
	const outcome = await orch.beginDelegation({ toolCallId: "call-missing-validation", input }, BASE);
	assert.match(outcome.block?.reason ?? "", /需补充验证定义/);
	assert.equal(orch.pendingDelegationCount(), 0);
}

// Ticket 11: an existing Task with a required but undefined validation block also
// blocks a task-id-only Validator delegation before launch.
{
	const taskId = "T-20260905-811";
	const missingCommandsSpec = createTaskSpec({
		taskId,
		objective: "worker task with undefined validation",
		cwd: BASE,
		role: "worker",
		validation: { required: true },
	});
	const orch = new PlannerOrchestrator({ store: pinnedStore(), gitRunner });
	const workerInput = { task: JSON.stringify(missingCommandsSpec) };
	await orch.beginDelegation({ toolCallId: "call-missing-validation-worker", input: workerInput }, BASE);
	const report = reportFor(taskId, "call-missing-validation-worker");
	report.evidence.cwd = BASE;
	await orch.handleSubagentResult(workerResult("call-missing-validation-worker", report));

	const validatorInput = { agent: "oracle", task: `Validate ${taskId}` };
	await orch.prepareRoleDelegation(validatorInput);
	assert.doesNotMatch(validatorInput.task, /ORACLE_SUITE=/);
	const outcome = await orch.beginDelegation(
		{ toolCallId: "call-missing-validation-store", input: validatorInput },
		BASE,
	);
	assert.match(outcome.block?.reason ?? "", /需补充验证定义/);
	assert.equal(orch.pendingDelegationCount(), 0);
}

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
// p07-r033: public host launch contract receives the role-specific model fields
// after beginDelegation applies the existing agent remaps.
{
	const saved = { ...process.env };
	try {
		process.env.PI_PLANNER_ONLY_ROLE_MODELS = "1";
		for (const [role, model, thinking, agent] of [
			["worker", "policy-test/worker", "off", "worker"],
			["reviewer", "policy-test/reviewer", "low", "reviewer"],
			["validator", "policy-test/validator", "medium", "oracle"],
			["explorer", "policy-test/explorer", "high", "reviewer"],
		]) {
			process.env[`PI_PLANNER_ONLY_MODEL_${role.toUpperCase()}`] = model;
			process.env[`PI_PLANNER_ONLY_THINKING_${role.toUpperCase()}`] = thinking;
			const input = {
				agent: role === "explorer" ? "worker" : agent,
				task: role === "reviewer" ? JSON.stringify({ taskId: `T-20260905-${role}`, role: "reviewer" }) : JSON.stringify(specFor(`T-20260905-${role}`, role)),
			};
			const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
			await orch.prepareRoleDelegation(input);
			await orch.beginDelegation({ toolCallId: `call-model-${role}`, input }, BASE);
			assert.equal(input.agent, agent, `${role} must use its existing host agent remap`);
			assert.equal(input.model, model);
			assert.equal(input.thinking, thinking);
			if (role !== "explorer") assert.equal(input.context, "fresh");
		}
	} finally {
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("PI_PLANNER_ONLY_MODEL_") || key.startsWith("PI_PLANNER_ONLY_THINKING_") || key === "PI_PLANNER_ONLY_ROLE_MODELS") {
				if (saved[key] === undefined) delete process.env[key];
			}
		}
		for (const [key, value] of Object.entries(saved)) {
			if (key.startsWith("PI_PLANNER_ONLY_MODEL_") || key.startsWith("PI_PLANNER_ONLY_THINKING_") || key === "PI_PLANNER_ONLY_ROLE_MODELS") process.env[key] = value;
		}
	}
}


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

// require-review mode defaults to strict structured delegation
{
	const previous = process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
	const previousStructured = process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION;
	try {
		process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = "1";
		delete process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION;
		const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		assert.equal(orch.structuredDelegationMode, "warn");
		const before = orch.store.list().length;
		const blocked = await orch.beginDelegation(
			{ toolCallId: "call-r-review", input: { agent: "worker", task: "no TaskSpec" } },
			BASE,
		);
		assert.ok(blocked.block);
		assert.match(blocked.block.reason, /PI_PLANNER_ONLY_REQUIRE_REVIEW=1/);
		assert.match(blocked.block.reason, /objective.*scope.*acceptanceCriteria/s);
		assert.doesNotMatch(blocked.block.reason, /PI_PLANNER_ONLY_STRUCTURED_DELEGATION=warn/);
		assert.equal(orch.store.list().length, before);
		assert.equal(orch.store.list().some((task) => task.isPlaceholder), false);

		// Strict review mode outranks the structured-delegation switch: with both
		// set, the "set …=warn" hint would be false, so it must not be printed.
		process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION = "strict";
		const blockedBoth = await orch.beginDelegation(
			{ toolCallId: "call-r-review-both", input: { agent: "worker", task: "no TaskSpec" } },
			BASE,
		);
		assert.ok(blockedBoth.block);
		assert.match(blockedBoth.block.reason, /PI_PLANNER_ONLY_REQUIRE_REVIEW=1/);
		assert.doesNotMatch(blockedBoth.block.reason, /PI_PLANNER_ONLY_STRUCTURED_DELEGATION=warn/);
		delete process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION;

		for (const agent of ["oracle", "reviewer", "explorer", "scout"]) {
			const outcome = await orch.beginDelegation(
				{ toolCallId: `call-r-${agent}`, input: { agent, task: "no TaskSpec" } },
				BASE,
			);
			assert.equal(outcome.block, undefined, `${agent} must remain unblocked`);
		}
	} finally {
		if (previous === undefined) delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
		else process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = previous;
		if (previousStructured === undefined) delete process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION;
		else process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION = previousStructured;
	}
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

// Ticket 22 round p10-r046 — strict fresh review requires reviewer evidence.
{
	const previous = process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
	try {
		process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = "1";
		const makeStrictTask = (taskId) => {
			const store = new TaskStore({ now: FIXED_NOW });
			const task = store.create(createTaskSpec({ objective: "strict review", cwd: BASE }, taskId));
			store.recordReport(taskId, reportFor(taskId, `${taskId}-worker`));
			return { store, task: store.require(taskId) };
		};
		const noReviewer = makeStrictTask("T-20260905-220a");
		assert.equal(noReviewer.store.require(noReviewer.task.taskId).reviewMode, "fresh");
		const noReviewerOrch = new PlannerOrchestrator({ gitRunner, store: noReviewer.store });
		assert.match(noReviewerOrch.rootVerdictRefusal(noReviewer.task, "pass"), /reviewer ReviewResult/);

		const zeroPaths = makeStrictTask("T-20260905-220b");
		zeroPaths.store.recordReview(zeroPaths.task.taskId, {
			taskId: zeroPaths.task.taskId, verdict: "pass", summary: "reviewed", findings: [], evidenceFresh: true, source: "reviewer",
		});
		zeroPaths.store.setLastComparison(zeroPaths.task.taskId, {
			verifiable: true, fresh: true, reasons: [], truthPaths: [], undeclaredPaths: [], extraDeclaredPaths: [],
			overlappingPaths: [], unrelatedPaths: [], missingPaths: [], unexplained: false,
		});
		const zeroPathsOrch = new PlannerOrchestrator({ gitRunner, store: zeroPaths.store });
		assert.match(zeroPathsOrch.rootVerdictRefusal(zeroPaths.task, "pass"), /attribution paths are 0/);

		const attributed = makeStrictTask("T-20260905-220c");
		attributed.store.recordReview(attributed.task.taskId, {
			taskId: attributed.task.taskId, verdict: "pass", summary: "reviewed", findings: [], evidenceFresh: true, source: "reviewer",
		});
		const comparison = {
			verifiable: true, fresh: true, reasons: [], truthPaths: ["src/parser.ts"], undeclaredPaths: [], extraDeclaredPaths: [],
			overlappingPaths: [], unrelatedPaths: [], missingPaths: [], unexplained: false,
		};
		attributed.store.setLastComparison(attributed.task.taskId, comparison);
		const attributedOrch = new PlannerOrchestrator({ gitRunner, store: attributed.store });
		assert.equal(attributedOrch.rootVerdictRefusal(attributed.task, "pass"), undefined);
		const receipt = attributedOrch.renderDecisionBlock(attributed.task, { action: "accept", reason: "accepted", guidance: [] }, describeComparison(comparison));
		assert.match(receipt, /review mode: fresh/);
		assert.ok(receipt.includes(`evidence: ${describeComparison(comparison)}`));

		delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
		const defaultStore = new TaskStore({ now: FIXED_NOW });
		const defaultTask = defaultStore.create(createTaskSpec({ objective: "default review", cwd: BASE }, "T-20260905-220e"));
		defaultStore.recordReport(defaultTask.taskId, reportFor(defaultTask.taskId, "default-worker"));
		const defaultOrch = new PlannerOrchestrator({ gitRunner, store: defaultStore });
		assert.equal(defaultTask.reviewMode, "root");
		assert.equal(defaultOrch.rootVerdictRefusal(defaultTask, "pass"), undefined);
	} finally {
		if (previous === undefined) delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
		else process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = previous;
	}
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
// Ticket 42: report-only corrections are machine-generated with the original
// TaskSpec + explicit reportOnly, so the historical "without an embedded
// TaskSpec" warn-mode notice no longer fires on this path.
// --------------------------------------------------------------------------

{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	const taskId = "T-20260905-902";
	await delegateWorker(orch, "call-902", taskId);
	// Finish the first worker so the correction round can take the write lock
	// (a real report-only correction always follows a completed child).
	await orch.handleSubagentResult(workerResult("call-902", reportFor(taskId, "call-902")));
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
	assert.equal(outcome.conflict?.conflict, undefined, outcome.conflict?.reason);
	assert.equal(
		(outcome.warnings ?? []).some((warning) => /without an embedded TaskSpec/.test(warning)),
		false,
		outcome.warnings?.join(" | "),
	);
	assert.equal(orch.getDelegation("call-902-fix")?.reportOnly, true, "RF-7/42: report-only correction stamps reportOnly");
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

// Explorer accounting prefers the newest live Task in the delegated cwd,
// even when another cwd's Task is the store-wide active Task.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	const cwdA = "/repo/explorer-a";
	const cwdB = "/repo/explorer-b";
	const taskA = orch.store.create(specFor("T-explorer-cwd-a", "worker", cwdA));
	const taskB = orch.store.create(specFor("T-explorer-cwd-b", "worker", cwdB));
	taskA.updatedAt = "2026-09-05T00:00:00.000Z";
	taskB.updatedAt = "2026-09-05T00:01:00.000Z";
	assert.equal(orch.store.active()?.taskId, taskB.taskId);
	const outcome = await orch.beginDelegation(
		{ toolCallId: "call-explorer-cwd", input: { agent: "explorer", task: "Inspect the workspace.", cwd: cwdA } },
		BASE,
	);
	assert.equal(outcome.task, undefined);
	assert.equal(orch.getDelegation("call-explorer-cwd")?.accountingTaskId, taskA.taskId);
}

// Explorer accounting falls back to the store-wide active Task when its cwd
// differs from the delegated cwd.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	const task = orch.store.create(specFor("T-explorer-fallback", "worker", "/repo/current"));
	const outcome = await orch.beginDelegation(
		{ toolCallId: "call-explorer-fallback", input: { agent: "explorer", task: "Inspect another workspace.", cwd: "/repo/other" } },
		BASE,
	);
	assert.equal(outcome.task, undefined);
	assert.equal(orch.getDelegation("call-explorer-fallback")?.accountingTaskId, task.taskId);
}

// p12-r058: an unbound validator whose placeholder is the synthetic
// `unbound-validator-<toolCallId>` string attributes usage to the live Task
// in the delegated cwd (not the store-wide active Task in another cwd).
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	const cwdA = "/repo/v-acct-cwd";
	const cwdB = "/repo/v-acct-other";
	const taskA = orch.store.create(specFor("T-20260908-581", "worker", cwdA));
	const taskB = orch.store.create(specFor("T-20260908-582", "worker", cwdB));
	taskA.updatedAt = "2026-09-05T00:00:00.000Z";
	taskB.updatedAt = "2026-09-05T00:01:00.000Z";
	assert.equal(orch.store.active()?.taskId, taskB.taskId);
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-v-acct-synthetic",
			input: { agent: "oracle", cwd: cwdA, task: "validate the claim with no task named" },
		},
		BASE,
	);
	assert.equal(outcome.task, undefined);
	assert.equal(orch.getDelegation("call-v-acct-synthetic")?.taskId, "unbound-validator-call-v-acct-synthetic");
	assert.equal(orch.getDelegation("call-v-acct-synthetic")?.kind, "validator");
	assert.equal(orch.getDelegation("call-v-acct-synthetic")?.accountingTaskId, taskA.taskId);
}

// p12-r058: placeholder is an existing specId different from the cwd-active
// Task. Bound validator keeps that specId; do not re-attribute to activeForCwd.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	const cwdActive = "/repo/v-acct-active";
	const cwdSpec = "/repo/v-acct-spec";
	const activeTask = orch.store.create(specFor("T-20260908-583", "worker", cwdActive));
	const specTask = orch.store.create(specFor("T-20260908-584", "worker", cwdSpec));
	activeTask.updatedAt = "2026-09-05T00:01:00.000Z";
	specTask.updatedAt = "2026-09-05T00:00:00.000Z";
	assert.equal(orch.store.activeForCwd(cwdActive)?.taskId, activeTask.taskId);
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-v-acct-specid",
			input: {
				agent: "oracle",
				cwd: cwdActive,
				task: JSON.stringify(specFor("T-20260908-584", "validator", cwdSpec)),
			},
		},
		BASE,
	);
	assert.equal(outcome.task?.taskId, specTask.taskId, "validator must stay bound to the named specId");
	assert.equal(orch.getDelegation("call-v-acct-specid")?.taskId, specTask.taskId);
	assert.equal(
		orch.getDelegation("call-v-acct-specid")?.accountingTaskId,
		undefined,
		"existing specId must not be re-attributed to activeForCwd",
	);
}

// p12-r058: declared specId that is not in the store (unbound placeholder is
// that id) must not be re-hung onto the cwd-active Task.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	const cwdA = "/repo/v-acct-declared";
	const live = orch.store.create(specFor("T-20260908-585", "worker", cwdA));
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-v-acct-declared",
			input: {
				agent: "oracle",
				cwd: cwdA,
				task: JSON.stringify(specFor("T-20260908-586", "validator", cwdA)),
			},
		},
		BASE,
	);
	assert.equal(outcome.task, undefined);
	assert.equal(orch.getDelegation("call-v-acct-declared")?.taskId, "T-20260908-586");
	assert.equal(
		orch.getDelegation("call-v-acct-declared")?.accountingTaskId,
		undefined,
		`declared specId must stay on T-20260908-586, not ${live.taskId}`,
	);
}

// p12-r058: a single named Task id in the prompt that exists in the store,
// different from the cwd-active Task, keeps that named id (no re-hang).
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	const cwdNamed = "/repo/v-acct-named";
	const cwdActive = "/repo/v-acct-named-active";
	const namedTask = orch.store.create(specFor("T-20260908-587", "worker", cwdNamed));
	const activeTask = orch.store.create(specFor("T-20260908-588", "worker", cwdActive));
	namedTask.updatedAt = "2026-09-05T00:00:00.000Z";
	activeTask.updatedAt = "2026-09-05T00:01:00.000Z";
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-v-acct-named",
			input: { agent: "oracle", cwd: cwdActive, task: "Validate T-20260908-587." },
		},
		BASE,
	);
	assert.equal(outcome.task?.taskId, namedTask.taskId);
	assert.equal(orch.getDelegation("call-v-acct-named")?.taskId, namedTask.taskId);
	assert.equal(orch.getDelegation("call-v-acct-named")?.accountingTaskId, undefined);
}

// p12-r058: same cwd has no live Task; another cwd does. Do not attach to the
// other cwd's Task and do not invent a silent drop of the delegation record.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	const other = orch.store.create(specFor("T-20260908-589", "worker", "/repo/v-acct-foreign"));
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-v-acct-nocwd",
			input: { agent: "oracle", cwd: "/repo/v-acct-empty", task: "validate the claim with no task named" },
		},
		BASE,
	);
	assert.equal(outcome.task, undefined);
	assert.equal(orch.getDelegation("call-v-acct-nocwd")?.taskId, "unbound-validator-call-v-acct-nocwd");
	assert.equal(
		orch.getDelegation("call-v-acct-nocwd")?.accountingTaskId,
		undefined,
		`must not hang onto other-cwd Task ${other.taskId}`,
	);
}

// p12-r058: a bound validator (resolveValidatorReviewedTask hit via report)
// keeps taskId = reviewed Task and does not set accountingTaskId.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-590";
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-v-acct-bound-w", input: { task: JSON.stringify(specFor(taskId, "worker", BASE)) } },
		BASE,
	);
	setDirtyTree();
	const workerReport = {
		...reportFor(taskId, "call-v-acct-bound-w"),
		evidence: { ...reportFor(taskId, "call-v-acct-bound-w").evidence, cwd: BASE },
	};
	await orch.handleSubagentResult(workerResult("call-v-acct-bound-w", workerReport));
	const outcome = await orch.beginDelegation(
		{
			toolCallId: "call-v-acct-bound-v",
			input: { agent: "oracle", task: "validate the claim with no task named" },
		},
		BASE,
	);
	assert.equal(outcome.task?.taskId, taskId);
	assert.equal(orch.getDelegation("call-v-acct-bound-v")?.taskId, taskId);
	assert.equal(orch.getDelegation("call-v-acct-bound-v")?.kind, "validator");
	assert.equal(orch.getDelegation("call-v-acct-bound-v")?.accountingTaskId, undefined);
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
		floorLimits: {
			toolBudget: { value: 20, source: "floor" },
			tokens: { value: 40000, source: "floor" },
			costUsd: { value: 0.1, source: "floor" },
		},
		floorSummary: "toolBudget.hard=20 (floor), usageBudget.tokens.hard=40000 (floor), usageBudget.costUsd.hard=0.1 (floor)",
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

// scout is an explorer-kind delegation, but keeps the caller's scout builtin so
// its reconnaissance tools are not replaced by explorer's reviewer remap.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	const input = { agent: "scout", task: "Survey the repo and report findings." };
	const before = orch.store.list().length;
	const outcome = await orch.beginDelegation({ toolCallId: "call-scout-unbound", input }, BASE);
	assert.equal(input.agent, "scout");
	assert.equal(outcome.task, undefined);
	assert.deepEqual(outcome.warnings, [
		"Planner-only: explorer delegation is not attached to any Task; its output is returned as-is.",
	]);
	assert.equal(orch.store.list().length, before);
	assert.equal(orch.getDelegation("call-scout-unbound")?.kind, "explorer");
	assert.equal(orch.getDelegation("call-scout-unbound")?.taskId, "unbound-explorer-call-scout-unbound");

	const raw = "Scout findings: bash is available and the parser is in src/parser.ts.";
	const result = await orch.handleSubagentResult({
		toolCallId: "call-scout-unbound",
		toolName: "subagent",
		input,
		content: [{ type: "text", text: raw }],
	});
	assert.equal(result.content[0].text, raw);
	assert.doesNotMatch(result.content[0].text, /Placeholder task T-/);
	assert.doesNotMatch(result.content[0].text, /Worker output .* is not a valid WorkerReport/);

	const workerOutcome = await orch.beginDelegation({
		toolCallId: "call-worker-after-scout",
		input: { agent: "worker", task: "Implement the parser change." },
	}, BASE);
	assert.match(workerOutcome.task?.taskId ?? "", /^T-\d{8}-001$/);
	assert.equal(orch.store.list().length, before + 1);
}

// scout naming a live Task binds to it without creating another Task.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	const taskId = "T-20260905-916";
	await delegateWorker(orch, "call-916-worker", taskId);
	const before = orch.store.list().length;
	const input = { agent: "SCOUT", task: `Investigate task ${taskId} and report findings.` };
	const outcome = await orch.beginDelegation({ toolCallId: "call-916-scout", input }, BASE);
	assert.equal(input.agent, "SCOUT");
	assert.equal(outcome.task?.taskId, taskId);
	assert.equal(orch.store.list().length, before);
	assert.equal(orch.getDelegation("call-916-scout")?.kind, "explorer");
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
	assert.match(result.content[0].text, new RegExp(`Validator result for task ${taskId}`));
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
	assert.match(repaired.content[0].text, new RegExp(`Validator result for task ${taskId}`));
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
	assert.match(clean.content[0].text, new RegExp(`Validator result for task ${taskId}`));
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

// Ticket 14A V5-V11 — bounded cumulative budget and lifecycle behavior.
function budgetTaskFixture(taskId, cumulativeBudget, usage, role = "worker") {
	const store = pinnedStore();
	const task = store.create({ ...specFor(taskId, role), cumulativeBudget });
	task.usage = usage;
	return { store, task };
}
function boundedBudgetUsage(tokens, costUsd) {
	const usage = usageFixture(tokens, costUsd);
	usage.children = [{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0 }];
	return usage;
}
{
	const { store, task } = budgetTaskFixture("T-20260908-v5", { tokens: 50_000, costUsd: 0.20 }, boundedBudgetUsage(48_000, 0.19));
	task.reports.push(reportFor(task.taskId, "old-report"));
	const input = { task: JSON.stringify(task.spec), usageBudget: { tokens: { hard: 50_000 }, costUsd: { hard: 0.20 } } };
	const orch = new PlannerOrchestrator({ gitRunner, store });
	await orch.beginDelegation({ toolCallId: "call-v5", input }, BASE);
	assert.equal(input.usageBudget.tokens.hard, 2_000);
	assert.ok(Math.abs(input.usageBudget.costUsd.hard - 0.01) < 1e-9);
}
{
	const { store, task } = budgetTaskFixture("T-20260908-v6", { tokens: 50_000, costUsd: 0.20 }, boundedBudgetUsage(48_000, 0.19));
	task.reports.push(reportFor(task.taskId, "old-report"));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	await orch.beginDelegation({ toolCallId: "call-v6-a", input: { task: JSON.stringify(task.spec) } }, BASE);
	const blocked = await orch.beginDelegation({ toolCallId: "call-v6-b", input: { task: JSON.stringify(task.spec) } }, BASE);
	assert.ok(blocked.block);
	assert.match(blocked.block.reason, /cumulative budget exhausted \(tokens\)/);
}
{
	const { store, task } = budgetTaskFixture("T-20260908-v7", { tokens: 100_000, costUsd: 0.20 }, boundedBudgetUsage(1_000, 0.20));
	task.reports.push(reportFor(task.taskId, "old-report"));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const blocked = await orch.beginDelegation({ toolCallId: "call-v7", input: { task: JSON.stringify(task.spec) } }, BASE);
	assert.match(blocked.block?.reason ?? "", /cumulative budget exhausted \(costUsd\)/);
	assert.equal((blocked.block?.reason ?? "").split(String.fromCharCode(10)).slice(0, 6).join(String.fromCharCode(10)), [
		`Planner-only guard: task ${task.taskId} cumulative budget exhausted (costUsd).`,
		"已知消耗: tokens=1000, 费用 $0.2000",
		"在途预留: tokens=0, 费用 $0.0000",
		"未知项: tokens 0 项, 费用 0 项",
		"上限: tokens=100000, 费用 $0.2000",
		"本次受控启动被拒绝；结束在途子进程或提高 cumulativeBudget 后重试。",
	].join(String.fromCharCode(10)));
}
{
	const { store, task } = budgetTaskFixture("T-20260908-v9", { tokens: 50_000, costUsd: 0.20 }, boundedBudgetUsage(48_000, 0.19));
	task.reports.push(reportFor(task.taskId, "old-report"));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	await orch.beginDelegation({ toolCallId: "call-v9-a", input: { task: JSON.stringify(task.spec) } }, BASE);
	await orch.handleSubagentResult(workerResult("call-v9-a", reportFor(task.taskId, "call-v9-a")));
	const retry = await orch.beginDelegation({ toolCallId: "call-v9-b", input: { task: JSON.stringify(task.spec) } }, BASE);
	assert.equal(retry.block, undefined);
}
{
	const { store, task } = budgetTaskFixture("T-20260908-v10", { tokens: 1, costUsd: 0.01 }, usageFixture(5_000, 0.50));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const reviewerInput = { agent: "reviewer", task: `Review ${task.taskId}` };
	const outcome = await orch.beginDelegation({ toolCallId: "call-v10-reviewer", input: reviewerInput }, BASE);
	assert.equal(outcome.block, undefined);
	assert.deepEqual(orch.reservations.inFlight(task.taskId), { tokens: 0, costUsd: 0 });
	const workerOutcome = await orch.beginDelegation({ toolCallId: "call-v10-worker", input: { task: JSON.stringify(task.spec) } }, BASE);
	assert.match(workerOutcome.block?.reason ?? "", /cumulative budget exhausted/);
}
{
	const before = { usageBudget: { tokens: { hard: 123 }, costUsd: { hard: 0.12 } } };
	const expectedBefore = JSON.parse(JSON.stringify(before));
	const input = { ...before, task: JSON.stringify(specFor("T-20260908-v11")) };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await orch.beginDelegation({ toolCallId: "call-v11", input }, BASE);
	assert.deepEqual(input.usageBudget, expectedBefore.usageBudget);
}

// Ticket 14A V14 — an empty usageBudget object is never written to the payload.
{
	const { store, task } = budgetTaskFixture("T-20260908-v14", {}, usageFixture(0, 0));
	const input = { task: JSON.stringify(task.spec) };
	const orch = new PlannerOrchestrator({ gitRunner, store });
	await orch.beginDelegation({ toolCallId: "call-v14", input }, BASE);
	assert.ok(input.usageBudget === undefined || Object.keys(input.usageBudget).length > 0);
}

// A cumulative budget refusal strips usageBudget and __floorLimits from the input
// before returning, matching the untrusted-ledger refusal path.
{
	const { store, task } = budgetTaskFixture("T-20260908-v16", { tokens: 100_000, costUsd: 0.20 }, boundedBudgetUsage(1_000, 0.20));
	task.reports.push(reportFor(task.taskId, "old-report"));
	const input = {
		task: JSON.stringify(task.spec),
		usageBudget: { tokens: { hard: 100_000 }, costUsd: { hard: 0.20 } },
		__floorLimits: { tokens: { value: 100_000, source: "floor" }, costUsd: { value: 0.2, source: "floor" } },
	};
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const blocked = await orch.beginDelegation({ toolCallId: "call-v16", input }, BASE);
	assert.match(blocked.block?.reason ?? "", /cumulative budget exhausted/);
	assert.equal(input.usageBudget, undefined, "refused cumulative launch does not leave a usageBudget on the input");
	assert.equal(input.__floorLimits, undefined, "refused cumulative launch does not leave __floorLimits on the input");
}

// Ticket 14A V13 — rejected validator launches do not leak reservations.
{
	const taskId = "T-20260908-v13";
	const store = pinnedStore();
	const task = store.create({ ...specFor(taskId), cumulativeBudget: { tokens: 50_000, costUsd: 0.20 } });
	task.usage = boundedBudgetUsage(0, 0);
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const before = orch.pendingDelegationCount();
	for (let i = 0; i < 5; i++) {
		const invalid = { ...task.spec, role: "validator", validation: { required: true } };
		const outcome = await orch.beginDelegation({ toolCallId: `call-v13-${i}`, input: { agent: "oracle", task: JSON.stringify(invalid) } }, BASE);
		assert.equal(outcome.block?.reason, MISSING_VALIDATION_DEFINITION_REASON);
	}
	assert.equal(orch.pendingDelegationCount(), before);
	const normal = await orch.beginDelegation({ toolCallId: "call-v13-ok", input: { task: JSON.stringify(task.spec) } }, BASE);
	assert.equal(normal.block, undefined);
	await orch.handleSubagentResult(workerResult("call-v13-ok", reportFor(taskId, "call-v13-ok")));
	assert.equal(orch.pendingDelegationCount(), before);
}

function statusWithBudget(cumulativeBudget, usage) {
	const store = pinnedStore();
	const task = store.create({ ...specFor("T-20260908-budget"), cumulativeBudget });
	task.usage = usage;
	return new PlannerOrchestrator({ gitRunner, store }).renderTaskStatus(task);
}
function usageFixture(output = 0, costUsd) {
	const usage = emptyTaskUsage();
	usage.root = { ...usage.root, turns: output ? 1 : 0, output, ...(costUsd === undefined ? {} : { costUsd }) };
	return usage;
}
{
	const status = statusWithBudget(undefined, usageFixture(120, 0));
	assert.equal(status.includes("Budget: 未设累计上限（已知消耗 tokens=120，费用 $0.0000；未知项 tokens 0 项、费用 0 项）"), true);
	assert.equal(status.includes("剩余"), false);
}
{
	const usage = usageFixture(700, 0.1234);
	usage.children = [{ input: 0, output: 300, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0.4567 }];
	const status = statusWithBudget({ tokens: 1500, costUsd: 1 }, usage);
	assert.equal(status.includes("  tokens: 已用 1000 / 上限 1500，剩余 500，未知项 0 项"), true);
	assert.equal(status.includes("  费用: 已用 $0.5801 / 上限 $1.0000，剩余 $0.4199，未知项 0 项"), true);
}
{
	assert.equal(statusWithBudget({ tokens: 1000 }, usageFixture(1200, 0.5)).includes("剩余 -200，未知项 0 项（已超支）"), true);
}
{
	const status = statusWithBudget({ costUsd: 2 }, usageFixture(7, 0.25));
	assert.equal(status.includes("  tokens: 已用 7，未设累计上限，未知项 0 项"), true);
	assert.equal(status.includes("  费用: 已用 $0.2500 / 上限 $2.0000，剩余 $1.7500，未知项 0 项"), true);
}
{
	const usage = usageFixture(10, 0.1);
	usage.root.tokensUnknownTurns = 1;
	assert.equal(statusWithBudget({ tokens: 20, costUsd: 1 }, usage).includes("已用 10（不含 1 个未知项） / 上限 20，剩余 10，未知项 1 项"), true);
}
{
	const usage = usageFixture(10, 0.1);
	usage.children = [1, 2].map((output) => ({ input: 0, output, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0.2 }));
	const status = statusWithBudget({ tokens: 100 }, usage);
	assert.equal(status.includes("  - root: 1 turns, tokens=10, 费用 $0.1000"), true);
	assert.equal(status.includes("  - worker: 2 calls, tokens=3, 费用 $0.4000"), true);
	assert.equal(status.includes("reviewer"), false);
}
{
	// A role with zero calls is absent, not zero-filled: children arrived before
	// any Root turn, so there must be no "root: 0 turns" row.
	const usage = usageFixture(0);
	usage.children = [{ input: 0, output: 5, cacheRead: 0, cacheWrite: 0, kind: "explorer", pending: false, source: "sync-details", costUsd: 0.01 }];
	const status = statusWithBudget({ tokens: 100 }, usage);
	assert.equal(status.includes("  - explorer: 1 calls, tokens=5, 费用 $0.0100"), true);
	assert.equal(status.split("\n").some((line) => line.startsWith("  - root:")), false, "a Root with zero turns must not get a role row");
}
{
	const store = pinnedStore();
	const task = store.create(specFor("T-20260908-no-usage"));
	task.usage = undefined;
	assert.equal(new PlannerOrchestrator({ gitRunner, store }).renderTaskStatus(task).split("\n").some((line) => line.startsWith("Budget")), false);
}

function withHostEnforcementEnv(overrides, fn) {
	const keys = ["PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS", "PI_PLANNER_ONLY_HOST_ENFORCES_COST_USD"];
	const saved = {};
	for (const key of keys) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
	for (const [key, value] of Object.entries(overrides)) {
		process.env[key] = value;
	}
	try {
		return fn();
	} finally {
		for (const key of keys) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	}
}

// Ticket 14B/17 W7 — configured limits without a declaration are labelled observation-only.
{
	const usage = usageFixture(700, 0.1234);
	usage.children = [{ input: 0, output: 300, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0.4567 }];
	const status = withHostEnforcementEnv({}, () => statusWithBudget({ tokens: 1500, costUsd: 1 }, usage));
	assert.equal(status.split("\n").some((line) => line.startsWith("  tokens:") && line.endsWith("；宿主未强制该维度，仅事后观测")), true, "W7: tokens line is observation-only");
	assert.equal(status.split("\n").some((line) => line.startsWith("  费用:") && line.endsWith("；宿主未强制该维度，仅事后观测")), true, "W7: cost line is observation-only");
}

// Ticket 14B/17 W8 — declaring tokens enforcement must not flip the cost line.
{
	const status = withHostEnforcementEnv({ PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS: "1" }, () => statusWithBudget({ tokens: 1500, costUsd: 1 }, usageFixture(100, 0.1)));
	const tokenLine = status.split("\n").find((line) => line.startsWith("  tokens:"));
	const costLine = status.split("\n").find((line) => line.startsWith("  费用:"));
	assert.equal(tokenLine.includes("；宿主在上限处强制停止"), true, "W8: tokens line is host-enforced");
	assert.equal(costLine.includes("；宿主未强制该维度，仅事后观测"), true, "W8: cost line stays observation-only");
}

// Ticket 14B/17 W9 — a dimension without a limit carries no enforcement suffix.
// The cost assertion is the positive anchor: without it the two negatives below
// also hold when the enforcement suffix is removed from the renderer entirely,
// so the block would pass against a feature that does not exist.
{
	const status = withHostEnforcementEnv({}, () => statusWithBudget({ costUsd: 2 }, usageFixture(7, 0.25)));
	const tokenLine = status.split("\n").find((line) => line.startsWith("  tokens:"));
	const costLine = status.split("\n").find((line) => line.startsWith("  费用:"));
	assert.equal(costLine.endsWith("；宿主未强制该维度，仅事后观测"), true, "W9: the limited cost line in the same render does carry the observation suffix");
	assert.equal(tokenLine.includes("；宿主未强制该维度，仅事后观测"), false, "W9: unlimited tokens line has no observation suffix");
	assert.equal(tokenLine.includes("；宿主在上限处强制停止"), false, "W9: unlimited tokens line has no hard-stop suffix");
}

// Ticket 14B/17 W10 — Root spend on the disclosure line is the Root ledger, not the Task total.
{
	const usage = usageFixture(700, 0.1234);
	usage.children = [{ input: 0, output: 300, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0.4567 }];
	const status = withHostEnforcementEnv({}, () => statusWithBudget({ tokens: 1500, costUsd: 1 }, usage));
	assert.equal(status.includes("  Root: 无预调用控制，Root 自身消耗只能事后计入（已计入 tokens=700、费用 $0.1234）"), true, "W10: Root line uses Root's own tokens and cost");
}

// Ticket 14B/17 W11 — the overspend named on the disclosure line is attributed to
// the Task, not to Root: a child can exhaust the limit on its own.
{
	const status = withHostEnforcementEnv({}, () => statusWithBudget({ tokens: 10000, costUsd: 1 }, usageFixture(15000, 0.1)));
	assert.equal(status.includes("；本 Task 当前已超额：tokens 5000"), true, "W11: tokens overspend suffix is frozen as ；本 Task 当前已超额：tokens 5000");
	assert.equal(status.includes("；当前tokens"), false, "W11: the unattributed 当前tokens wording must not come back");
}

// Ticket 14B/17 W12 — both overspent dimensions are joined with an ideographic comma.
{
	const status = withHostEnforcementEnv({}, () => statusWithBudget({ tokens: 10000, costUsd: 1 }, usageFixture(15000, 1.5)));
	assert.equal(status.includes("；本 Task 当前已超额：tokens 5000、费用 $0.5000"), true, "W12: both overspend items are joined with 、");
}

// Ticket 14B/17 W13 — the unconfigured-budget branch is byte-identical to before this ticket.
{
	const status = withHostEnforcementEnv({}, () => statusWithBudget(undefined, usageFixture(120, 0)));
	assert.equal(status.includes("Budget: 未设累计上限（已知消耗 tokens=120，费用 $0.0000；未知项 tokens 0 项、费用 0 项）"), true, "W13: unconfigured budget line is unchanged");
	assert.equal(status.includes("宿主未强制"), false, "W13: unconfigured branch has no observation suffix");
	assert.equal(status.includes("宿主在上限处强制停止"), false, "W13: unconfigured branch has no hard-stop suffix");
	assert.equal(status.includes("Root: 无预调用控制"), false, "W13: unconfigured branch has no Root disclosure line");
}

// Ticket 14B/17 W14 — the pre-existing Budget (累计) assertions above this block must still pass.

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

// renderTaskStatus shows the explicit TaskSpec opt-out reason, but not the default false
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const disabled = orch.store.create(createTaskSpec({ objective: "no validation", cwd: BASE, validation: { required: false } }, "T-20260905-236"));
	const disabledStatus = orch.renderTaskStatus(disabled);
	assert.match(disabledStatus, /Validation: not required \(TaskSpec 明确不要求验证\)/);

	const defaulted = orch.store.create(createTaskSpec({ objective: "default validation", cwd: BASE }, "T-20260905-237"));
	assert.doesNotMatch(orch.renderTaskStatus(defaulted), /Validation: not required/);
}

// renderTaskStatus shows passed only for a complete validation and fresh Evidence
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-238";
	await delegateWorker(orch, "call-validation-status", taskId);
	await orch.handleSubagentResult(workerResult("call-validation-status", reportFor(taskId, "call-validation-status")));
	const task = orch.store.require(taskId);
	assert.ok(task.lastComparison);
	orch.store.setLastComparison(taskId, { ...task.lastComparison, fresh: true });
	assert.match(orch.renderTaskStatus(orch.store.require(taskId)), /^Validation: passed$/m);

	orch.store.setLastComparison(taskId, { ...task.lastComparison, fresh: false });
	assert.doesNotMatch(orch.renderTaskStatus(orch.store.require(taskId)), /^Validation: passed$/m);
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

const jsonReminder = (taskId) => `JSON only: ${workerReportShapeReminder(taskId)}`;
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
		/needs reconcile:.*stale duration/,
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

// Ticket 01 — a reviewer begin holds no writer-conflict guard, so supersede is
// the only thing standing between a review delegation and a live writer's
// lock: a non-writable begin must never drop a writable waiter whose child is
// not known stopped.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-993";
	await delegateWorker(orch, "call-t7-rw1", taskId);
	await orch.handleSubagentResult(workerResult("call-t7-rw1", reportFor(taskId, "call-t7-rw1")));

	// a re-delegation goes async and its notice is lost: a zombie writable waiter
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-t7-rw2", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	await orch.handleSubagentResult(receiptFor("call-t7-rw2", "run-t7-rw-zombie", "/no-such-async-dir"));
	assert.equal(orch.pendingDelegationCount(), 1);

	// a reviewer begin for the same Task must not delete the live writable waiter
	const review = await orch.beginDelegation(
		{ toolCallId: "call-t7-rw3", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	assert.equal(review.conflict, undefined, "a reviewer begin stays useful beside a pending writer");
	assert.ok(
		(review.warnings ?? []).some((warning) => /not known stopped/.test(warning)),
		review.warnings?.join(" | "),
	);
	assert.ok(orch.getDelegation("call-t7-rw2"), "the writable waiter is kept, not superseded");
	assert.equal(orch.pendingDelegationCount(), 2, "writer and reviewer waiters both survive");

	// the lock still holds: a worker begin is refused before launch
	const refused = await orch.beginDelegation(
		{ toolCallId: "call-t7-rw4", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.equal(refused.conflict?.conflict, true, "the live writer keeps blocking writable begins");
	assert.match(refused.conflict.reason, new RegExp(taskId), "the refusal names the holder Task");
	assert.equal(orch.pendingDelegationCount(), 2, "no second child is registered beside the live writer");

	// the lost notice for the writer run still records its report
	setDirtyTree();
	const late = await orch.handleAsyncNotify(asyncNotify(undefined, JSON.stringify(reportFor(taskId, "call-t7-rw2"))));
	assert.ok(late, "the single-run notice matches the surviving writer waiter");
	assert.match(late.content[0].text, /\[PLANNER-ONLY REVIEW STATE\]/);
	assert.ok(orch.store.require(taskId).reports.length >= 2, "the writer's late report is kept, not discarded");
	assert.equal(orch.pendingDelegationCount(), 1, "only the reviewer waiter remains");
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

// Ticket 27 — a pass that names no revision or digest is bound by
// orchestration from the ReviewRequest the reviewer was shown, then recorded.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-998";
	await delegateWorker(orch, "call-t8-4", taskId);
	await orch.handleSubagentResult(workerResult("call-t8-4", reportFor(taskId, "call-t8-4")));
	const probeInput = { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) };
	await orch.prepareRoleDelegation(probeInput);
	await orch.beginDelegation({ toolCallId: "call-t8-4r", input: probeInput }, BASE);
	const unbound = await orch.handleSubagentResult({
		toolCallId: "call-t8-4r",
		toolName: "subagent",
		input: {},
		content: [{ type: "text", text: JSON.stringify({ taskId, verdict: "pass", summary: "unbound pass", evidenceFresh: true, findings: [] }) }],
		isError: false,
	});
	assert.match(unbound.content[0].text, /decision: accept/);
	assert.equal(orch.store.require(taskId).reviews.length, 1);
	assert.equal(orch.store.require(taskId).reviews.at(-1).reportRevision, 1);
	assert.equal(orch.store.require(taskId).reviews.at(-1).workspaceDigest, orch.store.require(taskId).snapshot?.digest);
	assert.equal(orch.store.require(taskId).state, "completed");
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

// Ticket 32 — an omitted-binding pass must fill from the ReviewRequest the
// reviewer was shown (revision N), not from the Task at record time (N+1).
// The one-task-one-delegation lock would drop the reviewer if a second worker
// began, so the newer report is injected on the store while the reviewer record
// stays live. The lock itself is not relaxed.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-032";
	await delegateWorker(orch, "call-t32-w1", taskId);
	await orch.handleSubagentResult(workerResult("call-t32-w1", reportFor(taskId, "call-t32-w1")));
	assert.equal(orch.store.require(taskId).reports.length, 1);

	const reviewerInput = { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) };
	await orch.prepareRoleDelegation(reviewerInput);
	await orch.beginDelegation({ toolCallId: "call-t32-r", input: reviewerInput }, BASE);

	orch.store.recordReport(taskId, reportFor(taskId, "call-t32-w2"));
	const snap = orch.store.require(taskId).snapshot;
	assert.ok(snap, "the N report left a bound snapshot");
	orch.store.setSnapshot(taskId, { ...snap, reportRevision: 2 });
	assert.equal(orch.store.require(taskId).reports.length, 2);

	const unbound = await orch.handleSubagentResult({
		toolCallId: "call-t32-r",
		toolName: "subagent",
		input: {},
		content: [{ type: "text", text: JSON.stringify({ taskId, verdict: "pass", summary: "unbound pass over N", evidenceFresh: true, findings: [] }) }],
		isError: false,
	});
	assert.ok(unbound, "the reviewer result is consumed, not dropped");
	assert.match(unbound.content[0].text, /reportRevision mismatch/);
	assert.equal(orch.store.require(taskId).reviews.length, 0, "the omitted pass is not stamped as N+1");
	assert.equal(orch.store.require(taskId).state, "reviewing", "the Task does not complete");
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

// Ticket 20 — out-of-scope untracked runtime dirs are not PASS snapshot
// inputs: churn there must not stale the binding, while in-scope untracked
// (E02) and tracked content changes still do.
{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-snapuntracked-"));
	const git = (...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	try {
		git("init", "-q");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		writeFileSync(join(dir, "tracked.txt"), "base\n");
		git("add", ".");
		git("commit", "-m", "base", "-q");

		const runner = realGitRunnerOf(dir);

		// 1 — report bound, then only out-of-scope untracked runtime dirs churn:
		// PASS completes and never reports "workspace snapshot changed since the report".
		{
			const orch = new PlannerOrchestrator({ gitRunner: runner, store: pinnedStore() });
			const spec = { ...specFor("T-20260905-920"), cwd: dir, scope: { allowedPaths: ["tracked.txt"] } };
			await orch.beginDelegation(
				{ toolCallId: "call-t20-1", input: { task: JSON.stringify(spec) } },
				BASE,
			);
			writeFileSync(join(dir, "tracked.txt"), "worker edit\n");
			mkdirSync(join(dir, ".agent-dir"));
			writeFileSync(join(dir, ".agent-dir", "session.json"), "{\"run\":1}\n");
			mkdirSync(join(dir, ".pi"));
			writeFileSync(join(dir, ".pi", "state.log"), "v1\n");
			await orch.handleSubagentResult(workerResult("call-t20-1", {
				version: 1,
				taskId: "T-20260905-920",
				status: "completed",
				summary: "edited tracked.txt",
				changedFiles: ["tracked.txt"],
				validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
				evidence: { cwd: dir, taskId: "T-20260905-920", workerRunId: "call-t20-1", changedPaths: ["tracked.txt"], gitAvailable: true, generatedAt: new Date().toISOString() },
				risks: [],
				unresolved: [],
			}));

			// every delegation rewrites its session/state dirs; the tracked tree is untouched
			writeFileSync(join(dir, ".agent-dir", "session.json"), "{\"run\":2}\n");
			writeFileSync(join(dir, ".pi", "state.log"), "v2\n");
			mkdirSync(join(dir, ".scratch", "session"), { recursive: true });
			writeFileSync(join(dir, ".scratch", "session", "events.ndjson"), "{}\n");

			const verdict = await orch.recordRootVerdict(orch.store.require("T-20260905-920"), "pass", "runtime dirs only");
			assert.equal(verdict.decision.action, "accept", verdict.decision.reason);
			assert.equal(verdict.task.state, "completed");
			assert.ok(
				!/workspace snapshot changed since the report/.test(`${verdict.decision.reason}\n${verdict.evidence ?? ""}`),
				`${verdict.decision.reason} | ${verdict.evidence ?? ""}`,
			);
		}

		// 2 — empty-scope placeholder Task: untracked runtime churn alone does
		// not stale the PASS; a tracked ticket file change still does.
		{
			const orch = new PlannerOrchestrator({ gitRunner: runner, store: pinnedStore() });
			const spec = { ...specFor("T-20260905-921"), cwd: dir, scope: { allowedPaths: [] } };
			await orch.beginDelegation(
				{ toolCallId: "call-t20-2", input: { task: JSON.stringify(spec) } },
				BASE,
			);
			await orch.handleSubagentResult(workerResult("call-t20-2", {
				version: 1,
				taskId: "T-20260905-921",
				status: "completed",
				summary: "placeholder triage, no file changes",
				changedFiles: [],
				validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
				evidence: { cwd: dir, taskId: "T-20260905-921", workerRunId: "call-t20-2", changedPaths: [], gitAvailable: true, generatedAt: new Date().toISOString() },
				risks: [],
				unresolved: [],
			}));

			writeFileSync(join(dir, ".agent-dir", "session.json"), "{\"run\":3}\n");
			mkdirSync(join(dir, ".scratch", "phase-a-08-session"), { recursive: true });
			writeFileSync(join(dir, ".scratch", "phase-a-08-session", "log.ndjson"), "{}\n");

			const verdict = await orch.recordRootVerdict(orch.store.require("T-20260905-921"), "pass", "empty scope, runtime churn only");
			assert.equal(verdict.decision.action, "accept", verdict.decision.reason);
			assert.equal(verdict.task.state, "completed");
			assert.ok(
				!/workspace snapshot changed since the report/.test(`${verdict.decision.reason}\n${verdict.evidence ?? ""}`),
				`${verdict.decision.reason} | ${verdict.evidence ?? ""}`,
			);
		}
		{
			const orch = new PlannerOrchestrator({ gitRunner: runner, store: pinnedStore() });
			const spec = { ...specFor("T-20260905-922"), cwd: dir, scope: { allowedPaths: [] } };
			await orch.beginDelegation(
				{ toolCallId: "call-t20-3", input: { task: JSON.stringify(spec) } },
				BASE,
			);
			await orch.handleSubagentResult(workerResult("call-t20-3", {
				version: 1,
				taskId: "T-20260905-922",
				status: "completed",
				summary: "placeholder triage, no file changes",
				changedFiles: [],
				validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
				evidence: { cwd: dir, taskId: "T-20260905-922", workerRunId: "call-t20-3", changedPaths: [], gitAvailable: true, generatedAt: new Date().toISOString() },
				risks: [],
				unresolved: [],
			}));

			writeFileSync(join(dir, "tracked.txt"), "external edit after the report\n");
			const verdict = await orch.recordRootVerdict(orch.store.require("T-20260905-922"), "pass", "tracked ticket file changed");
			assert.equal(verdict.decision.action, "revalidate");
			assert.ok(
				verdict.decision.reason.includes("workspace snapshot changed since the report")
				|| verdict.decision.reason.includes("content changed since the report"),
				verdict.decision.reason,
			);
			assert.notEqual(verdict.task.state, "completed");
		}

		// 3 — E02 preserved at the snapshot gate: an in-scope untracked file
		// whose content changes after the report still stales the PASS.
		{
			const orch = new PlannerOrchestrator({ gitRunner: runner, store: pinnedStore() });
			const spec = { ...specFor("T-20260905-923"), cwd: dir, scope: { allowedPaths: ["tracked.txt", "notes.md"] } };
			await orch.beginDelegation(
				{ toolCallId: "call-t20-4", input: { task: JSON.stringify(spec) } },
				BASE,
			);
			writeFileSync(join(dir, "tracked.txt"), "worker edit\n");
			writeFileSync(join(dir, "notes.md"), "draft v1\n");
			await orch.handleSubagentResult(workerResult("call-t20-4", {
				version: 1,
				taskId: "T-20260905-923",
				status: "completed",
				summary: "edited tracked.txt, drafted notes.md",
				changedFiles: ["tracked.txt", "notes.md"],
				validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
				evidence: { cwd: dir, taskId: "T-20260905-923", workerRunId: "call-t20-4", changedPaths: ["tracked.txt", "notes.md"], gitAvailable: true, generatedAt: new Date().toISOString() },
				risks: [],
				unresolved: [],
			}));

			writeFileSync(join(dir, "notes.md"), "draft v2 changed after the report\n");
			const verdict = await orch.recordRootVerdict(orch.store.require("T-20260905-923"), "pass", "in-scope untracked changed");
			assert.equal(verdict.decision.action, "revalidate");
			assert.ok(
				verdict.decision.reason.includes("workspace snapshot changed since the report")
				|| verdict.decision.reason.includes("content changed since the report"),
				verdict.decision.reason,
			);
			assert.notEqual(verdict.task.state, "completed");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Ticket 12 round p09-r042 — a complete report is bounded only after a fresh Root comparison.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-042";
	await delegateWorker(orch, "call-12-worker", taskId);
	await orch.handleSubagentResult(workerResult("call-12-worker", reportFor(taskId, "call-12-worker")));
	const task = orch.store.require(taskId);
	const validatorInput = { agent: "oracle", task: `Validate ${taskId}` };

	orch.store.setLastComparison(taskId, { ...task.lastComparison, fresh: true });
	await orch.prepareRoleDelegation(validatorInput);
	assert.match(validatorInput.task, /ORACLE_SUITE=bounded/);
	assert.doesNotMatch(validatorInput.task, /ORACLE_SUITE=full/);

	orch.store.setLastComparison(taskId, { ...orch.store.require(taskId).lastComparison, fresh: false });
	const staleValidatorInput = { agent: "oracle", task: `Validate ${taskId}` };
	await orch.prepareRoleDelegation(staleValidatorInput);
	assert.match(staleValidatorInput.task, /ORACLE_SUITE=full/);
	assert.doesNotMatch(staleValidatorInput.task, /ORACLE_SUITE=bounded/);
}

// Ticket 12 round p09-r043 — partial worker validation with multiple required commands gets missing contract when fresh, full when stale.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260907-043";
	const twoCommandSpec = createTaskSpec({
		taskId,
		objective: "implement two command feature",
		cwd: BASE,
		role: "worker",
		validation: { required: true, commands: ["npm test", "npm run typecheck"] },
	});
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-12-043-worker", input: { task: JSON.stringify(twoCommandSpec) } },
		BASE,
	);
	setDirtyTree();
	await orch.handleSubagentResult(workerResult("call-12-043-worker", {
		...reportFor(taskId, "call-12-043-worker"),
		validation: [
			{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "tests passed" },
		],
	}));
	const task = orch.store.require(taskId);
	orch.store.setLastComparison(taskId, { ...task.lastComparison, fresh: true });

	const validatorInput = { agent: "oracle", task: `Validate ${taskId}` };
	await orch.prepareRoleDelegation(validatorInput);
	assert.match(validatorInput.task, /ORACLE_SUITE=missing/);
	assert.match(validatorInput.task, /npm run typecheck/);
	assert.doesNotMatch(validatorInput.task, /ORACLE_SUITE=bounded/);
	assert.doesNotMatch(validatorInput.task, /ORACLE_SUITE=full/);

	orch.store.setLastComparison(taskId, { ...orch.store.require(taskId).lastComparison, fresh: false });
	const staleValidatorInput = { agent: "oracle", task: `Validate ${taskId}` };
	await orch.prepareRoleDelegation(staleValidatorInput);
	assert.match(staleValidatorInput.task, /ORACLE_SUITE=full/);
	assert.doesNotMatch(staleValidatorInput.task, /ORACLE_SUITE=missing/);
	assert.doesNotMatch(staleValidatorInput.task, /ORACLE_SUITE=bounded/);
}

// Ticket 12 round p10-r044 — an explicit full-suite TaskSpec request wins over bounded.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260907-044";
	const fullSuiteSpec = createTaskSpec({
		taskId,
		objective: "run the complete validation suite",
		cwd: BASE,
		role: "worker",
		validation: { required: true, commands: ["npm test", "npm run test:e2e"] },
	});
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-12-044-worker", input: { task: JSON.stringify(fullSuiteSpec) } },
		BASE,
	);
	setDirtyTree();
	await orch.handleSubagentResult(workerResult("call-12-044-worker", {
		...reportFor(taskId, "call-12-044-worker"),
		validation: [
			{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "unit passed" },
			{ command: "npm run test:e2e", type: "test", status: "passed", exitCode: 0, summary: "e2e passed" },
		],
	}));
	const task = orch.store.require(taskId);
	orch.store.setLastComparison(taskId, { ...task.lastComparison, fresh: true });
	const validatorInput = { agent: "oracle", task: `Validate ${taskId}` };
	await orch.prepareRoleDelegation(validatorInput);
	assert.match(validatorInput.task, /ORACLE_SUITE=full/);
	assert.match(validatorInput.task, /Re-run the listed validation commands/);
	assert.doesNotMatch(validatorInput.task, /ORACLE_SUITE=(?:bounded|missing)/);
	const begin = await orch.beginDelegation({ toolCallId: "call-12-044-validator", input: validatorInput }, BASE);
	assert.equal(Boolean(begin.warnings?.some((warning) => warning.includes("suite conflict"))), false);
}

// Ticket 12 round p10-r045 — a test-file existence check does not cover the
// TaskSpec command, so fresh evidence still requires the full oracle suite and
// does not render Validation: passed. Exact command coverage remains bounded.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-045";
	await delegateWorker(orch, "call-12-045-worker", taskId);
	await orch.handleSubagentResult(workerResult("call-12-045-worker", {
		...reportFor(taskId, "call-12-045-worker"),
		validation: [{ command: "test -f src/parser.test.ts", type: "test", status: "passed", exitCode: 0, summary: "test file exists" }],
	}));
	const task = orch.store.require(taskId);
	orch.store.setLastComparison(taskId, { ...task.lastComparison, fresh: true });
	const validatorInput = { agent: "oracle", task: `Validate ${taskId}` };
	await orch.prepareRoleDelegation(validatorInput);
	assert.match(validatorInput.task, /ORACLE_SUITE=full/);
	assert.doesNotMatch(validatorInput.task, /ORACLE_SUITE=(?:bounded|missing)/);
	assert.doesNotMatch(orch.renderTaskStatus(orch.store.require(taskId)), /Validation: passed/);

	const completeTaskId = "T-20260905-046";
	await delegateWorker(orch, "call-12-045-complete-worker", completeTaskId);
	await orch.handleSubagentResult(workerResult("call-12-045-complete-worker", reportFor(completeTaskId, "call-12-045-complete-worker")));
	const completeTask = orch.store.require(completeTaskId);
	orch.store.setLastComparison(completeTaskId, { ...completeTask.lastComparison, fresh: true });
	const completeValidatorInput = { agent: "oracle", task: `Validate ${completeTaskId}` };
	await orch.prepareRoleDelegation(completeValidatorInput);
	assert.match(completeValidatorInput.task, /ORACLE_SUITE=bounded/);
	assert.match(orch.renderTaskStatus(orch.store.require(completeTaskId)), /Validation: passed/);
}

// Ticket 11 round p08-r035 — an empty non-failed validation list is unknown.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-035";
	await delegateWorker(orch, "call-11-empty-worker", taskId);
	await orch.handleSubagentResult(workerResult("call-11-empty-worker", {
		...reportFor(taskId, "call-11-empty-worker"),
		validation: [],
	}));
	const validatorInput = { agent: "oracle", task: `Validate ${taskId}` };
	await orch.prepareRoleDelegation(validatorInput);
	assert.match(validatorInput.task, /ORACLE_SUITE=full/);
	assert.doesNotMatch(validatorInput.task, /ORACLE_SUITE=bounded/);
}

// Ticket 11 round p08-r037 — not-run and passed with a non-zero exit are not bounded-safe.
for (const [suffix, validation] of [
	["not-run", [{ command: "npm test", type: "test", status: "not-run", exitCode: 0, summary: "not run" }]],
	["passed-nonzero", [{ command: "npm test", type: "test", status: "passed", exitCode: 1, summary: "failed" }]],
]) {
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = `T-20260905-037-${suffix}`;
	await delegateWorker(orch, `call-11-${suffix}-worker`, taskId);
	await orch.handleSubagentResult(workerResult(`call-11-${suffix}-worker`, {
		...reportFor(taskId, `call-11-${suffix}-worker`),
		validation,
	}));
	const validatorInput = { agent: "oracle", task: `Validate ${taskId}` };
	await orch.prepareRoleDelegation(validatorInput);
	assert.match(validatorInput.task, /ORACLE_SUITE=full/);
	assert.doesNotMatch(validatorInput.task, /ORACLE_SUITE=bounded/);
}

// Ticket 06 — bounded Oracle conflicts are visible before launch and at result time.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-061";
	await delegateWorker(orch, "call-06-worker", taskId);
	await orch.handleSubagentResult(workerResult("call-06-worker", reportFor(taskId, "call-06-worker")));
	const completedTask = orch.store.require(taskId);
	orch.store.setLastComparison(taskId, { ...completedTask.lastComparison, fresh: true });

	const boundedInput = {
		agent: "oracle",
		task: `Validate ${taskId} by running npm test`,
	};
	await orch.prepareRoleDelegation(boundedInput);
	const boundedBegin = await orch.beginDelegation({ toolCallId: "call-06-oracle", input: boundedInput }, BASE);
	assert.ok(boundedBegin.warnings?.includes("[PLANNER-ONLY] Oracle suite conflict: Root prompt requests a full suite while mode is bounded."));
	assert.equal(orch.getDelegation("call-06-oracle")?.oracleSuiteConflict, true);
	const boundedReceipt = await orch.handleSubagentResult({
		toolCallId: "call-06-oracle",
		toolName: "subagent",
		details: { asyncId: "run-06-oracle-async", runId: "run-06-oracle-async", asyncDir: "/no-such-dir" },
		content: [{ type: "text", text: "Async: oracle [run-06-oracle-async]\nThe async run is detached and running in the background." }],
		isError: false,
	});
	assert.equal(
		boundedReceipt.content[0].text.split("\n", 1)[0],
		"[PLANNER-ONLY] Oracle suite conflict: Root prompt requests a full suite while mode is bounded.",
	);
	const boundedResult = await orch.handleSubagentResult({
		toolCallId: "call-06-oracle",
		toolName: "subagent",
		details: { mode: "single", runId: "run-06-oracle", results: [{ exitCode: 0, outputState: "present" }] },
		content: [{ type: "text", text: "Validator completed without a WorkerReport." }],
		isError: false,
	});
	assert.equal(
		boundedResult.content[0].text.split("\n", 1)[0],
		"[PLANNER-ONLY] Oracle suite conflict: Root prompt requests a full suite while mode is bounded.",
	);

	const previousOracleMode = process.env.PI_PLANNER_ONLY_ORACLE;
	process.env.PI_PLANNER_ONLY_ORACLE = "full";
	try {
		const fullInput = { agent: "oracle", task: `Validate ${taskId} by running npm test` };
		await orch.prepareRoleDelegation(fullInput);
		const fullBegin = await orch.beginDelegation({ toolCallId: "call-06-oracle-full", input: fullInput }, BASE);
		assert.equal(Boolean(fullBegin.warnings?.includes("[PLANNER-ONLY] Oracle suite conflict: Root prompt requests a full suite while mode is bounded.")), false);
		assert.equal(orch.getDelegation("call-06-oracle-full")?.oracleSuiteConflict, undefined);
	} finally {
		if (previousOracleMode === undefined) delete process.env.PI_PLANNER_ONLY_ORACLE;
		else process.env.PI_PLANNER_ONLY_ORACLE = previousOracleMode;
	}

	const silentInput = { agent: "oracle", task: `Validate ${taskId}` };
	await orch.prepareRoleDelegation(silentInput);
	const silentBegin = await orch.beginDelegation({ toolCallId: "call-06-oracle-silent", input: silentInput }, BASE);
	assert.equal(
		Boolean(silentBegin.warnings?.includes("[PLANNER-ONLY] Oracle suite conflict: Root prompt requests a full suite while mode is bounded.")),
		false,
		"TaskSpec validation.commands containing npm test is not Root prose requesting a full suite",
	);
	assert.equal(orch.getDelegation("call-06-oracle-silent")?.oracleSuiteConflict, undefined);
}

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
		assert.match(outcome.content[0].text, /Reviewer verdict was rejected/);
		assert.match(outcome.content[0].text, /workspace snapshot changed since the report/);
		assert.equal(orch.store.require("T-20260905-831").reviews.length, 0, "the mismatched PASS is not recorded");
		assert.equal(orch.store.require("T-20260905-831").state, "reviewing", "Task state is unchanged");
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
		assert.match(outcome.content[0].text, /Reviewer verdict was rejected/);
		assert.equal(orch.store.require("T-20260905-832").reviews.length, 0, "the unknown-sample PASS is not recorded");
		assert.equal(orch.store.require("T-20260905-832").state, "reviewing", "Task state is unchanged");
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
	const before = store.require(taskId).state;
	const outcome = await orch.handleSubagentResult(
		reviewerResult("call-b2-ps2", taskId, "pass", { workspaceDigest: "0123456789abcdef" }),
	);
	assert.match(outcome.content[0].text, /Reviewer verdict was rejected/);
	assert.match(outcome.content[0].text, /pre-snapshot report/);
	assert.equal(store.require(taskId).reviews.length, 0, "the pre-snapshot PASS is not recorded");
	assert.equal(store.require(taskId).state, before, "Task state is unchanged");
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

// --------------------------------------------------------------------------
// Hardening-gaps residuals — Validator refuse notes, unbound reconcile,
// stale lock follows the live writer, snapshot-mismatch PASS is refused
// --------------------------------------------------------------------------

// A stale holder refused by a bound Validator still gets the needs-reconcile
// note through the Task store (story 36), not only on the Worker refuse path.
{
	let clock = new Date(2026, 8, 5, 12, 0, 0);
	const store = new TaskStore({ now: () => clock });
	const orch = new PlannerOrchestrator({ gitRunner, store });
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-gap-v1", input: { task: JSON.stringify(specFor("T-20260906-101", "worker", BASE)) } },
		BASE,
	);
	clock = new Date(2026, 8, 5, 13, 0, 0);
	const validator = await orch.beginDelegation(
		{ toolCallId: "call-gap-v2", input: { agent: "oracle", task: JSON.stringify(specFor("T-20260906-101", "validator", BASE)) } },
		BASE,
	);
	assert.equal(validator.conflict?.conflict, true, "a validator is refused beside a live writer");
	assert.match(
		store.require("T-20260906-101").stateReason ?? "",
		/needs reconcile:.*stale duration/,
		"the stale holder's needs-reconcile note is recorded when a Validator is refused",
	);
	assert.equal(orch.pendingDelegationCount(), 1, "the refused validator is not registered");
}

// An unbound Validator is refused the same way, and the holder still gets the note.
{
	let clock = new Date(2026, 8, 5, 12, 0, 0);
	const store = new TaskStore({ now: () => clock });
	const orch = new PlannerOrchestrator({ gitRunner, store });
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-gap-uv1", input: { task: JSON.stringify(specFor("T-20260906-102", "worker", BASE)) } },
		BASE,
	);
	clock = new Date(2026, 8, 5, 13, 0, 0);
	const unbound = await orch.beginDelegation(
		{ toolCallId: "call-gap-uv2", input: { agent: "oracle", task: "double-check the claim" } },
		BASE,
	);
	assert.equal(unbound.conflict?.conflict, true, "an unbound validator contends for the same lock");
	assert.match(
		store.require("T-20260906-102").stateReason ?? "",
		/needs reconcile:.*stale duration/,
		"unbound validator refuse also records the note through the Task store",
	);
	assert.equal(orch.pendingDelegationCount(), 1);
}

// An unbound Validator reconciles a finished leftover on the worktree before
// taking the lock, so a lost-notify Worker with terminal artifacts is not
// mistaken for a live writer (steps 1–4 on the tree it will write).
{
	const taskId = "T-20260906-103";
	const runId = "run-gap-uv-ln";
	const layout = artifactLayout(runId, "worker", 0, reportFor(taskId, "call-gap-uv-ln"));
	const orch = new PlannerOrchestrator({
		gitRunner,
		store: pinnedStore(),
		artifactDirs: () => [join(layout.tmp, "artifacts")],
	});
	try {
		setCleanTree();
		await orch.beginDelegation(
			{ toolCallId: "call-gap-uv-ln", input: { task: JSON.stringify(specFor(taskId, "worker", BASE)) } },
			BASE,
		);
		await orch.handleSubagentResult(receiptFor("call-gap-uv-ln", runId, layout.asyncDir));
		assert.equal(orch.pendingDelegationCount(), 1);
		setDirtyTree();
		const next = await orch.beginDelegation(
			{ toolCallId: "call-gap-uv-v", input: { agent: "oracle", task: "double-check the claim" } },
			BASE,
		);
		assert.equal(next.conflict, undefined, "a finished leftover is consumed, not refused as a live writer");
		assert.ok((next.warnings ?? []).some((warning) => /had already finished/.test(warning)), next.warnings?.join(" | "));
		assert.equal(orch.store.require(taskId).reports.length, 1, "the finished Worker run is recorded");
		assert.equal(orch.getDelegation("call-gap-uv-v")?.kind, "validator");
		assert.equal(orch.pendingDelegationCount(), 1, "the validator is the remaining waiter");
	} finally {
		rmSync(layout.tmp, { recursive: true, force: true });
	}
}

// A Worker started from reviewing holds the lock without entering executing.
// Past the stale duration, a second writable begin still records needs-reconcile
// on that holder (story 11/36) — stale follows the live writer, not Task.state.
{
	let clock = new Date(2026, 8, 5, 12, 0, 0);
	const store = new TaskStore({ now: () => clock });
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const taskId = "T-20260906-104";
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-gap-st1", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	setDirtyTree();
	await orch.handleSubagentResult(workerResult("call-gap-st1", reportFor(taskId, "call-gap-st1")));
	assert.equal(store.require(taskId).state, "reviewing");
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-gap-st2", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.equal(store.require(taskId).state, "reviewing", "a writer from reviewing does not take executing");
	assert.equal(orch.pendingDelegationCount(), 1);
	clock = new Date(2026, 8, 5, 13, 0, 0);
	assert.equal(isExecutingStale(store.require(taskId), clock.getTime()), false, "the Task is not executing");
	assert.equal(isHolderStale(store.require(taskId), clock.getTime()), true, "the live writer is past the stale duration");
	const refused = await orch.beginDelegation(
		{ toolCallId: "call-gap-st3", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.equal(refused.conflict?.conflict, true);
	assert.match(refused.conflict.reason ?? "", /not been confirmed exited/, refused.conflict.reason);
	assert.match(refused.conflict.reason ?? "", /not been confirmed exited/, refused.conflict.reason);
	assert.match(
		store.require(taskId).stateReason ?? "",
		/needs reconcile:.*stale duration/,
		"needs-reconcile is recorded for a reviewing Task that still holds a live writer",
	);
}

// --------------------------------------------------------------------------
// Ticket 01 & 02: receipt classification by details & async reviewer notify
// --------------------------------------------------------------------------

// Fixture source: 2026-09-07 probe / analysis P1 (pi-subagents 0.65.1 Oracle-1 foreground run 79ce6075-329f-4fa3-afb4-0d5f7062d4bf)
const oracle1RunId = "79ce6075-329f-4fa3-afb4-0d5f7062d4bf";
const oracle1Details = {
	mode: "single",
	runId: oracle1RunId,
	timeoutMs: 1800000,
	results: [
		{
			index: 0,
			agent: "oracle",
			exitCode: 0,
			outputState: "present",
		},
	],
	mission: {
		status: "completed",
	},
};
const oracle1ForegroundText = [
	"Run fan-out: 1/64 used, 63 remaining",
	"## Bounded Oracle Report for T-20260907-001",
	"",
	"| # | Check | Exit | Key Output |",
	"|---|-------|------|------------|",
	"| 1 | `git log --oneline -2` | 0 | HEAD = `1b103f6 feat: print oracle suite on /planner-only status` |",
	"| 5 | `node --test index.test.mjs` | 0 | 1 test, 1 pass, 0 fail, duration ~1.8 s |",
	"",
	"Verdict: HEAD 1b103f6 implements the ticket. The named test suite passes.",
	"Mission: f244dd20-aea2-4516-9efb-1527894253a6 (completed)",
].join("\n");

// Ticket 01: Oracle-1 fixture returned for validator, explorer, worker
// All three take the completion path, never misclassified as async launch receipt.
{
	// 1. Validator: recorded as validation conclusion
	const orchV = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskIdV = "T-20260905-701";
	orchV.store.create(createTaskSpec({ taskId: taskIdV, objective: `validate ${taskIdV}`, cwd: BASE }));
	await orchV.beginDelegation(
		{ toolCallId: "call-v-fg", input: { async: false, agent: "oracle", task: `Validate ${taskIdV}` } },
		BASE,
	);
	const outcomeV = await orchV.handleSubagentResult({
		toolCallId: "call-v-fg",
		toolName: "subagent",
		input: { async: false },
		details: oracle1Details,
		content: [{ type: "text", text: oracle1ForegroundText }],
	});
	assert.doesNotMatch(outcomeV.content[0].text, /has started/);
	assert.match(outcomeV.content[0].text, /Validator output for task .* is not a WorkerReport; judge it directly/);
	assert.equal(orchV.pendingDelegationCount(), 0);

	// 2. Explorer: output returned as-is
	const orchE = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await orchE.beginDelegation(
		{ toolCallId: "call-e-fg", input: { async: false, agent: "explorer", task: "Explore codebase" } },
		BASE,
	);
	const outcomeE = await orchE.handleSubagentResult({
		toolCallId: "call-e-fg",
		toolName: "subagent",
		input: { async: false },
		details: oracle1Details,
		content: [{ type: "text", text: oracle1ForegroundText }],
	});
	assert.doesNotMatch(outcomeE.content[0].text, /has started/);
	assert.equal(outcomeE.content[0].text, oracle1ForegroundText);
	assert.equal(orchE.pendingDelegationCount(), 0);

	// 3. Worker: enters WorkerReport parsing
	const orchW = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskIdW = "T-20260905-702";
	await orchW.beginDelegation(
		{ toolCallId: "call-w-fg", input: { async: false, task: JSON.stringify(specFor(taskIdW)) } },
		BASE,
	);
	const outcomeW = await orchW.handleSubagentResult({
		toolCallId: "call-w-fg",
		toolName: "subagent",
		input: { async: false },
		details: oracle1Details,
		content: [{ type: "text", text: oracle1ForegroundText }],
	});
	assert.doesNotMatch(outcomeW.content[0].text, /has started/);
	assert.match(outcomeW.content[0].text, /not a valid WorkerReport|did not contain a WorkerReport/);
	assert.equal(orchW.pendingDelegationCount(), 0);
}

// Ticket 01: Caller explicit async:false disables prose heuristics regardless of content
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-703";
	await orch.beginDelegation(
		{ toolCallId: "call-af-fg", input: { async: false, task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	const textWithAsyncProse = [
		"Async: worker [custom-fake-run-id]",
		"The async run is detached and running in the background.",
	].join("\n");
	const outcome = await orch.handleSubagentResult({
		toolCallId: "call-af-fg",
		toolName: "subagent",
		input: { async: false },
		details: { runId: "fg-run-custom" },
		content: [{ type: "text", text: textWithAsyncProse }],
	});
	assert.doesNotMatch(outcome.content[0].text, /has started/);
	assert.match(outcome.content[0].text, /not a valid WorkerReport|did not contain a WorkerReport/);
	assert.equal(orch.pendingDelegationCount(), 0);
}

// Ticket 01: Real async receipt (details has asyncId) contains runId and bg_wait id=<runId> guide
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-704";
	await orch.beginDelegation(
		{ toolCallId: "call-ar-receipt", input: { async: true, task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	const receipt = await orch.handleSubagentResult({
		toolCallId: "call-ar-receipt",
		toolName: "subagent",
		details: { asyncId: oracle1RunId, runId: oracle1RunId, asyncDir: "/no-such-dir" },
		content: [{ type: "text", text: `Async: worker [${oracle1RunId}]\nThe async run is detached and running in the background.` }],
	});
	assert.match(receipt.content[0].text, /has started/);
	assert.match(receipt.content[0].text, new RegExp(oracle1RunId));
	assert.match(receipt.content[0].text, new RegExp(`bg_wait id=${oracle1RunId}`));
	assert.match(receipt.content[0].text, /bg_wait without an id may report empty briefly after launch/);
	assert.equal(orch.pendingDelegationCount(), 1);
}

// Ticket 02: Async Reviewer notify dispatches via ReviewResult path, identical to sync path
{
	const validReviewBody = (taskId, digest) => ({
		taskId,
		verdict: "request_changes",
		summary: "Need test additions and fix lockfile.",
		evidenceFresh: true,
		findings: [{ severity: "major", category: "correctness", description: "Missing unit test", requestedChange: "Add test" }],
		reportRevision: 1,
		workspaceDigest: digest,
	});

	const reviewerNotify = (runId, body) =>
		`Background task completed: **reviewer**\n\n${typeof body === "string" ? body : JSON.stringify(body)}\n\nChild runs: ${runId}`;

	// 1. Legal ReviewResult: review round advances, decision produced, no WorkerReport error
	{
		const runIdAsync = "run-rev-legal-async";
		const runIdSync = "run-rev-legal-sync";

		const orchAsync = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const taskAsync = "T-20260905-710";
		await delegateWorker(orchAsync, "call-w-710a", taskAsync);
		await orchAsync.handleSubagentResult(workerResult("call-w-710a", reportFor(taskAsync, "call-w-710a")));
		const digestAsync = orchAsync.store.require(taskAsync).snapshot?.digest;

		await orchAsync.beginDelegation(
			{ toolCallId: "call-r-710a", input: { agent: "reviewer", task: `Review ${taskAsync}` } },
			BASE,
		);
		await orchAsync.handleSubagentResult({
			toolCallId: "call-r-710a",
			toolName: "subagent",
			details: { asyncId: runIdAsync, runId: runIdAsync, asyncDir: "/no-such-dir" },
			content: [{ type: "text", text: `Async: reviewer [${runIdAsync}]\nThe async run is detached and running in the background.` }],
		});
		const asyncOutcome = await orchAsync.handleAsyncNotify(reviewerNotify(runIdAsync, validReviewBody(taskAsync, digestAsync)));

		assert.doesNotMatch(asyncOutcome.content[0].text, /WorkerReport/);
		assert.match(asyncOutcome.content[0].text, /\[FRESH REVIEWER\] verdict: request_changes/);
		assert.match(asyncOutcome.content[0].text, /decision: request_changes/);
		const asyncFinal = orchAsync.store.require(taskAsync);
		assert.equal(asyncFinal.state, "changes_requested");
		assert.equal(asyncFinal.reviewRound, 1);
		assert.equal(asyncFinal.reviews.length, 1);
		assert.equal(asyncFinal.reportCorrections, 0);

		// Sync path with identical input
		const orchSync = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const taskSync = "T-20260905-710";
		await delegateWorker(orchSync, "call-w-710s", taskSync);
		await orchSync.handleSubagentResult(workerResult("call-w-710s", reportFor(taskSync, "call-w-710s")));
		const digestSync = orchSync.store.require(taskSync).snapshot?.digest;

		await orchSync.beginDelegation(
			{ toolCallId: "call-r-710s", input: { agent: "reviewer", task: `Review ${taskSync}` } },
			BASE,
		);
		const syncOutcome = await orchSync.handleSubagentResult({
			toolCallId: "call-r-710s",
			toolName: "subagent",
			details: { mode: "single", runId: runIdSync, results: [{ exitCode: 0, outputState: "present" }] },
			content: [{ type: "text", text: JSON.stringify(validReviewBody(taskSync, digestSync)) }],
		});

		assert.doesNotMatch(syncOutcome.content[0].text, /WorkerReport/);
		assert.match(syncOutcome.content[0].text, /\[FRESH REVIEWER\] verdict: request_changes/);
		const syncFinal = orchSync.store.require(taskSync);

		assert.equal(asyncFinal.state, syncFinal.state);
		assert.equal(asyncFinal.reviewRound, syncFinal.reviewRound);
		assert.equal(asyncFinal.reportCorrections, syncFinal.reportCorrections);
		assert.equal(asyncFinal.reviews.length, syncFinal.reviews.length);
		assert.equal(asyncFinal.reviews[0].verdict, syncFinal.reviews[0].verdict);
		assert.equal(asyncFinal.reviews[0].summary, syncFinal.reviews[0].summary);
	}

	// 2. Mismatched taskId or reportRevision: rejected identically in sync and async
	{
		// 2a. TaskId mismatch
		const taskAsyncId = "T-20260905-711";
		const orchAsync = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		await delegateWorker(orchAsync, "call-w-711a", taskAsyncId);
		await orchAsync.handleSubagentResult(workerResult("call-w-711a", reportFor(taskAsyncId, "call-w-711a")));
		const digestA = orchAsync.store.require(taskAsyncId).snapshot?.digest;
		await orchAsync.beginDelegation(
			{ toolCallId: "call-r-711a", input: { agent: "reviewer", task: `Review ${taskAsyncId}` } },
			BASE,
		);
		await orchAsync.handleSubagentResult({
			toolCallId: "call-r-711a",
			toolName: "subagent",
			details: { asyncId: "run-mismatch-a", runId: "run-mismatch-a", asyncDir: "/no-such-dir" },
			content: [{ type: "text", text: "Async: reviewer [run-mismatch-a]\nThe async run is detached and running in the background." }],
		});
		const wrongTaskReview = validReviewBody("T-WRONG-TASK", digestA);
		const asyncMismatchedTask = await orchAsync.handleAsyncNotify(reviewerNotify("run-mismatch-a", wrongTaskReview));

		const orchSync = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		await delegateWorker(orchSync, "call-w-711s", taskAsyncId);
		await orchSync.handleSubagentResult(workerResult("call-w-711s", reportFor(taskAsyncId, "call-w-711s")));
		await orchSync.beginDelegation(
			{ toolCallId: "call-r-711s", input: { agent: "reviewer", task: `Review ${taskAsyncId}` } },
			BASE,
		);
		const syncMismatchedTask = await orchSync.handleSubagentResult({
			toolCallId: "call-r-711s",
			toolName: "subagent",
			details: { mode: "single", runId: "run-mismatch-s", results: [{ exitCode: 0, outputState: "present" }] },
			content: [{ type: "text", text: JSON.stringify(wrongTaskReview) }],
		});

		assert.match(asyncMismatchedTask.content[0].text, /ReviewResult taskId mismatch: expected T-20260905-711, got T-WRONG-TASK/);
		assert.match(syncMismatchedTask.content[0].text, /ReviewResult taskId mismatch: expected T-20260905-711, got T-WRONG-TASK/);
		assert.equal(orchAsync.store.require(taskAsyncId).state, orchSync.store.require(taskAsyncId).state);
		assert.equal(orchAsync.store.require(taskAsyncId).reviewRound, orchSync.store.require(taskAsyncId).reviewRound);
		assert.equal(orchAsync.store.require(taskAsyncId).reviews.length, 0);
		assert.equal(orchSync.store.require(taskAsyncId).reviews.length, 0);

		// 2b. Report revision mismatch
		const wrongRevReview = { ...validReviewBody(taskAsyncId, digestA), reportRevision: 99 };
		await orchAsync.beginDelegation(
			{ toolCallId: "call-r-711b", input: { agent: "reviewer", task: `Review ${taskAsyncId}` } },
			BASE,
		);
		await orchAsync.handleSubagentResult({
			toolCallId: "call-r-711b",
			toolName: "subagent",
			details: { asyncId: "run-mismatch-b", runId: "run-mismatch-b", asyncDir: "/no-such-dir" },
			content: [{ type: "text", text: "Async: reviewer [run-mismatch-b]\nThe async run is detached and running in the background." }],
		});
		const asyncMismatchedRev = await orchAsync.handleAsyncNotify(reviewerNotify("run-mismatch-b", wrongRevReview));

		await orchSync.beginDelegation(
			{ toolCallId: "call-r-711sb", input: { agent: "reviewer", task: `Review ${taskAsyncId}` } },
			BASE,
		);
		const syncMismatchedRev = await orchSync.handleSubagentResult({
			toolCallId: "call-r-711sb",
			toolName: "subagent",
			details: { mode: "single", runId: "run-mismatch-sb", results: [{ exitCode: 0, outputState: "present" }] },
			content: [{ type: "text", text: JSON.stringify(wrongRevReview) }],
		});

		assert.match(asyncMismatchedRev.content[0].text, /ReviewResult reportRevision mismatch: it reviewed revision 99, but the latest report is revision 1/);
		assert.match(syncMismatchedRev.content[0].text, /ReviewResult reportRevision mismatch: it reviewed revision 99, but the latest report is revision 1/);
		assert.equal(orchAsync.store.require(taskAsyncId).state, orchSync.store.require(taskAsyncId).state);
		assert.equal(orchAsync.store.require(taskAsyncId).reviewRound, orchSync.store.require(taskAsyncId).reviewRound);
	}

	// 3. Truncated Reviewer output without output file: rejected identically, no WorkerReport correction
	{
		const taskTruncId = "T-20260905-712";
		const truncatedReviewText = `{"taskId":"${taskTruncId}","verdict":"pass"...[preview truncated]`;

		const orchAsync = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		await delegateWorker(orchAsync, "call-w-712a", taskTruncId);
		await orchAsync.handleSubagentResult(workerResult("call-w-712a", reportFor(taskTruncId, "call-w-712a")));
		await orchAsync.beginDelegation(
			{ toolCallId: "call-r-712a", input: { agent: "reviewer", task: `Review ${taskTruncId}` } },
			BASE,
		);
		await orchAsync.handleSubagentResult({
			toolCallId: "call-r-712a",
			toolName: "subagent",
			details: { asyncId: "run-trunc-a", runId: "run-trunc-a", asyncDir: "/no-such-dir" },
			content: [{ type: "text", text: "Async: reviewer [run-trunc-a]\nThe async run is detached and running in the background." }],
		});
		const asyncTruncOutcome = await orchAsync.handleAsyncNotify(reviewerNotify("run-trunc-a", truncatedReviewText));

		const orchSync = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		await delegateWorker(orchSync, "call-w-712s", taskTruncId);
		await orchSync.handleSubagentResult(workerResult("call-w-712s", reportFor(taskTruncId, "call-w-712s")));
		await orchSync.beginDelegation(
			{ toolCallId: "call-r-712s", input: { agent: "reviewer", task: `Review ${taskTruncId}` } },
			BASE,
		);
		const syncTruncOutcome = await orchSync.handleSubagentResult({
			toolCallId: "call-r-712s",
			toolName: "subagent",
			details: { mode: "single", runId: "run-trunc-s", results: [{ exitCode: 0, outputState: "present" }] },
			content: [{ type: "text", text: truncatedReviewText }],
		});

		assert.match(asyncTruncOutcome.content[0].text, /Reviewer output for task T-20260905-712 is not a valid ReviewResult/);
		assert.match(syncTruncOutcome.content[0].text, /Reviewer output for task T-20260905-712 is not a valid ReviewResult/);
		assert.doesNotMatch(asyncTruncOutcome.content[0].text, /report-only correction/);
		assert.doesNotMatch(syncTruncOutcome.content[0].text, /report-only correction/);
		assert.equal(orchAsync.store.require(taskTruncId).reportCorrections, 0);
		assert.equal(orchSync.store.require(taskTruncId).reportCorrections, 0);
		assert.equal(orchAsync.store.require(taskTruncId).state, orchSync.store.require(taskTruncId).state);
		assert.equal(orchAsync.store.require(taskTruncId).reviewRound, orchSync.store.require(taskTruncId).reviewRound);
	}
}

// ==========================================================================
// Issue 03: Embedded TaskSpec explicit failure, title alias, canonical id echo
// ==========================================================================
{
	// ----------------------------------------------------------------------
	// Checkbox 1: Embedded JSON has taskId, acceptanceCriteria, scope but lacks objective
	// Delegation rejected before launch, reason points out missing objective,
	// NO Task created (store empty), NO child process started (delegation not registered).
	// ----------------------------------------------------------------------
	{
		const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const promptWithMissingObj = `Please implement the feature according to spec:
\`\`\`json
{
  "taskId": "oracle-status-line-01",
  "acceptanceCriteria": ["status line tests pass"],
  "scope": { "allowedPaths": ["src/status.ts"] }
}
\`\`\``;
		const outcome = await orch.beginDelegation(
			{ toolCallId: "call-cb1-worker", input: { agent: "worker", task: promptWithMissingObj } },
			BASE,
		);
		assert.ok(outcome.block !== undefined, "delegation should be blocked");
		assert.match(outcome.block.reason, /objective must be a non-empty string/, "reason must explicitly point out missing objective");
		assert.equal(orch.store.list().length, 0, "store must be completely empty: no Task created");
		assert.equal(orch.hasPendingDelegation("oracle-status-line-01"), false, "no pending delegation registered");
	}

	// ----------------------------------------------------------------------
	// Checkbox 2: Embedded JSON validation.required is not a boolean
	// Delegation rejected, reason points out field and expected type.
	// ----------------------------------------------------------------------
	{
		const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const promptWithInvalidVal = `Please work on this:
\`\`\`json
{
  "taskId": "oracle-status-line-01",
  "objective": "Add status line",
  "validation": {
    "required": "true",
    "commands": ["npm test"]
  }
}
\`\`\``;
		const outcome = await orch.beginDelegation(
			{ toolCallId: "call-cb2-worker", input: { agent: "worker", task: promptWithInvalidVal } },
			BASE,
		);
		assert.ok(outcome.block !== undefined, "delegation should be blocked");
		assert.match(outcome.block.reason, /validation\.required must be a boolean/, "reason must name validation.required and boolean type");
		assert.equal(orch.store.list().length, 0, "store must be completely empty: no Task created");
	}

	// ----------------------------------------------------------------------
	// Checkbox 3: Embedded JSON uses title instead of objective
	// Task created successfully, objective takes title value, result explains alias used.
	// ----------------------------------------------------------------------
	{
		const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const promptWithTitle = `Please work on this:
\`\`\`json
{
  "taskId": "oracle-status-line-01",
  "title": "Implement status line component",
  "acceptanceCriteria": ["tests pass"]
}
\`\`\``;
		const outcome = await orch.beginDelegation(
			{ toolCallId: "call-cb3-worker", input: { agent: "worker", task: promptWithTitle } },
			BASE,
		);
		assert.equal(outcome.block, undefined, "delegation must not be blocked");
		assert.ok(outcome.task !== undefined, "task must be created");
		assert.equal(outcome.task.spec.objective, "Implement status line component", "objective takes title value");
		assert.equal(outcome.task.titleAliasUsed, true, "titleAliasUsed recorded");
		assert.ok(outcome.warnings?.some((w) => w.includes("used 'title' as alias for 'objective'")), "warnings explains title alias used");

		const canonicalId = outcome.task.taskId;
		const report = {
			...reportFor(canonicalId, "call-cb3-worker"),
			taskId: canonicalId,
		};
		const result = await orch.handleSubagentResult(workerResult("call-cb3-worker", report));
		assert.match(result.content[0].text, /TaskSpec used 'title' as alias for 'objective'/, "result explains title alias used");
	}

	// ----------------------------------------------------------------------
	// Checkbox 4: Delegation text has NO characteristic fields at all
	// Placeholder Task created, delegation result first line states placeholder fact and canonical id.
	// Strict mode blocks unstructured delegation.
	// ----------------------------------------------------------------------
	{
		const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const plainTextPrompt = "Please inspect src/ and explain the code structure.";
		const outcome = await orch.beginDelegation(
			{ toolCallId: "call-cb4-worker", input: { agent: "worker", task: plainTextPrompt } },
			BASE,
		);
		assert.equal(outcome.block, undefined, "warn mode allows delegation");
		assert.ok(outcome.task !== undefined, "task created");
		assert.equal(outcome.task.isPlaceholder, true, "isPlaceholder marked true");
		assert.equal(outcome.task.spec.objective, "(unspecified — parent did not embed a TaskSpec)");

		const canonicalId = outcome.task.taskId;
		const report = {
			...reportFor(canonicalId, "call-cb4-worker"),
			taskId: canonicalId,
		};
		const result = await orch.handleSubagentResult(workerResult("call-cb4-worker", report));
		const firstLine = result.content[0].text.split("\n")[0];
		assert.equal(
			firstLine,
			`[PLANNER-ONLY] Placeholder task ${canonicalId} created (parent did not embed a TaskSpec; canonical id: ${canonicalId}).`,
			"first line of worker result must state placeholder fact and canonical id",
		);

		// Also verify async launch receipt first line:
		const orchAsync = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const outcomeAsync = await orchAsync.beginDelegation(
			{ toolCallId: "call-cb4-async", input: { agent: "worker", async: true, task: plainTextPrompt } },
			BASE,
		);
		assert.equal(outcomeAsync.task.isPlaceholder, true);
		const asyncReceipt = await orchAsync.handleSubagentResult({
			toolCallId: "call-cb4-async",
			toolName: "subagent",
			details: { asyncId: "run-cb4-async", runId: "run-cb4-async", asyncDir: "/no-dir" },
			content: [{ type: "text", text: "Async: worker [run-cb4-async]\nDetached and running in the background." }],
		});
		assert.equal(
			asyncReceipt.content[0].text.split("\n")[0],
			`[PLANNER-ONLY] Placeholder task ${outcomeAsync.task.taskId} created (parent did not embed a TaskSpec; canonical id: ${outcomeAsync.task.taskId}).`,
			"first line of async receipt must state placeholder fact and canonical id",
		);

		// Strict mode guard verification:
		const orchStrict = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "strict" });
		const strictOutcome = await orchStrict.beginDelegation(
			{ toolCallId: "call-cb4-strict", input: { agent: "worker", task: plainTextPrompt } },
			BASE,
		);
		assert.ok(strictOutcome.block !== undefined, "strict mode must block unstructured delegation");
		assert.match(strictOutcome.block.reason, /delegated without an embedded TaskSpec/);
	}

	// ----------------------------------------------------------------------
	// Checkbox 5: Worker reports with Root self-made ID (oracle-status-line-01)
	// Resolved as alias, report accepted and recorded under canonical Task, result echoes canonical id.
	// ----------------------------------------------------------------------
	{
		const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const customId = "oracle-status-line-01";
		const promptWithCustomId = `Please work on this:\n\`\`\`json\n${JSON.stringify({
			taskId: customId,
			title: "Implement status line component",
			acceptanceCriteria: ["tests pass"],
		})}\n\`\`\``;
		const outcome = await orch.beginDelegation(
			{ toolCallId: "call-cb5-worker", input: { agent: "worker", task: promptWithCustomId } },
			BASE,
		);
		const canonicalId = outcome.task.taskId;
		assert.match(canonicalId, /^T-\d{8}-\d{3}$/, "plugin assigns canonical taskId");
		assert.ok(outcome.task.aliases.includes(customId), "Root self-made id is retained as alias");
		assert.ok(outcome.warnings?.some((w) => w.includes(`TaskSpec id ${customId} replaced by ${canonicalId}`)), "warning notes id replaced and kept as alias");

		// Worker returns a report claiming the Root-provided ID:
		const workerReportWithCustomId = {
			...reportFor(customId, "call-cb5-worker"),
			taskId: customId,
			evidence: {
				...reportFor(customId, "call-cb5-worker").evidence,
				taskId: customId,
			},
		};
		const result = await orch.handleSubagentResult(workerResult("call-cb5-worker", workerReportWithCustomId));
		// Report must be accepted (not rejected by identity check) and recorded under canonical Task:
		assert.equal(orch.store.require(canonicalId).reports.length, 1, "report recorded under canonical Task");
		// Store resolves alias:
		assert.equal(orch.store.get(customId)?.taskId, canonicalId, "store resolves Root self-made id to canonical Task");
		// Result echoes canonical taskId, alias, and normalisation:
		assert.match(result.content[0].text, new RegExp(`taskId: ${canonicalId}`), "result echoes canonical taskId");
		assert.match(result.content[0].text, new RegExp(`aliases: ${customId} \\(Root-provided id is kept as alias; canonical id is ${canonicalId}\\)`), "result explains Root-provided id kept as alias");
		assert.match(result.content[0].text, new RegExp(`Report normalised: taskId ${customId} → ${canonicalId}`), "result echoes normalized taskId");
	}

	// ----------------------------------------------------------------------
	// Checkbox 6: Reviewer packet in legal paths carries non-empty objective and acceptanceCriteria
	// ----------------------------------------------------------------------
	{
		// Path 6A: Task created via title alias; reviewer delegated on that task
		const orchA = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const promptTitle = `\`\`\`json\n${JSON.stringify({
			taskId: "oracle-status-line-01",
			title: "Implement status line component",
			acceptanceCriteria: ["unit tests pass", "integration passes"],
		})}\n\`\`\``;
		const outcomeA = await orchA.beginDelegation(
			{ toolCallId: "call-cb6a-worker", input: { agent: "worker", task: promptTitle } },
			BASE,
		);
		const canonicalIdA = outcomeA.task.taskId;
		await orchA.handleSubagentResult(workerResult("call-cb6a-worker", reportFor(canonicalIdA, "call-cb6a-worker")));

		// Now prepare Reviewer delegation
		const reviewerInputA = { agent: "reviewer", task: `Review task ${canonicalIdA}` };
		await orchA.prepareRoleDelegation(reviewerInputA);
		const requestA = extractReviewRequest(reviewerInputA.task);
		assert.ok(requestA !== undefined, "ReviewRequest packet built");
		assert.ok(requestA.taskSpec !== undefined, "Reviewer packet carries taskSpec");
		assert.equal(requestA.taskSpec.objective, "Implement status line component", "Reviewer packet objective is non-empty and from title");
		assert.ok(Array.isArray(requestA.taskSpec.acceptanceCriteria) && requestA.taskSpec.acceptanceCriteria.length === 2, "Reviewer packet acceptanceCriteria is non-empty array");
		assert.equal(requestA.taskId, canonicalIdA, "Reviewer packet targets canonical taskId");

		// Path 6B: Direct embedded TaskSpec in Reviewer delegation prompt (with title and acceptanceCriteria)
		const orchB = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const directReviewerPrompt = `Review this task:
\`\`\`json
{
  "taskId": "T-20260905-999",
  "title": "Direct spec title",
  "acceptanceCriteria": ["direct criterion 1"]
}
\`\`\``;
		const reviewerInputB = { agent: "reviewer", task: directReviewerPrompt };
		await orchB.prepareRoleDelegation(reviewerInputB);
		const requestB = extractReviewRequest(reviewerInputB.task);
		assert.ok(requestB !== undefined, "ReviewRequest packet built for direct spec");
		assert.ok(requestB.taskSpec !== undefined, "taskSpec carried in reviewer packet");
		assert.equal(requestB.taskSpec.objective, "Direct spec title", "Reviewer packet has non-empty objective");
		assert.deepEqual(requestB.taskSpec.acceptanceCriteria, ["direct criterion 1"], "Reviewer packet has non-empty acceptanceCriteria");
	}
}

// ----------------------------------------------------------------------
// Issue 04: Delegations in status rendering with role, actual model, thinking
// ----------------------------------------------------------------------
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260907-stat1";
	await delegateWorker(orch, "call-stat-1", taskId);
	orch.noteDelegationModel(taskId, "call-stat-1", "kimi-for-coding:high", "high");

	const task = orch.store.require(taskId);
	const statusOutput = orch.renderTaskStatus(task);
	assert.match(statusOutput, /Delegations:/, "Delegations section present in status");
	assert.match(statusOutput, /worker: kimi-for-coding:high \(thinking: high\)/, "Worker role, model and thinking displayed");

	// When model or thinking not reported, show unknown
	const orch2 = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId2 = "T-20260907-stat2";
	await delegateWorker(orch2, "call-stat-2", taskId2);
	const statusOutput2 = orch2.renderTaskStatus(orch2.store.require(taskId2));
	assert.match(statusOutput2, /worker: unknown \(thinking: unknown\)/, "Unknown model and thinking displayed as unknown without fake defaults");
}

// ----------------------------------------------------------------------
// Issue 04: Context reuse fallback and override notes in worker/validator result
// ----------------------------------------------------------------------
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260907-reuse-stat";
	const workerInput = {
		agent: "worker",
		task: JSON.stringify(specFor(taskId, "worker")),
		reuseTaskId: "T-CROSS-TASK",
	};
	await orch.prepareRoleDelegation(workerInput);
	assert.ok(workerInput.__reuseOutcome, "internal reuse outcome present before beginDelegation");
	const outcome = await orch.beginDelegation({ toolCallId: "call-reuse-note", input: workerInput }, BASE);
	assert.ok(outcome.warnings?.some((w) => w.includes("context reuse request rejected")), "warning emitted when context reuse rejected");
	assert.equal(workerInput.reuseTaskId, undefined, "caller reuseTaskId stripped after beginDelegation");
	assert.equal(workerInput.__reuseOutcome, undefined, "private __reuseOutcome stripped after beginDelegation");
	assert.equal(workerInput.__contextOverridden, undefined, "private __contextOverridden stripped after beginDelegation");

	const result = await orch.handleSubagentResult(workerResult("call-reuse-note", reportFor(taskId, "call-reuse-note")));
	assert.match(result.content[0].text, /Note: context reuse fell back to fresh/, "Worker result explains fallback to fresh");
}

{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260907-fork-strip";
	const workerInput = {
		agent: "worker",
		context: "fork",
		task: JSON.stringify(specFor(taskId, "worker")),
		reuseTaskId: taskId,
		reuseContext: taskId,
		reuseRootHistory: true,
		reuse: true,
	};
	await orch.prepareRoleDelegation(workerInput);
	assert.equal(workerInput.context, "fresh", "context forced to fresh");
	assert.equal(workerInput.__contextOverridden, true, "__contextOverridden set before beginDelegation");
	const outcome = await orch.beginDelegation({ toolCallId: "call-fork-strip", input: workerInput }, BASE);
	assert.ok(outcome.warnings?.some((w) => w.includes("context 'fork' overridden to 'fresh'")), "fork override warning emitted");

	for (const key of ["__reuseOutcome", "__contextOverridden", "reuseTaskId", "reuseContext", "reuseRootHistory", "reuse"]) {
		assert.equal(key in workerInput, false, `key ${key} must be stripped from input handed to host`);
	}
}

// --------------------------------------------------------------------------
// Issue 05: Default floors, stricter limit resolution, limits in results,
// and budget-stop handling leaving executing state.
// --------------------------------------------------------------------------

// 1. Initial worker has usage floor but no tool floor; limits reported in result
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-921";
	const workerInput = {
		agent: "worker",
		task: JSON.stringify(specFor(taskId, "worker")),
	};
	await orch.prepareRoleDelegation(workerInput);
	assert.equal(workerInput.toolBudget, undefined, "Worker initial has no default toolBudget");
	assert.deepEqual(workerInput.usageBudget, {
		tokens: { hard: 100000 },
		costUsd: { hard: 0.5 },
	}, "Worker initial gets default usageBudget");

	await orch.beginDelegation({ toolCallId: "call-f01", input: workerInput }, BASE);
	const res = await orch.handleSubagentResult(workerResult("call-f01", reportFor(taskId, "call-f01")));
	assert.match(res.content[0].text, /Limits: usageBudget\.tokens\.hard=100000 \(floor\), usageBudget\.costUsd\.hard=0\.5 \(floor\)/);
}

// 2. Report correction worker delegation has bounded floors (toolBudget 20, tokens 40k, costUsd 0.10)
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-922";
	// First delegation returns a valid report so task.reports.length === 1
	const workerInput1 = { agent: "worker", task: JSON.stringify(specFor(taskId, "worker")) };
	await orch.prepareRoleDelegation(workerInput1);
	await orch.beginDelegation({ toolCallId: "call-f02-1", input: workerInput1 }, BASE);
	await orch.handleSubagentResult(workerResult("call-f02-1", reportFor(taskId, "call-f02-1")));

	// Second delegation is a report correction worker
	const workerInput2 = { agent: "worker", task: `Fix report for ${taskId}` };
	await orch.prepareRoleDelegation(workerInput2);
	assert.deepEqual(workerInput2.toolBudget, { hard: 20 }, "Correction worker receives default toolBudget floor");
	assert.deepEqual(workerInput2.usageBudget, {
		tokens: { hard: 40000 },
		costUsd: { hard: 0.1 },
	}, "Correction worker receives default usageBudget floor");

	await orch.beginDelegation({ toolCallId: "call-f02-2", input: workerInput2 }, BASE);
	const res2 = await orch.handleSubagentResult(workerResult("call-f02-2", reportFor(taskId, "call-f02-2")));
	assert.match(res2.content[0].text, /Limits: toolBudget\.hard=20 \(floor\), usageBudget\.tokens\.hard=40000 \(floor\), usageBudget\.costUsd\.hard=0\.1 \(floor\)/);
}

// 3. Stricter caller vs stricter taskSpec vs floor
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-923";
	const spec = {
		...specFor(taskId, "worker"),
		budget: {
			usageBudget: { costUsd: { hard: 0.05 } },
		},
	};
	const workerInput = {
		agent: "worker",
		task: JSON.stringify(spec),
		usageBudget: { tokens: { hard: 20000 } },
	};
	await orch.prepareRoleDelegation(workerInput);
	// tokens: caller 20k (< floor 100k); costUsd: spec 0.05 (< floor 0.5)
	assert.deepEqual(workerInput.usageBudget, {
		tokens: { hard: 20000 },
		costUsd: { hard: 0.05 },
	});

	await orch.beginDelegation({ toolCallId: "call-f03", input: workerInput }, BASE);
	const res = await orch.handleSubagentResult(workerResult("call-f03", reportFor(taskId, "call-f03")));
	assert.match(res.content[0].text, /Limits: usageBudget\.tokens\.hard=20000 \(caller\), usageBudget\.costUsd\.hard=0\.05 \(taskSpec\)/);
}

// 4. Synchronous child stopped due to tool limit: task leaves executing, stop reason reported
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-924";
	const workerInput = { agent: "worker", task: JSON.stringify(specFor(taskId, "worker")) };
	await orch.prepareRoleDelegation(workerInput);
	await orch.beginDelegation({ toolCallId: "call-f04", input: workerInput }, BASE);
	const task = orch.store.require(taskId);
	assert.equal(task.state, "executing");

	const res = await orch.handleSubagentResult({
		toolCallId: "call-f04",
		toolName: "subagent",
		input: workerInput,
		content: [{ type: "text", text: "Subagent stopped: toolBudget hard limit reached (20 calls made)" }],
		details: { status: "stopped" },
		isError: false,
	});

	assert.match(res.content[0].text, /\[PLANNER-ONLY\] Subagent for task T-20260905-924 stopped/i);
	assert.match(res.content[0].text, /Limits:/);
	const updatedTask = orch.store.require(taskId);
	assert.notEqual(updatedTask.state, "executing");
	assert.equal(updatedTask.state, "failed");
	assert.match(updatedTask.stateReason ?? "", /stopped/);
	assert.equal(orch.pendingDelegationCount(), 0);
}

// p07-r029: enabled policy rejects before launch and injects matching values on success.
{
	const saved = {
		flag: process.env.PI_PLANNER_ONLY_ROLE_MODELS,
		workerModel: process.env.PI_PLANNER_ONLY_MODEL_WORKER,
		workerThinking: process.env.PI_PLANNER_ONLY_THINKING_WORKER,
	};
	try {
		process.env.PI_PLANNER_ONLY_ROLE_MODELS = "1";
		delete process.env.PI_PLANNER_ONLY_MODEL_REVIEWER;
		delete process.env.PI_PLANNER_ONLY_THINKING_REVIEWER;
		const missing = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const reviewerInput = { agent: "reviewer", task: "review" };
		const blocked = await missing.beginDelegation({ toolCallId: "call-policy-missing", input: reviewerInput }, BASE);
		assert.match(blocked.block?.reason ?? "", /role model policy is enabled but reviewer is missing model and thinking/);
		assert.equal("model" in reviewerInput, false);

		process.env.PI_PLANNER_ONLY_MODEL_WORKER = "policy-test/worker";
		process.env.PI_PLANNER_ONLY_THINKING_WORKER = "medium";
		const worker = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const workerInput = { agent: "worker", task: JSON.stringify(specFor("T-20260905-927")) };
		const outcome = await worker.beginDelegation({ toolCallId: "call-policy-ok", input: workerInput }, BASE);
		assert.equal(outcome.block, undefined);
		assert.equal(workerInput.model, "policy-test/worker");
		assert.equal(workerInput.thinking, "medium");
	} finally {
		for (const [key, value] of Object.entries({
			PI_PLANNER_ONLY_ROLE_MODELS: saved.flag,
			PI_PLANNER_ONLY_MODEL_WORKER: saved.workerModel,
			PI_PLANNER_ONLY_THINKING_WORKER: saved.workerThinking,
		})) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
}

// p13-r063: every role-model rejection path blocks before launch without mutating caller input.
{
	const saved = {
		flag: process.env.PI_PLANNER_ONLY_ROLE_MODELS,
		workerModel: process.env.PI_PLANNER_ONLY_MODEL_WORKER,
		workerThinking: process.env.PI_PLANNER_ONLY_THINKING_WORKER,
		reviewerModel: process.env.PI_PLANNER_ONLY_MODEL_REVIEWER,
		reviewerThinking: process.env.PI_PLANNER_ONLY_THINKING_REVIEWER,
	};
	try {
		process.env.PI_PLANNER_ONLY_ROLE_MODELS = "1";
		delete process.env.PI_PLANNER_ONLY_MODEL_WORKER;
		delete process.env.PI_PLANNER_ONLY_THINKING_WORKER;
		process.env.PI_PLANNER_ONLY_MODEL_REVIEWER = "policy-test/reviewer";
		process.env.PI_PLANNER_ONLY_THINKING_REVIEWER = "low";
		const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const input = { agent: "worker", task: JSON.stringify(specFor("T-20260905-932")) };
		const blocked = await orch.beginDelegation({ toolCallId: "call-policy-worker-missing", input }, BASE);
		assert.match(blocked.block?.reason ?? "", /role model policy is enabled but worker is missing model and thinking/);
		assert.equal("model" in input, false);
		assert.equal("thinking" in input, false);
	} finally {
		for (const [key, value] of Object.entries({
			PI_PLANNER_ONLY_ROLE_MODELS: saved.flag,
			PI_PLANNER_ONLY_MODEL_WORKER: saved.workerModel,
			PI_PLANNER_ONLY_THINKING_WORKER: saved.workerThinking,
			PI_PLANNER_ONLY_MODEL_REVIEWER: saved.reviewerModel,
			PI_PLANNER_ONLY_THINKING_REVIEWER: saved.reviewerThinking,
		})) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
}

{
	const saved = {
		flag: process.env.PI_PLANNER_ONLY_ROLE_MODELS,
		workerModel: process.env.PI_PLANNER_ONLY_MODEL_WORKER,
		workerThinking: process.env.PI_PLANNER_ONLY_THINKING_WORKER,
	};
	try {
		process.env.PI_PLANNER_ONLY_ROLE_MODELS = "1";
		process.env.PI_PLANNER_ONLY_MODEL_WORKER = "policy-test/worker";
		process.env.PI_PLANNER_ONLY_THINKING_WORKER = "medium level";
		const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const input = { agent: "worker", task: JSON.stringify(specFor("T-20260905-933")) };
		const blocked = await orch.beginDelegation({ toolCallId: "call-policy-worker-invalid", input }, BASE);
		assert.match(blocked.block?.reason ?? "", /cannot resolve worker thinking medium level/);
		assert.equal("model" in input, false);
		assert.equal("thinking" in input, false);
	} finally {
		for (const [key, value] of Object.entries({
			PI_PLANNER_ONLY_ROLE_MODELS: saved.flag,
			PI_PLANNER_ONLY_MODEL_WORKER: saved.workerModel,
			PI_PLANNER_ONLY_THINKING_WORKER: saved.workerThinking,
		})) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
}

{
	const saved = {
		flag: process.env.PI_PLANNER_ONLY_ROLE_MODELS,
		workerModel: process.env.PI_PLANNER_ONLY_MODEL_WORKER,
		workerThinking: process.env.PI_PLANNER_ONLY_THINKING_WORKER,
	};
	try {
		process.env.PI_PLANNER_ONLY_ROLE_MODELS = "1";
		process.env.PI_PLANNER_ONLY_MODEL_WORKER = "policy-test/worker";
		process.env.PI_PLANNER_ONLY_THINKING_WORKER = "medium";
		const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const input = {
			agent: "worker",
			model: "caller/model",
			task: JSON.stringify(specFor("T-20260905-934")),
		};
		const blocked = await orch.beginDelegation({ toolCallId: "call-policy-worker-conflict", input }, BASE);
		assert.match(blocked.block?.reason ?? "", /conflict for worker: caller=caller\/model policy=policy-test\/worker/);
		assert.equal(input.model, "caller/model");
	} finally {
		for (const [key, value] of Object.entries({
			PI_PLANNER_ONLY_ROLE_MODELS: saved.flag,
			PI_PLANNER_ONLY_MODEL_WORKER: saved.workerModel,
			PI_PLANNER_ONLY_THINKING_WORKER: saved.workerThinking,
		})) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
}

// p07-r032: policy status records requested/resolved/actual, unknown is not a mismatch,
// and an observed mismatch stops later controlled launches.
{
	const saved = {
		flag: process.env.PI_PLANNER_ONLY_ROLE_MODELS,
		workerModel: process.env.PI_PLANNER_ONLY_MODEL_WORKER,
		workerThinking: process.env.PI_PLANNER_ONLY_THINKING_WORKER,
	};
	try {
		process.env.PI_PLANNER_ONLY_ROLE_MODELS = "1";
		process.env.PI_PLANNER_ONLY_MODEL_WORKER = "policy-test/worker";
		process.env.PI_PLANNER_ONLY_THINKING_WORKER = "medium";

		const unknown = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const unknownInput = { agent: "worker", task: JSON.stringify(specFor("T-20260905-928")) };
		const unknownOutcome = await unknown.beginDelegation({ toolCallId: "call-policy-unknown", input: unknownInput }, BASE);
		assert.equal(unknownOutcome.block, undefined);
		const unknownStatus = unknown.renderTaskStatus(unknownOutcome.task);
		assert.match(unknownStatus, /requested=未指定 \(thinking: 未指定\)/);
		assert.match(unknownStatus, /resolved=policy-test\/worker \(thinking: medium\)/);
		assert.match(unknownStatus, /actual=未知 \(thinking: 未知\)/);
		const secondUnknown = await unknown.beginDelegation({
			toolCallId: "call-policy-unknown-2",
			input: { agent: "worker", task: JSON.stringify(specFor("T-20260905-929")) },
		}, BASE);
		assert.equal(secondUnknown.block, undefined, "unknown actual model must not stop launches");

		const mismatch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
		const mismatchInput = { agent: "worker", task: JSON.stringify(specFor("T-20260905-930")) };
		const mismatchOutcome = await mismatch.beginDelegation({ toolCallId: "call-policy-mismatch", input: mismatchInput }, BASE);
		assert.equal(mismatchOutcome.block, undefined);
		mismatch.noteDelegationModel("T-20260905-930", "call-policy-mismatch", "other/model", "medium");
		assert.match(mismatch.renderTaskStatus(mismatchOutcome.task), /不匹配/);
		const stopped = await mismatch.beginDelegation({
			toolCallId: "call-policy-stopped",
			input: { agent: "worker", task: JSON.stringify(specFor("T-20260905-931")) },
		}, BASE);
		assert.match(stopped.block?.reason ?? "", /^Planner-only guard: role model policy mismatch recorded; further controlled launches are stopped\.$/);
	} finally {
		for (const [key, value] of Object.entries({
			PI_PLANNER_ONLY_ROLE_MODELS: saved.flag,
			PI_PLANNER_ONLY_MODEL_WORKER: saved.workerModel,
			PI_PLANNER_ONLY_THINKING_WORKER: saved.workerThinking,
		})) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
}

{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-925";
	const workerInput = {
		agent: "worker",
		async: true,
		task: JSON.stringify(specFor(taskId, "worker")),
	};
	await orch.prepareRoleDelegation(workerInput);
	await orch.beginDelegation({ toolCallId: "call-f05", input: workerInput }, BASE);
	await orch.handleSubagentResult({
		toolCallId: "call-f05",
		toolName: "subagent",
		input: workerInput,
		details: { asyncId: "run-f05", runId: "run-f05" },
		content: [{ type: "text", text: 'Async: worker [run-f05]\nThe async run is detached and running in the background.' }],
		isError: false,
	});
	const task = orch.store.require(taskId);
	assert.equal(task.state, "executing");

	const notifyOutcome = await orch.handleAsyncNotify(
		'Background task stopped: **worker**\n\ntoolBudget limit exceeded\n\nChild runs: run-f05'
	);
	assert.ok(notifyOutcome !== undefined);
	assert.match(notifyOutcome.content[0].text, /\[PLANNER-ONLY\] Subagent for task T-20260905-925 stopped/);
	assert.match(notifyOutcome.content[0].text, /Limits:/);
	const updatedTask = orch.store.require(taskId);
	assert.notEqual(updatedTask.state, "executing");
	assert.equal(updatedTask.state, "failed");
	assert.equal(orch.pendingDelegationCount(), 0);
}

// --------------------------------------------------------------------------
// Ticket 15: status discloses debt as an estimate on 已用, never as remaining (X7–X10)
// --------------------------------------------------------------------------

{
	const usage = usageFixture(0, 0.01);
	usage.children = [{
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		kind: "worker",
		pending: true,
		source: "unavailable",
		toolCallId: "call-ticket15-d1",
		tokensDebt: 40000,
		costDebtUsd: 0.12,
	}];
	const status = statusWithBudget({ tokens: 200000, costUsd: 0.5 }, usage);
	const costLine = status.split("\n").find((line) => line.startsWith("  费用:"));
	// X7: the estimate is labelled as such; it is never dressed up as a measurement.
	assert.equal(costLine.includes("已用 $0.1300（其中 $0.1200 是 1 个未知项按授予额度估算，非实测） / 上限 $0.5000，剩余 $0.3700，未知项 1 项"), true);
	// X8: the note hangs on 已用, the figure it qualifies — not on 剩余.
	assert.equal(costLine.includes("剩余 $0.3700（其中"), false);
}

{
	// X9: a negative remainder is `-$0.0300`, never `$-0.0300`.
	const usage = usageFixture(0, 0.01);
	usage.children = [1, 2, 3, 4].map((n) => ({
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		kind: "worker",
		pending: true,
		source: "unavailable",
		toolCallId: `call-ticket15-d5-${n}`,
		tokensDebt: n === 1 ? 40000 : undefined,
		costDebtUsd: 0.13,
	}));
	const status = statusWithBudget({ tokens: 200000, costUsd: 0.5 }, usage);
	const costLine = status.split("\n").find((line) => line.startsWith("  费用:"));
	assert.equal(costLine.includes("剩余 -$0.0300"), true);
	assert.equal(costLine.includes("$-0.0300"), false);
}

{
	// X10: Budget by role carries the same debt the dimensions do.
	const usage = usageFixture(0, 0.01);
	usage.children = [{
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		kind: "worker",
		pending: true,
		source: "unavailable",
		toolCallId: "call-ticket15-d1",
		tokensDebt: 40000,
		costDebtUsd: 0.12,
	}];
	const status = statusWithBudget({ tokens: 200000, costUsd: 0.5 }, usage);
	assert.equal(status.includes("- worker: 1 calls, tokens=40000, 费用 $0.1200，费用未知 1 项"), true);
}

// --------------------------------------------------------------------------
// Ticket 15-b: confirmed not-launched classifier; status 在途预留 (Y1–Y8)
// --------------------------------------------------------------------------

{
	// Y1: a confirmed start failure (error, no runId, no WorkerReport) is remembered.
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260908-741";
	await delegateWorker(orch, "call-15b-y1", taskId);
	await orch.handleSubagentResult({
		toolCallId: "call-15b-y1",
		toolName: "subagent",
		isError: true,
		content: [{ type: "text", text: "spawn failed: no such agent" }],
	});
	assert.equal(orch.wasConfirmedNotLaunched("call-15b-y1"), true);
}

{
	// Y2: a budget-stop without runId is not a confirmed start failure (D3).
	const { store, task } = budgetTaskFixture("T-20260908-742", { tokens: 200000, costUsd: 0.5 }, boundedBudgetUsage(0, 0));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	await orch.beginDelegation({ toolCallId: "call-15b-y2", input: { task: JSON.stringify(task.spec) } }, BASE);
	await orch.handleSubagentResult({
		toolCallId: "call-15b-y2",
		toolName: "subagent",
		isError: true,
		details: { status: "stopped" },
		content: [{ type: "text", text: "usageBudget limit reached" }],
	});
	assert.equal(orch.wasConfirmedNotLaunched("call-15b-y2"), false);
}

{
	// Y3: status prints the in-flight reservation on its own line after the dimension rows.
	const { store, task } = budgetTaskFixture("T-20260908-743", { tokens: 200000, costUsd: 0.5 }, boundedBudgetUsage(0, 0));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	await orch.beginDelegation({ toolCallId: "call-15b-y3", input: { task: JSON.stringify(task.spec) } }, BASE);
	const status = orch.renderTaskStatus(orch.store.require(task.taskId));
	assert.equal(status.split("\n").includes("  在途预留: tokens=100000, 费用 $0.5000（1 个子进程未回执）"), true);
}

{
	// Y3b: that line sits after the two dimension rows and before Root (D4).
	const { store, task } = budgetTaskFixture("T-20260908-744", { tokens: 200000, costUsd: 0.5 }, boundedBudgetUsage(0, 0));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	await orch.beginDelegation({ toolCallId: "call-15b-y3b", input: { task: JSON.stringify(task.spec) } }, BASE);
	const lines = orch.renderTaskStatus(orch.store.require(task.taskId)).split("\n");
	const costIdx = lines.findIndex((line) => line.startsWith("  费用:"));
	assert.equal(costIdx >= 0 && lines[costIdx + 1] === "  在途预留: tokens=100000, 费用 $0.5000（1 个子进程未回执）" && lines[costIdx + 2].startsWith("  预算已停止（暂时）:") && lines[costIdx + 3].startsWith("  Root:"), true);
}

{
	// Y4: when nothing is held, status does not print the 在途预留 line.
	const status = statusWithBudget({ tokens: 200000, costUsd: 0.5 }, usageFixture(0, 0));
	assert.equal(status.split("\n").some((line) => line.startsWith("  在途预留:")), false);
}

{
	// Y5: an error for a live async child (runId set, artifacts not terminal) keeps the reservation.
	const { store, task } = budgetTaskFixture("T-20260908-745", { tokens: 200000, costUsd: 0.5 }, boundedBudgetUsage(0, 0));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const tmp = mkdtempSync(join(process.cwd(), ".planner-only-15b-y5-"));
	try {
		await orch.beginDelegation({ toolCallId: "call-15b-y5", input: { task: JSON.stringify(task.spec) } }, BASE);
		await orch.handleSubagentResult(receiptFor("call-15b-y5", "run-15b-y5", join(tmp, "async")));
		const before = orch.reservations.inFlight(task.taskId);
		await orch.handleSubagentResult({
			toolCallId: "call-15b-y5",
			toolName: "subagent",
			isError: true,
			content: [{ type: "text", text: "child crashed, maybe" }],
		});
		assert.deepEqual(orch.reservations.inFlight(task.taskId), before);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

{
	// Y6: the same unconfirmed async error still shows the D4 in-flight line.
	const { store, task } = budgetTaskFixture("T-20260908-746", { tokens: 200000, costUsd: 0.5 }, boundedBudgetUsage(0, 0));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const tmp = mkdtempSync(join(process.cwd(), ".planner-only-15b-y6-"));
	try {
		await orch.beginDelegation({ toolCallId: "call-15b-y6", input: { task: JSON.stringify(task.spec) } }, BASE);
		await orch.handleSubagentResult(receiptFor("call-15b-y6", "run-15b-y6", join(tmp, "async")));
		await orch.handleSubagentResult({
			toolCallId: "call-15b-y6",
			toolName: "subagent",
			isError: true,
			content: [{ type: "text", text: "child crashed, maybe" }],
		});
		const held = orch.reservations.inFlight(task.taskId);
		const status = orch.renderTaskStatus(orch.store.require(task.taskId));
		assert.equal(status.split("\n").includes(`  在途预留: tokens=${held.tokens}, 费用 $${held.costUsd.toFixed(4)}（1 个子进程未回执）`), true);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

{
	// Y7: an unconfirmed async error is not classified as confirmed-not-launched.
	const { store, task } = budgetTaskFixture("T-20260908-747", { tokens: 200000, costUsd: 0.5 }, boundedBudgetUsage(0, 0));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const tmp = mkdtempSync(join(process.cwd(), ".planner-only-15b-y7-"));
	try {
		await orch.beginDelegation({ toolCallId: "call-15b-y7", input: { task: JSON.stringify(task.spec) } }, BASE);
		await orch.handleSubagentResult(receiptFor("call-15b-y7", "run-15b-y7", join(tmp, "async")));
		await orch.handleSubagentResult({
			toolCallId: "call-15b-y7",
			toolName: "subagent",
			isError: true,
			content: [{ type: "text", text: "child crashed, maybe" }],
		});
		assert.equal(orch.wasConfirmedNotLaunched("call-15b-y7"), false);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

{
	// Y8: heldCount is the number of in-flight calls for that Task, not a hardcoded 1.
	const reservations = new BudgetReservations();
	const budget = {
		tokens: { known: 0, unknownParts: 0, debt: 0, limit: 200000, remaining: 200000 },
		costUsd: { known: 0, unknownParts: 0, debt: 0, limit: 1, remaining: 1 },
	};
	reservations.reserve("T-20260908-748", budget, { toolCallId: "call-a", tokens: 10, costUsd: 0.1 });
	reservations.reserve("T-20260908-748", budget, { toolCallId: "call-b", tokens: 20, costUsd: 0.2 });
	assert.equal(reservations.heldCount("T-20260908-748"), 2);
}

// --------------------------------------------------------------------------
// Ticket 37: first delegation of a new Task must reserve and clamp; rekey
// when shouldReplaceTaskId mints a canonical id.
// --------------------------------------------------------------------------

function emptyReservationBudget(tokens = 200000, costUsd = 0.05) {
	return {
		tokens: { known: 0, unknownParts: 0, debt: 0, limit: tokens, remaining: tokens },
		costUsd: { known: 0, unknownParts: 0, debt: 0, limit: costUsd, remaining: costUsd },
	};
}

{
	// R1: rekey moves the named reservation onto the destination Task.
	const r = new BudgetReservations();
	r.reserve("from", emptyReservationBudget(), { toolCallId: "call-r1", tokens: 100000, costUsd: 0.05 });
	r.rekey("from", "to", "call-r1");
	assert.deepEqual(r.inFlight("to"), { tokens: 100000, costUsd: 0.05 }, "R1: rekey moves the reservation onto toTaskId");
}

{
	// R2: after rekey, the source Task no longer holds it.
	const r = new BudgetReservations();
	r.reserve("from", emptyReservationBudget(), { toolCallId: "call-r2", tokens: 100000, costUsd: 0.05 });
	r.rekey("from", "to", "call-r2");
	assert.deepEqual(r.inFlight("from"), { tokens: 0, costUsd: 0 }, "R2: rekey clears the reservation from fromTaskId");
}

{
	// R3: rekey of a Task that holds nothing is a no-op (does not create a dest entry).
	const r = new BudgetReservations();
	r.rekey("missing", "to", "call-r3");
	assert.deepEqual(r.inFlight("to"), { tokens: 0, costUsd: 0 }, "R3: rekey with a missing source does not create a dest reservation");
}

{
	// R4: rekey of an unknown toolCallId leaves the source reservation in place.
	const r = new BudgetReservations();
	r.reserve("from", emptyReservationBudget(), { toolCallId: "call-r4-keep", tokens: 100000, costUsd: 0.05 });
	r.rekey("from", "to", "call-r4-absent");
	assert.deepEqual(r.inFlight("from"), { tokens: 100000, costUsd: 0.05 }, "R4: rekey of a missing toolCallId is a no-op on the source");
}

{
	// R5: rekey fromTaskId === toTaskId leaves the reservation where it is.
	const r = new BudgetReservations();
	r.reserve("same", emptyReservationBudget(), { toolCallId: "call-r5", tokens: 100000, costUsd: 0.05 });
	r.rekey("same", "same", "call-r5");
	assert.deepEqual(r.inFlight("same"), { tokens: 100000, costUsd: 0.05 }, "R5: rekey with identical ids is a no-op");
}

{
	// R6: only the named toolCallId moves; a sibling stays on the source.
	const r = new BudgetReservations();
	const budget = emptyReservationBudget(200000, 1);
	r.reserve("from", budget, { toolCallId: "call-r6-move", tokens: 10, costUsd: 0.1 });
	r.reserve("from", budget, { toolCallId: "call-r6-stay", tokens: 20, costUsd: 0.2 });
	r.rekey("from", "to", "call-r6-move");
	assert.deepEqual(r.inFlight("from"), { tokens: 20, costUsd: 0.2 }, "R6a: sibling reservation stays on fromTaskId");
}

{
	const r = new BudgetReservations();
	const budget = emptyReservationBudget(200000, 1);
	r.reserve("from", budget, { toolCallId: "call-r6-move", tokens: 10, costUsd: 0.1 });
	r.reserve("from", budget, { toolCallId: "call-r6-stay", tokens: 20, costUsd: 0.2 });
	r.rekey("from", "to", "call-r6-move");
	assert.deepEqual(r.inFlight("to"), { tokens: 10, costUsd: 0.1 }, "R6b: only the named toolCallId is on toTaskId");
}

{
	// Z1: creating a Task by delegating it clamps the first child's costUsd.hard to cumulativeBudget.
	const spec = { ...specFor("T-20260905-370"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
	const input = { task: JSON.stringify(spec) };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await orch.beginDelegation({ toolCallId: "call-z1", input }, BASE);
	assert.equal(input.usageBudget?.costUsd?.hard, 0.05, "Z1: first delegation costUsd.hard is clamped to the Task cumulative budget");
}

{
	// Z3: that first delegation holds an in-flight reservation on the new Task id.
	const spec = { ...specFor("T-20260905-371"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await orch.beginDelegation({ toolCallId: "call-z3", input: { task: JSON.stringify(spec) } }, BASE);
	assert.deepEqual(orch.reservations.inFlight("T-20260905-371"), { tokens: 100000, costUsd: 0.05 }, "Z3: first delegation reserves on the new Task id");
}

{
	// Z4: status D4 在途预留 line is visible after the first delegation of a new Task.
	const spec = { ...specFor("T-20260905-372"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await orch.beginDelegation({ toolCallId: "call-z4", input: { task: JSON.stringify(spec) } }, BASE);
	const status = orch.renderTaskStatus(orch.store.require("T-20260905-372"));
	assert.equal(status.split("\n").includes("  在途预留: tokens=100000, 费用 $0.0500（1 个子进程未回执）"), true, "Z4: first delegation is visible on the 在途预留 line");
}

{
	// Z5: the first child of a new Task is stamped with a grant (ticket 15 bounded debt).
	const spec = { ...specFor("T-20260905-373"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await orch.beginDelegation({ toolCallId: "call-z5", input: { task: JSON.stringify(spec) } }, BASE);
	assert.equal(orch.getDelegation("call-z5")?.grantedCostUsd, 0.05, "Z5: first delegation record carries grantedCostUsd");
}

{
	// Z6: token grant is stamped too — the floor, not the unused remainder of the Task.
	const spec = { ...specFor("T-20260905-374"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await orch.beginDelegation({ toolCallId: "call-z6", input: { task: JSON.stringify(spec) } }, BASE);
	assert.equal(orch.getDelegation("call-z6")?.grantedTokens, 100000, "Z6: first delegation record carries grantedTokens");
}

{
	// Z7: a second in-flight delegation of the same new Task is refused.
	const spec = { ...specFor("T-20260905-375"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await orch.beginDelegation({ toolCallId: "call-z7-a", input: { task: JSON.stringify(spec) } }, BASE);
	const second = await orch.beginDelegation({ toolCallId: "call-z7-b", input: { task: JSON.stringify(spec) } }, BASE);
	assert.match(second.block?.reason ?? "", /cumulative budget exhausted \(costUsd\)/, "Z7: second concurrent first-Task delegation is refused");
}

{
	// Z8: reviewer exemption still lets an exhausted Task close (D4).
	const { store, task } = budgetTaskFixture("T-20260905-376", { tokens: 1, costUsd: 0.01 }, usageFixture(5_000, 0.50));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const outcome = await orch.beginDelegation({ toolCallId: "call-z8", input: { agent: "reviewer", task: `Review ${task.taskId}` } }, BASE);
	assert.equal(outcome.block, undefined, "Z8: reviewer is not blocked by an exhausted cumulative budget");
}

{
	// Z9: shouldReplaceTaskId path must not leave the reservation on the alias.
	const spec = { ...specFor("T-20260908-370"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await orch.beginDelegation({ toolCallId: "call-z9", input: { task: JSON.stringify(spec) } }, BASE);
	assert.deepEqual(orch.reservations.inFlight("T-20260908-370"), { tokens: 0, costUsd: 0 }, "Z9: reservation is not left on the replaced alias");
}

{
	// Z10: the reservation is visible under the generated canonical id.
	const spec = { ...specFor("T-20260908-371"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const outcome = await orch.beginDelegation({ toolCallId: "call-z10", input: { task: JSON.stringify(spec) } }, BASE);
	assert.deepEqual(orch.reservations.inFlight(outcome.task.taskId), { tokens: 100000, costUsd: 0.05 }, "Z10: reservation sits on the canonical taskId");
}

{
	// Z11: after rekey, a second concurrent delegation is still refused (gate counts the moved hold).
	const spec = { ...specFor("T-20260908-372"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	await orch.beginDelegation({ toolCallId: "call-z11-a", input: { task: JSON.stringify(spec) } }, BASE);
	const second = await orch.beginDelegation({ toolCallId: "call-z11-b", input: { task: JSON.stringify(spec) } }, BASE);
	assert.match(second.block?.reason ?? "", /cumulative budget exhausted \(costUsd\)/, "Z11: second delegation after rekey is refused");
}

{
	// Z12: D4 在途预留 on the canonical Task after a replaced-id first delegation.
	const spec = { ...specFor("T-20260908-373"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const outcome = await orch.beginDelegation({ toolCallId: "call-z12", input: { task: JSON.stringify(spec) } }, BASE);
	const status = orch.renderTaskStatus(orch.store.require(outcome.task.taskId));
	assert.equal(status.split("\n").includes("  在途预留: tokens=100000, 费用 $0.0500（1 个子进程未回执）"), true, "Z12: 在途预留 is on the canonical Task after rekey");
}

{
	// Z13: settling the replaced-id child releases the canonical reservation (no leak).
	const spec = { ...specFor("T-20260908-374"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const outcome = await orch.beginDelegation({ toolCallId: "call-z13", input: { task: JSON.stringify(spec) } }, BASE);
	const canonical = outcome.task.taskId;
	await orch.handleSubagentResult(workerResult("call-z13", reportFor(canonical, "call-z13")));
	assert.deepEqual(orch.reservations.inFlight(canonical), { tokens: 0, costUsd: 0 }, "Z13: endDelegation after rekey releases the canonical reservation");
}

{
	// Z14: settling also leaves the alias empty (the leak the rekey exists to prevent).
	const spec = { ...specFor("T-20260908-375"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const outcome = await orch.beginDelegation({ toolCallId: "call-z14", input: { task: JSON.stringify(spec) } }, BASE);
	await orch.handleSubagentResult(workerResult("call-z14", reportFor(outcome.task.taskId, "call-z14")));
	assert.deepEqual(orch.reservations.inFlight("T-20260908-375"), { tokens: 0, costUsd: 0 }, "Z14: alias holds nothing after the replaced-id child settles");
}

{
	// Z15: D5 — a Task created before the delegation (task start) still clamps from recorded usage, not an empty ledger.
	const { store, task } = budgetTaskFixture("T-20260908-376", { tokens: 50_000, costUsd: 0.20 }, boundedBudgetUsage(48_000, 0.19));
	task.reports.push(reportFor(task.taskId, "old-report"));
	const input = { task: JSON.stringify(task.spec), usageBudget: { tokens: { hard: 50_000 }, costUsd: { hard: 0.20 } } };
	const orch = new PlannerOrchestrator({ gitRunner, store });
	await orch.beginDelegation({ toolCallId: "call-z15", input }, BASE);
	assert.equal(input.usageBudget.tokens.hard, 2_000, "Z15: existing Task still clamps from recorded usage, not emptyTaskUsage()");
}

// --------------------------------------------------------------------------
// Ticket 16-b: restore the ledger after reload; refuse when a snapshot is unreadable.
// --------------------------------------------------------------------------

function spentTaskRecord(taskId, costUsd = 0.04, limit = 0.05) {
	const store = new TaskStore();
	const spec = { ...specFor(taskId), cumulativeBudget: { tokens: 200000, costUsd: limit } };
	const task = store.create(spec);
	task.state = "changes_requested";
	task.usage = emptyTaskUsage();
	task.usage.children = [{ input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd }];
	task.reports.push(reportFor(task.taskId, "prior-run"));
	return task;
}

{
	const orch = new PlannerOrchestrator({ gitRunner });
	assert.deepEqual(orch.restoreFromLedger(), { restored: 0, corrupt: [] }, "L3: restoreFromLedger is a no-op without ledgerDir");
}

{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-16b-l2-"));
	try {
		new LedgerSnapshotStore(dir).write(spentTaskRecord("T-20260908-l2"));
		const injected = new TaskStore();
		const orch = new PlannerOrchestrator({ gitRunner, store: injected, ledgerDir: dir });
		assert.deepEqual(orch.restoreFromLedger(), { restored: 0, corrupt: [] }, "L2: injected deps.store plus ledgerDir does not read the disk ledger");
		assert.equal(orch.store.list().length, 0, "L2b: the injected store stays empty");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-16b-l1-"));
	try {
		const task = spentTaskRecord("T-20260908-l1", 0.04, 0.05);
		new LedgerSnapshotStore(dir).write(task);
		const path = join(dir, "planner-only", "ledger", `${task.taskId}.json`);
		const before = readFileSync(path, "utf8");
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const result = orch.restoreFromLedger();
		assert.equal(result.restored, 1, "L1: restoreFromLedger installs the snapshot");
		assert.deepEqual(result.corrupt, [], "L1b: a valid snapshot is not corrupt");
		const restored = orch.store.require("T-20260908-l1");
		assert.equal(restored.state, "changes_requested", "L1c: restored state survives");
		assert.equal(restored.updatedAt, task.updatedAt, "L12a: restore does not rewrite updatedAt");
		assert.equal(readFileSync(path, "utf8"), before, "L12: restoreFromLedger does not rewrite the snapshot bytes");
		assert.deepEqual(orch.reservations.inFlight("T-20260908-l1"), { tokens: 0, costUsd: 0 }, "L4: in-flight reservations are not rehydrated");
		const input = { task: JSON.stringify(task.spec) };
		const out = await orch.beginDelegation({ toolCallId: "call-l5", input }, BASE);
		assert.equal(out.block, undefined, "L5: a restored Task with remaining balance may delegate");
		assert.ok(Math.abs(input.usageBudget.costUsd.hard - 0.01) < 1e-9, "L5b: restored remaining clamps costUsd.hard to ~0.01, not the original 0.05");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-16b-l13-"));
	try {
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const spec = { ...specFor("T-20260908-l13"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
		const live = orch.store.create(spec);
		const path = join(dir, "planner-only", "ledger", `${live.taskId}.json`);
		const envelope = JSON.parse(readFileSync(path, "utf8"));
		envelope.task.state = "failed";
		writeFileSync(path, JSON.stringify(envelope));
		const result = orch.restoreFromLedger();
		assert.equal(result.restored, 0, "L13: an in-memory record is not counted as restored");
		assert.equal(orch.store.require("T-20260908-l13").state, "planning", "L13b: live memory wins over the disk snapshot");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-16b-l6-"));
	try {
		const good = spentTaskRecord("T-20260908-962", 0.01, 0.05);
		const bad = spentTaskRecord("T-20260908-961", 0.04, 0.05);
		const ledger = new LedgerSnapshotStore(dir);
		ledger.write(good);
		ledger.write(bad);
		writeFileSync(join(dir, "planner-only", "ledger", `${bad.taskId}.json`), "this is not json", "utf8");
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const result = orch.restoreFromLedger();
		assert.equal(result.restored, 1, "L9c: only the intact snapshot is restored as a record");
		assert.equal(result.corrupt.some((c) => c.taskId === "T-20260908-961"), true, "L6c: the unreadable file is reported corrupt");
		const badStatus = orch.renderTaskStatus(orch.store.require("T-20260908-961"));
		assert.match(badStatus, /余额不可信/, "L10: status of the corrupt Task says the balance is untrusted");
		assert.match(badStatus, /账本快照无法读取/, "L10b: status names the unreadable snapshot");
		assert.doesNotMatch(badStatus, /剩余 \$[0-9]/, "L11: untrusted status does not present remaining as a dollar figure");
		assert.doesNotMatch(badStatus, /剩余 -?[0-9]/, "L11b: untrusted status does not present remaining as a number");
		const refused = await orch.beginDelegation({ toolCallId: "call-l6", input: { task: JSON.stringify(bad.spec) } }, BASE);
		assert.match(refused.block?.reason ?? "", /ledger snapshot unreadable/, "L6: a controlled paid launch of the corrupt Task is refused");
		assert.match(refused.block?.reason ?? "", /余额无法确认，拒绝新的受控启动/, "L6b: refusal says the balance cannot be confirmed");
		assert.doesNotMatch(refused.block?.reason ?? "", /cumulative budget exhausted/, "L7: untrusted refusal is not the exhausted-budget message");
		const reviewer = await orch.beginDelegation({ toolCallId: "call-l8", input: { agent: "reviewer", task: `Review ${bad.taskId}` } }, BASE);
		assert.equal(reviewer.block, undefined, "L8: reviewer is still allowed when the ledger is unreadable");
		const goodInput = { task: JSON.stringify(good.spec) };
		const ok = await orch.beginDelegation({ toolCallId: "call-l9", input: goodInput }, BASE);
		assert.equal(ok.block, undefined, "L9: a neighbouring intact Task is not frozen by the corrupt file");
		assert.ok(goodInput.usageBudget?.costUsd?.hard > 0, "L9b: the intact Task still receives a remaining budget");
		const goodStatus = orch.renderTaskStatus(orch.store.require("T-20260908-962"));
		assert.doesNotMatch(goodStatus, /余额不可信/, "L9d: intact Task status does not claim an untrusted balance");
		assert.match(goodStatus, /剩余/, "L9e: intact Task status still shows remaining");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-16b-l14-"));
	try {
		const bad = spentTaskRecord("T-20260908-963", 0.04, 0.05);
		new LedgerSnapshotStore(dir).write(bad);
		const path = join(dir, "planner-only", "ledger", `${bad.taskId}.json`);
		writeFileSync(path, "this is not json", "utf8");
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const result = orch.restoreFromLedger();
		assert.equal(result.corrupt.some((item) => item.taskId === "T-20260908-963"), true, "L14: restoreFromLedger reports the unreadable file as corrupt");
		const placeholder = orch.store.require("T-20260908-963");
		const untrustedStatus = orch.renderTaskStatus(placeholder);
		assert.match(untrustedStatus, /余额不可信/, "L14b: the placeholder still renders an untrusted status");

		orch.store.persist(placeholder);
		assert.equal(readFileSync(path, "utf8"), "this is not json", "L15: persist of the placeholder does not rewrite the corrupt snapshot");
		assert.match(orch.renderTaskStatus(placeholder), /本会话无法写入该 taskId 的账本/, "L15b: status exposes the per-task ledger write error");
		writeFileSync(path, "this is not json", "utf8");

		const reviewer = await orch.beginDelegation({ toolCallId: "call-l16", input: { agent: "reviewer", task: `Review ${bad.taskId}` } }, BASE);
		assert.equal(reviewer.block, undefined, "L16: reviewer is still allowed when the ledger is unreadable");
		orch.store.persist(orch.store.require("T-20260908-963"));
		assert.equal(readFileSync(path, "utf8"), "this is not json", "L17: reviewer activity does not rewrite the corrupt snapshot");

		const inputB = { task: JSON.stringify(bad.spec) };
		await orch.prepareRoleDelegation(inputB);
		const refused = await orch.beginDelegation({ toolCallId: "call-l18", input: inputB }, BASE);
		assert.match(refused.block?.reason ?? "", /ledger snapshot unreadable/, "L18: a worker stays refused after reviewer activity");
		assert.equal(inputB.usageBudget, undefined, "L18b: reviewer activity does not grant the child a usageBudget");
		assert.doesNotMatch(JSON.stringify(inputB), /"hard":\s*0\.5/, "L18c: blocked untrusted launch does not leave costUsd.hard 0.5 on the input");

		const orch2 = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const result2 = orch2.restoreFromLedger();
		assert.equal(result2.corrupt.some((item) => item.taskId === "T-20260908-963"), true, "L19: a later session still reports the file corrupt");
		const status2 = orch2.renderTaskStatus(orch2.store.require("T-20260908-963"));
		assert.match(status2, /余额不可信/, "L20: a later session still shows 余额不可信");
		const inputC = { task: JSON.stringify(bad.spec) };
		await orch2.prepareRoleDelegation(inputC);
		const refusedC = await orch2.beginDelegation({ toolCallId: "call-l21", input: inputC }, BASE);
		assert.match(refusedC.block?.reason ?? "", /ledger snapshot unreadable/, "L21: a later session still refuses a paid worker launch");
		assert.equal(inputC.usageBudget, undefined, "L22: a later session does not hand the child a usageBudget");
		assert.doesNotMatch(JSON.stringify(inputC), /"hard":\s*0\.5/, "L23: a later session does not grant costUsd.hard 0.5");
		assert.equal(readFileSync(path, "utf8"), "this is not json", "L24: the corrupt bytes survive across sessions");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-16b-l25-"));
	try {
		const bad = spentTaskRecord("T-20260908-965", 0.04, 0.05);
		new LedgerSnapshotStore(dir).write(bad);
		const path = join(dir, "planner-only", "ledger", `${bad.taskId}.json`);
		writeFileSync(path, "this is not json", "utf8");
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const result = orch.restoreFromLedger();
		assert.equal(result.corrupt.some((item) => item.taskId === "T-20260908-965"), true, "L25a: restoreFromLedger reports the unreadable file as corrupt");
		const statusBeforeRepair = orch.renderTaskStatus(orch.store.require("T-20260908-965"));
		assert.match(statusBeforeRepair, /本会话拒绝写入该 taskId 的账本/, "L25: the quarantined task's status discloses the ledger quarantine");
		new LedgerSnapshotStore(dir).write(bad);
		const repaired = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(repaired.task.taskId, "T-20260908-965", "L25c: the fresh store repairs the snapshot on disk mid-session");
		const statusAfterRepair = orch.renderTaskStatus(orch.store.require("T-20260908-965"));
		assert.match(statusAfterRepair, /本会话拒绝写入该 taskId 的账本/, "L25b: the session still discloses the quarantine after the mid-session repair");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Ticket 16-c: budget stop aftermath and status semantics.
{
	const r = new BudgetReservations();
	const budget = emptyReservationBudget(100, 0.5);
	assert.equal(r.wouldRefuse("a1", budget), undefined, "A1: sufficient balance is not refused");
	r.reserve("a3", budget, { toolCallId: "a3-call", tokens: 100, costUsd: 0.5 });
	const refusal = r.wouldRefuse("a3", budget);
	assert.equal(refusal?.held > 0, true, "A3: held refusal reports a held amount");
	const before = { inFlight: r.inFlight("a3"), count: r.heldCount("a3") };
	r.wouldRefuse("a3", budget);
	assert.deepEqual({ inFlight: r.inFlight("a3"), count: r.heldCount("a3") }, before, "A4: wouldRefuse is pure");
	const outcome = r.reserve("a3", budget, { toolCallId: "a3-second", tokens: 1, costUsd: 0.01 });
	assert.equal(Boolean(outcome.refused), true, "A5: reserve agrees with wouldRefuse");
}
{
	const spent = statusWithBudget({ tokens: 100, costUsd: 0.5 }, usageFixture(0, 0.5));
	assert.match(spent, /预算已停止: 费用 已用满/);
	assert.doesNotMatch(spent, /预算已停止（暂时）/);
	assert.match(spent, /reviewer 不受此限/);
	const clear = statusWithBudget({ tokens: 1000, costUsd: 5 }, usageFixture(1, 0.01));
	assert.equal(clear.split("\n").some((line) => line.startsWith("  预算已停止")), false, "A8: an un-stopped task has no stop line");
	assert.doesNotMatch(statusWithBudget(undefined, usageFixture(1, 0.01)), /^  预算已停止/m, "A10: unconfigured tasks have no stop line");
}
{
	const { store, task } = budgetTaskFixture("T-20260908-16c-a7", { tokens: 100, costUsd: 0.5 }, boundedBudgetUsage(0, 0));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	orch.reservations.reserve(task.taskId, { tokens: { limit: 100, known: 0 }, costUsd: { limit: 0.5, known: 0 } }, { toolCallId: "a7-call", tokens: 100, costUsd: 0.5 });
	const status = orch.renderTaskStatus(task);
	assert.match(status, /预算已停止（暂时）:/);
	assert.match(status, /预留占满/);
	assert.match(status, /1 个子进程/);
}
// B1-B10 pin the unchanged post-stop lifecycle surface.
{
	const { store, task } = budgetTaskFixture("T-20260908-16c-b1", { tokens: 100, costUsd: 0.5 }, boundedBudgetUsage(0, 0));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	assert.doesNotThrow(() => orch.renderTaskStatus(task), "B1: stopped Task status remains queryable");
	assert.match(orch.renderTaskStatus(task), /Budget \(累计\):/);
	task.reports.push(reportFor(task.taskId, "b2-report"));
	assert.equal(task.reports.length, 1, "B2: a child report is still recorded on a stopped Task");
	const request = await orch.recordRootVerdict(task, "request_changes", "stopped", { source: "root" });
	assert.equal(request.task.state, "changes_requested", "B4: request_changes still lands after the stop");
}
{
	const { store, task } = budgetTaskFixture("T-20260908-16c-b5", { tokens: 1, costUsd: 0.01 }, usageFixture(1, 0.01));
	const blocked = await new PlannerOrchestrator({ gitRunner, store }).recordRootVerdict(task, "blocked", "stopped", { source: "root" });
	assert.equal(blocked.task.state, "blocked", "B5: blocked remains available after stop");
}
{
	const { store, task } = budgetTaskFixture("T-20260908-16c-b7", { tokens: 100, costUsd: 0.5 }, boundedBudgetUsage(0, 0));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	await orch.beginDelegation({ toolCallId: "b7-a", input: { task: JSON.stringify(task.spec) } }, BASE);
	const before = task.state;
	const held = orch.reservations.heldCount(task.taskId);
	await orch.beginDelegation({ toolCallId: "b7-b", input: { task: JSON.stringify(task.spec) } }, BASE);
	assert.equal(task.state, before, "B7: budget refusal does not change Task state");
	assert.equal(orch.reservations.heldCount(task.taskId), held, "B8a: the refused launch leaves the in-flight count alone");
	// B8b: measured at the reservation level, where a leak is actually observable --
	// injecting one into reserve()'s refusal branch does not move the orchestrator-level
	// count above, so that assertion alone would not catch it.
	const bare = new BudgetReservations();
	const bareBudget = { tokens: { limit: 100, known: 0 }, costUsd: { limit: 0.5, known: 0 } };
	bare.reserve("leak", bareBudget, { toolCallId: "first", tokens: 100, costUsd: 0.5 });
	const refusedSecond = bare.reserve("leak", bareBudget, { toolCallId: "second", tokens: 1, costUsd: 0.01 });
	assert.equal(Boolean(refusedSecond.refused), true, "B8b: the second reserve is refused");
	assert.equal(bare.heldCount("leak"), 1, "B8c: a refused reserve holds nothing");
}
// B9 (reviewer stays exempt after the stop) is already pinned by Z8 above, which is
// the assertion that actually fails when the `role !== "reviewer"` guard is removed.
// A second copy here was measured insensitive to that same mutation, so it is not kept:
// a vacuous assertion advertises coverage the suite does not have.
{
	const stopped = budgetTaskFixture("T-20260908-16c-b10a", { tokens: 1, costUsd: 0.01 }, usageFixture(1, 0.01));
	const ample = budgetTaskFixture("T-20260908-16c-b10b", { tokens: 1000, costUsd: 5 }, usageFixture(1, 0.01));
	const a = await new PlannerOrchestrator({ gitRunner, store: stopped.store }).recordRootVerdict(stopped.task, "blocked", "same", { source: "root" });
	const b = await new PlannerOrchestrator({ gitRunner, store: ample.store }).recordRootVerdict(ample.task, "blocked", "same", { source: "root" });
	assert.equal(a.task.state, b.task.state, "B10: stop does not alter the state machine");
}

// --------------------------------------------------------------------------
// Ticket 38 / F6 — session_start restore is capped and skips empty-cwd ghosts
// --------------------------------------------------------------------------
{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-38-restore-"));
	try {
		const ledger = new LedgerSnapshotStore(dir);
		const real = spentTaskRecord("T-20260908-38a", 0.01, 0.05);
		ledger.write(real);
		const ghostPath = join(dir, "planner-only", "ledger", "T-20260908-38ghost.json");
		writeFileSync(ghostPath, JSON.stringify({
			version: 1,
			writtenAt: "2026-09-08T00:00:00.000Z",
			task: {
				taskId: "T-20260908-38ghost",
				role: "worker",
				cwd: "",
				state: "planning",
				reviewRound: 0,
				reviewMode: "root",
				reports: [],
				validatorReports: [],
				reviews: [],
				overrides: [],
				aliases: [],
				reportCorrections: 0,
				usage: emptyTaskUsage(),
				createdAt: "1970-01-01T00:00:00.000Z",
				updatedAt: "1970-01-01T00:00:00.000Z",
				stateReason: "stray placeholder",
			},
		}), "utf8");
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const result = orch.restoreFromLedger();
		assert.equal(result.restored, 1, "38-a: only the real Task is restored");
		assert.equal(orch.store.get("T-20260908-38a")?.taskId, "T-20260908-38a", "38-b: real Task is present");
		assert.equal(orch.store.get("T-20260908-38ghost"), undefined, "38-c: empty-cwd ghost without TaskSpec is skipped");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-38-cap-"));
	try {
		const ledger = new LedgerSnapshotStore(dir);
		const { MAX_LEDGER_RESTORE_PER_SESSION } = await import("./types.ts");
		for (let i = 0; i < MAX_LEDGER_RESTORE_PER_SESSION + 3; i += 1) {
			const id = `T-20260908-38c${String(i).padStart(3, "0")}`;
			const task = spentTaskRecord(id, 0.01, 0.05);
			task.updatedAt = new Date(Date.UTC(2026, 8, 8, 0, 0, i)).toISOString();
			ledger.write(task);
		}
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const result = orch.restoreFromLedger();
		assert.equal(result.restored, MAX_LEDGER_RESTORE_PER_SESSION, "38-d: restore is capped at MAX_LEDGER_RESTORE_PER_SESSION");
		assert.ok(orch.store.get("T-20260908-38c066"), "38-e: freshest records are preferred");
		assert.equal(orch.store.get("T-20260908-38c000"), undefined, "38-f: oldest beyond the cap are skipped");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
{
	const store = pinnedStore();
	const task = store.create(specFor("T-20260908-28ro"));
	task.reports.push(reportFor(task.taskId, "prior"));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const prompt = `Do not modify files. Return only a valid WorkerReport for task ${task.taskId}.`;
	await orch.beginDelegation({ toolCallId: "call-28ro", input: { task: prompt } }, BASE);
	assert.equal(orch.getDelegation("call-28ro")?.reportOnly, true, "28-A wire: report-only prompt marks the delegation");
}

// --------------------------------------------------------------------------
// Ticket 42 — machine-generated report-only correction embeds TaskSpec + reportOnly
// --------------------------------------------------------------------------
{
	const store = pinnedStore();
	const task = store.create(specFor("T-20260908-42mg"));
	store.transition(task.taskId, "executing");
	store.transition(task.taskId, "reviewing");
	store.transition(task.taskId, "changes_requested");
	task.reports.push(reportFor(task.taskId, "prior-42"));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	// Root-authored correction prose: no TaskSpec, no agent — historically warned twice.
	const input = {
		task: `Do not modify files. Return only a valid WorkerReport for task ${task.taskId}.`,
	};
	await orch.prepareRoleDelegation(input);
	assert.equal(input.reportOnly, true, "42-a: machine stamp sets explicit reportOnly on input");
	assert.match(String(input.task), /"taskId": "T-20260908-42mg"/, "42-b: prepareRoleDelegation embeds original TaskSpec");
	assert.match(String(input.task), /"reportOnly": true/, "42-c: embedded TaskSpec carries reportOnly");
	const outcome = await orch.beginDelegation({ toolCallId: "call-42mg", input }, BASE);
	assert.equal(outcome.warnings?.some((w) => /without an embedded TaskSpec/.test(w)) ?? false, false, "42-d: no missing-TaskSpec warning");
	assert.equal(outcome.warnings?.some((w) => /no single live Task matched/.test(w)) ?? false, false, "42-e: no unmatched-name warning");
	assert.equal(orch.getDelegation("call-42mg")?.reportOnly, true, "42-f: DelegationRecord.reportOnly from explicit field");
	assert.equal(orch.getDelegation("call-42mg")?.taskId, task.taskId, "42-g: bound to the original Task");
}

{
	// Explicit reportOnly (no sniff) reaches DelegationRecord and evidence compare.
	const store = pinnedStore();
	const taskId = "T-20260908-42ev";
	const task = store.create(specFor(taskId));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	setDirtyTree();
	const correctionInput = {
		agent: "worker",
		reportOnly: true,
		task: JSON.stringify({ ...specFor(taskId), reportOnly: true }),
	};
	await orch.beginDelegation({ toolCallId: "call-42ev", input: correctionInput }, `/fixture/${taskId}`);
	assert.equal(orch.getDelegation("call-42ev")?.reportOnly, true, "42-h: explicit reportOnly without sniff");
	const overReport = {
		...reportFor(taskId, "call-42ev"),
		summary: "report-only restatement",
		changedFiles: ["src/parser.ts", "src/extra.ts"],
	};
	await orch.handleSubagentResult({
		toolCallId: "call-42ev",
		toolName: "subagent",
		content: [{ type: "text", text: JSON.stringify(overReport) }],
	});
	const comparison = store.require(taskId).lastComparison;
	assert.ok(comparison, "42-i: comparison recorded");
	assert.equal(comparison.unexplained, false, "42-j: evidence compare received reportOnly (over-report not unexplained)");
	assert.ok((comparison.extraDeclaredPaths ?? []).length > 0, "42-k: over-report still surfaced as extraDeclared");
	setCleanTree();
}

// --------------------------------------------------------------------------
// Ticket 41 — blocked lifecycle: abandon, receipt parking, verdict, status
// --------------------------------------------------------------------------
{
	const store = pinnedStore();
	const task = store.create(specFor("T-20260908-41ab"));
	store.transition(task.taskId, "executing");
	store.transition(task.taskId, "blocked");
	assert.ok(store.require(task.taskId).sealedAt, "41-a: entering blocked sets sealedAt");
	const abandoned = store.abandon(task.taskId, "operator stop-loss");
	assert.equal(abandoned.state, "failed", "41-b: abandon allows blocked → failed");
	assert.equal(abandoned.stateReason, "operator stop-loss");
	assert.equal(abandoned.sealedAt, undefined, "41-c: sealedAt cleared on abandon");
	assert.throws(() => store.abandon(task.taskId), /terminal task: failed/, "41-d: failed remains non-abandonable");
}

{
	const store = pinnedStore();
	const task = store.create(specFor("T-20260908-41pk"));
	store.transition(task.taskId, "executing");
	const orch = new PlannerOrchestrator({ gitRunner, store });
	await orch.beginDelegation({
		toolCallId: "call-41pk",
		input: { agent: "worker", task: JSON.stringify(specFor("T-20260908-41pk")) },
	}, `/fixture/T-20260908-41pk`);
	// Block the Task while the child is still pending (simulates report-correction exhaustion).
	store.transition(task.taskId, "blocked");
	assert.equal(store.require(task.taskId).state, "blocked");
	const beforeRound = store.require(task.taskId).reviewRound;
	const beforeReports = store.require(task.taskId).reports.length;
	const lateReport = {
		version: 1,
		taskId: "T-20260908-41pk",
		status: "completed",
		summary: "late arrival",
		changedFiles: ["src/parser.ts"],
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
		evidence: {
			cwd: `/fixture/T-20260908-41pk`,
			taskId: "T-20260908-41pk",
			workerRunId: "call-41pk",
			generatedAt: new Date().toISOString(),
		},
		risks: [],
		unresolved: [],
	};
	const parked = await orch.handleSubagentResult({
		toolCallId: "call-41pk",
		toolName: "subagent",
		content: [{ type: "text", text: JSON.stringify(lateReport) }],
	});
	assert.match(parked?.content?.[0]?.text ?? "", /parked into history/, "41-e: late receipt discloses parking");
	const after = store.require(task.taskId);
	assert.equal(after.state, "blocked", "41-f: late receipt does not advance state");
	assert.equal(after.reviewRound, beforeRound, "41-g: reviewRound unchanged");
	assert.equal(after.reports.length, beforeReports, "41-h: report not recorded via advanceReview path");
	assert.match(after.stateReason ?? "", /parked/, "41-i: parking noted in stateReason");
}

{
	const store = pinnedStore();
	const task = store.create(specFor("T-20260908-41vd"));
	store.transition(task.taskId, "executing");
	store.recordReport(task.taskId, reportFor(task.taskId, "r-41vd"));
	store.transition(task.taskId, "blocked");
	const orch = new PlannerOrchestrator({ gitRunner, store });
	setDirtyTree();
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "blocked", "independent close", { source: "root" });
	// planner_verdict on blocked remains open — decision applied (escape hatch).
	assert.ok(outcome.decision, "41-j: planner_verdict still accepted on blocked");
	assert.equal(store.require(task.taskId).reviews.at(-1)?.verdict, "blocked", "41-k: verdict recorded");
	setCleanTree();
}

{
	const store = pinnedStore();
	const task = store.create(specFor("T-20260908-41st"));
	store.transition(task.taskId, "executing");
	store.transition(task.taskId, "blocked");
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const status = orch.renderTaskStatus(store.require(task.taskId));
	assert.match(status, /Blocked lifecycle:.*planner_verdict/, "41-l: status discloses verdict still accepted");
	assert.match(status, /late child receipts are parked/, "41-m: status discloses receipt parking");
	assert.match(status, /abandon → failed/, "41-n: status discloses abandon path");
	assert.match(status, /Sealed at:/, "41-o: status shows sealedAt");
}

console.log("planner-only orchestration: PASS");
