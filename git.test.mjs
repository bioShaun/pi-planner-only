import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_FINGERPRINT_PATHS, auditArgv, captureBase, classifyChangedPaths, gitCommit, parseStatusZ, runGitAudit, summarizeWork } from "./git.ts";
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
	for (const args of gitCalls.filter((a) => a[expected.length] === "diff" || a[expected.length] === "show" || a[expected.length] === "diff-tree")) {
		assert.ok(args.includes("--no-ext-diff") && args.includes("--no-textconv"), args.join(" "));
	}
}

// classifyChangedPaths: same fingerprint and not committed -> untouched; anything else -> touchedDirty.
{
	const before = { same: "aaa", edited: "bbb", removed: "ccc", committed: "ddd", created: "absent" };
	const now = { same: "aaa", edited: "bbb2", removed: "absent", committed: "ddd", created: "eee" };
	const r = classifyChangedPaths(before, now, new Set(["committed", "never-dirty"]));
	assert.deepEqual([...r.untouched], ["same"]);
	assert.deepEqual(r.touchedDirty, ["edited", "removed", "committed", "created"], "order follows before");
	assert.deepEqual(classifyChangedPaths({}, {}, new Set()), { untouched: new Set(), touchedDirty: [] });
	const missingNow = classifyChangedPaths({ a: "x" }, {}, new Set());
	assert.deepEqual([...missingNow.untouched], []);
	assert.deepEqual(missingNow.touchedDirty, ["a"], "a path with no current fingerprint is not untouched");
	const allSame = classifyChangedPaths({ a: "x", b: "y" }, { a: "x", b: "y" }, new Set());
	assert.deepEqual([...allSame.untouched], ["a", "b"]);
	assert.deepEqual(allSame.touchedDirty, []);
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

// status -z parsing: renames/copies carry the old path as an extra field.
assert.deepEqual(parseStatusZ(" M a.ts\0R  new.txt\0old.txt\0?? un.txt\0C  c2\0c1\0 D gone\0"), ["a.ts", "new.txt", "un.txt", "c2", "gone"]);
assert.deepEqual(parseStatusZ(""), []);
assert.deepEqual(parseStatusZ("x"), []);

// Fingerprints: one failing hash-object batch falls back to per-path hashing; too many paths skip it (old note).
{
	const script = (statusOut, hash) => {
		const calls = [];
		const run = async (args) => {
			calls.push(args);
			const a = args.slice(2);
			if (a[0] === "--version") return { stdout: "git version 1.8.3.1\n", code: 0 };
			if (a[0] === "rev-parse") return { stdout: a[1] === "--show-toplevel" ? "/w\n" : a[1] === "HEAD" ? "abc1234def\n" : "true\n", code: 0 };
			if (a[0] === "status") return { stdout: statusOut, code: 0 };
			if (a[0] === "hash-object") return hash(a.slice(2));
			return { stdout: "", code: 0 };
		};
		return { run, calls };
	};
	const perPath = script(" M keep.txt\0 D gone.txt\0", (paths) => paths.length > 1
		? { stdout: "", stderr: "fatal: could not open 'gone.txt'", code: 128 }
		: paths[0] === "keep.txt" ? { stdout: "1111\n", code: 0 } : { stdout: "", code: 128 });
	const b1 = await captureBase(perPath.run, "/w/sub");
	assert.deepEqual(b1.dirty, { "keep.txt": "1111", "gone.txt": "absent" });
	assert.equal(b1.root, "/w");
	assert.ok(perPath.calls.filter((c) => c[2] === "hash-object").every((c) => c.includes("--")));
	const s1 = await summarizeWork(perPath.run, "/w/sub", b1);
	assert.match(s1, /Unchanged by the child \(already uncommitted before; excluded above\): keep\.txt, gone\.txt/);

	const many = Array.from({ length: MAX_FINGERPRINT_PATHS + 1 }, (_, i) => `?? f${i}\0`).join("");
	const big = script(many, () => { throw new Error("must not hash"); });
	const b2 = await captureBase(big.run, "/w");
	assert.equal(b2.dirtyBefore, MAX_FINGERPRINT_PATHS + 1);
	assert.equal(b2.dirty, undefined);
	assert.match(await summarizeWork(big.run, "/w", b2), new RegExp(`Note: ${MAX_FINGERPRINT_PATHS + 1} path\\(s\\) were already uncommitted before this delegation; the diff includes them\\.`));
}

// git_commit names every staged file even when --stat output is clipped (fault injection: tiny show --stat).
{
	const calls = [];
	const run = async (args) => {
		calls.push(args);
		const a = args[0] === "--version" ? args : args.slice(args.indexOf("core.fsmonitor=false") + 1);
		if (a[0] === "--version") return { stdout: "git version 2.43.0\n", code: 0 };
		if (a[0] === "rev-parse") return { stdout: "true\n", code: 0 };
		if (a[0] === "add") return { stdout: "", code: 0 };
		if (a[0] === "commit") return { stdout: "[main abc1234] m", code: 0 };
		if (a[0] === "diff-tree") return { stdout: "a.ts\0b.ts\0unrelated.txt\0", code: 0 };
		if (a[0] === "show") return { stdout: "abc1234 m\n a.ts | 1 +\n", code: 0 };
		return { stdout: "", code: 0 };
	};
	const out = await gitCommit(run, "/w", "m");
	assert.equal(out.ok, true);
	assert.match(out.text, /Committed files \(3\): a\.ts, b\.ts, unrelated\.txt/);
	assert.match(out.text, /abc1234 m/);
	assert.equal(out.text.split("\n")[0], "abc1234 m");
	assert.ok(out.text.split("\n")[1].startsWith("Committed files (3):"));
	assert.ok(calls.some((c) => c.includes("diff-tree") && c.includes("--name-only") && c.includes("-z") && c.includes("HEAD")), JSON.stringify(calls));
	assert.ok(calls.some((c) => c.includes("diff-tree") && c.includes("--no-optional-locks")), JSON.stringify(calls));
	assert.ok(calls.every((c) => c[0] === "--version" || (c.includes("-c") && c.includes("core.fsmonitor=false"))), JSON.stringify(calls));
}

// git_commit falls back to the show stat when diff-tree cannot enumerate paths.
{
	const run = async (args) => {
		if (args[0] === "--version") return { stdout: "git version 2.43.0\n", code: 0 };
		const a = args.slice(args.indexOf("core.fsmonitor=false") + 1);
		if (a[0] === "rev-parse") return { stdout: "true\n", code: 0 };
		if (a[0] === "add") return { stdout: "", code: 0 };
		if (a[0] === "commit") return { stdout: "[main abc1234] m", code: 0 };
		if (a[0] === "diff-tree") return { stdout: "", stderr: "injected failure", code: 128 };
		if (a[0] === "show") return { stdout: "abc1234 m\n a.ts | 1 +\n", code: 0 };
		return { stdout: "", code: 0 };
	};
	const out = await gitCommit(run, "/w", "m");
	assert.equal(out.ok, true);
	assert.doesNotMatch(out.text, /Committed files/);
	assert.match(out.text, /abc1234 m\n a\.ts \| 1 \+/);
}

// git_commit caps the displayed paths at MAX_COMMIT_FILES while retaining the count and header.
{
	const paths = Array.from({ length: 105 }, (_, i) => `path${i + 1}.ts`).join("\0") + "\0";
	const run = async (args) => {
		if (args[0] === "--version") return { stdout: "git version 2.43.0\n", code: 0 };
		const a = args.slice(args.indexOf("core.fsmonitor=false") + 1);
		if (a[0] === "rev-parse") return { stdout: "true\n", code: 0 };
		if (a[0] === "add") return { stdout: "", code: 0 };
		if (a[0] === "commit") return { stdout: "[main abc1234] m", code: 0 };
		if (a[0] === "diff-tree") return { stdout: paths, code: 0 };
		if (a[0] === "show") return { stdout: "abc1234 m\n stat line\n", code: 0 };
		return { stdout: "", code: 0 };
	};
	const out = await gitCommit(run, "/w", "m");
	assert.equal(out.ok, true);
	assert.match(out.text, /Committed files \(105\):/);
	assert.match(out.text, /… 5 more/);
	assert.doesNotMatch(out.text, /path101\.ts/);
	assert.equal(out.text.split("\n")[0], "abc1234 m");
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
	// The child also edits pre.txt, which was already uncommitted: it stays listed, with the note.
	writeFileSync(join(dir, "pre.txt"), "dirty, edited by child\n");
	const summary = await summarizeWork(run, dir, base);
	assert.match(summary, /New commits:\n[0-9a-f]+ child commit/);
	assert.match(summary, /a\.txt/);
	assert.match(summary, /Untracked files \(2\):/);
	assert.match(summary, /new\.txt/);
	assert.match(summary, /1 path\(s\) were already uncommitted/);
	assert.match(summary, /changed again; their diff includes the earlier edits: pre\.txt/);
	assert.doesNotMatch(summary, /Unchanged by the child/);


	const committed = await gitCommit(run, dir, "accept", ["new.txt"]);
	assert.equal(committed.ok, true, committed.text);
	assert.match(committed.text, /accept/);
	assert.match(committed.text, /Committed files \(1\): new\.txt/);
	assert.match(g("status", "--porcelain"), / M a\.txt/);
	const audit = await runGitAudit(run, { operation: "log", maxEntries: 2 }, dir);
	assert.match(audit.text, /accept\n.*child commit/);

	// om09 run4: a user's uncommitted README.md that the child never touched is excluded, even from a subdirectory cwd.
	g("add", "-A");
	g("commit", "-qm", "reset");
	writeFileSync(join(dir, "README.md"), "user notes\n");
	g("add", "README.md");
	g("commit", "-qm", "readme");
	writeFileSync(join(dir, "README.md"), "user notes, uncommitted edit\n");
	writeFileSync(join(dir, "user-scratch.txt"), "mine\n");
	mkdirSync(join(dir, "sub"));
	const subBase = await captureBase(run, join(dir, "sub"));
	assert.equal(subBase.dirtyBefore, 2);
	assert.deepEqual(Object.keys(subBase.dirty).sort(), ["README.md", "user-scratch.txt"]);
	const quiet = await summarizeWork(run, join(dir, "sub"), subBase);
	assert.match(quiet, /^Tracked files: no changes\.$/m);
	assert.doesNotMatch(quiet, /Untracked files/);
	assert.match(quiet, /Unchanged by the child \(already uncommitted before; excluded above\): (README\.md, user-scratch\.txt|user-scratch\.txt, README\.md)/);
	writeFileSync(join(dir, "a.txt"), "child edit\n");
	writeFileSync(join(dir, "sub", "child.txt"), "c\n");
	const busy = await summarizeWork(run, join(dir, "sub"), subBase);
	assert.match(busy, /Diff since [0-9a-f]{8}:\n a\.txt/);
	assert.doesNotMatch(busy, /README\.md \|/);
	assert.match(busy, /Untracked files \(1\):\nsub\/child\.txt/);
	assert.doesNotMatch(busy, /already uncommitted before this delegation/);
	g("add", "-A");
	g("commit", "-qm", "child work");

	// Review blocker: a child that commits an already-dirty file without changing it must not hide it.
	writeFileSync(join(dir, "README.md"), "user notes, dirty again\n");
	const commitBase = await captureBase(run, dir);
	assert.deepEqual(Object.keys(commitBase.dirty), ["README.md"]);
	g("commit", "-qam", "child commits the user's README");
	const committedByChild = await summarizeWork(run, dir, commitBase);
	assert.match(committedByChild, /New commits:\n[0-9a-f]+ child commits the user's README/);
	assert.match(committedByChild, /README\.md \|/);
	assert.match(committedByChild, /changed again; their diff includes the earlier edits: README\.md/);
	assert.doesNotMatch(committedByChild, /Unchanged by the child/);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log("git.test: ok");
