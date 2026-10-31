import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
	for (const args of [["config"], ["fetch"], ["show", "HEAD"], ["show", "--format=%H", "-s"], ["cat-file", "-p", "HEAD"], ["cat-file", "--batch"], ["cat-file", "--textconv", "HEAD:x"]]) {
		await assert.rejects(api.reviewQueryCommand(invoke, ".", args), /not allowed/, args.join(" "));
	}
	assert.equal(calls, 0);
	await api.reviewQueryCommand(invoke, ".", ["log"]);
	await api.reviewQueryCommand(invoke, ".", ["show", "-s", "--no-show-signature", "HEAD"]);
	await api.reviewQueryCommand(invoke, ".", ["cat-file", "blob", "0123"]);
	assert.equal(calls, 3);
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

test("show reads historical objects and first-parent statistics safely", async () => {
	const dir = mkdtempSync(join(process.env.TMPDIR, "review-show-"));
	const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	try {
		git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
		mkdirSync(join(dir, "docs")); const content = Array.from({ length: 22 }, (_, i) => `多字节 ${i}`).join("\n");
		writeFileSync(join(dir, "docs", "file"), content); for (const name of ["a", "b", "c"]) writeFileSync(join(dir, "docs", name), name);
		writeFileSync(join(dir, "binary"), "a\0b\n"); symlinkSync("docs/file", join(dir, "link"));
		git("add", "."); git("commit", "-qm", "root"); const root = git("rev-parse", "HEAD");
		writeFileSync(join(dir, "docs", "file"), "committed change\n"); writeFileSync(join(dir, "other"), "other\n"); git("add", "."); git("update-index", "--add", "--cacheinfo", `160000,${root},nested`); git("commit", "-qm", "second");
		const second = git("rev-parse", "HEAD"); const tree = git("rev-parse", "HEAD^{tree}");
		const merge = git("commit-tree", tree, "-p", root, "-p", second, "-m", "merge");
		writeFileSync(join(dir, "docs", "file"), "working tree change\n");
		const calls = []; const runner = async (args, cwd, options) => { calls.push(args); return api.reviewQueryRunner(args, cwd, options); };
		const query = (request, options = {}) => api.runReviewQuery({ operation: "show", ...request }, dir, { runner, ...options });
		let next = 1, id, assembled = "";
		while (next) {
			const page = await query({ rev: root, path: "docs/file", offset: next, limit: 5, ...(id ? { contentId: id } : {}) });
			id ??= /contentId=(sha256:[0-9a-f]{64})/.exec(page)?.[1]; assert.ok(id);
			const body = page.split("\n").slice(1, -1).join("\n");
			const noNewline = body.endsWith(" (no newline at end)");
			assembled += noNewline ? body.slice(0, -" (no newline at end)".length) : `${body}\n`;
			next = Number(/next offset: (\d+)$/.exec(page)?.[1]);
		}
		assert.equal(assembled, content);
		for (const contentId of [undefined, "bad", `sha256:${"0".repeat(64)}`]) await assert.rejects(query({ rev: root, path: "docs/file", offset: 2, contentId }), /contentId/i);
		await assert.rejects(query({ rev: second, path: "docs/file", offset: 2, contentId: id }), /contentId/i);
		const link = await query({ rev: root, path: "link" }); assert.match(link, /symlink/i); assert.match(link, /docs\/file/);
		const directory = await query({ rev: root, path: "docs", limit: 1 });
		const dirId = /contentId=(sha256:[0-9a-f]{64})/.exec(directory)?.[1]; assert.ok(dirId);
		const dirNext = Number(/next offset: (\d+)$/.exec(directory)?.[1]); assert.ok(dirNext > 1);
		assert.match(await query({ rev: root, path: "docs", offset: dirNext, contentId: dirId }), /file/);
		await assert.rejects(query({ rev: root, path: "binary" }), /binary/i);
		await assert.rejects(query({ rev: second, path: "nested" }), /gitlink/i);
		await assert.rejects(query({ rev: root, path: "missing" }), /missing|not found/i);
		for (const request of [{ rev: root, base: root }, { rev: root, head: root }, {}, { rev: "-bad" }]) await assert.rejects(query(request));
		for (const operation of ["log", "diff"]) await assert.rejects(api.runReviewQuery({ operation, base: root, head: second, rev: root }, dir), /rev/i);
		const rootOut = await query({ rev: root }); assert.match(rootOut, /parent=empty-tree/); assert.match(rootOut, /docs\/file/); assert.doesNotMatch(rootOut, /diff --git|@@/);
		const normal = await query({ rev: second }); assert.match(normal, new RegExp(`parent=${root}`)); assert.match(normal, /other/);
		const mergeOut = await query({ rev: merge }); assert.match(mergeOut, new RegExp(`parent=${root}`)); assert.match(mergeOut, /other/); assert.doesNotMatch(mergeOut, /diff --git|@@/);
		for (const [rev, output] of [[second, normal], [merge, mergeOut]]) {
			for (const line of git("diff", "--numstat", root, rev, "--").split("\n")) {
				const [added, deleted, path] = line.split("\t");
				assert.ok(output.includes(`${added === "-" ? "-" : `+${added}`} ${deleted === "-" ? "-" : `-${deleted}`} ${JSON.stringify(path)}`), line);
			}
		}
		const marker = join(dir, "gpg-marker"), script = join(dir, "gpg"); writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n`); chmodSync(script, 0o755);
		git("config", "log.showSignature", "true"); git("config", "gpg.program", script);
		const signed = `tree ${tree}\nparent ${root}\nauthor Test <test@example.com> 1700000000 +0000\ncommitter Test <test@example.com> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n fake\n -----END PGP SIGNATURE-----\n\nsigned\n`;
		const signedOid = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: dir, encoding: "utf8", input: signed }).trim();
		git("show", "-s", "--show-signature", signedOid); assert.ok(existsSync(marker), "signature fixture must invoke gpg without the guard"); rmSync(marker);
		await query({ rev: signedOid }); assert.equal(existsSync(marker), false);
		for (const args of calls) {
			if (args[0] === "--version") continue;
			assert.deepEqual(args.slice(0, 5), ["--no-pager", "--no-lazy-fetch", "--no-replace-objects", "--literal-pathspecs", "--no-optional-locks"]);
			const i = args[11]?.startsWith("--attr-source=") ? 12 : 11; const subcommand = args[i]; assert.ok(api.REVIEW_QUERY_COMMANDS.includes(subcommand));
			if (["show", "ls-tree", "cat-file", "diff"].includes(subcommand)) assert.ok(args[11].startsWith("--attr-source="));
			if (subcommand === "show") { assert.ok(args.includes("-s")); assert.ok(args.includes("--no-show-signature")); }
			if (subcommand === "diff") { assert.ok(args.includes("--numstat")); assert.ok(!args.some(a => a === "-p" || a === "--patch" || a.startsWith("--unified"))); }
		}
		for (const variant of ["multiple", "wrong-path", "invalid-mode"]) {
			const faulty = async (args, cwd, options) => {
				const result = await api.reviewQueryRunner(args, cwd, options);
				if (args.includes("ls-tree")) {
					if (variant === "multiple") result.stdout += result.stdout;
					if (variant === "wrong-path") result.stdout = result.stdout.replace("docs/file\0", "other\0");
					if (variant === "invalid-mode") result.stdout = result.stdout.replace(/^100644/, "999999");
				}
				return result;
			};
			await assert.rejects(query({ rev: root, path: "docs/file" }, { runner: faulty }), /invalid|multiple/i, variant);
		}
		for (const variant of ["parents", "object-format", "numstat-unterminated", "numstat-mixed", "tree-listing"]) {
			const faulty = async (args, cwd, options) => {
				const result = await api.reviewQueryRunner(args, cwd, options);
				if (variant === "parents" && args.includes("--format=%P")) result.stdout = "not-a-sha\n";
				if (variant === "object-format" && args.includes("--show-object-format")) result.stdout = "unsupported\n";
				if (variant === "numstat-unterminated" && args.includes("--numstat")) result.stdout = result.stdout.slice(0, -1);
				if (variant === "numstat-mixed" && args.includes("--numstat")) result.stdout = "-\t1\tfile\0";
				if (variant === "tree-listing" && args.includes("ls-tree") && !args.includes("--")) result.stdout = "malformed\0";
				return result;
			};
			await assert.rejects(query({ rev: root, ...(variant === "tree-listing" ? { path: "docs" } : {}) }, { runner: faulty }), /invalid|unsupported/i, variant);
		}
		console.log(`show stats sample:\n${normal}\nshow path sample:\n${link}`);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("show root statistics support SHA-256 repositories", async () => {
	const dir = mkdtempSync(join(process.env.TMPDIR, "review-show-sha256-"));
	const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	try {
		git("init", "-q", "--object-format=sha256"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
		writeFileSync(join(dir, "file"), "sha256\n"); git("add", "."); git("commit", "-qm", "root"); const rev = git("rev-parse", "HEAD");
		const out = await api.runReviewQuery({ operation: "show", rev }, dir); assert.match(out, /parent=empty-tree/); assert.match(out, /file/);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("file diff returns safe complete patches and refuses unsafe inputs", async () => {
	const dir = mkdtempSync(join(process.env.TMPDIR, "review-file-diff-"));
	const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 5 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
	const direct = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 5 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
	try {
		git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
		writeFileSync(join(dir, "file"), "old\n");
		writeFileSync(join(dir, "oldbinary"), "old\0binary\n");
		writeFileSync(join(dir, "oversize"), ("a".repeat(200) + "\n").repeat(3000));
		git("add", "."); git("commit", "-qm", "base"); const base = git("rev-parse", "HEAD");
		git("branch", "base-branch", base);
		mkdirSync(join(dir, "docs"));
		writeFileSync(join(dir, "docs", "-f.md"), "dash\n");
		writeFileSync(join(dir, ":(top)foo"), "literal magic\n"); writeFileSync(join(dir, ":name"), "colon\n");
		writeFileSync(join(dir, "file"), "new\n"); writeFileSync(join(dir, "empty"), "");
		writeFileSync(join(dir, "nonewline"), "without newline");
		writeFileSync(join(dir, ".gitattributes"), "forced diff\ngitbinary -diff\n");
		writeFileSync(join(dir, "forced"), "nul\0hidden\n"); writeFileSync(join(dir, "binary"), "nul\0binary\n");
		writeFileSync(join(dir, "oldbinary"), "now text\n"); writeFileSync(join(dir, "gitbinary"), "text marked binary\n");
		writeFileSync(join(dir, "long"), "l".repeat(41000) + "\n");
		writeFileSync(join(dir, "bigblob"), ("c".repeat(100) + "\n").repeat(10500));
		writeFileSync(join(dir, "oversize"), ("b".repeat(200) + "\n").repeat(3000));
		for (let i = 0; i < 3; i++) writeFileSync(join(dir, `large${i}`), ("多字节" + "x".repeat(190) + "\n").repeat(2000));
		git("add", "."); git("update-index", "--add", "--cacheinfo", `160000,${base},nested`); git("commit", "-qm", "change");
		const head = git("rev-parse", "HEAD");
		const calls = []; const runner = async (args, cwd, options) => { calls.push(args); return api.reviewQueryRunner(args, cwd, options); };
		const req = { operation: "diff", base, head }; const query = (path, extra = {}) => api.runReviewQuery({ ...req, path, ...extra }, dir, { runner });
		const flags = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--ignore-submodules=none", "--no-relative", "--unified=3", "--diff-algorithm=myers", "--indent-heuristic", "--src-prefix=a/", "--dst-prefix=b/"];
		const read = async path => {
			let next = 1, id, result = "";
			while (next) {
				const page = await query(path, { offset: next, limit: 300, ...(id ? { contentId: id } : {}) });
				id ??= /contentId=(sha256:[a-f0-9]{64})/.exec(page)?.[1]; assert.ok(id);
				result += page.split("\n").slice(1, -1).join("\n") + "\n";
				next = Number(/next offset: (\d+)$/.exec(page)?.[1]);
			}
			return result;
		};
		for (const path of ["file", "docs/-f.md", ":(top)foo", ":name", "empty", "nonewline", "large0", "large1", "large2"]) {
			const expected = direct("--literal-pathspecs", "diff", ...flags, base, head, "--", path);
			assert.equal(await read(path), expected, path);
		}
		assert.ok(Buffer.byteLength(direct("diff", base, head, "--", "large0", "large1", "large2")) > 1024 * 1024);
		for (const path of ["", "../x", "/etc/passwd", "a/./b"]) await assert.rejects(query(path), /path/i);
		await assert.rejects(api.runReviewQuery({ operation: "log", base, head, path: "file" }, dir), /path/i);
		for (const path of ["forced", "binary", "oldbinary", "gitbinary", "nested"]) await assert.rejects(query(path), new RegExp(`${path}.*${path === "nested" ? "gitlink" : "binary"}`, "i"));
		await assert.rejects(read("long"), /line \d+.*long/i);
		await assert.rejects(query("bigblob"), /bigblob.*1 MiB|1 MiB.*bigblob/i);
		await assert.rejects(query("oversize"), /oversize.*1 MiB|1 MiB.*oversize/i);
		const page = await query("large0", { limit: 2 }); const id = /contentId=(sha256:[a-f0-9]{64})/.exec(page)[1];
		for (const contentId of [undefined, "bad", `sha256:${"0".repeat(64)}`]) await assert.rejects(query("large0", { offset: 2, contentId }), /contentId/i);
		git("branch", "-f", "base-branch", head);
		await assert.rejects(query("large0", { base: "base-branch", offset: 2, contentId: id }), /contentId/i);
		assert.match(await query("not-changed"), /lines 0-0 of 0; next offset: none/);
		const patchCalls = calls.filter(args => args.includes("--unified=3")); assert.ok(patchCalls.length);
		for (const args of patchCalls) {
			for (const flag of flags) assert.ok(args.includes(flag), flag);
			assert.ok(args.includes(`--attr-source=${head}`)); assert.equal(args.at(-2), "--");
		}
		for (const oid of [git("rev-parse", `${base}:file`), git("rev-parse", `${head}:file`)]) assert.ok(calls.some(args => args.includes("cat-file") && args.includes("blob") && args.includes(oid)), oid);
		for (const args of calls.filter(args => args[0] !== "--version")) {
			const subcommand = args[11]?.startsWith("--attr-source=") ? args[12] : args[11]; assert.ok(api.REVIEW_QUERY_COMMANDS.includes(subcommand));
		}
		for (const variant of ["raw-malformed", "raw-wrong-path", "numstat-malformed", "numstat-wrong-path", "numstat-mixed"]) {
			const faulty = async (args, cwd, options) => {
				const result = await api.reviewQueryRunner(args, cwd, options);
				if (args.includes("--raw") && variant === "raw-malformed") result.stdout = "malformed\0file\0";
				if (args.includes("--raw") && variant === "raw-wrong-path") result.stdout = result.stdout.replace("\0file\0", "\0other\0");
				if (args.includes("--numstat") && variant === "numstat-malformed") result.stdout = "malformed\0";
				if (args.includes("--numstat") && variant === "numstat-wrong-path") result.stdout = result.stdout.replace("\tfile\0", "\tother\0");
				if (args.includes("--numstat") && variant === "numstat-mixed") result.stdout = "-\t0\tfile\0";
				return result;
			};
			await assert.rejects(api.runReviewQuery({ ...req, path: "file" }, dir, { runner: faulty }), /file.*invalid/i, variant);
		}
		const example = await query("file");
		const marker = join(dir, "marker"), script = join(dir, "external"); writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n`); chmodSync(script, 0o755);
		git("config", "diff.external", script); git("config", "diff.test.textconv", script); git("config", "diff.noprefix", "true"); git("config", "diff.algorithm", "patience"); git("config", "diff.mnemonicPrefix", "true");
		writeFileSync(join(dir, ".git", "info", "attributes"), "file diff=test\n");
		assert.equal(await query("file"), example); assert.throws(() => execFileSync("test", ["-e", marker]));
		console.log(`file diff sample:\n${example}`);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("file patch matches prepareReviewRange on the default configuration", async () => {
	const dir = mkdtempSync(join(process.env.TMPDIR, "review-file-range-"));
	const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	try {
		git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
		writeFileSync(join(dir, "file"), "old\n"); git("add", "."); git("commit", "-qm", "base"); const base = git("rev-parse", "HEAD");
		writeFileSync(join(dir, "file"), "new\n"); git("commit", "-qam", "head");
		const range = await api.prepareReviewRange(dir, base);
		const page = await api.runReviewQuery({ operation: "diff", base, head: range.head, path: "file" }, dir);
		assert.equal(page.split("\n").slice(1, -1).join("\n") + "\n", range.diff);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("file diff does not fetch missing promisor blobs", async () => {
	const dir = mkdtempSync(join(process.env.TMPDIR, "review-promisor-")); const source = join(dir, "source"), clone = join(dir, "clone"); mkdirSync(source);
	const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	try {
		git(source, "init", "-q"); git(source, "config", "user.name", "Test"); git(source, "config", "user.email", "test@example.com"); git(source, "config", "uploadpack.allowFilter", "true");
		writeFileSync(join(source, "file"), "old\n"); git(source, "add", "."); git(source, "commit", "-qm", "base"); const base = git(source, "rev-parse", "HEAD");
		const blob = git(source, "rev-parse", "HEAD:file");
		writeFileSync(join(source, "file"), "new\n"); git(source, "commit", "-qam", "head"); const head = git(source, "rev-parse", "HEAD");
		git(dir, "clone", "-q", "--no-checkout", "--filter=blob:none", `file://${source}`, clone);
		git(clone, "config", "remote.origin.url", join(dir, "missing")); git(clone, "config", "remote.origin.promisor", "true");
		assert.throws(() => git(clone, "--no-lazy-fetch", "cat-file", "-e", blob));
		const before = git(clone, "count-objects", "-v");
		await assert.rejects(api.runReviewQuery({ operation: "diff", base, head, path: "file" }, clone), /missing|unable|failed|bad object/i);
		assert.equal(git(clone, "count-objects", "-v"), before);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("diff overview reports paginated facts without generating patches", async () => {
	const dir = mkdtempSync(join(process.env.TMPDIR, "review-overview-"));
	const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
	try {
		git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
		writeFileSync(join(dir, "initial"), "initial\n"); git("add", "."); git("commit", "-qm", "initial");
		const base = git("rev-parse", "HEAD"); git("branch", "review-base", base);
		writeFileSync(join(dir, ".gitattributes"), "forced diff\n");
		writeFileSync(join(dir, "forced"), "forced\0text\n");
		writeFileSync(join(dir, "binary"), "binary\0data\n");
		writeFileSync(join(dir, "odd\tname\nfile"), "special\n");
		for (let i = 0; i < 1050; i++) writeFileSync(join(dir, `file-${String(i).padStart(4, "0")}`), `${"x".repeat(1100)}\n`);
		git("add", "."); git("update-index", "--add", "--cacheinfo", `160000,${base},nested`); git("commit", "-qm", "changes");
		const head = git("rev-parse", "HEAD");
		assert.ok(Buffer.byteLength(git("diff", base, head, "--")) > 1024 * 1024);
		const req = { operation: "diff", base: "review-base", head };
		const calls = [];
		const runner = async (args, cwd, options) => { calls.push(args); return api.reviewQueryRunner(args, cwd, options); };
		const query = (request = req) => api.runReviewQuery(request, dir, { runner });
		const first = await query({ ...req, limit: 100 });
		const id = /contentId=(sha256:[0-9a-f]{64})/.exec(first)?.[1]; assert.ok(id);
		const pages = [first]; let next = Number(/next offset: (\d+)$/.exec(first)?.[1]);
		while (next) {
			const page = await query({ ...req, limit: 100, offset: next, contentId: id }); pages.push(page);
			next = Number(/next offset: (\d+)$/.exec(page)?.[1]);
		}
		assert.ok(pages.length > 1);
		const body = pages.flatMap(page => page.split("\n").slice(1, -1)).join("\n");
		assert.equal(body.split("\n").length, 1056);
		assert.match(body, /binary[^\n]*git-text-diff: no[^\n]*binary/);
		assert.match(body, /gitlink[^\n]*nested/);
		assert.match(body, /git-text-diff: yes[^\n]*forced/);
		assert.match(body, /odd\\tname\\nfile/);
		assert.match(body, /binary: 1/); assert.match(body, /gitlink: 1/); assert.match(body, /逐文件读取尚未验证/);
		assert.doesNotMatch(body, /reviewable|diff --git|@@/i);
		const baseline = await query({ ...req, limit: 100 });
		git("branch", "-f", "review-base", head);
		await assert.rejects(query({ ...req, offset: 2, contentId: id }), /contentId/i);
		assert.equal(await query({ ...req, base, limit: 100 }), baseline);
		git("replace", head, base);
		assert.equal(await query({ ...req, base, limit: 100 }), baseline);
		writeFileSync(join(dir, ".gitattributes"), "forced -diff\n");
		assert.equal(await query({ ...req, base, limit: 100 }), baseline);
		const marker = join(dir, "executed"); const script = join(dir, "external");
		writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n`); chmodSync(script, 0o755);
		git("config", "diff.external", script); git("config", "diff.ignoreSubmodules", "all"); git("config", "submodule.nested.ignore", "all");
		assert.equal(await query({ ...req, base, limit: 100 }), baseline);
		assert.throws(() => execFileSync("test", ["-e", marker]));
		const diffs = calls.filter(args => args.includes("diff")); assert.ok(diffs.length >= 2);
		for (const args of diffs) {
			for (const flag of ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--ignore-submodules=none", "--no-relative", "-z", `--attr-source=${head}`]) assert.ok(args.includes(flag), flag);
			assert.equal(args.at(-1), "--"); assert.ok(args.includes("--raw") || args.includes("--numstat"));
			assert.ok(!args.some(arg => ["-p", "--patch"].includes(arg) || arg.startsWith("--unified")));
		}
		assert.ok(diffs.some(args => args.includes("--raw") && args.includes("--no-abbrev")));
		assert.ok(diffs.some(args => args.includes("--numstat")));
		for (const args of calls) {
			if (args[0] === "--version") continue;
			const subcommand = args[11]?.startsWith("--attr-source=") ? args[12] : args[11];
			assert.ok(api.REVIEW_QUERY_COMMANDS.includes(subcommand));
		}
		for (const variant of ["raw-unterminated", "numstat-unterminated", "mismatched-path", "mixed-binary", "numstat-missing-last"]) {
			const faulty = async (args, cwd, options) => {
				const result = await api.reviewQueryRunner(args, cwd, options);
				if (args.includes("--raw") && variant === "raw-unterminated") result.stdout = result.stdout.slice(0, -1);
				if (args.includes("--numstat")) {
					if (variant === "numstat-unterminated") result.stdout = result.stdout.slice(0, -1);
					if (variant === "mismatched-path") result.stdout = result.stdout.replace(".gitattributes", "other");
					if (variant === "numstat-missing-last") result.stdout = result.stdout.replace(/[^\0]*\0$/, "");
					if (variant === "mixed-binary") result.stdout = result.stdout.replace(/^\d+\t\d+\t/, "-\t0\t");
				}
				return result;
			};
			await assert.rejects(api.runReviewQuery({ ...req, base }, dir, { runner: faulty }), /invalid diff overview/, variant);
		}
		const example = body.split("\n").filter(line => /"(?:binary|forced|nested)"$|逐文件读取尚未验证/.test(line));
		console.log(`overview sample:\n${pages[0].split("\n")[0]}\n${example.join("\n")}`);
	} finally { rmSync(dir, { recursive: true, force: true }); }
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
	await assert.rejects(query({ operation: "show" }), /rev/i);
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
	let pendingEnvQuery;
	try { pendingEnvQuery = query({ ...req, base: "base-branch" }, { runner }); } finally { delete process.env.GIT_DIR; }
	await pendingEnvQuery; await query(req, { runner });
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
