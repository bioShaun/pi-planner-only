import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	DelegationRefused,
	runDelegation,
} from "./delegate.ts";
import { ConcurrencyController } from "./concurrency.ts";
import { TaskStore, createTaskSpec } from "./task.ts";
import { UsageLedger } from "./usage.ts";

// ============================================================================
// delegate.test.mjs — the fake-launcher unit suite for runDelegation (ticket
// 04). The same runDelegation the host calls; only `launch` and `gitRunner`
// are fakes.
// ============================================================================

const tempDirs = [];
function makeTempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}
process.on("exit", () => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function realGit(dir, ...args) {
	const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status ?? 1 };
}

function initRealRepo() {
	const dir = makeTempDir("planner-only-delegate-");
	assert.equal(realGit(dir, "init", "-q").code, 0);
	realGit(dir, "config", "user.email", "test@example.com");
	realGit(dir, "config", "user.name", "Test");
	realGit(dir, "config", "commit.gpgsign", "false");
	return dir;
}

function makeDeps(overrides = {}) {
	const launches = [];
	const deps = {
		store: overrides.store ?? new TaskStore(),
		gitRunner: overrides.gitRunner ?? (async () => ({ stdout: "", stderr: "no git", code: 128 })),
		concurrency: overrides.concurrency ?? new ConcurrencyController(),
		usage: overrides.usage ?? new UsageLedger({ pricing: { version: 1, currency: "USD", rates: {} } }),
		ownerRunId: overrides.ownerRunId ?? "owner-run-1",
		launch: overrides.launch ?? (async (request) => {
			launches.push(request);
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "completed",
				runId: "run-1",
				agent: "worker",
				model: "test/model",
				usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 3, toolCalls: 3, durationMs: 10 },
				result: { kind: "structured", value: makeReport(request.nodeId, "run-1", request.cwd) },
			};
		}),
	};
	return { deps, launches };
}

function makeReport(taskId, runId, cwd, overrides = {}) {
	return {
		version: 1,
		taskId,
		status: "completed",
		summary: "done",
		changedFiles: [],
		validation: [],
		evidence: { cwd, taskId, workerRunId: runId },
		risks: [],
		unresolved: [],
		...overrides,
	};
}

function makeParams(overrides = {}) {
	return {
		role: "worker",
		objective: "implement the thing",
		scope: { allowedPaths: ["src/target.ts"] },
		constraints: ["stay in scope"],
		acceptanceCriteria: ["the thing works"],
		validation: { required: false },
		...overrides,
	};
}

function failureResponse(status, error) {
	return async (request) => ({
		requestId: request.requestId,
		ownerRunId: request.ownerRunId,
		nodeId: request.nodeId,
		status,
		error,
		...(status === "invalid_request" ? {} : { runId: "run-x" }),
	});
}

async function expectRefusal(promise, code) {
	try {
		await promise;
	} catch (error) {
		assert.ok(error instanceof DelegationRefused, `expected DelegationRefused, got ${error}`);
		assert.equal(error.code, code);
		return error;
	}
	assert.fail(`expected DelegationRefused ${code}`);
}

