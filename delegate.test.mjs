import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import {
	registerPluginRuntimeAgent,
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
	SUBAGENT_DELEGATION_FOLLOWUP_ACK_EVENT,
	SUBAGENT_DELEGATION_FOLLOWUP_EVENT,
	SUBAGENT_DELEGATION_REQUEST_EVENT,
	SUBAGENT_DELEGATION_RESPONSE_EVENT,
	SUBAGENT_DELEGATION_STARTED_EVENT,
	SUBAGENT_DELEGATION_UPDATE_EVENT,
} from "./subagent-delegation-contract.ts";
import { FINDING_CATEGORIES, FINDING_SEVERITIES, REVIEW_VERDICTS, advanceReview } from "./review.ts";
import { ConcurrencyController } from "./concurrency.ts";
import { LedgerSnapshotStore } from "./ledger-store.ts";
import { TaskStore, createTaskSpec } from "./task.ts";
import { PlannerOrchestrator } from "./orchestrate.ts";
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
		...(overrides.reportOnlyAgent ? { reportOnlyAgent: overrides.reportOnlyAgent } : {}),
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
	assert.equal(packet.budgetDisclosure.maxTokens, 100_000);
	assert.equal(packet.budgetDisclosure.maxWallMs, 600_000);
	assert.match(packet.budgetDisclosure.accounting, /input\+output.*cache read tokens are excluded/i);
	assert.match(packet.budgetDisclosure.closingReserveGuidance, /10%.*verification.*final report/i);
	// The schema survives a JSON round-trip unchanged (plain data).
	assert.deepEqual(JSON.parse(JSON.stringify(request.result.schema)), request.result.schema);
}

// ---------------------------------------------------------------------------
// Re-delegating an existing Task: stored spec is verbatim and is what the
// child packet carries; legacy definition fields on the call are ignored (P1-A).
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
	assert.equal(packet.spec.objective, "original objective", "packet carries the stored spec, not this call's objective");
	assert.deepEqual(packet.spec, original, "packet spec is the stored spec verbatim");
	assert.match(outcome.warnings.join("\n"), /ignored legacy TaskSpec field\(s\).*objective/);
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

	// Historical ledger holds retain isolation but do not exhaust a new
	// session's execution capacity in an unrelated workspace.
	{
		const ledgerRoot = makeTempDir("planner-only-restored-holds-");
		const snapshots = new LedgerSnapshotStore(ledgerRoot);
		for (let i = 1; i <= 4; i++) {
			const seed = new TaskStore();
			const held = seed.create(createTaskSpec({ objective: "historical hold", cwd: `/historical/${i}`, role: "worker", validation: { required: false } }, `T-20260918-h${i}`));
			held.state = "blocked";
			held.writerHold = { executionId: `call-old-${i}`, reason: "stop unconfirmed", since: "2026-09-18T00:00:00.000Z" };
			snapshots.writeOrThrow(held);
		}
		const concurrency = new ConcurrencyController();
		const orch = new PlannerOrchestrator({ ledgerDir: ledgerRoot, concurrency, gitRunner: fakeCleanGit() });
		assert.equal(orch.restoreFromLedger().restored, 4);
		const { deps, launches } = makeDeps({ store: orch.store, concurrency });
		const taskCount = orch.store.list().length;
		await expectRefusal(runDelegation(deps, makeParams(), "/historical/1", { executionId: "call-held-workspace" }), "WORKSPACE_CONFLICT");
		assert.equal(launches.length, 0, "restored workspace isolation refuses before launch");
		assert.equal(orch.store.list().length, taskCount, "workspace refusal mints no Task");
		const outcome = await runDelegation(deps, makeParams(), dir, { executionId: "call-new-session" });
		assert.equal(launches.length, 1);
		assert.equal(outcome.report?.taskId, outcome.task.taskId, "unrelated execution returns an accepted report");
		assert.equal(outcome.task.executions.at(-1).terminationConfirmed, true);
		assert.equal(concurrency.status().occupied, 0, "completed execution releases only the new live reservation");
		assert.equal(concurrency.status().isolationHolds, 4, "all historical holds remain registered");
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

		// 2. Legacy definition fields on redelegate are ignored; the stored spec is authoritative.
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
		assert.deepEqual(reChildPacket.spec.validation.commands, initialCommands, "redelegate uses stored commands");
		assert.match(reOutcome.warnings.join("\n"), /ignored legacy TaskSpec field\(s\).*validation/);
		// Stored original TaskSpec is not rewritten (ticket 53/incident spec)
		const storedTask = store.require(outcome.task.taskId);
		assert.deepEqual(storedTask.spec?.validation.commands, initialCommands, "stored TaskSpec is never rewritten on redelegate");

		// 3. Even a forged incomplete replacement cannot weaken the stored validation contract.
		await runDelegation(
				deps,
				makeParams({
					taskId: outcome.task.taskId,
					validation: { required: true },
				}),
				dir,
				{ executionId: "call-redelegate-missing" },
			);
		assert.equal(launches.length, 3);
		assert.deepEqual(JSON.parse(launches[2].task).spec.validation.commands, initialCommands);
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
		["worker", "explorer"],
		"validator and reviewer invocations only exist over an existing Task",
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
	assert.deepEqual(Object.keys(rebind.properties).sort(), ["envelope", "instructions", "recovery", "role", "taskId"]);
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
	const worker = await runDelegation(deps, makeParams(), dir, { executionId: "call-before-v" });
	const outcome = await runDelegation(
		deps,
		{ taskId: worker.task.taskId, role: "validator" },
		dir,
		{ executionId: "call-v", toolName: "planner_redelegate" },
	);
	assert.equal(launches[1].agent, "oracle", "validator -> oracle");
	assert.equal(outcome.task.executions.at(-1).auxiliary, true, "validator execution is auxiliary");
	assert.equal(outcome.task.validatorReports.length, 1, "validator report recorded");
	assert.equal(outcome.task.reports.length, 1, "validator does not replace or append a worker report");
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
// over it is refused, request_changes still records. P1-A runs the worker from
// the stored spec too, so the extra root must be a readable worktree at launch
// (a missing root is refused pre-launch as ENVIRONMENT_UNVERIFIABLE) and goes
// missing only before the reviewer samples it.
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	const missing = initCommittedRepo();
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
	assert.equal(launches.length, 1, "worker launched while every declared root was sampleable");
	rmSync(missing, { recursive: true, force: true });

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
const UPSTREAM_DELEGATION_TS = process.env.PI_PLANNER_ONLY_UPSTREAM_DELEGATION_TS ?? join(
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
// D1: the contract copy matches the installed pi-subagents source — all
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
		const interfaceShape = (text, name) => {
			const block = text.match(new RegExp(`export interface ${name} extends SubagentDelegationStarted \\{([\\s\\S]*?)\\n\\}`));
			assert.ok(block, `${name} declaration not found`);
			return [...block[1].matchAll(/(\w+)(\?)?:\s*([^;]+);/g)].map((match) => ({ name: match[1], optional: match[2] === "?", type: match[3].replace(/\s+/g, " ").trim() }));
		};
		assert.deepEqual(interfaceShape(local, "SubagentDelegationFollowUp"), interfaceShape(upstream, "SubagentDelegationFollowUp"), "follow-up fields diverge from upstream");
		assert.deepEqual(interfaceShape(local, "SubagentDelegationFollowUpAck"), interfaceShape(upstream, "SubagentDelegationFollowUpAck"), "follow-up ACK fields or statuses diverge from upstream");
		const requestFields = (text) => {
			const block = text.match(/export interface SubagentDelegationRequest \{([\s\S]*?)\n\}/);
			assert.ok(block, "SubagentDelegationRequest declaration not found");
			return [...block[1].matchAll(/^\s*(\w+)(\?)?:\s*([^;]+);/gm)].map((match) => ({
				name: match[1], optional: match[2] === "?",
				type: match[1] === "intercomBridge" ? "host-opaque" : match[3].replace(/\s+/g, " ").trim(),
			}));
		};
		assert.deepEqual(requestFields(local), requestFields(upstream), "request fields diverge from upstream");
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
	const observations = [];
	const starts = [];
	const promise = launcher(launcherRequest(), undefined, {
		onRequest: (request) => observations.push(request.requestId),
		onStarted: (started) => starts.push(started.requestId),
		onUpdate: (update) => updates.push(update),
	});
	const request = bus.emitted.find((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT).payload;
	const triple = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
	assert.deepEqual(observations, [request.requestId], "REQUEST boundary is observed once");
	bus.emit(SUBAGENT_DELEGATION_STARTED_EVENT, { ...triple, requestId: "req-other" });
	bus.emit(SUBAGENT_DELEGATION_STARTED_EVENT, triple);
	assert.deepEqual(starts, [request.requestId], "only identity-matched STARTED reaches hooks");
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

// Follow-up control subscribes before emit, requires the full attempt identity
// plus messageId, and distinguishes acknowledgement from mere emission.
{
	const bus = tinyEmitter();
	const launcher = createHostLauncher({ events: bus }, { followUpAckWaitMs: 15 });
	let control;
	const promise = launcher(launcherRequest({ requestId: "req-followup" }), undefined, {
		onControl: (value) => { control = value; },
	});
	bus.on(SUBAGENT_DELEGATION_FOLLOWUP_EVENT, (payload) => {
		bus.emit(SUBAGENT_DELEGATION_FOLLOWUP_ACK_EVENT, null);
		bus.emit(SUBAGENT_DELEGATION_FOLLOWUP_ACK_EVENT, { ...payload, status: "bogus" });
		bus.emit(SUBAGENT_DELEGATION_FOLLOWUP_ACK_EVENT, { ...payload, status: "failed", reason: { malformed: true } });
		bus.emit(SUBAGENT_DELEGATION_FOLLOWUP_ACK_EVENT, { ...payload, ownerRunId: "wrong", status: "queued" });
		bus.emit(SUBAGENT_DELEGATION_FOLLOWUP_ACK_EVENT, { ...payload, messageId: "wrong", status: "queued" });
		bus.emit(SUBAGENT_DELEGATION_FOLLOWUP_ACK_EVENT, {
			requestId: payload.requestId, ownerRunId: payload.ownerRunId, nodeId: payload.nodeId,
			messageId: payload.messageId, status: "queued",
		});
	});
	const ack = await control.followUp("close out now");
	assert.deepEqual(ack, { status: "queued" }, "a synchronous exact ACK is observed without a race");
	const sent = bus.emitted.find((entry) => entry.event === SUBAGENT_DELEGATION_FOLLOWUP_EVENT).payload;
	assert.equal(sent.text, "close out now");
	assert.ok(sent.messageId);
	bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: "req-followup", ownerRunId: "owner-1", nodeId: "T-20260915-500", status: "completed",
	});
	await promise;
}

{
	const bus = tinyEmitter();
	const launcher = createHostLauncher({ events: bus }, { followUpAckWaitMs: 5 });
	let control;
	const promise = launcher(launcherRequest({ requestId: "req-no-ack" }), undefined, { onControl: (value) => { control = value; } });
	assert.match((await control.followUp("finish")).reason, /no matching acknowledgement/);
	const pending = control.followUp("finish again");
	bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: "req-no-ack", ownerRunId: "owner-1", nodeId: "T-20260915-500", status: "completed",
	});
	assert.deepEqual(await pending, { status: "gone", reason: "delegation attempt ended before acknowledgement" });
	await promise;
	assert.equal((await control.followUp("too late")).status, "gone");
}

