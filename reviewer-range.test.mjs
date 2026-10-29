import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCwdLocks, runDelegation } from "./delegate.ts";
import { SUBAGENT_DELEGATION_REQUEST_EVENT as REQUEST, SUBAGENT_DELEGATION_RESPONSE_EVENT as RESPONSE } from "./subagent-delegation-contract.ts";
import { fakeBus, noGit, tempDir } from "./test-helpers.mjs";

const limits = { timeoutMs: 60000, maxTokens: 1000, startTimeoutMs: 40, cancelGraceMs: 40 };
function fixture() {
	const cwd = tempDir("review-range-followup-");
	const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	git("init", "-q");
	git("config", "user.name", "Test");
	git("config", "user.email", "test@example.com");
	writeFileSync(join(cwd, "file"), "one\n");
	git("add", "file");
	git("commit", "-qm", "initial");
	return { cwd, git, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}
async function review(cwd, base, options = {}) {
	const bus = fakeBus();
	bus.on(REQUEST, (req) => {
		options.onRequest?.(req);
		bus.emit(RESPONSE, { requestId: req.requestId, nodeId: req.nodeId, status: "completed", result: { kind: "text", text: "PASS" } });
	});
	const out = await runDelegation({ events: bus, git: options.git ?? noGit, ownerRunId: "owner", limits, locks: createCwdLocks() }, { role: "reviewer", cwd, base, task: options.task ?? "review" }, options.signal);
	return { out, requests: bus.emitted.filter(([event]) => event === REQUEST).map(([, req]) => req) };
}

if (process.env.REVIEW_RANGE_CASE === "patch-bytes" || !process.env.REVIEW_RANGE_CASE) {
	const f = fixture();
	try {
		const base = f.git("rev-parse", "HEAD");
		writeFileSync(join(f.cwd, "file"), "one  \n");
		f.git("commit", "-qam", "whitespace");
		const patch = execFileSync("git", ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--ignore-submodules=none", base, "HEAD", "--"], { cwd: f.cwd, encoding: "utf8" });
		const { out, requests } = await review(f.cwd, base);
		assert.equal(out.ok, true, out.text);
		const start = requests[0].task.indexOf("Complete patch:\n") + "Complete patch:\n".length;
		assert.equal(requests[0].task.slice(start, start + patch.length), patch);
		writeFileSync(join(f.cwd, "file"), "before\n\n  \n");
		f.git("commit", "-qam", "context base");
		const contextBase = f.git("rev-parse", "HEAD");
		writeFileSync(join(f.cwd, "file"), "after\n\n  \n");
		f.git("commit", "-qam", "context change");
		const contextPatch = execFileSync("git", ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--ignore-submodules=none", contextBase, "HEAD", "--"], { cwd: f.cwd, encoding: "utf8" });
		const contextResult = await review(f.cwd, contextBase);
		assert.equal(contextResult.out.ok, true, contextResult.out.text);
		const contextStart = contextResult.requests[0].task.indexOf("Complete patch:\n") + "Complete patch:\n".length;
		assert.equal(contextResult.requests[0].task.slice(contextStart, contextStart + contextPatch.length), contextPatch);
	} finally { f.cleanup(); }
}

if (process.env.REVIEW_RANGE_CASE === "hidden-nul" || !process.env.REVIEW_RANGE_CASE) {
	const f = fixture();
	try {
		writeFileSync(join(f.cwd, ".gitattributes"), "file diff\n");
		const lines = ["binary\0first", ...Array.from({ length: 24 }, (_, i) => `line ${i}`)];
		writeFileSync(join(f.cwd, "file"), lines.join("\n") + "\n");
		f.git("add", ".gitattributes", "file");
		f.git("commit", "-qm", "binary base");
		const base = f.git("rev-parse", "HEAD");
		lines[20] = "changed text";
		writeFileSync(join(f.cwd, "file"), lines.join("\n") + "\n");
		f.git("commit", "-qam", "change outside nul context");
		const patch = execFileSync("git", ["diff", base, "HEAD", "--"], { cwd: f.cwd });
		assert.equal(patch.includes(0), false);
		assert.match(patch.toString(), /changed text/);
		const { out, requests } = await review(f.cwd, base);
		assert.equal(requests.length, 0, `binary review launched: ${out.text}`);
		assert.match(out.text, /binary/i);
	} finally { f.cleanup(); }
}

if (process.env.REVIEW_RANGE_CASE === "custom-ref" || !process.env.REVIEW_RANGE_CASE) {
	const f = fixture();
	try {
		const base = f.git("rev-parse", "HEAD");
		f.git("update-ref", "refs/custom/base", base);
		writeFileSync(join(f.cwd, "file"), "two\n");
		f.git("commit", "-qam", "next");
		const { requests } = await review(f.cwd, "refs/custom/base");
		assert.equal(requests.length, 0, "custom namespace must be rejected");
	} finally { f.cleanup(); }
}

if (!process.env.REVIEW_RANGE_CASE) {
	for (const variant of ["added", "deleted", "invalid-utf8", "oversized"]) {
		const f = fixture();
		try {
			f.git("config", "core.autocrlf", "false");
			writeFileSync(join(f.cwd, ".gitattributes"), "payload diff\n");
			const content = variant === "invalid-utf8" ? Buffer.from([0xff, 10, ...Buffer.from("line\n".repeat(25))])
				: variant === "oversized" ? Buffer.from(`${"x".repeat(1024 * 1024)}\n${"line\n".repeat(25)}`)
				: Buffer.from(`nul\0first\n${"line\n".repeat(25)}`);
			if (variant !== "added") writeFileSync(join(f.cwd, "payload"), content);
			f.git("add", "-A");
			f.git("commit", "-qm", "base payload");
			const base = f.git("rev-parse", "HEAD");
			if (variant === "deleted") rmSync(join(f.cwd, "payload"));
			else if (variant === "added") writeFileSync(join(f.cwd, "payload"), content);
			else writeFileSync(join(f.cwd, "payload"), Buffer.concat([content, Buffer.from("changed\n")]));
			f.git("add", "-A");
			f.git("commit", "-qm", "change payload");
			const result = await review(f.cwd, base);
			assert.equal(result.requests.length, 0, variant);
			assert.match(result.out.text, variant === "oversized" ? /blob.*1 MiB/ : variant === "invalid-utf8" ? /blob cannot be inspected/ : /binary/, variant);
		} finally { f.cleanup(); }
	}
}

if (process.env.REVIEW_RANGE_CASE === "timeout" || !process.env.REVIEW_RANGE_CASE) {
	const f = fixture();
	const originalPath = process.env.PATH;
	const dir = tempDir("review-git-timeout-");
	try {
		const base = f.git("rev-parse", "HEAD");
		writeFileSync(join(f.cwd, "file"), "two\n");
		f.git("commit", "-qam", "second");
		const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
		writeFileSync(join(dir, "git"), `#!/bin/sh\nfor arg in "$@"; do [ "$arg" = cat-file ] && exec '${process.execPath}' -e 'setInterval(() => {}, 1000)'; done\nexec '${realGit}' "$@"\n`);
		chmodSync(join(dir, "git"), 0o755);
		process.env.PATH = `${dir}:${originalPath}`;
		const started = Date.now();
		const { out, requests } = await review(f.cwd, base);
		const elapsed = Date.now() - started;
		assert.ok(elapsed >= 29000 && elapsed < 40000, `actual timeout duration ${elapsed}ms`);
		assert.equal(requests.length, 0);
		assert.match(out.text, /git execution timed out/);
		assert.doesNotMatch(out.text, /output exceeded/);
		assert.ok(out.text.length < 2000);
		console.log(`reviewer-range actual git timeout: ${elapsed}ms`);
	} finally { process.env.PATH = originalPath; rmSync(dir, { recursive: true, force: true }); f.cleanup(); }
}

if (!process.env.REVIEW_RANGE_CASE || process.env.REVIEW_RANGE_CASE === "gitlink") {
	const f = fixture();
	try {
		const base = f.git("rev-parse", "HEAD");
		writeFileSync(join(f.cwd, "file"), "gitlink plus text\n");
		f.git("add", "file");
		f.git("update-index", "--add", "--cacheinfo", `160000,${base},nested`);
		f.git("commit", "-qm", "gitlink");
		f.git("clone", "-q", f.cwd, "nested");
		execFileSync("git", ["checkout", "-q", base], { cwd: join(f.cwd, "nested") });
		f.git("config", "diff.ignoreSubmodules", "all");
		assert.equal(f.git("status", "--porcelain", "--ignore-submodules=none"), "");
		assert.match(f.git("-c", "diff.ignoreSubmodules=none", "diff", "--raw", base, "HEAD"), /160000/);
		const { out, requests } = await review(f.cwd, base);
		assert.match(out.text, /gitlink/);
		assert.equal(requests.length, 0);
	} finally { f.cleanup(); }
}

if (!process.env.REVIEW_RANGE_CASE || process.env.REVIEW_RANGE_CASE === "no-base") {
	const f = fixture();
	try {
		const tree = f.git("rev-parse", "HEAD^{tree}");
		const other = f.git("commit-tree", tree, "-m", "unrelated");
		const { out, requests } = await review(f.cwd, other);
		assert.match(out.text, /no merge base/i);
		assert.equal(requests.length, 0);
	} finally { f.cleanup(); }
}

if (!process.env.REVIEW_RANGE_CASE) {
	const f = fixture();
	try {
		const common = f.git("rev-parse", "HEAD");
		f.git("checkout", "-qb", "base-branch");
		writeFileSync(join(f.cwd, "base-only"), "base only\n");
		f.git("add", "base-only");
		f.git("commit", "-qm", "base side");
		f.git("tag", "base-tag");
		f.git("checkout", "-qb", "review-branch", common);
		writeFileSync(join(f.cwd, "file"), "review side\n");
		f.git("commit", "-qam", "review side");
		for (const ref of ["base-branch", "base-tag"]) {
			const { out, requests } = await review(f.cwd, ref);
			assert.equal(out.ok, true, out.text);
			assert.ok(requests[0].task.includes(`merge-base ${common}`));
			assert.match(requests[0].task, /\+review side/);
			assert.doesNotMatch(requests[0].task, /base only|base-only/);
		}
		f.git("tag", "base-branch");
		f.git("config", "core.warnAmbiguousRefs", "false");
		const previousLocale = process.env.LC_ALL;
		process.env.LC_ALL = "fr_FR.UTF-8";
		const ambiguous = await review(f.cwd, "base-branch");
		if (previousLocale === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = previousLocale;
		assert.equal(ambiguous.requests.length, 0);
		assert.match(ambiguous.out.text, /ambiguous/i);
		const blob = f.git("rev-parse", "HEAD:file");
		f.git("tag", "blob-tag", blob);
		const noncommit = await review(f.cwd, "blob-tag");
		assert.equal(noncommit.requests.length, 0);
		assert.equal(noncommit.out.ok, false);
		const tree = f.git("rev-parse", "HEAD^{tree}");
		const a = f.git("commit-tree", tree, "-p", common, "-m", "a");
		const b = f.git("commit-tree", tree, "-p", common, "-m", "b");
		const left = f.git("commit-tree", tree, "-p", a, "-p", b, "-m", "left");
		const right = f.git("commit-tree", tree, "-p", b, "-p", a, "-m", "right");
		f.git("update-ref", "HEAD", right);
		assert.equal(f.git("merge-base", "--all", left, right).split("\n").length, 2);
		const multi = await review(f.cwd, left);
		assert.match(multi.out.text, /multiple merge bases/);
		assert.equal(multi.requests.length, 0);
	} finally { f.cleanup(); }
}

if (!process.env.REVIEW_RANGE_CASE) {
	const f = fixture();
	const originalPath = process.env.PATH;
	try {
		const base = f.git("rev-parse", "HEAD");
		writeFileSync(join(f.cwd, "file"), "two\n");
		f.git("commit", "-qam", "second");
		const dir = tempDir("review-git-fault-");
		try {
			const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
			writeFileSync(join(dir, "git"), `#!/bin/sh\nfor arg in "$@"; do [ "$arg" = status ] && { printf 'injected status failure\\n' >&2; exit 2; }; done\nexec '${realGit}' "$@"\n`);
			chmodSync(join(dir, "git"), 0o755);
			let injected = false;
			const pre = await review(f.cwd, base, { git: async () => { if (!injected) { injected = true; process.env.PATH = `${dir}:${originalPath}`; } return { stdout: "", code: 1 }; } });
			assert.equal(pre.requests.length, 0);
			assert.match(pre.out.text, /status failed/);
			process.env.PATH = originalPath;
			const post = await review(f.cwd, base, { onRequest: () => { process.env.PATH = `${dir}:${originalPath}`; } });
			assert.equal(post.out.ok, false);
			assert.match(post.out.text, /^Committed range review invalid.*status failed/);
		} finally { process.env.PATH = originalPath; rmSync(dir, { recursive: true, force: true }); }
	} finally { f.cleanup(); }
}

if (!process.env.REVIEW_RANGE_CASE) {
	const f = fixture();
	try {
		const base = f.git("rev-parse", "HEAD");
		writeFileSync(join(f.cwd, "file"), `${"x".repeat(32000)}\n`);
		f.git("commit", "-qam", "boundary");
		const bytes = Buffer.byteLength(execFileSync("git", ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--ignore-submodules=none", base, "HEAD", "--"], { cwd: f.cwd }));
		writeFileSync(join(f.cwd, "file"), `${"x".repeat(32000 + 32768 - bytes)}\n`);
		f.git("commit", "--amend", "-qam", "boundary");
		assert.equal(execFileSync("git", ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--ignore-submodules=none", base, "HEAD", "--"], { cwd: f.cwd }).length, 32768);
		assert.equal((await review(f.cwd, base)).out.ok, true);
		writeFileSync(join(f.cwd, "file"), `${"x".repeat(32001 + 32768 - bytes)}\n`);
		f.git("commit", "--amend", "-qam", "boundary");
		const over = await review(f.cwd, base);
		assert.match(over.out.text, /32 KiB/);
		assert.equal(over.requests.length, 0);
		writeFileSync(join(f.cwd, "file"), `${"x".repeat(1024 * 1024 + 100)}\n`);
		f.git("commit", "--amend", "-qam", "overflow");
		const overflow = await review(f.cwd, base);
		assert.match(overflow.out.text, /output exceeded 1 MiB execution limit/);
		assert.ok(overflow.out.text.length < 2000);
		assert.equal(overflow.requests.length, 0);
	} finally { f.cleanup(); }
}

if (!process.env.REVIEW_RANGE_CASE) {
	const f = fixture();
	try {
		const base = f.git("rev-parse", "HEAD");
		writeFileSync(join(f.cwd, "file"), "two\n");
		f.git("commit", "-qam", "second");
		const head = f.git("rev-parse", "HEAD");
		for (const action of ["dirty", "head", "cancel"]) {
			const ac = new AbortController();
			let changed = false;
			const probe = async () => {
				if (!changed) {
					changed = true;
					if (action === "dirty") writeFileSync(join(f.cwd, "untracked"), "x");
					if (action === "head") f.git("update-ref", "HEAD", base);
					if (action === "cancel") ac.abort();
				}
				return { stdout: "", code: 1 };
			};
			const result = await review(f.cwd, base, { git: probe, signal: ac.signal });
			assert.equal(result.requests.length, 0, action);
			assert.equal(result.out.ok, false, action);
			if (action === "dirty") rmSync(join(f.cwd, "untracked"));
			if (action === "head") f.git("update-ref", "HEAD", head);
		}
		const stale = await review(f.cwd, base, { onRequest: () => f.git("update-ref", "HEAD", base) });
		assert.equal(stale.out.ok, false);
		assert.match(stale.out.text, /^Committed range review invalid/);
		f.git("update-ref", "HEAD", head);
		const tooMuchTask = await review(f.cwd, base, { task: "x".repeat(1024 * 1024) });
		assert.equal(tooMuchTask.requests.length, 0);
		assert.match(tooMuchTask.out.text, /1 MiB/);
		const during = new AbortController();
		const pending = review(f.cwd, base, { signal: during.signal });
		setTimeout(() => during.abort(), 0);
		const cancelledDuring = await pending;
		assert.equal(cancelledDuring.requests.length, 0);
		assert.equal(cancelledDuring.out.ok, false);
	} finally { f.cleanup(); }
}

if (!process.env.REVIEW_RANGE_CASE) {
	const cwd = tempDir("review-range-sha256-");
	try {
		let initialized = false;
		try { execFileSync("git", ["init", "-q", "--object-format=sha256"], { cwd, stdio: "pipe" }); initialized = true; }
		catch (error) {
			console.log(`reviewer-range SHA-256 skipped: ${error.stderr?.toString().trim() || error.message}`);
		}
		const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
		if (initialized) {
			git("config", "user.name", "Test");
			git("config", "user.email", "test@example.com");
			writeFileSync(join(cwd, "file"), "one\n");
			git("add", "file");
			git("commit", "-qm", "one");
			const base = git("rev-parse", "HEAD");
			assert.equal(base.length, 64);
			writeFileSync(join(cwd, "file"), "two\n");
			git("commit", "-qam", "two");
			const result = await review(cwd, base);
			assert.equal(result.out.ok, true, result.out.text);
			assert.ok(result.requests[0].task.includes(base));
			console.log("reviewer-range SHA-256: ok");
		}
	} finally { rmSync(cwd, { recursive: true, force: true }); }
}

if (!process.env.REVIEW_RANGE_CASE) {
	const f = fixture();
	try {
		const base = f.git("rev-parse", "HEAD");
		writeFileSync(join(f.cwd, ".gitattributes"), "file diff\n");
		writeFileSync(join(f.cwd, "file"), Buffer.from([65, 0, 66, 10]));
		f.git("add", ".gitattributes", "file");
		f.git("commit", "-qm", "forced text");
		const result = await review(f.cwd, base);
		assert.match(result.out.text, /binary/);
		assert.equal(result.requests.length, 0);
	} finally { f.cleanup(); }
}

console.log("reviewer-range.test: ok");
