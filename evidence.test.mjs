import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
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

// Worker gitAvailable=false must not disable Root A-to-C attribution, but a
// report with no binding evidence at all cannot be fresh (FR-01/FR-02)
const workerUnverifiable = compareEvidence(
	makeBase(),
	makeCurrent(),
	makeReport({ gitAvailable: false, changedPaths: ["src/a.ts"] }),
);
assert.deepEqual(workerUnverifiable.truthPaths, ["/repo/src/a.ts"]);
assert.equal(workerUnverifiable.fresh, false);
assert.equal(evidenceAction(workerUnverifiable), "revalidate");
assert.match(describeComparison(workerUnverifiable), /report evidence incomplete/);

// 9. omitted Worker Git fingerprints: attribution survives, but a report with
//    no HEAD/status/content binding at all is unknown and asks for re-validation
const noFingerprints = compareEvidence(
	makeBase(),
	makeCurrent(),
	makeReport({ changedPaths: ["src/a.ts"] }),
);
assert.deepEqual(noFingerprints.truthPaths, ["/repo/src/a.ts"]);
assert.equal(noFingerprints.fresh, false);
assert.equal(noFingerprints.verifiable, false);
assert.equal(evidenceAction(noFingerprints), "revalidate");
assert.match(describeComparison(noFingerprints), /report evidence incomplete/);

// 9c. a report with status/content data but no HEAD binding is unknown (E07)
const noHeadBinding = compareEvidence(
	makeBase(),
	makeCurrent(),
	makeReport({ gitStatusHash: "hash-one", changedPaths: ["src/a.ts"] }),
);
assert.equal(noHeadBinding.verifiable, false);
assert.equal(evidenceAction(noHeadBinding), "revalidate");
assert.match(describeComparison(noHeadBinding), /no HEAD binding/);

// 9b. partial bindings still verify: a report carrying HEAD + status binds fine
const partialBinding = compareEvidence(
	makeBase(),
	makeCurrent(),
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts"] }),
);
assert.equal(partialBinding.verifiable, true);
assert.equal(partialBinding.fresh, true);

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
//     (RF-1 A3 — rewritten: with the blob hash *equal* at A and C, the
//     over-reported expectation still holds)
const overReported = compareEvidence(
	makeBase({ changedPaths: ["src/legacy.ts"], dirtyPathHashes: { "src/legacy.ts": "hash-same" } }),
	makeCurrent({ changedPaths: ["src/legacy.ts", "src/a.ts"], dirtyPathHashes: { "src/legacy.ts": "hash-same" } }),
	makeReport({ finalGitRef: "abc1234", gitStatusHash: "hash-one", changedPaths: ["src/a.ts", "src/legacy.ts"] }),
);
assert.deepEqual(overReported.truthPaths, ["/repo/src/a.ts"]);
assert.deepEqual(overReported.extraDeclaredPaths, ["/repo/src/legacy.ts"]);
assert.equal(overReported.fresh, false);
assert.equal(evidenceAction(overReported), "revalidate");
assert.match(describeComparison(overReported), /over-reported|unreliable/);

// --------------------------------------------------------------------------
// RF-1 — committed delta (T2) and content-changed baseline (T3)
// --------------------------------------------------------------------------

function rf1Runner(responses, calls) {
	return async (args) => {
		calls.push(args.join(" "));
		return responses[args.join(" ")] ?? { stdout: "", code: 128 };
	};
}

const RF1_DIFF_KEY = "diff --name-only --no-ext-diff --no-textconv abc1234 def5678";

function callsInclude(aCalls, cCalls, key) {
	return cCalls.includes(key) && !aCalls.includes(key);
}

