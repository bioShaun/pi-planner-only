import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	DelegationRefused,
	REVIEW_RESULT_SCHEMA,
	runDelegation,
} from "./delegate.ts";
import { FINDING_CATEGORIES, FINDING_SEVERITIES, REVIEW_VERDICTS } from "./review.ts";
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

// ============================================================================
// Ticket 06 — role=reviewer: a launcher-validated ReviewResult goes straight
// into advanceReview. A reviewer call is an invocation over an existing Task:
// no mint, no write lock, no transition, no execution record.
// ============================================================================

function makeReview(taskId, overrides = {}) {
	return {
		taskId,
		verdict: "pass",
		summary: "reviewed: looks good",
		evidenceFresh: true,
		findings: [],
		...overrides,
	};
}

// A reviewer packet needs a real HEAD: on an unborn-HEAD repo every execution
// lacks an A_run ref, the packet is attributionIncomplete, and a pass is
// refused as truncated before anything else is exercised.
function initCommittedRepo() {
	const dir = initRealRepo();
	writeFileSync(join(dir, "seed.txt"), "seed\n");
	assert.equal(realGit(dir, "add", "seed.txt").code, 0);
	assert.equal(realGit(dir, "commit", "-qm", "seed").code, 0);
	return dir;
}

function headRef(dir) {
	return realGit(dir, "rev-parse", "HEAD").stdout.trim();
}

// Deps whose fake launcher answers worker calls with a WorkerReport (carrying
// the current HEAD so the report is verifiable) and reviewer calls with
// `reviewFor(request, reviewerCallIndex)`; `reviewStatus` fakes a non-completed
// terminal response.
function makeReviewDeps(dir, { store, concurrency, reviewFor, reviewStatus = "completed", reviewError } = {}) {
	const launches = [];
	let reviewerCalls = 0;
	const deps = {
		store: store ?? new TaskStore(),
		// The runner must honour the per-call cwd: declared additional roots are
		// probed through it, and a missing root is what truncates the packet.
		gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
		concurrency: concurrency ?? new ConcurrencyController(),
		usage: new UsageLedger({ pricing: { version: 1, currency: "USD", rates: {} } }),
		ownerRunId: "owner-run-1",
		launch: async (request) => {
			launches.push(request);
			if (request.agent === "reviewer") {
				const base = {
					requestId: request.requestId,
					ownerRunId: request.ownerRunId,
					nodeId: request.nodeId,
					runId: `run-r${launches.length}`,
					agent: "reviewer",
					model: "test/model",
				};
				if (reviewStatus !== "completed") {
					reviewerCalls += 1;
					return { ...base, status: reviewStatus, error: reviewError };
				}
				return {
					...base,
					status: "completed",
					usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, cost: 0.002, turns: 2, toolCalls: 1, durationMs: 5 },
					result: { kind: "structured", value: reviewFor(request, reviewerCalls++) },
				};
			}
			const runId = `run-w${launches.length}`;
			const report = makeReport(request.nodeId, runId, request.cwd);
			report.evidence.finalGitRef = headRef(dir);
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "completed",
				runId,
				agent: "worker",
				model: "test/model",
				usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 3, toolCalls: 3, durationMs: 10 },
				result: { kind: "structured", value: report },
			};
		},
	};
	return { deps, launches };
}

function reviewerParams(taskId, overrides = {}) {
	return makeParams({
		role: "reviewer",
		...(taskId ? { taskId } : {}),
		objective: "REVIEWER-PARAMS-MARKER",
		...overrides,
	});
}

