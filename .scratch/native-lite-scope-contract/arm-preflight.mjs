import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BUDGET_USD, readLedger } from "../native-lite-lifecycle/budget-guard-core.mjs";
import { assertControllerFiles, assertManifestBrief, assertRuntimeUserSettings, assertWorkspaceLock } from "../native-lite-budget-scope/freeze-contract.mjs";

export const ARM_IDS = Object.freeze(["S1-native", "S1-lite", "S2-lite", "S2-native"]);
const sha = value => createHash("sha256").update(value).digest("hex");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHARED_LEDGER = "/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json";
const MODELS_PATH = "/home/tcuni-claw/.pi/agent/models.json";
const USER_SETTINGS_PATH = "/home/tcuni-claw/.pi/agent/settings.json";

function runGit(args, cwd, encoding = "utf8") {
  return execFileSync("git", args, { cwd, encoding, stdio: ["ignore", "pipe", "pipe"] });
}

export async function workspaceSnapshot(cwd) {
  const tree = runGit(["write-tree"], cwd).trim();
  const diff = runGit(["diff", "HEAD", "--binary"], cwd, "buffer");
  const paths = runGit(["ls-files", "--others", "--exclude-standard", "-z"], cwd, "buffer").toString().split("\0").filter(Boolean).sort();
  const files = [];
  for (const path of paths) files.push({ path, sha256: sha(await readFile(join(cwd, path))) });
  const diffSha256 = sha(diff);
  return { tree, diffSha256, files, workspaceSha256: sha(Buffer.from(JSON.stringify({ tree, diffSha256, files }))) };
}

function runtimeFingerprint(lock) {
  return sha(Buffer.from(JSON.stringify({ controllerFiles: lock.controllerFiles, models: lock.models, runtime: lock.runtime, settings: lock.settings })));
}

function manifestCoreHash(manifest) {
  const core = { ...manifest };
  delete core.manifestCoreSha256;
  delete core.runtimeLockSha256;
  return sha(Buffer.from(JSON.stringify(core)));
}

