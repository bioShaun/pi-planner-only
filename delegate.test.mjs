import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import {
	DelegationAborted,
	DelegationRefused,
	PLANNER_DELEGATE_PARAMETERS,
	PLANNER_REDELEGATE_PARAMETERS,
	REVIEW_RESULT_SCHEMA,
	WORKER_REPORT_SCHEMA,
	cancelInFlightDelegations,
	createHostLauncher,
	renderDelegationOutcome,
	renderDelegationProgress,
	runDelegation,
	validateRecoveryDecision,
} from "./delegate.ts";
import {
	SUBAGENT_DELEGATION_CANCEL_EVENT,
	SUBAGENT_DELEGATION_REQUEST_EVENT,
	SUBAGENT_DELEGATION_RESPONSE_EVENT,
	SUBAGENT_DELEGATION_UPDATE_EVENT,
} from "./subagent-delegation-contract.ts";
import { FINDING_CATEGORIES, FINDING_SEVERITIES, REVIEW_VERDICTS } from "./review.ts";
import { ConcurrencyController } from "./concurrency.ts";
import { LedgerSnapshotStore } from "./ledger-store.ts";
import { TaskStore, createTaskSpec } from "./task.ts";
import { UsageLedger } from "./usage.ts";
import { Compile } from "typebox/compile";

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

// A clean-repository GitRunner: every read op answers code 0, HEAD is a
// fixed ref, status/diff output is empty. The common case for delegation
// mechanics tests — a workspace whose evidence probes succeed. Tests that
// need a non-Git or failing workspace pass their own runner (NO_GIT).
function fakeCleanGit() {
	return async (args, cwd) => {
		const key = args.join(" ");
		if (key === "rev-parse --git-dir") return { stdout: ".git\n", stderr: "", code: 0 };
		if (key === "rev-parse --show-toplevel") return { stdout: `${cwd ?? process.cwd()}\n`, stderr: "", code: 0 };
		if (key === "rev-parse HEAD") return { stdout: `${"0".repeat(40)}\n`, stderr: "", code: 0 };
		return { stdout: "", stderr: "", code: 0 };
	};
}

