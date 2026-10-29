import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const root = process.env.PI_NATIVE_LITE_BATCH_ROOT;
const batchId = process.env.PI_NATIVE_LITE_BATCH_ID;
const attemptId = process.env.PI_NATIVE_LITE_ATTEMPT_ID;
assert.ok(root?.startsWith("/project/tmp/pi-native-lite-"));
assert.match(batchId ?? "", /^\d{8}T\d{6}\+\d{4}$/);
assert.match(attemptId ?? "", /^[A-Za-z0-9_-]+$/);
const sha = value => createHash("sha256").update(value).digest("hex");
const repo = "/home/tcuni-claw/pi/pi-planner-only";
const sourceBatch = "/project/tmp/pi-native-lite-20261028T010659";
const arms = ["S1-native", "S1-lite", "S2-lite", "S2-native"];
const settingsPath = "/home/tcuni-claw/.pi/agent/settings.json";
const runtimeUserSettingsSha256 = sha(await readFile(settingsPath));
const run = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

for (const arm of arms) {
  const resultDir = join(root, "results", attemptId, arm);
  for (const file of ["session.jsonl", "session.stderr", "control.jsonl", "request-fingerprints.jsonl", "subagent-cost.txt", "runner.stdout", "runner.stderr", "runner.meta"]) {
    try { await access(join(resultDir, file)); throw new Error(`refusing to revise a started arm: ${arm}/${file}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

const sourceBriefs = {
  S1: await readFile(join(repo, ".scratch/native-lite-reopen/S1-brief.md"), "utf8"),
  S2: await readFile(join(repo, ".scratch/native-lite-reopen/S2-brief.md"), "utf8"),
};
const rawIdentity = `nl-${batchId}-${attemptId}-<pair>-<mode>`;
const sanitizedIdentity = `nl-${batchId.replace(/[^A-Za-z0-9._-]/g, "-")}-${attemptId}-<pair>-<mode>`;
const rewriteBrief = text => text
  .replaceAll("20261028T010659", batchId)
  .replaceAll("reopen-a1", attemptId)
  .replaceAll(rawIdentity, sanitizedIdentity);
const briefs = { S1: rewriteBrief(sourceBriefs.S1), S2: rewriteBrief(sourceBriefs.S2) };

for (const pair of ["S1", "S2"]) {
  assert.ok(briefs[pair].includes(sanitizedIdentity), `${pair} must show sanitized root session example`);
  await writeFile(join(root, "briefs", `${pair}-brief.md`), briefs[pair]);
}

const ledgerPath = "/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json";
const ledgerBytes = await readFile(ledgerPath);
const ledger = JSON.parse(ledgerBytes);
const ledgerEventsSha256 = sha(Buffer.from(JSON.stringify(ledger.events)));
const runtimeLock = JSON.parse(await readFile(join(root, "config/runtime-lock.json"), "utf8"));
runtimeLock.settings.runtimeUserSettingsSha256 = runtimeUserSettingsSha256;
runtimeLock.runtime.loadedUserSettingsPath = settingsPath;
runtimeLock.ledger = { path: ledgerPath, prefixCount: ledger.events.length, reservedUsd: ledger.reservedUsd, fileSha256: sha(ledgerBytes), eventsSha256: ledgerEventsSha256 };

const snapshots = {};
const manifestValues = {};
for (const arm of arms) {
  const worktree = join(root, "worktrees", arm);
  const pair = arm.slice(0, 2);
  const briefBytes = Buffer.from(briefs[pair]);
  await writeFile(join(worktree, "input/brief.md"), briefBytes);
  const tree = run(["write-tree"], worktree);
  assert.equal(tree, "9a6e246f8d0007c56685e32f014f0a35643206f0", `${arm} candidate tree remains fixed`);
  const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { cwd: worktree });
  const paths = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: worktree }).toString().split("\0").filter(Boolean).sort();
  const files = [];
  for (const path of paths) files.push({ path, sha256: sha(await readFile(join(worktree, path))) });
  const diffSha256 = sha(diff);
  const workspaceSha256 = sha(Buffer.from(JSON.stringify({ tree, diffSha256, files })));
  const settingsSha256 = sha(await readFile(join(worktree, ".pi/settings.json")));
  const snapshot = { tree, diffSha256, files, workspaceSha256, briefSha256: sha(briefBytes), settingsSha256 };
  snapshots[arm] = snapshot;
  const manifest = JSON.parse(await readFile(join(root, "manifests", `${arm}.json`), "utf8"));
  manifest.briefSha256 = snapshot.briefSha256;
  manifest.pairedBriefSha256 = snapshot.briefSha256;
  manifest.gitTree = tree;
  manifest.workspaceSha256 = workspaceSha256;
  manifest.ledgerPrefixCount = ledger.events.length;
  manifest.ledgerEventsSha256 = ledgerEventsSha256;
  manifest.ledgerReservedUsd = ledger.reservedUsd;
  manifest.settingsSha256 = settingsSha256;
  if (pair === "S2") manifest.s2DiffSha256 = sha(await readFile(join(root, "common/S2-candidate.diff")));
  manifestValues[arm] = manifest;
  await writeFile(join(root, "manifests", `${arm}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  snapshots[arm].files = files;
}
for (const arm of arms) {
  assert.equal(manifestValues[arm].briefSha256, snapshots[arm].briefSha256, `${arm} brief binding`);
  runtimeLock.workspaces[arm] = snapshots[arm];
}
runtimeLock.batchId = batchId;
runtimeLock.attemptId = attemptId;
runtimeLock.candidate = "f818cc91c98d6129a152fb28161e00d2f601e494";
runtimeLock.controllerFiles["run-rpc-arm.mjs"] = sha(await readFile(join(repo, ".scratch/native-lite-lifecycle/run-rpc-arm.mjs")));
await writeFile(join(root, "config/runtime-lock.json"), `${JSON.stringify(runtimeLock, null, 2)}\n`);
await writeFile(join(root, "config/preparation-summary.json"), `${JSON.stringify({ batchId, attemptId, candidate: runtimeLock.candidate, ledger: runtimeLock.ledger, manifests: manifestValues }, null, 2)}\n`);
console.log(JSON.stringify({ batchId, attemptId, sanitizedSessionIdExample: sanitizedIdentity, workspaces: snapshots, manifests: Object.fromEntries(Object.entries(manifestValues).map(([arm, manifest]) => [arm, { briefSha256: manifest.briefSha256, workspaceSha256: manifest.workspaceSha256 }])) }, null, 2));
