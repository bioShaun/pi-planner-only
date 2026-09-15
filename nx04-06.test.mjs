import assert from "node:assert/strict";
import {
  DEFAULT_EXPLORATION_BUDGET,
  ExplorationBudgetLedger,
  createExplorationProbeFixture,
  explorationProbeDelta,
  isExplorationToolCall,
} from "./floors.ts";
import { exportSessionEvidence } from "./usage.ts";
import { rootReadLimitNotice, applyRootReadCeiling, ROOT_READ_CEILING_LINES } from "./index.ts";

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



// C15: explicit oversized reads are rejected; omitted reads are normalized by
// the adapter to the stable 200-line ceiling (one named constant), and inputs
// that already name a limit or line range pass through untouched.
{
  assert.match(rootReadLimitNotice({ startLine: 1, endLine: 201 }) ?? "", /200/);
  assert.equal(rootReadLimitNotice({ startLine: 1, endLine: 200 }), undefined);
  assert.deepEqual(applyRootReadCeiling({ path: "a.ts" }), { path: "a.ts", limit: ROOT_READ_CEILING_LINES });
  assert.deepEqual(applyRootReadCeiling({ path: "a.ts", limit: 5 }), { path: "a.ts", limit: 5 });
}



console.log("planner-only NX-04/NX-05/NX-06: PASS");