// The non-Git probe: rev-parse answers the real fatal line.
const NO_GIT = async () => ({ stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git", code: 128 });

function makeDeps(overrides = {}) {
	const launches = [];
	const deps = {
		store: overrides.store ?? new TaskStore(),
		gitRunner: overrides.gitRunner ?? fakeCleanGit(),
		concurrency: overrides.concurrency ?? new ConcurrencyController(),
		usage: overrides.usage ?? new UsageLedger({ pricing: { version: 1, currency: "USD", rates: {} } }),
		ownerRunId: overrides.ownerRunId ?? "owner-run-1",
		// Ticket 02 — the host normally has the restricted-reader binding
		// registered; the unproven-capability tests pass restrictedReaderAgent:
		// undefined explicitly.
		...("restrictedReaderAgent" in overrides
			? { restrictedReaderAgent: overrides.restrictedReaderAgent }
			: { restrictedReaderAgent: "planner-scout" }),
		quiescenceWaitMs: overrides.quiescenceWaitMs ?? 0,
		quiescenceSampleGapMs: overrides.quiescenceSampleGapMs ?? 0,
		launch: overrides.launch ?? (async (request) => {
			launches.push(request);
			const runId = overrides.allocateRunId ? overrides.allocateRunId(launches.length) : `run-${launches.length}`;
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "completed",
				runId,
				agent: "worker",
				model: "test/model",
				usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 3, toolCalls: 3, durationMs: 10 },
				result: { kind: "structured", value: makeReport(request.nodeId, undefined, request.cwd) },
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
		evidence: {
			cwd,
			taskId,
			...(runId !== undefined ? { workerRunId: runId } : {}),
		},
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
	assert.ok(execution?.cTerminal, "normal completion records the confirmed residual sample");
	assert.equal(execution?.terminationConfirmed, true);
	assert.equal(execution?.confirmationBasis, "terminal+quiet-worktree");
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

	// TASKSPEC_VALIDATION_INCOMPLETE: echo the validation shape received at
	// the public delegation boundary so a caller can distinguish an omitted
	// commands field from a field lost later in the pipeline.
	{
		const { deps, launches } = makeDeps();
		await assert.rejects(
			runDelegation(
				deps,
				makeParams({ validation: { required: true } }),
				dir,
				{ executionId: "call-validation-incomplete" },
			),
			(error) => {
				assert.equal(error?.code, "TASKSPEC_VALIDATION_INCOMPLETE");
				assert.equal(
					error?.message,
					'createTaskSpec refused: validation.commands must be a non-empty array of strings when validation.required is true (received validation: {"required":true}). Supply the commands, or set validation.required to false when no validation is mandatory.',
				);
				return true;
			},
		);
		assert.equal(launches.length, 0, "launch not called");
		assert.equal(deps.store.list().length, 0, "no Task was minted");
	}

	// Ticket 19 — TASKSPEC_VALIDATION_COMMAND_NOT_EXECUTABLE: prose in
	// validation.commands is refused at the boundary before a Task is minted
	// or a child launched; the refusal names the offending entry verbatim.
	{
		const { deps, launches } = makeDeps();
		await assert.rejects(
			runDelegation(
				deps,
				makeParams({ validation: { required: true, commands: ["按工单和 package.json 选择相关回归测试及必要检查，并在报告中记录准确命令和退出码"] } }),
				dir,
				{ executionId: "call-validation-prose" },
			),
			(error) => {
				assert.equal(error?.code, "TASKSPEC_VALIDATION_COMMAND_NOT_EXECUTABLE");
				assert.match(error?.message, /validation\.commands\[0\]/);
				assert.match(error?.message, /received: "按工单/);
				return true;
			},
		);
		assert.equal(launches.length, 0, "launch not called");
		assert.equal(deps.store.list().length, 0, "no Task was minted");
	}

	// TASK_UNKNOWN
	for (const role of ["worker", "explorer", "validator"]) {
		const { deps, launches } = makeDeps();
		const refusal = await expectRefusal(
			runDelegation(deps, makeParams({ role, taskId: "T-20200101-001" }), dir, { executionId: `call-u-${role}` }),
			"TASK_UNKNOWN",
		);
		assert.equal(launches.length, 0, "launch not called");
		assert.equal(deps.store.active(), undefined, "no Task was minted");
		assert.equal(deps.store.list().length, 0, "no Task was minted");
		assert.equal(
			refusal.message,
			"planner_delegate refused: unknown Task T-20200101-001; call planner_tasks to list live Tasks, or use planner_delegate to create a new one",
		);
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
		const refusal = await expectRefusal(
			runDelegation(deps, makeParams({ taskId: "T-20260915-101" }), foreign, { executionId: "call-f" }),
			"TASK_FOREIGN_WORKSPACE",
		);
		assert.equal(launches.length, 0, "launch not called");
		assert.equal(store.list().length, 1, "no Task was minted");
		assert.equal(
			refusal.message,
			`planner_delegate refused: Task T-20260915-101 belongs to workspace ${dir}, not ${foreign}; the id belongs to a different workspace's ledger; re-run from that workspace's cwd — call planner_tasks there to list its live Tasks — or call planner_delegate to mint a new Task in this workspace`,
		);
	}

	// WORKSPACE_CONFLICT: an active writer already holds this workspace.
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
		const refusal = await expectRefusal(
			runDelegation(deps, makeParams(), dir, { executionId: "call-w" }),
			"WORKSPACE_CONFLICT",
		);
		assert.equal(launches.length, 0, "launch not called");
		assert.equal(refusal.taskId, undefined, "no taskId on pre-admission refusal for new task");
		assert.equal(store.list().length, 0, "no task created in store when reservation refused");
	}

	// Ticket 02: CONCURRENCY_LIMIT_REACHED: capacity limit leaves no new Task or reservation
	{
		const store = new TaskStore();
		const concurrency = new ConcurrencyController({ savedLimit: 1 });
		const held = concurrency.reserve({
			id: "call-1",
			taskId: "T-20260915-900",
			role: "worker",
			capability: "writer",
			workspaces: ["/other/workspace"],
		});
		assert.ok(held.reservation, "slot occupied");
		const { deps, launches } = makeDeps({ store, concurrency });
		const refusal = await expectRefusal(
			runDelegation(deps, makeParams(), dir, { executionId: "call-w2" }),
			"CONCURRENCY_LIMIT_REACHED",
		);
		assert.equal(launches.length, 0, "launch not called");
		assert.equal(refusal.taskId, undefined, "no taskId for unminted task");
		assert.equal(store.list().length, 0, "no task created in store on capacity refusal");
		assert.ok(refusal.message.includes("no Task was created, no execution was launched"));
		assert.equal(concurrency.status().occupied, 1, "no reservation leaked");
	}

	// Ticket 02: Pre-admission refusal on existing Task keeps canonical taskId and leaves Task unchanged
	{
		const store = new TaskStore();
		const existingTask = store.create(createTaskSpec({ objective: "existing task", cwd: dir, role: "worker" }, "T-20260918-001"));
		const concurrency = new ConcurrencyController({ savedLimit: 1 });
		concurrency.reserve({
			id: "occupier",
			taskId: "T-20260918-999",
			role: "worker",
			capability: "writer",
			workspaces: ["/different/workspace"],
		});
		const { deps, launches } = makeDeps({ store, concurrency });
		const refusal = await expectRefusal(
			runDelegation(deps, { ...makeParams(), taskId: existingTask.taskId }, dir, { executionId: "call-redelegate" }),
			"CONCURRENCY_LIMIT_REACHED",
		);
		assert.equal(launches.length, 0, "launch not called");
		assert.equal(refusal.taskId, existingTask.taskId, "canonical taskId preserved on refusal for existing task");
		assert.equal(store.get(existingTask.taskId)?.state, "planning", "task state unchanged");
		assert.ok(refusal.message.includes(`Task ${existingTask.taskId} unchanged, no execution was launched`));
	}

	// Ticket 02: Task 建档失败时释放本次临时 reservation，不影响已有 Task
	{
		const ledgerRoot = makeTempDir("planner-only-admission-ledger-");
		const snapshots = new LedgerSnapshotStore(ledgerRoot);
		const fixedNow = new Date("2026-09-18T12:00:00.000Z");
		const store = new TaskStore({
			now: () => fixedNow,
			onPersist: (record) => snapshots.writeOrThrow(record),
			onRemove: (taskId) => snapshots.remove(taskId),
		});
		const parent = store.create(createTaskSpec({
			taskId: "T-20260918-900",
			objective: "existing parent",
			cwd: dir,
			role: "worker",
		}, "T-20260918-900"));
		const parentBefore = structuredClone(parent);
		const parentSnapshotPath = join(ledgerRoot, "planner-only", "ledger", `${parent.taskId}.json`);
		const parentSnapshotBefore = readFileSync(parentSnapshotPath, "utf8");
		// A directory at the new Task's final snapshot path makes the real atomic
		// rename fail after the temporary file was written.
		mkdirSync(join(ledgerRoot, "planner-only", "ledger", "T-20260918-001.json"));
		const concurrency = new ConcurrencyController({ savedLimit: 2 });
		concurrency.reserve({
			id: "prior-call",
			taskId: "T-20260918-888",
			role: "worker",
			capability: "writer",
			workspaces: ["/other"],
		});
		const { deps, launches } = makeDeps({ store, concurrency });
		await assert.rejects(
			() => runDelegation(deps, makeParams({ parentTaskId: parent.taskId }), dir, { executionId: "call-failing-create" }),
			(error) => error?.code === "EISDIR" || error?.code === "ENOTDIR" || /directory/i.test(error?.message ?? ""),
		);
		assert.equal(launches.length, 0, "launch not called");
		assert.equal(concurrency.status().occupied, 1, "temporary reservation released; prior reservation untouched");
		assert.ok(concurrency.get("prior-call"), "prior reservation still intact");
		assert.equal(store.get("T-20260918-001"), undefined, "failed admission leaves no in-memory Task");
		assert.deepEqual(store.require(parent.taskId), parentBefore, "failed child admission leaves parent memory unchanged");
		assert.equal(readFileSync(parentSnapshotPath, "utf8"), parentSnapshotBefore, "failed child admission leaves parent snapshot byte-for-byte unchanged");
		assert.deepEqual(snapshots.readAll().records.map((record) => record.taskId), [parent.taskId], "failed Task cannot resurrect from the ledger");
	}

	// Ticket 02: TaskSpec 无效或 envelope 无效在前置拒绝时无 reservation、无新 Task
	{
		const store = new TaskStore();
		const concurrency = new ConcurrencyController();
		const { deps, launches } = makeDeps({ store, concurrency });
		await expectRefusal(
			runDelegation(deps, { ...makeParams(), envelope: { maxTokens: -5 } }, dir, { executionId: "call-bad-env" }),
			"ENVELOPE_INVALID",
		);
		assert.equal(launches.length, 0, "launch not called");
		assert.equal(store.list().length, 0, "no task created");
		assert.equal(concurrency.status().occupied, 0, "no reservation held");
	}

	// Ticket 03: validation.commands roundtrip through delegate and redelegate
	{
		const store = new TaskStore();
		const concurrency = new ConcurrencyController();
		const { deps, launches } = makeDeps({ store, concurrency });
		const incidentCommand = "cd skills/herdr-pair && python3 -m unittest tests.test_pairctl -v";
		const initialCommands = [incidentCommand, "npm test"];

		// 1. Initial delegate mints task with commands
		const outcome = await runDelegation(
			deps,
			makeParams({
				validation: { required: true, commands: initialCommands },
			}),
			dir,
			{ executionId: "call-init-commands" },
		);
		assert.equal(launches.length, 1);
		const childPacket = JSON.parse(launches[0].task);
		assert.deepEqual(childPacket.spec.validation.commands, initialCommands, "commands preserve ordering and string verbatim to child");
		assert.deepEqual(outcome.task.spec?.validation.commands, initialCommands, "stored task has initial commands");

		// 2. Redelegate with different commands passes new commands to child but preserves stored spec
		const reCommands = ["npm test", incidentCommand];
		const reOutcome = await runDelegation(
			deps,
			makeParams({
				taskId: outcome.task.taskId,
				validation: { required: true, commands: reCommands },
			}),
			dir,
			{ executionId: "call-redelegate-commands" },
		);
		assert.equal(launches.length, 2);
		const reChildPacket = JSON.parse(launches[1].task);
		assert.deepEqual(reChildPacket.spec.validation.commands, reCommands, "redelegate commands reach child unchanged");
		// Stored original TaskSpec is not rewritten (ticket 53/incident spec)
		const storedTask = store.require(outcome.task.taskId);
		assert.deepEqual(storedTask.spec?.validation.commands, initialCommands, "stored TaskSpec is never rewritten on redelegate");

		// 3. Redelegate with missing commands is refused before launch, doesn't silently borrow old commands
		await assert.rejects(
			runDelegation(
				deps,
				makeParams({
					taskId: outcome.task.taskId,
					validation: { required: true },
				}),
				dir,
				{ executionId: "call-redelegate-missing" },
			),
			(error) => {
				assert.equal(error?.code, "TASKSPEC_VALIDATION_INCOMPLETE");
				return true;
			},
		);
		assert.equal(launches.length, 2, "child was not launched on missing commands");
	}
}

assert.equal(
	PLANNER_DELEGATE_PARAMETERS.properties.validation.properties.commands.description,
	"Required and must contain at least one non-empty command when validation.required is true. Each entry is a shell command starting with a program name or path, not an instruction sentence.",
);

// ---------------------------------------------------------------------------
// Ticket 17 — the delegation surface is split: planner_delegate mints only
// (no taskId/recovery keys exist to hallucinate into), planner_redelegate
// binds an existing Task (taskId required, all four roles, recovery kept).
// ---------------------------------------------------------------------------
{
	const create = PLANNER_DELEGATE_PARAMETERS;
	assert.equal("taskId" in create.properties, false, "planner_delegate mints only — no taskId key exists to invent");
	assert.equal("recovery" in create.properties, false, "recovery re-execution is a rebind concern");
	assert.deepEqual(
		create.properties.role.anyOf.map((entry) => entry.const),
		["worker", "explorer", "validator"],
		"a reviewer invocation only exists over an existing Task",
	);

	const rebind = PLANNER_REDELEGATE_PARAMETERS;
	assert.ok(rebind.required.includes("taskId"), "planner_redelegate binds — taskId is required");
	assert.equal("recovery" in rebind.properties, true, "the recovery decision stays on the binding surface");
	assert.deepEqual(
		rebind.properties.role.anyOf.map((entry) => entry.const),
		["worker", "explorer", "validator", "reviewer"],
	);
	assert.match(rebind.properties.taskId.description, /Never construct one/);
	assert.match(rebind.properties.taskId.description, /details\.taskId/);
}

// acceptanceMode is a creation-time contract: planner_delegate carries it,
// planner_redelegate must not expose it (the runtime guard still refuses a
// non-validating host's pass-through).
{
	assert.equal("acceptanceMode" in PLANNER_DELEGATE_PARAMETERS.properties, true, "mint keeps the acceptanceMode key");
	assert.equal("acceptanceMode" in PLANNER_REDELEGATE_PARAMETERS.properties, false, "rebind never re-opens the acceptance contract");
}

// ---------------------------------------------------------------------------
// Non-completed launcher statuses (P0-A): Task transitions, stateReason
// recorded, structured termination returned (no throw), quiet worktree
// confirms the stop → C_terminal recorded and the write lock released.
// ---------------------------------------------------------------------------
// The status table below asserts this P0-A mapping verbatim (spec §2).
const TERMINAL_REASON_TABLE = {
	cancelled: "operator_cancel",
	interrupted: "operator_cancel",
	timed_out: "timeout",
	tool_budget_exhausted: "tool_budget",
	failed: "provider_failure",
	structured_output_failed: "tool_error",
	acceptance_failed: "tool_error",
	invalid_request: "launch_failure",
	unavailable_context: "provider_failure",
	duplicate_node: "launch_failure",
};

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
	const { deps } = makeDeps({
		store,
		concurrency,
		gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
		launch: failureResponse(status, `${status} happened`),
	});
	const outcome = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: `call-${status}` });
	assert.equal(outcome.termination?.status, status, `${status} returns structured termination details, not a thrown refusal`);
	assert.equal(outcome.termination?.terminationConfirmed, true, "quiet worktree confirms the stop");
	assert.equal(outcome.termination?.confirmationBasis, "terminal+quiet-worktree");
	const record = store.get(taskId);
	assert.equal(record.state, expectedState, `${status} -> ${expectedState}`);
	assert.match(record.stateReason ?? "", new RegExp(status));
	assert.equal(record.reports.length, 0, "no report recorded");
	assert.equal(concurrency.status().reservations.length, 0, "confirmed stop releases the write lock");
	const execution = record.executions[0];
	assert.equal(execution.status, "stopped");
	assert.equal(execution.endedReason, TERMINAL_REASON_TABLE[status]);
	assert.ok(execution.cTerminal, "confirmed stop records the residual sample");
	assert.equal(record.writerHold, undefined, "no hold after a confirmed stop");
}

// ---------------------------------------------------------------------------
// Launch-time rejection: a `failed` terminal whose child never ran (zero
// turns, zero wall time) is a launch_failure, not a provider_failure, and
// the host error text reaches the Root-facing render. Regression coverage
// for the pi-subagents completion-guard refusal (2026-09-18
// T-20260918-001..003), which misread a read-only constraint as an
// implementation task and was reported back as provider_failure.
// ---------------------------------------------------------------------------
const LAUNCH_REJECT_ERROR = "Agent 'planner-scout' was given an implementation task, but its tool allowlist has no mutation-capable tools. Add bash, edit, write, or another mutation-capable tool to the agent, or use a read-only task/agent.";
for (const [name, usage, expectedReason] of [
	["launch-reject", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0, toolCalls: 0, durationMs: 0 }, "launch_failure"],
	["mid-run-failure", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 2, toolCalls: 0, durationMs: 1500 }, "provider_failure"],
]) {
	const dir = initRealRepo();
	const store = new TaskStore();
	const { deps, launches } = makeDeps({
		store,
		gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
		launch: async (request) => {
			launches.push(request);
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "failed",
				runId: "run-launch-reject",
				agent: "planner-scout",
				model: "test/model",
				exitCode: 1,
				error: LAUNCH_REJECT_ERROR,
				usage,
			};
		},
	});
	const outcome = await runDelegation(
		deps,
		makeParams({ role: "explorer", objective: "read-only recon: do not create, modify, or delete any files", acceptanceMode: "observation" }),
		dir,
		{ executionId: `call-${name}` },
	);
	assert.equal(launches[0].agent, "planner-scout", "explorer binds the restricted reader");
	assert.equal(outcome.termination?.reason, expectedReason, `${name}: endedReason is ${expectedReason}`);
	assert.equal(outcome.termination?.error, LAUNCH_REJECT_ERROR, `${name}: the host error text is carried on the termination`);
	const record = store.get(outcome.task.taskId);
	assert.equal(record.state, "failed");
	assert.equal(record.executions[0].endedReason, expectedReason);
	const rendered = renderDelegationOutcome(outcome);
	assert.ok(
		rendered.includes(`error: Agent 'planner-scout' was given an implementation task`),
		`${name}: the rendered result surfaces the host error so Root does not misdiagnose a refusal as a provider outage`,
	);
}

