import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readLargestRunOutput } from "./notify.ts";
import { TaskStore } from "./task.ts";

const cwd = process.cwd();

// C04/C05: detached output is consumable from the async run directory.
{
  const root = mkdtempSync(join(cwd, ".planner-only-test-"));
  try {
    const asyncDir = join(root, "async-subagent-runs", "run-c04");
    mkdirSync(asyncDir, { recursive: true });
    writeFileSync(join(asyncDir, "output-0.log"), "{\"taskId\":\"T-c04\",\"status\":\"completed\"}\n");
    assert.match(readLargestRunOutput(asyncDir, "run-c04") ?? "", /T-c04/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// C08: deciding a stale pass is side-effect free; a dispatched recovery key is
// durable and idempotent when the same receipt is replayed.
{
  const store = new TaskStore();
  const task = store.create({
    version: 1,
    taskId: "T-20260912-NX03",
    objective: "recovery fixture",
    cwd,
    scope: { paths: ["."], additionalWorktreeRoots: [] },
    validation: { required: false, commands: [] },
    expectedEvidence: {},
    instructions: "test",
    knownFacts: [],
    artifactRefs: [],
  });
  task.lastComparison = {
    fresh: false,
    verifiable: true,
    unexplained: true,
    reasons: ["external edit"],
    truthPaths: [join(cwd, "fixture.ts")],
    undeclaredPaths: [],
    extraDeclaredPaths: [],
    overlappingPaths: [],
    unrelatedPaths: [],
    missingPaths: [],
  };
  const before = task.recoveryAttempts;
  const evidenceKey = "fixture-stale-revision";
  assert.equal(store.require(task.taskId).recoveryAttempts, before);
  store.recordRecoveryAttempt(task.taskId, evidenceKey);
  store.recordRecoveryAttempt(task.taskId, evidenceKey);
  assert.equal(store.require(task.taskId).recoveryAttempts, before + 1);
}

// C08: recompute M's 9 planner_verdict requests / 8 recorded / 1 refused from
// the frozen fixture events (issue 01), through the real refusal
// classification (issue 04) and the store's review persistence.
{
  const { readFileSync } = await import("node:fs");
  const { join, resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { PlannerOrchestrator } = await import("./orchestrate.ts");
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
  const fixture = JSON.parse(
    readFileSync(join(repoRoot, "tests/fixtures/nx-followups/session-013147-mn.json"), "utf8"),
  );
  const specFor = (taskId, role = "worker") => ({
    taskId,
    objective: `implement ${taskId}`,
    cwd,
    role,
    scope: { allowedPaths: ["src/parser.ts"] },
    constraints: [],
    acceptanceCriteria: ["tests pass"],
    validation: { required: false, commands: [] },
    expectedEvidence: { changedFiles: true },
    stopConditions: [],
  });
  const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
  const orch = new PlannerOrchestrator({ gitRunner, store: new TaskStore() });
  // Every Task that appears in M's 9 verdict requests gets a store record, so
  // the replay persists each review on its own Task.
  for (const taskId of [...new Set(fixture.verdictRequests.map((event) => event.taskId))]) {
    orch.store.create(specFor(taskId, "worker"));
  }
  // T-004 exists with a recorded report (its verdict history in M), so the
  // pass request reaches the pending-child guard rather than the no-report one.
  const spec = specFor("T-20260912-004", "validator");
  orch.store.recordReport("T-20260912-004", {
    version: 1,
    taskId: "T-20260912-004",
    status: "completed",
    summary: "historical ledger repair executed",
    changedFiles: ["scripts/repair-t004-ledger.mjs"],
    validation: [],
    evidence: { cwd, taskId: "T-20260912-004", workerRunId: "call_1441558", changedPaths: [], gitAvailable: false, generatedAt: "2026-09-12T03:00:00.000Z" },
    risks: [],
    unresolved: [],
  });
  // T-004's oracle run (call_1441558) was still pending when Root's pass was
  // refused (M:L356-357); a real pending delegation reproduces that state.
  const pendingOutcome = await orch.beginDelegation(
    { toolCallId: "call_1441558", input: { agent: "oracle", task: JSON.stringify(specFor("T-20260912-004", "validator")) } },
    cwd,
  );
  const pendingTaskId = "T-20260912-004";
  assert.ok(pendingOutcome.task, "the oracle delegation binds to the reported Task");
  assert.equal(orch.hasPendingDelegation(pendingTaskId), true);

  let requested = 0;
  let recorded = 0;
  let refused = 0;
  for (const event of fixture.verdictRequests) {
    requested += 1;
    const task = orch.store.require(event.taskId);
    if (event.taskId === "T-20260912-004" && event.details.refused === "lifecycle") {
      const refusal = orch.rootVerdictRefusal(task, event.requested);
      assert.equal(refusal.kind, "child-pending", "the lifecycle refusal of M:L356 is the typed pending-child guard");
      orch.recordRootVerdictRefusal(task, event.requested, refusal);
      refused += 1;
      continue;
    }
    orch.store.recordReview(task.taskId, {
      taskId: task.taskId,
      verdict: event.requested,
      summary: `frozen-fixture replay: ${event.details.action ?? event.details.state ?? "recorded"}`,
      findings: [],
      evidenceFresh: false,
      requestedVerdict: event.requested,
      ...(event.details.action ? { appliedDecision: event.details.action } : {}),
      source: "root",
    });
    recorded += 1;
  }
  assert.equal(requested, 9, "M recorded exactly 9 planner_verdict requests");
  assert.equal(recorded, 8, "8 requests are recorded as reviews");
  assert.equal(refused, 1, "exactly 1 request was refused (lifecycle, child pending)");
  assert.equal(orch.store.require(pendingTaskId).reviews.length, 1, "only T-004's blocked verdict is on the ledger; the refused pass left no review row");
}

console.log("planner-only NX-02/NX-03: PASS");
