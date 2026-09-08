// Ticket 14 probe round 2: use the REAL spec path (embedded JSON -> extractTaskSpecDetails),
// not createTaskSpec (which drops budget/cumulativeBudget; test-only helper).
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";
import { emptyTaskUsage, summarizeTaskBudget } from "../../../usage.ts";

const BASE = "/repo";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });

function rawSpec(taskId, extra = {}) {
	return {
		taskId, objective: `implement ${taskId}`, cwd: BASE, role: "worker",
		scope: { allowedPaths: ["src/a.ts"] }, constraints: [],
		acceptanceCriteria: ["tests pass"],
		validation: { required: true, commands: ["npm test"] },
		expectedEvidence: { changedFiles: true, tests: true }, stopConditions: [],
		...extra,
	};
}

const store = new TaskStore({ now: () => new Date(2026, 8, 8) });
const orch = new PlannerOrchestrator({ store, gitRunner });
const taskId = "T-20260908-901";

const input = { task: JSON.stringify(rawSpec(taskId, { cumulativeBudget: { tokens: 50000, costUsd: 0.20 } })) };
await orch.beginDelegation({ toolCallId: "c1", input }, BASE);
const task = orch.store.get(taskId);
console.log("A1 cumulativeBudget carried:", JSON.stringify(task?.spec?.cumulativeBudget));
console.log("A2 first delegation usageBudget:", JSON.stringify(input.usageBudget), "(beginDelegation only; no prepare)");

// Burn 48k tokens / $0.19.
const usage = emptyTaskUsage();
usage.children.push({ kind: "worker", calls: 1, turns: 1, input: 40000, output: 8000, cacheRead: 0, cacheWrite: 0, costUsd: 0.19 });
task.usage = usage;
const b = summarizeTaskBudget(usage, task.spec.cumulativeBudget);
console.log("A3 remaining tokens:", b.tokens.remaining, "cost:", b.costUsd.remaining);

// Second (bounded, retry) delegation on the same Task.
task.reports.push({ taskId, status: "completed" });
const input2 = { agent: "worker", task: `Fix ${taskId}` };
await orch.prepareRoleDelegation(input2);
console.log("A4 retry down-passed usageBudget:", JSON.stringify(input2.usageBudget), "toolBudget:", JSON.stringify(input2.toolBudget));
console.log("A5 __floorLimits:", JSON.stringify(input2.__floorLimits));

// Third concurrent delegation — same Task, nothing deducted for the in-flight one.
const input3 = { agent: "worker", task: `Also fix ${taskId}` };
await orch.prepareRoleDelegation(input3);
console.log("A6 concurrent down-passed usageBudget:", JSON.stringify(input3.usageBudget));
console.log("A7 OVERSUBSCRIPTION: two in-flight children may each spend",
	input2.usageBudget?.tokens?.hard, "+", input3.usageBudget?.tokens?.hard,
	"tokens against a remaining balance of", b.tokens.remaining);
