import assert from "node:assert/strict";
import { PlannerOrchestrator, classifyHostAction } from "./orchestrate.ts";
import { TaskStore, createTaskSpec } from "./task.ts";

const cwd = "/rr05";
const now = () => new Date("2026-09-05T00:00:00.000Z");
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const evidence = (taskId, workerRunId) => ({
  cwd, taskId, workerRunId, gitAvailable: false,
  generatedAt: now().toISOString(),
});
const report = (taskId, workerRunId) => ({
  version: 1, taskId, status: "completed", summary: "ok", changedFiles: [],
  validation: [], evidence: evidence(taskId, workerRunId), risks: [], unresolved: [],
});
function setup() {
  const store = new TaskStore({ now });
  const task = store.create(createTaskSpec({ taskId: "T-20260905-905", objective: "resume", cwd, role: "worker" }));
  store.beginExecution(task.taskId, {
    executionId: "old-execution", kind: "worker", cwd, worktreeRoots: [cwd],
    aRun: evidence(task.taskId, "old-execution"), runId: "old-run",
  });
  return { store, task, orch: new PlannerOrchestrator({ store, gitRunner }) };
}

assert.equal(classifyHostAction({ action: "status" }), "management");
assert.equal(classifyHostAction({ action: "interrupt" }), "control");
assert.equal(classifyHostAction({ action: "resume" }), "execution");

// C13: resume is admitted against the exact old run and creates a linked execution.
{
  const { orch, store, task } = setup();
  const admitted = await orch.beginDelegation({ toolCallId: "resume-call", input: { action: "resume", id: "old-run" } }, cwd);
  assert.equal(admitted.block, undefined);
  const delegation = orch.getDelegation("resume-call");
  assert.equal(delegation?.taskId, task.taskId);
  assert.equal(delegation?.previousRunId, "old-run");
  assert.notEqual(delegation?.executionId, "old-execution");
  await orch.handleSubagentResult({
    toolCallId: "resume-call", content: [{ type: "text", text: JSON.stringify(report(task.taskId, "new-run")) }],
    details: { runId: "new-run", previousRunId: "old-run", terminal: { state: "completed" } }, isError: false,
  });
  const current = store.require(task.taskId);
  assert.equal(current.reports.length, 1);
  assert.equal(current.executions.at(-1)?.runId, "new-run");
  assert.equal(current.executions.at(-1)?.previousRunId, "old-run");
}

// C14: unbound resume and failed launch do not touch the old execution or hold a reservation.
{
  const { orch, store, task } = setup();
  const before = structuredClone(store.require(task.taskId));
  const unbound = await orch.beginDelegation({ toolCallId: "unknown-resume", input: { action: "resume", id: "missing" } }, cwd);
  assert.match(unbound.block?.reason ?? "", /RUN_UNBOUND/);
  assert.deepEqual(store.require(task.taskId), before);
  await orch.beginDelegation({ toolCallId: "failed-resume", input: { action: "resume", id: "old-run" } }, cwd);
  await orch.handleSubagentResult({
    toolCallId: "failed-resume", content: [{ type: "text", text: "failed to launch" }], isError: true,
  });
  assert.equal(store.require(task.taskId).executions[0]?.runId, "old-run");
  assert.equal(store.require(task.taskId).executions.length, 2);
  assert.equal(orch.pendingDelegationCount(), 0);
}

// C15: the old run cannot be routed after the new execution is consumed.
{
  const { orch, store, task } = setup();
  await orch.beginDelegation({ toolCallId: "resume-current", input: { action: "resume", id: "old-run" } }, cwd);
  await orch.handleSubagentResult({
    toolCallId: "resume-current", content: [{ type: "text", text: JSON.stringify(report(task.taskId, "new-run")) }],
    details: { runId: "new-run", terminal: { state: "completed" } }, isError: false,
  });
  const count = store.require(task.taskId).reports.length;
  assert.equal(await orch.handleAsyncNotify("Background task completed: **worker**\n{\"taskId\":\"" + task.taskId + "\"}"), undefined);
  assert.equal(store.require(task.taskId).reports.length, count);
}

// C16: report-only records a read-only repair and interrupt acknowledgement keeps its writer.
{
  const { orch, store, task } = setup();
  const repairInput = { agent: "worker", reportOnly: true, task: JSON.stringify({ ...task.spec, reportOnly: true }) };
  const repair = await orch.beginDelegation({
    toolCallId: "repair-call", input: repairInput,
  }, cwd);
  assert.equal(repair.block, undefined);
  assert.equal(orch.getDelegation("repair-call")?.readOnlyRepair, true);
  assert.equal(repairInput.agent, "reviewer");
  const asyncStart = await orch.handleSubagentResult({
    toolCallId: "repair-call", content: [{ type: "text", text: "started" }], details: { asyncId: "repair-run" }, isError: false,
  });
  assert.match(asyncStart?.content[0]?.text ?? "", /started/);
  const interrupted = await orch.handleSubagentResult({
    toolCallId: "repair-call", content: [{ type: "text", text: "interrupt requested" }], isError: false,
  });
  assert.match(interrupted?.content[0]?.text ?? "", /terminal evidence/);
  assert.equal(orch.pendingDelegationCount(), 1);
  assert.equal(store.require(task.taskId).executions.length, 2);
}

console.log("planner-only RR-05: PASS");