// ---------------------------------------------------------------------------
// pass 正例: worker parks the Task in reviewing, reviewer PASS accepts it.
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	const concurrency = new ConcurrencyController();
	const { deps, launches } = makeReviewDeps(dir, {
		concurrency,
		reviewFor: (request) => makeReview(request.nodeId),   // omits reportRevision on purpose
	});
	let reserveCalls = 0;
	const originalReserve = concurrency.reserve.bind(concurrency);
	concurrency.reserve = (input) => { reserveCalls += 1; return originalReserve(input); };

	const worker = await runDelegation(deps, makeParams(), dir, { executionId: "call-w" });
	const taskId = worker.task.taskId;
	assert.equal(worker.task.state, "reviewing", "worker report parks the Task in reviewing");
	const executionsBefore = worker.task.executions.length;
	const reservesBefore = reserveCalls;

	const outcome = await runDelegation(deps, reviewerParams(taskId), dir, { executionId: "call-r" });

	assert.equal(launches.length, 2);
	const request = launches[1];
	assert.equal(request.agent, "reviewer");
	assert.equal(request.context, "fresh");
	assert.equal(request.nodeId, taskId);
	assert.equal(request.result.kind, "structured");
	assert.deepEqual(request.result.schema, REVIEW_RESULT_SCHEMA);
	assert.ok(request.task.includes('"reportRevision": 1'), "the packet names the shown report revision");
	assert.ok(request.task.includes("ReviewRequest:"), "the task text is the rendered ReviewRequest packet");
	assert.ok(!request.task.includes("REVIEWER-PARAMS-MARKER"), "call params never enter the reviewer packet");

	assert.equal(outcome.report, undefined, "a reviewer outcome carries no WorkerReport");
	assert.equal(outcome.review.source, "reviewer");
	assert.equal(outcome.review.reportRevision, 1, "omitted binding filled from the packet");
	assert.equal(outcome.decision.action, "accept");
	assert.equal(outcome.task.state, "completed");
	assert.equal(outcome.task.reviews.length, 1);
	assert.equal(outcome.task.reviews[0].verdict, "pass");
	assert.equal(outcome.task.executions.length, executionsBefore, "a review is not an execution");
	assert.equal(reserveCalls, reservesBefore, "a reviewer takes no write lock");
	const children = deps.usage.taskUsage(taskId).children;
	assert.equal(children.at(-1).kind, "reviewer", "reviewer child usage recorded");
	assert.equal(children.at(-1).toolCallId, "call-r");
	assert.equal(children.at(-1).executionId, undefined, "no execution record exists for it to bind");
}

// ---------------------------------------------------------------------------
// request_changes: recorded review, bounded correction round consumed.
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	const { deps } = makeReviewDeps(dir, {
		reviewFor: (request) => makeReview(request.nodeId, {
			verdict: "request_changes",
			summary: "the change is wrong",
			findings: [{ severity: "major", category: "correctness", description: "it does the wrong thing", requestedChange: "redo it" }],
		}),
	});
	const worker = await runDelegation(deps, makeParams(), dir, { executionId: "call-w" });
	const outcome = await runDelegation(deps, reviewerParams(worker.task.taskId), dir, { executionId: "call-r" });
	assert.equal(outcome.decision.action, "request_changes");
	assert.equal(outcome.task.state, "changes_requested");
	assert.equal(outcome.task.reviews.length, 1);
	assert.equal(outcome.task.reviews[0].verdict, "request_changes");
	assert.equal(outcome.task.reviewRound, 1, "a request_changes consumes a correction round");
}

// ---------------------------------------------------------------------------
// 前置拒绝: TASK_REQUIRED / REVIEW_NO_REPORT / REVIEW_TERMINAL — launch 0 次。
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();

	// TASK_REQUIRED: no taskId — nothing is minted either.
	{
		const { deps, launches } = makeReviewDeps(dir, { reviewFor: () => ({}) });
		await expectRefusal(
			runDelegation(deps, reviewerParams(undefined), dir, { executionId: "call-req" }),
			"TASK_REQUIRED",
		);
		assert.equal(launches.length, 0, "launch not called");
		assert.equal(deps.store.active(), undefined, "no Task was minted");
	}

	// REVIEW_NO_REPORT: a live Task without a WorkerReport has nothing to judge.
	{
		const store = new TaskStore();
		store.create(createTaskSpec({
			taskId: "T-20260915-300",
			objective: "bound task with no report",
			cwd: dir,
			role: "worker",
			validation: { required: false },
		}));
		const { deps, launches } = makeReviewDeps(dir, { store, reviewFor: () => ({}) });
		await expectRefusal(
			runDelegation(deps, reviewerParams("T-20260915-300"), dir, { executionId: "call-nr" }),
			"REVIEW_NO_REPORT",
		);
		assert.equal(launches.length, 0, "launch not called");
	}

	// REVIEW_TERMINAL: a completed Task is done.
	{
		const store = new TaskStore();
		store.create(createTaskSpec({
			taskId: "T-20260915-301",
			objective: "completed task",
			cwd: dir,
			role: "worker",
			validation: { required: false },
		}));
		store.transition("T-20260915-301", "executing");
		store.transition("T-20260915-301", "reviewing");
		store.transition("T-20260915-301", "completed");
		const { deps, launches } = makeReviewDeps(dir, { store, reviewFor: () => ({}) });
		await expectRefusal(
			runDelegation(deps, reviewerParams("T-20260915-301"), dir, { executionId: "call-term" }),
			"REVIEW_TERMINAL",
		);
		assert.equal(launches.length, 0, "launch not called");
	}
}

