import assert from "node:assert/strict";
import { CLOSEOUT_RECOVERY_ACTION, requireCloseoutOrigin } from "./closeout-recovery.ts";

const sample = (changedPaths, diffStat) => ({
	cwd: "/work", repoRoot: "/work", taskId: "T-20260922-003", workerRunId: "run-origin",
	baseGitRef: "a".repeat(40), finalGitRef: "a".repeat(40), gitAvailable: true,
	changedPaths, dirtyPathHashes: Object.fromEntries(changedPaths.map((path) => [path, "b".repeat(64)])),
	...(diffStat ? { diffStat } : {}), generatedAt: "2026-09-22T00:00:00.000Z",
});
const origin = {
	executionId: "origin", taskId: "T-20260922-003", kind: "worker", cwd: "/work", worktreeRoots: ["/work"],
	aRun: sample([], undefined), cTerminal: sample(["src/a.ts"], " src/a.ts | 1 +"),
	status: "stopped", endedReason: "worker_runaway", terminationConfirmed: true, confirmationBasis: "terminal+quiet-worktree",
	runawayObservation: { signal: "tokens", observed: 101, limit: 100 }, rawTerminal: { status: "cancelled" },
};
const task = { taskId: "T-20260922-003", cwd: "/work", executions: [origin] };
const decision = { executionId: "origin", action: CLOSEOUT_RECOVERY_ACTION, reason: "finish", worktreeDecision: "keep" };
const spec = {
	taskId: task.taskId, objective: "x", cwd: "/work", role: "worker", acceptanceMode: "worktree",
	scope: { allowedPaths: ["src/"] }, constraints: [], acceptanceCriteria: [],
	validation: { required: true, commands: ["python3 -m unittest"] }, expectedEvidence: {}, stopConditions: [],
};

assert.deepEqual(requireCloseoutOrigin(task, decision, spec).inheritedTruthPaths, ["/work/src/a.ts"]);

for (const [name, mutate, pattern] of [
	["quiescence", (value) => { value.terminationConfirmed = false; }, /confirmed/],
	["confirmation basis", (value) => { delete value.confirmationBasis; }, /confirmed/],
	["missing terminal", (value) => { delete value.cTerminal; }, /confirmed/],
	["evidence incomplete", (value) => { value.evidenceIncomplete = true; }, /confirmed/],
	["writer hold", (_value, record) => { record.writerHold = { executionId: "origin" }; }, /writer hold/],
	["auxiliary", (value) => { value.auxiliary = true; }, /ordinary/],
	["explorer origin on worker Task", (value) => { value.kind = "explorer"; }, /ordinary/],
	["read-only origin", (value) => { value.readOnly = true; }, /ordinary/],
	["report-only", (value) => { value.reportOnly = true; }, /ordinary/],
	["closeout origin", (value) => { value.closeout = {}; }, /ordinary/],
	["existing report", (value) => { value.cReport = value.cTerminal; }, /report boundary/],
	["report index", (value) => { value.reportIndex = 0; }, /report boundary/],
	["ordinary cancellation", (value) => { value.endedReason = "operator_cancel"; }, /tokens\/wall/],
	["snapshot gap", (value) => { value.cTerminal.snapshotGap = "failed"; }, /no complete attributed/],
	["diffStat", (value) => { value.cTerminal.diffStat = ""; }, /diffStat/],
	["preparation", (value) => { value.runawayObservation.signal = "preparation"; }, /tokens\/wall/],
	["terminal status", (value) => { value.rawTerminal.status = "failed"; }, /cancelled/],
	["already consumed", (_value, record) => { record.executions.push({ closeout: { originExecutionId: "origin" } }); }, /already consumed/],
]) {
	const record = structuredClone(task);
	mutate(record.executions[0], record);
	assert.throws(() => requireCloseoutOrigin(record, decision, spec), pattern, name);
}

{
	const record = structuredClone(task);
	record.executions[0].aRun.changedPaths = ["src/a.ts"];
	record.executions[0].aRun.dirtyPathHashes = { "src/a.ts": "b".repeat(64) };
	assert.throws(() => requireCloseoutOrigin(record, decision, spec), /no complete attributed/, "old dirty file is not origin work");
}

assert.throws(() => requireCloseoutOrigin(task, {...decision, executionId: "wrong"}, spec), /missing/);
assert.throws(() => requireCloseoutOrigin(task, decision, {...spec, additionalWorktreeRoots: ["/other"]}), /one complete/);
assert.deepEqual(requireCloseoutOrigin({...task, executions: [{...origin, runawayObservation: {...origin.runawayObservation, signal: "wall"}}]}, decision, spec).inheritedTruthPaths, ["/work/src/a.ts"]);
console.log("closeout recovery gate tests passed");