// ---------------------------------------------------------------------------
// Identity mismatch: the report is received but never admitted — it stays on
// the execution as unacceptedReport, never enters the report sequence, and
// the review loop sees a report-invalid contract correction, not a report.
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
	assert.equal(outcome.task.reports.length, 0, "a mismatched report never enters the report sequence");
	const execution = outcome.task.executions.at(-1);
	assert.equal(execution.reportIndex, undefined, "no reportIndex binds a mismatched report");
	assert.equal(execution.unacceptedReport?.taskId, "T-99999999-999", "kept verbatim as unaccepted material");
	assert.match(execution.unacceptedReportReason ?? "", /identity does not match/, "the rejection is recorded with a reason");
	assert.equal(outcome.decision.action, "report_correction", "identity failure routes to a bounded report correction");
	assert.notEqual(outcome.task.state, "completed", "identity failure can never pass review");
}

// ---------------------------------------------------------------------------
// A writer's stop is only confirmed on *complete* evidence: post-launch
// hash-object failures leave both stop samples with snapshotGap, the stop is
// unconfirmed, the writer hold is persisted, and the reservation stays held.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	writeFileSync(join(dir, "tracked.txt"), "base\n");
	realGit(dir, "add", "tracked.txt");
	realGit(dir, "commit", "-qm", "base");
	writeFileSync(join(dir, "tracked.txt"), "dirty before launch\n");

	let launched = false;
	const concurrency = new ConcurrencyController();
	const { deps } = makeDeps({
		concurrency,
		gitRunner: async (args, cwd) => {
			if (launched && args[0] === "hash-object") {
				return { stdout: "", stderr: "controlled hash failure", code: 1 };
			}
			return realGit(cwd ?? dir, ...args);
		},
		launch: async (request) => {
			launched = true;
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "completed",
				runId: "run-hash-gap",
				agent: "worker",
				result: {
					kind: "structured",
					value: makeReport(request.nodeId, "run-hash-gap", request.cwd),
				},
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams({ scope: { allowedPaths: ["tracked.txt"] } }), dir, { executionId: "call-hash-gap" });
	const record = deps.store.require(outcome.task.taskId);
	const execution = record.executions.at(-1);

	assert.equal(execution.status, "stop_unconfirmed", "hash gaps can never confirm a writer stop");
	assert.equal(execution.terminationConfirmed, false);
	assert.equal(execution.evidenceIncomplete, true, "incomplete evidence is flagged, not smoothed over");
	assert.equal(execution.cReport?.snapshotGap?.reason, "hash-failed");
	assert.equal(execution.stopSamples?.length, 2, "both stop samples are kept");
	assert.ok(execution.stopSamples.every((sample) => sample.snapshotGap?.reason === "hash-failed"));
	assert.ok(record.writerHold, "the writer hold is persisted until a later confirmed stop");
	assert.equal(record.writerHold.executionId, "call-hash-gap");
	assert.equal(concurrency.status().reservations.length, 1, "the reservation stays held");
	assert.equal(outcome.termination?.executionStatus, "stop_unconfirmed");
	assert.equal(outcome.termination?.evidenceIncomplete, true);
	assert.equal(record.reports.length, 0, "the report stays out of the accepted sequence while the stop is unconfirmed");
	assert.equal(execution.unacceptedReport?.taskId, outcome.task.taskId, "the received report is kept as unaccepted material");
}

// ---------------------------------------------------------------------------
// Explorer maps to the scout agent and holds no write lock.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const { deps, launches } = makeDeps({ gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args) });
	const outcome = await runDelegation(
		deps,
		makeParams({ role: "explorer", objective: "survey the module" }),
		dir,
		{ executionId: "call-e" },
	);
	assert.equal(launches[0].agent, "planner-scout", "explorer -> trusted restricted reader (builtin scout has bash+write)");
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
	const { deps, launches } = makeDeps({ gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args) });
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
		restrictedReaderAgent: "planner-scout",
		quiescenceWaitMs: 0,
		quiescenceSampleGapMs: 0,
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
// (Ticket 17: 这些都是 planner_redelegate 路径的 runDelegation 用例 —
//  planner_delegate 的 schema 已经没有 taskId/recovery 键。)
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

	// TASK_UNKNOWN: reviewer binding unknown Task — points to canonical details.taskId, never suggests omitting taskId.
	{
		const { deps, launches } = makeReviewDeps(dir, { reviewFor: () => ({}) });
		const refusal = await expectRefusal(
			runDelegation(deps, reviewerParams("T-20200101-001"), dir, { executionId: "call-r-u" }),
			"TASK_UNKNOWN",
		);
		assert.equal(launches.length, 0, "launch not called");
		assert.equal(deps.store.active(), undefined, "no Task was minted");
		assert.equal(deps.store.list().length, 0, "no Task was minted");
		assert.equal(refusal.message.includes("omit taskId"), false, "reviewer guidance must not suggest omitting taskId");
		assert.ok(refusal.message.includes("role=reviewer can only bind an existing Task"));
		assert.ok(refusal.message.includes("call planner_tasks to find its canonical taskId"));
		assert.equal(
			refusal.message,
			"planner_delegate refused: unknown Task T-20200101-001; role=reviewer can only bind an existing Task — call planner_tasks to find its canonical taskId",
		);
	}

	// TASK_FOREIGN_WORKSPACE: reviewer binding Task from different workspace — directs to Task's cwd or existing reviewable Task id in this workspace, never suggests omitting taskId.
	{
		const store = new TaskStore();
		store.create(createTaskSpec({
			taskId: "T-20260915-399",
			objective: "other workspace task",
			cwd: dir,
			role: "worker",
			validation: { required: false },
		}));
		const foreign = initCommittedRepo();
		const { deps, launches } = makeReviewDeps(foreign, { store, reviewFor: () => ({}) });
		const refusal = await expectRefusal(
			runDelegation(deps, reviewerParams("T-20260915-399"), foreign, { executionId: "call-r-f" }),
			"TASK_FOREIGN_WORKSPACE",
		);
		assert.equal(launches.length, 0, "launch not called");
		assert.equal(store.list().length, 1, "no Task was minted");
		assert.equal(refusal.message.includes("omit taskId"), false, "reviewer guidance must not suggest omitting taskId");
		assert.ok(refusal.message.includes("re-run from that workspace's cwd"));
		assert.ok(refusal.message.includes("pass an existing reviewable Task id in this workspace"));
		assert.equal(
			refusal.message,
			`planner_delegate refused: Task T-20260915-399 belongs to workspace ${dir}, not ${foreign}; the id belongs to a different workspace's ledger; re-run from that workspace's cwd — call planner_tasks there to list its live Tasks — or pass an existing reviewable Task id in this workspace`,
		);
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
// launcher 非 completed (P0-A): structured termination outcome, Task
// untouched; this terminal carried no usage field, so G4 has nothing to
// record (children = worker's only).
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
	const reviewOutcome = await runDelegation(deps, reviewerParams(taskId), dir, { executionId: "call-r" });
	assert.equal(reviewOutcome.termination?.status, "structured_output_failed", "structured termination, not a thrown refusal");
	assert.equal(reviewOutcome.termination?.reason, "tool_error");
	assert.equal(reviewOutcome.termination?.error, "child returned unparseable output");
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
// 5. abort → grace expires → DelegationAborted; the RESPONSE subscription is
//    NOT dropped (P0-A A3): a terminal arriving after the deadline reaches
//    onLateTerminal exactly once, without a second settle.
// ---------------------------------------------------------------------------
{
	const bus = tinyEmitter();
	const launcher = createHostLauncher({ events: bus }, { cancelGraceMs: 20 });
	const controller = new AbortController();
	let lateTerminal;
	const promise = launcher(launcherRequest({ requestId: "req-expiry", nodeId: "T-20260915-501" }), controller.signal, {
		onLateTerminal: (response) => { lateTerminal = response; },
	});
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
	assert.ok(settledWith instanceof DelegationAborted, "the wait itself still settled once with DelegationAborted");
	assert.equal(lateTerminal?.status, "cancelled", "late terminal reaches onLateTerminal after the grace deadline");
	// A second late terminal must not double-finalize: the subscription is gone.
	lateTerminal = undefined;
	bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: request.requestId,
		ownerRunId: request.ownerRunId,
		nodeId: request.nodeId,
		status: "cancelled",
	});
	await sleep(10);
	assert.equal(lateTerminal, undefined, "no second late-terminal delivery");
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
// 6. runDelegation cancellation, both paths (P0-A): (a) cancelled terminal →
//    blocked + usage landed (G4) + quiescence-confirmed stop → structured
//    termination outcome + lock released + C_terminal; (b) grace-expired
//    DelegationAborted → blocked + stop_unconfirmed + persisted writerHold +
//    lock KEPT, then a late terminal finalizes exactly once.
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
		gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
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
	const outcome = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-ca" });
	assert.equal(outcome.termination?.status, "cancelled", "structured termination, not a thrown refusal");
	assert.equal(outcome.termination?.reason, "operator_cancel");
	assert.equal(outcome.termination?.executionStatus, "stopped");
	assert.equal(outcome.termination?.terminationConfirmed, true);
	assert.equal(outcome.termination?.confirmationBasis, "terminal+quiet-worktree");
	assert.equal(outcome.task.taskId, taskId);
	const record = store.get(taskId);
	assert.equal(record.state, "blocked", "cancelled terminal parks the Task");
	assert.match(record.stateReason ?? "", /cancelled/);
	const children = usage.taskUsage(taskId)?.children ?? [];
	assert.equal(children.length, 1, "G4: cancelled terminal usage recorded");
	assert.equal(children[0].outcome, "failed", "non-completed terminal lands as outcome=failed");
	assert.equal(children[0].kind, "worker");
	assert.equal(concurrency.status().reservations.length, 0, "confirmed stop releases the write lock");
	const execution = record.executions[0];
	assert.equal(execution.status, "stopped");
	assert.equal(execution.endedReason, "operator_cancel");
	assert.equal(execution.usageComplete, true);
	assert.ok(execution.cTerminal?.gitStatusHash, "residual C_terminal recorded");
	assert.equal(record.writerHold, undefined);
}

