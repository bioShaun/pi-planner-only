import assert from "node:assert/strict";
import {
	captureEvidence,
	compareEvidence,
	describeComparison,
	evidenceAction,
	hashStatus,
	isEvidenceStale,
	parseChangedPaths,
	probeGit,
} from "./evidence.ts";

const CWD = "/repo";

// Branch tracking metadata is not working-tree evidence.
assert.equal(hashStatus("# branch.ab +1 -0\n1 .M N... 100644 100644 100644 a b c\n"), hashStatus("# branch.ab +2 -0\n1 .M N... 100644 100644 100644 a b c\n"));
assert.notEqual(hashStatus("1 .M N... 100644 100644 100644 a b c\n"), hashStatus("1 .M N... 100644 100644 100644 a b d\n"));


function makeReport(evidence) {
	return {
		version: 1,
		taskId: "T-20260831-001",
		status: "completed",
		summary: "done",
		changedFiles: evidence.changedPaths ?? [],
		validation: [],
		evidence: {
			cwd: CWD,
			taskId: "T-20260831-001",
			workerRunId: "call-1",
			gitAvailable: true,
			generatedAt: "2026-08-31T10:00:00.000Z",
			...evidence,
		},
		risks: [],
		unresolved: [],
	};
}

function makeCurrent(overrides = {}) {
	return {
		cwd: CWD,
		taskId: "T-20260831-001",
		workerRunId: "call-1",
		finalGitRef: "abc1234",
		gitStatusHash: "hash-one",
		changedPaths: ["src/a.ts"],
		gitAvailable: true,
		generatedAt: "2026-08-31T10:00:00.000Z",
		...overrides,
	};
}

// --------------------------------------------------------------------------
// porcelain=v2 parsing
// --------------------------------------------------------------------------

const porcelain = [
	"# branch.oid abc1234",
	"# branch.head main",
	"1 .M N... 100644 100644 100644 1111111 2222222 src/a.ts",
	"2 R. N... 100644 100644 100644 3333333 4444444 R100 src/renamed.ts\tsrc/old.ts",
	"u UU N... 100644 100644 100644 100644 src/conflict.ts",
	"? src/new.ts",
	"? docs/with spaces.md",
].join("\n");

assert.deepEqual(parseChangedPaths(porcelain), [
	"docs/with spaces.md",
	"src/a.ts",
	"src/conflict.ts",
	"src/new.ts",
	"src/renamed.ts",
]);
assert.deepEqual(parseChangedPaths(""), []);
assert.deepEqual(parseChangedPaths("# branch.oid abc\n# branch.head main"), []);

assert.equal(hashStatus("x"), hashStatus("x"));
assert.notEqual(hashStatus("x"), hashStatus("y"));
assert.match(hashStatus("x"), /^[0-9a-f]{16}$/);

// --------------------------------------------------------------------------
// probeGit / captureEvidence
// --------------------------------------------------------------------------

const responses = {
	"rev-parse --git-dir": { stdout: ".git\n", code: 0 },
	"rev-parse HEAD": { stdout: "abc1234\n", code: 0 },
	"status --porcelain=v2 --branch": { stdout: porcelain, code: 0 },
	"diff HEAD --stat": { stdout: " src/a.ts | 2 +-\n 1 file changed\n", code: 0 },
};
const calls = [];
const runner = async (args, cwd) => {
	calls.push([args.join(" "), cwd]);
	return responses[args.join(" ")] ?? { stdout: "", code: 128 };
};

const probe = await probeGit(runner, CWD);
assert.equal(probe.available, true);
assert.equal(probe.head, "abc1234");
assert.equal(probe.statusHash, hashStatus(porcelain));
assert.deepEqual(probe.changedPaths, [
	"docs/with spaces.md",
	"src/a.ts",
	"src/conflict.ts",
	"src/new.ts",
	"src/renamed.ts",
]);
assert.match(probe.diffStat, /1 file changed/);
// every probe is a read-only git invocation
for (const [command] of calls) {
	assert.doesNotMatch(command, /^(commit|add|reset|checkout|push|clean)\b/);
}

const notGit = await probeGit(async () => ({ stdout: "", code: 128 }), CWD);
assert.equal(notGit.available, false);
assert.equal(notGit.head, null);

const evidence = await captureEvidence(runner, { cwd: CWD, taskId: "T-1", workerRunId: "call-1" });
assert.equal(evidence.gitAvailable, true);
assert.equal(evidence.finalGitRef, "abc1234");
assert.equal(evidence.gitStatusHash, hashStatus(porcelain));
assert.equal(evidence.baseGitRef, undefined);

