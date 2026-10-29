import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { BUDGET_USD } from "../native-lite-lifecycle/budget-guard-core.mjs";
import { inspectArmPreflight, runArmPreflight, workspaceSnapshot } from "./arm-preflight.mjs";
import { prepareBatch } from "./prepare-batch.review.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const event = (reserveUsd, sessionId) => ({ model: "tcuni/gpt-6-luna", reserveUsd, sessionId, timestamp: "2026-10-28T00:00:00.000Z", payloadHash: hash(sessionId) });
const sealed = (events, reservedUsd = events.reduce((sum, item) => sum + item.reserveUsd, 0)) => {
  const body = { version: 1, reservedUsd, events };
  return { ...body, checksum: hash(JSON.stringify(body)) };
};
const runtimeHash = lock => hash(Buffer.from(JSON.stringify({ controllerFiles: lock.controllerFiles, models: lock.models, runtime: lock.runtime, settings: lock.settings })));
const manifestCoreHash = manifest => {
  const core = { ...manifest };
  delete core.manifestCoreSha256;
  delete core.runtimeLockSha256;
  return hash(Buffer.from(JSON.stringify(core)));
};

async function fixture(t) {
  const root = await mkdtemp(join(process.env.TMPDIR, "arm-preflight-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ["manifests", "config", "common", "results/try1/S1-native", "results/try1/S2-lite", "worktrees"]) await mkdir(join(root, dir), { recursive: true });
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "src.ts"), "frozen source\n");
  execFileSync("git", ["init", "-q", source]);
  execFileSync("git", ["-C", source, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "add", "."]);
  execFileSync("git", ["-C", source, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]);
  const candidate = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const worktrees = {};
  for (const arm of ["S2-lite", "S2-native"]) {
    const cwd = join(root, "worktrees", arm);
    execFileSync("git", ["clone", "-q", source, cwd]);
    await mkdir(join(cwd, "input"));
    await mkdir(join(cwd, ".pi"));
    await writeFile(join(cwd, "input/brief.md"), "same frozen paired brief\n");
    await writeFile(join(cwd, ".pi/settings.json"), "same project settings\n");
    await writeFile(join(cwd, "input/S2-candidate.diff"), "frozen candidate diff\n");
    worktrees[arm] = cwd;
  }
  const commonDiff = Buffer.from("frozen candidate diff\n");
  await writeFile(join(root, "common/S2-candidate.diff"), commonDiff);

  const dependencies = {
    controllerRoot: join(root, "runtime/controller"),
    modelsPath: join(root, "runtime/models.json"),
    userSettingsPath: join(root, "runtime/settings.json"),
    piInstallRoot: join(root, "runtime/pi-install"),
    piLauncher: join(root, "runtime/bin/pi"),
    managedVersionPath: join(root, "runtime/current-version"),
    piRoot: join(root, "runtime/pi-install/node_modules/@earendil-works/pi-coding-agent"),
    subagentsRoot: join(root, "runtime/pi-subagents"),
    expectedLedgerPath: join(root, "budget-ledger.json"),
  };
  await mkdir(dependencies.controllerRoot, { recursive: true });
  await mkdir(dependencies.piRoot, { recursive: true });
  await mkdir(dependencies.subagentsRoot, { recursive: true });
  await mkdir(join(dependencies.piRoot, "dist/bundle"), { recursive: true });
  await mkdir(join(dependencies.subagentsRoot, "bundle"), { recursive: true });
  await mkdir(join(root, "runtime/bin"), { recursive: true });
  await writeFile(join(dependencies.controllerRoot, "runner.mjs"), "frozen runner\n");
  await writeFile(dependencies.modelsPath, "{\"models\":[]}\n");
  await writeFile(dependencies.userSettingsPath, "{\"setting\":true}\n");
  await writeFile(join(dependencies.piRoot, "entry.js"), "pi runtime\n");
  await writeFile(join(dependencies.piRoot, "dist/bundle/cli.js"), "pi entrypoint\n");
  await writeFile(join(dependencies.subagentsRoot, "entry.js"), "subagents runtime\n");
  await writeFile(join(dependencies.subagentsRoot, "bundle/index.js"), "subagents entrypoint\n");
  await writeFile(dependencies.piLauncher, "pi launcher\n");
  await writeFile(dependencies.managedVersionPath, "1.4.0\n");
  const piManifest = { version: "1.4.0", managedVersionPath: dependencies.managedVersionPath, managedVersionSha256: hash(await readFile(dependencies.managedVersionPath)), launcher: dependencies.piLauncher, launcherSha256: hash(await readFile(dependencies.piLauncher)), entrypoint: join(dependencies.piRoot, "dist/bundle/cli.js"), entrypointSha256: hash(await readFile(join(dependencies.piRoot, "dist/bundle/cli.js"))), files: [{ path: "entry.js", sha256: hash(await readFile(join(dependencies.piRoot, "entry.js"))) }, { path: "dist/bundle/cli.js", sha256: hash(await readFile(join(dependencies.piRoot, "dist/bundle/cli.js"))) }] };
  const subagentsManifest = { version: "0.83.0", packageRoot: dependencies.subagentsRoot, entrypoint: "./bundle/index.js", files: [{ path: "entry.js", sha256: hash(await readFile(join(dependencies.subagentsRoot, "entry.js"))) }, { path: "bundle/index.js", sha256: hash(await readFile(join(dependencies.subagentsRoot, "bundle/index.js"))) }] };
  await writeFile(join(root, "config/pi-runtime-manifest.json"), JSON.stringify(piManifest));
  await writeFile(join(root, "config/pi-subagents-runtime-manifest.json"), JSON.stringify(subagentsManifest));

  const prefix = [event(1, "seed")];
  const ledger = sealed(prefix);
  const ledgerBytes = Buffer.from(JSON.stringify(ledger));
  await writeFile(dependencies.expectedLedgerPath, ledgerBytes);
  const prefixHash = hash(Buffer.from(JSON.stringify(prefix)));
  const lock = {
    batchId: "20261028T130000+0800", attemptId: "try1", candidate,
    budgetStopUsd: BUDGET_USD,
    ledger: { path: dependencies.expectedLedgerPath, prefixCount: 1, eventsSha256: prefixHash, reservedUsd: 1, fileSha256: hash(ledgerBytes) },
    controllerFiles: { "runner.mjs": hash(await readFile(join(dependencies.controllerRoot, "runner.mjs"))) },
    models: { fileSha256: hash(await readFile(dependencies.modelsPath)) },
    runtime: {
      node: process.version, pi: "1.4.0", piSubagents: "0.83.0", piInstallRoot: dependencies.piInstallRoot, piSubagentsRoot: dependencies.subagentsRoot,
      piLauncher: dependencies.piLauncher, piEntrypoint: piManifest.entrypoint, piSubagentsEntrypoint: subagentsManifest.entrypoint,
      piRuntimeManifestSha256: hash(await readFile(join(root, "config/pi-runtime-manifest.json"))),
      piSubagentsRuntimeManifestSha256: hash(await readFile(join(root, "config/pi-subagents-runtime-manifest.json"))),
      loadedUserSettingsPath: dependencies.userSettingsPath,
    },
    settings: { sha256: hash(await readFile(join(worktrees["S2-lite"], ".pi/settings.json"))), runtimeUserSettingsSha256: hash(await readFile(dependencies.userSettingsPath)) },
    workspaces: {}, armManifestHashes: {},
  };
  const briefBytes = await readFile(join(worktrees["S2-lite"], "input/brief.md"));
  const settingsBytes = await readFile(join(worktrees["S2-lite"], ".pi/settings.json"));
  for (const arm of ["S2-lite", "S2-native"]) {
    const snapshot = await workspaceSnapshot(worktrees[arm]);
    const locked = { ...snapshot, briefSha256: hash(briefBytes), settingsSha256: hash(settingsBytes) };
    lock.workspaces[arm] = locked;
    const manifest = {
      version: 2, arm, pair: "S2", mode: arm.slice(3), batchId: lock.batchId, attemptId: lock.attemptId, candidate,
      briefSha256: hash(briefBytes), pairedBriefSha256: hash(briefBytes), configSha256: hash(settingsBytes), settingsSha256: hash(settingsBytes),
      runtimeSha256: runtimeHash(lock), gitTree: snapshot.tree, workspaceSha256: snapshot.workspaceSha256,
      ledgerPrefixCount: 1, ledgerEventsSha256: prefixHash, ledgerReservedUsd: 1, s2DiffSha256: hash(commonDiff),
    };
    manifest.manifestCoreSha256 = manifestCoreHash(manifest);
    lock.armManifestHashes[arm] = manifest.manifestCoreSha256;
    await writeFile(join(root, "manifests", `${arm}.json`), JSON.stringify(manifest));
  }
  const lockBytes = Buffer.from(JSON.stringify(lock));
  await writeFile(join(root, "config/runtime-lock.json"), lockBytes);
  for (const arm of ["S2-lite", "S2-native"]) {
    const path = join(root, "manifests", `${arm}.json`);
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.runtimeLockSha256 = hash(lockBytes);
    await writeFile(path, JSON.stringify(manifest));
  }
  return { root, lock, dependencies, prefix, candidate, worktrees, commonDiff };
}

