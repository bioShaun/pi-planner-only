import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	compareExecutionTruth,
	captureEvidence,
} from "./evidence.ts";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { TaskStore, createTaskSpec, createTaskId } from "./task.ts";
import { decideReview } from "./review.ts";

const CWD = "/repo";

// =========================================================================
// (a) real-git / unit tests for compareExecutionTruth:
// pre-dirty in-scope tracked file with priorLedger basis declared but baseline
// incomplete => finding kind 'attribution-gap', NOT 'over-declared';
// same setup WITHOUT prior basis (no priorTruthPaths, file not in basePaths) => 'over-declared' as today.
// =========================================================================
{
	const aRun = {
		cwd: CWD,
		taskId: "T-20260913-001",
		workerRunId: "run-0",
		finalGitRef: "head-1",
		gitStatusHash: "dirty-base",
		changedPaths: ["src/target.ts"], // pre-existing dirt
		gitAvailable: true,
		snapshotGap: {
			reason: "hash-failed",
			paths: ["src/target.ts"],
		},
	};

	const cReport = {
		cwd: CWD,
		taskId: "T-20260913-001",
		workerRunId: "run-1",
		finalGitRef: "head-1",
		gitStatusHash: "dirty-report",
		changedPaths: ["src/target.ts"],
		gitAvailable: true,
	};

	const reportWithDeclaration = {
		version: 1,
		taskId: "T-20260913-001",
		status: "completed",
		summary: "modified pre-dirty file",
		changedFiles: ["src/target.ts"],
		validation: [],
		evidence: {
			cwd: CWD,
			taskId: "T-20260913-001",
			workerRunId: "run-1",
			finalGitRef: "head-1",
			gitStatusHash: "dirty-report",
			changedPaths: ["src/target.ts"],
			gitAvailable: true,
		},
		risks: [],
		unresolved: [],
	};

	// With prior-ledger basis (file in aRun.changedPaths and scope covers it)
	const compWithBasis = compareExecutionTruth(aRun, cReport, reportWithDeclaration, {
		scope: { allowedPaths: ["src/target.ts"] },
		priorTruthPaths: ["src/target.ts"],
	});

	assert.equal(compWithBasis.extraDeclaredPaths.some((p) => p.endsWith("src/target.ts")), false, "should NOT be in extraDeclaredPaths");
	assert.ok(compWithBasis.attributionGapPaths?.some((p) => p.endsWith("src/target.ts")), "should be in attributionGapPaths");
	assert.ok(
		compWithBasis.findings.some((f) => f.kind === "attribution-gap" && f.paths.some((p) => p.endsWith("src/target.ts"))),
		"finding kind must be 'attribution-gap', not 'over-declared'",
	);
	assert.equal(
		compWithBasis.findings.some((f) => f.kind === "over-declared"),
		false,
		"must not emit over-declared finding",
	);

	// Same setup WITHOUT prior basis (no priorTruthPaths, file not in basePaths, head changed)
	const aRunWithoutBasis = {
		cwd: CWD,
		taskId: "T-20260913-001",
		workerRunId: "run-0",
		finalGitRef: "head-1",
		gitStatusHash: "dirty-base",
		changedPaths: [], // not in basePaths
		gitAvailable: true,
		snapshotGap: {
			reason: "hash-failed",
			paths: ["src/target.ts"],
		},
	};
	const cReportWithoutBasis = {
		cwd: CWD,
		taskId: "T-20260913-001",
		workerRunId: "run-1",
		finalGitRef: "head-2", // head changed
		gitStatusHash: "clean-report",
		changedPaths: [], // not in currentPaths
		gitAvailable: true,
	};
	const compWithoutBasis = compareExecutionTruth(aRunWithoutBasis, cReportWithoutBasis, reportWithDeclaration, {
		scope: { allowedPaths: ["src/target.ts"] },
		priorTruthPaths: [], // no prior basis
	});

	assert.ok(
		compWithoutBasis.extraDeclaredPaths.some((p) => p.endsWith("src/target.ts")),
		"without prior basis, should be in extraDeclaredPaths",
	);
	assert.ok(
		compWithoutBasis.findings.some((f) => f.kind === "over-declared" && f.paths.some((p) => p.endsWith("src/target.ts"))),
		"without prior basis, should emit 'over-declared' finding as today",
	);
	assert.equal(
		compWithoutBasis.findings.some((f) => f.kind === "attribution-gap"),
		false,
		"without prior basis, must not emit attribution-gap finding",
	);

	// Branch 3: evidence complete and no task change => over-declared
	const aRunComplete = {
		cwd: CWD,
		taskId: "T-20260913-001",
		workerRunId: "run-0",
		finalGitRef: "head-1",
		gitStatusHash: "dirty-base",
		changedPaths: ["src/target.ts"],
		dirtyPathHashes: { "src/target.ts": "same-hash" },
		gitAvailable: true,
	};
	const cReportComplete = {
		cwd: CWD,
		taskId: "T-20260913-001",
		workerRunId: "run-1",
		finalGitRef: "head-1",
		gitStatusHash: "dirty-report",
		changedPaths: ["src/target.ts"],
		dirtyPathHashes: { "src/target.ts": "same-hash" },
		gitAvailable: true,
	};
	const compComplete = compareExecutionTruth(aRunComplete, cReportComplete, reportWithDeclaration, {
		scope: { allowedPaths: ["src/target.ts"] },
		priorTruthPaths: [],
	});
	assert.ok(
		compComplete.findings.some((f) => f.kind === "over-declared" && f.paths.some((p) => p.endsWith("src/target.ts"))),
		"evidence complete and no task change must be over-declared as today",
	);
}

