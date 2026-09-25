// Ticket 14 clause 2: with balance left over, does the SECOND concurrent child
// get exactly the remainder rather than a second full grant?
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";
import { emptyTaskUsage } from "../../../usage.ts";
const BASE = "/repo";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const store = new TaskStore({ now: () => new Date(2026, 8, 8) });
const orch = new PlannerOrchestrator({ store, gitRunner });
const s = { taskId: "T-20260908-P", objective: "partial", cwd: BASE, role: "worker",
	scope: { allowedPaths: ["src/a.ts"] }, constraints: [], acceptanceCriteria: ["t"],
	validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true }, stopConditions: [],
	cumulativeBudget: { tokens: 100000, costUsd: 1.0 } };
await orch.beginDelegation({ toolCallId: "seed", input: { task: JSON.stringify(s) } }, BASE);
const task = orch.store.get("T-20260908-P");
const u = emptyTaskUsage();
u.children.push({ kind: "worker", calls: 1, turns: 1, input: 48000, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0.1 });
task.usage = u;
await orch.handleSubagentResult({ toolCallId: "seed", output: JSON.stringify({ taskId: task.taskId,
	status: "completed", summary: "d", changedFiles: ["src/a.ts"],
	validation: [{ command: "npm test", passed: true, exitCode: 0 }] }) }, BASE);
console.log("P0 balance: tokens", 100000 - 48000, "(floor would ask for 40000)");
const a = { agent: "worker", task: "Fix T-20260908-P" };
await orch.prepareRoleDelegation(a);
const outA = await orch.beginDelegation({ toolCallId: "p-a", input: a }, BASE);
console.log("P1a outcome keys:", Object.keys(outA ?? {}), "| recorded:", orch.getDelegation("p-a") !== undefined, "| conflict:", String(outA?.conflict?.reason ?? "(none)").split("\n")[0]);
import("../../../usage.ts").then(m => console.log("P1b known tokens now:", m.summarizeTaskBudget(orch.store.get("T-20260908-P").usage, { tokens: 100000, costUsd: 1.0 }).tokens.known));
console.log("P1 first child granted:", JSON.stringify(a.usageBudget?.tokens), "| reservation held:", JSON.stringify(orch.reservations.inFlight("T-20260908-P")), "| reports on task:", orch.store.get("T-20260908-P").reports.length, "| bound task id:", orch.getDelegation("p-a")?.taskId);
const b = { agent: "worker", task: "Also fix T-20260908-P" };
await orch.prepareRoleDelegation(b);
const out = await orch.beginDelegation({ toolCallId: "p-b", input: b }, BASE);
console.log("P2 second child:", out?.block ? "REFUSED" : "granted " + JSON.stringify(b.usageBudget?.tokens));
console.log("P3 sum of grants:", (a.usageBudget?.tokens?.hard ?? 0) + (b.usageBudget?.tokens?.hard ?? 0), "vs balance 52000");
