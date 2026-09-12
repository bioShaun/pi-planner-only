import assert from "node:assert/strict";
import {
  DEFAULT_EXPLORATION_BUDGET,
  ExplorationBudgetLedger,
  createExplorationProbeFixture,
  explorationProbeDelta,
  isExplorationToolCall,
} from "./floors.ts";
import { buildAcceptanceEvidenceMatrix } from "./acceptance.ts";
import { exportSessionEvidence } from "./usage.ts";
import { rootReadLimitNotice, applyRootReadCeiling, ROOT_READ_CEILING_LINES } from "./index.ts";
import { ACCEPTANCE_CLAIMS } from "./acceptance-claims.ts";

// C10: retain raw calls and expose configured-vs-observed interception delta.
{
  const calls = [
    { toolName: "read", input: { path: "a.ts" }, result: "ok" },
    { toolName: "grep", input: { pattern: "budget" }, result: "ok" },
    { toolName: "find", input: { path: "." }, result: "ok" },
    { toolName: "ls", input: { path: "." }, result: "ok" },
    { toolName: "bash", input: { command: "cat a.ts" }, result: "ok" },
    { toolName: "bash", input: { command: "sed -n '1,4p' a.ts" }, batchSize: 2, result: "ok" },
  ];
  const fixture = createExplorationProbeFixture("loaded-nx04", calls, { soft: 4, hard: 5 });
  assert.equal(fixture.calls.length, 6);
  assert.equal(fixture.observed.eligibleCalls, 7);
  assert.equal(fixture.observed.batchCalls, 1);
  assert.equal(explorationProbeDelta(fixture).interceptionDelta, 0);
}

// C11/C12: accounting is keyed by execution, deduplicates replays, and does not
// charge writes or validation commands.
{
  const ledger = new ExplorationBudgetLedger();
  assert.equal(DEFAULT_EXPLORATION_BUDGET, 20);
  assert.equal(isExplorationToolCall("write", { path: "a.ts" }), false);
  let result = ledger.record({ executionId: "initial-execution", toolName: "bash", input: { command: "cat a.ts" }, eventId: "event-1", limit: 3 });
  assert.equal(result.budget.used, 1);
  result = ledger.record({ executionId: "initial-execution", toolName: "bash", input: { command: "npm test" }, eventId: "event-2", limit: 3 });
  assert.equal(result.budget.used, 1);
  result = ledger.record({ executionId: "initial-execution", toolName: "read", input: {}, eventId: "event-3", limit: 3 });
  assert.equal(result.budget.used, 2);
  assert.equal(ledger.record({ executionId: "initial-execution", toolName: "read", input: {}, eventId: "event-3", limit: 3 }).duplicate, true);
  assert.equal(ledger.record({ executionId: "correction-execution", toolName: "read", input: {}, eventId: "event-3", limit: 3 }).budget.used, 1);
  assert.match(ledger.record({ executionId: "initial-execution", toolName: "read", input: {}, eventId: "event-4", limit: 3 }).notice ?? "", /wrap up|reached/i);
}

// C13/C14: the evidence matrix distinguishes 代码完成 / handler 验证 / 宿主验证,
// refuses upgrades over missing provenance (L143), and tracks all
// criteria/behaviors independently, including report revisions.
{
  const matrix = buildAcceptanceEvidenceMatrix({
    sourcePath: "index.ts",
    loadedFingerprint: "fp",
    diskHead: "head",
    rootSessionId: "session",
    runIds: ["run-1"],
    executionIds: ["execution-1"],
    criteria: { C13: { status: "handler-verified", evidence: ["git_commit fixture"] }, C14: "host-verified" },
  });
  assert.equal(matrix.length, 42);
  assert.equal(matrix.find((item) => item.id === "C13")?.status, "handler-verified");
  assert.equal(matrix.find((item) => item.id === "B24")?.status, "unproven");
  assert.match(matrix.find((item) => item.id === "C14")?.evidence.join(" ") ?? "", /rootSessionId=session/);

  // L143 — 任一缺失不能升格: a claimed host pass without full provenance and a
  // handler claim without handler evidence are recorded as code-complete with
  // an explicit downgrade note, never as verified. An unproven entry can carry
  // an explicit not-done reason (C17).
  const downgraded = buildAcceptanceEvidenceMatrix({
    criteria: {
      C01: "host-verified",
      C02: { status: "handler-verified" },
      C03: { status: "unproven", notDoneReason: "frozen fixture pending" },
    },
  });
  const c01 = downgraded.find((item) => item.id === "C01");
  assert.equal(c01?.status, "implemented");
  assert.equal(c01?.downgradedFrom, "host-verified");
  assert.match(c01?.evidence.join(" ") ?? "", /missing sourcePath/);
  const c02 = downgraded.find((item) => item.id === "C02");
  assert.equal(c02?.status, "implemented");
  assert.equal(c02?.downgradedFrom, "handler-verified");
  const c03 = downgraded.find((item) => item.id === "C03");
  assert.equal(c03?.status, "unproven");
  assert.equal(c03?.notDoneReason, "frozen fixture pending");
}

