import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { childFromMeta, readChildMeta } from "./notify.ts";
import {
  UsageLedger,
  emptyRootUsage,
  emptyTaskUsage,
  exportSessionEvidence,
  repairT004UsageRecords,
} from "./usage.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const fixture = JSON.parse(
  readFileSync(join(repoRoot, "tests/fixtures/nx-followups/session-013147-mn.json"), "utf8"),
);
const M = fixture.sessions.M;
const N = fixture.sessions.N;
const pricing = { version: 1, currency: "USD", rates: {} };
// Same mapping as the adapter's AGENT_KIND (index.ts).
const AGENT_KIND = { worker: "worker", oracle: "validator", reviewer: "reviewer", explorer: "explorer", scout: "explorer" };
const META_FILE_RE = /^(.*)_(worker|oracle|reviewer|explorer|scout)(?:_0)?_meta\.json$/;

/**
 * harvestOrphanMetas replay (index.ts): the real handler primitives over real
 * frozen meta files — readdir order, ledgerHasRunId guard, readChildMeta,
 * childFromMeta with the scan-time observed session, recordChild to the
 * resolved target. A fresh session has no launches, so every historical run
 * resolves to "unattributed".
 */
function harvestOrphanMetas(artifactsDir, ledger, observedInSessionId) {
  const seen = new Set();
  let harvested = 0;
  for (const name of readdirSync(artifactsDir).sort()) {
    const match = META_FILE_RE.exec(name);
    if (!match) continue;
    const runId = match[1];
    const agent = match[2];
    if (seen.has(runId)) continue;
    const meta = readChildMeta([artifactsDir], runId, agent);
    if (!meta?.usage) continue;
    const child = childFromMeta(meta, AGENT_KIND[agent] ?? "worker", observedInSessionId);
    if (!child) continue;
    ledger.recordChild("unattributed", child);
    seen.add(runId);
    harvested += 1;
  }
  return harvested;
}

// ---------------------------------------------------------------------------
// C01: replay N (0 launches + 133 historical metas). Current-session child
// usage stays 0, original owners are not rewritten, unknown stays unknown with
// its reason, and neither an immediate rescan nor a cross-process
// restore-then-rescan records anything twice.
// ---------------------------------------------------------------------------
const artifactsDir = (() => {
  const root = mkdtempSync(join(tmpdir(), "planner-only-nx01-"));
  const dir = join(root, "subagent-artifacts");
  mkdirSync(dir, { recursive: true });
  for (const meta of fixture.historicalMeta) {
    writeFileSync(join(dir, meta.metaPath), JSON.stringify(meta), "utf8");
  }
  return dir;
})();

const ledgerA = new UsageLedger({ pricing });
assert.equal(harvestOrphanMetas(artifactsDir, ledgerA, N.rootSessionId), 133, "every frozen meta is harvested exactly once");
{
  const unattributed = ledgerA.taskUsage("unattributed");
  assert.equal(unattributed.children.length, 133);
  assert.equal(new Set(unattributed.children.map((child) => child.runId)).size, 133, "unique runIds only");
  // C01 — N's child usage is 0: the historical runs never become this
  // session's usage, and the scan provenance is observation, not ownership.
  assert.equal(ledgerA.taskUsage(N.rootSessionId), undefined);
  assert.equal(unattributed.children.every((child) => child.observedInSessionId === N.rootSessionId), true);
  assert.equal(unattributed.children.every((child) => child.ownerRootSessionId === undefined), true, "no owner is manufactured for historical runs");
  // The old build stamped every child with N's own session hint; the trusted
  // source session derives from the run's own transcript path instead.
  assert.equal(unattributed.children.every((child) => child.sessionHint !== undefined && child.sessionHint !== N.stem), true);
  // unknown has a reason: a real meta stripped of its provenance fields stays
  // unknown instead of being guessed into a Task or session.
  const stripped = { ...fixture.historicalMeta[0] };
  for (const key of ["transcriptPath", "childSessionFile", "sourceDir", "sourceSessionId", "sessionId", "metaPath"]) delete stripped[key];
  const unknownChild = childFromMeta(stripped, "worker", N.rootSessionId);
  assert.equal(unknownChild.unknownReason, "no trusted source session in child metadata or meta location");
  assert.equal(unknownChild.sessionHint, undefined);
  // Immediate rescan (re-recording without the skip guard) is deduplicated by
  // run identity, not by double bookkeeping.
  for (const meta of fixture.historicalMeta) {
    const child = childFromMeta(meta, AGENT_KIND[meta.agent] ?? "worker", N.rootSessionId);
    ledgerA.recordChild("unattributed", child);
  }
  assert.equal(ledgerA.taskUsage("unattributed").children.length, 133, "rescan does not duplicate");
}

