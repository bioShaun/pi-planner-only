import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as api from "./git.ts";

test("refsOnly rejects stash and notes for all ref fields", async () => {
	const dir = mkdtempSync(join(process.env.TMPDIR, "review-query-refs-"));
	const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	try {
		git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
		writeFileSync(join(dir, "file"), "initial\n"); git("add", "file"); git("commit", "-qm", "initial");
		writeFileSync(join(dir, "file"), "stashed\n"); git("stash", "push", "-qm", "fixture");
		git("update-ref", "refs/notes/x", git("rev-parse", "HEAD"));
		const command = async (cwd, args) => git(...args);
		for (const ref of ["stash", "refs/notes/x"]) for (const field of ["base", "head", "rev"]) {
			await assert.rejects(api.resolveReviewCommit(command, dir, ref, false, field), /branch, remote, tag/, `${field}: ${ref}`);
		}
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("whitelist rejects disallowed commands before invocation", async () => {
	assert.equal(typeof api.reviewQueryCommand, "function", "restricted command entry must be exported");
	let calls = 0;
	const invoke = async () => { calls++; return ""; };
	for (const command of ["config", "fetch"]) await assert.rejects(api.reviewQueryCommand(invoke, ".", [command]), /not allowed/);
	assert.equal(calls, 0);
	await api.reviewQueryCommand(invoke, ".", ["log"]);
	assert.equal(calls, 1);
});

test("log range has a path separator", async () => {
	const dir = mkdtempSync(join(process.env.TMPDIR, "review-query-log-"));
	const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	try {
		git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
		writeFileSync(join(dir, "file"), "x\n"); git("add", "file"); git("commit", "-qm", "initial");
		const head = git("rev-parse", "HEAD"); let logArgs;
		const runner = async (args, cwd, options) => { if (args.includes("log")) logArgs = args; return api.reviewQueryRunner(args, cwd, options); };
		await api.runReviewQuery({ operation: "log", base: head, head }, dir, { runner });
		assert.deepEqual(logArgs.slice(-2), [`${head}..${head}`, "--"]);
		await assert.rejects(api.runReviewQuery({ operation: "log", base: head, head: "-bad" }, dir), /invalid head ref/);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("invalid ref messages identify the field", async () => {
	const command = async () => { throw new Error("unexpected command"); };
	for (const field of ["base", "head", "rev"]) await assert.rejects(api.resolveReviewCommit(command, ".", "-bad", false, field), new RegExp(`invalid ${field} ref`));
});

assert.equal(typeof api.runReviewQuery, "function", "runReviewQuery must be exported");
assert.equal(typeof api.validateReviewPath, "function");
const cwd = mkdtempSync(join(process.env.TMPDIR, "review-query-"));
const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
try {
	git("init", "-q");
	git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
	writeFileSync(join(cwd, "file"), "first\n"); git("add", "."); git("commit", "-qm", "first");
	const base = git("rev-parse", "HEAD");
	git("branch", "base-branch"); git("tag", "base-tag"); git("update-ref", "refs/remotes/origin/x", base);
	writeFileSync(join(cwd, "file"), "second\n"); git("commit", "-qam", "second");
	const second = git("rev-parse", "HEAD");
	writeFileSync(join(cwd, "file"), "third\n"); git("commit", "-qam", "third");
	const head = git("rev-parse", "HEAD");
	const req = { operation: "log", base, head };
	const query = (request = req, options) => api.runReviewQuery(request, cwd, options);
	for (const path of ["", "../x", "/etc/passwd", "a/./b", "a/../b", "a\0b", "a\nb"]) assert.throws(() => api.validateReviewPath(path), undefined, path);
	for (const path of ["docs/-f.md", ":(top)foo", ":name"]) assert.doesNotThrow(() => api.validateReviewPath(path));
	for (const operation of ["diff", "show"]) await assert.rejects(query({ operation }), /not implemented/i);
	for (const value of ["--output=x", "-c", "--exec-path", "-D", base.slice(0, 8), "a..b", "HEAD@{1}", "HEAD^"]) {
		for (const field of ["base", "head"]) await assert.rejects(query({ ...req, [field]: value }), undefined, `${field} ${value}`);
	}
	for (const input of [{ ...req, unexpected: true }, { ...req, operation: "status" }, { ...req, base: "" }, { ...req, head: "" }, { ...req, base: 1 }, { ...req, offset: 0 }, { ...req, offset: 1.5 }, { ...req, limit: 0 }, { ...req, limit: 1001 }, { ...req, limit: 1.5 }]) await assert.rejects(query(input));
	for (const ref of ["base-branch", "base-tag", "origin/x", "HEAD~2", base]) assert.match(await query({ ...req, base: ref }), new RegExp(`base=${base}`));
	for (const object of [git("rev-parse", "HEAD^{tree}"), git("rev-parse", "HEAD:file")]) await assert.rejects(query({ ...req, base: object }));
	git("tag", "base-branch", base);
	await assert.rejects(query({ ...req, base: "base-branch" }), /ambiguous/i);
	git("tag", "-d", "base-branch");
	const page = await query({ ...req, limit: 1 });
	const id = /contentId=(sha256:[0-9a-f]{64})/.exec(page)?.[1]; assert.ok(id);
	assert.match(page, /lines 1-1 of 2; next offset: 2$/);
	assert.match(await query({ ...req, offset: 2, contentId: id }), /lines 2-2 of 2; next offset: none$/);
	for (const contentId of [undefined, "bad", `sha256:${"0".repeat(64)}`]) await assert.rejects(query({ ...req, offset: 2, contentId }), /contentId/i);
	await assert.rejects(query({ ...req, offset: 3, contentId: id }), /offset/i);
	assert.match(await query({ ...req, base: head }), /lines 0-0 of 0; next offset: none$/);
	const stable = await query({ ...req, base: "base-branch" });
	assert.equal(stable, await query(req));
	git("branch", "-f", "base-branch", second);
	await assert.rejects(query({ ...req, base: "base-branch", offset: 2, contentId: id }), /contentId/i);
	const tree = git("rev-parse", "HEAD^{tree}");
	const unrelated = git("commit-tree", tree, "-m", "unrelated");
	await assert.rejects(query({ ...req, base: unrelated }), /no merge base/i);
	const left = git("commit-tree", tree, "-p", base, "-m", "left");
	const right = git("commit-tree", tree, "-p", base, "-m", "right");
	const merge1 = git("commit-tree", tree, "-p", left, "-p", right, "-m", "merge1");
	const merge2 = git("commit-tree", tree, "-p", right, "-p", left, "-m", "merge2");
	await assert.rejects(query({ ...req, base: merge1, head: merge2 }), /multiple merge bases/i);
	const fork = await query({ ...req, base: left }); assert.match(fork, new RegExp(`merge-base=${base}`));
	const calls = [];
	const runner = async (args, dir, options) => { calls.push({ args, options }); return api.reviewQueryRunner(args, dir, options); };
	process.env.GIT_DIR = "/injected";
	try { await query({ ...req, base: "base-branch" }, { runner }); await query(req, { runner }); } finally { delete process.env.GIT_DIR; }
	assert.equal(calls.filter(c => c.args[0] === "--version").length, 1);
	assert.ok(calls.some(c => c.args.includes("check-ref-format")));
	assert.ok(calls.some(c => c.args.includes("merge-base")));
	for (const { args, options } of calls) {
		assert.equal(options.env.GIT_DIR, undefined); assert.equal(options.env.HOME, process.env.HOME);
		assert.deepEqual(Object.keys(options.env).filter(key => key.startsWith("GIT_")).sort(), ["GIT_PAGER", "GIT_TERMINAL_PROMPT"]);
		if (args[0] === "--version") continue;
		assert.deepEqual(args.slice(0, 11), ["--no-pager", "--no-lazy-fetch", "--no-replace-objects", "--literal-pathspecs", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.warnAmbiguousRefs=true", "-c", "core.attributesFile=/dev/null"]);
		const subcommand = args[11]?.startsWith("--attr-source=") ? args[12] : args[11];
		assert.ok(["rev-parse", "check-ref-format", "merge-base", "log"].includes(subcommand), args.join(" "));
		if (args.includes("log")) { assert.ok(args.includes(`--attr-source=${head}`)); assert.ok(args.includes("--no-show-signature")); }
	}
	for (const [version, ok] of [["git version 2.44.9", false], ["git version 2.45.0", true]]) {
		const versionRunner = (args, dir, options) => args[0] === "--version" ? Promise.resolve({ stdout: version, code: 0 }) : api.reviewQueryRunner(args, dir, options);
		if (ok) await query(req, { runner: versionRunner }); else await assert.rejects(query(req, { runner: versionRunner }), /2\.45/);
	}
	const failed = async args => args[0] === "--version" ? { stdout: "git version 2.51.0", code: 0 } : { stdout: "", stderr: "injected failure", code: 1 };
	await assert.rejects(query(req, { runner: failed }), /injected failure/);
	const controller = new AbortController(); controller.abort(); await assert.rejects(query(req, { signal: controller.signal }), /abort/i);
	const injected = body => async (args, dir, options) => args.includes("log") ? { stdout: body, code: 0 } : api.reviewQueryRunner(args, dir, options);
	await assert.rejects(query(req, { runner: injected("x".repeat(1024 * 1024 + 1)) }), /1 MiB/);
	await assert.rejects(query(req, { runner: injected("x".repeat(41 * 1024)) }), /line 1.*page/i);
	assert.match(await query(req, { runner: injected("last line") }), /last line \(no newline at end\)/);
	const lateAbort = new AbortController();
	const waiting = async (args, dir, options) => args.includes("log") ? new Promise(() => {}) : api.reviewQueryRunner(args, dir, options);
	const pending = query(req, { runner: waiting, signal: lateAbort.signal });
	setTimeout(() => lateAbort.abort(), 100);
	await assert.rejects(pending, /abort/i);
	const started = Date.now();
	await assert.rejects(query(req, { runner: waiting }), /timed out/i);
	assert.ok(Date.now() - started >= 29000);
	const bin = join(cwd, "bin"); mkdirSync(bin);
	const fakeGit = join(bin, "git");
	const fakeEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
	writeFileSync(fakeGit, `#!${process.execPath}\nprocess.stdout.write(Buffer.from([255]));\n`); chmodSync(fakeGit, 0o755);
	await assert.rejects(api.reviewQueryRunner([], cwd, { env: fakeEnv }), /encoded|utf-8/i);
	writeFileSync(fakeGit, `#!${process.execPath}\nprocess.stdout.write('x'.repeat(1024*1024+1));\n`);
	await assert.rejects(api.reviewQueryRunner([], cwd, { env: fakeEnv }), /1 MiB/i);
	writeFileSync(fakeGit, `#!${process.execPath}\nprocess.stderr.write('failure '+ 'x'.repeat(2000)); process.exitCode=1;\n`);
	await assert.rejects(api.reviewQueryRunner([], cwd, { env: fakeEnv }), error => error.message.includes("failure") && error.message.length < 1100);
	const shaDir = join(cwd, "sha256"); mkdirSync(shaDir);
	const shaGit = (...args) => execFileSync("git", args, { cwd: shaDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	shaGit("init", "-q", "--object-format=sha256"); shaGit("config", "user.name", "Test"); shaGit("config", "user.email", "test@example.com");
	writeFileSync(join(shaDir, "file"), "one\n"); shaGit("add", "."); shaGit("commit", "-qm", "one");
	const shaBase = shaGit("rev-parse", "HEAD");
	writeFileSync(join(shaDir, "file"), "two\n"); shaGit("commit", "-qam", "two");
	const shaHead = shaGit("rev-parse", "HEAD");
	assert.match(await api.runReviewQuery({ operation: "log", base: shaBase, head: shaHead }, shaDir), new RegExp(`base=${shaBase} head=${shaHead}`));
	const home = join(cwd, "home"); mkdirSync(home);
	writeFileSync(join(home, ".gitconfig"), "[i18n]\n\tlogOutputEncoding = ISO-8859-1\n");
	writeFileSync(join(cwd, "file"), "fourth\n"); git("commit", "-qam", "caf\u00e9");
	const unicodeHead = git("rev-parse", "HEAD");
	const oldHome = process.env.HOME, oldXdg = process.env.XDG_CONFIG_HOME;
	try {
		process.env.HOME = home; process.env.XDG_CONFIG_HOME = join(home, "xdg");
		await assert.rejects(query({ ...req, head: unicodeHead }), /encoded|utf-8/i);
	} finally {
		if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
		if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
	}
	console.log("reviewer-git 01a tests passed");
} finally { rmSync(cwd, { recursive: true, force: true }); }
