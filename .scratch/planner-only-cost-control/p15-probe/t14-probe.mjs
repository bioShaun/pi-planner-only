// Ticket 14 planner probe: prove the pre-launch reservation seams by real run.
import assert from "node:assert/strict";
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore, createTaskSpec } from "../../../task.ts";
import { emptyTaskUsage, summarizeTaskBudget } from "../../../usage.ts";
import { resolveEffectiveLimits } from "../../../floors.ts";

const BASE = "/repo";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const store = new TaskStore({ now: () => new Date(2026, 8, 8) });

function specFor(taskId, extra = {}) {
	return {
		taskId,
		objective: `implement ${taskId}`,
		cwd: BASE,
		role: "worker",
		scope: { allowedPaths: ["src/a.ts"] },
		constraints: [],
		acceptanceCriteria: ["tests pass"],
		validation: { required: true, commands: ["npm test"] },
		expectedEvidence: { changedFiles: true, tests: true },
		stopConditions: [],
		...extra,
	};
}

// ---- P1: today, a Task with a nearly-exhausted cumulative budget still
// down-passes the full floor. This is the defect ticket 14 closes.
{
	const taskId = "T-20260908-901";
	const spec = createTaskSpec(specFor(taskId, { cumulativeBudget: { tokens: 50_000, costUsd: 0.20 } }));
	const orch = new PlannerOrchestrator({ store, gitRunner });
	const input = { task: JSON.stringify(spec) };
	await orch.beginDelegation({ toolCallId: "c1", input }, BASE);
	const task = orch.store.get(taskId);
	console.log("P1 task exists:", Boolean(task), "| spec.cumulativeBudget:", JSON.stringify(task?.spec?.cumulativeBudget));

	// Simulate 48k tokens / $0.19 already burned on this Task.
	const usage = emptyTaskUsage();
	usage.children.push({
		kind: "worker", calls: 1, turns: 1,
		input: 40_000, output: 8_000, cacheRead: 0, cacheWrite: 0,
		costUsd: 0.19,
	});
	task.usage = usage;
	const budget = summarizeTaskBudget(usage, task.spec.cumulativeBudget);
	console.log("P1 summarize:", JSON.stringify({
		tokens: budget.tokens, cost: budget.costUsd,
	}));

	// Second bounded delegation on the same Task.
	task.reports.push({ taskId, status: "completed" });
	const input2 = { agent: "builder", task: `Fix ${taskId}` };
	await orch.prepareRoleDelegation(input2);
	console.log("P1 second delegation usageBudget DOWN-PASSED:", JSON.stringify(input2.usageBudget));
	console.log("P1 remaining tokens was:", budget.tokens.remaining, " cost:", budget.costUsd.remaining);
}

// ---- P2: resolveEffectiveLimits has no balance candidate today.
{
	const limits = resolveEffectiveLimits({ role: "validator", reportsCount: 0 });
	console.log("P2 validator floors:", JSON.stringify(limits));
	console.log("P2 ResolveLimitsOptions keys accepted (no balance):", Object.keys(limits).join(","));
}

// ---- P3: block mechanism shape.
{
	const orch2 = new PlannerOrchestrator({ store: new TaskStore({ now: () => new Date(2026, 8, 8) }), gitRunner });
	const bad = { task: JSON.stringify(createTaskSpec(specFor("T-20260908-902", { validation: { required: true } }), )) };
	const outcome = await orch2.beginDelegation({ toolCallId: "c9", input: bad }, BASE);
	console.log("P3 block shape:", JSON.stringify(outcome.block ?? outcome).slice(0, 200));
}
