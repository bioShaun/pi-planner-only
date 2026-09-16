import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import {
	DelegationAborted,
	DelegationRefused,
	REVIEW_RESULT_SCHEMA,
	cancelInFlightDelegations,
	createHostLauncher,
	renderDelegationProgress,
	runDelegation,
} from "./delegate.ts";
import {
	SUBAGENT_DELEGATION_CANCEL_EVENT,
	SUBAGENT_DELEGATION_REQUEST_EVENT,
	SUBAGENT_DELEGATION_RESPONSE_EVENT,
	SUBAGENT_DELEGATION_UPDATE_EVENT,
} from "./subagent-delegation-contract.ts";
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
function makeReviewDeps(dir, { store, concurrency, reviewFor, reviewStatus = "completed", reviewError, reviewUsage } = {}) {
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
					return { ...base, status: reviewStatus, error: reviewError, ...(reviewUsage ? { usage: reviewUsage } : {}) };
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
// Ticket 11 D2 — a correction worker may restate earlier-attributed paths in
// changedFiles (cumulative declaration) without tripping the over-reported
// gate: priorTruthPaths from earlier executions excuse them.
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	mkdirSync(join(dir, "src"), { recursive: true });
	const { deps } = makeReviewDeps(dir, {
		reviewFor: (request) => makeReview(request.nodeId, {
			verdict: "request_changes",
			summary: "the change is wrong",
			findings: [{ severity: "major", category: "correctness", description: "it does the wrong thing", requestedChange: "redo it" }],
		}),
	});
	const innerLaunch = deps.launch;
	let workerCalls = 0;
	deps.launch = async (request) => {
		if (request.agent === "worker") {
			workerCalls += 1;
			// The write happens inside the delegation window (between A_run and
			// C_report) so the execution's truthPaths see it.
			if (workerCalls === 1) writeFileSync(join(dir, "src", "target.ts"), "round 1\n");
			else writeFileSync(join(dir, "src", "other.ts"), "round 2\n");
			const response = await innerLaunch(request);
			// worker1 declares only its own file; worker2 declares the Task's
			// cumulative set — the host-run N1 pattern that used to revalidate.
			response.result.value.changedFiles = workerCalls === 1 ? ["src/target.ts"] : ["src/target.ts", "src/other.ts"];
			return response;
		}
		return innerLaunch(request);
	};
	const worker = await runDelegation(deps, makeParams({ scope: { allowedPaths: ["src/target.ts", "src/other.ts"] } }), dir, { executionId: "call-w1" });
	const taskId = worker.task.taskId;
	assert.equal(deps.store.require(taskId).state, "reviewing");
	const review = await runDelegation(deps, reviewerParams(taskId), dir, { executionId: "call-r" });
	assert.equal(review.task.state, "changes_requested");

	const correction = await runDelegation(deps, makeParams({ taskId, objective: "add other.ts", scope: { allowedPaths: ["src/target.ts", "src/other.ts"] } }), dir, { executionId: "call-w2" });
	assert.equal(correction.task.state, "reviewing", "a cumulative declaration must not revalidate");
	const last = deps.store.require(taskId).lastComparison;
	assert.ok(last && !last.reasons.some((r) => /over-reported/.test(r)), `no over-reported in ${JSON.stringify(last?.reasons)}`);
	assert.equal(last.extraDeclaredPaths.some((p) => p.endsWith("src/target.ts")), false, "restated prior-truth path excused");
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
// launcher 非 completed: thrown refusal, Task untouched; this terminal carried
// no usage field, so G4 has nothing to record (children = worker's only).
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
	assert.equal(deps.usage.taskUsage(taskId).children.length, 1, "terminal without usage records nothing new (G4)");
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
	// Non-empty parity with validateReviewResult: an empty successorTaskId once
	// passed the launcher schema and was only refused by R6.1, wasting the run.
	assert.equal(REVIEW_RESULT_SCHEMA.properties.acknowledgeDrift.properties.successorTaskId.minLength, 1);
	assert.equal(REVIEW_RESULT_SCHEMA.properties.workspaceDigest.minLength, 1);
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

// ============================================================================
// Ticket 07 — D1 contract parity, D2 launcher over a fake events bus, D3
// progress forwarding / unified abort semantics / G4 usage on non-completed
// terminals.
// ============================================================================

const repoDir = new URL(".", import.meta.url).pathname;
const UPSTREAM_DELEGATION_TS = join(
	homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents", "src", "api", "delegation.ts",
);

// Minimal on/emit bus standing in for pi.events.
function tinyEmitter() {
	const listeners = new Map();
	const emitted = [];
	return {
		emitted,
		on(event, fn) {
			let set = listeners.get(event);
			if (!set) {
				set = new Set();
				listeners.set(event, set);
			}
			set.add(fn);
			return () => set.delete(fn);
		},
		emit(event, payload) {
			emitted.push({ event, payload });
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload);
		},
	};
}