// non-Git directories degrade instead of failing the lifecycle (§19.4)
const degraded = await captureEvidence(async () => ({ stdout: "", code: 128 }), {
	cwd: CWD,
	taskId: "T-2",
	workerRunId: "call-2",
});
assert.equal(degraded.gitAvailable, false);
assert.equal(degraded.finalGitRef, undefined);
assert.equal(degraded.gitStatusHash, undefined);
assert.equal(degraded.cwd, CWD);

// a throwing runner must not take down the review path
const thrown = await captureEvidence(async () => {
	throw new Error("boom");
}, { cwd: CWD, taskId: "T-3", workerRunId: "call-3" });
assert.equal(thrown.gitAvailable, false);

// --------------------------------------------------------------------------
// Freshness
// --------------------------------------------------------------------------

// 1. unchanged evidence is fresh
const unchanged = compareEvidence(
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts"] }),
	makeCurrent(),
);
assert.equal(unchanged.fresh, true);
assert.deepEqual(unchanged.reasons, []);
assert.equal(evidenceAction(unchanged), "review");
assert.equal(isEvidenceStale(
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts"] }),
	makeCurrent(),
), false);

// 2. HEAD moved -> stale, must revalidate
const headMoved = compareEvidence(
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts"] }),
	makeCurrent({ finalGitRef: "def5678" }),
);
assert.equal(headMoved.fresh, false);
assert.equal(evidenceAction(headMoved), "revalidate");
assert.ok(headMoved.reasons.some((reason) => /HEAD changed/.test(reason)));

// 3. working tree changed with no explainable path delta -> stale, revalidate
const statusChanged = compareEvidence(
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts"] }),
	makeCurrent({ gitStatusHash: "hash-two" }),
);
assert.equal(statusChanged.fresh, false);
assert.equal(evidenceAction(statusChanged), "revalidate");
assert.ok(statusChanged.reasons.some((reason) => /working tree changed/.test(reason)));

// 4. out-of-scope change only -> stale but review may continue
const unrelated = compareEvidence(
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts"] }),
	makeCurrent({ gitStatusHash: "hash-two", changedPaths: ["src/a.ts", "docs/readme.md"] }),
);
assert.equal(unrelated.fresh, false);
assert.deepEqual(unrelated.overlappingPaths, []);
assert.deepEqual(unrelated.unrelatedPaths, ["/repo/docs/readme.md"]);
assert.equal(evidenceAction(unrelated), "review");
assert.match(describeComparison(unrelated), /out-of-scope/);

// 5. a new in-scope path changed -> revalidate
const overlapByScope = compareEvidence(
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts"] }),
	makeCurrent({ gitStatusHash: "hash-two", changedPaths: ["src/a.ts", "src/b.ts"] }),
	{ scope: { allowedPaths: ["src/b.ts"] } },
);
assert.equal(overlapByScope.fresh, false);
assert.deepEqual(overlapByScope.overlappingPaths, ["/repo/src/b.ts"]);
assert.equal(evidenceAction(overlapByScope), "revalidate");

// 6. a reported change disappeared -> revalidate
const reverted = compareEvidence(
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts"] }),
	makeCurrent({ gitStatusHash: "hash-two", changedPaths: [] }),
);
assert.equal(reverted.fresh, false);
assert.deepEqual(reverted.missingPaths, ["/repo/src/a.ts"]);
assert.equal(evidenceAction(reverted), "revalidate");

// 7. cwd drift and superseded tasks are always stale
const cwdDrift = compareEvidence(
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts"] }),
	makeCurrent({ cwd: "/other" }),
);
assert.equal(evidenceAction(cwdDrift), "revalidate");
assert.ok(cwdDrift.reasons.some((reason) => /cwd changed/.test(reason)));

const superseded = compareEvidence(
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts"] }),
	makeCurrent(),
	{ superseded: true },
);
assert.equal(superseded.fresh, false);
assert.equal(evidenceAction(superseded), "revalidate");

// 8. git unavailable on either side -> path comparison only, never a false pass
const noGit = compareEvidence(
	makeReport({ gitAvailable: false, changedPaths: ["src/a.ts"] }),
	makeCurrent({ gitAvailable: false, changedPaths: ["src/a.ts"] }),
);
assert.equal(noGit.fresh, false);
assert.equal(noGit.verifiable, false);
assert.equal(evidenceAction(noGit), "revalidate");
assert.match(describeComparison(noGit), /unverifiable/);

console.log("planner-only evidence: PASS");