// Cross-process restore → rescan: a second process loads the persisted usage
// entries into a fresh ledger and rescans the same artifacts directory.
{
  const entries = ledgerA.drain();
  const handoffPath = join(artifactsDir, "..", "nx01-handoff.json");
  const resultPath = join(artifactsDir, "..", "nx01-rescan-result.json");
  writeFileSync(handoffPath, JSON.stringify({ entries, artifactsDir, observedInSessionId: N.rootSessionId, resultPath }), "utf8");
  const helper = `
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const [repo, handoffPath] = process.argv.slice(2);
const { readChildMeta, childFromMeta } = await import(\`\${repo}/notify.ts\`);
const { UsageLedger } = await import(\`\${repo}/usage.ts\`);
const AGENT_KIND = { worker: "worker", oracle: "validator", reviewer: "reviewer", explorer: "explorer", scout: "explorer" };
const META_FILE_RE = /^(.*)_(worker|oracle|reviewer|explorer|scout)(?:_0)?_meta\\.json$/;
const handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
const ledger = new UsageLedger({ pricing: { version: 1, currency: "USD", rates: {} } });
ledger.load(handoff.entries);
let harvested = 0;
const seen = new Set();
for (const name of readdirSync(handoff.artifactsDir).sort()) {
  const match = META_FILE_RE.exec(name);
  if (!match) continue;
  const [runId, agent] = [match[1], match[2]];
  if (seen.has(runId)) continue;
  seen.add(runId);
  const meta = readChildMeta([handoff.artifactsDir], runId, agent);
  if (!meta?.usage) continue;
  const child = childFromMeta(meta, AGENT_KIND[agent] ?? "worker", handoff.observedInSessionId);
  if (!child) continue;
  ledger.recordChild("unattributed", child);
  harvested += 1;
}
const children = ledger.taskUsage("unattributed")?.children ?? [];
writeFileSync(handoff.resultPath, JSON.stringify({
  harvested,
  children: children.length,
  uniqueRunIds: new Set(children.map((child) => child.runId)).size,
  currentSessionUsage: ledger.taskUsage(handoff.observedInSessionId) ?? null,
}));
`;
  const helperPath = join(artifactsDir, "..", "nx01-rescan-helper.mjs");
  writeFileSync(helperPath, helper, "utf8");
  const spawned = spawnSync(process.execPath, ["--experimental-strip-types", helperPath, repoRoot, handoffPath], { encoding: "utf8" });
  assert.equal(spawned.status, 0, `cross-process rescan failed: ${spawned.stderr}`);
  const rescan = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.equal(rescan.harvested, 133, "the restored process rescans every meta again");
  assert.equal(rescan.children, 133, "restore → rescan across processes records nothing twice");
  assert.equal(rescan.uniqueRunIds, 133);
  assert.equal(rescan.currentSessionUsage, null, "the current session still has no child usage after restart");
}

