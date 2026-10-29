import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const repo = resolve(import.meta.dirname);
const npm = process.env.npm_execpath || "/usr/bin/npm";

function runScenario(mode, tempMode = "outside") {
	const root = mkdtempSync(join(process.env.TMPDIR, "isolated-test-"));
	const bin = join(root, "bin");
	const log = join(root, "calls");
	const parent = join(root, "parent");
	const sentinel = join(parent, "sentinel");
	try {
	mkdirSync(bin);
	mkdirSync(parent);
	writeFileSync(sentinel, "keep");
	const repoLink = join(root, "repo-link");
	if (tempMode === "symlink") symlinkSync(repo, repoLink);
	writeFileSync(join(bin, "npm"), `#!/bin/sh
printf '%s|%s|%s\n' "$*" "$PWD" "$PI_SUBAGENTS_DIR" >> "$CALL_LOG"
if [ "$1" = ci ]; then
  [ "$MODE" = install-fail ] && exit 42
  if [ "$MODE" != missing-source ]; then
    mkdir -p node_modules/pi-subagents/src/api node_modules/pi-subagents/src/slash node_modules/pi-subagents/src/shared node_modules/pi-subagents/agents
    touch node_modules/pi-subagents/src/api/delegation.js node_modules/pi-subagents/src/slash/delegation-request.js node_modules/pi-subagents/src/slash/delegation-adapters.js node_modules/pi-subagents/src/shared/artifacts.js
  fi
  exit 0
fi
[ "$MODE" = release-fail ] && exit 37
exit 0
`, { mode: 0o755 });
	const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tempMode === "repo" ? repo : tempMode === "symlink" ? repoLink : parent, CALL_LOG: log, MODE: mode };
	if (tempMode === "unset") delete env.TMPDIR;
	const result = spawnSync(process.execPath, [npm, "run", "test:release:isolated"], { cwd: repo, encoding: "utf8", env });
	let calls = "";
	try { calls = readFileSync(log, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
	assert.ok(existsSync(parent), "operator parent directory remains");
	assert.equal(readFileSync(sentinel, "utf8"), "keep", "operator sentinel remains");
	assert.ok(!readdirSync(parent).some(name => name.startsWith("pi-planner-release-")), "isolated install directory is removed");
	if (calls.startsWith("ci ")) assert.equal(existsSync(calls.split("\n")[0].split("|")[1]), false, "actual install directory is removed");
	return { ...result, calls };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("isolated release installs outside the repo and passes its package path", () => {
	const result = runScenario("ok");
	assert.equal(result.status, 0, result.stderr);
	const [install, release] = result.calls.trim().split("\n").map(line => line.split("|"));
	assert.equal(install[0], "ci --no-audit --no-fund");
	assert.ok(!install[1].startsWith(repo + "/"), install[1]);
	assert.equal(release[0], "run test:release");
	assert.equal(release[1], repo);
	assert.equal(release[2], join(install[1], "node_modules", "pi-subagents"));
});

test("installation failure prevents release", () => {
	const result = runScenario("install-fail");
	assert.equal(result.status, 42, result.stderr);
	assert.match(result.calls, /^ci /);
	assert.doesNotMatch(result.calls, /run test:release/);
});

for (const tempMode of ["unset", "repo", "symlink"]) {
	test(`rejects ${tempMode} TMPDIR before installation`, () => {
		const result = runScenario("ok", tempMode);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, tempMode === "unset" ? /TMPDIR must name an existing directory outside the repository/ : /TMPDIR must be outside the repository/);
		assert.equal(result.calls, "");
	});
}

test("release failure propagates its exit status", () => {
	const result = runScenario("release-fail");
	assert.equal(result.status, 37, result.stderr);
	assert.match(result.calls, /run test:release/);
});

test("missing package source fails before release", () => {
	const result = runScenario("missing-source");
	assert.notEqual(result.status, 0);
	assert.match(result.calls, /^ci /);
	assert.doesNotMatch(result.calls, /run test:release/);
});