{
	// (b) grace-expiry path: stop_unconfirmed + writerHold + no release; the
	//     late terminal then finalizes once (quiescence → confirmed → hold
	//     cleared, reservation released, usage recorded exactly once).
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
	let capturedHooks;
	const { deps } = makeDeps({
		store,
		concurrency,
		usage,
		gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
		launch: async (_request, _signal, hooks) => {
			capturedHooks = hooks;
			throw new DelegationAborted(taskId);
		},
	});
	const outcome = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-cb" });
	assert.equal(outcome.termination?.executionStatus, "stop_unconfirmed", "grace expiry without a terminal is an unconfirmed stop");
	assert.equal(outcome.termination?.reason, "operator_cancel");
	assert.equal(outcome.termination?.terminationConfirmed, false);
	const record = store.get(taskId);
	assert.equal(record.state, "blocked", "grace-expired abort parks the Task");
	assert.match(record.stateReason ?? "", /no terminal response within grace/);
	assert.equal((usage.taskUsage(taskId)?.children ?? []).length, 0, "no usage row without a terminal");
	assert.equal(concurrency.status().reservations.length, 1, "unconfirmed stop keeps the write lock");
	assert.equal(record.writerHold?.executionId, "call-cb", "persisted writer hold names the execution");
	assert.equal(record.executions[0].status, "stop_unconfirmed");
	// Admission: the held workspace refuses a second writer even for the same
	// Task — lift the terminal state so the WRITER_HOLD guard is what fires.
	record.state = "changes_requested";
	const second = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-cb2" })
		.then(() => undefined, (e) => e);
	assert.ok(second instanceof DelegationRefused && second.code === "WRITER_HOLD", `writer hold refuses a second writer, got ${second}`);
	record.state = "blocked"; // restore the parked state before the late-terminal part
	// A3 — the late terminal finalizes the execution exactly once.
	capturedHooks.onLateTerminal({
		requestId: "req-late",
		ownerRunId: "owner-run-1",
		nodeId: taskId,
		status: "cancelled",
		runId: "run-late",
		agent: "worker",
		usage: { input: 9, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 2, toolCalls: 2, durationMs: 20 },
	});
	await sleep(200);
	const after = store.get(taskId);
	const execAfter = after.executions[0];
	assert.equal(execAfter.status, "stopped", "late terminal lifts stop_unconfirmed after quiescence");
	assert.equal(execAfter.terminationConfirmed, true);
	assert.equal(execAfter.confirmationBasis, "terminal+quiet-worktree");
	assert.equal(execAfter.endedReason, "operator_cancel");
	assert.ok(execAfter.cTerminal?.gitStatusHash, "C_terminal recorded from the late terminal");
	assert.equal(execAfter.runId, "run-late");
	assert.equal(execAfter.usageComplete, true);
	assert.equal(after.writerHold, undefined, "confirmed late stop clears the hold");
	assert.equal(concurrency.status().reservations.length, 0, "reservation released exactly once");
	const children = usage.taskUsage(taskId)?.children ?? [];
	assert.equal(children.length, 1, "late terminal usage recorded exactly once");
	assert.equal(children[0].outcome, "failed");
	assert.equal(after.reports.length, 0, "no report is ever admitted from a late terminal");
	assert.equal(after.state, "blocked", "Task stays parked for the operator");
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
			gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
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
		const outcome = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: `call-g4-${status}-${withUsage}` });
		assert.equal(outcome.termination?.status, status, `${status} returns structured termination`);
		assert.equal(store.get(taskId).state, expectedState, `${status} -> ${expectedState}`);
		const children = usage.taskUsage(taskId)?.children ?? [];
		assert.equal(children.length, withUsage ? 1 : 0, `${status} usage ${withUsage ? "recorded" : "absent"} (G4)`);
		if (withUsage) assert.equal(children[0].outcome, "failed");
		const execution = store.get(taskId).executions[0];
		assert.equal(execution.status, "stopped", `${status} terminal + quiet worktree confirms the stop`);
		assert.equal(execution.usageComplete, withUsage, "usageComplete reflects whether terminal usage landed");
		assert.equal(execution.endedReason, TERMINAL_REASON_TABLE[status]);
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
	const reviewOutcome = await runDelegation(deps, reviewerParams(taskId), dir, { executionId: "call-r" });
	assert.equal(reviewOutcome.termination?.status, "cancelled", "reviewer cancel returns structured termination");
	assert.equal(reviewOutcome.termination?.reason, "operator_cancel");
	assert.equal(reviewOutcome.task.taskId, taskId);
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

