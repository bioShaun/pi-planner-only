import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertControllerFiles, assertLedgerLockAbsent, assertManifestBrief, assertRuntimeUserSettings, assertSessionIdentityExample, assertWorkspaceLock } from "./freeze-contract.mjs";

const root = process.env.PI_NATIVE_LITE_BATCH_ROOT;
const batchId = process.env.PI_NATIVE_LITE_BATCH_ID;
const attemptId = process.env.PI_NATIVE_LITE_ATTEMPT_ID;
assert.ok(root?.startsWith("/project/tmp/pi-native-lite-"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const arms = ["S1-native", "S1-lite", "S2-lite", "S2-native"];
const ledgerPath = "/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json";
await assertLedgerLockAbsent(ledgerPath);
const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
const ledgerEventsSha256 = sha(Buffer.from(JSON.stringify(ledger.events)));
const runnerPath = "/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-lifecycle/run-rpc-arm.mjs";
const actualRunnerSha256 = sha(await readFile(runnerPath));
const lock = JSON.parse(await readFile(join(root, "config/runtime-lock.json"), "utf8"));
assert.equal(lock.batchId, batchId);
assert.equal(lock.attemptId, attemptId);
assert.equal(lock.budgetStopUsd, 26);
assert.equal(lock.ledger.path, ledgerPath);
assert.equal(lock.ledger.prefixCount, ledger.events.length);
assert.equal(lock.ledger.reservedUsd, ledger.reservedUsd);
assert.equal(lock.ledger.fileSha256, sha(await readFile(ledgerPath)));
assert.equal(lock.ledger.eventsSha256, ledgerEventsSha256);
assert.equal(lock.controllerFiles["run-rpc-arm.mjs"], actualRunnerSha256);
assert.equal(lock.models.fileSha256, sha(await readFile("/home/tcuni-claw/.pi/agent/models.json")));
const loadedUserSettingsPath = "/home/tcuni-claw/.pi/agent/settings.json";
assertRuntimeUserSettings(lock, loadedUserSettingsPath, await readFile(loadedUserSettingsPath));

const manifests = {};
const workspaceSnapshots = {};
const controllerHashes = {};
const controllerRoot = "/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-lifecycle";
for (const name of Object.keys(lock.controllerFiles)) controllerHashes[name] = sha(await readFile(join(controllerRoot, name)));
assertControllerFiles(lock, controllerHashes);
for (const arm of arms) {
  const cwd = join(root, "worktrees", arm);
  const manifest = JSON.parse(await readFile(join(root, "manifests", `${arm}.json`), "utf8"));
  manifests[arm] = manifest;
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(), "f818cc91c98d6129a152fb28161e00d2f601e494");
  assert.equal(manifest.batchId, batchId);
  assert.equal(manifest.attemptId, attemptId);
  assert.equal(manifest.pair, arm.slice(0, 2));
  assert.equal(manifest.mode, arm.slice(3));
  assert.equal(manifest.controllerSha256, lock.controllerFiles["run-rpc-arm.mjs"]);
  assert.equal(manifest.ledgerPrefixCount, ledger.events.length);
  assert.equal(manifest.ledgerEventsSha256, ledgerEventsSha256);
  assert.equal(manifest.ledgerReservedUsd, ledger.reservedUsd);
  assert.equal(manifest.settingsSha256, sha(await readFile(join(cwd, ".pi/settings.json"))));
  const tree = execFileSync("git", ["write-tree"], { cwd, encoding: "utf8" }).trim();
  const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { cwd });
  const paths = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd }).toString().split("\0").filter(Boolean).sort();
  const files = [];
  for (const path of paths) files.push({ path, sha256: sha(await readFile(join(cwd, path))) });
  assert.equal(manifest.gitTree, tree);
  const diffSha256 = sha(diff);
  const workspaceSha256 = sha(Buffer.from(JSON.stringify({ tree, diffSha256, files })));
  assert.equal(manifest.workspaceSha256, workspaceSha256);
  const briefBytes = await readFile(join(cwd, "input/brief.md"));
  assertManifestBrief(manifest, briefBytes);
  assertSessionIdentityExample(briefBytes.toString(), batchId, attemptId);
  workspaceSnapshots[arm] = { tree, diffSha256, files, workspaceSha256, briefSha256: sha(briefBytes), settingsSha256: manifest.settingsSha256 };
  for (const file of ["session.jsonl", "session.stderr", "control.jsonl", "request-fingerprints.jsonl", "subagent-cost.txt", "runner.stdout", "runner.stderr", "runner.meta"]) {
    await assert.rejects(access(join(root, "results", attemptId, arm, file)), error => error.code === "ENOENT");
  }
}
assertWorkspaceLock(lock, workspaceSnapshots);
assert.equal(manifests["S1-native"].briefSha256, manifests["S1-lite"].briefSha256);
assert.equal(manifests["S2-native"].briefSha256, manifests["S2-lite"].briefSha256);
const commonDiff = await readFile(join(root, "common/S2-candidate.diff"));
assert.equal(sha(commonDiff), manifests["S2-native"].s2DiffSha256);
for (const arm of ["S2-native", "S2-lite"]) assert.deepEqual(await readFile(join(root, "worktrees", arm, "input/S2-candidate.diff")), commonDiff);
for (const [name, file] of [["pi-runtime-manifest.json", lock.runtime.piRuntimeManifestSha256], ["pi-subagents-runtime-manifest.json", lock.runtime.piSubagentsRuntimeManifestSha256]]) {
  assert.equal(sha(await readFile(join(root, "config", name))), file);
}
const piManifest = JSON.parse(await readFile(join(root, "config/pi-runtime-manifest.json"), "utf8"));
const subagentsManifest = JSON.parse(await readFile(join(root, "config/pi-subagents-runtime-manifest.json"), "utf8"));
for (const file of piManifest.files) assert.equal(sha(await readFile(join("/home/tcuni-claw/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent", file.path))), file.sha256, `Pi ${file.path}`);
for (const file of subagentsManifest.files) assert.equal(sha(await readFile(join(subagentsManifest.packageRoot, file.path))), file.sha256, `pi-subagents ${file.path}`);
assert.equal(piManifest.version, lock.runtime.pi);
assert.equal(subagentsManifest.version, lock.runtime.piSubagents);
console.log(JSON.stringify({ batchId, attemptId, arms, candidate: "f818cc91c98d6129a152fb28161e00d2f601e494", ledgerPrefixCount: ledger.events.length, ledgerReservedUsd: ledger.reservedUsd, ledgerEventsSha256, S1BriefSha256: manifests["S1-native"].briefSha256, S2BriefSha256: manifests["S2-native"].briefSha256, S2DiffSha256: sha(commonDiff), manifestsVerified: true, outputPathsEmpty: true }, null, 2));