for (const status of ["unavailable", "failed"]) {
	const bus = tinyEmitter();
	const launcher = createHostLauncher({ events: bus }, { followUpAckWaitMs: 15 });
	let control;
	const promise = launcher(launcherRequest({ requestId: `req-${status}` }), undefined, { onControl: (value) => { control = value; } });
	bus.on(SUBAGENT_DELEGATION_FOLLOWUP_EVENT, (payload) => bus.emit(SUBAGENT_DELEGATION_FOLLOWUP_ACK_EVENT, {
		requestId: payload.requestId, ownerRunId: payload.ownerRunId, nodeId: payload.nodeId,
		messageId: payload.messageId, status, reason: `${status} reason`,
	}));
	assert.deepEqual(await control.followUp("finish"), { status, reason: `${status} reason` });
	bus.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: `req-${status}`, ownerRunId: "owner-1", nodeId: "T-20260915-500", status: "completed",
	});
	await promise;
}

// Issue 07 step one — persisted execution timing begins at REQUEST outbound,
// observes STARTED locally, and derives duration from the monotonic clock even
// if the wall clock rolls backward. Pre-launch evidence capture is excluded.
{
	let wall = 10_000;
	let wallDate = new Date("2026-09-20T10:00:00.000Z");
	const { deps } = makeDeps({
		launch: async (request, _signal, hooks) => {
			hooks.onRequest(request);
			wall += 25;
			wallDate = new Date("2026-09-20T09:59:00.000Z");
			hooks.onStarted({ requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId });
			wall += 75;
			return {
				requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
				status: "completed", runId: "run-timing", agent: "worker",
				result: { kind: "structured", value: makeReport(request.nodeId, "run-timing", request.cwd) },
			};
		},
	});
	deps.now = () => wallDate;
	deps.wallClock = { now: () => wall, setTimeout, clearTimeout };
	const outcome = await runDelegation(deps, makeParams(), process.cwd(), {
		executionId: "call-timing",
		requestId: "request-original",
	});
	const execution = outcome.task.executions[0];
	assert.equal(execution.requestId, "request-original");
	assert.equal(execution.launchedAt, "2026-09-20T10:00:00.000Z");
	assert.equal(execution.startedAt, "2026-09-20T09:59:00.000Z", "STARTED stores local receipt time without wall-clock inference");
	assert.equal(execution.durationMs, 100, "duration uses monotonic REQUEST-to-finalization elapsed time");
	assert.equal(execution.durationBasis, "request-outbound-to-finalization");
	assert.equal(execution.endedAt, "2026-09-20T09:59:00.000Z", "endedAt retains wall timestamp semantics independently of duration");
}