function launcherRequest(overrides = {}) {
	return {
		requestId: "req-1",
		ownerRunId: "owner-1",
		nodeId: "T-20260915-500",
		agent: "worker",
		task: "packet",
		context: "fresh",
		cwd: "/tmp",
		result: { kind: "text" },
		...overrides,
	};
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// D1: the contract copy matches the installed pi-subagents source — the five
// event-name constants and the SubagentDelegationUpdate field list, compared
// as text, not by eye. Absent package → skip with a printed reason.
// ---------------------------------------------------------------------------
{
	if (!existsSync(UPSTREAM_DELEGATION_TS)) {
		console.log(`delegate.test.mjs: pi-subagents not installed at ${UPSTREAM_DELEGATION_TS}; contract-parity check skipped`);
	} else {
		const upstream = readFileSync(UPSTREAM_DELEGATION_TS, "utf8");
		const local = readFileSync(join(repoDir, "subagent-delegation-contract.ts"), "utf8");
		const eventConstants = (text) => Object.fromEntries(
			[...text.matchAll(/export const (SUBAGENT_DELEGATION_\w+_EVENT) = "([^"]+)"/g)].map((m) => [m[1], m[2]]),
		);
		assert.deepEqual(eventConstants(local), eventConstants(upstream), "event-name constants diverge from the installed package");
		const updateFields = (text) => {
			const block = text.match(/export interface SubagentDelegationUpdate extends SubagentDelegationStarted \{([\s\S]*?)\n\}/);
			assert.ok(block, "SubagentDelegationUpdate declaration not found");
			return [...block[1].matchAll(/(\w+)\?:/g)].map((m) => m[1]);
		};
		assert.deepEqual(updateFields(local), updateFields(upstream), "SubagentDelegationUpdate fields diverge from the installed package");
	}
}

// ---------------------------------------------------------------------------
// 1. renderDelegationProgress: full fields / bare identity triple / line caps;
//    currentToolArgs appears in neither text nor details.
// ---------------------------------------------------------------------------
{
	const full = renderDelegationProgress("worker", "T-20260915-500", {
		requestId: "req-1",
		ownerRunId: "owner-1",
		nodeId: "T-20260915-500",
		runId: "run-9",
		currentTool: "bash",
		currentToolArgs: "cat /secret/path | shred",
		recentOutput: "raw chunk",
		recentOutputLines: ["first", "second", "third", "fourth"],
		recentTools: [{ tool: "bash", args: "ls" }],
		model: "test/model",
		toolCount: 7,
		durationMs: 61500,
		tokens: 1234,
	});
	const text = full.content[0].text;
	assert.equal(full.content[0].type, "text");
	assert.ok(text.startsWith("planner_delegate worker T-20260915-500: 62s · 7 tools · bash"), `summary line: ${text}`);
	assert.ok(text.includes("first") && text.includes("second") && text.includes("third"), "recentOutputLines shown");
	assert.ok(!text.includes("fourth"), "at most 3 output lines");
	assert.ok(!text.includes("secret") && !text.includes("shred"), "currentToolArgs never rendered into text");
	assert.deepEqual(full.details, {
		taskId: "T-20260915-500",
		role: "worker",
		runId: "run-9",
		currentTool: "bash",
		toolCount: 7,
		durationMs: 61500,
		tokens: 1234,
		progress: true,
	});
	assert.ok(!("currentToolArgs" in full.details), "currentToolArgs never reaches details");

	const minimal = renderDelegationProgress("explorer", "T-20260915-501", {
		requestId: "req-2",
		ownerRunId: "owner-1",
		nodeId: "T-20260915-501",
	});
	assert.equal(minimal.content[0].text, "planner_delegate explorer T-20260915-501: 0s · 0 tools · …");
	assert.deepEqual(minimal.details, { taskId: "T-20260915-501", role: "explorer", progress: true });

	const longLine = "x".repeat(250);
	const truncated = renderDelegationProgress("worker", "T-1", {
		requestId: "r",
		ownerRunId: "o",
		nodeId: "T-1",
		recentOutputLines: [longLine],
	});
	assert.ok(!truncated.content[0].text.includes(longLine), "output line truncated");
	assert.equal(
		truncated.content[0].text.split("\n")[1].length,
		200,
		"each output line capped at 200 chars",
	);
}

// ---------------------------------------------------------------------------
// 2. Progress pass-through: the fake launcher's third arg receives hooks; two
//    onUpdate calls land on options.onUpdate as rendered partials; the
//    terminal outcome is unaffected.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const partials = [];
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal, hooks) => {
			assert.ok(hooks && typeof hooks.onUpdate === "function", "launcher receives hooks as third arg");
			hooks.onUpdate({
				requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
				currentTool: "read", toolCount: 2, durationMs: 1200,
			});
			hooks.onUpdate({
				requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
				currentTool: "bash", toolCount: 5, durationMs: 3400,
			});
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "completed",
				runId: "run-p",
				agent: "worker",
				usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 3, toolCalls: 3, durationMs: 10 },
				result: { kind: "structured", value: makeReport(request.nodeId, "run-p", request.cwd) },
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams(), dir, {
		executionId: "call-p",
		onUpdate: (partial) => partials.push(partial),
	});
	assert.equal(partials.length, 2, "both updates forwarded");
	assert.equal(partials[0].details.progress, true, "partial marked non-terminal");
	assert.equal(partials[0].details.taskId, outcome.task.taskId);
	assert.equal(partials[0].details.currentTool, "read");
	assert.equal(partials[0].content[0].type, "text");
	assert.equal(partials[1].details.toolCount, 5);
	assert.ok(outcome.report, "terminal outcome unaffected");
	assert.equal(outcome.task.reports.length, 1);
}

