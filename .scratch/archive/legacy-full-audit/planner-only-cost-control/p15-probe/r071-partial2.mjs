// Clause 2 with the CANONICAL task id read back from the store, no id guessing.
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";
import { emptyTaskUsage, summarizeTaskBudget } from "../../../usage.ts";
const BASE = "/repo";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const store = new TaskStore({ now: () => new Date(2026, 8, 8) });
const orch = new PlannerOrchestrator({ store, gitRunner });
const LIMITS = { tokens: 100000, costUsd: 1.0 };
const s = { taskId: "T-20260908-P", objective: "partial", cwd: BASE, role: "worker",
	scope: { allowedPaths: ["src/a.ts"] }, constraints: [], acceptanceCriteria: ["t"],
	validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true }, stopConditions: [],
	cumulativeBudget: LIMITS };
await orch.beginDelegation({ toolCallId: "seed", input: { task: JSON.stringify(s) } }, BASE);
const taskId = orch.getDelegation("seed").taskId;          // canonical id
const task = orch.store.get(taskId);
console.log("Q0 canonical taskId:", taskId, "| cumulativeBudget carried:", JSON.stringify(task.spec.cumulativeBudget));
const u = emptyTaskUsage();
u.children.push({ kind: "worker", calls: 1, turns: 1, input: 48000, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0.1 });
task.usage = u;
task.reports.push({ taskId, status: "completed", validation: [], changedFiles: [], summary: "x" });
await orch.handleSubagentResult({ toolCallId: "seed", output: JSON.stringify({ taskId,
	status: "completed", summary: "d", changedFiles: ["src/a.ts"],
	validation: [{ command: "npm test", passed: true, exitCode: 0 }] }) }, BASE);
task.usage = u;
const bal = summarizeTaskBudget(task.usage, LIMITS);
console.log("Q1 known:", bal.tokens.known, "| balance:", bal.tokens.remaining, "| reports:", task.reports.length);
const a = { agent: "worker", task: `Fix ${taskId}` };
await orch.prepareRoleDelegation(a);
await orch.beginDelegation({ toolCallId: "p-a", input: a }, BASE);
console.log("Q2 first child granted:", JSON.stringify(a.usageBudget?.tokens),
	"| recorded:", orch.getDelegation("p-a") !== undefined,
	"| reservation:", JSON.stringify(orch.reservations.inFlight(taskId)));
const b = { agent: "worker", task: `Also fix ${taskId}` };
await orch.prepareRoleDelegation(b);
const out = await orch.beginDelegation({ toolCallId: "p-b", input: b }, BASE);
console.log("Q3 second child:", out?.block ? "REFUSED" : "granted " + JSON.stringify(b.usageBudget?.tokens));
const sum = (a.usageBudget?.tokens?.hard ?? 0) + (b.usageBudget?.tokens?.hard ?? 0);
console.log("Q4 sum of concurrent grants:", sum, "vs balance", bal.tokens.remaining,
	sum > bal.tokens.remaining ? "<< OVER-SUBSCRIBED" : "<< within balance");