// ---------------------------------------------------------------------------
// P0-A.1 — stop unconfirmed: the worktree still changes between the two
// quiescence samples (a cancelled terminal alone proves nothing). Result:
// stop_unconfirmed + interimSample + writerHold + lock kept; a second writer
// is refused. The flip lands on the first status probe after the terminal,
// so sample 1 sees a file that sample 2 does not.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const store = new TaskStore();
	const taskId = "T-20260916-701";
	store.create(createTaskSpec({
		taskId,
		objective: "cancel while the tree is still moving",
		cwd: dir,
		role: "worker",
		validation: { required: false },
	}));
	const concurrency = new ConcurrencyController();
	// Armed by the launch (after A_run); the flip lands on the first
	// `status --porcelain=v2 --branch` of quiescence sample 1 — sample 2 sees
	// the file gone, so the tree "was still moving".
	let flipArmed = false;
	const { deps } = makeDeps({
		store,
		concurrency,
		gitRunner: async (args, cwd) => {
			const result = realGit(cwd ?? dir, ...args);
			if (flipArmed && args[0] === "status" && args.includes("--porcelain=v2") && !args.includes("--untracked-files=all")) {
				flipArmed = false;
				return { ...result, stdout: `${result.stdout}? wrc-flip.txt\n` };
			}
			return result;
		},
		launch: async (request) => {
			flipArmed = true;
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "cancelled",
				error: "operator cancel",
				runId: "run-flip",
				agent: "worker",
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-flip" });
	assert.equal(outcome.termination?.executionStatus, "stop_unconfirmed", "differing samples keep the stop unconfirmed");
	assert.equal(outcome.termination?.terminationConfirmed, false);
	const record = store.get(taskId);
	assert.equal(record.state, "blocked");
	assert.equal(record.executions[0].status, "stop_unconfirmed");
	assert.ok(record.executions[0].interimSample, "the still-moving sample is recorded as interim, never as C_terminal");
	assert.equal(record.executions[0].cTerminal, undefined);
	assert.ok(record.writerHold, "persisted writer hold");
	assert.equal(concurrency.status().reservations.length, 1, "the write lock is NOT released on an unconfirmed stop");
	// Lift the terminal state so the WRITER_HOLD guard — not TASK_CLOSED — fires.
	record.state = "changes_requested";
	const refused = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-flip-2" })
		.then(() => undefined, (e) => e);
	assert.ok(refused instanceof DelegationRefused && refused.code === "WRITER_HOLD", `WRITER_HOLD expected, got ${refused}`);
}

{
	const dir = initRealRepo();
	const store = new TaskStore();
	const taskId = "T-20260916-703";
	store.create(createTaskSpec({ taskId, objective: "complete while the tree is moving", cwd: dir, role: "worker", validation: { required: false } }));
	const concurrency = new ConcurrencyController();
	let statusCallsAfterLaunch = 0;
	let launched = false;
	const { deps } = makeDeps({
		store,
		concurrency,
		gitRunner: async (args, cwd) => {
			const result = realGit(cwd ?? dir, ...args);
			if (launched && args[0] === "status" && args.includes("--porcelain=v2") && !args.includes("--untracked-files=all")) {
				statusCallsAfterLaunch += 1;
				if (statusCallsAfterLaunch === 2) return { ...result, stdout: `${result.stdout}? completed-flip.txt\n` };
			}
			return result;
		},
		launch: async (request) => {
			launched = true;
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "completed",
				runId: "run-completed-flip",
				agent: "worker",
				result: { kind: "structured", value: makeReport(taskId, "run-completed-flip", dir) },
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-completed-flip" });
	assert.equal(outcome.termination?.executionStatus, "stop_unconfirmed");
	assert.equal(store.require(taskId).reports.length, 0);
	assert.ok(store.require(taskId).writerHold);
	assert.equal(concurrency.status().reservations.length, 1);
}

// ---------------------------------------------------------------------------
// P0-A.2 — evidence-incomplete: a failing status probe makes the residual
// state unknown (never clean). stop_unconfirmed + evidenceIncomplete + hold.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const store = new TaskStore();
	const taskId = "T-20260916-702";
	store.create(createTaskSpec({
		taskId,
		objective: "cancel with a dead git probe",
		cwd: dir,
		role: "worker",
		validation: { required: false },
	}));
	const concurrency = new ConcurrencyController();
	// Ticket 04 — a dead probe at launch now refuses pre-launch, so this test
	//    simulates git dying between the A_run sample and the stop samples.
	let dead = false;
	const { deps } = makeDeps({
		store,
		concurrency,
		gitRunner: async (args, cwd) => dead ? NO_GIT(args, cwd) : fakeCleanGit()(args, cwd),
		launch: async (request) => {
			dead = true;
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "cancelled",
				error: "operator cancel",
				runId: "run-nogit",
				agent: "worker",
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-nogit" });
	assert.equal(outcome.termination?.executionStatus, "stop_unconfirmed");
	assert.equal(outcome.termination?.evidenceIncomplete, true, "probe failure is evidence-incomplete, not clean");
	assert.ok(outcome.termination?.probeFailures?.length, "structured probe failures recorded on the termination");
	const record = store.get(taskId);
	assert.equal(record.executions[0].evidenceIncomplete, true);
	assert.equal(record.executions[0].status, "stop_unconfirmed");
	assert.equal(record.executions[0].stopSamples?.length, 2, "both stop samples retained");
	assert.ok(record.executions[0].stopSamples?.some((sample) => sample.probeFailures?.length), "stop samples carry the probe failures");
	assert.ok(record.writerHold);
	assert.equal(concurrency.status().reservations.length, 1);
}

// ---------------------------------------------------------------------------
// P0-A.3 — A7 race: a completed terminal arriving after the cancel request is
// collected as lateReport — never admitted to reports, never advanced.
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	const store = new TaskStore();
	const taskId = "T-20260916-703";
	store.create(createTaskSpec({
		taskId,
		objective: "finish exactly as the cancel lands",
		cwd: dir,
		role: "worker",
		validation: { required: false },
	}));
	const controller = new AbortController();
	const { deps } = makeDeps({
		store,
		gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
		launch: async (request) => {
			controller.abort();
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "completed",
				runId: "run-race",
				agent: "worker",
				usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, cost: 0.002, turns: 2, toolCalls: 1, durationMs: 5 },
				result: { kind: "structured", value: makeReport(taskId, "run-race", request.cwd) },
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-race", signal: controller.signal });
	assert.equal(outcome.termination?.status, "completed", "the late success terminal is still reported as its status");
	assert.equal(outcome.termination?.reason, "operator_cancel", "cancel-first wins the race verdict");
	const record = store.get(taskId);
	assert.equal(record.state, "blocked", "cancel-first parks the Task");
	assert.equal(record.reports.length, 0, "the late report is collected, not admitted");
	assert.equal(record.executions[0].lateReport?.evidence?.workerRunId, "run-race");
	assert.equal(record.reviews.length, 0, "no review advanced");
	assert.equal(record.executions[0].cancelRequestedAt !== undefined, true, "cancel request stamped");
	assert.equal(record.executions[0].status, "stopped", "quiet worktree confirms the stop");
}

// ---------------------------------------------------------------------------
// P0-A.4 — pre-launch abort: the REQUEST was never emitted, nothing ran; the
// stop is trivially confirmed (basis no-launch) and the lock releases.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const store = new TaskStore();
	const taskId = "T-20260916-704";
	store.create(createTaskSpec({
		taskId,
		objective: "abort before anything ran",
		cwd: dir,
		role: "worker",
		validation: { required: false },
	}));
	const concurrency = new ConcurrencyController();
	const { deps } = makeDeps({
		store,
		concurrency,
		gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
		launch: async () => { throw new DelegationAborted(taskId, false); },
	});
	const outcome = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-prelaunch" });
	assert.equal(outcome.termination?.executionStatus, "stopped");
	assert.equal(outcome.termination?.confirmationBasis, "no-launch");
	const record = store.get(taskId);
	assert.equal(record.state, "blocked");
	assert.equal(record.executions[0].endedReason, "operator_cancel");
	assert.equal(concurrency.status().reservations.length, 0, "nothing ran — the lock releases");
	assert.equal(record.writerHold, undefined);
}

// ---------------------------------------------------------------------------
// P0-A.5 — healthy completion still records the lifecycle fields: status
// completed, endedReason normal, terminationConfirmed, usageComplete.
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	const { deps } = makeReviewDeps(dir, { reviewFor: (request) => makeReview(request.nodeId) });
	const worker = await runDelegation(deps, makeParams(), dir, { executionId: "call-healthy" });
	const record = deps.store.require(worker.task.taskId);
	const execution = record.executions[0];
	assert.equal(execution.status, "completed");
	assert.equal(execution.endedReason, "normal");
	assert.equal(execution.terminationConfirmed, true);
	assert.equal(execution.confirmationBasis, "terminal+quiet-worktree");
	assert.equal(execution.usageComplete, true);
	assert.equal(record.writerHold, undefined);
}

// ---------------------------------------------------------------------------
// P0-B.1 — envelope validation: invalid configs refuse before any launch.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const { deps, launches } = makeDeps({ gitRunner: async (args, cwd) => realGit(dir, ...args) });
	await expectRefusal(runDelegation(deps, makeParams({ envelope: {} }), dir, { executionId: "e-inv1" }), "ENVELOPE_INVALID");
	await expectRefusal(runDelegation(deps, makeParams({ envelope: { maxTokens: 0 } }), dir, { executionId: "e-inv2" }), "ENVELOPE_INVALID");
	await expectRefusal(runDelegation(deps, makeParams({ envelope: { maxWallMs: Number.NaN } }), dir, { executionId: "e-inv3" }), "ENVELOPE_INVALID");
	await expectRefusal(runDelegation(deps, makeParams({ envelope: { maxTokens: 0.5 } }), dir, { executionId: "e-inv4" }), "ENVELOPE_INVALID");
	assert.equal(launches.length, 0, "invalid envelope never reaches the launcher");
}

// ---------------------------------------------------------------------------
// P0-B.2 — tokens breach trips the monitor once: CANCEL → cancelled terminal →
// worker_runaway + recovery.required; regression/duplicate UPDATEs don't
// re-breach. Quiet worktree confirms the stop.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal, hooks) => {
			const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
			hooks.onUpdate({ ...base, tokens: 3000 });
			hooks.onUpdate({ ...base, tokens: 2500 }); // regression must not reset the observed level
			hooks.onUpdate({ ...base, tokens: 7000 }); // breach
			hooks.onUpdate({ ...base, tokens: 8000 }); // already tripped — no second action
			assert.equal(signal.aborted, true, "monitor abort reached the launcher signal");
			return {
				...base,
				status: "cancelled",
				runId: "run-r",
				agent: "worker",
				usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.002, turns: 4, toolCalls: 4, durationMs: 30 },
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams({ envelope: { maxTokens: 5000 } }), dir, { executionId: "call-r1" });
	assert.equal(outcome.termination.reason, "worker_runaway");
	assert.equal(outcome.termination.anomaly.signal, "tokens");
	assert.equal(outcome.termination.anomaly.observed, 7000, "observed is the first value over the line");
	assert.equal(outcome.termination.anomaly.limit, 5000);
	assert.equal(outcome.termination.terminationConfirmed, true, "quiet worktree confirms");
	const record = outcome.task;
	const exec = record.executions[0];
	assert.equal(exec.status, "stopped");
	assert.equal(exec.endedReason, "worker_runaway");
	assert.equal(exec.runawayObservation.signal, "tokens");
	assert.equal(exec.envelope.maxTokens, 5000);
	assert.equal(record.recovery.required, true, "runaway flags needs_replan");
	assert.equal(record.recovery.executionId, "call-r1");
	assert.match(record.recovery.reason, /tokens 7000 exceeded envelope 5000/);
}

// ---------------------------------------------------------------------------
// P0-B.3 — without an envelope the monitor never cancels, even at high tokens.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal, hooks) => {
			const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
			hooks.onUpdate({ ...base, tokens: 999_999 });
			assert.equal(signal.aborted, false, "no envelope → observe-only, never abort");
			return {
				...base,
				status: "completed",
				runId: "run-ok",
				agent: "worker",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, toolCalls: 1, durationMs: 5 },
				result: { kind: "structured", value: makeReport(request.nodeId, "run-ok", request.cwd) },
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams(), dir, { executionId: "call-ok" });
	assert.ok(outcome.report, "unconfigured delegation completes untouched");
	assert.equal(outcome.termination, undefined);
	assert.equal(outcome.task.recovery, undefined);
}

// ---------------------------------------------------------------------------
// P0-B.4 — wall-clock breach fires without any UPDATE heartbeat.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal) => {
			await sleep(40);
			assert.equal(signal.aborted, true, "wall breach aborted the run signal");
			return {
				requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
				status: "cancelled",
				runId: "run-w",
				agent: "worker",
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams({ envelope: { maxWallMs: 10 } }), dir, { executionId: "call-w1" });
	assert.equal(outcome.termination.reason, "worker_runaway");
	assert.equal(outcome.termination.anomaly.signal, "wall");
	assert.equal(outcome.termination.anomaly.limit, 10);
	assert.equal(outcome.task.recovery.required, true);
}

// ---------------------------------------------------------------------------
// wrc-incident-followups ticket 01 — the wall deadline re-checks elapsed on a
// monotonic clock: an early-firing timer re-arms for the remainder instead of
// breaching (the incident logged observed=179999 "exceeding" limit=180000).
// ---------------------------------------------------------------------------
function makeFakeWallClock() {
	const state = { now: 0, timer: undefined };
	return {
		state,
		clock: {
			now: () => state.now,
			setTimeout: (fn, ms) => {
				const handle = { fn, ms };
				state.timer = handle;
				return handle;
			},
			clearTimeout: (handle) => {
				if (state.timer === handle) state.timer = undefined;
			},
		},
		fire: () => {
			const timer = state.timer;
			state.timer = undefined;
			timer.fn();
		},
	};
}

{
	const dir = initRealRepo();
	const wall = makeFakeWallClock();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal) => {
			// The deadline fires 1 ms early: no breach, the timer re-arms.
			wall.state.now = 179_999;
			wall.fire();
			assert.equal(signal.aborted, false, "an early deadline re-arms instead of breaching");
			assert.ok(wall.state.timer, "a replacement timer was armed for the remainder");
			assert.equal(wall.state.timer.ms, 1, "the re-arm covers only the remaining 1 ms");
			// Advancing to the real deadline breaches with observed >= limit.
			wall.state.now = 180_000;
			wall.fire();
			assert.equal(signal.aborted, true, "reaching the limit breaches");
			return {
				requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
				status: "cancelled",
				runId: "run-wall-edge",
				agent: "worker",
			};
		},
	});
	deps.wallClock = wall.clock;
	const outcome = await runDelegation(deps, makeParams({ envelope: { maxWallMs: 180_000 } }), dir, { executionId: "call-wall-edge" });
	assert.equal(outcome.termination.reason, "worker_runaway");
	assert.equal(outcome.termination.anomaly.signal, "wall");
	assert.ok(
		outcome.termination.anomaly.observed >= outcome.termination.anomaly.limit,
		"observed never reports below the limit",
	);
	assert.equal(outcome.termination.anomaly.observed, 180_000);
}

{
	const dir = initRealRepo();
	const wall = makeFakeWallClock();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal) => {
			// Clock rollback: elapsed reads negative — no breach, and the re-arm
			// is capped at the limit instead of stretching past it.
			wall.state.now = -50;
			wall.fire();
			assert.equal(signal.aborted, false, "negative elapsed never breaches");
			assert.equal(wall.state.timer.ms, 180_000, "re-arm is bounded by the limit");
			wall.state.now = 200_000;
			wall.fire();
			assert.equal(signal.aborted, true);
			return {
				requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
				status: "cancelled",
				runId: "run-wall-back",
				agent: "worker",
			};
		},
	});
	deps.wallClock = wall.clock;
	const outcome = await runDelegation(deps, makeParams({ envelope: { maxWallMs: 180_000 } }), dir, { executionId: "call-wall-back" });
	assert.equal(outcome.termination.anomaly.signal, "wall");
	assert.equal(outcome.termination.anomaly.observed, 200_000);
	assert.ok(outcome.termination.anomaly.observed >= outcome.termination.anomaly.limit);
}

