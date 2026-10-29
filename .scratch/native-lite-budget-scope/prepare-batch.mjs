import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";

const root = process.env.PI_NATIVE_LITE_BATCH_ROOT;
const batchId = process.env.PI_NATIVE_LITE_BATCH_ID;
const attemptId = process.env.PI_NATIVE_LITE_ATTEMPT_ID;
assert.ok(root?.startsWith("/project/tmp/pi-native-lite-"));
assert.match(batchId ?? "", /^\d{8}T\d{6}\+\d{4}$/);
assert.match(attemptId ?? "", /^[A-Za-z0-9_-]+$/);
await assert.rejects(access(join(root, "worktrees")));

const repo = "/home/tcuni-claw/pi/pi-planner-only";
const sourceBatch = "/project/tmp/pi-native-lite-20261028T010659";
const ledgerPath = "/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json";
const candidate = "f818cc91c98d6129a152fb28161e00d2f601e494";
const arms = ["S1-native", "S1-lite", "S2-lite", "S2-native"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const run = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

for (const dir of ["worktrees", "results", "manifests", "common", "config", "logs", "tmp"]) await mkdir(join(root, dir), { recursive: true });
await mkdir(join(root, "results", attemptId), { recursive: true });
const s1Template = await readFile(join(repo, ".scratch/native-lite-reopen/S1-brief.md"), "utf8");
const s2Template = await readFile(join(repo, ".scratch/native-lite-reopen/S2-brief.md"), "utf8");
const rawSessionExample = `nl-${batchId}-${attemptId}-<pair>-<mode>`;
const sanitizedSessionExample = `nl-${batchId.replace(/[^A-Za-z0-9._-]/g, "-")}-${attemptId}-<pair>-<mode>`;
const replaceIdentity = text => text
  .replaceAll("20261028T010659", batchId)
  .replaceAll("reopen-a1", attemptId)
  .replaceAll(rawSessionExample, sanitizedSessionExample);
const s1 = replaceIdentity(s1Template);
const s2 = replaceIdentity(s2Template);
assert.equal(s1.split("\n", 1)[0].includes(`${root}/results/${attemptId}/<pair>-<mode>`), true);
assert.equal(s2.includes(`${root}/common/S2-candidate.diff`), true);
await writeFile(join(root, "common/S2-candidate.diff"), await readFile(join(sourceBatch, "common/S2-candidate.diff")), { flag: "wx" });
const settings = await readFile(join(repo, ".scratch/native-lite-reopen/settings.json"));
await writeFile(join(root, "config/settings-template.json"), settings, { flag: "wx" });

for (const arm of arms) {

  const worktree = join(root, "worktrees", arm);
  run(["worktree", "add", "--detach", worktree, candidate], repo);
  await mkdir(join(worktree, "input"), { recursive: true });
  await mkdir(join(worktree, ".pi"), { recursive: true });
  await writeFile(join(worktree, ".pi/settings.json"), settings, { flag: "wx" });
  const brief = arm.startsWith("S1") ? s1 : s2;
  await writeFile(join(worktree, "input/brief.md"), brief, { flag: "wx" });
  if (arm.startsWith("S2")) await writeFile(join(worktree, "input/S2-candidate.diff"), await readFile(join(root, "common/S2-candidate.diff")), { flag: "wx" });
}
await writeFile(join(root, "briefs/S1-brief.md"), s1, { flag: "wx" }).catch(async error => {
  if (error.code !== "ENOENT") throw error;
  await mkdir(join(root, "briefs"), { recursive: true });
  await writeFile(join(root, "briefs/S1-brief.md"), s1, { flag: "wx" });
});
await writeFile(join(root, "briefs/S2-brief.md"), s2, { flag: "wx" });

const ledgerBytes = await readFile(ledgerPath);
const ledger = JSON.parse(ledgerBytes);
const ledgerEventsSha256 = sha(Buffer.from(JSON.stringify(ledger.events)));
const runtimeLock = JSON.parse(await readFile(join(sourceBatch, "config/runtime-lock.json"), "utf8"));
runtimeLock.batchId = batchId;
runtimeLock.attemptId = attemptId;
runtimeLock.budgetStopUsd = 26;
runtimeLock.ledger = { path: ledgerPath, prefixCount: ledger.events.length, reservedUsd: ledger.reservedUsd, fileSha256: sha(ledgerBytes), eventsSha256: ledgerEventsSha256 };
const controllerRoot = join(repo, ".scratch/native-lite-lifecycle");
for (const name of Object.keys(runtimeLock.controllerFiles)) runtimeLock.controllerFiles[name] = sha(await readFile(join(controllerRoot, name)));
for (const name of ["pi-runtime-manifest.json", "pi-subagents-runtime-manifest.json"]) await copyFile(join(sourceBatch, "config", name), join(root, "config", name), 0);

const manifests = {};
const workspaceSnapshots = {};
for (const arm of arms) {
  const worktree = join(root, "worktrees", arm);
  const pair = arm.slice(0, 2);
  const brief = await readFile(join(worktree, "input/brief.md"));
  const tree = run(["write-tree"], worktree);
  const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { cwd: worktree });
  const paths = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: worktree }).toString().split("\0").filter(Boolean).sort();
  const files = [];
  for (const path of paths) files.push({ path, sha256: sha(await readFile(join(worktree, path))) });
  const diffSha256 = sha(diff);
  const workspaceSha256 = sha(Buffer.from(JSON.stringify({ tree, diffSha256, files })));
  const settingsSha256 = sha(await readFile(join(worktree, ".pi/settings.json")));
  workspaceSnapshots[arm] = { tree, diffSha256, files, workspaceSha256, briefSha256: sha(brief), settingsSha256 };
  const manifest = { version: 1, pair, mode: arm.slice(3), batchId, attemptId, briefSha256: sha(brief), pairedBriefSha256: sha(brief), gitTree: tree, workspaceSha256, ledgerPrefixCount: ledger.events.length, ledgerEventsSha256, ledgerReservedUsd: ledger.reservedUsd, settingsSha256: sha(await readFile(join(worktree, ".pi/settings.json"))), controllerSha256: runtimeLock.controllerFiles["run-rpc-arm.mjs"] };
  if (pair === "S2") manifest.s2DiffSha256 = sha(await readFile(join(root, "common/S2-candidate.diff")));
  manifests[arm] = manifest;
  await writeFile(join(root, "manifests", `${arm}.json`), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
}
assert.equal(sha(await readFile(join(root, "worktrees/S1-native/input/brief.md"))), sha(await readFile(join(root, "worktrees/S1-lite/input/brief.md"))));
assert.equal(sha(await readFile(join(root, "worktrees/S2-lite/input/brief.md"))), sha(await readFile(join(root, "worktrees/S2-native/input/brief.md"))));
assert.equal(sha(await readFile(join(root, "common/S2-candidate.diff"))), manifests["S2-lite"].s2DiffSha256);
runtimeLock.workspaces = workspaceSnapshots;
runtimeLock.settings.runtimeUserSettingsSha256 = sha(await readFile("/home/tcuni-claw/.pi/agent/settings.json"));
runtimeLock.runtime.loadedUserSettingsPath = "/home/tcuni-claw/.pi/agent/settings.json";
await writeFile(join(root, "config/runtime-lock.json"), `${JSON.stringify(runtimeLock, null, 2)}\n`, { flag: "wx" });
await writeFile(join(root, "config/preparation-summary.json"), `${JSON.stringify({ batchId, attemptId, candidate, ledger: runtimeLock.ledger, manifests }, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ batchId, attemptId, root, arms, ledger: runtimeLock.ledger, briefs: { S1: manifests["S1-native"].briefSha256, S2: manifests["S2-lite"].briefSha256 }, manifests }, null, 2));
