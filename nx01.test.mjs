import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  UsageLedger,
  emptyRootUsage,
  emptyTaskUsage,
  exportSessionEvidence,
  repairT004UsageRecords,
} from "./usage.ts";

const ROOT = "nx01-root-session";
const OLD = "historical-session";
const usage = (input, output, cost) => ({ input, output, cacheRead: 0, cacheWrite: 0, ...(cost === undefined ? {} : { cost: { total: cost } }) });

// C01: historical orphan harvest has no current-session child attribution and
// repeated ingestion is stable by run identity.
{
  const ledger = new UsageLedger({ pricing: { version: 1, currency: "USD", rates: {} } });
  for (let index = 0; index < 133; index += 1) {
    ledger.recordChild("unattributed", {
      runId: `historical-${index}`,
      kind: "worker",
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      pending: false,
      source: "meta-file",
      sessionHint: OLD,
      observedInSessionId: ROOT,
      unknownReason: "historical run has no trusted current-session binding",
    });
    ledger.recordChild("unattributed", {
      runId: `historical-${index}`,
      kind: "worker",
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      pending: false,
      source: "meta-file",
      sessionHint: OLD,
      observedInSessionId: ROOT,
    });
  }
  const orphan = ledger.taskUsage("unattributed");
  assert.equal(orphan.children.length, 133);
  assert.equal(ledger.taskUsage(ROOT), undefined);
  assert.equal(orphan.children.every((child) => child.observedInSessionId === ROOT), true);
  assert.equal(orphan.children.some((child) => child.unknownReason), true);
}

// C02: only the two named T-004 runs remain; all other T-023 replay children
// become standalone, traceable audit rows and a second pass does nothing.
{
  const children = ["7110bd1b", "143426ad", ...Array.from({ length: 119 }, (_, i) => `foreign-${i}`), "f032477d"]
    .map((runId) => ({ runId, kind: "worker", input: 2, output: 1, pending: false, source: "meta-file", transcriptPath: `/sessions/${runId}.jsonl` }));
  const result = repairT004UsageRecords([{ taskId: "T-20260912-004", children }]);
  const kept = result.records.find((record) => record.taskId === "T-20260912-004");
  const moved = result.records.filter((record) => record.taskId === "unattributed");
  assert.deepEqual(kept.children.map((child) => child.runId), ["7110bd1b", "143426ad"]);
  assert.equal(moved.length, 120);
  assert.equal(result.removedFromTask, 120);
  const replay = repairT004UsageRecords(result.records);
  assert.equal(replay.moved.length, 0);
  assert.equal(replay.records.filter((record) => record.taskId === "unattributed").length, 120);
  assert.equal(new Set(moved.flatMap((record) => record.children.map((child) => child.runId))).size, 120);
}

// C03: export consumes loose event rows, deduplicates the same child reported
// by three sources, and keeps tasked/untasked/shared/foreign/unknown exclusive.
{
  const taskId = "T-20260912-001";
  const taskUsage = {
    ...emptyTaskUsage(),
    root: { ...emptyRootUsage(), turns: 1, input: 10, output: 2, costUsd: 0.012 },
    children: [{ runId: "in-session-child", kind: "worker", input: 5, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.006, pending: false, source: "sync-details" }],
  };
  const entries = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `untasked-${index}`, kind: "root-turn", at: new Date().toISOString(), usage: usage(3, 1, 0.004), attribution: "untasked" })),
    ...["sync", "wait", "meta"].map((source) => ({ id: `source-${source}`, kind: "child", taskId: "unattributed", at: new Date().toISOString(), runId: "shared-run", child: { runId: "shared-run", kind: "worker", input: 7, output: 2, cacheRead: 0, cacheWrite: 0, costUsd: 0.01, pending: false, source: "meta-file", observedInSessionId: ROOT }, source })),
    { id: "foreign-child", kind: "child", taskId: "old-task", at: new Date().toISOString(), child: { runId: "external-run", kind: "worker", input: 9, output: 3, cacheRead: 0, cacheWrite: 0, costUsd: 0.02, pending: false, source: "meta-file", ownerRootSessionId: "foreign-root" } },
    { id: "unknown-child", kind: "child", taskId: "unattributed", at: new Date().toISOString(), child: { runId: "unknown-run", kind: "worker", input: 4, output: 1, cacheRead: 0, cacheWrite: 0, pending: false, source: "meta-file", unknownReason: "no trusted source" } },
  ];
  const exported = exportSessionEvidence({
    rootSessionId: ROOT,
    tasks: [{ taskId, rootSessionId: ROOT, state: "executing", usage: taskUsage }],
    usageEntries: entries,
  });
  assert.equal(exported.usage.buckets.tasked.tokens, 18);
  assert.equal(exported.usage.buckets.untaskedShared.count, 5 + 1);
  assert.equal(exported.usage.buckets.foreign.count, 1);
  assert.equal(exported.usage.buckets.unknown.count, 1);
  assert.equal(exported.usage.buckets.untaskedShared.costUsd, 0.01);
  assert.equal(exported.usage.buckets.foreign.costUsd, 0.02);
  assert.equal(exported.usage.buckets.unknown.unknownCost, true);
  const bucketTokens = Object.values(exported.usage.buckets).reduce((sum, bucket) => sum + bucket.tokens, 0);
  assert.equal(bucketTokens, exported.usage.tokens.input + exported.usage.tokens.output + exported.usage.tokens.cacheRead + exported.usage.tokens.cacheWrite);
}

console.log("planner-only NX-01: PASS");
