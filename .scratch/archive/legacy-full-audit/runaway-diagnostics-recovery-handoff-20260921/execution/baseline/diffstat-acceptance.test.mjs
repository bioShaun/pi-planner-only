import assert from "node:assert/strict";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { createTaskSpec, TaskStore } from "./task.ts";

// Fixture ids are stamped 2026-09-05; pin the store clock so id replacement
// never depends on the wall clock of the machine running the suite.
const FIXED_NOW = () => new Date(2026, 8, 5);
const pinnedStore = () => new TaskStore({ now: FIXED_NOW });

// --------------------------------------------------------------------------
// R3 follow-up — expectedEvidence.diffStat has three distinct states: an
// unbound field (refused), a failed `diff HEAD --stat` probe (refused —
// unverifiable), and a succeeded probe with empty output — a clean worktree,
// where only an empty declared diffStat satisfies the contract.
// --------------------------------------------------------------------------

const gitDefaults = new Map([
	["rev-parse --git-dir", ".git\n"],
	["rev-parse HEAD", "abc1234\n"],
	["status --porcelain=v2 --branch", ""],
	["diff HEAD --stat", ""],
]);

const cleanRunner = async (args) => {
	const stdout = gitDefaults.get(args.join(" ")) ?? "";
	return { stdout, stderr: "", code: 0 };
};

const failingDiffRunner = async (args) => {
	const key = args.join(" ");
	if (key === "diff HEAD --stat") {
		return { stdout: "", stderr: "fatal: bad revision", code: 128 };
	}
	return { stdout: gitDefaults.get(key) ?? "", stderr: "", code: 0 };
};

function boundReaderExecution(store, task, { executionId, report }) {
	store.transition(task.taskId, "executing");
	store.beginExecution(task.taskId, {
		executionId,
		kind: "explorer",
		cwd: task.cwd,
		worktreeRoots: [task.cwd],
		aRun: { cwd: task.cwd, taskId: task.taskId, workerRunId: executionId, gitAvailable: false },
		capability: "restricted-reader",
		capabilityBasis: "test runtime binding [read, grep, find, ls]",
		readOnly: true,
	});
	store.recordReport(task.taskId, report);
	store.completeExecution(task.taskId, executionId, {
		status: "completed",
		endedAt: "2026-09-05T00:00:00.000Z",
		terminationConfirmed: true,
		confirmationBasis: "terminal+restricted-reader",
		reportIndex: 0,
		usageComplete: true,
	});
	store.transition(task.taskId, "reviewing");
}

function observationDiffStatTask(store, taskId, runner, additionalWorktreeRoots = []) {
	const orch = new PlannerOrchestrator({ gitRunner: runner, store });
	const task = store.create(createTaskSpec({
		taskId,
		objective: "observe a clean worktree and declare its diff",
		cwd: "/repo",
		role: "explorer",
		acceptanceMode: "observation",
		additionalWorktreeRoots,
		expectedEvidence: { diffStat: true },
		validation: { required: false },
	}));
	return { orch, task };
}

const unavailableExtraRootRunner = async (args, cwd) => {
	if (cwd === "/missing-linked-root") {
		return { stdout: "", stderr: "fatal: not a git repository", code: 128 };
	}
	return cleanRunner(args);
};

function diffStatReport(task, executionId, diffStat) {
	return {
		version: 1,
		taskId: task.taskId,
		status: "completed",
		summary: "observed the worktree",
		changedFiles: [],
		validation: [],
		evidence: {
			cwd: task.cwd,
			taskId: task.taskId,
			workerRunId: executionId,
			finalGitRef: "abc1234",
			...(diffStat === undefined ? {} : { diffStat }),
			gitAvailable: true,
			generatedAt: "2026-09-05T00:00:00.000Z",
		},
		risks: [],
		unresolved: [],
	};
}

{
	// A succeeded empty `diff HEAD --stat` on a clean worktree is a valid zero-
	// change result: an empty declared diffStat matches Root's empty sample.
	const store = pinnedStore();
	const { orch, task } = observationDiffStatTask(store, "T-20260918-ds0", cleanRunner);
	boundReaderExecution(store, task, {
		executionId: "call-ds0",
		report: diffStatReport(task, "call-ds0", ""),
	});
	assert.equal(orch.rootVerdictRefusal(store.require(task.taskId), "pass"), undefined, "an empty diffStat is a bound field, not a missing one");
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "clean worktree confirmed");
	assert.equal(outcome.decision.action, "accept", "empty declared diffStat against an empty sample passes");
	assert.equal(outcome.task.state, "completed");
}

{
	// An unbound diffStat field is still refused — empty output is a valid
	// result, absence of the field is not.
	const store = pinnedStore();
	const { orch, task } = observationDiffStatTask(store, "T-20260918-ds1", cleanRunner);
	boundReaderExecution(store, task, {
		executionId: "call-ds1",
		report: diffStatReport(task, "call-ds1", undefined),
	});
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "accept unbound diffStat");
	assert.equal(outcome.decision.action, "blocked");
	assert.match(outcome.decision.reason, /none was recorded/);
	assert.notEqual(outcome.task.state, "completed");
}

{
	// A failed diff probe is unverifiable even though Git itself is available.
	const store = pinnedStore();
	const { orch, task } = observationDiffStatTask(store, "T-20260918-ds2", failingDiffRunner);
	boundReaderExecution(store, task, {
		executionId: "call-ds2",
		report: diffStatReport(task, "call-ds2", ""),
	});
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "accept diffStat without a diff probe");
	assert.equal(outcome.decision.action, "blocked");
	assert.match(outcome.decision.reason, /observation-inadmissible/);
	assert.match(outcome.decision.reason, /cannot be verified/);
	assert.notEqual(outcome.task.state, "completed");
}

{
	// A non-empty declared diffStat cannot match Root's empty sample — the
	// report is stale or fabricated.
	const store = pinnedStore();
	const { orch, task } = observationDiffStatTask(store, "T-20260918-ds3", cleanRunner);
	boundReaderExecution(store, task, {
		executionId: "call-ds3",
		report: diffStatReport(task, "call-ds3", " src/parser.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)"),
	});
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "accept non-empty diffStat on a clean tree");
	assert.equal(outcome.decision.action, "blocked");
	assert.match(outcome.decision.reason, /does not match Root's fresh sample/);
	assert.notEqual(outcome.task.state, "completed");
}

{
	// A clean primary root does not make a partial multi-root sample complete:
	// the unavailable declared root could contain changes missing from diffStat.
	const store = pinnedStore();
	const { orch, task } = observationDiffStatTask(
		store,
		"T-20260918-ds4",
		unavailableExtraRootRunner,
		["/missing-linked-root"],
	);
	boundReaderExecution(store, task, {
		executionId: "call-ds4",
		report: diffStatReport(task, "call-ds4", ""),
	});
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "accept partial multi-root diffStat");
	assert.equal(outcome.decision.action, "blocked");
	assert.match(outcome.decision.reason, /cannot be verified/);
	assert.notEqual(outcome.task.state, "completed");
}
