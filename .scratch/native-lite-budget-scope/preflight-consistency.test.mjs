import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertControllerFiles, assertManifestBrief, assertRuntimeUserSettings, assertSessionIdentityExample, assertWorkspaceLock } from "./freeze-contract.mjs";

const root = process.env.PI_NATIVE_LITE_BATCH_ROOT ?? "/project/tmp/pi-native-lite-20261028T111239+0800";
const batchId = process.env.PI_NATIVE_LITE_BATCH_ID ?? "20261028T111239+0800";
const attemptId = process.env.PI_NATIVE_LITE_ATTEMPT_ID ?? "compare-a2";
const sha = value => createHash("sha256").update(value).digest("hex");
const arms = ["S1-native", "S1-lite", "S2-lite", "S2-native"];
const lock = JSON.parse(await readFile(join(root, "config/runtime-lock.json"), "utf8"));

async function actualSnapshot(arm) {
  const cwd = join(root, "worktrees", arm);
  const tree = execFileSync("git", ["write-tree"], { cwd, encoding: "utf8" }).trim();
  const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { cwd });
  const paths = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd }).toString().split("\0").filter(Boolean).sort();
  const files = [];
  for (const path of paths) files.push({ path, sha256: sha(await readFile(join(cwd, path))) });
  const brief = await readFile(join(cwd, "input/brief.md"));
  return { tree, diffSha256: sha(diff), files, workspaceSha256: sha(Buffer.from(JSON.stringify({ tree, diffSha256: sha(diff), files }))), briefSha256: sha(brief), settingsSha256: sha(await readFile(join(cwd, ".pi/settings.json"))), briefText: brief.toString() };
}

test("runtime lock workspaces bind each new arm's actual tree, inputs, and brief", async () => {
  const snapshots = {};
  for (const arm of arms) {
    const actual = await actualSnapshot(arm);
    const manifest = JSON.parse(await readFile(join(root, "manifests", `${arm}.json`), "utf8"));
    assertManifestBrief(manifest, await readFile(join(root, "worktrees", arm, "input/brief.md")));
    snapshots[arm] = { ...actual };
  }
  assertWorkspaceLock(lock, snapshots);
});

test("brief examples use the runner's sanitized batch and attempt identity", async () => {
  for (const pair of ["S1", "S2"]) {
    const brief = await readFile(join(root, "briefs", `${pair}-brief.md`), "utf8");
    assertSessionIdentityExample(brief, batchId, attemptId);
  }
});

test("controller lock binds every actual frozen controller file", async () => {
  const source = "/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-lifecycle";
  const actual = {};
  for (const [name, expected] of Object.entries(lock.controllerFiles)) {
    actual[name] = sha(await readFile(join(source, name)));
    assert.equal(actual[name], expected, name);
  }
  assertControllerFiles(lock, actual);
});

test("runtime user settings lock points at the settings file loaded by this runtime", async () => {
  const loadedSettingsPath = "/home/tcuni-claw/.pi/agent/settings.json";
  assertRuntimeUserSettings(lock, loadedSettingsPath, await readFile(loadedSettingsPath));
});

test("workspace lock validator rejects a fault-injected stale workspace hash", async () => {
  const actual = await actualSnapshot("S1-native");
  const snapshots = { "S1-native": actual };
  assertWorkspaceLock(lock, snapshots);
  const damagedLock = structuredClone(lock);
  damagedLock.workspaces["S1-native"].workspaceSha256 = "0".repeat(64);
  assert.throws(() => assertWorkspaceLock(damagedLock, snapshots), /workspaceSha256/);
});