{
	// The launcher returns while a re-armed timer is pending: stopWallTimer
	// clears it, so nothing breaches late.
	const dir = initRealRepo();
	const wall = makeFakeWallClock();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal) => {
			wall.state.now = 179_999;
			wall.fire(); // early deadline → re-arm, then the launcher returns
			assert.equal(signal.aborted, false);
			return {
				requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
				status: "completed",
				runId: "run-wall-clear",
				agent: "worker",
				result: { kind: "structured", value: makeReport(request.nodeId, "run-wall-clear", request.cwd) },
			};
		},
	});
	deps.wallClock = wall.clock;
	const outcome = await runDelegation(deps, makeParams({ envelope: { maxWallMs: 180_000 } }), dir, { executionId: "call-wall-clear" });
	assert.equal(outcome.termination, undefined);
	assert.equal(wall.state.timer, undefined, "the re-armed timer was cleared on launcher return");
	assert.equal(outcome.task.recovery, undefined, "no late breach re-arms recovery");
}

// ---------------------------------------------------------------------------
// P0-B.5 — recovery gate: missing/wrong/misrouted decisions refuse; a valid
// retry_same_plan produces a new execution under the same Task and is consumed.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal, hooks) => {
			const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
			hooks.onUpdate({ ...base, tokens: 9999 });
			return { ...base, status: "cancelled", runId: "run-g", agent: "worker" };
		},
	});
	const runaway = await runDelegation(deps, makeParams({ envelope: { maxTokens: 100 } }), dir, { executionId: "call-g1" });
	const taskId = runaway.task.taskId;
	assert.equal(runaway.task.recovery.required, true);

	// No recovery field on a required Task → refused.
	await expectRefusal(
		runDelegation(deps, makeParams({ taskId, envelope: { maxTokens: 200000 } }), dir, { executionId: "call-g2" }),
		"RECOVERY_REQUIRED",
	);
	// Wrong executionId → refused.
	const wrong = await expectRefusal(
		runDelegation(deps, makeParams({
			taskId,
			recovery: { executionId: "call-other", action: "retry_same_plan", reason: "x", worktreeDecision: "keep" },
		}), dir, { executionId: "call-g3" }),
		"RECOVERY_REQUIRED",
	);
	assert.match(wrong.message, /does not match the abnormal execution/);
	// abort via planner_delegate → rerouted refusal.
	const abortViaDelegate = await expectRefusal(
		runDelegation(deps, makeParams({
			taskId,
			recovery: { executionId: "call-g1", action: "abort", reason: "x", worktreeDecision: "keep" },
		}), dir, { executionId: "call-g4" }),
		"RECOVERY_REQUIRED",
	);
	assert.match(abortViaDelegate.message, /planner_abort/);
	// P1 action → unwired refusal.
	const p1 = await expectRefusal(
		runDelegation(deps, makeParams({
			taskId,
			recovery: { executionId: "call-g1", action: "change_model", reason: "x", worktreeDecision: "keep" },
		}), dir, { executionId: "call-g5" }),
		"RECOVERY_REQUIRED",
	);
	assert.match(p1.message, /P1/);

	// Valid retry_same_plan: new execution on the same Task; decision consumed.
	// The retry carries a tight envelope so it runaways again — re-arming the
	// requirement under the new executionId for the dedupe check below.
	const retry = await runDelegation(deps, makeParams({
		taskId,
		envelope: { maxTokens: 100 },
		recovery: {
			executionId: "call-g1",
			action: "retry_same_plan",
			reason: "transient provider stall; same plan with a wider envelope",
			worktreeDecision: "keep",
		},
	}), dir, { executionId: "call-g6" });
	assert.equal(retry.task.executions.length, 2, "recovery produced a new execution on the same Task");
	assert.equal(retry.task.executions[1].executionId, "call-g6");
	// The retry's own runaway re-armed the requirement under the new
	// executionId; the consumed decision lives on in recoveryHistory.
	assert.equal(retry.task.recoveryHistory.length, 1, "the consumed decision is kept for dedupe");
	assert.equal(retry.task.recoveryHistory[0].action, "retry_same_plan");
	assert.equal(retry.task.recoveryHistory[0].consumedBy, "call-g6");
	assert.equal(retry.task.recovery.required, true, "second runaway re-arms the requirement");
	assert.equal(retry.task.recovery.executionId, "call-g6");
	const dup = await expectRefusal(
		runDelegation(deps, makeParams({
			taskId,
			recovery: {
				executionId: "call-g6",
				action: "retry_same_plan",
				reason: "transient provider stall; same plan with a wider envelope",
				worktreeDecision: "keep",
			},
		}), dir, { executionId: "call-g7" }),
		"RECOVERY_REQUIRED",
	);
	assert.match(dup.message, /equivalent recovery decision|new basis/);
	for (const decision of [
		{
			executionId: "call-g6",
			action: "retry_same_plan",
			reason: "same claim, different wording",
			evidenceRefs: ["a", "b"],
			worktreeDecision: "keep",
		},
		{
			executionId: "call-g6",
			action: "retry_same_plan",
			reason: "transient provider stall; same plan with a wider envelope",
			evidenceRefs: ["b", "a"],
			worktreeDecision: "keep",
		},
	]) {
		retry.task.recoveryHistory[0].evidenceRefs = ["a", "b"];
		const refusal = validateRecoveryDecision(retry.task, decision, new Set(["retry_same_plan", "fix_environment"]));
		assert.match(refusal ?? "", /equivalent recovery decision|new basis/);
	}
}

// ---------------------------------------------------------------------------
// wrc-incident-followups ticket 03 — a stray RecoveryDecision on a non-final
// Task is refused RECOVERY_NOT_APPLICABLE before dispatch for every role: the
// launcher never runs, no execution is recorded, and the Task is untouched.
// The message re-teaches executionId (details.executionId) vs the child runId.
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	let launches = 0;
	const { deps } = makeReviewDeps(dir, {
		reviewFor: (request) => makeReview(request.nodeId),
	});
	const innerLaunch = deps.launch;
	deps.launch = async (...args) => {
		launches += 1;
		return innerLaunch(...args);
	};
	const first = await runDelegation(deps, makeParams(), dir, { executionId: "call-na0" });
	const taskId = first.task.taskId;
	// A child runId where an executionId belongs — the incident's wrong key.
	const stray = { executionId: "run-na", action: "abort", reason: "leftover recovery", worktreeDecision: "keep" };
	for (const state of ["executing", "reviewing", "changes_requested"]) {
		for (const role of ["worker", "explorer", "validator", "reviewer"]) {
			deps.store.require(taskId).state = state;
			const before = structuredClone(deps.store.require(taskId));
			const params = role === "reviewer"
				? reviewerParams(taskId, { recovery: stray })
				: makeParams({ taskId, role, recovery: stray });
			const refusal = await expectRefusal(
				runDelegation(deps, params, dir, { executionId: `call-na-${state}-${role}` }),
				"RECOVERY_NOT_APPLICABLE",
			);
			assert.match(refusal.message, new RegExp(`only admissible on a blocked Task flagged recovery\\.required — Task ${taskId} is ${state}`));
			assert.match(refusal.message, /not a child runId/, "the refusal re-teaches executionId vs runId");
			assert.match(refusal.message, /received executionId=run-na/, "the refusal echoes what was received");
			assert.match(refusal.message, /action=abort/, "the refusal echoes the recovery action");
			assert.equal(refusal.taskId, taskId);
			assert.deepEqual(deps.store.require(taskId), before, `${role}/${state} refusal leaves the Task unchanged`);
		}
	}
	assert.equal(launches, 1, "stray recovery never reaches the launcher — only the first delegation ran");

	// Omitting recovery still follows the existing reviewer path.
	deps.store.require(taskId).state = "reviewing";
	const review = await runDelegation(deps, reviewerParams(taskId), dir, { executionId: "call-na-review-ok" });
	assert.equal(review.decision.action, "accept");
	assert.equal(launches, 2, "the no-recovery reviewer is dispatched");
}

// ---------------------------------------------------------------------------
// P0-B.6 — abort decision (ADR-0003, planner_abort's action set):
// validateRecoveryDecision under the abort action set + consumeRecovery
// lands nextAction="abort".
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal, hooks) => {
			hooks.onUpdate({ requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, tokens: 9999 });
			return { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, status: "cancelled", runId: "run-a", agent: "worker" };
		},
	});
	const outcome = await runDelegation(deps, makeParams({ envelope: { maxTokens: 10 } }), dir, { executionId: "call-a1" });
	const task = outcome.task;
	assert.equal(task.recovery.required, true);

	const VERDICT_ACTIONS = new Set(["abort"]);
	// A re-execution action is not admissible on the verdict side.
	assert.match(
		validateRecoveryDecision(task, { executionId: "call-a1", action: "retry_same_plan", reason: "x", worktreeDecision: "keep" }, VERDICT_ACTIONS),
		/unknown recovery action|P0 wires abort/,
	);
	// Valid abort decision validates.
	assert.equal(
		validateRecoveryDecision(task, { executionId: "call-a1", action: "abort", reason: "workspace residue needs manual triage", worktreeDecision: "manual" }, VERDICT_ACTIONS),
		undefined,
	);
	deps.store.consumeRecovery(task.taskId, { executionId: "call-a1", action: "abort", reason: "workspace residue needs manual triage", worktreeDecision: "manual" }, "planner_verdict", "abort");
	const settled = deps.store.require(task.taskId);
	assert.equal(settled.recovery.required, false);
	assert.equal(settled.recovery.nextAction, "abort");
	assert.equal(settled.recovery.consumedBy, "planner_verdict");
	assert.equal(settled.state, "blocked", "abort leaves the Task blocked for operator handling");
}

{
	const dir = initRealRepo();
	const store = new TaskStore();
	const taskId = "T-20260916-801";
	store.create(createTaskSpec({ taskId, objective: "resume after manual cleanup", cwd: dir, role: "worker", validation: { required: false } }));
	store.transition(taskId, "executing");
	store.transition(taskId, "blocked");
	store.setRecoveryRequired(taskId, { executionId: "call-held", reason: "stop unconfirmed" });
	store.setWriterHold(taskId, { executionId: "call-held", reason: "stop unconfirmed", since: "2026-09-16T00:00:00.000Z" });
	const concurrency = new ConcurrencyController();
	concurrency.hold({ id: "writerhold:call-held", taskId, role: "worker", capability: "writer", workspaces: [dir], reservedAt: "2026-09-16T00:00:00.000Z" });
	const { deps } = makeDeps({ store, concurrency, gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args) });
	const outcome = await runDelegation(deps, makeParams({
		taskId,
		recovery: { executionId: "call-held", action: "fix_environment", reason: "operator verified all child processes exited", worktreeDecision: "manual" },
	}), dir, { executionId: "call-manual" });
	assert.ok(outcome.report);
	assert.equal(store.require(taskId).writerHold, undefined);
	assert.equal(concurrency.status().reservations.length, 0);
}

