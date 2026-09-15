import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compareEvidence, compareExecutionTruth, compareFreshness } from "./evidence.ts";
import { ConcurrencyController } from "./concurrency.ts";
import { PlannerOrchestrator } from "./orchestrate.ts";

function sample(overrides = {}) {
	return {
		cwd: "/repo",
		finalGitRef: "head-a",
		gitStatusHash: "clean-a",
		changedPaths: [],
		gitAvailable: true,
		generatedAt: "2026-09-12T10:00:00.000Z",
		...overrides,
	};
}

function report(changedFiles = [], overrides = {}) {
	return {
		version: 1,
		taskId: "T-20260912-009",
		status: "completed",
		summary: "evidence",
		changedFiles,
		validation: [],
		evidence: { ...sample(), changedPaths: [...changedFiles], ...overrides },
		risks: [],
		unresolved: [],
	};
}

// A09: pre-existing dirty content is attributed only when its content changes.
const existingDirty = compareExecutionTruth(
	sample({ changedPaths: ["src/existing.ts"], dirtyPathHashes: { "/repo/src/existing.ts": "old" } }),
	sample({ changedPaths: ["src/existing.ts"], dirtyPathHashes: { "/repo/src/existing.ts": "new" } }),
	report(["src/existing.ts"]),
);
assert.deepEqual(existingDirty.executionChangedPaths, ["/repo/src/existing.ts"]);
assert.deepEqual(existingDirty.committedPaths, []);
assert.deepEqual(existingDirty.undeclaredPaths, []);

// A09: edits created during the execution are attributed as working-tree edits.
const newEdit = compareExecutionTruth(
	sample(),
	sample({ changedPaths: ["src/new.ts"] }),
	report(["src/new.ts"]),
);
assert.deepEqual(newEdit.executionChangedPaths, ["/repo/src/new.ts"]);
assert.deepEqual(newEdit.committedPaths, []);
assert.deepEqual(newEdit.undeclaredPaths, []);

// A09: a read-only execution can observe another execution's commit, but the
// commit is never charged as an executionChangedPath or declaration finding.
const observedCommit = compareExecutionTruth(
	sample({ finalGitRef: "head-a" }),
	sample({ finalGitRef: "head-b", committedPaths: ["src/other.ts"] }),
	report(),
	{ readOnly: true },
);
assert.deepEqual(observedCommit.executionChangedPaths, []);
assert.deepEqual(observedCommit.undeclaredPaths, []);
assert.deepEqual(observedCommit.observedExternalPaths, ["/repo/src/other.ts"]);
assert.equal(observedCommit.committedPaths.includes("/repo/src/other.ts"), true, "observed commit remains visible as external evidence");

// A09: unknown external modifications are observable without becoming a
// read-only execution's attributed work; freshness remains independently testable.
const externalModification = compareExecutionTruth(
	sample(),
	sample({ changedPaths: ["external.txt"], gitStatusHash: "dirty" }),
	report(),
	{ readOnly: true },
);
assert.deepEqual(externalModification.executionChangedPaths, []);
assert.deepEqual(externalModification.undeclaredPaths, []);
assert.deepEqual(externalModification.observedExternalPaths, ["/repo/external.txt"]);
assert.equal(compareFreshness(sample(), sample()).fresh, true);
assert.equal(compareFreshness(sample(), sample({ changedPaths: ["external.txt"] })).fresh, false);
const scopedExternal = compareEvidence(
	sample(),
	sample({ changedPaths: ["external.txt"] }),
	report(),
	{ scope: { allowedPaths: ["src/owned.ts"] } },
);
assert.deepEqual(scopedExternal.unrelatedPaths, ["/repo/external.txt"]);

console.log("rs02 concurrency tests passed");
