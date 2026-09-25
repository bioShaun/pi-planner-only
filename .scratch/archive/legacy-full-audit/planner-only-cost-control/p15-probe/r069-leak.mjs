// p15-r069 verification: does a reservation survive an early `return { block }`
// that happens AFTER reserve() but BEFORE any delegations.set()?
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";
import { emptyTaskUsage } from "../../../usage.ts";

const BASE = "/repo";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const store = new TaskStore({ now: () => new Date(2026, 8, 8) });
const orch = new PlannerOrchestrator({ store, gitRunner });
const taskId = "T-20260908-902";

const spec = {
	taskId, objective: "leak probe", cwd: BASE, role: "worker",
	scope: { allowedPaths: ["src/a.ts"] }, constraints: [],
	acceptanceCriteria: ["tests pass"],
	validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true }, stopConditions: [],
	cumulativeBudget: { tokens: 200000, costUsd: 1.0 },
};
await orch.beginDelegation({ toolCallId: "seed", input: { task: JSON.stringify(spec) } }, BASE);
const task = orch.store.get(taskId);
task.usage = emptyTaskUsage();
task.reports.push({ taskId, status: "completed", validation: [], changedFiles: [], summary: "x" });
console.log("B0 pendingDelegationCount after seed:", orch.pendingDelegationCount());

// A validator delegation whose TaskSpec omits required validation commands hits
// `return { block: { reason: MISSING_VALIDATION_DEFINITION_REASON } }` — after reserve.
const badSpec = JSON.stringify({ ...spec, validation: { required: true, commands: [] } });
let blocked = 0;
for (let i = 0; i < 6; i++) {
	const input = { agent: "validator", task: badSpec };
	const r = await orch.beginDelegation({ toolCallId: `bad-${i}`, input }, BASE);
	if (r?.block) blocked++;
}
console.log("B1 blocked-before-launch calls:", blocked);
console.log("B2 pendingDelegationCount (children actually in flight):", orch.pendingDelegationCount());

// Now a perfectly legitimate bounded retry on the same Task.
const good = { agent: "worker", task: `Fix ${taskId}` };
await orch.prepareRoleDelegation(good);
const r = await orch.beginDelegation({ toolCallId: "good", input: good }, BASE);
if (r?.block) {
	console.log("B3 LEAK CONFIRMED — legitimate delegation refused:");
	console.log(String(r.block.reason).split("\n").map((l) => "    " + l).join("\n"));
} else {
	console.log("B3 no leak: legitimate delegation granted", JSON.stringify(good.usageBudget));
}