// =========================================================================
// (b) decision routing:
// comparison with only attribution-gap findings => blocked + reasonCode 'attribution-gap'
// (assert not evidence-no-progress); mixed gap+over-declared => over-declared path.
// =========================================================================
{
	const store = new TaskStore();
	const taskId = "T-20260913-002";
	store.create({
		taskId,
		objective: "test decision routing",
		cwd: CWD,
	});

	const task = store.require(taskId);
	task.reviewRound = 0;
	task.recoveryAttempts = 0;
	task.recoveryStates = [];

	const mockReport = {
		version: 1,
		taskId,
		status: "completed",
		summary: "test",
		changedFiles: ["src/target.ts"],
		validation: [],
		evidence: {
			cwd: CWD,
			taskId,
			workerRunId: "run-1",
			finalGitRef: "head-1",
			gitStatusHash: "status-1",
			changedPaths: ["src/target.ts"],
			gitAvailable: true,
			generatedAt: new Date().toISOString(),
		},
		risks: [],
		unresolved: [],
	};

	// Case 1: comparison with ONLY attribution-gap findings
	const gapOnlyComparison = {
		verifiable: true,
		fresh: false,
		unexplained: true,
		reasons: ["baseline hash failed: src/target.ts"],
		truthPaths: [],
		truthFindings: [
			{ kind: "attribution-gap", paths: ["src/target.ts"] },
		],
		attributionGapPaths: ["src/target.ts"],
	};

	const decisionGapOnly = decideReview({
		task,
		report: mockReport,
		comparison: gapOnlyComparison,
	});

	assert.equal(decisionGapOnly.action, "blocked");
	assert.equal(decisionGapOnly.nextState, "blocked");
	assert.equal(decisionGapOnly.consumesRound, false);
	assert.equal(decisionGapOnly.failureClass, "evidence");
	assert.equal(decisionGapOnly.reasonCode, "attribution-gap");
	assert.notEqual(decisionGapOnly.reasonCode, "evidence-no-progress");
	assert.notEqual(decisionGapOnly.reasonCode, "evidence-stale");
	assert.match(decisionGapOnly.reason, /Root may unlock only via explicit override with oracle-backed attribution checks/);

	// Case 2: mixed findings (gap + real over-declared)
	const mixedComparison = {
		verifiable: true,
		fresh: false,
		unexplained: true,
		reasons: ["over-reported / unreliable declaration: src/other.ts"],
		truthPaths: [],
		truthFindings: [
			{ kind: "attribution-gap", paths: ["src/target.ts"] },
			{ kind: "over-declared", paths: ["src/other.ts"] },
		],
		extraDeclaredPaths: ["src/other.ts"],
		attributionGapPaths: ["src/target.ts"],
	};

	const decisionMixed = decideReview({
		task,
		report: mockReport,
		comparison: mixedComparison,
	});

	// Mixed should take the existing over-declared (revalidate / stale) path
	assert.equal(decisionMixed.action, "revalidate");
	assert.equal(decisionMixed.reasonCode, "evidence-stale");
}



console.log("nx10-attribution.test.mjs passed!");