const params = f => ({ root: f.root, batchId: f.lock.batchId, attemptId: f.lock.attemptId, arm: "S2-lite", ledgerPath: f.dependencies.expectedLedgerPath, dependencies: f.dependencies });
const cliEnv = f => ({ PI_NATIVE_LITE_BATCH_ROOT: f.root, PI_NATIVE_LITE_BATCH_ID: f.lock.batchId, PI_NATIVE_LITE_ATTEMPT_ID: f.lock.attemptId, PI_NATIVE_LITE_ARM: "S2-lite", PI_NATIVE_LITE_SHARED_LEDGER: f.dependencies.expectedLedgerPath });

test("allows a sealed legal append while retaining completed-arm output", async t => {
  const f = await fixture(t);
  await writeFile(f.dependencies.expectedLedgerPath, JSON.stringify(sealed([...f.prefix, event(0.25, "arm1")])));
  await writeFile(join(f.root, "results/try1/S1-native/report.md"), "completed");
  assert.equal((await inspectArmPreflight(params(f))).ok, true);
});

test("rejects a changed or truncated sealed ledger prefix", async t => {
  const f = await fixture(t);
  for (const events of [[event(1, "changed")], []]) {
    await writeFile(f.dependencies.expectedLedgerPath, JSON.stringify(sealed(events)));
    await assert.rejects(inspectArmPreflight(params(f)), /prefix/);
  }
});

