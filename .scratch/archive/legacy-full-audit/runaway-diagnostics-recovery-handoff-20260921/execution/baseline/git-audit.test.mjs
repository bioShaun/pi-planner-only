import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	FORBIDDEN_GIT_OPERATIONS,
	GIT_AUDIT_OPERATIONS,
	GIT_READ_ARGV,
	classifyCommitDirtyPaths,
	dirtyPathsOutsideTruth,
	isSafeAuditCommand,
	parseGitStatusKinds,
	parseGitStatusPaths,
	resolveGitAudit,
	runGitAudit,
	validateGitAuditCwd,
} from "./git-audit.ts";
import { DEFAULT_GIT_AUDIT_ENTRIES, MAX_GIT_AUDIT_ENTRIES, MAX_GIT_AUDIT_OUTPUT_CHARS } from "./types.ts";

// --------------------------------------------------------------------------
// Allowed operations map to fixed, read-only argv
// --------------------------------------------------------------------------

assert.deepEqual(resolveGitAudit({ operation: "status" }).argv, [...GIT_READ_ARGV.status]);
assert.deepEqual(resolveGitAudit({ operation: "head" }).argv, [...GIT_READ_ARGV.head]);
assert.deepEqual(resolveGitAudit({ operation: "diff-stat" }).argv, [
	"diff",
	"--stat",
	"--no-ext-diff",
	"--no-textconv",
]);
assert.deepEqual(resolveGitAudit({ operation: "diff-names", staged: true }).argv, [
	"diff",
	"--cached",
	"--name-status",
	"--no-ext-diff",
	"--no-textconv",
]);
assert.deepEqual(resolveGitAudit({ operation: "diff-check" }).argv, [
	"diff",
	"--check",
	"--no-ext-diff",
	"--no-textconv",
]);
assert.deepEqual(resolveGitAudit({ operation: "diff-check", staged: true }).argv, [
	"diff",
	"--cached",
	"--check",
	"--no-ext-diff",
	"--no-textconv",
]);
assert.deepEqual(resolveGitAudit({ operation: "head" }).argv, [...GIT_READ_ARGV.head]);
assert.deepEqual(resolveGitAudit({ operation: "log" }).argv, [
	"log",
	"--oneline",
	"-n",
	String(DEFAULT_GIT_AUDIT_ENTRIES),
]);
assert.deepEqual(resolveGitAudit({ operation: "log", maxEntries: 5 }).argv, [
	"log",
	"--oneline",
	"-n",
	"5",
]);

// staged is ignored by non-diff operations rather than rejected
assert.deepEqual(resolveGitAudit({ operation: "head", staged: true }).argv, ["rev-parse", "HEAD"]);