{
	let wall = 0;
	const { deps } = makeDeps({
		launch: async (request, _signal, hooks) => {
			hooks.onRequest(request);
			wall = 7;
			return {
				requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
				status: "completed", runId: "run-no-started", agent: "worker",
				result: { kind: "structured", value: makeReport(request.nodeId, "run-no-started", request.cwd) },
			};
		},
	});
	deps.wallClock = { now: () => wall, setTimeout, clearTimeout };
	const outcome = await runDelegation(deps, makeParams(), process.cwd(), { executionId: "call-no-started" });
	assert.equal(outcome.task.executions[0].startedAt, null, "missing STARTED remains explicitly unknown");
	assert.equal(outcome.task.executions[0].durationMs, 7);
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
	const requestAbort = new AbortController();
	let followUpsAfterCancel = 0;
	const { deps } = makeDeps({
		store,
		concurrency,
		usage,
		gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
		launch: async (request, _signal, hooks) => {
			hooks.onRequest(request);
			hooks.onControl({ followUp: async () => { followUpsAfterCancel += 1; return { status: "queued" }; } });
			requestAbort.abort();
			hooks.onUpdate({ requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, tokens: 80_000 });
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "cancelled",
				error: "operator cancel",
				runId: "run-c",
				agent: "worker",
				model: "test/model",
				usage: { input: 5, output: 6, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1, toolCalls: 1, durationMs: 40 },
			};
		},
	});
	const outcome = await runDelegation(deps, makeParams({ taskId }), dir, {
		executionId: "call-ca",
		signal: requestAbort.signal,
		requestId: "request-cancelled",
		requestClosure: () => ({
			requestId: "request-cancelled",
			requestClosed: "active-time-limit",
			requestClosedAt: "2026-09-20T10:15:00.000Z",
		}),
	});
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
	assert.equal(execution.requestId, "request-cancelled");
	assert.equal(execution.requestClosed, "active-time-limit");
	assert.equal(execution.requestClosedAt, "2026-09-20T10:15:00.000Z");
	assert.equal(execution.usageComplete, true);
	assert.equal(execution.softTokenWarning, undefined, "an UPDATE after operator cancellation cannot inject a warning");
	assert.equal(followUpsAfterCancel, 0);
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
	let wall = 0;
	let closure = { requestId: "request-old", requestClosed: "active-time-limit", requestClosedAt: "2026-09-20T10:15:00.000Z" };
	const requestAbort = new AbortController();
	const { deps } = makeDeps({
		store,
		concurrency,
		usage,
		gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args),
		launch: async (request, _signal, hooks) => {
			capturedHooks = hooks;
			hooks.onRequest(request);
			wall = 10;
			requestAbort.abort();
			throw new DelegationAborted(taskId);
		},
	});
	deps.wallClock = { now: () => wall, setTimeout, clearTimeout };
	const outcome = await runDelegation(deps, makeParams({ taskId }), dir, {
		executionId: "call-cb",
		signal: requestAbort.signal,
		requestId: "request-old",
		requestClosure: () => closure,
	});
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
	assert.equal(record.executions[0].endedAt, undefined, "grace expiry without a terminal has no execution endpoint");
	assert.equal(record.executions[0].durationMs, undefined, "grace expiry does not turn waiter return into execution duration");
	// Admission: the held workspace refuses a second writer even for the same
	// Task — lift the terminal state so the WRITER_HOLD guard is what fires.
	record.state = "changes_requested";
	const second = await runDelegation(deps, makeParams({ taskId }), dir, { executionId: "call-cb2" })
		.then(() => undefined, (e) => e);
	assert.ok(second instanceof DelegationRefused && second.code === "WRITER_HOLD", `writer hold refuses a second writer, got ${second}`);
	record.state = "blocked"; // restore the parked state before the late-terminal part
	// A3 — the late terminal finalizes the execution exactly once.
	closure = { requestId: "request-new", requestClosed: "operator-resume", requestClosedAt: "2026-09-20T10:16:00.000Z" };
	wall = 100;
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
	assert.equal(execAfter.durationMs, 100, "late terminal retains the original REQUEST monotonic anchor");
	assert.equal(execAfter.requestId, "request-old");
	assert.equal(execAfter.requestClosed, "active-time-limit", "late terminal retains the original Request closure after re-entry");
	assert.ok(execAfter.cTerminal?.gitStatusHash, "C_terminal recorded from the late terminal");
	assert.equal(execAfter.runId, "run-late");
	assert.equal(execAfter.usageComplete, true);
	assert.equal(execAfter.rawTerminal?.status, "cancelled", "late public terminal is retained on the execution");
	assert.equal(execAfter.rawTerminal?.runId, "run-late");
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
	await expectRefusal(runDelegation(deps, makeParams({ envelope: { maxTokens: 100, softTokensShare: 0 } }), dir, { executionId: "e-inv5" }), "ENVELOPE_INVALID");
	await expectRefusal(runDelegation(deps, makeParams({ envelope: { maxTokens: 100, softTokensShare: 1 } }), dir, { executionId: "e-inv6" }), "ENVELOPE_INVALID");
	await expectRefusal(runDelegation(deps, makeParams({ envelope: { maxWallMs: 100, softTokensShare: 0.5 } }), dir, { executionId: "e-inv7" }), "ENVELOPE_INVALID");
	assert.equal(launches.length, 0, "invalid envelope never reaches the launcher");
}

// The default 70% warning is attempted once on a strictly identity-matched
// soft crossing, without aborting or changing the hard envelope.
{
	const dir = initRealRepo();
	const messages = [];
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal, hooks) => {
			hooks.onControl({ followUp: async (text) => { messages.push(text); return { status: "queued" }; } });
			const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
			hooks.onUpdate({ ...base, tokens: 70_000 });
			hooks.onUpdate({ requestId: request.requestId, tokens: 95_000 }); // permissive telemetry, never control
			hooks.onUpdate({ ...base, tokens: 80_000 });
			hooks.onUpdate({ ...base, tokens: 90_000 });
			assert.equal(signal.aborted, false);
			await Promise.resolve();
			return { ...base, status: "completed", runId: "run-soft", agent: "worker",
				result: { kind: "structured", value: makeReport(request.nodeId, "run-soft", request.cwd) } };
		},
	});
	const outcome = await runDelegation(deps, makeParams(), dir, { executionId: "call-soft" });
	assert.equal(messages.length, 1, "one execution sends at most one warning");
	assert.match(messages[0], /Runtime budget control/);
	assert.match(messages[0], /Cumulative input\+output usage is 80000\/100000 tokens \(cache read excluded\)/);
	assert.match(messages[0], /Stop expanding scope/);
	assert.match(messages[0], /structured WorkerReport/);
	assert.match(messages[0], /no budget extension or grace/);
	assert.deepEqual(outcome.task.executions[0].softTokenWarning, {
		observed: 80_000, limit: 100_000, threshold: 70_000,
		attemptedAt: outcome.task.executions[0].softTokenWarning.attemptedAt,
		status: "queued", completedAt: outcome.task.executions[0].softTokenWarning.completedAt,
	});
	assert.match(renderDelegationOutcome(outcome), /soft token warning: queued observed=80000 threshold=70000 limit=100000/);
}

// A custom threshold is durable even when the launcher has no control sink.
{
	const dir = initRealRepo();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal, hooks) => {
			const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
			hooks.onUpdate({ ...base, tokens: 51 });
			assert.equal(signal.aborted, false);
			return { ...base, status: "completed", runId: "run-soft-unavailable", agent: "worker",
				result: { kind: "structured", value: makeReport(request.nodeId, "run-soft-unavailable", request.cwd) } };
		},
	});
	const outcome = await runDelegation(deps, makeParams({ envelope: { maxTokens: 100, softTokensShare: 0.5 } }), dir, { executionId: "call-soft-unavailable" });
	assert.equal(outcome.task.executions[0].softTokenWarning.status, "unavailable");
	assert.equal(outcome.task.executions[0].softTokenWarning.threshold, 50);
	assert.match(outcome.task.executions[0].softTokenWarning.reason, /did not expose live child control/);
}

