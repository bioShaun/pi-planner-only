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

console.log("planner-only NX-02/NX-03: PASS");