// ---------------------------------------------------------------------------
// New Task, happy path: minted id, A_run/C_report on the execution, report and
// usage recorded, review decision present, write lock released.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const { deps, launches } = makeDeps({ gitRunner: async (args, cwd) => realGit(dir, ...args) });
	const outcome = await runDelegation(deps, makeParams(), dir, { executionId: "call-1" });

	assert.match(outcome.task.taskId, /^T-\d{8}-\d{3}$/);
	assert.equal(outcome.executionId, "call-1");
	assert.equal(outcome.runId, "run-1");
	assert.equal(outcome.report?.taskId, outcome.task.taskId);
	assert.ok(outcome.decision, "decision present");
	assert.ok(outcome.usage, "usage present");

	const record = deps.store.get(outcome.task.taskId);
	const execution = record.executions.find((item) => item.executionId === "call-1");
	assert.ok(execution?.aRun, "A_run recorded");
	assert.ok(execution?.cReport, "C_report recorded");
	assert.equal(execution.kind, "worker");
	assert.equal(execution.auxiliary, undefined, "worker execution is not auxiliary");
	assert.equal(record.reports.length, 1, "report recorded verbatim");
	assert.deepEqual(record.reports[0], outcome.report);
	assert.equal(record.reports[0].evidence.cwd, dir);

	assert.equal(deps.concurrency.status().reservations.length, 0, "write lock released");
	assert.equal(deps.usage.taskUsage(outcome.task.taskId).children.length, 1, "child usage recorded");

	assert.equal(launches.length, 1);
	const request = launches[0];
	assert.equal(request.agent, "worker");
	assert.equal(request.context, "fresh");
	assert.equal(request.result.kind, "structured");
	assert.equal(request.nodeId, outcome.task.taskId);
	// The packet is JSON data, rendered downward only.
	const packet = JSON.parse(request.task);
	assert.equal(packet.spec.taskId, outcome.task.taskId);
	assert.equal(packet.spec.objective, "implement the thing");
	// The schema survives a JSON round-trip unchanged (plain data).
	assert.deepEqual(JSON.parse(JSON.stringify(request.result.schema)), request.result.schema);
}

// ---------------------------------------------------------------------------
// Re-delegating an existing Task: stored spec is verbatim, this call's spec
// only enters the packet (ticket 53 rule).
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const store = new TaskStore();
	const original = createTaskSpec({
		taskId: "T-20260915-100",
		objective: "original objective",
		cwd: dir,
		role: "worker",
		scope: { allowedPaths: ["a.txt"] },
		constraints: [],
		acceptanceCriteria: [],
		validation: { required: false },
	});
	store.create(original);

	const { deps, launches } = makeDeps({ store, gitRunner: async (args, cwd) => realGit(dir, ...args) });
	const outcome = await runDelegation(
		deps,
		makeParams({ taskId: "T-20260915-100", objective: "revised objective for this run" }),
		dir,
		{ executionId: "call-2" },
	);

	assert.equal(outcome.task.taskId, "T-20260915-100");
	assert.equal(outcome.task.spec.objective, "original objective", "stored spec unchanged");
	assert.deepEqual(outcome.task.spec, original, "stored spec verbatim");
	const packet = JSON.parse(launches[0].task);
	assert.equal(packet.spec.objective, "revised objective for this run", "packet carries this call's spec");
	assert.equal(packet.spec.taskId, "T-20260915-100");
	assert.equal(deps.concurrency.status().reservations.length, 0);
}

// ---------------------------------------------------------------------------
// Refusals never reach the launcher.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();

	// TASK_UNKNOWN
	{
		const { deps, launches } = makeDeps();
		await expectRefusal(
			runDelegation(deps, makeParams({ taskId: "T-20200101-001" }), dir, { executionId: "call-u" }),
			"TASK_UNKNOWN",
		);
		assert.equal(launches.length, 0, "launch not called");
	}

	// TASK_FOREIGN_WORKSPACE
	{
		const store = new TaskStore();
		store.create(createTaskSpec({
			taskId: "T-20260915-101",
			objective: "other workspace",
			cwd: dir,
			role: "worker",
			validation: { required: false },
		}));
		const foreign = initRealRepo();
		const { deps, launches } = makeDeps({ store });
		await expectRefusal(
			runDelegation(deps, makeParams({ taskId: "T-20260915-101" }), foreign, { executionId: "call-f" }),
			"TASK_FOREIGN_WORKSPACE",
		);
		assert.equal(launches.length, 0, "launch not called");
	}

	// WRITER_CONFLICT: an active writer already holds this workspace.
	{
		const store = new TaskStore();
		const concurrency = new ConcurrencyController();
		const held = concurrency.reserve({
			id: "other-call",
			taskId: "T-20260915-900",
			role: "worker",
			capability: "writer",
			workspaces: [dir],
		});
		assert.ok(held.reservation, "fixture reservation held");
		const { deps, launches } = makeDeps({ store, concurrency });
		await expectRefusal(
			runDelegation(deps, makeParams(), dir, { executionId: "call-w" }),
			"WRITER_CONFLICT",
		);
		assert.equal(launches.length, 0, "launch not called");
	}
}