for (const controlFailure of ["throw", "reject"]) {
	const dir = initRealRepo();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal, hooks) => {
			hooks.onControl({ followUp: () => {
				if (controlFailure === "throw") throw new Error("synchronous control failure");
				return Promise.reject(new Error("asynchronous control failure"));
			} });
			const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
			hooks.onUpdate({ ...base, tokens: 80 });
			await Promise.resolve();
			await Promise.resolve();
			hooks.onUpdate({ ...base, tokens: 101 });
			assert.equal(signal.aborted, true, `${controlFailure}: hard breach remains immediate`);
			return { ...base, status: "cancelled", runId: `run-control-${controlFailure}`, agent: "worker" };
		},
	});
	const outcome = await runDelegation(deps, makeParams({ envelope: { maxTokens: 100 } }), dir, { executionId: `call-control-${controlFailure}` });
	assert.equal(outcome.termination.reason, "worker_runaway");
	assert.equal(outcome.termination.anomaly.observed, 101);
	assert.equal(outcome.task.executions[0].softTokenWarning.status, "failed");
	assert.match(outcome.task.executions[0].softTokenWarning.reason, /control failure/);
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
	assert.equal(exec.softTokenWarning, undefined, "a direct hard-limit jump cancels immediately without creating grace");
	assert.equal(record.recovery.required, true, "runaway flags needs_replan");
	assert.equal(record.recovery.executionId, "call-r1");
	assert.match(record.recovery.reason, /tokens 7000 exceeded envelope 5000/);
	const rendered = renderDelegationOutcome(outcome);
	assert.match(rendered, /TOKEN_ENVELOPE_EXCEEDED: observed=7000\/limit=5000 \(cumulative input\+output snapshot, no cache read\)/);
	assert.match(rendered, /single-turn token delta: 4000 tokens \(aggregate input\+output snapshot delta; no cache read accounting\)/);
	assert.match(rendered, /anomaly: tokens observed=7000 limit=5000 \(source: delegation-param\)/, "the existing anomaly line remains byte-compatible");
}

// A gradual breach keeps the token heading but does not borrow a large delta
// from another execution; non-token anomalies retain their existing display.
{
	const dir = initRealRepo();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal, hooks) => {
			const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
			for (let tokens = 500; tokens <= 5_500; tokens += 500) hooks.onUpdate({ ...base, tokens });
			assert.equal(signal.aborted, true);
			return { ...base, status: "cancelled", runId: "run-gradual", agent: "worker" };
		},
	});
	const outcome = await runDelegation(deps, makeParams({ envelope: { maxTokens: 5_000 } }), dir, { executionId: "call-gradual" });
	const currentExecution = outcome.task.executions.find((execution) => execution.executionId === outcome.executionId);
	const staleExecution = {
		...currentExecution,
		executionId: "stale-token-spike",
		traceSummary: { ...currentExecution.traceSummary, maxTokenDelta: 9_999 },
	};
	const rendered = renderDelegationOutcome({
		...outcome,
		task: { ...outcome.task, executions: [staleExecution, ...outcome.task.executions] },
	});
	assert.match(rendered, /TOKEN_ENVELOPE_EXCEEDED: observed=5500\/limit=5000/);
	assert.doesNotMatch(rendered, /single-turn token delta:/, "a gradual current execution ignores the stale execution's spike");

	for (const signal of ["wall", "preparation"]) {
		const nonToken = renderDelegationOutcome({
			...outcome,
			termination: { ...outcome.termination, anomaly: { signal, observed: 6_000, limit: 5_000, source: "delegation-param" } },
		});
		assert.doesNotMatch(nonToken, /TOKEN_ENVELOPE_EXCEEDED|single-turn token delta:/);
		assert.match(nonToken, new RegExp(`anomaly: ${signal} observed=6000 limit=5000 \\(source: delegation-param\\)`));
	}
}

// ---------------------------------------------------------------------------
// P1-A — omitted envelope uses finite defaults and persists its provenance.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal, hooks) => {
			const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
			hooks.onUpdate({ ...base, tokens: 99_999 });
			assert.equal(signal.aborted, false, "default token envelope is not yet exceeded");
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
	assert.deepEqual(outcome.task.executions[0].envelope, { maxTokens: 100_000, maxWallMs: 600_000, source: "default" });
}

// Report-only correction uses its independent tool budget and omits the
// worker execution envelope disclosure from the child packet.
{
	const dir = initRealRepo();
	const requests = [];
	let launchNo = 0;
	let reportOnlyFollowUps = 0;
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		reportOnlyAgent: "planner-report-only",
		launch: async (request, _signal, hooks) => {
			requests.push(request);
			launchNo += 1;
			const runId = `run-report-only-${launchNo}`;
			if (launchNo === 2) {
				hooks.onControl({ followUp: async () => { reportOnlyFollowUps += 1; return { status: "queued" }; } });
				hooks.onUpdate({ requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, tokens: 80_000 });
			}
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "completed",
				runId,
				agent: launchNo === 1 ? "worker" : "planner-report-only",
				result: { kind: "structured", value: makeReport(launchNo === 1 ? "T-99999999-999" : request.nodeId, runId, request.cwd) },
			};
		},
	});
	const malformed = await runDelegation(deps, makeParams(), dir, { executionId: "report-only-origin" });
	assert.equal(malformed.decision.action, "report_correction");
	const repaired = await runDelegation(deps, makeParams({ taskId: malformed.task.taskId }), dir, { executionId: "report-only-repair" });
	assert.equal(requests[1].agent, "planner-report-only");
	assert.deepEqual(requests[1].toolBudget, { hard: 1, block: "*" });
	assert.equal(JSON.parse(requests[1].task).budgetDisclosure, undefined);
	assert.equal(reportOnlyFollowUps, 0, "report-only executions never receive token close-out reminders");
	assert.equal(repaired.task.executions.at(-1).softTokenWarning, undefined);
}

