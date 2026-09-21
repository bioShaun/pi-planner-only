import assert from "node:assert/strict";
import { Compile } from "typebox/compile";
import { runDelegation, DelegationRefused, PLANNER_DELEGATE_PARAMETERS, PLANNER_REDELEGATE_PARAMETERS } from "./delegate.ts";
import { TaskStore } from "./task.ts";
import { ConcurrencyController } from "./concurrency.ts";
import { UsageLedger } from "./usage.ts";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { hashStatus } from "./evidence.ts";

const cwd = process.cwd();
const spec = {
	role: "worker", objective: "Check existing work", scope: {},
	constraints: ["Do not change files"], acceptanceCriteria: ["Checks pass"],
	validation: { required: false },
};
const store = new TaskStore();
const concurrency = new ConcurrencyController();
const launches = [];
let gitReads = 0;
let idClaims = 0;
const allocate = store.nextTaskId.bind(store);
store.nextTaskId = () => { idClaims++; return allocate(); };
const gitRunner = async (args, dir) => {
	gitReads++;
	const key = args.join(" ");
	return { code: 0, stderr: "", stdout:
		key === "rev-parse --git-dir" ? ".git\n" :
		key === "rev-parse --show-toplevel" ? `${dir ?? cwd}\n` :
		key === "rev-parse HEAD" ? `${"0".repeat(40)}\n` : "" };
};
const deps = {
	store, concurrency, gitRunner, ownerRunId: "validator-admission-test",
	usage: new UsageLedger({ pricing: { version: 1, currency: "USD", rates: {} } }),
	quiescenceWaitMs: 0, quiescenceSampleGapMs: 0,
	launch: async request => {
		launches.push(request);
		return {
			requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
			status: "completed", runId: `run-${launches.length}`, agent: request.agent,
			result: { kind: "structured", value: {
				version: 1, taskId: request.nodeId, status: "completed", summary: "Checks passed",
				changedFiles: [], validation: [], risks: [], unresolved: [],
				evidence: { cwd, taskId: request.nodeId, finalGitRef: "0".repeat(40),
					gitStatusHash: hashStatus(""), gitAvailable: true, changedPaths: [],
					generatedAt: new Date().toISOString() },
			} },
		};
	},
};

// Non-validating hosts and direct callers must fail before allocating or launching.
await assert.rejects(runDelegation(deps, { ...spec, role: "validator" }, cwd), error => {
	assert.ok(error instanceof DelegationRefused);
	assert.equal(error.code, "TASK_REQUIRED");
	assert.match(error.message, /role=validator/);
	assert.match(error.message, /planner_delegate.*role=worker/);
	assert.match(error.message, /planner_redelegate.*role=validator/);
	return true;
});
assert.equal(idClaims, 0);
assert.equal(gitReads, 0);
assert.equal(launches.length, 0);
assert.equal(store.list().length, 0);
assert.equal(concurrency.status().reservations.length, 0);

const createSchema = Compile(PLANNER_DELEGATE_PARAMETERS);
assert.equal(createSchema.Check({ ...spec, role: "validator" }), false);
assert.equal(createSchema.Check(spec), true);
assert.equal(createSchema.Check({ ...spec, role: "explorer" }), true);
const rebindSchema = Compile(PLANNER_REDELEGATE_PARAMETERS);
assert.equal(rebindSchema.Check({ taskId: "T-20260921-020", role: "validator" }), true);

// Supported flow: the oracle supplements an existing worker report, and Root
// can still judge that original report after the auxiliary execution.
const worker = await runDelegation(deps, spec, cwd, { executionId: "worker-call" });
assert.equal(worker.decision.action, "review_pending");
const primaryReport = structuredClone(worker.task.reports[0]);
const validator = await runDelegation(deps, { taskId: worker.task.taskId, role: "validator" }, cwd,
	{ toolName: "planner_redelegate", executionId: "validator-call" });
assert.equal(launches[1].agent, "oracle");
assert.equal(validator.task.role, "worker");
assert.equal(validator.task.reports.length, 1);
assert.deepEqual(validator.task.reports[0], primaryReport);
assert.equal(validator.task.validatorReports.length, 1);
assert.equal(validator.task.validatorReports[0].evidence.workerRunId, "run-2");
assert.equal(validator.task.executions.at(-1).auxiliary, true);
assert.equal(validator.decision.action, "review_pending");
const orchestrator = new PlannerOrchestrator({ store, gitRunner, concurrency });
assert.equal(orchestrator.rootVerdictRefusal(validator.task, "pass"), undefined);
const verdict = await orchestrator.recordRootVerdict(validator.task, "pass", "Checks pass");
assert.equal(verdict.decision.action, "accept");
assert.equal(store.require(worker.task.taskId).state, "completed");
console.log("validator-admission tests passed");