// ---------------------------------------------------------------------------
// 3. Launcher filtering: UPDATE and RESPONSE both pass the identity triple —
//    requestId must equal; ownerRunId / nodeId must equal when present.
// ---------------------------------------------------------------------------
{
	const bus = tinyEmitter();
	const launcher = createHostLauncher({ events: bus });
	const updates = [];
	const promise = launcher(launcherRequest(), undefined, { onUpdate: (update) => updates.push(update) });
	const request = bus.emitted.find((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT).payload;
	const triple = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
	bus.emit(SUBAGENT_DELEGATION_UPDATE_EVENT, { ...triple, currentTool: "read" });
	bus.emit(SUBAGENT_DELEGATION_UPDATE_EVENT, { ...triple, requestId: "req-other", currentTool: "x" });
	bus.emit(SUBAGENT_DELEGATION_UPDATE_EVENT, { ...triple, nodeId: "T-other", currentTool: "y" });
	assert.equal(updates.length, 1, "only the identity-matched UPDATE reaches hooks");
	assert.equal(updates[0].currentTool, "read");
	bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, { ...triple, requestId: "req-other", status: "completed" });
	bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, { ...triple, status: "completed" });
	const response = await promise;
	assert.equal(response.status, "completed", "matching RESPONSE resolves the wait");
}

