import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BUDGET_USD, readLedger } from "../native-lite-lifecycle/budget-guard-core.mjs";
import { assertLedgerLockAbsent } from "../native-lite-budget-scope/freeze-contract.mjs";
import { ARM_IDS, workspaceSnapshot } from "./arm-preflight.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const runtimeFingerprint = lock => sha(Buffer.from(JSON.stringify({ controllerFiles: lock.controllerFiles, models: lock.models, runtime: lock.runtime, settings: lock.settings })));
const manifestCoreHash = manifest => {
  const core = { ...manifest };
  delete core.manifestCoreSha256;
  delete core.runtimeLockSha256;
  return sha(Buffer.from(JSON.stringify(core)));
};
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function renderBrief(template, { root, batchId, attemptId }) {
  const sanitizedBatchId = batchId.replace(/[^A-Za-z0-9._-]/g, "-");
  const rendered = template
    .replaceAll("{{BATCH_ROOT}}", root)
    .replaceAll("{{BATCH_ID}}", batchId)
    .replaceAll("{{ATTEMPT_ID}}", attemptId)
    .replaceAll("{{SANITIZED_BATCH_ID}}", sanitizedBatchId);
  assert.doesNotMatch(rendered, /\{\{(?:BATCH_ROOT|BATCH_ID|ATTEMPT_ID|SANITIZED_BATCH_ID)\}\}/, "brief template token was not replaced");
  return rendered;
}