// ---------------------------------------------------------------------------
// Non-completed launcher statuses: Task transitions, stateReason recorded,
// DelegationRefused thrown, write lock released, no report recorded.
// ---------------------------------------------------------------------------
for (const [index, [status, expectedState]] of [
	["structured_output_failed", "failed"],
	["cancelled", "blocked"],
	["invalid_request", "failed"],
	["timed_out", "blocked"],
	["tool_budget_exhausted", "blocked"],
	["failed", "failed"],
].entries()) {
	const dir = initRealRepo();
	const store = new TaskStore();
	const taskId = `T-20260915-2${String(index).padStart(2, "0")}`;
	store.create(createTaskSpec({
		taskId,
		objective: "bound task",
		cwd: dir,
		role: "worker",
		validation: { required: false },
	}));
	const concurrency = new ConcurrencyController();
	const { deps } = makeDeps({ store, concurrency, launch: failureResponse(status, `${status} happened`) });
	const error = await expectRefusal(
		runDelegation(deps, makeParams({ taskId }), dir, { executionId: `call-${status}` }),
		status.toUpperCase(),
	);
	assert.match(error.message, new RegExp(status));
	const record = store.get(taskId);
	assert.equal(record.state, expectedState, `${status} -> ${expectedState}`);
	assert.match(record.stateReason ?? "", new RegExp(status));
	assert.equal(record.reports.length, 0, "no report recorded");
	assert.equal(concurrency.status().reservations.length, 0, "write lock released");
}

// ---------------------------------------------------------------------------
// Identity mismatch: reportError feeds advanceReview; the report is recorded
// verbatim, never rewritten.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	let boundTaskId;
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request) => {
			boundTaskId = request.nodeId;
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "completed",
				runId: "run-9",
				agent: "worker",
				result: {
					kind: "structured",
					value: makeReport("T-99999999-999", "run-9", dir),
				},
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams(), dir, { executionId: "call-m" });

	const expectedReport = boundTaskId;
	assert.notEqual(outcome.report.taskId, expectedReport, "fixture reports a foreign taskId");
	assert.equal(outcome.report.taskId, "T-99999999-999", "report not rewritten");
	assert.ok(outcome.decision, "decision present");
	assert.equal(outcome.task.reports.at(-1).taskId, "T-99999999-999", "recorded verbatim");
	assert.notEqual(outcome.task.state, "completed", "identity failure can never pass review");
}

// ---------------------------------------------------------------------------
// Explorer maps to the scout agent and holds no write lock.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const { deps, launches } = makeDeps();
	const outcome = await runDelegation(
		deps,
		makeParams({ role: "explorer", objective: "survey the module" }),
		dir,
		{ executionId: "call-e" },
	);
	assert.equal(launches[0].agent, "scout", "explorer -> scout (no explorer agent exists)");
	const execution = outcome.task.executions.at(-1);
	assert.equal(execution.kind, "explorer");
	assert.equal(execution.readOnly, true, "explorer execution is read-only");
	assert.equal(execution.auxiliary, undefined, "standalone explorer execution is not auxiliary");
}

// ---------------------------------------------------------------------------
// Validator maps to the oracle agent; its report lands on validatorReports.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const { deps, launches } = makeDeps();
	const outcome = await runDelegation(
		deps,
		makeParams({ role: "validator", objective: "validate the work" }),
		dir,
		{ executionId: "call-v" },
	);
	assert.equal(launches[0].agent, "oracle", "validator -> oracle");
	assert.equal(outcome.task.executions.at(-1).auxiliary, true, "validator execution is auxiliary");
	assert.equal(outcome.task.validatorReports.length, 1, "validator report recorded");
	assert.equal(outcome.task.reports.length, 0, "not a worker report");
}

console.log("delegate.test.mjs: all cases passed");