// ---------------------------------------------------------------------------
// C02: replay T-023's 121 real children — 120 foreign runs plus exactly one
// in-session run (f032477d) wrongly bound; T-004's two original runs stay on
// T-004; the repair is idempotent and an interrupted-then-resumed run converges
// to the one-shot result with a traceable audit trail.
// ---------------------------------------------------------------------------
{
  const t023RunIds = fixture.t023BackfillEvents.map((event) => event.runId);
  const mRunIds = new Set(fixture.mInSessionRuns.map((run) => run.runId));
  assert.equal(t023RunIds.length, 121);
  const foreignToM = t023RunIds.filter((runId) => !mRunIds.has(runId));
  assert.equal(foreignToM.length, 120, "120 of the 121 backfilled runs are outside M");
  assert.deepEqual(t023RunIds.filter((runId) => mRunIds.has(runId)), fixture.wrongTaskRunIds, "f032477d is the one in-session run, and it belongs to T-022");
  assert.ok(fixture.t004KeepRunIds.every((runId) => foreignToM.includes(runId)), "T-004's originals are foreign to M but must stay on T-004");

  // T-004's polluted ledger: its two original runs plus all of T-023's
  // backfill (deduplicated by runId — the two originals are among the 121).
  const metaByRunId = new Map(fixture.historicalMeta.map((meta) => [meta.runId, meta]));
  const childOfKeepRun = (runId) => childFromMeta(metaByRunId.get(runId), "worker");
  const t023Children = fixture.t023BackfillEvents.map((event) => ({ ...event.child, runId: event.runId }));
  const input = [{
    taskId: "T-20260912-004",
    children: [
      ...fixture.t004KeepRunIds.map((runId) => childOfKeepRun(runId)),
      ...t023Children,
    ].filter((child, index, all) => all.findIndex((other) => other.runId === child.runId) === index),
  }];
  assert.equal(input[0].children.length, 121, "the polluted record holds 121 unique runs");

  // The repair keeps T-004's two original runs — named by their full run ids
  // here (the shipped default list uses the documented 8-char prefixes).
  const repairOptions = { allowedRunIds: fixture.t004KeepRunIds };
  const oneShot = repairT004UsageRecords(input, repairOptions);
  const kept = oneShot.records.find((record) => record.taskId === "T-20260912-004");
  const moved = oneShot.records.filter((record) => record.taskId === "unattributed");
  assert.deepEqual(kept.children.map((child) => child.runId).sort(), [...fixture.t004KeepRunIds].sort(), "only T-004's two originals are kept");
  assert.equal(moved.length, 119);
  assert.equal(oneShot.removedFromTask, 119);
  assert.equal(new Set(moved.flatMap((record) => record.children.map((child) => child.runId))).size, 119, "every moved run is traceable exactly once");
  assert.equal(oneShot.moved.every((entry) => typeof entry.sessionHint === "string" && entry.sessionHint.length > 0), true, "each moved child keeps a session hint");

  // Repeat execution adds no second migration (the recovery contract).
  const replay = repairT004UsageRecords(oneShot.records, repairOptions);
  assert.equal(replay.moved.length, 0);
  assert.equal(replay.records.filter((record) => record.taskId === "unattributed").length, 119);

  // Interrupted run: repair a half-recorded ledger snapshot, then resume with
  // the remaining children; the final state must equal the one-shot result.
  const firstHalf = t023Children.slice(0, 60);
  const secondHalf = t023Children.slice(60);
  const uniqueChildren = (children) => children.filter((child, index, all) => all.findIndex((other) => other.runId === child.runId) === index);
  const interruptedInput = [{
    taskId: "T-20260912-004",
    children: uniqueChildren([...fixture.t004KeepRunIds.map((runId) => childOfKeepRun(runId)), ...firstHalf]),
  }];
  const interrupted = repairT004UsageRecords(interruptedInput, repairOptions);
  const resumedLedger = interrupted.records.find((record) => record.taskId === "T-20260912-004");
  // The repair journal guards the resume: an already-recorded run is never
  // appended twice (the two originals also appear in T-023's backfill list).
  const alreadyRecorded = new Set(resumedLedger.children.map((child) => child.runId));
  resumedLedger.children.push(...secondHalf.filter((child) => !alreadyRecorded.has(child.runId)));
  const resumed = repairT004UsageRecords(interrupted.records, repairOptions);
  const resumedKept = resumed.records.find((record) => record.taskId === "T-20260912-004");
  const resumedMoved = resumed.records.filter((record) => record.taskId === "unattributed");
  assert.deepEqual(
    resumedKept.children.map((child) => child.runId).sort(),
    kept.children.map((child) => child.runId).sort(),
    "interrupted-then-resumed keeps the same set",
  );
  assert.equal(
    new Set(resumedMoved.flatMap((record) => record.children.map((child) => child.runId))).size,
    new Set(moved.flatMap((record) => record.children.map((child) => child.runId))).size,
    "interrupted-then-resumed moves the same set",
  );
}

