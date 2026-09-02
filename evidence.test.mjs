import assert from "node:assert/strict";
import {
	captureEvidence,
	captureReviewEvidencePacket,
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

function makeBase(overrides = {}) {
	return {
		cwd: CWD,
		taskId: "T-20260831-001",
		workerRunId: "call-1",
		finalGitRef: "abc1234",
		gitStatusHash: "hash-base",
		changedPaths: [],
		gitAvailable: true,
		generatedAt: "2026-08-31T09:00:00.000Z",
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
// Attribution (A vs C) and declaration cross-check (B vs truth)
// --------------------------------------------------------------------------

const declaredA = makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts"] });

// 1. matching declaration against A-to-C delta is fresh
const unchanged = compareEvidence(makeBase(), makeCurrent(), declaredA);
assert.equal(unchanged.fresh, true);
assert.deepEqual(unchanged.reasons, []);
assert.deepEqual(unchanged.truthPaths, ["/repo/src/a.ts"]);
assert.deepEqual(unchanged.undeclaredPaths, []);
assert.deepEqual(unchanged.extraDeclaredPaths, []);
assert.equal(evidenceAction(unchanged), "review");
assert.equal(isEvidenceStale(makeBase(), makeCurrent(), declaredA), false);

// 2. HEAD moved vs Worker declaration -> stale, must revalidate
const headMoved = compareEvidence(
	makeBase(),
	makeCurrent({ finalGitRef: "def5678" }),
	declaredA,
);
assert.equal(headMoved.fresh, false);
assert.equal(evidenceAction(headMoved), "revalidate");
assert.ok(headMoved.reasons.some((reason) => /HEAD changed/.test(reason)));

// 3. working tree changed with no explainable path delta -> stale, revalidate
const statusChanged = compareEvidence(
	makeBase(),
	makeCurrent({ gitStatusHash: "hash-two" }),
	declaredA,
);
assert.equal(statusChanged.fresh, false);
assert.equal(evidenceAction(statusChanged), "revalidate");
assert.ok(statusChanged.reasons.some((reason) => /working tree changed/.test(reason)));

// 4. undeclared out-of-scope path is unrelated; review may continue
const unrelated = compareEvidence(
	makeBase(),
	makeCurrent({ gitStatusHash: "hash-two", changedPaths: ["src/a.ts", "docs/readme.md"] }),
	declaredA,
	{ scope: { allowedPaths: ["src/a.ts"] } },
);
assert.equal(unrelated.fresh, false);
assert.deepEqual(unrelated.truthPaths, ["/repo/docs/readme.md", "/repo/src/a.ts"]);
assert.deepEqual(unrelated.overlappingPaths, []);
assert.deepEqual(unrelated.unrelatedPaths, ["/repo/docs/readme.md"]);
assert.deepEqual(unrelated.undeclaredPaths, ["/repo/docs/readme.md"]);
assert.equal(evidenceAction(unrelated), "review");
assert.match(describeComparison(unrelated), /out-of-scope/);

// 5. omitted in-scope path stays in the scope denominator and must revalidate
const omittedInScope = compareEvidence(
	makeBase(),
	makeCurrent({ gitStatusHash: "hash-two", changedPaths: ["src/a.ts", "src/b.ts"] }),
	declaredA,
	{ scope: { allowedPaths: ["src/a.ts", "src/b.ts"] } },
);
assert.equal(omittedInScope.fresh, false);
assert.deepEqual(omittedInScope.truthPaths, ["/repo/src/a.ts", "/repo/src/b.ts"]);
assert.deepEqual(omittedInScope.overlappingPaths, ["/repo/src/b.ts"]);
assert.deepEqual(omittedInScope.undeclaredPaths, ["/repo/src/b.ts"]);
assert.equal(evidenceAction(omittedInScope), "revalidate");

// 6. a reported change disappeared -> revalidate
const reverted = compareEvidence(
	makeBase(),
	makeCurrent({ gitStatusHash: "hash-two", changedPaths: [] }),
	declaredA,
);
assert.equal(reverted.fresh, false);
assert.deepEqual(reverted.missingPaths, ["/repo/src/a.ts"]);
assert.deepEqual(reverted.extraDeclaredPaths, ["/repo/src/a.ts"]);
assert.equal(evidenceAction(reverted), "revalidate");

// 7. cwd drift and superseded tasks are always stale
const cwdDrift = compareEvidence(makeBase(), makeCurrent({ cwd: "/other" }), declaredA);
assert.equal(evidenceAction(cwdDrift), "revalidate");
assert.ok(cwdDrift.reasons.some((reason) => /cwd changed/.test(reason)));

const superseded = compareEvidence(makeBase(), makeCurrent(), declaredA, { superseded: true });
assert.equal(superseded.fresh, false);
assert.equal(evidenceAction(superseded), "revalidate");

// 8. missing Git on Root A or C is unverifiable and requires revalidation
const noGit = compareEvidence(
	makeBase({ gitAvailable: false }),
	makeCurrent({ gitAvailable: false, changedPaths: ["src/a.ts"] }),
	declaredA,
);
assert.equal(noGit.fresh, false);
assert.equal(noGit.verifiable, false);
assert.equal(evidenceAction(noGit), "revalidate");
assert.match(describeComparison(noGit), /unverifiable/);

// Worker gitAvailable=false must not disable Root A-to-C attribution
const workerUnverifiable = compareEvidence(
	makeBase(),
	makeCurrent(),
	makeReport({ gitAvailable: false, changedPaths: ["src/a.ts"] }),
);
assert.equal(workerUnverifiable.verifiable, true);
assert.deepEqual(workerUnverifiable.truthPaths, ["/repo/src/a.ts"]);

// 9. omitted Worker Git fingerprints do not prevent Root attribution
const noFingerprints = compareEvidence(
	makeBase(),
	makeCurrent(),
	makeReport({ changedPaths: ["src/a.ts"] }),
);
assert.equal(noFingerprints.verifiable, true);
assert.equal(noFingerprints.fresh, true);
assert.deepEqual(noFingerprints.truthPaths, ["/repo/src/a.ts"]);
assert.deepEqual(noFingerprints.undeclaredPaths, []);

// 10. pre-existing dirty paths in A are excluded from the delegation delta
const dirtyBaseline = compareEvidence(
	makeBase({ changedPaths: ["src/legacy.ts"], gitStatusHash: "hash-dirty" }),
	makeCurrent({ gitStatusHash: "hash-one", changedPaths: ["src/legacy.ts", "src/a.ts"] }),
	declaredA,
);
assert.equal(dirtyBaseline.fresh, true);
assert.deepEqual(dirtyBaseline.truthPaths, ["/repo/src/a.ts"]);
assert.deepEqual(dirtyBaseline.overlappingPaths, []);
assert.deepEqual(dirtyBaseline.unrelatedPaths, []);
assert.deepEqual(dirtyBaseline.undeclaredPaths, []);

// 11. declared path that was already dirty in A is over-reporting, not attribution
const overReported = compareEvidence(
	makeBase({ changedPaths: ["src/legacy.ts"] }),
	makeCurrent({ changedPaths: ["src/legacy.ts", "src/a.ts"] }),
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts", "src/legacy.ts"] }),
);
assert.deepEqual(overReported.truthPaths, ["/repo/src/a.ts"]);
assert.deepEqual(overReported.extraDeclaredPaths, ["/repo/src/legacy.ts"]);
assert.equal(overReported.fresh, false);
assert.equal(evidenceAction(overReported), "revalidate");
assert.match(describeComparison(overReported), /over-reported|unreliable/);

// --------------------------------------------------------------------------
// Phase 2 — rendering distinguishes attribution, mismatch, unverifiable
// --------------------------------------------------------------------------

assert.match(describeComparison(unchanged), /^fresh \(attributed 1 path/);
assert.match(describeComparison(omittedInScope), /under-reported/);
assert.match(describeComparison(unrelated), /stale \(out-of-scope only\)/);
assert.match(describeComparison(noGit), /^unverifiable:/);

const emptyDelta = compareEvidence(
	makeBase({ changedPaths: ["src/a.ts"], gitStatusHash: "hash-one" }),
	makeCurrent(),
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: [] }),
);
assert.equal(emptyDelta.truthPaths.length, 0);
assert.match(describeComparison(emptyDelta), /^fresh \(attributed 0 paths?\)$/);

const packet = await captureReviewEvidencePacket(runner, CWD, omittedInScope);
assert.equal(packet.gitAvailable, true);
assert.deepEqual(packet.attributedFiles, omittedInScope.truthPaths.slice(0, 100));
assert.deepEqual(packet.undeclaredFiles, omittedInScope.undeclaredPaths.slice(0, 100));
assert.equal(packet.extraDeclaredFiles, undefined);

const unverifiablePacket = await captureReviewEvidencePacket(
	async () => ({ stdout: "", code: 128 }),
	CWD,
	noGit,
);
assert.equal(unverifiablePacket.gitAvailable, false);
assert.equal(unverifiablePacket.attributedFiles, undefined);

console.log("planner-only evidence: PASS");
