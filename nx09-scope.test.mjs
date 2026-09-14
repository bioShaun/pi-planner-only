import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeRepoRelativePath, matchesScopePath, isPathInDeclaredScope, captureEvidence, compareExecutionTruth } from "./evidence.ts";
import { validateTaskSpec } from "./task.ts";

function realGitRunnerOf(repoDir) {
	return async (argv, runCwd = repoDir) => {
		const res = spawnSync("git", argv, {
			cwd: runCwd,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_AUTHOR_NAME: "test",
				GIT_AUTHOR_EMAIL: "test@example.com",
				GIT_COMMITTER_NAME: "test",
				GIT_COMMITTER_EMAIL: "test@example.com",
			},
		});
		return { stdout: res.stdout || "", stderr: res.stderr || "", code: res.status ?? 1 };
	};
}

test("normalizeRepoRelativePath", () => {
	assert.equal(normalizeRepoRelativePath("./foo/"), "foo/");
	assert.equal(normalizeRepoRelativePath("foo\\bar"), "foo/bar");
	assert.equal(normalizeRepoRelativePath("../x"), null);
	assert.equal(normalizeRepoRelativePath("/abs/out"), null);
	assert.equal(normalizeRepoRelativePath(""), null);
	assert.equal(normalizeRepoRelativePath("."), null);
	assert.equal(normalizeRepoRelativePath("a/../b"), null);
	assert.equal(normalizeRepoRelativePath("foo"), "foo");
	assert.equal(normalizeRepoRelativePath("foo/"), "foo/");
});

test("matchesScopePath", () => {
	assert.equal(matchesScopePath(["foo"], "foo"), true);
	assert.equal(matchesScopePath(["foo"], "foo/bar"), false);
	assert.equal(matchesScopePath(["foo/"], "foo/bar"), true);
	assert.equal(matchesScopePath(["foo/"], "foo/a/b.txt"), true);
	assert.equal(matchesScopePath(["foo/"], "foobar/x"), false);
	assert.equal(matchesScopePath(["foo/"], "foo.txt"), false);
	assert.equal(matchesScopePath(["./foo/"], "foo/bar"), true);
	assert.equal(matchesScopePath(["foo\\bar/"], "foo/bar/baz.txt"), true);
	assert.equal(matchesScopePath(["../x"], "x"), false);
	assert.equal(matchesScopePath(["foo/"], "/abs/out"), false);
});

test("isPathInDeclaredScope routes every entry form through the one matcher", () => {
	const cwd = "/repo";
	const wt = "/worktrees/review";

	// No allow-list is "no restriction", not "nothing allowed".
	assert.equal(isPathInDeclaredScope("/repo/anything.txt", cwd, undefined), true);
	assert.equal(isPathInDeclaredScope("/repo/anything.txt", cwd, []), true);

	// A bare entry names one file; only a trailing slash opens the subtree.
	assert.equal(isPathInDeclaredScope("/repo/sub", cwd, ["sub"]), true);
	assert.equal(isPathInDeclaredScope("/repo/sub/x.txt", cwd, ["sub"]), false);
	assert.equal(isPathInDeclaredScope("/repo/sub/x.txt", cwd, ["sub/"]), true);
	assert.equal(isPathInDeclaredScope("/repo/sub/a/b.txt", cwd, ["sub/"]), true);
	assert.equal(isPathInDeclaredScope("/repo/subbar/x.txt", cwd, ["sub/"]), false);

	// A relative entry covers the same file under a declared worktree root.
	assert.equal(isPathInDeclaredScope(resolve(wt, "src/a.ts"), cwd, ["src/a.ts"], [wt]), true);
	assert.equal(isPathInDeclaredScope(resolve(wt, "src/b.ts"), cwd, ["src/a.ts"], [wt]), false);

	// An absolute entry matches directly (story 28-C), and a trailing slash
	// still means "subtree" in absolute form.
	assert.equal(isPathInDeclaredScope(resolve(wt, "src/a.ts"), cwd, [resolve(wt, "src/a.ts")], [wt]), true);
	assert.equal(isPathInDeclaredScope(resolve(wt, "src/a.ts"), cwd, [`${wt}/src/`], [wt]), true);
	assert.equal(isPathInDeclaredScope(resolve(wt, "src/a.ts"), cwd, ["/elsewhere/src/a.ts"], [wt]), false);

	// Paths that escape every base are never in scope.
	assert.equal(isPathInDeclaredScope("/elsewhere/x.txt", cwd, ["sub/"]), false);
	assert.equal(isPathInDeclaredScope("/repo/../escape.txt", cwd, ["sub/"]), false);
});