// ---------------------------------------------------------------------------
// 身份: a verdict naming another Task is refused; usage still lands.
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	const { deps } = makeReviewDeps(dir, {
		reviewFor: () => makeReview("T-99999999-999"),
	});
	const worker = await runDelegation(deps, makeParams(), dir, { executionId: "call-w" });
	const taskId = worker.task.taskId;
	await expectRefusal(
		runDelegation(deps, reviewerParams(taskId), dir, { executionId: "call-r" }),
		"REVIEW_IDENTITY",
	);
	const record = deps.store.require(taskId);
	assert.equal(record.reviews.length, 0, "no review recorded");
	assert.equal(record.state, "reviewing", "Task unchanged");
	assert.equal(deps.usage.taskUsage(taskId).children.at(-1).kind, "reviewer", "the refused call is still accounted");
}

// ---------------------------------------------------------------------------
// 绑定: a verdict for an older revision is refused; an omitted revision is
// filled from the packet and accepts.
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	const reviewResults = [
		(request) => makeReview(request.nodeId, {
			verdict: "request_changes",
			summary: "round one needs work",
			findings: [{ severity: "major", category: "correctness", description: "wrong" }],
		}),
		(request) => makeReview(request.nodeId, { reportRevision: 1 }),   // stale: two reports exist by then
		(request) => makeReview(request.nodeId),
	];
	const { deps, launches } = makeReviewDeps(dir, { reviewFor: (request, i) => reviewResults[i](request) });
	const worker = await runDelegation(deps, makeParams(), dir, { executionId: "call-w1" });
	const taskId = worker.task.taskId;
	const first = await runDelegation(deps, reviewerParams(taskId), dir, { executionId: "call-r1" });
	assert.equal(first.task.state, "changes_requested");
	await runDelegation(deps, makeParams({ taskId, objective: "second worker round" }), dir, { executionId: "call-w2" });
	assert.equal(deps.store.require(taskId).reports.length, 2, "second revision recorded");

	await expectRefusal(
		runDelegation(deps, reviewerParams(taskId), dir, { executionId: "call-r2" }),
		"REVIEW_BINDING",
	);
	assert.equal(deps.store.require(taskId).reviews.length, 1, "stale verdict not recorded");

	const accepted = await runDelegation(deps, reviewerParams(taskId), dir, { executionId: "call-r3" });
	assert.equal(accepted.review.reportRevision, 2, "omitted binding filled from the second packet");
	assert.equal(accepted.decision.action, "accept");
	assert.equal(accepted.task.state, "completed");
	assert.equal(launches.length, 5, "worker, reviewer, worker, reviewer, reviewer");
}

// ---------------------------------------------------------------------------
// 截断包: a declared root that cannot be sampled truncates the packet; a pass
// over it is refused, request_changes still records.
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	const missing = join(dir, "missing-root");
	const store = new TaskStore();
	store.create(createTaskSpec({
		taskId: "T-20260915-400",
		objective: "work with a declared extra root",
		cwd: dir,
		role: "worker",
		scope: { allowedPaths: ["x.txt"] },
		constraints: [],
		acceptanceCriteria: [],
		validation: { required: false },
		additionalWorktreeRoots: [missing],
	}));
	const reviewResults = [
		(request) => makeReview(request.nodeId),
		(request) => makeReview(request.nodeId, {
			verdict: "request_changes",
			summary: "partial packet, cannot confirm",
			findings: [{ severity: "minor", category: "test", description: "coverage unclear" }],
		}),
	];
	const { deps, launches } = makeReviewDeps(dir, { store, reviewFor: (request, i) => reviewResults[i](request) });
	await runDelegation(deps, makeParams({ taskId: "T-20260915-400" }), dir, { executionId: "call-w" });

	await expectRefusal(
		runDelegation(deps, reviewerParams("T-20260915-400"), dir, { executionId: "call-r1" }),
		"REVIEW_PACKET_TRUNCATED",
	);
	assert.equal(store.require("T-20260915-400").reviews.length, 0, "truncated pass not recorded");

	const recorded = await runDelegation(deps, reviewerParams("T-20260915-400"), dir, { executionId: "call-r2" });
	assert.equal(recorded.task.reviews.length, 1, "request_changes over a partial packet still records");
	assert.equal(recorded.task.reviews[0].verdict, "request_changes");
	assert.equal(recorded.task.state, "changes_requested");
	assert.equal(launches.length, 3);
}