async function verifyRuntimeFiles(root, lock, paths) {
  assert.equal(lock.runtime?.node, process.version, "Node runtime version drift");
  assert.equal(lock.runtime?.piInstallRoot, paths.piInstallRoot, "Pi install root drift");
  assert.equal(lock.runtime?.piSubagentsRoot, paths.subagentsRoot, "pi-subagents install root drift");
  const controllerHashes = {};
  for (const name of Object.keys(lock.controllerFiles ?? {})) controllerHashes[name] = sha(await readFile(join(paths.controllerRoot, name)));
  assertControllerFiles(lock, controllerHashes);
  assert.equal(lock.models?.fileSha256, sha(await readFile(paths.modelsPath)), "models file drift");
  assertRuntimeUserSettings(lock, paths.userSettingsPath, await readFile(paths.userSettingsPath));

  const runtimeEntries = [
    ["pi-runtime-manifest.json", lock.runtime?.piRuntimeManifestSha256, paths.piRoot],
    ["pi-subagents-runtime-manifest.json", lock.runtime?.piSubagentsRuntimeManifestSha256, paths.subagentsRoot],
  ];
  for (const [name, expectedHash, packageRoot] of runtimeEntries) {
    const manifestBytes = await readFile(join(root, "config", name));
    assert.equal(sha(manifestBytes), expectedHash, `${name} manifest drift`);
    const runtimeManifest = JSON.parse(manifestBytes);
    assert.equal(runtimeManifest.version, name.startsWith("pi-runtime") ? lock.runtime.pi : lock.runtime.piSubagents, `${name} version drift`);
    if (runtimeManifest.packageRoot) assert.equal(runtimeManifest.packageRoot, packageRoot, `${name} package root drift`);
    if (name === "pi-runtime-manifest.json") {
      assert.equal(runtimeManifest.managedVersionPath, paths.managedVersionPath, "Pi version file path drift");
      assert.equal(runtimeManifest.launcher, paths.piLauncher, "Pi launcher path drift");
      assert.equal(lock.runtime.piLauncher, paths.piLauncher, "runtime lock Pi launcher path drift");
      assert.equal(runtimeManifest.entrypoint, lock.runtime.piEntrypoint, "Pi entrypoint lock drift");
      assert.equal(runtimeManifest.entrypoint, join(packageRoot, "dist/bundle/cli.js"), "Pi entrypoint path drift");
      assert.equal(sha(await readFile(paths.managedVersionPath)), runtimeManifest.managedVersionSha256, "Pi managed version file drift");
      assert.equal(sha(await readFile(paths.piLauncher)), runtimeManifest.launcherSha256, "Pi launcher file drift");
      assert.equal(sha(await readFile(runtimeManifest.entrypoint)), runtimeManifest.entrypointSha256, "Pi entrypoint file drift");
    } else {
      assert.equal(runtimeManifest.entrypoint, lock.runtime.piSubagentsEntrypoint, "pi-subagents entrypoint lock drift");
      assert.ok(runtimeManifest.entrypoint && !runtimeManifest.entrypoint.split("/").includes(".."), "unsafe pi-subagents entrypoint");
      const entrypointPath = runtimeManifest.entrypoint.replace(/^\.\//, "");
      assert.equal(await readFile(join(packageRoot, entrypointPath)).then(sha), runtimeManifest.files.find(file => file.path === entrypointPath)?.sha256, "pi-subagents entrypoint file drift");
    }
    for (const entry of runtimeManifest.files) {
      assert.ok(typeof entry.path === "string" && !entry.path.split("/").includes("..") && !entry.path.startsWith("/"), `${name} contains unsafe file path`);
      assert.equal(sha(await readFile(join(packageRoot, entry.path))), entry.sha256, `${name} file ${entry.path}`);
    }
  }
}

async function assertLockAbsent(ledgerPath) {
  try {
    const info = await lstat(`${ledgerPath}.lock`);
    throw new Error(`budget ledger lock exists (${info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file"})`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function assertRealDirectory(path, label) {
  const info = await lstat(path);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), `${label} must be a real directory`);
}

export async function inspectArmPreflight({ root, batchId, arm, attemptId, ledgerPath, dependencies }) {
  assert.ok(root && batchId && attemptId, "batch root, batchId, and attemptId are required");
  assert.ok(ARM_IDS.includes(arm), `unsupported arm ${arm}`);
  const paths = dependencies ?? {
    controllerRoot: join(projectRoot, ".scratch/native-lite-lifecycle"),
    modelsPath: MODELS_PATH,
    userSettingsPath: USER_SETTINGS_PATH,
    managedVersionPath: "/home/tcuni-claw/.pi/agent/install/current-version",
    piLauncher: "/home/tcuni-claw/.pi/agent/bin/pi",
    piRoot: "/home/tcuni-claw/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent",
    piInstallRoot: "/home/tcuni-claw/.pi/agent/install/releases/1.4.0",
    subagentsRoot: "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents",
    expectedLedgerPath: SHARED_LEDGER,
  };
  const lockPath = join(root, "config", "runtime-lock.json");
  const lockBytes = await readFile(lockPath);
  const lock = JSON.parse(lockBytes);
  const manifestPath = join(root, "manifests", `${arm}.json`);
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.runtimeLockSha256, sha(lockBytes), "manifest is not bound to exact runtime-lock bytes");
  assert.equal(manifest.manifestCoreSha256, manifestCoreHash(manifest), "manifest core hash mismatch");
  assert.equal(lock.armManifestHashes?.[arm], manifest.manifestCoreSha256, "runtime lock does not bind arm manifest core");
  assert.equal(lock.batchId, batchId, "runtime lock batchId");
  assert.equal(lock.attemptId, attemptId, "runtime lock attemptId");
  assert.equal(manifest.batchId, batchId, "manifest batchId");
  assert.equal(manifest.attemptId, attemptId, "manifest attemptId");
  assert.equal(manifest.arm, arm, "manifest arm");
  assert.equal(lock.candidate, manifest.candidate, "runtime lock candidate");
  assert.equal(manifest.pair, arm.slice(0, 2), "manifest pair");
  assert.equal(manifest.mode, arm.slice(3), "manifest mode");
  assert.equal(lock.budgetStopUsd, BUDGET_USD, "budget cap must match guard");
  assert.equal(lock.ledger?.path, paths.expectedLedgerPath, "runtime lock ledger path");
  assert.equal(ledgerPath, lock.ledger.path, "requested ledger path differs from frozen lock");

  await assertLockAbsent(ledgerPath);
  const ledgerBytes = await readFile(ledgerPath);
  const ledger = await readLedger(ledgerPath);
  const prefixCount = manifest.ledgerPrefixCount;
  assert.ok(Number.isSafeInteger(prefixCount) && prefixCount >= 0, "ledger prefix count");
  assert.ok(ledger.events.length >= prefixCount, "ledger prefix truncated");
  const prefix = ledger.events.slice(0, prefixCount);
  const prefixHash = sha(Buffer.from(JSON.stringify(prefix)));
  assert.equal(prefixHash, manifest.ledgerEventsSha256, "ledger prefix changed");
  const prefixReservedUsd = prefix.reduce((sum, event) => sum + event.reserveUsd, 0);
  assert.equal(prefixReservedUsd, manifest.ledgerReservedUsd, "manifest prefix reservation mismatch");
  assert.equal(lock.ledger.prefixCount, prefixCount, "runtime lock ledger prefix count");
  assert.equal(lock.ledger.eventsSha256, prefixHash, "runtime lock ledger prefix hash");
  assert.equal(lock.ledger.reservedUsd, prefixReservedUsd, "runtime lock prefix reservation");
  assert.ok(ledger.reservedUsd >= prefixReservedUsd, "ledger reserved total below frozen prefix");
  assert.ok(ledger.reservedUsd < BUDGET_USD, `ledger reservation must remain below $${BUDGET_USD}`);
  if (ledger.events.length === prefixCount) assert.equal(sha(ledgerBytes), lock.ledger.fileSha256, "initial ledger bytes drift");

  const worktree = join(root, "worktrees", arm);
  assert.equal(runGit(["rev-parse", "HEAD"], worktree).trim(), manifest.candidate, "candidate drift");
  const snapshot = await workspaceSnapshot(worktree);
  const lockedWorkspace = lock.workspaces?.[arm];
  assert.ok(lockedWorkspace, `${arm} workspace lock missing`);
  assertWorkspaceLock({ workspaces: { [arm]: lockedWorkspace } }, { [arm]: { ...snapshot, briefSha256: manifest.briefSha256, settingsSha256: manifest.settingsSha256, files: snapshot.files } });
  assert.equal(lockedWorkspace.gitTree ?? lockedWorkspace.tree, manifest.gitTree, "manifest tree differs from workspace lock");
  assert.equal(lockedWorkspace.workspaceSha256, manifest.workspaceSha256, "manifest workspace differs from workspace lock");
  const briefBytes = await readFile(join(worktree, "input/brief.md"));
  assertManifestBrief(manifest, briefBytes);
  const settingsBytes = await readFile(join(worktree, ".pi/settings.json"));
  assert.equal(sha(settingsBytes), manifest.settingsSha256, "settings drift");
  assert.equal(sha(settingsBytes), manifest.configSha256, "config drift");
  assert.equal(sha(settingsBytes), lock.settings.sha256, "runtime lock project settings drift");
  assert.equal(manifest.runtimeSha256, runtimeFingerprint(lock), "runtime lock fingerprint drift");
  await verifyRuntimeFiles(root, lock, paths);

  const pairedArm = arm.startsWith("S1") ? arm === "S1-native" ? "S1-lite" : "S1-native" : arm === "S2-native" ? "S2-lite" : "S2-native";
  const pairedManifest = JSON.parse(await readFile(join(root, "manifests", `${pairedArm}.json`), "utf8"));
  assert.equal(pairedManifest.batchId, batchId, "paired batchId");
  assert.equal(pairedManifest.attemptId, attemptId, "paired attemptId");
  assert.equal(pairedManifest.arm, pairedArm, "paired arm");
  assert.equal(pairedManifest.pair, manifest.pair, "paired pair identity");
  assert.equal(pairedManifest.candidate, manifest.candidate, "paired candidate");
  assert.equal(pairedManifest.settingsSha256, manifest.settingsSha256, "paired project settings");
  assert.equal(pairedManifest.runtimeSha256, manifest.runtimeSha256, "paired runtime fingerprint");
  assert.equal(pairedManifest.runtimeLockSha256, sha(lockBytes), "paired manifest runtime-lock binding");
  assert.equal(pairedManifest.manifestCoreSha256, manifestCoreHash(pairedManifest), "paired manifest core hash");
  assert.equal(lock.armManifestHashes?.[pairedArm], pairedManifest.manifestCoreSha256, "runtime lock does not bind paired manifest core");
  assert.equal(pairedManifest.briefSha256, manifest.briefSha256, "paired manifest brief mismatch");
  const pairedBrief = await readFile(join(root, "worktrees", pairedArm, "input/brief.md"));
  assert.deepEqual(pairedBrief, briefBytes, "paired brief bytes differ");
  if (arm.startsWith("S2")) {
    const commonDiff = await readFile(join(root, "common", "S2-candidate.diff"));
    const pairedDiff = await readFile(join(root, "worktrees", pairedArm, "input/S2-candidate.diff"));
    const targetDiff = await readFile(join(worktree, "input/S2-candidate.diff"));
    assert.equal(sha(commonDiff), manifest.s2DiffSha256, "common diff drift");
    assert.equal(pairedManifest.s2DiffSha256, sha(commonDiff), "paired manifest common diff drift");
    assert.deepEqual(targetDiff, commonDiff, "target S2 diff differs from common diff");
    assert.deepEqual(pairedDiff, commonDiff, "paired S2 diff differs from common diff");
  }

  const output = join(root, "results", attemptId, arm);
  await assertRealDirectory(root, "batch root");
  await assertRealDirectory(join(root, "results"), "results root");
  await assertRealDirectory(join(root, "results", attemptId), "attempt results");
  let entries;
  try {
    const info = await lstat(output);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), "unsafe target output path");
    entries = await readdir(output);
  } catch (error) {
    if (error.code === "ENOENT") entries = [];
    else throw error;
  }
  assert.equal(entries.length, 0, "target output is not empty");
  return { ok: true, arm, batchId, attemptId, prefixCount, currentEvents: ledger.events.length, reservedUsd: ledger.reservedUsd };
}