// ---------------------------------------------------------------------------
// 4. abort → exactly one strict three-key CANCEL → cancelled terminal inside
//    the grace window resolves the wait.
// ---------------------------------------------------------------------------
{
	const bus = tinyEmitter();
	const launcher = createHostLauncher({ events: bus }, { cancelGraceMs: 50 });
	const controller = new AbortController();
	const promise = launcher(launcherRequest({ requestId: "req-abort" }), controller.signal, {});
	const request = bus.emitted.find((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT).payload;
	controller.abort();
	const cancels = bus.emitted.filter((entry) => entry.event === SUBAGENT_DELEGATION_CANCEL_EVENT);
	assert.equal(cancels.length, 1, "exactly one CANCEL emitted");
	assert.deepEqual(Object.keys(cancels[0].payload).sort(), ["nodeId", "ownerRunId", "requestId"], "CANCEL payload is strictly three keys");
	assert.deepEqual(cancels[0].payload, {
		requestId: request.requestId,
		ownerRunId: request.ownerRunId,
		nodeId: request.nodeId,
	});
	bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: request.requestId,
		ownerRunId: request.ownerRunId,
		nodeId: request.nodeId,
		status: "cancelled",
		usage: { input: 5, output: 6, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1, toolCalls: 1, durationMs: 40 },
	});
	const response = await promise;
	assert.equal(response.status, "cancelled", "terminal inside grace resolves the wait");
	assert.ok(response.usage, "the cancelled terminal keeps its usage");
}

// ---------------------------------------------------------------------------
// 5. abort → grace expires → DelegationAborted; a terminal arriving after the
//    deadline is ignored (no second settle, no throw).
// ---------------------------------------------------------------------------
{
	const bus = tinyEmitter();
	const launcher = createHostLauncher({ events: bus }, { cancelGraceMs: 20 });
	const controller = new AbortController();
	const promise = launcher(launcherRequest({ requestId: "req-expiry", nodeId: "T-20260915-501" }), controller.signal, {});
	const request = bus.emitted.find((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT).payload;
	let settledWith;
	promise.then((value) => { settledWith = value; }, (error) => { settledWith = error; });
	controller.abort();
	await sleep(60);
	assert.ok(settledWith instanceof DelegationAborted, `expected DelegationAborted, got ${settledWith}`);
	assert.equal(settledWith.name, "DelegationAborted");
	bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: request.requestId,
		ownerRunId: request.ownerRunId,
		nodeId: request.nodeId,
		status: "cancelled",
	});
	await sleep(10);
	assert.ok(settledWith instanceof DelegationAborted, "late terminal ignored after the grace deadline");
}

// ---------------------------------------------------------------------------
// 5b. Abort fired synchronously inside the REQUEST listener hits onAbort
//     twice (signal listener + post-emit re-check) — the `aborting` guard
//     keeps it to exactly one CANCEL and one grace timer.
// ---------------------------------------------------------------------------
{
	const bus = tinyEmitter();
	const launcher = createHostLauncher({ events: bus }, { cancelGraceMs: 30 });
	const controller = new AbortController();
	bus.on(SUBAGENT_DELEGATION_REQUEST_EVENT, () => controller.abort());
	const promise = launcher(launcherRequest({ requestId: "req-guard", nodeId: "T-20260915-502" }), controller.signal, {});
	let settledWith;
	promise.then((value) => { settledWith = value; }, (error) => { settledWith = error; });
	await sleep(60);
	const cancels = bus.emitted.filter((entry) => entry.event === SUBAGENT_DELEGATION_CANCEL_EVENT);
	assert.equal(cancels.length, 1, "abort inside the REQUEST emit still produces exactly one CANCEL");
	assert.ok(settledWith instanceof DelegationAborted, `grace expiry rejects, got ${settledWith}`);
}

