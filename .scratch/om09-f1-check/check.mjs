// F1 live check: run git.ts against the host git (om09: 1.8.3.1) in a throwaway repo.
// Usage: node --experimental-strip-types check.mjs <scratch-dir>
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureBase, gitCommit, runGitAudit, summarizeWork } from "./git.ts";

const root = process.argv[2];
const repo = join(root, "repo");
const notRepo = join(root, "plain");
mkdirSync(repo, { recursive: true });
mkdirSync(notRepo, { recursive: true });

const calls = [];
const run = async (args, cwd) => {
	calls.push(args.join(" "));
	try {
		return { stdout: execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), code: 0 };
	} catch (e) {
		return { stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? ""), code: e.status ?? 1 };
	}
};
const g = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });

let failed = 0;
const check = (name, r) => {
	const ok = r.ok;
	if (!ok) failed++;
	console.log(`${ok ? "OK  " : "FAIL"} ${name}\n${r.text.split("\n").map((l) => `     ${l}`).join("\n")}`);
};

console.log(`host: ${execFileSync("git", ["--version"], { encoding: "utf8" }).trim()}`);
g("init", "-q");
g("config", "user.email", "f1@example.com");
g("config", "user.name", "f1");
writeFileSync(join(repo, "a.txt"), "one\n");
g("add", "-A");
g("commit", "-qm", "init");
const base = await captureBase(run, repo);
writeFileSync(join(repo, "a.txt"), "two\n");
writeFileSync(join(repo, "b.txt"), "new\n");

for (const operation of ["status", "diff-stat", "diff", "log"]) check(`git_audit ${operation}`, await runGitAudit(run, { operation }, repo));
check("git_audit diff base=HEAD~0", await runGitAudit(run, { operation: "diff", base: "HEAD" }, repo));
check("git_commit paths=[b.txt]", await gitCommit(run, repo, "f1 partial", ["b.txt"]));
check("git_commit all", await gitCommit(run, repo, "f1 all"));
check("git_audit log after commits", await runGitAudit(run, { operation: "log", maxEntries: 5 }, repo));
console.log(`summarizeWork:\n${await summarizeWork(run, repo, base)}`);

const outside = await runGitAudit(run, { operation: "status" }, notRepo);
const outsideOk = !outside.ok && outside.text === `${notRepo} is not inside a git work tree; pass cwd=<repo>`;
if (!outsideOk) failed++;
console.log(`${outsideOk ? "OK  " : "FAIL"} non-repo message: ${outside.text}`);

const probes = calls.filter((c) => c === "--version").length;
const optional = calls.filter((c) => c.includes("--no-optional-locks")).length;
const porcelainV = calls.filter((c) => c.includes("--porcelain=")).length;
const fsmon = calls.filter((c) => c !== "--version" && !c.includes("core.fsmonitor=false")).length;
console.log(`probes=${probes} no-optional-locks=${optional} porcelain==${porcelainV} missing-fsmonitor=${fsmon} calls=${calls.length}`);
if (probes !== 1 || optional !== 0 || porcelainV !== 0 || fsmon !== 0) failed++;
console.log(failed ? `F1 CHECK FAILED (${failed})` : "F1 CHECK PASSED");
process.exit(failed ? 1 : 0);
