// End-to-end: does the payload that actually launches get clamped to the balance?
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";
import { emptyTaskUsage, summarizeTaskBudget } from "../../../usage.ts";

const BASE = "/repo";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const store = new TaskStore({ now: () => new Date(2026, 8, 8) });
const orch = new PlannerOrchestrator({ store, gitRunner });
const taskId = "T-20260908-903";
const spec = {
	taskId, objective: "clamp probe", cwd: BASE, role: "worker",
	scope: { allowedPaths: ["src/a.ts"] }, constraints: [],
	acceptanceCriteria: ["tests pass"],
	validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true }, stopConditions: [],
	cumulativeBudget: { tokens: 50000, costUsd: 0.20 },
};
await orch.beginDelegation({ toolCallId: "seed", input: { task: JSON.stringify(spec) } }, BASE);
const task = orch.store.get(taskId);
const usage = emptyTaskUsage();
usage.children.push({ kind: "worker", calls: 1, turns: 1, input: 40000, output: 8000, cacheRead: 0, cacheWrite: 0, costUsd: 0.19 });
task.usage = usage;
task.reports.push({ taskId, status: "completed", validation: [], changedFiles: [], summary: "x" });
const b = summarizeTaskBudget(usage, task.spec.cumulativeBudget);
console.log("C0 balance: tokens", b.tokens.remaining, "cost", b.costUsd.remaining.toFixed(4));

const a = { agent: "worker", task: `Fix ${taskId}` };
await orch.prepareRoleDelegation(a);
await orch.beginDelegation({ toolCallId: "retry-1", input: a }, BASE);
console.log("C1 first retry LAUNCHED with:", JSON.stringify(a.usageBudget));

const c = { agent: "worker", task: `Also fix ${taskId}` };
await orch.prepareRoleDelegation(c);
const r = await orch.beginDelegation({ toolCallId: "retry-2", input: c }, BASE);
console.log("C2 concurrent second retry:", r?.block ? "REFUSED\n" + String(r.block.reason).split("\n").map(l=>"    "+l).join("\n") : "granted " + JSON.stringify(c.usageBudget));