// ---------------------------------------------------------------------------
// launcher 非 completed: thrown refusal, Task untouched, no usage (G4).
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	const { deps } = makeReviewDeps(dir, {
		reviewStatus: "structured_output_failed",
		reviewError: "child returned unparseable output",
		reviewFor: () => ({})
	});
	const worker = await runDelegation(deps, makeParams(), dir, { executionId: "call-w" });
	const taskId = worker.task.taskId;
	const error = await expectRefusal(
		runDelegation(deps, reviewerParams(taskId), dir, { executionId: "call-r" }),
		"STRUCTURED_OUTPUT_FAILED",
	);
	assert.match(error.message, /structured_output_failed/);
	const record = deps.store.require(taskId);
	assert.equal(record.state, "reviewing", "a failed reviewer never moves the Task");
	assert.equal(record.reviews.length, 0);
	assert.equal(deps.usage.taskUsage(taskId).children.length, 1, "non-completed reviewer usage is not recorded (G4)");
}

// ---------------------------------------------------------------------------
// schema 镜像: the launcher contract and validateReviewResult share the
// exported enum arrays; required matches the validator's mandatory fields.
// ---------------------------------------------------------------------------
{
	assert.deepEqual(REVIEW_RESULT_SCHEMA.properties.verdict.enum, [...REVIEW_VERDICTS]);
	assert.deepEqual(REVIEW_RESULT_SCHEMA.properties.findings.items.properties.severity.enum, [...FINDING_SEVERITIES]);
	assert.deepEqual(REVIEW_RESULT_SCHEMA.properties.findings.items.properties.category.enum, [...FINDING_CATEGORIES]);
	assert.deepEqual(REVIEW_RESULT_SCHEMA.required, ["taskId", "verdict", "summary", "evidenceFresh", "findings"]);
	assert.equal(REVIEW_RESULT_SCHEMA.additionalProperties, false);
	assert.equal(REVIEW_RESULT_SCHEMA.properties.findings.items.additionalProperties, false);
	assert.deepEqual(JSON.parse(JSON.stringify(REVIEW_RESULT_SCHEMA)), REVIEW_RESULT_SCHEMA, "schema is plain JSON data (no ~kind markers)");
}

// ---------------------------------------------------------------------------
// 无 execution 记录的 pass: a report revision with no per-execution binding
// cannot be judged fresh; the pass is refused (decideReview would otherwise
// accept it — a pass with no comparison still lands "accept").
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	const { deps } = makeReviewDeps(dir, { reviewFor: (request) => makeReview(request.nodeId) });
	const worker = await runDelegation(deps, makeParams(), dir, { executionId: "call-w" });
	const taskId = worker.task.taskId;
	// A second revision with no execution record (legacy or unrestored shape).
	const unbound = makeReport(taskId, "run-unbound", dir);
	unbound.evidence.finalGitRef = headRef(dir);
	deps.store.recordReport(taskId, unbound);
	assert.equal(deps.store.require(taskId).reports.length, 2);

	await expectRefusal(
		runDelegation(deps, reviewerParams(taskId), dir, { executionId: "call-r" }),
		"REVIEW_NO_EXECUTION_EVIDENCE",
	);
	const record = deps.store.require(taskId);
	assert.equal(record.reviews.length, 0, "unverifiable pass not recorded");
	assert.equal(record.state, "reviewing");
}

console.log("delegate.test.mjs: all cases passed");