// ---------------------------------------------------------------------------
// ADR-0010 — ordinary executions use the fresh original-Request remainder.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const request = (remainingMs) => ({
		requestId: "request-clamp",
		requestDeadline: "2026-09-20T00:15:00.000Z",
		remainingMs,
		observedAt: "2026-09-20T00:10:00.000Z",
	});

	const unchanged = makeDeps({ gitRunner: async (args, cwd) => realGit(dir, ...args) });
	const unchangedOutcome = await runDelegation(
		unchanged.deps,
		makeParams({ envelope: { maxTokens: 11, maxWallMs: 100_000 } }),
		dir,
		{ executionId: "clamp-unchanged", requestId: "request-clamp", requestObservation: () => request(300_000) },
	);
	assert.deepEqual(unchangedOutcome.task.executions[0].envelope, { maxTokens: 11, maxWallMs: 100_000, source: "delegation-param" });
	assert.deepEqual(unchangedOutcome.task.executions[0].originalEnvelope, unchangedOutcome.task.executions[0].envelope);
	assert.equal(unchangedOutcome.task.executions[0].envelopeClamped, false);

	const clamped = makeDeps({ gitRunner: async (args, cwd) => realGit(dir, ...args) });
	const clampedTimerDelays = [];
	clamped.deps.wallClock = {
		now: () => 0,
		setTimeout(_fn, ms) { clampedTimerDelays.push(ms); return { ms }; },
		clearTimeout() {},
	};
	const clampedOutcome = await runDelegation(
		clamped.deps,
		makeParams({ envelope: { maxTokens: 7 } }),
		dir,
		{ executionId: "clamp-token-only", requestId: "request-clamp", requestObservation: () => request(90_000) },
	);
	const clampedExecution = clampedOutcome.task.executions[0];
	assert.deepEqual(clampedExecution.originalEnvelope, { maxTokens: 7, source: "delegation-param" });
	assert.deepEqual(clampedExecution.envelope, { maxTokens: 7, maxWallMs: 30_000, source: "delegation-param" });
	assert.equal(clampedExecution.envelopeClamped, true);
	assert.equal(clampedExecution.requestBudget.reserveMs, 60_000);
	assert.match(clampedOutcome.warnings.join("\n"), /clamped to 30000ms/);
	assert.deepEqual(clampedTimerDelays, [30_000], "wall timer uses the effective Request-clamped bound");
	const clampedDisclosure = JSON.parse(clamped.launches[0].task).budgetDisclosure;
	assert.equal(clampedDisclosure.maxTokens, 7);
	assert.equal(clampedDisclosure.maxWallMs, 30_000, "packet discloses the final Request-clamped wall envelope");

	let delayedRemaining = 90_000;
	const delayedGit = async (args, cwd) => {
		const result = await fakeCleanGit()(args, cwd);
		if (args.join(" ") === "status --porcelain=v2 --branch") delayedRemaining = 60_000;
		return result;
	};
	const refused = makeDeps({ gitRunner: delayedGit });
	const refusal = await expectRefusal(runDelegation(
		refused.deps,
		makeParams(),
		dir,
		{ executionId: "clamp-refused", requestId: "request-clamp", requestObservation: () => request(delayedRemaining) },
	), "REQUEST_REMAINING_INSUFFICIENT");
	const refusedTask = refused.deps.store.require(refusal.taskId);
	assert.equal(refused.launches.length, 0, "post-sample budget refusal emits no REQUEST");
	assert.equal(refusedTask.state, "planning", "refusal preserves the pre-admission Task state");
	assert.equal(refusedTask.executions.length, 0, "refusal is not a child execution");
	assert.equal(refusedTask.launchRefusals.length, 1);
	assert.equal(refusedTask.launchRefusals[0].requestBudget.availableMs, 0);
	assert.equal(refused.deps.concurrency.status().reservations.length, 0, "temporary writer reservation is released");
	assert.deepEqual(refusal.details.launchRefusal, refusedTask.launchRefusals[0]);
	const unknown = makeDeps({ gitRunner: async (args, cwd) => realGit(dir, ...args) });
	const unknownRefusal = await expectRefusal(runDelegation(
		unknown.deps,
		makeParams(),
		dir,
		{ executionId: "clamp-unknown", requestId: "request-clamp", requestObservation: () => ({
			requestId: "request-clamp", requestDeadline: null, remainingMs: null,
			observedAt: "2026-09-20T00:10:00.000Z", unavailableReason: "request-not-started",
		}) },
	), "REQUEST_REMAINING_INSUFFICIENT");
	assert.equal(unknownRefusal.details.launchRefusal.requestBudget.availableMs, null);
	assert.equal(unknown.launches.length, 0);

	const reportOnly = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		reportOnlyAgent: "planner-report-only",
		launch: async (outbound) => ({
			requestId: outbound.requestId,
			ownerRunId: outbound.ownerRunId,
			nodeId: outbound.nodeId,
			status: "completed",
			runId: "run-malformed",
			agent: "worker",
		}),
	});
	const malformed = await runDelegation(reportOnly.deps, makeParams(), dir, { executionId: "clamp-malformed" });
	const reportTask = reportOnly.deps.store.require(malformed.task.taskId);
	assert.equal(reportTask.reportCorrections, 1);
	const reportsBefore = reportTask.executions.length;
	const reportRefusal = await expectRefusal(runDelegation(
		reportOnly.deps,
		makeParams({ taskId: reportTask.taskId }),
		dir,
		{ executionId: "clamp-report-only", requestId: "request-clamp", requestObservation: () => request(60_000) },
	), "REQUEST_REMAINING_INSUFFICIENT");
	assert.equal(reportOnly.deps.store.require(reportTask.taskId).executions.length, reportsBefore, "refused report correction consumes no execution grant");
	assert.equal(reportOnly.deps.store.require(reportTask.taskId).reportCorrections, 1, "the durable correction remains pending");
	assert.equal(reportRefusal.details.launchRefusal.reportOnly, true);

	const recovery = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (outbound, _signal, hooks) => {
			hooks.onUpdate({ requestId: outbound.requestId, ownerRunId: outbound.ownerRunId, nodeId: outbound.nodeId, tokens: 2 });
			return { requestId: outbound.requestId, ownerRunId: outbound.ownerRunId, nodeId: outbound.nodeId,
				status: "cancelled", runId: "run-budget", agent: "worker" };
		},
	});
	const runaway = await runDelegation(recovery.deps, makeParams({ envelope: { maxTokens: 1 } }), dir, { executionId: "clamp-runaway" });
	const recoveryTask = recovery.deps.store.require(runaway.task.taskId);
	const recoveryHistoryBefore = recoveryTask.recoveryHistory?.length ?? 0;
	await expectRefusal(runDelegation(
		recovery.deps,
		makeParams({ taskId: recoveryTask.taskId, envelope: { maxTokens: 2 }, recovery: {
			executionId: "clamp-runaway", action: "retry_same_plan", reason: "retry", worktreeDecision: "keep",
		} }),
		dir,
		{ executionId: "clamp-recovery-refused", requestId: "request-clamp", requestObservation: () => request(60_000) },
	), "REQUEST_REMAINING_INSUFFICIENT");
	const recoveryAfter = recovery.deps.store.require(recoveryTask.taskId);
	assert.equal(recoveryAfter.recovery.required, true, "refusal leaves recovery authorization pending");
	assert.equal(recoveryAfter.recoveryHistory?.length ?? 0, recoveryHistoryBefore, "refusal consumes no recovery decision");
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
	let recoveryLaunches = 0;
	const { deps } = makeDeps({
		gitRunner: async (args, cwd) => realGit(dir, ...args),
		launch: async (request, signal, hooks) => {
			const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
			hooks.onUpdate({ ...base, tokens: 9999 + recoveryLaunches++ });
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
		envelope: { maxTokens: 9999 },
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
// post-0.8.0 follow-up 01 — worker_runaway records stateReason on blocked.
// planner_redelegate.recovery that finishes and is accepted must not leave
// that runaway text on a completed Task.
// ---------------------------------------------------------------------------
{
	const dir = initCommittedRepo();
	const runawayReason = "worker runaway: tokens 17027 exceeded envelope 12000; delegation cancelled";
	let workerCalls = 0;
	const { deps } = makeReviewDeps(dir, {
		reviewFor: (request) => makeReview(request.nodeId),
	});
	const innerLaunch = deps.launch;
	deps.launch = async (request, signal, hooks) => {
		if (request.agent === "reviewer") return innerLaunch(request, signal, hooks);
		workerCalls += 1;
		if (workerCalls === 1) {
			const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
			hooks.onUpdate({ ...base, tokens: 17027 });
			assert.equal(signal.aborted, true, "the runaway breach aborts the child");
			return { ...base, status: "cancelled", runId: "run-runaway", agent: "worker" };
		}
		return innerLaunch(request, signal, hooks);
	};

	const runaway = await runDelegation(
		deps,
		makeParams({ envelope: { maxTokens: 12000 } }),
		dir,
		{ executionId: "call-runaway" },
	);
	assert.equal(runaway.task.state, "blocked");
	assert.equal(runaway.task.stateReason, runawayReason, "blocked keeps the runaway reason");
	assert.equal(runaway.task.recovery.required, true);

	const taskId = runaway.task.taskId;
	const recovered = await runDelegation(
		deps,
		makeParams({
			taskId,
			envelope: { maxTokens: 200000 },
			recovery: {
				executionId: "call-runaway",
				action: "retry_same_plan",
				reason: "third attempt after runaway; same plan with a wider envelope",
				worktreeDecision: "keep",
			},
		}),
		dir,
		{ executionId: "call-recovery", toolName: "planner_redelegate" },
	);
	assert.equal(recovered.task.state, "reviewing", "recovery redelegate parks the new report in review");
	assert.equal(recovered.task.stateReason, undefined, "re-execution drops the runaway stateReason");
	assert.equal(recovered.task.recovery?.required, false, "the recovery decision was consumed");

	// A cancelled runaway execution has no admitted C_report, so a fresh
	// reviewer PASS over that chain is ineligible. Acceptance is the same
	// advanceReview transition a Root verdict uses once the recovered report
	// is on the Task.
	const accepted = advanceReview({
		store: deps.store,
		taskId,
		report: deps.store.require(taskId).reports.at(-1),
		review: makeReview(taskId),
	});
	assert.equal(accepted.decision.action, "accept");
	assert.equal(accepted.task.state, "completed");
	assert.equal(accepted.task.stateReason, undefined, "completed does not keep the runaway stateReason");
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
	const concurrency = new ConcurrencyController({ savedLimit: 1 });
	concurrency.hold({ id: "writerhold:call-held", taskId, role: "worker", capability: "writer", workspaces: [dir], reservedAt: "2026-09-16T00:00:00.000Z", countsTowardLimit: false });
	const { deps, launches } = makeDeps({ store, concurrency, gitRunner: async (args, cwd) => realGit(cwd ?? dir, ...args) });
	const holdBefore = structuredClone(store.require(taskId).writerHold);
	const reservationsBefore = structuredClone(concurrency.status().reservations);
	const recoveryHistoryBefore = store.require(taskId).recoveryHistory?.length ?? 0;
	await expectRefusal(runDelegation(deps, makeParams({
		taskId,
		recovery: { executionId: "call-held", action: "fix_environment", reason: "operator verified all child processes exited", worktreeDecision: "manual" },
	}), dir, {
		executionId: "call-manual-refused",
		requestId: "request-manual",
		requestObservation: () => ({ requestId: "request-manual", requestDeadline: "2026-09-20T00:01:00.000Z",
			remainingMs: 60_000, observedAt: "2026-09-20T00:00:00.000Z" }),
	}), "REQUEST_REMAINING_INSUFFICIENT");
	assert.deepEqual(store.require(taskId).writerHold, holdBefore, "insufficient manual recovery preserves the exact writer hold");
	assert.deepEqual(concurrency.status().reservations, reservationsBefore, "insufficient manual recovery preserves hold reservations");
	assert.equal(store.require(taskId).executions.length, 0, "insufficient manual recovery creates no execution");
	assert.equal(store.require(taskId).recovery.required, true);
	assert.equal(store.require(taskId).recoveryHistory?.length ?? 0, recoveryHistoryBefore, "insufficient manual recovery consumes no recovery grant");
	assert.equal(launches.length, 0, "insufficient manual recovery emits no REQUEST");
	assert.ok(concurrency.reserve({ id: "live-capacity", role: "worker", capability: "writer", workspaces: ["/unrelated/live"] }).reservation);
	await expectRefusal(runDelegation(deps, makeParams({
		taskId,
		recovery: { executionId: "call-held", action: "fix_environment", reason: "operator verified all child processes exited", worktreeDecision: "manual" },
	}), dir, {
		executionId: "call-manual-capacity-refused",
		requestId: "request-manual-capacity-refused",
		requestObservation: () => ({ requestId: "request-manual-capacity-refused", requestDeadline: "2026-09-20T00:02:00.000Z",
			remainingMs: 120_000, observedAt: "2026-09-20T00:00:00.000Z" }),
	}), "CONCURRENCY_LIMIT_REACHED");
	assert.equal(concurrency.get("writerhold:call-held")?.countsTowardLimit, false, "manual recovery rollback preserves restored isolation classification");
	assert.equal(concurrency.status().occupied, 1, "rollback does not turn the restored hold into execution capacity");
	assert.equal(concurrency.status().isolationHolds, 1);
	concurrency.release("live-capacity");
	const outcome = await runDelegation(deps, makeParams({
		taskId,
		recovery: { executionId: "call-held", action: "fix_environment", reason: "operator verified all child processes exited", worktreeDecision: "manual" },
	}), dir, {
		executionId: "call-manual",
		requestId: "request-manual",
		requestObservation: () => ({ requestId: "request-manual", requestDeadline: "2026-09-20T00:02:00.000Z",
			remainingMs: 120_000, observedAt: "2026-09-20T00:00:00.000Z" }),
	});
	assert.ok(outcome.report);
	assert.equal(store.require(taskId).writerHold, undefined);
	assert.equal(concurrency.status().reservations.length, 0);
	assert.equal(launches.length, 1, "sufficient manual recovery swaps the hold and launches once");
}

async function assertConcurrentManualRecovery(releaseLoserAfterWinnerCompletes) {
	const dir = initRealRepo();
	const store = new TaskStore();
	const suffix = releaseLoserAfterWinnerCompletes ? "after" : "running";
	const taskId = `T-20260916-801-${suffix}`;
	const heldExecutionId = `call-held-${suffix}`;
	store.create(createTaskSpec({ taskId, objective: "serialize manual recovery", cwd: dir, role: "worker", validation: { required: false } }));
	store.transition(taskId, "executing");
	store.transition(taskId, "blocked");
	store.setRecoveryRequired(taskId, { executionId: heldExecutionId, reason: "stop unconfirmed" });
	store.setWriterHold(taskId, { executionId: heldExecutionId, reason: "stop unconfirmed", since: "2026-09-16T00:00:00.000Z" });
	const concurrency = new ConcurrencyController();
	concurrency.hold({ id: `writerhold:${heldExecutionId}`, taskId, role: "worker", capability: "writer", workspaces: [dir], reservedAt: "2026-09-16T00:00:00.000Z" });
	const gate = () => {
		let resolve;
		const promise = new Promise((done) => { resolve = done; });
		return { promise, resolve };
	};
	const winnerAtProbe = gate();
	const loserAtProbe = gate();
	const releaseWinnerProbe = gate();
	const releaseLoserProbe = gate();
	const winnerAtLaunch = gate();
	const releaseWinnerLaunch = gate();
	const cleanGit = fakeCleanGit();
	let probeStarts = 0;
	let launches = 0;
	const { deps } = makeDeps({
		store,
		concurrency,
		gitRunner: async (args, cwd) => {
			if (args.join(" ") === "rev-parse --git-dir") {
				probeStarts += 1;
				if (probeStarts === 1) {
					winnerAtProbe.resolve();
					await releaseWinnerProbe.promise;
				} else if (probeStarts === 2) {
					loserAtProbe.resolve();
					await releaseLoserProbe.promise;
				}
			}
			return cleanGit(args, cwd);
		},
		launch: async (request) => {
			launches += 1;
			winnerAtLaunch.resolve();
			if (!releaseLoserAfterWinnerCompletes) await releaseWinnerLaunch.promise;
			return {
				requestId: request.requestId,
				ownerRunId: request.ownerRunId,
				nodeId: request.nodeId,
				status: "completed",
				runId: `run-${suffix}`,
				agent: "worker",
				result: { kind: "structured", value: makeReport(request.nodeId, undefined, request.cwd) },
			};
		},
	});
	const recovery = { executionId: heldExecutionId, action: "fix_environment", reason: "operator verified all child processes exited", worktreeDecision: "manual" };
	const winner = runDelegation(deps, makeParams({ taskId, recovery }), dir, { executionId: `call-winner-${suffix}` });
	await winnerAtProbe.promise;
	const loser = runDelegation(deps, makeParams({ taskId, recovery }), dir, { executionId: `call-loser-${suffix}` });
	await loserAtProbe.promise;
	releaseWinnerProbe.resolve();
	await winnerAtLaunch.promise;
	if (releaseLoserAfterWinnerCompletes) await winner;
	releaseLoserProbe.resolve();
	await expectRefusal(loser, "RECOVERY_REQUIRED");
	if (!releaseLoserAfterWinnerCompletes) {
		assert.deepEqual(concurrency.status().reservations.map((item) => item.id), [`call-winner-${suffix}`], "the stale recovery cannot restore a ghost hold while the winner runs");
		releaseWinnerLaunch.resolve();
		await winner;
	}
	const settled = store.require(taskId);
	assert.equal(launches, 1, "only the winning manual recovery launches");
	assert.equal(settled.executions.length, 1, "only the winning manual recovery consumes an execution grant");
	assert.equal(settled.recoveryHistory?.length, 1, "the recovery decision is consumed once");
	assert.equal(settled.recoveryHistory?.[0].consumedBy, `call-winner-${suffix}`);
	assert.equal(settled.writerHold, undefined);
	assert.deepEqual(concurrency.status().reservations, [], "no stale caller restores a ghost reservation");
}

await assertConcurrentManualRecovery(false);
await assertConcurrentManualRecovery(true);

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

for (const preparation of [false, true]) {
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
			captured.onUpdate({ requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, tokens: 200, toolCount: 1, currentTool: "read" });
			if (preparation) {
				for (let i = 2; i <= 70; i += 1) captured.onUpdate({ requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, tokens: 100, toolCount: i, currentTool: "read" });
			}
			throw new DelegationAborted(taskId);
		},
	});
	const outcome = await runDelegation(deps, makeParams({ taskId, envelope: preparation ? { maxReadOnlyTools: 1 } : { maxTokens: 100 } }), dir, { executionId: "call-late-runaway" });
	assert.equal(outcome.termination?.reason, preparation ? "preparation_runaway" : "worker_runaway");
	assert.equal(store.require(taskId).executions[0].usageSnapshot.snapshot, true);
	hooks.onLateTerminal({ requestId: "late-runaway", ownerRunId: "owner-run-1", nodeId: taskId, status: "cancelled", runId: "run-late-runaway", agent: "worker", usage: { input: 101, output: 7, cacheRead: 3, cacheWrite: 0, cost: 0.02, turns: 2, toolCalls: 4, durationMs: 20 } });
	await sleep(200);
	assert.equal(store.require(taskId).executions[0].endedReason, preparation ? "preparation_runaway" : "worker_runaway");
	assert.equal(store.require(taskId).executions[0].observedTokenHighWater, 200);
	if (preparation) assert.ok(store.require(taskId).executions[0].updateTrace.every((item) => item.tokens === 100), "the peak frame was evicted");
	assert.equal(store.require(taskId).executions[0].usageSnapshot, undefined, "late real usage replaces the partial execution snapshot");
	assert.equal(deps.usage.taskUsage(taskId).children.length, 1, "late usage is accounted once");
	assert.equal(deps.usage.taskUsage(taskId).children[0].input, 101);
	assert.equal(deps.usage.drain().at(-1).usageSnapshotResolved, true);
	await expectRefusal(runDelegation(deps, makeParams({ taskId, envelope: { maxTokens: 150 },
		recovery: { executionId: "call-late-runaway", action: "retry_same_plan", reason: "retry after terminal", worktreeDecision: "keep" },
	}), dir, { executionId: "late-smaller-retry" }), "RECOVERY_ENVELOPE_BELOW_OBSERVED");
	assert.equal(store.require(taskId).executions.length, 1, "a smaller terminal total cannot erase the observed breach");
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
	const host = store.create(createTaskSpec({ ...makeParams(), cwd: dir }));
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
		{ taskId: host.taskId, role: "validator" },
		dir,
		{ executionId: "call-validator", toolName: "planner_redelegate" },
	);
	assert.equal(outcome.task.validatorReports.length, 1);
	assert.equal(outcome.task.validatorReports[0].evidence.workerRunId, "run-validator");
}

