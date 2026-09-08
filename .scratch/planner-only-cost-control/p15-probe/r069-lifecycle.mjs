// Does a genuinely LAUNCHED + recorded delegation keep its reservation, and does
// completing it give the balance back?
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";
import { emptyTaskUsage } from "../../../usage.ts";
const BASE = "/repo";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const store = new TaskStore({ now: () => new Date(2026, 8, 8) });
const orch = new PlannerOrchestrator({ store, gitRunner });
const taskId = "T-20260908-905";
const spec = { taskId, objective: "life", cwd: BASE, role: "worker", scope: { allowedPaths: ["src/a.ts"] },
	constraints: [], acceptanceCriteria: ["t"], validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true }, stopConditions: [],
	cumulativeBudget: { tokens: 50000, costUsd: 0.20 } };
// Seed: creates the Task and is recorded (holds the writer lock).
await orch.beginDelegation({ toolCallId: "seed", input: { task: JSON.stringify(spec) } }, BASE);
const task = orch.store.get(taskId);
task.usage = emptyTaskUsage();
task.usage.children.push({ kind: "worker", calls: 1, turns: 1, input: 40000, output: 8000, cacheRead: 0, cacheWrite: 0, costUsd: 0.19 });
console.log("E0 seed recorded:", orch.getDelegation("seed") !== undefined,
	"| inFlight:", JSON.stringify(orch.reservations?.inFlight?.(taskId)));
// Complete the seed child so the writer lock frees and the record is removed.
await orch.handleSubagentResult({ toolCallId: "seed", output: JSON.stringify({
	taskId, status: "completed", summary: "done", changedFiles: ["src/a.ts"],
	validation: [{ command: "npm test", passed: true, exitCode: 0 }] }) }, BASE);
console.log("E1 seed still recorded:", orch.getDelegation("seed") !== undefined,
	"| inFlight:", JSON.stringify(orch.reservations?.inFlight?.(taskId)));
// Now a bounded retry that should genuinely launch.
const a = { agent: "worker", task: `Fix ${taskId}` };
await orch.prepareRoleDelegation(a);
const out = await orch.beginDelegation({ toolCallId: "retry-1", input: a }, BASE);
console.log("E2 retry-1 keys:", Object.keys(out ?? {}), "| recorded:", orch.getDelegation("retry-1") !== undefined,
	"| launched with:", JSON.stringify(a.usageBudget));
console.log("E3 inFlight while child runs:", JSON.stringify(orch.reservations?.inFlight?.(taskId)));
const b = { agent: "worker", task: `Concurrent ${taskId}` };
await orch.prepareRoleDelegation(b);
const out2 = await orch.beginDelegation({ toolCallId: "retry-2", input: b }, BASE);
console.log("E4 concurrent second child:", out2?.block ? "REFUSED (correct)" : "granted " + JSON.stringify(b.usageBudget));