{
	const dir = initRealRepo();
	let firstProbe = true;
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => {
			if (firstProbe) {
				firstProbe = false;
				await sleep(20);
			}
			return realGit(cwd ?? dir, ...args);
		},
		launch: async (request, signal) => {
			assert.equal(signal.aborted, false, "pre-launch evidence time is outside the wall envelope");
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "completed",
				runId: "run-fast",
				agent: "worker",
				result: { kind: "structured", value: makeReport(request.nodeId, "run-fast", request.cwd) },
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams({ envelope: { maxWallMs: 5 } }), dir, { executionId: "call-fast" });
	assert.ok(outcome.report);
	assert.equal(outcome.termination, undefined);
}

{
	const dir = initRealRepo();
	const store = new TaskStore();
	const taskId = "T-20260916-802";
	store.create(createTaskSpec({ taskId, objective: "late runaway terminal", cwd: dir, role: "worker", validation: { required: false } }));
	let hooks;
	const { deps } = makeDeps({
		store,
		gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
		launch: async (request, _signal, captured) => {
			hooks = captured;
			captured.onUpdate({ requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, tokens: 200 });
			throw new DelegationAborted(taskId);
		},
	});
	const outcome = await runDelegation(deps, makeParams({ taskId, envelope: { maxTokens: 100 } }), dir, { executionId: "call-late-runaway" });
	assert.equal(outcome.termination?.reason, "worker_runaway");
	hooks.onLateTerminal({ requestId: "late-runaway", ownerRunId: "owner-run-1", nodeId: taskId, status: "cancelled", runId: "run-late-runaway", agent: "worker" });
	await sleep(200);
	assert.equal(store.require(taskId).executions[0].endedReason, "worker_runaway");
}

// ============================================================================
// Ticket 02 — trusted capability: explorer runs the restricted reader, never
// needs worktree quiescence, never holds the workspace; without the trusted
// binding the launch is refused before minting.
// ============================================================================
{
	// A restricted reader in a non-Git directory ends cleanly: matched
	// terminal + trusted binding confirms the stop without worktree evidence.
	const dir = makeTempDir("planner-only-delegate-reader-nongit-");
	const { deps, launches } = makeDeps({ gitRunner: NO_GIT });
	const outcome = await runDelegation(
		deps,
		makeParams({ role: "explorer", objective: "locate the log directories" }),
		dir,
		{ executionId: "call-reader" },
	);
	assert.equal(launches.length, 1);
	assert.equal(launches[0].agent, "planner-scout");
	const execution = outcome.task.executions.at(-1);
	assert.equal(execution.capability, "restricted-reader");
	assert.equal(execution.status, "completed");
	assert.equal(execution.terminationConfirmed, true);
	assert.equal(execution.confirmationBasis, "terminal+restricted-reader");
	assert.ok(execution.capabilityBasis?.includes("planner-scout"));
	assert.equal(outcome.task.writerHold, undefined, "no writer hold for a reader");
	assert.equal(deps.concurrency.status().reservations.length, 0, "reader holds no reservation");
	assert.equal(outcome.task.reports.length, 1, "the report is admitted — receipt is separate from stop evidence");
	// The worktree-mode Task is honestly blocked on unverifiable evidence —
	// never a fabricated stop_unconfirmed.
	assert.equal(outcome.task.state, "blocked");
	assert.equal(outcome.task.blockedReasonCode, "evidence-unverifiable");
}

{
	// No trusted binding → explorer refuses before minting or launching.
	const dir = initRealRepo();
	const { deps, launches } = makeDeps({ restrictedReaderAgent: undefined });
	const refusal = await expectRefusal(
		runDelegation(deps, makeParams({ role: "explorer", objective: "look around" }), dir, { executionId: "call-nobind" }),
		"READER_CAPABILITY_UNPROVEN",
	);
	assert.match(refusal.message, /restricted-reader/);
	assert.equal(launches.length, 0);
	assert.equal(deps.store.list().length, 0, "no Task was minted");
}

{
	// A reader's cancelled terminal is confirmed by terminal+binding: stopped,
	// no hold, and no stop samples were needed.
	const dir = initRealRepo();
	const { deps } = makeDeps({
		gitRunner: NO_GIT,
		launch: async (request) => ({
			requestId: request.requestId,
			ownerRunId: request.ownerRunId,
			nodeId: request.nodeId,
			status: "cancelled",
			error: "operator cancel",
			runId: "run-reader-cancel",
			agent: "planner-scout",
		}),
	});
	const outcome = await runDelegation(
		deps,
		makeParams({ role: "explorer", objective: "peek then cancel" }),
		dir,
		{ executionId: "call-reader-cancel" },
	);
	assert.equal(outcome.termination?.executionStatus, "stopped");
	assert.equal(outcome.termination?.terminationConfirmed, true);
	assert.equal(outcome.termination?.writerHold, undefined, "no writer hold claimed for a reader");
	const execution = outcome.task.executions.at(-1);
	assert.equal(execution.status, "stopped");
	assert.equal(execution.terminationConfirmed, true);
	assert.equal(execution.stopSamples, undefined, "reader stop needs no worktree sampling");
	assert.equal(outcome.task.writerHold, undefined);
}

// ============================================================================
// Ticket 04 — writer evidence admission: a writer cannot launch when the
// evidence base is already unusable; post-launch failure keeps the hold.
// ============================================================================
{
	// Non-Git directory + writer role → structured pre-launch refusal.
	const dir = makeTempDir("planner-only-delegate-nowriter-");
	const { deps, launches } = makeDeps({ gitRunner: NO_GIT });
	const refusal = await expectRefusal(
		runDelegation(deps, makeParams(), dir, { executionId: "call-prelaunch" }),
		"ENVIRONMENT_UNVERIFIABLE",
	);
	assert.match(refusal.message, /not-a-git-repository/);
	assert.match(refusal.message, /No child was launched/);
	assert.equal(launches.length, 0, "launcher never called");
	const task = deps.store.require(refusal.taskId);
	const execution = task.executions.at(-1);
	assert.equal(execution.status, "failed");
	assert.equal(execution.endedReason, "launch_failure");
	assert.equal(execution.terminationConfirmed, true);
	assert.equal(execution.confirmationBasis, "no-launch");
	assert.equal(task.state, "blocked");
	assert.equal(task.recovery?.required, true, "the environment block is recoverable via a recovery decision");
	assert.equal(task.recovery?.consumedBy, undefined, "no recovery was consumed — nothing launched");
	assert.equal(task.writerHold, undefined, "no hold created");
	assert.equal(deps.concurrency.status().reservations.length, 0, "temporary reservation released");
}

{
	// A bound writer Task whose evidence base dies before launch also refuses.
	const dir = initRealRepo();
	const store = new TaskStore();
	const taskId = "T-20260917-904";
	store.create(createTaskSpec({ taskId, objective: "writer on a dying workspace", cwd: dir, role: "worker", validation: { required: false } }));
	store.transition(taskId, "executing");
	const { deps, launches } = makeDeps({ store, gitRunner: NO_GIT });
	const refusal = await expectRefusal(
		runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-prelaunch-bound" }),
		"ENVIRONMENT_UNVERIFIABLE",
	);
	assert.equal(launches.length, 0);
	assert.equal(store.require(taskId).executions.at(-1).status, "failed");
	assert.equal(refusal.taskId, taskId);
}

// ============================================================================
// Ticket 05 — a schema-valid report on a terminal that cannot be admitted is
// kept on the execution record as unacceptedReport, never in Task.reports.
// ============================================================================
{
	const dir = initRealRepo();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
		launch: async (request) => ({
			requestId: request.requestId,
			ownerRunId: request.ownerRunId,
			nodeId: request.nodeId,
			status: "killed",
			error: "envelope exceeded",
			runId: "run-killed",
			agent: "worker",
			result: { kind: "structured", value: makeReport(request.nodeId, "run-killed", request.cwd) },
		}),
	});
	const outcome = await runDelegation(deps, makeParams(), dir, { executionId: "call-killed-report" });
	assert.equal(outcome.termination?.status, "killed");
	assert.equal(outcome.termination?.reportReceived, true);
	assert.equal(outcome.termination?.reportAccepted, false);
	const execution = outcome.task.executions.at(-1);
	assert.ok(execution.unacceptedReport, "the terminal's report is preserved on the execution");
	assert.equal(execution.unacceptedReport.taskId, outcome.task.taskId);
	assert.equal(execution.unacceptedReport.evidence.workerRunId, "run-killed");
	assert.match(execution.unacceptedReportReason, /not admitted/);
	assert.equal(outcome.task.reports.length, 0, "no report revision was created");
	assert.equal(outcome.task.reviews.length, 0, "review never advanced");
}

{
	// Completed terminal + failed quiescence → unacceptedReport (T05) bound to
	// the execution while the writer hold stays.
	const dir = initCommittedRepo();
	let dead = false;
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => dead ? NO_GIT(args, cwd) : realGit(cwd ?? dir, ...args),
		launch: async (request) => {
			const report = makeReport(request.nodeId, "run-unconfirmed", request.cwd);
			report.evidence.finalGitRef = headRef(dir);
			dead = true;
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "completed",
				runId: "run-unconfirmed",
				agent: "worker",
				result: { kind: "structured", value: report },
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams(), dir, { executionId: "call-unconfirmed-report" });
	assert.equal(outcome.termination?.executionStatus, "stop_unconfirmed");
	assert.equal(outcome.termination?.reportReceived, true);
	assert.equal(outcome.termination?.reportAccepted, false);
	assert.equal(outcome.termination?.writerHold, true);
	const execution = outcome.task.executions.at(-1);
	assert.ok(execution.unacceptedReport, "the unconfirmed stop keeps the report as diagnostic evidence");
	assert.match(execution.unacceptedReportReason, /quiescence/);
	assert.equal(outcome.task.reports.length, 0);
	assert.ok(outcome.task.writerHold);
	assert.ok(outcome.task.recovery?.required, "the task is recoverable, not terminal");
}

// ============================================================================
// Ticket 03 — acceptanceMode: creation-time contract, immutable on rebind,
// explorer-only execution, observation acceptance binds the reader report.
// ============================================================================
{
	// observation + non-explorer role is refused at spec creation.
	const dir = initRealRepo();
	const { deps, launches } = makeDeps();
	await assert.rejects(
		runDelegation(deps, makeParams({ role: "worker", acceptanceMode: "observation" }), dir, { executionId: "call-obs-worker" }),
		(error) => {
			assert.equal(error?.code, "TASKSPEC_ACCEPTANCE_MODE_INVALID");
			return true;
		},
	);
	assert.equal(launches.length, 0);
	assert.equal(deps.store.list().length, 0);
}

