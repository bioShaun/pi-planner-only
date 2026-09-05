import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	FORBIDDEN_GIT_OPERATIONS,
	GIT_AUDIT_OPERATIONS,
	GIT_READ_ARGV,
	isSafeAuditCommand,
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

const fixtureRoot = mkdtempSync(join(process.cwd(), ".git-audit-test-"));
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

console.log("planner-only git_audit: PASS");