// A1. worker commits between A and C: the committed delta (T2) is attributed
{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-test-"));
	try {
		const aCalls = [];
		const base = await captureEvidence(rf1Runner({
			"rev-parse --git-dir": { stdout: ".git\n", code: 0 },
			"rev-parse HEAD": { stdout: "abc1234\n", code: 0 },
			"status --porcelain=v2 --branch": { stdout: "", code: 0 },
			"diff HEAD --stat": { stdout: "", code: 0 },
		}, aCalls), { cwd: dir, taskId: "T-1", workerRunId: "call-1" });
		assert.equal(base.finalGitRef, "abc1234");
		assert.equal(base.dirtyPathHashes, undefined);
		assert.equal(base.committedPaths, undefined);

		const cCalls = [];
		const current = await captureEvidence(rf1Runner({
			"rev-parse --git-dir": { stdout: ".git\n", code: 0 },
			"rev-parse HEAD": { stdout: "def5678\n", code: 0 },
			"status --porcelain=v2 --branch": { stdout: "", code: 0 },
			"diff HEAD --stat": { stdout: "", code: 0 },
			[RF1_DIFF_KEY]: { stdout: "a.txt\nb.txt\n", code: 0 },
		}, cCalls), { cwd: dir, taskId: "T-1", workerRunId: "call-1", baseGitRef: "abc1234" });
		assert.equal(current.baseGitRef, "abc1234");
		assert.equal(current.finalGitRef, "def5678");
		assert.deepEqual(current.committedPaths, ["a.txt", "b.txt"]);
		assert.ok(callsInclude(aCalls, cCalls, RF1_DIFF_KEY));

		const committed = compareEvidence(base, current, makeReport({
			cwd: dir,
			finalGitRef: "def5678",
			changedPaths: ["a.txt", "b.txt"],
		}));
		assert.equal(committed.fresh, true);
		assert.deepEqual(committed.reasons, []);
		assert.deepEqual(committed.truthPaths, [join(dir, "a.txt"), join(dir, "b.txt")]);
		assert.deepEqual(committed.missingPaths, []);
		assert.deepEqual(committed.extraDeclaredPaths, []);
		assert.equal(evidenceAction(committed), "review");
		assert.equal(isEvidenceStale(base, current, makeReport({
			cwd: dir,
			finalGitRef: "def5678",
			changedPaths: ["a.txt", "b.txt"],
		})), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// A2. baseline-dirty path whose blob hash differs at C is attributed (T3)
{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-test-"));
	try {
		writeFileSync(join(dir, "legacy.ts"), "v1\n");
		const porcelain = [
			"# branch.oid abc1234",
			"# branch.head main",
			"1 .M N... 100644 100644 100644 1111111 2222222 legacy.ts",
		].join("\n");
		const common = {
			"rev-parse --git-dir": { stdout: ".git\n", code: 0 },
			"rev-parse HEAD": { stdout: "abc1234\n", code: 0 },
			"status --porcelain=v2 --branch": { stdout: porcelain, code: 0 },
			"diff HEAD --stat": { stdout: " legacy.ts | 2 +-\n", code: 0 },
		};
		const aCalls = [];
		const base = await captureEvidence(rf1Runner({
			...common,
			"hash-object -- legacy.ts": { stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n", code: 0 },
		}, aCalls), { cwd: dir, taskId: "T-1", workerRunId: "call-1" });
		assert.deepEqual(base.dirtyPathHashes, { "legacy.ts": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
		assert.ok(aCalls.includes("hash-object -- legacy.ts"));

		writeFileSync(join(dir, "legacy.ts"), "v2 with worker edits\n");
		const cCalls = [];
		const current = await captureEvidence(rf1Runner({
			...common,
			"hash-object -- legacy.ts": { stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n", code: 0 },
		}, cCalls), { cwd: dir, taskId: "T-1", workerRunId: "call-1", baseGitRef: "abc1234" });
		assert.deepEqual(current.dirtyPathHashes, { "legacy.ts": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
		assert.deepEqual(current.committedPaths, []);
		assert.ok(!cCalls.some((call) => call.startsWith("diff --name-only")));

		const contentChanged = compareEvidence(base, current, makeReport({
			cwd: dir,
			finalGitRef: "abc1234",
			gitStatusHash: hashStatus(porcelain),
			changedPaths: ["legacy.ts"],
		}));
		assert.equal(contentChanged.fresh, true);
		assert.deepEqual(contentChanged.truthPaths, [join(dir, "legacy.ts")]);
		assert.deepEqual(contentChanged.undeclaredPaths, []);
		assert.deepEqual(contentChanged.extraDeclaredPaths, []);
		assert.deepEqual(contentChanged.missingPaths, []);
		assert.equal(evidenceAction(contentChanged), "review");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// T3 edge: a path deleted at A hashes to null and counts as changed when C has a hash
{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-test-"));
	try {
		const base = await captureEvidence(rf1Runner({
			"rev-parse --git-dir": { stdout: ".git\n", code: 0 },
			"rev-parse HEAD": { stdout: "abc1234\n", code: 0 },
			"status --porcelain=v2 --branch": {
				stdout: "# branch.oid abc1234\n# branch.head main\n1 .D N... 100644 100644 100644 1111111 0000000 gone.txt\n",
				code: 0,
			},
			"diff HEAD --stat": { stdout: "", code: 0 },
		}, []), { cwd: dir, taskId: "T-1", workerRunId: "call-1" });
		assert.deepEqual(base.dirtyPathHashes, { "gone.txt": null });

		writeFileSync(join(dir, "gone.txt"), "restored\n");
		const current = await captureEvidence(rf1Runner({
			"rev-parse --git-dir": { stdout: ".git\n", code: 0 },
			"rev-parse HEAD": { stdout: "abc1234\n", code: 0 },
			"status --porcelain=v2 --branch": {
				stdout: "# branch.oid abc1234\n# branch.head main\n1 .M N... 100644 100644 100644 1111111 2222222 gone.txt\n",
				code: 0,
			},
			"diff HEAD --stat": { stdout: "", code: 0 },
			"hash-object -- gone.txt": { stdout: "cccccccccccccccccccccccccccccccccccccccc\n", code: 0 },
		}, []), { cwd: dir, taskId: "T-1", workerRunId: "call-1", baseGitRef: "abc1234" });
		assert.deepEqual(current.dirtyPathHashes, { "gone.txt": "cccccccccccccccccccccccccccccccccccccccc" });

		const restored = compareEvidence(base, current, makeReport({
			cwd: dir,
			finalGitRef: "abc1234",
			changedPaths: ["gone.txt"],
		}));
		assert.equal(restored.fresh, true);
		assert.deepEqual(restored.truthPaths, [join(dir, "gone.txt")]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// A4. 201 dirty paths at A: the baseline hash list is capped and the omission is visible
{
	const paths = Array.from({ length: 201 }, (_, index) => `dirty/p${String(index).padStart(3, "0")}.txt`);
	const porcelain201 = paths.map((path) => `? ${path}`).join("\n");
	const aCalls = [];
	const base = await captureEvidence(rf1Runner({
		"rev-parse --git-dir": { stdout: ".git\n", code: 0 },
		"rev-parse HEAD": { stdout: "abc1234\n", code: 0 },
		"status --porcelain=v2 --branch": { stdout: porcelain201, code: 0 },
		"diff HEAD --stat": { stdout: "", code: 0 },
	}, aCalls), { cwd: "/repo", taskId: "T-1", workerRunId: "call-1" });
	assert.equal(base.changedPaths.length, 201);
	assert.equal(base.dirtyPathHashes, undefined);
	assert.ok(!aCalls.some((call) => call.startsWith("hash-object")));

	const skipped = compareEvidence(
		base,
		makeCurrent({ changedPaths: ["dirty/p000.txt", "src/a.ts"] }),
		makeReport({ finalGitRef: "abc1234", changedPaths: ["src/a.ts", "dirty/p000.txt"] }),
	);
	assert.ok(skipped.reasons.some((reason) => reason === "baseline hash skipped (201 dirty paths)"));
	// T3 stays empty above the cap: the baseline-dirty path is not attributed
	assert.deepEqual(skipped.truthPaths, ["/repo/src/a.ts"]);
}

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

// --------------------------------------------------------------------------
// FR-01/FR-02 regressions in a real temporary Git repository (ticket 02)
// --------------------------------------------------------------------------


function realGitRunnerOf(dir) {
	return async (args, cwd) => {
		const result = spawnSync("git", ["-C", cwd || dir, ...args], { encoding: "utf8" });
		return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status ?? 1 };
	};
}


function patchNames(patch) {
	if (!patch) return [];
	return [...patch.matchAll(/^diff --git a\/(.*) b\/(.*)$/gm)].map((match) => match[2]);
}

function realGit(dir, ...args) {
	const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	return result.stdout;
}

function initRealRepo() {
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-realgit-"));
	realGit(dir, "init", "-q");
	realGit(dir, "config", "user.email", "test@example.com");
	realGit(dir, "config", "user.name", "Test");
	realGit(dir, "config", "commit.gpgsign", "false");
	writeFileSync(join(dir, "tracked.txt"), "base\n");
	realGit(dir, "add", ".");
	realGit(dir, "commit", "-m", "base", "-q");
	return dir;
}

/** A report whose evidence is bound to Root's sample, as the orchestrator records it. */
function boundReport(taskId, toolCallId, sample, cwd, changedPaths) {
	return {
		version: 1,
		taskId,
		status: "completed",
		summary: "done",
		changedFiles: changedPaths,
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
		evidence: {
			cwd,
			taskId,
			workerRunId: toolCallId,
			...(sample.finalGitRef ? { finalGitRef: sample.finalGitRef } : {}),
			...(sample.gitStatusHash ? { gitStatusHash: sample.gitStatusHash } : {}),
			...(sample.dirtyPathHashes ? { dirtyPathHashes: sample.dirtyPathHashes } : {}),
			changedPaths,
			gitAvailable: true,
			generatedAt: new Date().toISOString(),
		},
		risks: [],
		unresolved: [],
	};
}

// E01: dirty file content changes after the report with identical porcelain status -> stale
{
	const dir = initRealRepo();
	try {
		const base = await captureEvidence(realGitRunnerOf(dir), { cwd: dir, taskId: "T-1", workerRunId: "call-1" });
		writeFileSync(join(dir, "tracked.txt"), "worker edit\n");
		const reportSample = await captureEvidence(realGitRunnerOf(dir), { cwd: dir, taskId: "T-1", workerRunId: "call-1", baseGitRef: base.finalGitRef });
		const report = boundReport("T-1", "call-1", reportSample, dir, ["tracked.txt"]);

		// external edit between the report and acceptance: same status, different bytes
		writeFileSync(join(dir, "tracked.txt"), "external edit\n");
		const acceptance = await captureEvidence(realGitRunnerOf(dir), { cwd: dir, taskId: "T-1", workerRunId: "call-1", baseGitRef: base.finalGitRef });
		assert.equal(acceptance.gitStatusHash, reportSample.gitStatusHash, "porcelain status must be unchanged");
		assert.notDeepEqual(acceptance.dirtyPathHashes, reportSample.dirtyPathHashes, "content must have changed");

		const comparison = compareEvidence(base, acceptance, report);
		assert.equal(comparison.fresh, false);
		assert.equal(evidenceAction(comparison), "revalidate");
		assert.ok(comparison.reasons.some((reason) => /content changed since the report/.test(reason)), comparison.reasons.join("; "));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// E02: untracked in-scope file content change after the report -> stale
{
	const dir = initRealRepo();
	try {
		const base = await captureEvidence(realGitRunnerOf(dir), { cwd: dir, taskId: "T-1", workerRunId: "call-1" });
		writeFileSync(join(dir, "notes.md"), "v1\n");
		const reportSample = await captureEvidence(realGitRunnerOf(dir), { cwd: dir, taskId: "T-1", workerRunId: "call-1", baseGitRef: base.finalGitRef });
		const report = boundReport("T-1", "call-1", reportSample, dir, ["notes.md"]);

		writeFileSync(join(dir, "notes.md"), "v2 changed\n");
		const acceptance = await captureEvidence(realGitRunnerOf(dir), { cwd: dir, taskId: "T-1", workerRunId: "call-1", baseGitRef: base.finalGitRef });
		assert.equal(acceptance.gitStatusHash, reportSample.gitStatusHash, "untracked status entry must be unchanged");

		const comparison = compareEvidence(base, acceptance, report);
		assert.equal(comparison.fresh, false);
		assert.equal(evidenceAction(comparison), "revalidate");
		assert.ok(comparison.reasons.some((reason) => /content changed since the report/.test(reason)), comparison.reasons.join("; "));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// E06: a non-zero (or timed-out) status probe is unknown, not an empty clean tree
{
	const dir = initRealRepo();
	try {
		const base = await captureEvidence(realGitRunnerOf(dir), { cwd: dir, taskId: "T-1", workerRunId: "call-1" });
		writeFileSync(join(dir, "tracked.txt"), "dirty\n");
		const healthy = await captureEvidence(realGitRunnerOf(dir), { cwd: dir, taskId: "T-1", workerRunId: "call-1", baseGitRef: base.finalGitRef });
		const report = boundReport("T-1", "call-1", healthy, dir, ["tracked.txt"]);
		assert.equal(healthy.statusProbeFailed, undefined);

		// a hung/killed status command: non-zero exit on the acceptance sample only
		const failingStatus = async (args) => {
			if (args[0] === "status") return { stdout: "", stderr: "fatal: unable to read tree", code: 128 };
			return realGitRunnerOf(dir)(args, dir);
		};
		const probe = await probeGit(failingStatus, dir);
		assert.equal(probe.available, true);
		assert.equal(probe.statusFailed, true);
		const acceptance = await captureEvidence(failingStatus, { cwd: dir, taskId: "T-1", workerRunId: "call-1", baseGitRef: base.finalGitRef });
		assert.equal(acceptance.statusProbeFailed, true);
		assert.equal(acceptance.gitStatusHash, undefined, "no fake clean-tree hash");

		const comparison = compareEvidence(base, acceptance, report);
		assert.equal(comparison.verifiable, false, "probe failure must be unknown, not verifiable");
		assert.equal(comparison.fresh, false);
		assert.equal(evidenceAction(comparison), "revalidate");
		assert.ok(comparison.reasons.some((reason) => /git status probe failed/.test(reason)), comparison.reasons.join("; "));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// E07: a report with no Git binding evidence at all is unknown at the boundary
{
	const dir = initRealRepo();
	try {
		const base = await captureEvidence(realGitRunnerOf(dir), { cwd: dir, taskId: "T-1", workerRunId: "call-1" });
		writeFileSync(join(dir, "tracked.txt"), "dirty\n");
		const acceptance = await captureEvidence(realGitRunnerOf(dir), { cwd: dir, taskId: "T-1", workerRunId: "call-1", baseGitRef: base.finalGitRef });
		const unbound = boundReport("T-1", "call-1", { finalGitRef: undefined, gitStatusHash: undefined, dirtyPathHashes: undefined }, dir, ["tracked.txt"]);
		const comparison = compareEvidence(base, acceptance, unbound);
		assert.equal(comparison.verifiable, false);
		assert.equal(evidenceAction(comparison), "revalidate");
		assert.ok(comparison.reasons.some((reason) => /report evidence incomplete/.test(reason)), comparison.reasons.join("; "));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// --------------------------------------------------------------------------
// FR-05 — bounded reviewer patch against the Task baseline (ticket 04)
// --------------------------------------------------------------------------

// R01: only staged whitespace-breaking changes -> the staged diff-check keeps
// its non-zero exit and the problem text.
{
	const dir = initRealRepo();
	try {
		writeFileSync(join(dir, "style.txt"), "trailing whitespace here \n");
		realGit(dir, "add", "style.txt");
		const packet = await captureReviewEvidencePacket(realGitRunnerOf(dir), dir, undefined, { baselineRef: realGit(dir, "rev-parse", "HEAD").trim() });
		assert.equal(packet.gitAvailable, true);
		assert.ok(packet.diffCheckStaged, "staged diff-check must run");
		assert.notEqual(packet.diffCheckStaged.exitCode, 0, "staged whitespace error must keep the non-zero exit");
		assert.match(packet.diffCheckStaged.stdout ?? "", /trailing whitespace/);
		assert.equal(packet.diffCheck.exitCode, 0, "unstaged check stays clean");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// R02: deleting a required check is visible as patch content, not just a path.
{
	const dir = initRealRepo();
	try {
		realGit(dir, "mv", "tracked.txt", "checks.ts");
		writeFileSync(join(dir, "checks.ts"), "function requiredCheck() {\n  return true;\n}\n");
		realGit(dir, "add", ".");
		realGit(dir, "commit", "-m", "add check", "-q");
		const baseline = realGit(dir, "rev-parse", "HEAD").trim();
		writeFileSync(join(dir, "checks.ts"), "function requiredCheck() {\n  return false;\n}\n");

		const packet = await captureReviewEvidencePacket(realGitRunnerOf(dir), dir, undefined, { baselineRef: baseline });
		assert.ok(packet.patch, "the packet must carry a patch");
		assert.ok(packet.patch.includes("-  return true;"), "the deleted line is visible in the patch");
		assert.ok(packet.patch.includes("+  return false;"));
		assert.equal(patchNames(packet.patch).includes("checks.ts"), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// R03: the worker commits the Task's changes — the patch stays relative to the
// Task baseline instead of becoming empty because HEAD moved.
{
	const dir = initRealRepo();
	try {
		const baseline = realGit(dir, "rev-parse", "HEAD").trim();
		writeFileSync(join(dir, "tracked.txt"), "task change\n");
		realGit(dir, "add", ".");
		realGit(dir, "commit", "-m", "worker commits", "-q");

		const packet = await captureReviewEvidencePacket(realGitRunnerOf(dir), dir, undefined, { baselineRef: baseline });
		assert.ok(packet.patch, "committed task changes must still produce a patch");
		assert.ok(packet.patch.includes("+task change"), "the committed change is in the patch");
		assert.equal(packet.baselineRef, baseline);
		assert.notEqual(packet.head, baseline, "HEAD moved, the patch baseline did not");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// R04: a patch over budget marks omitted paths and truncated totals.
{
	const dir = initRealRepo();
	try {
		const baseline = realGit(dir, "rev-parse", "HEAD").trim();
		const lines = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(60)}`);
		writeFileSync(join(dir, "big.txt"), `${lines.join("\n")}\n`);
		writeFileSync(join(dir, "small.txt"), "tiny\n");
		realGit(dir, "add", ".");

		const packet = await captureReviewEvidencePacket(realGitRunnerOf(dir), dir, undefined, { baselineRef: baseline });
		assert.equal(packet.patchTruncated, true, "the oversized file must be omitted");
		assert.deepEqual(packet.patchOmittedPaths, ["big.txt"]);
		assert.equal(patchNames(packet.patch).includes("small.txt"), true, "the small file still makes it in");
		assert.equal(patchNames(packet.patch).includes("big.txt"), false);
		assert.equal(packet.patchTotalFiles, 2);
		assert.equal(packet.patchReturnedFiles, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Binary changes keep a fingerprint, never a fake text patch.
{
	const dir = initRealRepo();
	try {
		const baseline = realGit(dir, "rev-parse", "HEAD").trim();
		writeFileSync(join(dir, "asset.bin"), Buffer.from([0, 1, 2, 0, 3]));
		realGit(dir, "add", "asset.bin");
		realGit(dir, "commit", "-m", "asset", "-q");
		writeFileSync(join(dir, "asset.bin"), Buffer.from([9, 8, 7, 0, 6]));

		const packet = await captureReviewEvidencePacket(realGitRunnerOf(dir), dir, undefined, { baselineRef: baseline });
		assert.deepEqual(packet.binaryFiles?.map((entry) => entry.path), ["asset.bin"]);
		assert.match(packet.binaryFiles?.[0]?.fingerprint ?? "", /^[0-9a-f]{40}$/, "the binary blob has a content fingerprint");
		if (packet.patch) {
			assert.doesNotMatch(packet.patch, /\x00/, "no binary bytes are smuggled into the text patch");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

console.log("planner-only evidence: PASS");