test("validateTaskSpec rejects scope escaping workspace", () => {
	const errors = validateTaskSpec({
		taskId: "T-test",
		role: "worker",
		specRevision: 1,
		objective: "test",
		instruction: "test",
		scope: {
			allowedPaths: ["../evil"],
		},
	});
	assert.ok(errors.some((e) => e.includes("scope path escapes the workspace: ../evil")), "Expected scope path escapes the workspace error");
});

test("real git e2e scope cases", async () => {
	const dir = mkdtempSync(join(tmpdir(), "nx09-test-"));
	try {
		const git = realGitRunnerOf(dir);
		await git(["init"]);
		await git(["config", "user.name", "test"]);
		await git(["config", "user.email", "test@test.com"]);
		writeFileSync(join(dir, "init.txt"), "base");
		await git(["add", "init.txt"]);
		await git(["commit", "-m", "initial"]);

		mkdirSync(join(dir, "sub"), { recursive: true });
		mkdirSync(join(dir, "noise"), { recursive: true });

		const aRun = await captureEvidence(git, {
			cwd: dir,
			taskId: "T-test",
			workerRunId: "run-A",
			scopePaths: ["sub/"],
		});

		// Case 1: new untracked file inside 'sub/' declared in report => truthPaths
		writeFileSync(join(dir, "sub", "declared.txt"), "hello");
		const cReport1 = await captureEvidence(git, {
			cwd: dir,
			taskId: "T-test",
			workerRunId: "run-C1",
			scopePaths: ["sub/"],
		});

		const workerReport1 = { changedFiles: ["sub/declared.txt"], evidence: { cwd: dir } };
		const truth1 = compareExecutionTruth(aRun, cReport1, workerReport1, {
			scope: { allowedPaths: ["sub/"] },
		});
		const relTruth1 = truth1.truthPaths.map((p) => p.replace(dir + "/", ""));
		const relExt1 = truth1.externalPaths.map((p) => p.replace(dir + "/", ""));
		assert.ok(relTruth1.includes("sub/declared.txt"), "truthPaths should contain sub/declared.txt");
		assert.ok(!relExt1.includes("sub/declared.txt"), "externalPaths should not contain sub/declared.txt");

		// Case 2: same file undeclared => undeclaredPaths
		const workerReport2 = { changedFiles: [], evidence: { cwd: dir } };
		const truth2 = compareExecutionTruth(aRun, cReport1, workerReport2, {
			scope: { allowedPaths: ["sub/"] },
		});
		const relUndeclared2 = truth2.undeclaredPaths.map((p) => p.replace(dir + "/", ""));
		const relExt2 = truth2.externalPaths.map((p) => p.replace(dir + "/", ""));
		assert.ok(relUndeclared2.includes("sub/declared.txt"), "undeclaredPaths should contain sub/declared.txt");
		assert.ok(!relExt2.includes("sub/declared.txt"), "externalPaths should not contain sub/declared.txt");

		// Case 3: out-of-scope untracked dir 'noise/' => externalPaths, never truthPaths
		writeFileSync(join(dir, "noise", "untracked.txt"), "noise content");
		const cReport3 = await captureEvidence(git, {
			cwd: dir,
			taskId: "T-test",
			workerRunId: "run-C3",
			scopePaths: ["sub/"],
		});
		const workerReport3 = { changedFiles: [], evidence: { cwd: dir } };
		const truth3 = compareExecutionTruth(aRun, cReport3, workerReport3, {
			scope: { allowedPaths: ["sub/"] },
		});
		const relTruth3 = truth3.truthPaths.map((p) => p.replace(dir + "/", ""));
		const relExt3 = truth3.externalPaths.map((p) => p.replace(dir + "/", ""));
		assert.ok(relExt3.includes("noise/untracked.txt"), "externalPaths should contain noise/untracked.txt");
		assert.ok(!relTruth3.includes("noise/untracked.txt"), "truthPaths should not contain noise/untracked.txt");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