export async function runArmPreflight({ env = process.env, dependencies } = {}) {
  const { PI_NATIVE_LITE_BATCH_ROOT: root, PI_NATIVE_LITE_BATCH_ID: batchId, PI_NATIVE_LITE_ATTEMPT_ID: attemptId, PI_NATIVE_LITE_ARM: arm } = env;
  assert.ok(root?.startsWith("/project/tmp/pi-native-lite-"), "batch root must be an external pi-native-lite directory");
  assert.match(batchId ?? "", /^\d{8}T\d{6}\+\d{4}$/, "batchId format");
  assert.match(attemptId ?? "", /^[A-Za-z0-9_-]+$/, "attemptId format");
  assert.ok(ARM_IDS.includes(arm), `unsupported arm ${arm}`);
  assert.equal(env.PI_NATIVE_LITE_WORKTREE, undefined, "worktree path override is not permitted");
  const ledgerPath = env.PI_NATIVE_LITE_SHARED_LEDGER;
  assert.equal(ledgerPath, dependencies?.expectedLedgerPath ?? SHARED_LEDGER, "shared ledger path override is not permitted");
  const result = await inspectArmPreflight({ root, batchId, arm, attemptId, ledgerPath, dependencies });
  console.log(JSON.stringify(result));
  return result;
}

