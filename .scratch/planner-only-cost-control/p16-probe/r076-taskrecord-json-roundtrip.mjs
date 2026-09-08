// Ticket 16-a precondition: a TaskRecord must survive JSON.stringify/parse losslessly,
// otherwise a ledger snapshot cannot restore the gate's inputs.
import assert from "node:assert/strict";
import { TaskStore } from "../../../task.ts";

const store = new TaskStore();
const spec = {
	taskId: "T-20260908-777",
	objective: "round-trip probe",
	cwd: "/fixture/rt",
	role: "worker",
	scope: { allowedPaths: ["src/a.ts"] },
	constraints: ["no new deps"],
	acceptanceCriteria: ["tests pass"],
	validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true },
	stopConditions: ["ask if ambiguous"],
	cumulativeBudget: { tokens: 200000, costUsd: 0.5 },
};
const task = store.create(spec, "alias-1");
store.bindSpec(task.taskId, spec);
store.ensureCwd(task.taskId, "/fixture/rt");
store.transition(task.taskId, "executing");
store.recordReport(task.taskId, {
	taskId: task.taskId, summary: "did the thing", changedFiles: ["src/a.ts"],
	validation: { ran: true, commands: [{ command: "npm test", exitCode: 0 }] }, at: new Date().toISOString(),
});
store.setStateReason(task.taskId, "probe");
store.incrementRound(task.taskId);
task.usage = {
	...task.usage,
	children: [{ key: "call:c1", role: "worker", tokens: 1500, costUsd: 0.05, pending: false }],
};

const before = store.get(task.taskId);
const after = JSON.parse(JSON.stringify(before));
assert.deepStrictEqual(after, JSON.parse(JSON.stringify(before)));
assert.deepStrictEqual(Object.keys(after).sort(), Object.keys(before).sort());
assert.equal(after.spec.cumulativeBudget.costUsd, 0.5, "the gate's input must survive");
assert.equal(after.usage.children[0].tokens, 1500);
// the real question: does a re-parsed record differ from the live one anywhere?
const diff = [];
for (const key of Object.keys(before)) {
	const a = JSON.stringify(before[key]);
	const b = JSON.stringify(after[key]);
	if (a !== b) diff.push(`${key}: live=${a} parsed=${b}`);
}
console.log("keys:", Object.keys(before).join(","));
console.log("lossy keys:", diff.length === 0 ? "(none)" : diff.join("\n  "));
console.log("r076-taskrecord-json-roundtrip:", diff.length === 0 ? "PASS" : "FAIL");
process.exit(diff.length === 0 ? 0 : 1);