// ---------------------------------------------------------------------------
// Runaway diagnostics/recovery: trace, snapshot, floor/handoff and prep guard.
// ---------------------------------------------------------------------------
{
	const dir = initRealRepo();
	const store = new TaskStore();
	let recoveryPacket;
	let launchNo = 0;
	const { deps } = makeDeps({ store, launch: async (request, signal, hooks) => {
		launchNo += 1;
		if (launchNo === 1) {
			const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
			for (let i = 1; i <= 70; i += 1) hooks.onUpdate({ ...base, tokens: i * 100, toolCount: i, currentTool: "read", currentToolArgs: `file-${i}`, ...(i === 68 ? { recentTools: Array.from({ length: 7 }, (_, n) => ({ tool: "read", args: `file-${61 + n}` })) } : {}), recentOutputLines: [`line-${i}`] });
			assert.equal(signal.aborted, true);
			return { ...base, status: "cancelled", runId: "run-trace" };
		}
		recoveryPacket = JSON.parse(request.task);
		return { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, status: "completed", runId: "run-recovery", agent: "worker", usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1, toolCalls: 1, durationMs: 2 }, result: { kind: "structured", value: makeReport(request.nodeId, "run-recovery", request.cwd) } };
	} });
	const first = await runDelegation(deps, makeParams({ envelope: { maxTokens: 6_000 } }), dir, { executionId: "trace-run" });
	assert.equal(first.termination.reason, "worker_runaway");
	const execution = store.require(first.task.taskId).executions[0];
	assert.equal(execution.updateTrace.length, 64);
	assert.equal(execution.updateTrace[0].ordinal, 7);
	assert.equal(execution.traceSummary.totalToolCalls, 70);
	assert.equal(execution.traceSummary.classifiedToolCalls, 70);
	assert.equal(execution.traceSummary.readOnlyToolFraction, 1);
	assert.deepEqual(execution.usageSnapshot, { input: null, output: null, cacheRead: null, cacheWrite: null, totalTokens: 7000, snapshot: true });
	const below = await expectRefusal(runDelegation(deps, makeParams({ taskId: first.task.taskId, envelope: { maxTokens: 6_999 }, recovery: { executionId: "trace-run", action: "retry_same_plan", reason: "retry unchanged", worktreeDecision: "keep" } }), dir, { executionId: "trace-too-small" }), "RECOVERY_ENVELOPE_BELOW_OBSERVED");
	assert.match(below.message, /observed token usage 7000/);
	assert.equal(store.require(first.task.taskId).executions.length, 1);
	const recovered = await runDelegation(deps, makeParams({ taskId: first.task.taskId, envelope: { maxTokens: 7_000 }, recovery: { executionId: "trace-run", action: "retry_same_plan", reason: "provider stabilized", worktreeDecision: "keep" } }), dir, { executionId: "trace-retry" });
	assert.ok(recovered.report, "equality is allowed");
	assert.equal(recoveryPacket.spec.objective, "implement the thing");
	assert.equal(recoveryPacket.instructions, "");
	assert.equal(recoveryPacket.priorExecution.executionId, "trace-run");
	assert.equal(recoveryPacket.priorExecution.recoveryReason, "provider stabilized");
	assert.equal(recoveryPacket.priorExecution.recentTools.length, 8);
	assert.deepEqual(recoveryPacket.priorExecution.recentTools.map((item) => item.args), Array.from({ length: 8 }, (_, n) => `file-${63 + n}`), "optional history does not erase subsequent currentTool observations");
	assert.equal(recoveryPacket.priorExecution.recentOutputLines.at(-1), "line-70");
}

