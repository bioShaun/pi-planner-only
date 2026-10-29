import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const repo = "/home/tcuni-claw/pi/pi-planner-only";
const sourceBatch = "/project/tmp/pi-native-lite-20261028T010659";
const realLedger = "/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json";
const outputRoot = "/project/tmp/pi-native-lite-scope-next/legacy-baseline";
const evidenceRoot = join(outputRoot, "evidence");
const arms = ["S1-native", "S1-lite", "S2-lite", "S2-native"];
const sha = value => createHash("sha256").update(value).digest("hex");

async function configure(base, ledger) {
  await mkdir(join(base, "manifests"), { recursive: true });
  await mkdir(join(base, "config"), { recursive: true });
  await mkdir(join(base, "common"), { recursive: true });
  await mkdir(join(base, "worktrees"), { recursive: true });
  await mkdir(join(base, "results", "reopen-a1"), { recursive: true });
  for (const arm of arms) {
    await symlink(join(sourceBatch, "worktrees", arm), join(base, "worktrees", arm), "dir");
    await mkdir(join(base, "results", "reopen-a1", arm), { recursive: true });
    const manifest = JSON.parse(await readFile(join(sourceBatch, "manifests", `${arm}.json`), "utf8"));
    manifest.ledgerPrefixCount = 19;
    manifest.ledgerEventsSha256 = ledger.eventsSha256;
    manifest.ledgerReservedUsd = ledger.reservedUsd;
    manifest.controllerSha256 = ledger.controllerSha256;
    await writeFile(join(base, "manifests", `${arm}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

async function snapshot(cwd) {
  const tree = execFileSync("git", ["write-tree"], { cwd, encoding: "utf8" }).trim();
  const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { cwd });
  const paths = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd }).toString().split("\0").filter(Boolean).sort();
  const files = [];
  for (const path of paths) files.push({ path, sha256: sha(await readFile(join(cwd, path))) });
  const diffSha256 = sha(diff);
  const brief = await readFile(join(cwd, "input/brief.md"));
  const settings = await readFile(join(cwd, ".pi/settings.json"));
  return { tree, diffSha256, files, workspaceSha256: sha(Buffer.from(JSON.stringify({ tree, diffSha256, files }))), briefSha256: sha(brief), settingsSha256: sha(settings) };
}

async function prepareFixture(t) {
  const base = join(outputRoot, `fixture-${process.pid}-${Date.now()}`);
  await mkdir(base, { recursive: true });
  const ledgerSource = JSON.parse(await readFile(realLedger, "utf8"));
  const events = ledgerSource.events.slice(0, 19);
  const reservedUsd = events.reduce((sum, event) => sum + event.reserveUsd, 0);
  const body = { version: 1, reservedUsd, events };
  const ledger = { ...body, checksum: sha(JSON.stringify(body)) };
  const ledgerPath = join(base, "budget-ledger.json");
  await writeFile(ledgerPath, JSON.stringify(ledger));
  const prefixHash = sha(Buffer.from(JSON.stringify(events)));
  const lock = JSON.parse(await readFile(join(sourceBatch, "config/runtime-lock.json"), "utf8"));
  lock.budgetStopUsd = 26;
  const settingsPath = "/home/tcuni-claw/.pi/agent/settings.json";
  lock.runtime.loadedUserSettingsPath = settingsPath;
  lock.settings.runtimeUserSettingsSha256 = sha(await readFile(settingsPath));
  const controllerRoot = join(repo, ".scratch/native-lite-lifecycle");
  for (const name of Object.keys(lock.controllerFiles)) lock.controllerFiles[name] = sha(await readFile(join(controllerRoot, name)));
  lock.ledger = { path: ledgerPath, prefixCount: events.length, reservedUsd, fileSha256: sha(await readFile(ledgerPath)), eventsSha256: prefixHash };
  await configure(base, { reservedUsd, eventsSha256: prefixHash, controllerSha256: lock.controllerFiles["run-rpc-arm.mjs"] });
  lock.workspaces = {};
  for (const arm of arms) lock.workspaces[arm] = await snapshot(join(base, "worktrees", arm));
  await writeFile(join(base, "config/runtime-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  for (const file of ["pi-runtime-manifest.json", "pi-subagents-runtime-manifest.json"]) await cp(join(sourceBatch, "config", file), join(base, "config", file));
  await cp(join(sourceBatch, "common/S2-candidate.diff"), join(base, "common/S2-candidate.diff"));

  const adaptedDir = join(base, "adapted-verifier");
  await mkdir(adaptedDir);
  const sourceVerifier = await readFile(join(repo, ".scratch/native-lite-budget-scope/verify-batch.mjs"), "utf8");
  const originalSha256 = sha(Buffer.from(sourceVerifier));
  const oldLedger = "/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json";
  assert.equal(sourceVerifier.split(oldLedger).length - 1, 1, "only ledger path should need fixture redirection");
  const adapted = sourceVerifier.replace(oldLedger, ledgerPath);
  await writeFile(join(adaptedDir, "verify-batch.mjs"), adapted);
  await cp(join(repo, ".scratch/native-lite-budget-scope/freeze-contract.mjs"), join(adaptedDir, "freeze-contract.mjs"));
  await writeFile(join(base, "adaptation.json"), JSON.stringify({ sourceVerifier: join(repo, ".scratch/native-lite-budget-scope/verify-batch.mjs"), originalSha256, adaptedSha256: sha(Buffer.from(adapted)), pathOnlyReplacement: { from: oldLedger, to: ledgerPath } }, null, 2));
  const diff = spawnSync("diff", ["-u", join(repo, ".scratch/native-lite-budget-scope/verify-batch.mjs"), join(adaptedDir, "verify-batch.mjs")], { encoding: "utf8" });
  await writeFile(join(base, "adaptation.diff"), diff.stdout);
  await mkdir(evidenceRoot, { recursive: true });
  await cp(join(base, "adaptation.diff"), join(evidenceRoot, "adaptation.diff"));
  await cp(join(base, "adaptation.json"), join(evidenceRoot, "adaptation.json"));
  assert.equal(diff.status, 1);
  const env = { ...process.env, TMPDIR: "/project/tmp/pi-native-lite-scope-next/tmp", TMP: "/project/tmp/pi-native-lite-scope-next/tmp", TEMP: "/project/tmp/pi-native-lite-scope-next/tmp", PI_NATIVE_LITE_BATCH_ROOT: base, PI_NATIVE_LITE_BATCH_ID: "20261028T010659", PI_NATIVE_LITE_ATTEMPT_ID: "reopen-a1" };
  const run = () => spawnSync(process.execPath, [join(adaptedDir, "verify-batch.mjs")], { cwd: repo, env, encoding: "utf8" });
  t.after(() => import("node:fs/promises").then(fs => fs.rm(base, { recursive: true, force: true })));
  return { base, ledgerPath, ledger, run };
}

async function preserve(name, fixture, result) {
  await writeFile(join(evidenceRoot, `${name}.stdout`), result.stdout);
  await writeFile(join(evidenceRoot, `${name}.stderr`), result.stderr);
  await writeFile(join(evidenceRoot, `${name}.execution.json`), JSON.stringify({
    command: `node ${fixture.base}/adapted-verifier/verify-batch.mjs`, cwd: repo, exitCode: result.status,
    env: { TMPDIR: "/project/tmp/pi-native-lite-scope-next/tmp", PI_NATIVE_LITE_BATCH_ROOT: fixture.base, PI_NATIVE_LITE_BATCH_ID: "20261028T010659", PI_NATIVE_LITE_ATTEMPT_ID: "reopen-a1" },
  }, null, 2));
}

test("legacy whole-batch verifier passes the initial isolated full-batch fixture", async t => {
  const f = await prepareFixture(t);
  const result = f.run();
  await writeFile(join(f.base, "initial.stdout"), result.stdout);
  await writeFile(join(f.base, "initial.stderr"), result.stderr);
  await preserve("initial", f, result);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /manifestsVerified/);
});

test("legacy verifier rejects a sealed legal ledger append at its equal-length assertion", async t => {
  const f = await prepareFixture(t);
  const body = { ...f.ledger, events: [...f.ledger.events, { ...f.ledger.events[0], reserveUsd: 0.1, sessionId: "fixture-append" }], reservedUsd: f.ledger.reservedUsd + 0.1 };
  body.checksum = sha(JSON.stringify({ version: body.version, reservedUsd: body.reservedUsd, events: body.events }));
  await writeFile(f.ledgerPath, JSON.stringify(body));
  const result = f.run();
  await writeFile(join(f.base, "append.stdout"), result.stdout);
  await writeFile(join(f.base, "append.stderr"), result.stderr);
  await preserve("append", f, result);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /19 !== 20/);
});

test("legacy verifier rejects a completed arm output at its empty-output assertion", async t => {
  const f = await prepareFixture(t);
  await writeFile(join(f.base, "results/reopen-a1/S1-native/session.jsonl"), "completed fixture arm\n");
  const result = f.run();
  await writeFile(join(f.base, "completed.stdout"), result.stdout);
  await writeFile(join(f.base, "completed.stderr"), result.stderr);
  await preserve("completed-output", f, result);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing expected rejection/);
});