test("uses guard ledger checksum, event sum, and strict below-cap semantics", async t => {
  const f = await fixture(t);
  const badChecksum = sealed(f.prefix);
  badChecksum.checksum = "0".repeat(64);
  await writeFile(f.dependencies.expectedLedgerPath, JSON.stringify(badChecksum));
  await assert.rejects(inspectArmPreflight(params(f)), /checksum/);
  await writeFile(f.dependencies.expectedLedgerPath, JSON.stringify(sealed(f.prefix, 2)));
  await assert.rejects(inspectArmPreflight(params(f)), /total|checksum/);
  const atCap = [...f.prefix, event(BUDGET_USD - 1, "at-cap")];
  await writeFile(f.dependencies.expectedLedgerPath, JSON.stringify(sealed(atCap)));
  await assert.rejects(inspectArmPreflight(params(f)), /budget ledger|budget|total/i);
});

test("fails closed on a ledger lock and a nonempty target output", async t => {
  const f = await fixture(t);
  await writeFile(`${f.dependencies.expectedLedgerPath}.lock`, "held");
  await assert.rejects(inspectArmPreflight(params(f)), /lock exists/);
  await rm(`${f.dependencies.expectedLedgerPath}.lock`);
  await writeFile(join(f.root, "results/try1/S2-lite/runner.stdout"), "started");
  await assert.rejects(inspectArmPreflight(params(f)), /target output/);
});

test("rejects a symlinked target output path", async t => {
  const f = await fixture(t);
  const target = join(f.root, "results/try1/S2-lite");
  const outside = join(f.root, "outside-empty");
  await mkdir(outside);
  await rm(target, { recursive: true });
  await symlink(outside, target, "dir");
  await assert.rejects(inspectArmPreflight(params(f)), /symlink|unsafe target output/);
});

test("rejects candidate, brief, project config, runtime lock, and paired brief drift", async t => {
  const f = await fixture(t);
  const target = f.worktrees["S2-lite"];
  await writeFile(join(target, "src.ts"), "new commit\n");
  execFileSync("git", ["-C", target, "add", "src.ts"]);
  execFileSync("git", ["-C", target, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "drift candidate"]);
  await assert.rejects(inspectArmPreflight(params(f)), /candidate/);
  const fresh = await fixture(t);
  await writeFile(join(fresh.worktrees["S2-lite"], "input/brief.md"), "changed brief");
  await assert.rejects(inspectArmPreflight(params(fresh)), /workspace|brief/);
  const configDrift = await fixture(t);
  await writeFile(join(configDrift.worktrees["S2-lite"], ".pi/settings.json"), "changed project settings\n");
  await assert.rejects(inspectArmPreflight(params(configDrift)), /workspace|settings|config/);
});

