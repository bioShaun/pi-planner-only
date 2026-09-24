import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditArgv, captureBase, gitCommit, runGitAudit, summarizeWork } from "./git.ts";
import { noGit, tempDir } from "./test-helpers.mjs";

// Every call carries the safe prefix; diffs never run external drivers.
// --no-optional-locks only when `git --version` says >= 2.15; probed once per runner.
for (const [version, expected] of [
	[{ stdout: "git version 1.8.3.1\n", code: 0 }, ["-c", "core.fsmonitor=false"]],
	[{ stdout: "git version 2.43.0\n", code: 0 }, ["--no-optional-locks", "-c", "core.fsmonitor=false"]],
	[{ stdout: "", stderr: "boom", code: 1 }, ["-c", "core.fsmonitor=false"]],
	["throw", ["-c", "core.fsmonitor=false"]],
]) {
	const calls = [];
	const run = async (args) => {
		calls.push(args);
		if (args[0] === "--version") {
			if (version === "throw") throw new Error("spawn failed");
			return version;
		}
		return { stdout: "x", code: 0 };
	};
	for (const operation of ["status", "diff-stat", "diff", "log"]) await runGitAudit(run, { operation }, "/w");
	await gitCommit(run, "/w", "msg");
	await captureBase(run, "/w");
	assert.equal(calls.filter((a) => a[0] === "--version").length, 1, "probe once per runner");
	assert.deepEqual(calls[0], ["--version"]);
	const gitCalls = calls.slice(1);
	assert.ok(gitCalls.length >= 12);
	for (const args of gitCalls) assert.deepEqual(args.slice(0, expected.length), expected, JSON.stringify(version));
	for (const args of gitCalls) assert.ok(args.includes("-c") && args.includes("core.fsmonitor=false"), args.join(" "));
	assert.equal(gitCalls.some((a) => a.includes("--no-optional-locks")), expected.length === 3);
	for (const args of gitCalls) assert.ok(!args.some((a) => a.startsWith("--porcelain=")), args.join(" "));
	for (const args of gitCalls.filter((a) => a[expected.length] === "diff" || a[expected.length] === "show")) {
		assert.ok(args.includes("--no-ext-diff") && args.includes("--no-textconv"), args.join(" "));
	}
}

// Outside a work tree git_audit/git_commit say so instead of forwarding git's stderr.
{
	const audit = await runGitAudit(noGit, { operation: "status" }, "/nowhere");
	assert.deepEqual(audit, { ok: false, text: "/nowhere is not inside a git work tree; pass cwd=<repo>" });
	const commit = await gitCommit(noGit, "/nowhere", "m");
	assert.deepEqual(commit, { ok: false, text: "/nowhere is not inside a git work tree; pass cwd=<repo>" });
}

// Refusals: option-looking refs and paths never reach git.
for (const base of ["--output=/etc/x", "main", "HEAD@{1}", "HEAD~9999", "abc"]) {
	assert.equal(auditArgv({ operation: "diff", base }).ok, false, base);
}
for (const base of ["HEAD", "HEAD~3", "0123abc", "0123456789abcdef0123456789abcdef01234567"]) {
	assert.equal(auditArgv({ operation: "diff", base }).ok, true, base);
}
assert.equal(auditArgv({ operation: "status", path: "-rf" }).ok, false);
assert.equal(auditArgv({ operation: "status", path: " " }).ok, false);
assert.deepEqual(auditArgv({ operation: "diff", path: "a.ts" }).args.slice(-2), ["--", "a.ts"]);
assert.equal(auditArgv({ operation: "bogus" }).ok, false);
assert.ok(auditArgv({ operation: "log", maxEntries: 500 }).args.includes("-n50"));
assert.ok(auditArgv({ operation: "log", maxEntries: 0 }).args.includes("-n1"));
{
	let called = false;
	const run = async () => ((called = true), { stdout: "", code: 0 });
	assert.equal((await gitCommit(run, "/w", "  ")).ok, false);
	assert.equal((await gitCommit(run, "/w", "m", ["--all"])).ok, false);
	assert.equal(called, false);
}

// Real repository: summarizeWork reports commits, tracked diffs, untracked files.
const dir = tempDir("ppo-git-");
try {
	const g = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
	const run = async (args, cwd) => {
		try {
			return { stdout: execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), code: 0 };
		} catch (error) {
			return { stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? ""), code: error.status ?? 1 };
		}
	};
	const notRepo = await captureBase(run, dir);
	assert.equal(notRepo.head, undefined);
	assert.equal(notRepo.inWorkTree, false);
	assert.match(await summarizeWork(run, dir, notRepo), /is not a git work tree .* pass that repository as cwd/);

	g("init", "-q");
	// A work tree with no commits keeps the old wording, distinct from "not a work tree".
	const noCommits = await captureBase(run, dir);
	assert.equal(noCommits.inWorkTree, true);
	assert.equal(noCommits.head, undefined);
	const noCommitsText = await summarizeWork(run, dir, noCommits);
	assert.match(noCommitsText, /not a git repository \(or no commits\)/);
	assert.doesNotMatch(noCommitsText, /pass that repository as cwd/);

	g("config", "user.email", "t@example.com");
	g("config", "user.name", "t");
	writeFileSync(join(dir, "a.txt"), "one\n");
	g("add", "-A");
	g("commit", "-qm", "init");
	writeFileSync(join(dir, "pre.txt"), "dirty\n");
	const base = await captureBase(run, dir);
	assert.equal(base.dirtyBefore, 1);

	writeFileSync(join(dir, "a.txt"), "two\n");
	g("commit", "-qam", "child commit");
	writeFileSync(join(dir, "a.txt"), "three\n");
	writeFileSync(join(dir, "new.txt"), "n\n");
	const summary = await summarizeWork(run, dir, base);
	assert.match(summary, /New commits:\n[0-9a-f]+ child commit/);
	assert.match(summary, /a\.txt/);
	assert.match(summary, /Untracked files \(2\):/);
	assert.match(summary, /new\.txt/);
	assert.match(summary, /1 path\(s\) were already uncommitted/);

	const committed = await gitCommit(run, dir, "accept", ["new.txt"]);
	assert.equal(committed.ok, true, committed.text);
	assert.match(committed.text, /accept/);
	assert.match(g("status", "--porcelain"), / M a\.txt/);
	const audit = await runGitAudit(run, { operation: "log", maxEntries: 2 }, dir);
	assert.match(audit.text, /accept\n.*child commit/);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log("git.test: ok");