// ---------------------------------------------------------------------------
// C03: export through the real exporter with M's in-session task usage (three
// sources of the same run collapse), the 5 real new-build untasked turns, and
// foreign/unknown children from the frozen metas. Known costs are conserved.
// ---------------------------------------------------------------------------
{
  const ledger = new UsageLedger({ pricing });
  // The three ingestion sources (bg-wait, sync-details, meta-file) of the same
  // 13 M runs, exactly as M's public usage events recorded them.
  for (const event of fixture.mInSessionChildEvents) {
    ledger.recordChild(event.taskId, { ...event.child, runId: event.runId });
  }
  // The 5 untasked Root turns (id prefix `root-turn:untasked:`, M:L765/768 +
  // N:L6/9/14); the persisted entries carry the attribution in their id.
  for (const turn of fixture.untaskedRootTurns) {
    ledger.recordRootTurn({ usage: turn.usage, attribution: "untasked", ...(turn.model ? { model: turn.model } : {}) });
  }
  const taskIds = [...new Set(fixture.mInSessionChildEvents.map((event) => event.taskId))];
  const tasks = taskIds.map((taskId) => ({
    taskId,
    rootSessionId: M.rootSessionId,
    state: "completed",
    usage: ledger.taskUsage(taskId) ?? emptyTaskUsage(),
  }));
  const uniqueTaskedChildren = tasks.reduce((sum, task) => sum + task.usage.children.length, 0);
  assert.equal(uniqueTaskedChildren, 13, "three-source ingestion collapses to 13 unique runs per Task ledger");
  assert.equal(
    fixture.mInSessionChildEvents.length > 13,
    true,
    "the raw event count (38) exceeds the unique runs, so the export dedup below is load-bearing",
  );

  // Foreign children observed by N (the exporting session is M), and an
  // unknown child: a real meta stripped of its provenance fields, scanned by
  // M itself — no trusted source, so it stays unknown instead of foreign.
  const foreignEntries = [0, 1, 2].map((index) => {
    const meta = fixture.historicalMeta[index];
    const child = childFromMeta(meta, "worker", N.rootSessionId);
    return { id: `foreign:${meta.runId}`, kind: "child", taskId: "unattributed", runId: meta.runId, child };
  });
  const unknownMeta = { ...fixture.historicalMeta[3] };
  for (const key of ["transcriptPath", "childSessionFile", "sourceDir", "sourceSessionId", "sessionId", "metaPath"]) delete unknownMeta[key];
  const unknownChild = childFromMeta(unknownMeta, "worker", M.rootSessionId);
  const entries = [
    ...ledger.drain().map((entry) => (entry.kind === "root-turn" ? { ...entry, attribution: "untasked" } : entry)),
    ...foreignEntries,
    { id: "unknown-child", kind: "child", taskId: "unattributed", runId: unknownChild.runId, child: unknownChild },
  ];

  const exported = exportSessionEvidence({ rootSessionId: M.rootSessionId, tasks, usageEntries: entries });
  assert.equal(exported.usage.buckets.untaskedShared.count, 5, "the 5 real untasked turns land in one bucket");
  assert.equal(exported.usage.buckets.foreign.count, 3);
  assert.equal(exported.usage.buckets.unknown.count, 1);
  // The tasked bucket counts 8 Task root rows + 13 unique child rows. The
  // replayed reality includes f032477d's misbound T-023 row — it bills once,
  // and the three T-022-source rows collapse onto the same run identity.
  assert.equal(exported.usage.buckets.tasked.count, 21);
  assert.equal(exported.usage.buckets.unknown.unknownCost, true, "unknown stays unknown — never zero-filled as priced");
  // Deduplication: the tasked bucket bills the 13 unique runs, not the 38 events.
  const taskedTokens = tasks.flatMap((task) => task.usage.children).reduce((sum, child) => sum + child.input + child.output + child.cacheRead + child.cacheWrite, 0);
  assert.equal(exported.usage.buckets.tasked.tokens, taskedTokens, "bucket tokens equal the unique-run tokens");
  // Known-cost conservation across the exclusive buckets.
  const knownBucketCost = Object.values(exported.usage.buckets).reduce((sum, bucket) => sum + bucket.costUsd, 0);
  const expectedKnownCost =
    tasks.flatMap((task) => task.usage.children).reduce((sum, child) => sum + (child.costUsd ?? 0), 0) +
    foreignEntries.reduce((sum, entry) => sum + (entry.child.costUsd ?? 0), 0);
  assert.equal(Math.round(knownBucketCost * 1e6) / 1e6, Math.round(expectedKnownCost * 1e6) / 1e6, "known costs are conserved across buckets");
  const bucketTokens = Object.values(exported.usage.buckets).reduce((sum, bucket) => sum + bucket.tokens, 0);
  const exportTokens = exported.usage.tokens.input + exported.usage.tokens.output + exported.usage.tokens.cacheRead + exported.usage.tokens.cacheWrite;
  assert.equal(bucketTokens, exportTokens, "tokens are conserved across buckets");
}

rmSync(dirname(artifactsDir), { recursive: true, force: true });
console.log("planner-only NX-01: PASS");