{
	const dir = initRealRepo();
	const prepDeps = (role) => makeDeps({ launch: async (request, signal, hooks) => {
		const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
		for (let i = 1; i <= 3; i += 1) hooks.onUpdate({ ...base, tokens: i * 100, toolCount: i, currentTool: "read", currentToolArgs: `r-${i}` });
		return signal.aborted
			? { ...base, status: "cancelled", runId: `run-${role}` }
			: { ...base, status: "completed", runId: `run-${role}`, agent: role, result: { kind: "structured", value: makeReport(request.nodeId, `run-${role}`, request.cwd) } };
	} });
	const worker = prepDeps("worker");
	const stopped = await runDelegation(worker.deps, makeParams({ envelope: { maxReadOnlyTools: 2 } }), dir, { executionId: "prep-worker" });
	assert.equal(stopped.termination.reason, "preparation_runaway");
	assert.equal(stopped.task.executions[0].runawayObservation.signal, "preparation");
	assert.equal(stopped.task.executions[0].usageSnapshot.totalTokens, 300, "prep-only envelopes still retain observed tokens");
	const explorer = prepDeps("explorer");
	const allowed = await runDelegation(explorer.deps, makeParams({ role: "explorer", envelope: { maxReadOnlyTools: 2 } }), dir, { executionId: "prep-explorer" });
	assert.equal(allowed.termination, undefined);
	assert.equal(Compile(PLANNER_DELEGATE_PARAMETERS).Check(makeParams({ envelope: { maxTokens: 100, preparationTokensShare: 0.5 } })), true);
	const invalid = prepDeps("worker");
	await expectRefusal(runDelegation(invalid.deps, makeParams({ envelope: { preparationTokensShare: 0.5 } }), dir, { executionId: "prep-invalid" }), "ENVELOPE_INVALID");
	assert.equal(invalid.launches.length, 0);
	const repeated = makeDeps({ launch: async (request, signal, hooks) => {
		const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
		for (let i = 0; i < 4; i += 1) hooks.onUpdate({ ...base, tokens: 100 + i, toolCount: 1, currentTool: "read", currentToolArgs: "please write output.ts" });
		assert.equal(signal.aborted, false, "repeated progress frames and prose in args do not count as writes or extra calls");
		return { ...base, status: "completed", runId: "run-repeat", agent: "worker", result: { kind: "structured", value: makeReport(request.nodeId, "run-repeat", request.cwd) } };
	} });
	const repeatedOutcome = await runDelegation(repeated.deps, makeParams({ envelope: { maxReadOnlyTools: 1 } }), dir, { executionId: "prep-repeat" });
	assert.equal(repeatedOutcome.termination, undefined);
	assert.equal(repeatedOutcome.task.executions[0].traceSummary.totalToolCalls, 1);
	const share = prepDeps("worker");
	const shareStopped = await runDelegation(share.deps, makeParams({ envelope: { maxTokens: 1_000, preparationTokensShare: 0.2 } }), dir, { executionId: "prep-share" });
	assert.equal(shareStopped.termination.reason, "preparation_runaway");
	assert.deepEqual(shareStopped.task.executions[0].runawayObservation, { signal: "preparation", observed: 300, limit: 200 });
	const wrote = makeDeps({ launch: async (request, signal, hooks) => {
		const base = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
		hooks.onUpdate({ ...base, tokens: 50, toolCount: 1, currentTool: "bash", currentToolArgs: "apply change" });
		hooks.onUpdate({ ...base, tokens: 500, toolCount: 2, currentTool: "read" });
		assert.equal(signal.aborted, false);
		return { ...base, status: "completed", runId: "run-wrote", agent: "worker", result: { kind: "structured", value: makeReport(request.nodeId, "run-wrote", request.cwd) } };
	} });
	const wroteOutcome = await runDelegation(wrote.deps, makeParams({ envelope: { maxTokens: 1_000, preparationTokensShare: 0.2 } }), dir, { executionId: "prep-wrote" });
	assert.equal(wroteOutcome.termination, undefined);
	assert.equal(wroteOutcome.task.executions[0].traceSummary.firstNonReadOnlyToolOrdinal, 1);
}