test("binds both the manifest core and exact runtime-lock bytes", async t => {
  const f = await fixture(t);
  const lockPath = join(f.root, "config/runtime-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.injectedUnboundField = "tampered lock bytes";
  await writeFile(lockPath, JSON.stringify(lock));
  await assert.rejects(inspectArmPreflight(params(f)), /runtime.lock|manifest core|manifest is not bound/);
});

test("CLI rejects workspace changes, identity/path overrides and paired-byte drift", async t => {
  const f = await fixture(t);
  const env = cliEnv(f);
  assert.equal((await runArmPreflight({ env, dependencies: f.dependencies })).ok, true);
  const source = join(f.worktrees["S2-lite"], "src.ts");
  const original = await readFile(source);
  await writeFile(source, "workspace drift\n");
  await assert.rejects(runArmPreflight({ env, dependencies: f.dependencies }), /workspace|tree|diff/);
  await writeFile(source, original);
  await assert.rejects(runArmPreflight({ env: { ...env, PI_NATIVE_LITE_BATCH_ID: "another-batch" }, dependencies: f.dependencies }), /batchId/);
  await assert.rejects(runArmPreflight({ env: { ...env, PI_NATIVE_LITE_SHARED_LEDGER: join(f.root, "other-ledger.json") }, dependencies: f.dependencies }), /ledger path/);
  await assert.rejects(runArmPreflight({ env: { ...env, PI_NATIVE_LITE_WORKTREE: f.worktrees["S2-lite"] }, dependencies: f.dependencies }), /worktree path override/);
  const paired = join(f.worktrees["S2-native"], "input/brief.md");
  await writeFile(paired, "different paired brief\n");
  await assert.rejects(runArmPreflight({ env, dependencies: f.dependencies }), /workspace|paired brief/);
});

test("runtime verification reads the locked controller, model, user settings and runtime files", async t => {
  const f = await fixture(t);
  await writeFile(join(f.dependencies.controllerRoot, "runner.mjs"), "changed runner");
  await assert.rejects(inspectArmPreflight(params(f)), /controller/);
  for (const [path, content, error] of [
    [f.dependencies.modelsPath, "changed models", /models file drift/],
    [f.dependencies.userSettingsPath, "changed user settings", /runtime user settings hash/],
    [join(f.dependencies.piRoot, "entry.js"), "changed Pi runtime", /pi-runtime-manifest.json file/],
    [join(f.dependencies.subagentsRoot, "entry.js"), "changed subagents runtime", /pi-subagents-runtime-manifest.json file/],
  ]) {
    const fresh = await fixture(t);
    await writeFile(path.replace(f.root, fresh.root), content);
    await assert.rejects(inspectArmPreflight(params(fresh)), error);
  }
  const launcher = await fixture(t);
  await writeFile(launcher.dependencies.piLauncher, "changed launcher");
  await assert.rejects(inspectArmPreflight(params(launcher)), /launcher/);
});

test("S2 checks common and both paired diff bytes", async t => {
  const f = await fixture(t);
  await writeFile(join(f.worktrees["S2-native"], "input/S2-candidate.diff"), "different diff");
  await assert.rejects(inspectArmPreflight(params(f)), /workspace|diff/);
});

test("prepareBatch renders paired briefs and creates manifests accepted by the per-arm CLI", async t => {
  const f = await fixture(t);
  const sourceBatch = join(f.root, "prepare-source");
  await mkdir(join(sourceBatch, "config"), { recursive: true });
  await mkdir(join(sourceBatch, "common"), { recursive: true });
  await writeFile(join(sourceBatch, "config/runtime-lock.json"), JSON.stringify(f.lock));
  await writeFile(join(sourceBatch, "config/pi-runtime-manifest.json"), await readFile(join(f.root, "config/pi-runtime-manifest.json")));
  await writeFile(join(sourceBatch, "config/pi-subagents-runtime-manifest.json"), await readFile(join(f.root, "config/pi-subagents-runtime-manifest.json")));
  await writeFile(join(sourceBatch, "common/S2-candidate.diff"), f.commonDiff);
  const batchRoot = join(f.root, "prepared-batch");
  const batchId = "20261028T141500+0800";
  const attemptId = "fixture-r2";
  const templates = {
    S1: join(process.cwd(), ".scratch/native-lite-scope-contract/S1-brief.review.md"),
    S2: join(process.cwd(), ".scratch/native-lite-scope-contract/S2-brief.review.md"),
  };
  const prepared = await prepareBatch({
    root: batchRoot, batchId, attemptId, candidate: f.candidate, repo: join(f.root, "source"), sourceBatch,
    ledgerPath: f.dependencies.expectedLedgerPath, templates, settingsTemplatePath: join(f.worktrees["S2-lite"], ".pi/settings.json"),
    controllerRoot: f.dependencies.controllerRoot, modelsPath: f.dependencies.modelsPath,
    userSettingsPath: f.dependencies.userSettingsPath, piRoot: f.dependencies.piRoot, subagentsRoot: f.dependencies.subagentsRoot,
  });
  assert.deepEqual(prepared.arms, ["S1-native", "S1-lite", "S2-lite", "S2-native"]);
  const env = { PI_NATIVE_LITE_BATCH_ROOT: batchRoot, PI_NATIVE_LITE_BATCH_ID: batchId, PI_NATIVE_LITE_ATTEMPT_ID: attemptId, PI_NATIVE_LITE_ARM: "S1-native", PI_NATIVE_LITE_SHARED_LEDGER: f.dependencies.expectedLedgerPath };
  const dependencyPath = join(batchRoot, "fixture-dependencies.json");
  await writeFile(dependencyPath, JSON.stringify(f.dependencies));
  const cliPath = join(process.cwd(), ".scratch/native-lite-scope-contract/arm-preflight.mjs");
  const preparedCli = spawnSync(process.execPath, [cliPath, "--fixture-dependencies", dependencyPath], {
    env: { ...process.env, ...env, NODE_ENV: "test", TMPDIR: process.env.TMPDIR }, encoding: "utf8",
  });
  assert.equal(preparedCli.status, 0, preparedCli.stderr);
  assert.match(preparedCli.stdout, /"ok":true/);
  assert.equal((await runArmPreflight({ env, dependencies: { ...f.dependencies, expectedLedgerPath: f.dependencies.expectedLedgerPath } })).ok, true);
  const mockPi = join(batchRoot, "tmp/mock-pi.mjs");
  const mockMarker = join(batchRoot, "tmp/mock-pi-marker.json");
  await mkdir(join(batchRoot, "tmp"), { recursive: true });
  await writeFile(mockPi, `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync(process.env.MOCK_PI_MARKER, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), tmpdir: process.env.TMPDIR, tmp: process.env.TMP, temp: process.env.TEMP, subagentTmp: process.env.PI_SUBAGENTS_TEMP_ROOT }));\nprocess.exit(23);\n`);
  await chmod(mockPi, 0o755);
  const runner = spawnSync(process.execPath, ["--experimental-strip-types", join(process.cwd(), ".scratch/native-lite-lifecycle/run-rpc-arm.mjs")], {
    cwd: join(batchRoot, "worktrees/S1-native"),
    env: { ...process.env, ...env, PI_NATIVE_LITE_MANIFEST: join(batchRoot, "manifests/S1-native.json"), PI_BIN: mockPi, MOCK_PI_MARKER: mockMarker, PI_NATIVE_LITE_RPC_HANDSHAKE_TIMEOUT_MS: "1000", PI_NATIVE_LITE_RPC_DEADLINE_MS: "3000" },
    encoding: "utf8",
  });
  const mockReceipt = await readFile(mockMarker, "utf8").catch(() => "");
  assert.ok(mockReceipt, `runner did not invoke isolated PI_BIN mock; exit=${runner.status}; stderr=${runner.stderr}`);
  const recorded = JSON.parse(mockReceipt);
  assert.equal(recorded.cwd, join(batchRoot, "worktrees/S1-native"));
  assert.equal(recorded.tmpdir, join(batchRoot, "tmp"));
  assert.equal(recorded.subagentTmp, join(batchRoot, "tmp"));
  assert.ok(recorded.argv.includes("tcuni/gpt-6.1-terra"));
  assert.equal(runner.status, 23, runner.stderr);
  env.PI_NATIVE_LITE_ARM = "S2-lite";
  assert.equal((await runArmPreflight({ env, dependencies: f.dependencies })).ok, true);
  const s1a = await readFile(join(batchRoot, "worktrees/S1-native/input/brief.md"));
  const s1b = await readFile(join(batchRoot, "worktrees/S1-lite/input/brief.md"));
  const s2a = await readFile(join(batchRoot, "worktrees/S2-lite/input/brief.md"));
  const s2b = await readFile(join(batchRoot, "worktrees/S2-native/input/brief.md"));
  assert.deepEqual(s1a, s1b);
  assert.deepEqual(s2a, s2b);
  assert.match(s1a.toString(), /nl-20261028T141500-0800-fixture-r2-<pair>-<mode>/);
  assert.doesNotMatch(s1a.toString(), /\{\{(?:BATCH_ROOT|BATCH_ID|ATTEMPT_ID|SANITIZED_BATCH_ID)\}\}/);
  assert.match(s2a.toString(), /nl-20261028T141500-0800-fixture-r2-<pair>-<mode>/);
  assert.match(s2a.toString(), /"role": "validator"[\s\S]*"agent": "oracle"/);
  assert.match(s2a.toString(), /3db1846aedb23a6b5552f69ffb70b552cdb94c7a/);
  await mkdir(join(batchRoot, "results", attemptId, "S1-native"), { recursive: true });
  await writeFile(join(batchRoot, "results", attemptId, "S1-native", "report.md"), "completed prior arm");
  const appended = sealed([...f.prefix, event(0.2, "append-after-first-arm")]);
  await writeFile(f.dependencies.expectedLedgerPath, JSON.stringify(appended));
  env.PI_NATIVE_LITE_ARM = "S1-lite";
  assert.equal((await runArmPreflight({ env, dependencies: f.dependencies })).ok, true);
  const cli = spawnSync(process.execPath, [join(process.cwd(), ".scratch/native-lite-scope-contract/arm-preflight.mjs")], {
    env: { ...process.env, PI_NATIVE_LITE_BATCH_ROOT: batchRoot, PI_NATIVE_LITE_BATCH_ID: "bad-id", PI_NATIVE_LITE_ATTEMPT_ID: attemptId, PI_NATIVE_LITE_ARM: "S1-native", PI_NATIVE_LITE_SHARED_LEDGER: f.dependencies.expectedLedgerPath },
    encoding: "utf8",
  });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /batchId format/);
});