// ---------------------------------------------------------------------------
// 6. runDelegation cancellation, both paths: (a) cancelled terminal → blocked
//    + usage landed (G4) + CANCELLED refusal + lock released; (b) launcher
//    rejects DelegationAborted → blocked + "no terminal response" + no usage.
// ---------------------------------------------------------------------------
{
	// (a) terminal path
	const dir = initRealRepo();
	const store = new TaskStore();
	const taskId = "T-20260915-600";
	store.create(createTaskSpec({
		taskId,
		objective: "cancel me",
		cwd: dir,
		role: "worker",
		validation: { required: false },
	}));
	const concurrency = new ConcurrencyController();
	const usage = new UsageLedger({ pricing: { version: 1, currency: "USD", rates: {} } });
	const { deps } = makeDeps({
		store,
		concurrency,
		usage,
		launch: async (request) => ({
			requestId: request.requestId,
			ownerRunId: request.ownerRunId,
			nodeId: request.nodeId,
			status: "cancelled",
			error: "operator cancel",
			runId: "run-c",
			agent: "worker",
			model: "test/model",
			usage: { input: 5, output: 6, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1, toolCalls: 1, durationMs: 40 },
		}),
	});
	const error = await expectRefusal(
		runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-ca" }),
		"CANCELLED",
	);
	assert.equal(error.taskId, taskId, "refusal carries the Task id for the caller's snapshot sync");
	const record = store.get(taskId);
	assert.equal(record.state, "blocked", "cancelled terminal parks the Task");
	assert.match(record.stateReason ?? "", /cancelled/);
	const children = usage.taskUsage(taskId)?.children ?? [];
	assert.equal(children.length, 1, "G4: cancelled terminal usage recorded");
	assert.equal(children[0].outcome, "failed", "non-completed terminal lands as outcome=failed");
	assert.equal(children[0].kind, "worker");
	assert.equal(concurrency.status().reservations.length, 0, "write lock released");
}

{
	// (b) grace-expiry path
	const dir = initRealRepo();
	const store = new TaskStore();
	const taskId = "T-20260915-601";
	store.create(createTaskSpec({
		taskId,
		objective: "cancel me without a terminal",
		cwd: dir,
		role: "worker",
		validation: { required: false },
	}));
	const concurrency = new ConcurrencyController();
	const usage = new UsageLedger({ pricing: { version: 1, currency: "USD", rates: {} } });
	const { deps } = makeDeps({
		store,
		concurrency,
		usage,
		launch: async () => { throw new DelegationAborted(taskId); },
	});
	const error = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-cb" })
		.then(() => undefined, (e) => e);
	assert.ok(error instanceof DelegationAborted, `abort propagates as-is, got ${error}`);
	assert.equal(error.taskId, taskId, "DelegationAborted carries the Task id for the caller's snapshot sync");
	const record = store.get(taskId);
	assert.equal(record.state, "blocked", "grace-expired abort parks the Task");
	assert.match(record.stateReason ?? "", /no terminal response within grace/);
	assert.equal((usage.taskUsage(taskId)?.children ?? []).length, 0, "no usage row without a terminal");
	assert.equal(concurrency.status().reservations.length, 0, "write lock released");
}