// ---------------------------------------------------------------------------
// Runtime-agent registration fallback: pi-subagents #2356 (main 2026-09-20)
// removed `completionGuard` and its registry rejects unknown fields. The first
// attempt keeps the ≤0.70.0 opt-out; only that exact rejection is retried
// once without the field. Other failures and a missing owner stay unregistered.
// ---------------------------------------------------------------------------
{
	const definition = { description: "d", systemPrompt: "p", tools: ["read"], completionGuard: false };
	const record = (results) => {
		const seen = [];
		const emit = (event, request) => {
			assert.equal(event, "pi-subagents:runtime-agent-register:v1");
			seen.push(request.definition);
			const next = results.shift();
			if (next !== undefined) request.result = next;
		};
		return { emit, seen };
	};
	// (a) ≤0.70.0 owner accepts the opt-out on the first attempt: one emit, field kept.
	const accept = record([{ ok: true, registration: { dispose() {} } }]);
	assert.equal(registerPluginRuntimeAgent(accept.emit, "planner-scout", definition), true);
	assert.equal(accept.seen.length, 1);
	assert.equal(accept.seen[0].completionGuard, false);
	// (b) #2356 owner rejects the unknown field: retried once without it, and accepted.
	const strict = record([
		{ ok: false, error: new Error("Runtime agent definition has unknown fields: completionGuard.") },
		{ ok: true, registration: { dispose() {} } },
	]);
	assert.equal(registerPluginRuntimeAgent(strict.emit, "planner-scout", definition), true);
	assert.equal(strict.seen.length, 2);
	assert.equal(strict.seen[0].completionGuard, false);
	assert.equal("completionGuard" in strict.seen[1], false, "the retry drops only completionGuard");
	assert.deepEqual(strict.seen[1].tools, ["read"], "the retry keeps the capability proof");
	// (c) a different rejection is not retried and stays unregistered.
	const other = record([{ ok: false, error: new Error("Runtime agent definition has unknown fields: tools.") }]);
	assert.equal(registerPluginRuntimeAgent(other.emit, "planner-scout", definition), false);
	assert.equal(other.seen.length, 1);
	// (d) rejection on the retry too: still unregistered, no third attempt.
	const twice = record([
		{ ok: false, error: new Error("Runtime agent definition has unknown fields: completionGuard.") },
		{ ok: false, error: new Error("name collision") },
	]);
	assert.equal(registerPluginRuntimeAgent(twice.emit, "planner-scout", definition), false);
	assert.equal(twice.seen.length, 2);
	// (e) no owner writes a result: unregistered, single attempt.
	const absent = record([]);
	assert.equal(registerPluginRuntimeAgent(absent.emit, "planner-scout", definition), false);
	assert.equal(absent.seen.length, 1);
	// (f) a definition without the field never retries.
	const plain = record([{ ok: false, error: new Error("Runtime agent definition has unknown fields: completionGuard.") }]);
	assert.equal(registerPluginRuntimeAgent(plain.emit, "planner-report-only", { description: "d", systemPrompt: "p" }), false);
	assert.equal(plain.seen.length, 1);
}

console.log("delegate.test.mjs: all cases passed");
