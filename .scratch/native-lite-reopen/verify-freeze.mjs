import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const batchRoot = "/project/tmp/pi-native-lite-20261028T010659";
const ledgerPath = "/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json";
const sha256 = value => createHash("sha256").update(value).digest("hex");

const packageManifest = JSON.parse(await readFile(join(batchRoot, "config/pi-subagents-runtime-manifest.json"), "utf8"));
for (const file of packageManifest.files) {
	assert.equal(sha256(await readFile(join(packageManifest.packageRoot, file.path))), file.sha256, `pi-subagents ${file.path}`);
}
const piManifest = JSON.parse(await readFile(join(batchRoot, "config/pi-runtime-manifest.json"), "utf8"));
const piPackageRoot = "/home/tcuni-claw/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent";
for (const file of piManifest.files) {
	assert.equal(sha256(await readFile(join(piPackageRoot, file.path))), file.sha256, `Pi ${file.path}`);
}
assert.equal(sha256(await readFile(piManifest.launcher)), piManifest.launcherSha256);
assert.equal(sha256(await readFile(piManifest.entrypoint)), piManifest.entrypointSha256);

const ledgerBytes = await readFile(ledgerPath);
assert.equal(sha256(ledgerBytes), "dc9e71b30b194b79ce1a15c09500341e74b90ab17904e84e7ade55878616cf5e");
const ledger = JSON.parse(ledgerBytes);
assert.equal(ledger.events.length, 19);
assert.equal(ledger.reservedUsd, 4.6062337499999995);
const ledgerEventsSha256 = sha256(JSON.stringify(ledger.events));

const arms = ["S1-native", "S1-lite", "S2-lite", "S2-native"];
for (const arm of arms) {
	const cwd = join(batchRoot, "worktrees", arm);
	assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(), "f818cc91c98d6129a152fb28161e00d2f601e494");
	const tree = execFileSync("git", ["write-tree"], { cwd, encoding: "utf8" }).trim();
	const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { cwd, encoding: "buffer" });
	const paths = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd, encoding: "buffer" }).toString().split("\0").filter(Boolean).sort();
	const files = await Promise.all(paths.map(async path => ({ path, sha256: sha256(await readFile(join(cwd, path))) })));
	const manifest = JSON.parse(await readFile(join(batchRoot, `manifests/${arm}.json`), "utf8"));
	const workspaceSha256 = sha256(JSON.stringify({ tree, diffSha256: sha256(diff), files }));
	assert.equal(manifest.workspaceSha256, workspaceSha256, `${arm} workspace`);
	assert.equal(manifest.ledgerPrefixCount, ledger.events.length, `${arm} ledger count`);
	assert.equal(manifest.ledgerEventsSha256, ledgerEventsSha256, `${arm} ledger prefix`);
	assert.equal(manifest.ledgerReservedUsd, ledger.reservedUsd, `${arm} reserve total`);
	assert.equal(sha256(await readFile(join(cwd, ".pi/settings.json"))), manifest.settingsSha256, `${arm} settings`);
	for (const path of ["session.jsonl", "session.stderr", "control.jsonl", "request-fingerprints.jsonl", "subagent-cost.txt", "runner.stdout", "runner.stderr", "runner.meta", "session"]) {
		try { await access(join(batchRoot, "results/reopen-a1", arm, path)); throw new Error(`${arm} output already exists: ${path}`); }
		catch (error) { if (error.code !== "ENOENT") throw error; }
	}
}

const s1Native = await readFile(join(batchRoot, "worktrees/S1-native/input/brief.md"));
const s1Lite = await readFile(join(batchRoot, "worktrees/S1-lite/input/brief.md"));
const s2Lite = await readFile(join(batchRoot, "worktrees/S2-lite/input/brief.md"));
const s2Native = await readFile(join(batchRoot, "worktrees/S2-native/input/brief.md"));
assert.ok(s1Native.equals(s1Lite));
assert.ok(s2Lite.equals(s2Native));
const diff = await readFile(join(batchRoot, "common/S2-candidate.diff"));
assert.ok(diff.equals(await readFile(join(batchRoot, "worktrees/S2-lite/input/S2-candidate.diff"))));
assert.ok(diff.equals(await readFile(join(batchRoot, "worktrees/S2-native/input/S2-candidate.diff"))));

console.log(JSON.stringify({
	ledgerSha256: sha256(ledgerBytes),
	ledgerPrefixCount: ledger.events.length,
	piSubagentsFilesVerified: packageManifest.files.length,
	piFilesVerified: piManifest.files.length,
	briefs: { S1: sha256(s1Native), S2: sha256(s2Lite) },
	armsVerified: arms,
}, null, 2));