// every operation is one of the six documented ones
for (const operation of GIT_AUDIT_OPERATIONS) {
	assert.equal(resolveGitAudit({ operation }).ok, true);
	// no argv element may carry shell syntax
	for (const arg of resolveGitAudit({ operation }).argv) {
		assert.doesNotMatch(arg, /[;&|`$><\\]/);
	}
}

// A5. RF-1 Evidence probe rows are argv-only: fixed, shell-free, and never
// reachable through the git_audit tool.
assert.deepEqual(GIT_READ_ARGV.diffNamesBetween, ["diff", "--name-only", "--no-ext-diff", "--no-textconv"]);
assert.deepEqual(GIT_READ_ARGV.hashObject, ["hash-object", "--"]);
for (const arg of [...GIT_READ_ARGV.diffNamesBetween, ...GIT_READ_ARGV.hashObject]) {
	// no shell metacharacters, no embedded whitespace
	assert.doesNotMatch(arg, /[;&|`$><\\]/);
	assert.doesNotMatch(arg, /\s/);
}
assert.equal(GIT_AUDIT_OPERATIONS.includes("hash-object"), false);
assert.equal(resolveGitAudit({ operation: "hash-object" }).ok, false);
assert.equal(resolveGitAudit({ operation: "diff --name-only" }).ok, false);
assert.equal(resolveGitAudit({ operation: "diff --name-only abc1234 def5678" }).ok, false);

// --------------------------------------------------------------------------
// Entry bounds
// --------------------------------------------------------------------------

assert.deepEqual(
	resolveGitAudit({ operation: "log" }).argv,
	["log", "--oneline", "-n", String(DEFAULT_GIT_AUDIT_ENTRIES)],
);
assert.deepEqual(resolveGitAudit({ operation: "log", maxEntries: 1 }).argv[3], "1");
assert.deepEqual(resolveGitAudit({ operation: "log", maxEntries: 0 }).argv[3], "1");
assert.deepEqual(resolveGitAudit({ operation: "log", maxEntries: -5 }).argv[3], "1");
assert.deepEqual(
	resolveGitAudit({ operation: "log", maxEntries: 99999 }).argv[3],
	String(MAX_GIT_AUDIT_ENTRIES),
);
assert.deepEqual(resolveGitAudit({ operation: "log", maxEntries: 3.7 }).argv[3], "3");

// --------------------------------------------------------------------------
// Injection and mutation rejection
// --------------------------------------------------------------------------

const rejected = [
	"; rm -rf /",
	"status && rm -rf /",
	"status | cat /etc/passwd",
	"status $(touch /tmp/x)",
	"status `whoami`",
	"status > /tmp/out",
	"status < /etc/passwd",
	"status\nrm -rf /",
	"reset --hard",
	"commit -m x",
	"checkout main",
	"clean -fd",
	"push origin main",
	"rebase main",
	"merge main",
	"config user.email a@b.c",
	"add .",
	"switch main",
	"restore .",
	"cherry-pick abc",
	"pull",
	"fetch",
	"git reset",
	"git checkout",
	"git commit",
	"git clean",
	"status --output=/tmp/leak",
	"",
	"   ",
	"unknown-op",
];
for (const operation of rejected) {
	const result = resolveGitAudit({ operation });
	assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(operation)}`);
	assert.match(result.error, /git_audit/);
}

// every documented forbidden subcommand is rejected on its own
for (const operation of FORBIDDEN_GIT_OPERATIONS) {
	assert.equal(
		resolveGitAudit({ operation }).ok,
		false,
		`expected rejection for git ${operation}`,
	);
}

// cwd must not carry shell syntax either
assert.equal(resolveGitAudit({ operation: "status", cwd: "/tmp; rm -rf /" }).ok, false);
assert.equal(resolveGitAudit({ operation: "status", cwd: "/tmp/$(id)" }).ok, false);
assert.equal(resolveGitAudit({ operation: "status", cwd: 42 }).ok, false);
assert.equal(resolveGitAudit({ operation: "status", maxEntries: Number.NaN }).ok, false);

assert.equal(resolveGitAudit({ operation: "status" }).ok, true);
assert.equal(resolveGitAudit({ operation: "commit" }).ok, false);

// --------------------------------------------------------------------------
// cwd validation
// --------------------------------------------------------------------------

const fixtureRoot = mkdtempSync(join(tmpdir(), "git-audit-test-"));
try {
	const dir = join(fixtureRoot, "repo");
	mkdirSync(dir);
	const file = join(fixtureRoot, "file.txt");
	writeFileSync(file, "x");

	assert.equal(validateGitAuditCwd(dir).ok, true);
	assert.equal(validateGitAuditCwd(file).ok, false);
	assert.match(validateGitAuditCwd(file).error, /not a directory/);
	assert.equal(validateGitAuditCwd(join(fixtureRoot, "missing")).ok, false);
	assert.match(validateGitAuditCwd(join(fixtureRoot, "missing")).error, /does not exist/);

	// ------------------------------------------------------------------
	// Execution: argv is passed through, never a shell
	// ------------------------------------------------------------------

	const seen = [];
	const runner = async (args, cwd) => {
		seen.push({ args: [...args], cwd });
		return { stdout: "abc1234\n", stderr: "", code: 0 };
	};

	const ok = await runGitAudit(runner, { operation: "head" }, dir);
	assert.equal(ok.ok, true);
	assert.equal(ok.operation, "head");
	assert.match(ok.text, /abc1234/);
	assert.deepEqual(seen.at(-1).args, ["rev-parse", "HEAD"]);
	assert.equal(seen.at(-1).cwd, dir);

	// rejection happens before anything is executed
	const before = seen.length;
	const denied = await runGitAudit(runner, { operation: "reset --hard" }, dir);
	assert.equal(denied.ok, false);
	assert.match(denied.text, /forbids the mutating git operation/);
	assert.equal(seen.length, before);

	// relative cwd resolves against the session cwd
	await runGitAudit(runner, { operation: "status", cwd: "repo" }, fixtureRoot);
	assert.equal(seen.at(-1).cwd, dir);

	// a missing cwd is refused without executing
	const missing = await runGitAudit(runner, { operation: "status", cwd: "nope" }, fixtureRoot);
	assert.equal(missing.ok, false);
	assert.match(missing.text, /does not exist/);

	// E4: cwd resolving outside baseCwd is refused with exact message
	const beforeOutside = seen.length;
	const outsideParent = await runGitAudit(runner, { operation: "status", cwd: ".." }, dir);
	assert.equal(outsideParent.ok, false);
	assert.equal(outsideParent.code, 1);
	assert.equal(outsideParent.text, "git_audit cwd must stay inside the working directory");

	const outsideRelative = await runGitAudit(runner, { operation: "status", cwd: "../outside" }, dir);
	assert.equal(outsideRelative.ok, false);
	assert.equal(outsideRelative.code, 1);
	assert.equal(outsideRelative.text, "git_audit cwd must stay inside the working directory");

	const outsideAbsolute = await runGitAudit(runner, { operation: "status", cwd: "/etc" }, dir);
	assert.equal(outsideAbsolute.ok, false);
	assert.equal(outsideAbsolute.code, 1);
	assert.equal(outsideAbsolute.text, "git_audit cwd must stay inside the working directory");
	assert.equal(seen.length, beforeOutside);

	// non-zero exit surfaces stderr and reports the code
	const failing = await runGitAudit(
		async () => ({ stdout: "", stderr: "fatal: not a git repository", code: 128 }),
		{ operation: "status" },
		dir,
	);
	assert.equal(failing.ok, false);
	assert.equal(failing.code, 128);
	assert.match(failing.text, /fatal: not a git repository/);

	// a throwing runner is contained
	const thrown = await runGitAudit(
		async () => {
			throw new Error("spawn failed");
		},
		{ operation: "status" },
		dir,
	);
	assert.equal(thrown.ok, false);
	assert.match(thrown.text, /spawn failed/);
} finally {
	rmSync(fixtureRoot, { recursive: true, force: true });
}

// --------------------------------------------------------------------------
// Output bounds
// --------------------------------------------------------------------------

const long = "x".repeat(MAX_GIT_AUDIT_OUTPUT_CHARS + 500);
const formatDir = process.cwd();
const emptyStatus = await runGitAudit(
	async () => ({ stdout: "", stderr: "", code: 0 }),
	{ operation: "status" },
	formatDir,
);
assert.equal(emptyStatus.text, "git status\n(clean working tree)");
const emptyNames = await runGitAudit(
	async () => ({ stdout: "", stderr: "", code: 0 }),
	{ operation: "diff-names" },
	formatDir,
);
assert.equal(emptyNames.text, "git diff-names\n(no changed paths)");
const emptyCheck = await runGitAudit(
	async () => ({ stdout: "", stderr: "", code: 0 }),
	{ operation: "diff-check" },
	formatDir,
);
assert.equal(emptyCheck.text, "git diff-check\n(no whitespace errors)");
const truncated = (await runGitAudit(
	async () => ({ stdout: long, stderr: "", code: 0 }),
	{ operation: "log" },
	formatDir,
)).text;
assert.ok(truncated.length < MAX_GIT_AUDIT_OUTPUT_CHARS + 200);
assert.match(truncated, /truncated/);
assert.match(truncated, /500 chars total/);

assert.equal(isSafeAuditCommand("pwd"), true);
assert.equal(isSafeAuditCommand("git status --short --branch"), true);
assert.equal(isSafeAuditCommand("git diff --output=/tmp/leak"), false);

// --------------------------------------------------------------------------
// porcelain v2 path parsing (D3 regression)
//
// The git_commit handler inspects `git status --porcelain=v2 --branch`. In v2
// the path is the final SPACE-separated field (a tab only separates the two
// paths of a rename), so a tab-based split returned the whole raw line. That
// made `dirtyPathsOutsideTruth` treat a modified tracked file as an external
// dirty path, refusing every commit of a tracked change.
// --------------------------------------------------------------------------

const porcelainV2 = [
	"# branch.oid abc1234",
	"# branch.head master",
	"1 .M N... 100644 100644 100644 47bf9e5f 47bf9e5f declared.txt",
	"1 .M N... 100644 100644 100644 1111111 2222222 dir/with spaces.ts",
	"2 R. N... 100644 100644 100644 3333333 4444444 R100 src/renamed.ts\tsrc/old.ts",
	"u UU N... 100644 100644 100644 100644 aaaa bbbb cccc src/conflict.ts",
	"? src/new.ts",
	"? docs/with spaces.md",
].join("\n");

assert.deepEqual(parseGitStatusPaths(porcelainV2), [
	"declared.txt",
	"dir/with spaces.ts",
	"src/renamed.ts",
	"src/conflict.ts",
	"src/new.ts",
	"docs/with spaces.md",
]);
// The regression: a modified tracked file must parse to its path, never the raw line.
assert.equal(parseGitStatusPaths("1 .M N... 100644 100644 100644 47bf9e5f 47bf9e5f declared.txt")[0], "declared.txt");
assert.deepEqual(parseGitStatusPaths(""), []);
assert.deepEqual(parseGitStatusPaths("# branch.oid abc\n# branch.head main"), []);

// truth-only dirty tracked path -> nothing outside truth (the D3 blocking case)
assert.deepEqual(dirtyPathsOutsideTruth(parseGitStatusPaths(
	"1 .M N... 100644 100644 100644 47bf9e5f 47bf9e5f declared.txt",
), ["declared.txt"]), []);
// an untracked external path is still reported
assert.deepEqual(dirtyPathsOutsideTruth(parseGitStatusPaths(
	"1 .M N... 100644 100644 100644 47bf9e5f 47bf9e5f declared.txt\n? outside.txt",
), ["declared.txt"]), ["outside.txt"]);

// --------------------------------------------------------------------------
// Ticket 08: classifyCommitDirtyPaths and parseGitStatusKinds real-git tests
// --------------------------------------------------------------------------
{
	const testRepo = mkdtempSync(join(tmpdir(), "git-audit-test-"));
	try {
		const git = (...args) => {
			const res = spawnSync("git", args, { cwd: testRepo, encoding: "utf8" });
			if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
			return res.stdout;
		};
		git("init", "-q");
		git("config", "user.name", "test");
		git("config", "user.email", "test@example.com");
		writeFileSync(join(testRepo, "tracked1.txt"), "t1\n");
		writeFileSync(join(testRepo, "tracked2.txt"), "t2\n");
		git("add", ".");
		git("commit", "-qm", "init");

		// Setup changes:
		// - tracked modification (tracked1.txt)
		// - rename (tracked2.txt -> renamed.txt)
		// - untracked file (untracked.txt)
		writeFileSync(join(testRepo, "tracked1.txt"), "t1 mod\n");
		git("mv", "tracked2.txt", "renamed.txt");
		writeFileSync(join(testRepo, "untracked.txt"), "untracked\n");

		// (vi) parseGitStatusKinds assertions on REAL git status --porcelain=v2 --branch output
		const realStatus = git("status", "--porcelain=v2", "--branch");
		const kinds = parseGitStatusKinds(realStatus);
		assert.ok(kinds.tracked.includes("tracked1.txt"), "tracked includes modified file");
		assert.ok(kinds.tracked.includes("renamed.txt"), "tracked includes renamed file");
		assert.ok(kinds.untracked.includes("untracked.txt"), "untracked includes untracked file");
		assert.deepEqual(kinds.ignored, []);

		// (i) tracked modification outside truth => blocking
		const cTracked = classifyCommitDirtyPaths({
			trackedDirty: kinds.tracked.filter((p) => p === "tracked1.txt"),
			untrackedDirty: [],
			ignoredDirty: [],
			truthPaths: [],
			scopeAllowedPaths: [],
		});
		assert.deepEqual(cTracked.blocking, ["tracked1.txt"]);
		assert.deepEqual(cTracked.external, []);

		// (ii) rename tracked file outside truth => blocking
		const cRename = classifyCommitDirtyPaths({
			trackedDirty: kinds.tracked.filter((p) => p === "renamed.txt"),
			untrackedDirty: [],
			ignoredDirty: [],
			truthPaths: [],
			scopeAllowedPaths: [],
		});
		assert.deepEqual(cRename.blocking, ["renamed.txt"]);
		assert.deepEqual(cRename.external, []);

		// (iii) untracked file + collapsed untracked dir outside scope => external only
		mkdirSync(join(testRepo, "untracked_dir"));
		writeFileSync(join(testRepo, "untracked_dir", "nested.txt"), "nested\n");
		const statusWithDir = git("status", "--porcelain=v2", "--branch");
		const kindsWithDir = parseGitStatusKinds(statusWithDir);
		assert.ok(kindsWithDir.untracked.includes("untracked_dir/"), "untracked includes collapsed dir with trailing slash");
		const cExternal = classifyCommitDirtyPaths({
			trackedDirty: [],
			untrackedDirty: ["untracked.txt", "untracked_dir/"],
			ignoredDirty: [],
			truthPaths: [],
			scopeAllowedPaths: ["other_scope/"],
		});
		assert.deepEqual(cExternal.blocking, []);
		assert.deepEqual(cExternal.external.sort(), ["untracked.txt", "untracked_dir/"].sort());

		// (iv) untracked file INSIDE scope allowedPaths but not truth => blocking
		const cInScope = classifyCommitDirtyPaths({
			trackedDirty: [],
			untrackedDirty: ["untracked.txt"],
			ignoredDirty: [],
			truthPaths: [],
			scopeAllowedPaths: ["untracked.txt"],
		});
		assert.deepEqual(cInScope.blocking, ["untracked.txt"]);
		assert.deepEqual(cInScope.external, []);

		// (v) staged (git add -N or git add) new file outside truth => blocking
		writeFileSync(join(testRepo, "staged_new.txt"), "staged\n");
		git("add", "staged_new.txt");
		const kindsStaged = parseGitStatusKinds(git("status", "--porcelain=v2", "--branch"));
		assert.ok(kindsStaged.tracked.includes("staged_new.txt"), "staged new file is in tracked kinds");
		const cStaged = classifyCommitDirtyPaths({
			trackedDirty: kindsStaged.tracked,
			untrackedDirty: [],
			ignoredDirty: [],
			truthPaths: [],
			scopeAllowedPaths: [],
		});
		assert.ok(cStaged.blocking.includes("staged_new.txt"));

		writeFileSync(join(testRepo, "intent_new.txt"), "intent\n");
		git("add", "-N", "intent_new.txt");
		const kindsIntent = parseGitStatusKinds(git("status", "--porcelain=v2", "--branch"));
		assert.ok(kindsIntent.tracked.includes("intent_new.txt"), "intent-to-add file is in tracked kinds");
		const cIntent = classifyCommitDirtyPaths({
			trackedDirty: kindsIntent.tracked,
			untrackedDirty: [],
			ignoredDirty: [],
			truthPaths: [],
			scopeAllowedPaths: [],
		});
		assert.ok(cIntent.blocking.includes("intent_new.txt"));
	} finally {
		rmSync(testRepo, { recursive: true, force: true });
	}
}

console.log("planner-only git_audit: PASS");