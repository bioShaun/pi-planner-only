// T11 clause 1: no WorkerReport -> validation state unknown -> Validator contract is full.
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";
import { lastWorkerValidationPassed } from "../../../roles.ts";

const BASE = "/repo";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
console.log("c1 lastWorkerValidationPassed(undefined):", lastWorkerValidationPassed(undefined));

const raw = {
	taskId: "T-20260908-951", objective: "needs validation", cwd: BASE, role: "worker",
	scope: { allowedPaths: ["src/a.ts"] }, constraints: [], acceptanceCriteria: ["ship"],
	validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true }, stopConditions: [],
};
const orch = new PlannerOrchestrator({ store: new TaskStore({ now: () => new Date(2026, 8, 8) }), gitRunner });
await orch.beginDelegation({ toolCallId: "c1", input: { task: JSON.stringify(raw) } }, BASE);
const task = orch.store.get("T-20260908-951");
console.log("c1 reports:", task.reports.length, "(no report yet)");

// Validator delegation on a Task with no report at all.
const vInput = { agent: "oracle", task: `Validate T-20260908-951` };
await orch.prepareRoleDelegation(vInput);
const m = /ORACLE_SUITE=(\w+)/.exec(vInput.task);
console.log("c1 validator contract:", m ? m[1] : "(none)");
const status = orch.renderTaskStatus(task);
console.log("c1 status has 'Validation: passed'?", status.includes("Validation: passed"));
console.log("c1 status has 'Validation: not required'?", status.includes("Validation: not required"));