// ---------------------------------------------------------------------------
// 7. G4 on the other terminals: timed_out / tool_budget_exhausted / failed
//    with usage → recorded, Task state per the existing table; without usage
//    → nothing recorded. Reviewer cancelled with usage → recorded, Task
//    untouched.
// ---------------------------------------------------------------------------
for (const [index, [status, expectedState]] of [
	["timed_out", "blocked"],
	["tool_budget_exhausted", "blocked"],
	["failed", "failed"],
].entries()) {
	for (const withUsage of [true, false]) {
		const dir = initRealRepo();
		const store = new TaskStore();
		const taskId = `T-20260915-7${index}${withUsage ? 5 : 0}`;
		store.create(createTaskSpec({
			taskId,
			objective: "terminal with usage",
			cwd: dir,
			role: "worker",
			validation: { required: false },
		}));
		const usage = new UsageLedger({ pricing: { version: 1, currency: "USD", rates: {} } });
		const { deps } = makeDeps({
			store,
			usage,
			launch: async (request) => ({
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status,
				error: `${status} happened`,
				runId: `run-${status}`,
				agent: "worker",
				...(withUsage
					? { usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, toolCalls: 1, durationMs: 10 } }
					: {}),
			}),
		});
		await expectRefusal(
			runDelegation(deps, makeParams({ taskId }), dir, { executionId: `call-g4-${status}-${withUsage}` }),
			status.toUpperCase(),
		);
		assert.equal(store.get(taskId).state, expectedState, `${status} -> ${expectedState}`);
		const children = usage.taskUsage(taskId)?.children ?? [];
		assert.equal(children.length, withUsage ? 1 : 0, `${status} usage ${withUsage ? "recorded" : "absent"} (G4)`);
		if (withUsage) assert.equal(children[0].outcome, "failed");
	}
}

{
	const dir = initCommittedRepo();
	const { deps } = makeReviewDeps(dir, {
		reviewStatus: "cancelled",
		reviewError: "operator cancel",
		reviewUsage: { input: 7, output: 8, cacheRead: 0, cacheWrite: 0, cost: 0.005, turns: 2, toolCalls: 1, durationMs: 30 },
		reviewFor: () => ({}),
	});
	const worker = await runDelegation(deps, makeParams(), dir, { executionId: "call-w" });
	const taskId = worker.task.taskId;
	const error = await expectRefusal(
		runDelegation(deps, reviewerParams(taskId), dir, { executionId: "call-r" }),
		"CANCELLED",
	);
	assert.equal(error.taskId, taskId, "reviewer refusal carries the Task id");
	const record = deps.store.require(taskId);
	assert.equal(record.state, "reviewing", "a cancelled reviewer never moves the Task");
	assert.equal(record.reviews.length, 0);
	const children = deps.usage.taskUsage(taskId)?.children ?? [];
	assert.equal(children.length, 2, "worker + cancelled reviewer usage both recorded");
	assert.equal(children.at(-1).kind, "reviewer");
	assert.equal(children.at(-1).outcome, "failed", "reviewer terminal lands as outcome=failed");
}

// ---------------------------------------------------------------------------
// 8. cancelInFlightDelegations: two in-flight + one settled → 2 CANCELs.
// ---------------------------------------------------------------------------
{
	const bus = tinyEmitter();
	const launcher = createHostLauncher({ events: bus }, { cancelGraceMs: 1000 });
	const pending = [
		launcher(launcherRequest({ requestId: "req-a", nodeId: "T-20260915-510" }), undefined, {}),
		launcher(launcherRequest({ requestId: "req-b", nodeId: "T-20260915-511" }), undefined, {}),
		launcher(launcherRequest({ requestId: "req-c", nodeId: "T-20260915-512" }), undefined, {}),
	];
	bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: "req-c", ownerRunId: "owner-1", nodeId: "T-20260915-512", status: "completed",
	});
	await pending[2];
	const cancelled = cancelInFlightDelegations({ events: bus });
	assert.equal(cancelled, 2, "settled request left the in-flight table");
	const cancels = bus.emitted.filter((entry) => entry.event === SUBAGENT_DELEGATION_CANCEL_EVENT);
	assert.equal(cancels.length, 2);
	assert.deepEqual(cancels.map((entry) => entry.payload.requestId).sort(), ["req-a", "req-b"]);
	// Settle the two stragglers so the module-level table is empty again.
	bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: "req-a", ownerRunId: "owner-1", nodeId: "T-20260915-510", status: "cancelled",
	});
	bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: "req-b", ownerRunId: "owner-1", nodeId: "T-20260915-511", status: "cancelled",
	});
	await Promise.all(pending.slice(0, 2));
}

console.log("delegate.test.mjs: all cases passed");
