import test from "node:test";
import assert from "node:assert/strict";
import { EVENT_FIXTURES } from "./test-fixtures.ts";
import { exportSessionEvidence } from "./usage.ts";

const ROOT = "root-session-rs05";

function task(overrides = {}) {
  return {
    taskId: "T-20260912-001",
    state: "completed",
    usage: {
      root: { input: 10, output: 4, cacheRead: 2, cacheWrite: 1, turns: 1, costUsd: 0.01 },
      children: [{ kind: "worker", input: 5, output: 2, cacheRead: 0, cacheWrite: 1, turns: 1, costUsd: 0.02, runId: "host-run-1" }],
    },
    executions: [{ executionId: "execution-1", runId: "host-run-1", reportIndex: 0, childSessionFile: "/sessions/child-1/session.jsonl" }],
    reports: [{ status: "completed" }],
    reviews: [{ verdict: "pass", findings: [], source: "operator" }],
    findings: [{ id: "finding-1", kind: "undeclared", executionId: "execution-1", paths: ["src/a.ts"], status: "open" }],
    ...overrides,
  };
}

test("A19: export reproduces frozen E01-E05 statistics and separates history", () => {
  const fixtureTasks = EVENT_FIXTURES.e01.newFindings.map((finding, index) => ({
    taskId: finding.taskId,
    rootSessionId: ROOT,
    findings: [{ id: `finding-${index}`, kind: "undeclared", executionId: `execution-${index}`, paths: finding.paths }, ...(index === 0 ? [{ id: "finding-0", kind: "undeclared", executionId: "execution-0", paths: finding.paths }] : [])],
  }));
  const evidence = exportSessionEvidence({ rootSessionId: ROOT, fixtures: EVENT_FIXTURES, tasks: fixtureTasks });
  assert.equal(evidence.findings.total, 4);
  assert.equal(evidence.findings.duplicateNotifications, 1);
  assert.equal(evidence.interceptions.total, 36);
  assert.equal(evidence.interceptions.runs, 12);
  assert.equal(evidence.interceptions.processFailures, 2);
  assert.equal(evidence.interceptions.providerErrors, 2);
  assert.equal(evidence.findings.new, 4);
  assert.equal(evidence.findings.historical, 1);
  assert.match(evidence.analysis.join("\n"), /4 new finding\(s\); 1 historical event/);
  assert.match(evidence.analysis.join("\n"), /36 tool interception/);
  assert.equal(evidence.requirements.find((item) => item.id === "A19")?.status, "unit-verified");
});

test("A20: export explains mixed workspace and premature launch records", () => {
  const evidence = exportSessionEvidence({ rootSessionId: ROOT, fixtures: EVENT_FIXTURES });
  assert.ok(evidence.unattributed.some((item) => item.type === "cross-workspace-run"));
  assert.match(evidence.analysis.join("\n"), /cross-workspace/);
  assert.match(evidence.analysis.join("\n"), /launch receipt/);
  assert.equal(evidence.linkage.length, 0, "fixture-only records cannot fabricate Task linkage");
  assert.equal(evidence.requirements.find((item) => item.id === "A20")?.status, "unit-verified");
});

test("A21: persisted run state reaches the final multi-dimensional payload", () => {
  const evidence = exportSessionEvidence({
    rootSessionId: ROOT,
    sourceFingerprint: "source-fingerprint",
    tasks: [task()],
    runRecords: [{
      sessionId: ROOT,
      workspaceId: "/workspace",
      taskId: "T-20260912-001",
      executionId: "execution-1",
      toolCallId: "call-1",
      runId: "host-run-1",
      childSessionFile: "/sessions/child-1/session.jsonl",
      reportRevision: 1,
      loadedProvenance: { loadedFingerprint: "loaded-fingerprint" },
      exitCode: 0,
      executionState: "terminal",
      ingestionState: "recorded",
    }],
  });
  assert.deepEqual(evidence.linkage[0], {
    rootSessionId: ROOT,
    toolCallId: "call-1",
    hostRunId: "host-run-1",
    childSessionFile: "/sessions/child-1/session.jsonl",
    taskId: "T-20260912-001",
    executionId: "execution-1",
    reportRevision: 1,
    loadedFingerprint: "loaded-fingerprint",
    sourceFingerprint: "source-fingerprint",
    workerReportStatus: "completed",
    reviewResultVerdict: "pass",
    taskState: "completed",
    rootVerdict: "pass",
    statusCategory: "accepted",
    retryable: false,
    processExitCode: 0,
    ingestionState: "recorded",
  });
  assert.equal(evidence.statuses.processExit["0"], 1);
  assert.equal(evidence.statuses.ingestion.recorded, 1);
  assert.equal(evidence.statuses.workerReport.completed, 1);
  assert.equal(evidence.statuses.reviewResult.pass, 1);
  assert.equal(evidence.statuses.task.completed, 1);
  assert.equal(evidence.statuses.rootVerdict.pass, 1);
  assert.equal(evidence.statuses.category.accepted, 1);
  assert.deepEqual(evidence.usage.tokens, { input: 15, output: 6, cacheRead: 2, cacheWrite: 2 });
  assert.equal(evidence.requirements.find((item) => item.id === "A21")?.status, "unproven");
});

console.log("planner-only RS-05 export regressions: PASS");
