import assert from "node:assert/strict";
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";
import { emptyTaskUsage } from "../../../usage.ts";

const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
function pinnedStore() {
  const store = new TaskStore();
  store.now = () => new Date("2026-09-08T12:00:00.000Z");
  return store;
}
function specFor(taskId, role = "worker") {
  return {
    version: 1,
    taskId,
    role,
    objective: "x",
    scope: { cwd: "/tmp", allowedPaths: ["a.ts"] },
    acceptanceCriteria: ["ok"],
  };
}
function usageFixture(output = 0, costUsd) {
  const usage = emptyTaskUsage();
  usage.root = { ...usage.root, turns: output ? 1 : 0, output, ...(costUsd === undefined ? {} : { costUsd }) };
  return usage;
}
function budgetTaskFixture(taskId, cumulativeBudget, usage) {
  const store = pinnedStore();
  const task = store.create({ ...specFor(taskId), cumulativeBudget });
  task.usage = usage;
  return { store, task };
}

const stopped = budgetTaskFixture("T-20260908-16c-b10a", { tokens: 1, costUsd: 0.01 }, usageFixture(1, 0.01));
const ample = budgetTaskFixture("T-20260908-16c-b10b", { tokens: 1000, costUsd: 5 }, usageFixture(1, 0.01));
const a = await new PlannerOrchestrator({ gitRunner, store: stopped.store }).recordRootVerdict(stopped.task, "blocked", "same", { source: "root" });
const b = await new PlannerOrchestrator({ gitRunner, store: ample.store }).recordRootVerdict(ample.task, "blocked", "same", { source: "root" });
console.log(JSON.stringify({ a: a.task.state, b: b.task.state, aDecision: a.decision.action, bDecision: b.decision.action }));
try {
  assert.equal(a.task.state, b.task.state, "B10: stop does not alter the state machine");
  console.log("B10 STILL PASSED under narrow mutation — VACUOUS");
  process.exit(2);
} catch (err) {
  console.log("B10 FAILED under narrow mutation — NON-VACUOUS OK");
  console.log(String(err.message));
  process.exit(0);
}