export async function prepareBatch({ root, batchId, attemptId, candidate, repo, sourceBatch, ledgerPath, templates, settingsTemplatePath, controllerRoot, modelsPath, userSettingsPath, piRoot, subagentsRoot }) {
  assert.ok(root?.startsWith("/project/tmp/pi-native-lite-"));
  assert.match(batchId ?? "", /^\d{8}T\d{6}\+\d{4}$/);
  assert.match(attemptId ?? "", /^[A-Za-z0-9_-]+$/);
  assert.ok(candidate && repo && sourceBatch && ledgerPath && templates && settingsTemplatePath && controllerRoot && modelsPath && userSettingsPath && piRoot && subagentsRoot, "preparation inputs required");
  await assert.rejects(access(join(root, "worktrees")), "batch root must be new");
  await assertLedgerLockAbsent(ledgerPath);
  const ledgerBytes = await readFile(ledgerPath);
  const ledger = await readLedger(ledgerPath);
  const eventsSha256 = sha(Buffer.from(JSON.stringify(ledger.events)));
  const settings = await readFile(settingsTemplatePath);
  const s1 = renderBrief(await readFile(templates.S1, "utf8"), { root, batchId, attemptId });
  const s2 = renderBrief(await readFile(templates.S2, "utf8"), { root, batchId, attemptId });
  const commonDiff = await readFile(join(sourceBatch, "common", "S2-candidate.diff"));
  const sourceLock = JSON.parse(await readFile(join(sourceBatch, "config", "runtime-lock.json"), "utf8"));

  for (const dir of ["worktrees", "results", "manifests", "common", "config", "briefs", "logs", "tmp"]) await mkdir(join(root, dir), { recursive: true });
  await mkdir(join(root, "results", attemptId), { recursive: true });
  await writeFile(join(root, "common/S2-candidate.diff"), commonDiff, { flag: "wx" });
  for (const filename of ["pi-runtime-manifest.json", "pi-subagents-runtime-manifest.json"]) await copyFile(join(sourceBatch, "config", filename), join(root, "config", filename));
  await writeFile(join(root, "briefs/S1-brief.md"), s1, { flag: "wx" });
  await writeFile(join(root, "briefs/S2-brief.md"), s2, { flag: "wx" });

  for (const arm of ARM_IDS) {
    const worktree = join(root, "worktrees", arm);
    execFileSync("git", ["worktree", "add", "--detach", worktree, candidate], { cwd: repo, stdio: "pipe" });
    await mkdir(join(worktree, "input"), { recursive: true });
    await mkdir(join(worktree, ".pi"), { recursive: true });
    await writeFile(join(worktree, ".pi/settings.json"), settings, { flag: "wx" });
    await writeFile(join(worktree, "input/brief.md"), arm.startsWith("S1") ? s1 : s2, { flag: "wx" });
    if (arm.startsWith("S2")) await writeFile(join(worktree, "input/S2-candidate.diff"), commonDiff, { flag: "wx" });
  }

  const lock = sourceLock;
  lock.batchId = batchId;
  lock.attemptId = attemptId;
  lock.candidate = candidate;
  lock.budgetStopUsd = BUDGET_USD;
  lock.ledger = { path: ledgerPath, prefixCount: ledger.events.length, reservedUsd: ledger.reservedUsd, fileSha256: sha(ledgerBytes), eventsSha256 };
  for (const name of Object.keys(lock.controllerFiles)) lock.controllerFiles[name] = sha(await readFile(join(controllerRoot, name)));
  lock.models.fileSha256 = sha(await readFile(modelsPath));
  lock.settings.sha256 = sha(settings);
  lock.settings.runtimeUserSettingsSha256 = sha(await readFile(userSettingsPath));
  lock.runtime.loadedUserSettingsPath = userSettingsPath;
  lock.runtime.piInstallRoot = dirname(dirname(dirname(piRoot)));
  lock.runtime.piSubagentsRoot = subagentsRoot;
  lock.armManifestHashes = {};
  lock.workspaces = {};

  const manifests = {};
  for (const arm of ARM_IDS) {
    const worktree = join(root, "worktrees", arm);
    const pair = arm.slice(0, 2);
    const brief = await readFile(join(worktree, "input/brief.md"));
    const settingsBytes = await readFile(join(worktree, ".pi/settings.json"));
    const snapshot = await workspaceSnapshot(worktree);
    const workspace = { ...snapshot, briefSha256: sha(brief), settingsSha256: sha(settingsBytes) };
    lock.workspaces[arm] = workspace;
    const manifest = {
      version: 1, arm, pair, mode: arm.slice(3), candidate, batchId, attemptId,
      briefSha256: sha(brief), pairedBriefSha256: sha(brief), configSha256: sha(settingsBytes), settingsSha256: sha(settingsBytes), runtimeSha256: runtimeFingerprint(lock),
      gitTree: snapshot.tree, workspaceSha256: snapshot.workspaceSha256,
      ledgerPrefixCount: ledger.events.length, ledgerEventsSha256: eventsSha256, ledgerReservedUsd: ledger.reservedUsd,
      budgetStopUsd: BUDGET_USD, targetOutput: `results/${attemptId}/${arm}`,
      controllerSha256: lock.controllerFiles["run-rpc-arm.mjs"],
    };
    if (pair === "S2") manifest.s2DiffSha256 = sha(commonDiff);
    manifest.manifestCoreSha256 = manifestCoreHash(manifest);
    lock.armManifestHashes[arm] = manifest.manifestCoreSha256;
    manifests[arm] = manifest;
  }

  for (const [left, right] of [["S1-native", "S1-lite"], ["S2-lite", "S2-native"]]) {
    assert.deepEqual(await readFile(join(root, "worktrees", left, "input/brief.md")), await readFile(join(root, "worktrees", right, "input/brief.md")), `${left}/${right} brief mismatch`);
  }
  for (const arm of ["S2-lite", "S2-native"]) assert.deepEqual(await readFile(join(root, "worktrees", arm, "input/S2-candidate.diff")), commonDiff);

  const lockBytes = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`);
  await writeFile(join(root, "config/runtime-lock.json"), lockBytes, { flag: "wx" });
  for (const arm of ARM_IDS) {
    manifests[arm].runtimeLockSha256 = sha(lockBytes);
    await writeFile(join(root, "manifests", `${arm}.json`), `${JSON.stringify(manifests[arm], null, 2)}\n`, { flag: "wx" });
  }
  await writeFile(join(root, "config/preparation-summary.json"), `${JSON.stringify({ batchId, attemptId, candidate, arms: ARM_IDS, ledger: lock.ledger, manifests }, null, 2)}\n`, { flag: "wx" });
  return { root, batchId, attemptId, candidate, arms: ARM_IDS, manifests, runtimeLockSha256: sha(lockBytes), runtimeFingerprint: runtimeFingerprint(lock) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const root = process.env.PI_NATIVE_LITE_BATCH_ROOT;
  const batchId = process.env.PI_NATIVE_LITE_BATCH_ID;
  const attemptId = process.env.PI_NATIVE_LITE_ATTEMPT_ID;
  const repo = repoRoot;
  const sourceBatch = "/project/tmp/pi-native-lite-20261028T010659";
  const ledgerPath = "/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json";
  const controllerRoot = join(repo, ".scratch/native-lite-lifecycle");
  const userRoot = "/home/tcuni-claw/.pi/agent";
  const calibrationInputRoot = join(repo, ".scratch/native-lite-scope-contract/calibration/inputs");
  const piRoot = "/home/tcuni-claw/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent";
  const subagentsRoot = "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents";
  const candidate = "f818cc91c98d6129a152fb28161e00d2f601e494";
  const templatePath = (envValue, fallback) => {
    if (!envValue) return fallback;
    const selected = resolve(envValue);
    assert.ok(selected.startsWith(`${calibrationInputRoot}/`), "custom preparation templates must come from calibration/inputs");
    return selected;
  };
  const result = await prepareBatch({ root, batchId, attemptId, candidate, repo, sourceBatch, ledgerPath,
    templates: {
      S1: templatePath(process.env.PI_NATIVE_LITE_S1_TEMPLATE_PATH, join(repo, ".scratch/native-lite-scope-contract/S1-brief.review.md")),
      S2: templatePath(process.env.PI_NATIVE_LITE_S2_TEMPLATE_PATH, join(repo, ".scratch/native-lite-scope-contract/S2-brief.review.md")),
    },
    settingsTemplatePath: join(repo, ".scratch/native-lite-reopen/settings.json"), controllerRoot,
    modelsPath: join(userRoot, "models.json"), userSettingsPath: join(userRoot, "settings.json"),
    piRoot, subagentsRoot });
  console.log(JSON.stringify(result, null, 2));
}