// C15: explicit oversized reads are rejected; omitted reads are normalized by
// the adapter to the stable 200-line ceiling (one named constant), and inputs
// that already name a limit or line range pass through untouched.
{
  assert.match(rootReadLimitNotice({ startLine: 1, endLine: 201 }) ?? "", /200/);
  assert.equal(rootReadLimitNotice({ startLine: 1, endLine: 200 }), undefined);
  assert.deepEqual(applyRootReadCeiling({ path: "a.ts" }), { path: "a.ts", limit: ROOT_READ_CEILING_LINES });
  assert.deepEqual(applyRootReadCeiling({ path: "a.ts", limit: 5 }), { path: "a.ts", limit: 5 });
}

// C17: the shipped claims table covers every C/B entry; handler-verified
// claims always carry evidence (the acceptance gate would downgrade them
// otherwise), host-pending entries record the reason, and no claim claims a
// host pass.
{
  const claimed = buildAcceptanceEvidenceMatrix({ criteria: ACCEPTANCE_CLAIMS.criteria, behaviors: ACCEPTANCE_CLAIMS.behaviors });
  const claimFor = (id) => claimed.find((entry) => entry.id === id);
  assert.equal(claimed.length, 42);
  assert.equal(claimed.every((entry) => entry.downgradedFrom === undefined), true, "no claim is downgraded: handler claims all carry evidence and nothing claims host-verified");
  for (const id of ["C01", "C02", "C03", "C07", "C08", "C09", "C17"]) {
    assert.equal(claimFor(id)?.status, "handler-verified", `${id} is handler-verified`);
    assert.ok(claimFor(id).evidence.length > 1, `${id} cites concrete offline evidence`);
    assert.equal(claimFor(id).notDoneReason, undefined, `${id} needs no host run`);
  }
  for (const id of ["C04", "C05", "C06"]) {
    assert.equal(claimFor(id)?.status, "handler-verified", `${id} keeps its handler evidence`);
    assert.equal(claimFor(id)?.notDoneReason, "host-run-pending", `${id} waits for the host session`);
  }
  for (const id of ["C10", "C11", "C12", "C13", "C14", "C15", "C16", "C18"]) {
    assert.equal(claimFor(id)?.status, "implemented", `${id} is code-complete only`);
    assert.equal(claimFor(id)?.notDoneReason, "host-run-pending", `${id} waits for the host session`);
  }
  for (let index = 1; index <= 24; index += 1) {
    const id = `B${String(index).padStart(2, "0")}`;
    const entry = claimFor(id);
    assert.ok(["implemented", "handler-verified"].includes(entry?.status), `${id} is mapped`);
    assert.equal(entry?.notDoneReason, "host-run-pending", `${id} host replay is pending`);
  }
}

// C16-C18: export remains machine-readable and conserves the unique usage rows.
{
  const exported = exportSessionEvidence({
    rootSessionId: "session-nx06",
    sourceFingerprint: "fp-nx06",
    tasks: [{ taskId: "T-nx06", rootSessionId: "session-nx06", state: "completed", reports: [], usage: { root: { input: 2, output: 1, turns: 1 }, children: [] } }],
    runRecords: [{ rootSessionId: "session-nx06", taskId: "T-nx06", executionId: "execution-nx06", runId: "run-nx06", ingestionState: "recorded" }],
    usageEntries: [{ id: "root-nx06", kind: "root-turn", attribution: "tasked", taskId: "T-nx06", usage: { input: 2, output: 1 } }],
    acceptance: { sourcePath: "index.ts", loadedFingerprint: "fp-nx06", diskHead: "head-nx06", rootSessionId: "session-nx06", executionIds: ["execution-nx06"], criteria: { C16: "host-verified", C18: { status: "handler-verified", evidence: ["usage export conservation fixture"] } } },
  });
  assert.equal(exported.rootSessionId, "session-nx06");
  // Full host provenance: the host-verified claim survives the upgrade gate.
  assert.equal(exported.evidenceMatrix.find((item) => item.id === "C16")?.status, "host-verified");
  const c18 = exported.evidenceMatrix.find((item) => item.id === "C18");
  assert.equal(c18?.status, "handler-verified");
  assert.match(c18?.evidence.join(" ") ?? "", /usage export conservation fixture/);
  assert.equal(exported.usage.tokens.input, 2);
  assert.equal(exported.usage.tokens.output, 1);
}

console.log("planner-only NX-04/NX-05/NX-06: PASS");
