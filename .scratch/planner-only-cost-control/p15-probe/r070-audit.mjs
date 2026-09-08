// Do V6 and V10 pass for the reason the ticket intended?
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";
import { emptyTaskUsage } from "../../../usage.ts";
const BASE = "/repo";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const mk = () => new TaskStore({ now: () => new Date(2026, 8, 8) });
const spec = (taskId, role = "worker", extra = {}) => ({
	taskId, objective: "audit", cwd: BASE, role, scope: { allowedPaths: ["src/a.ts"] },
	constraints: [], acceptanceCriteria: ["t"], validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true }, stopConditions: [], ...extra });
const burn = (t, c) => { const u = emptyTaskUsage(); u.children.push({ kind: "worker", calls: 1, turns: 1, input: t, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: c }); return u; };

// --- V6: what is the second call actually blocked on?
{
	const store = mk(); const orch = new PlannerOrchestrator({ store, gitRunner });
	const s = spec("T-20260908-a6", "worker", { cumulativeBudget: { tokens: 50000, costUsd: 0.20 } });
	await orch.beginDelegation({ toolCallId: "a6-seed", input: { task: JSON.stringify(s) } }, BASE);
	const task = orch.store.get("T-20260908-a6");
	task.usage = burn(48000, 0.19);
	task.reports.push({ taskId: task.taskId, status: "completed", validation: [], changedFiles: [], summary: "x" });
	await orch.handleSubagentResult({ toolCallId: "a6-seed", output: JSON.stringify({ taskId: task.taskId, status: "completed", summary: "d", changedFiles: ["src/a.ts"], validation: [{ command: "npm test", passed: true, exitCode: 0 }] }) }, BASE);
	const a = await orch.beginDelegation({ toolCallId: "a6-a", input: { task: JSON.stringify(s) } }, BASE);
	const b = await orch.beginDelegation({ toolCallId: "a6-b", input: { task: JSON.stringify(s) } }, BASE);
	console.log("V6 first call keys:", Object.keys(a ?? {}));
	console.log("V6 second call block reason first line:", String(b?.block?.reason ?? "(no block)").split("\n")[0]);
}
// --- V10: does a reviewer on an exhausted task reach the guard at all?
{
	const store = mk(); const orch = new PlannerOrchestrator({ store, gitRunner });
	const s = spec("T-20260908-a10", "worker", { cumulativeBudget: { tokens: 1, costUsd: 0.01 } });
	await orch.beginDelegation({ toolCallId: "a10-seed", input: { task: JSON.stringify(s) } }, BASE);
	const task = orch.store.get("T-20260908-a10");
	task.usage = burn(5000, 0.50);   // far past the ceiling
	const rev = { agent: "reviewer", task: `Review ${task.taskId}` };
	const out = await orch.beginDelegation({ toolCallId: "a10-rev", input: rev }, BASE);
	console.log("V10 reviewer outcome keys:", Object.keys(out ?? {}), "block:", String(out?.block?.reason ?? "(none)").split("\n")[0]);
	console.log("V10 reviewer usageBudget written into payload:", JSON.stringify(rev.usageBudget));
	console.log("V10 reservation held after reviewer:", JSON.stringify(orch.reservations?.inFlight?.(task.taskId)));
}