{
	// The mode persists on the spec; a rebind supplying it is refused.
	const dir = initRealRepo();
	const { deps, launches } = makeDeps({ gitRunner: NO_GIT });
	const first = await runDelegation(
		deps,
		makeParams({ role: "explorer", objective: "read-only survey", acceptanceMode: "observation" }),
		dir,
		{ executionId: "call-obs-mint" },
	);
	assert.equal(first.task.spec.acceptanceMode, "observation");
	const refusal = await expectRefusal(
		runDelegation(deps, makeParams({ taskId: first.task.taskId, role: "explorer", acceptanceMode: "worktree" }), dir, { executionId: "call-obs-mode" }),
		"ACCEPTANCE_MODE_IMMUTABLE",
	);
	assert.match(refusal.message, /creation|fixed/);
	// A non-explorer execution on an observation Task is refused pre-launch.
	const refusal2 = await expectRefusal(
		runDelegation(deps, { ...makeParams({ taskId: first.task.taskId }), role: "worker" }, dir, { executionId: "call-obs-w2" }),
		"OBSERVATION_EXPLORER_ONLY",
	);
	assert.equal(refusal2.taskId, first.task.taskId);
	assert.equal(launches.length, 1, "only the mint launch ran");
}



// ============================================================================
// root-stamped-run-identity Ticket 01 — Worker Report Identity & Root Stamping
// ============================================================================
{
	// 8. Schema snapshot: evidence.properties has no workerRunId, required has no workerRunId,
	// evidence.additionalProperties === undefined, outer additionalProperties === false
	const evidenceSchema = WORKER_REPORT_SCHEMA.properties.evidence;
	assert.equal(evidenceSchema.properties.workerRunId, undefined, "workerRunId removed from evidence properties");
	assert.equal(evidenceSchema.required.includes("workerRunId"), false, "workerRunId removed from evidence required");
	assert.equal(evidenceSchema.additionalProperties, undefined, "evidence does not set additionalProperties");
	assert.equal(WORKER_REPORT_SCHEMA.additionalProperties, false, "outer schema retains additionalProperties: false");

	// 8b. Launcher boundary mirror: using typebox/compile Compile
	const check = Compile(WORKER_REPORT_SCHEMA);
	const validWithoutWorkerRunId = {
		version: 1,
		taskId: "T-20260918-001",
		status: "completed",
		summary: "done",
		changedFiles: [],
		validation: [],
		evidence: { cwd: "/repo", taskId: "T-20260918-001" },
		risks: [],
		unresolved: [],
	};
	assert.equal(check.Check(validWithoutWorkerRunId), true, "report without workerRunId passes launcher Check");

	const reportWithPassthrough = {
		...validWithoutWorkerRunId,
		evidence: { cwd: "/repo", taskId: "T-20260918-001", workerRunId: "planner-scout" },
	};
	assert.equal(check.Check(reportWithPassthrough), true, "report with extra evidence.workerRunId passes launcher Check to reach Root");

	const reportWithTopLevelUnknown = {
		...validWithoutWorkerRunId,
		unknownTopLevelField: true,
	};
	assert.equal(check.Check(reportWithTopLevelUnknown), false, "outer additionalProperties: false rejects unknown top-level keys");
}

{
	// 1. Fake launcher returns report without evidence.workerRunId + runId: "run-A"
	const dir = initCommittedRepo();
	const store = new TaskStore();
	const { deps } = makeDeps({
		store,
		gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
		launch: async (request) => ({
			status: "completed",
			runId: "run-A",
			result: {
				kind: "structured",
				value: {
					version: 1,
					taskId: request.nodeId,
					status: "completed",
					summary: "done without workerRunId",
					changedFiles: [],
					validation: [],
					evidence: { cwd: request.cwd, taskId: request.nodeId, finalGitRef: headRef(dir) },
					risks: [],
					unresolved: [],
				},
			},
		}),
	});
	const outcome = await runDelegation(
		deps,
		makeParams({ role: "worker", objective: "implement something" }),
		dir,
		{ executionId: "call-run-A" },
	);
	assert.equal(outcome.task.reports.length, 1, "report is admitted");
	assert.equal(outcome.task.reports[0].evidence.workerRunId, "run-A", "Root stamps response.runId");
	assert.equal(outcome.task.executions[0].reportIndex, 0);
	assert.equal(outcome.task.executions[0].runId, "run-A");
	assert.equal(outcome.task.state, "reviewing");
}

{
	// 2. Terminal without runId: stamped value === executionId
	const dir = initRealRepo();
	const store = new TaskStore();
	const { deps } = makeDeps({
		store,
		launch: async (request) => ({
			status: "completed",
			result: {
				kind: "structured",
				value: {
					version: 1,
					taskId: request.nodeId,
					status: "completed",
					summary: "done without runId",
					changedFiles: [],
					validation: [],
					evidence: { cwd: request.cwd, taskId: request.nodeId },
					risks: [],
					unresolved: [],
				},
			},
		}),
	});
	const outcome = await runDelegation(
		deps,
		makeParams({ role: "worker", objective: "implement something" }),
		dir,
		{ executionId: "call-no-runid" },
	);
	assert.equal(outcome.task.reports.length, 1);
	assert.equal(outcome.task.reports[0].evidence.workerRunId, "call-no-runid", "stamped with executionId when runId missing");
}

{
	// 3. Passthrough evidence.workerRunId: "planner-scout": admitted; outcome.warnings contains child value; ledger has stamped runId
	const dir = initRealRepo();
	const store = new TaskStore();
	const { deps } = makeDeps({
		store,
		launch: async (request) => ({
			status: "completed",
			runId: "run-scout-override",
			result: {
				kind: "structured",
				value: {
					version: 1,
					taskId: request.nodeId,
					status: "completed",
					summary: "done with child-supplied runId",
					changedFiles: [],
					validation: [],
					evidence: { cwd: request.cwd, taskId: request.nodeId, workerRunId: "planner-scout" },
					risks: [],
					unresolved: [],
				},
			},
		}),
	});
	const outcome = await runDelegation(
		deps,
		makeParams({ role: "worker", objective: "test passthrough" }),
		dir,
		{ executionId: "call-passthrough" },
	);
	assert.equal(outcome.task.reports.length, 1, "report is admitted despite child-supplied workerRunId");
	assert.equal(outcome.task.reports[0].evidence.workerRunId, "run-scout-override", "ledger has stamped runId, not child-supplied");
	assert.ok(
		outcome.warnings.some((w) => w.includes("planner-scout")),
		"warnings disclose child-supplied value",
	);
}

{
	// 4. taskId mismatch: reports.length === 0, unacceptedReport has stamped runId, unacceptedReportReason mentions task, not execution
	const dir = initRealRepo();
	const store = new TaskStore();
	const { deps } = makeDeps({
		store,
		launch: async (request) => ({
			status: "completed",
			runId: "run-mismatch-task",
			result: {
				kind: "structured",
				value: {
					version: 1,
					taskId: "T-99999999-999",
					status: "completed",
					summary: "wrong task",
					changedFiles: [],
					validation: [],
					evidence: { cwd: request.cwd, taskId: "T-99999999-999" },
					risks: [],
					unresolved: [],
				},
			},
		}),
	});
	const outcome = await runDelegation(
		deps,
		makeParams({ role: "worker", objective: "test taskId mismatch" }),
		dir,
		{ executionId: "call-task-mismatch" },
	);
	assert.equal(outcome.task.reports.length, 0);
	const exec = outcome.task.executions[0];
	assert.ok(exec.unacceptedReport);
	assert.equal(exec.unacceptedReport.evidence.workerRunId, "run-mismatch-task", "unacceptedReport is stamped with runId");
	assert.match(exec.unacceptedReportReason, /does not match this Task/);
	assert.equal(exec.unacceptedReportReason.includes("execution"), false, "reason does not mention execution");
}

{
	// 5. Correction round: round 1 runId: "run-A" -> request_changes -> redelegate round 2 runId: "run-B"
	const dir = initRealRepo();
	const store = new TaskStore();
	let currentRunId = "run-A";
	const { deps } = makeDeps({
		store,
		launch: async (request) => ({
			status: "completed",
			runId: currentRunId,
			result: {
				kind: "structured",
				value: {
					version: 1,
					taskId: request.nodeId,
					status: "completed",
					summary: `round ${currentRunId}`,
					changedFiles: [],
					validation: [],
					evidence: { cwd: request.cwd, taskId: request.nodeId },
					risks: [],
					unresolved: [],
				},
			},
		}),
	});
	const round1 = await runDelegation(
		deps,
		makeParams({ role: "worker", objective: "two rounds" }),
		dir,
		{ executionId: "call-r1" },
	);
	assert.equal(round1.task.reports.length, 1);
	assert.equal(round1.task.reports[0].evidence.workerRunId, "run-A");

	// Trigger correction round: set state to changes_requested
	store.transition(round1.task.taskId, "changes_requested");
	currentRunId = "run-B";

	const round2 = await runDelegation(
		deps,
		makeParams({ taskId: round1.task.taskId, role: "worker", objective: "two rounds" }),
		dir,
		{ executionId: "call-r2" },
	);
	assert.equal(round2.task.reports.length, 2);
	assert.deepEqual(round2.task.reports.map((r) => r.evidence.workerRunId), ["run-A", "run-B"]);
}

{
	// 6. Validator role: validatorReports[0].evidence.workerRunId === runId
	const dir = initRealRepo();
	const store = new TaskStore();
	const { deps } = makeDeps({
		store,
		launch: async (request) => ({
			status: "completed",
			runId: "run-validator",
			result: {
				kind: "structured",
				value: {
					version: 1,
					taskId: request.nodeId,
					status: "completed",
					summary: "validated",
					changedFiles: [],
					validation: [],
					evidence: { cwd: request.cwd, taskId: request.nodeId },
					risks: [],
					unresolved: [],
				},
			},
		}),
	});
	const outcome = await runDelegation(
		deps,
		makeParams({ role: "validator", objective: "validate work" }),
		dir,
		{ executionId: "call-validator" },
	);
	assert.equal(outcome.task.validatorReports.length, 1);
	assert.equal(outcome.task.validatorReports[0].evidence.workerRunId, "run-validator");
}

console.log("delegate.test.mjs: all cases passed");