async function fixtureDependenciesFromArgs(args) {
  if (args.length === 0) return undefined;
  assert.deepEqual(args.slice(0, 1), ["--fixture-dependencies"], "unknown CLI argument");
  assert.equal(args.length, 2, "fixture dependency file required");
  assert.equal(process.env.NODE_ENV, "test", "fixture dependencies require NODE_ENV=test");
  const tempRoot = await realpath(process.env.TMPDIR ?? "");
  const fixturePath = await realpath(args[1]);
  const isInside = path => {
    const rel = relative(tempRoot, path);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
  };
  assert.ok(isInside(fixturePath), "fixture dependency file must be under TMPDIR");
  const dependencies = JSON.parse(await readFile(fixturePath, "utf8"));
  const required = ["controllerRoot", "modelsPath", "userSettingsPath", "managedVersionPath", "piLauncher", "piInstallRoot", "piRoot", "subagentsRoot", "expectedLedgerPath"];
  assert.deepEqual(Object.keys(dependencies).sort(), required.sort(), "fixture dependency shape");
  for (const value of Object.values(dependencies)) {
    assert.equal(typeof value, "string", "fixture dependency paths must be strings");
    assert.ok(isInside(await realpath(value)), "fixture dependencies must resolve under TMPDIR");
  }
  return dependencies;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await runArmPreflight({ dependencies: await fixtureDependenciesFromArgs(process.argv.slice(2)) });
}
