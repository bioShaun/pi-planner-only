import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";
import { emptyTaskUsage } from "../../../usage.ts";
const BASE = "/repo";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const store = new TaskStore({ now: () => new Date(2026, 8, 8) });
const orch = new PlannerOrchestrator({ store, gitRunner });
const taskId = "T-20260908-904";
const spec = { taskId, objective: "rec", cwd: BASE, role: "worker", scope: { allowedPaths: ["src/a.ts"] },
	constraints: [], acceptanceCriteria: ["t"], validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true }, stopConditions: [],
	cumulativeBudget: { tokens: 50000, costUsd: 0.20 } };
await orch.beginDelegation({ toolCallId: "seed", input: { task: JSON.stringify(spec) } }, BASE);
console.log("D0 after seed, pendingDelegationCount:", orch.pendingDelegationCount());
const task = orch.store.get(taskId);
const usage = emptyTaskUsage();
usage.children.push({ kind: "worker", calls: 1, turns: 1, input: 40000, output: 8000, cacheRead: 0, cacheWrite: 0, costUsd: 0.19 });
task.usage = usage;
task.reports.push({ taskId, status: "completed", validation: [], changedFiles: [], summary: "x" });
const a = { agent: "worker", task: `Fix ${taskId}` };
await orch.prepareRoleDelegation(a);
const out1 = await orch.beginDelegation({ toolCallId: "retry-1", input: a }, BASE);
console.log("D1a retry-1 outcome keys:", Object.keys(out1 ?? {}), "conflict:", JSON.stringify(out1?.conflict)?.slice(0,200));
console.log("D1 after retry-1, pendingDelegationCount:", orch.pendingDelegationCount());
console.log("D2 delegations has retry-1:", orch.delegations?.has?.("retry-1"));
console.log("D3 inFlight:", JSON.stringify(orch.reservations?.inFlight?.(taskId)));
const b = { agent: "worker", task: `Again ${taskId}` };
await orch.prepareRoleDelegation(b);
const out = await orch.beginDelegation({ toolCallId: "retry-2", input: b }, BASE);
console.log("D4 outcome keys:", Object.keys(out ?? {}), JSON.stringify(out)?.slice(0, 400));
