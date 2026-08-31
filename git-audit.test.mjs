import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	FORBIDDEN_GIT_OPERATIONS,
	GIT_AUDIT_OPERATIONS,
	clampEntries,
	formatGitAudit,
	rejectGitAuditRequest,
	resolveGitAudit,
	runGitAudit,
	validateGitAuditCwd,
} from "./git-audit.ts";
import { DEFAULT_GIT_AUDIT_ENTRIES, MAX_GIT_AUDIT_ENTRIES, MAX_GIT_AUDIT_OUTPUT_CHARS } from "./types.ts";

// --------------------------------------------------------------------------
// Allowed operations map to fixed, read-only argv
// --------------------------------------------------------------------------

assert.deepEqual(resolveGitAudit({ operation: "status" }).argv, [
	"status",
	"--porcelain=v2",
	"--branch",
]);
assert.deepEqual(resolveGitAudit({ operation: "diff-stat" }).argv, ["diff", "--stat"]);
assert.deepEqual(resolveGitAudit({ operation: "diff-names", staged: true }).argv, [
	"diff",
	"--cached",
	"--name-status",
]);
assert.deepEqual(resolveGitAudit({ operation: "diff-check" }).argv, ["diff", "--check"]);
assert.deepEqual(resolveGitAudit({ operation: "diff-check", staged: true }).argv, [
	"diff",
	"--cached",
	"--check",
]);
assert.deepEqual(resolveGitAudit({ operation: "head" }).argv, ["rev-parse", "HEAD"]);
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

// --------------------------------------------------------------------------
// Entry bounds
// --------------------------------------------------------------------------

assert.equal(clampEntries(undefined), DEFAULT_GIT_AUDIT_ENTRIES);
assert.equal(clampEntries(1), 1);
assert.equal(clampEntries(0), 1);
assert.equal(clampEntries(-5), 1);
assert.equal(clampEntries(99999), MAX_GIT_AUDIT_ENTRIES);
assert.equal(clampEntries(3.7), 3);

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

// rejectGitAuditRequest agrees with resolveGitAudit
assert.equal(rejectGitAuditRequest({ operation: "status" }), undefined);
assert.ok(rejectGitAuditRequest({ operation: "commit" }));

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

assert.equal(
	formatGitAudit("status", { stdout: "", stderr: "", code: 0 }),
	"git status\n(clean working tree)",
);
assert.equal(
	formatGitAudit("diff-names", { stdout: "", stderr: "", code: 0 }),
	"git diff-names\n(no changed paths)",
);
assert.equal(
	formatGitAudit("diff-check", { stdout: "", stderr: "", code: 0 }),
	"git diff-check\n(no whitespace errors)",
);

const long = "x".repeat(MAX_GIT_AUDIT_OUTPUT_CHARS + 500);
const truncated = formatGitAudit("log", { stdout: long, stderr: "", code: 0 });
assert.ok(truncated.length < MAX_GIT_AUDIT_OUTPUT_CHARS + 200);
assert.match(truncated, /truncated/);
assert.match(truncated, /500 chars total/);

console.log("planner-only git_audit: PASS");