test("real RPC-arm runner accepts all production and calibration brief templates before spawning only PI_BIN mock", async t => {
  const f = await fixture(t);
  const sourceBatch = join(f.root, "runner-source");
  await mkdir(join(sourceBatch, "config"), { recursive: true });
  await mkdir(join(sourceBatch, "common"), { recursive: true });
  await writeFile(join(sourceBatch, "config/runtime-lock.json"), JSON.stringify(f.lock));
  await writeFile(join(sourceBatch, "config/pi-runtime-manifest.json"), await readFile(join(f.root, "config/pi-runtime-manifest.json")));
  await writeFile(join(sourceBatch, "config/pi-subagents-runtime-manifest.json"), await readFile(join(f.root, "config/pi-subagents-runtime-manifest.json")));
  await writeFile(join(sourceBatch, "common/S2-candidate.diff"), f.commonDiff);

  const formal = `${process.cwd()}/.scratch/native-lite-scope-contract`;
  const calibration = join(formal, "calibration/inputs");
  const cases = [
    { id: "formal-s1", s1: join(formal, "S1-brief.review.md"), s2: join(formal, "S2-brief.review.md"), pair: "S1" },
    { id: "formal-s2", s1: join(formal, "S1-brief.review.md"), s2: join(formal, "S2-brief.review.md"), pair: "S2" },
    { id: "link", s1: join(calibration, "S1-link-task.md"), s2: join(calibration, "S2-topology-task.md"), pair: "S1" },
    { id: "topology", s1: join(calibration, "S1-link-task.md"), s2: join(calibration, "S2-topology-task.md"), pair: "S2" },
    ...["A", "B", "C", "D"].map(id => ({ id: `semantic-${id}`, s1: join(calibration, `semantic-${id === "A" ? "A-external-unknown" : id === "B" ? "B-answerable-omission" : id === "C" ? "C-unsupported-zero" : "D-reviewer-overreach"}.md`), s2: join(calibration, "S2-topology-task.md"), pair: "S1" })),
  ];
  const runnerPath = join(process.cwd(), ".scratch/native-lite-lifecycle/run-rpc-arm.mjs");
  const failures = [];
  let counter = 0;
  for (const item of cases) {
    const batchRoot = join(f.root, `runner-${item.id}`);
    const batchId = `20261028T15${String(counter).padStart(2, "0")}00+0800`;
    const attemptId = `r3-${item.id}`;
    await prepareBatch({
      root: batchRoot, batchId, attemptId, candidate: f.candidate, repo: join(f.root, "source"), sourceBatch,
      ledgerPath: f.dependencies.expectedLedgerPath, templates: { S1: item.s1, S2: item.s2 },
      settingsTemplatePath: join(f.worktrees["S2-lite"], ".pi/settings.json"), controllerRoot: f.dependencies.controllerRoot,
      modelsPath: f.dependencies.modelsPath, userSettingsPath: f.dependencies.userSettingsPath,
      piRoot: f.dependencies.piRoot, subagentsRoot: f.dependencies.subagentsRoot,
    });
    const mockPath = join(batchRoot, "tmp/mock-pi.mjs");
    await writeFile(mockPath, `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync(process.env.MOCK_PI_MARKER, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), tmpdir: process.env.TMPDIR, tmp: process.env.TMP, temp: process.env.TEMP, subagentTmp: process.env.PI_SUBAGENTS_TEMP_ROOT, mode: process.env.PI_PLANNER_ONLY_MODE, strict: process.env.PI_PLANNER_ONLY_STRICT, ledger: process.env.PI_NATIVE_LITE_BUDGET_LEDGER, attempt: process.env.PI_NATIVE_LITE_ATTEMPT_ID, fingerprint: process.env.PI_NATIVE_LITE_FINGERPRINT_LOG }));\nprocess.exit(23);\n`);
    await chmod(mockPath, 0o755);
    const arms = item.pair === "S1" ? ["S1-native", "S1-lite"] : ["S2-native", "S2-lite"];
    for (const arm of arms) {
      const marker = join(batchRoot, `tmp/${arm}.json`);
      const env = {
        ...process.env,
        PI_NATIVE_LITE_BATCH_ROOT: batchRoot,
        PI_NATIVE_LITE_BATCH_ID: batchId,
        PI_NATIVE_LITE_ATTEMPT_ID: attemptId,
        PI_NATIVE_LITE_SHARED_LEDGER: f.dependencies.expectedLedgerPath,
        PI_NATIVE_LITE_MANIFEST: join(batchRoot, "manifests", `${arm}.json`),
        PI_NATIVE_LITE_RPC_DEADLINE_MS: "3000",
        PI_NATIVE_LITE_RPC_HANDSHAKE_TIMEOUT_MS: "500",
        PI_BIN: mockPath,
        MOCK_PI_MARKER: marker,
        TMPDIR: process.env.TMPDIR,
        TMP: process.env.TMP,
        TEMP: process.env.TEMP,
      };
      const cwd = join(batchRoot, "worktrees", arm);
      const result = spawnSync(process.execPath, ["--experimental-strip-types", runnerPath], { cwd, env, encoding: "utf8", timeout: 5000 });
      const markerText = await readFile(marker, "utf8").catch(() => "");
      if (!markerText) {
        failures.push(`${item.id}/${arm}: runner exit ${result.status}, stderr=${result.stderr.trim()}`);
        continue;
      }
      const record = JSON.parse(markerText);
      if (result.status !== 23 || record.cwd !== cwd || record.tmpdir !== join(batchRoot, "tmp") || record.tmp !== join(batchRoot, "tmp") || record.temp !== join(batchRoot, "tmp") || record.subagentTmp !== join(batchRoot, "tmp")) failures.push(`${item.id}/${arm}: mock env/exit mismatch`);
      if (!record.argv.includes("--approve") || !record.argv.includes("--model") || record.argv[record.argv.indexOf("--model") + 1] !== "tcuni/gpt-6.1-terra" || !record.argv.includes("--session-id") || record.mode !== arm.slice(3) || record.strict !== (arm.endsWith("-lite") ? "true" : "false") || record.ledger !== f.dependencies.expectedLedgerPath || record.attempt !== attemptId) failures.push(`${item.id}/${arm}: mock command/config mismatch`);
      counter++;
    }
  }
  assert.deepEqual(failures, [], `real runner rejected or misconfigured PI_BIN mock:\n${failures.join("\n")}`);
  assert.equal(counter, 16);
});
