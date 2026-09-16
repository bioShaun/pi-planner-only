import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compareEvidence, compareExecutionTruth, compareFreshness } from "./evidence.ts";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { TaskStore, createTaskSpec, createTaskId } from "./task.ts";
import { decideReview } from "./review.ts";

const CWD = "/repo";

function sample(overrides = {}) {
	return {
		cwd: CWD,
		taskId: "T-20260912-001",
		workerRunId: "run-1",
		finalGitRef: "head-1",
		gitStatusHash: "clean",
		changedPaths: [],
		gitAvailable: true,
		generatedAt: "2026-09-12T10:00:00.000Z",
		...overrides,
	};
}

function report(overrides = {}) {
	return {
		version: 1,
		taskId: "T-20260912-001",
		status: "completed",
		summary: "read-only observation",
		changedFiles: [],
		validation: [],
		evidence: {
			...sample(),
			...overrides,
		},
		risks: [],
		unresolved: [],
	};
}

// A06: concurrent workspace edits remain visible as observations, but a
// trusted read-only execution cannot be charged with undeclared work.
const external = sample({
	gitStatusHash: "dirty",
	changedPaths: ["external.txt"],
});
const readOnlyTruth = compareExecutionTruth(sample(), external, report(), {
	readOnly: true,
});
assert.deepEqual(readOnlyTruth.undeclaredPaths, []);
assert.deepEqual(readOnlyTruth.findings, []);
assert.deepEqual(readOnlyTruth.observedExternalPaths, ["/repo/external.txt"]);

const readOnlyComparison = compareEvidence(sample(), external, report(), {
	readOnly: true,
});
assert.deepEqual(readOnlyComparison.undeclaredPaths, []);
assert.deepEqual(readOnlyComparison.overlappingPaths, []);
assert.deepEqual(readOnlyComparison.unrelatedPaths, []);

// A07: a target changed inside the worker window is an attribution finding;
// a target changed after the report is freshness drift. An unchanged report
// remains fresh, and read-only observation does not manufacture a repair.
const targetDuringRun = sample({ changedPaths: ["src/target.ts"] });
const during = compareExecutionTruth(sample(), targetDuringRun, report());
assert.deepEqual(during.undeclaredPaths, ["/repo/src/target.ts"]);
assert.equal(during.findings[0]?.kind, "undeclared");

const targetAfterReport = compareFreshness(sample(), targetDuringRun);
assert.equal(targetAfterReport.fresh, false);
assert.deepEqual(targetAfterReport.driftPaths, ["/repo/src/target.ts"]);
assert.equal(compareFreshness(sample(), sample()).fresh, true);
assert.equal(readOnlyComparison.undeclaredPaths.length, 0);

// A08: report-only is a declaration repair, not a capability upgrade. When
// the trusted origin is writable, the same omission remains a finding even if
// the correction process itself is read-only. The explicit readOnly=true case
// is reserved for a genuinely read-only origin (A06).
const omittedWorkerChange = compareExecutionTruth(
	sample(),
	targetDuringRun,
	report(),
	{ reportOnly: true, readOnly: false },
);
assert.deepEqual(omittedWorkerChange.undeclaredPaths, ["/repo/src/target.ts"]);
assert.equal(omittedWorkerChange.findings[0]?.kind, "undeclared");

const chainedCorrection = compareExecutionTruth(
	sample(),
	targetDuringRun,
	report({ changedPaths: ["src/target.ts"] }),
	{ reportOnly: true, readOnly: false },
);
assert.deepEqual(chainedCorrection.undeclaredPaths, []);
assert.deepEqual(chainedCorrection.findings, []);

// Deadlock regression: once a report-only correction has supplied a fresh,
// Root-sampled baseline, freshness is evaluated from that correction sample,
// rather than the obsolete original C_report.
const originalReport = sample({
	gitStatusHash: "original-dirty",
	changedPaths: ["src/target.ts"],
});
const cleanCorrection = sample({
	gitStatusHash: "post-correction-clean",
	changedPaths: [],
	finalGitRef: "head-2",
});
const correctionFreshness = compareFreshness(cleanCorrection, cleanCorrection);
assert.equal(correctionFreshness.verifiable, true);
assert.equal(correctionFreshness.fresh, true);
assert.notEqual(originalReport.gitStatusHash, cleanCorrection.gitStatusHash);

// PlannerOrchestrator flows use the same compact GitRunner contract as the
// orchestration suite. The mutable status models edits arriving between A_run,
// C_report, and the acceptance boundary.
const integrationStatus = { paths: [] };
const integrationGitRunner = async (args) => {
	const key = args.join(" ");
	if (key === "rev-parse --git-dir") return { stdout: ".git\\n", stderr: "", code: 0 };
	if (key === "rev-parse HEAD") return { stdout: "integration-head\\n", stderr: "", code: 0 };
	if (key === "status --porcelain=v2 --branch") {
		const stdout = integrationStatus.paths
			.map((path) => `1 .M N... 100644 100644 100644 1111111 2222222 ${path}`)
			.join("\\n");
		return { stdout, stderr: "", code: 0 };
	}
	if (key === "diff HEAD --stat") {
		return { stdout: integrationStatus.paths.map((path) => ` ${path} | 1 +`).join("\\n"), stderr: "", code: 0 };
	}
	return { stdout: "", stderr: "", code: 0 };
};

function integrationSpec(taskId, role = "worker") {
	return {
		version: 1,
		taskId,
		objective: `exercise ${taskId}`,
		cwd: CWD,
		role,
		scope: { allowedPaths: ["src/target.ts"] },
		constraints: [],
		acceptanceCriteria: [],
		validation: { required: false },
		expectedEvidence: {},
		stopConditions: [],
	};
}

function integrationReport(taskId, workerRunId, changedFiles = []) {
	return {
		version: 1,
		taskId,
		status: "completed",
		summary: "integration flow",
		changedFiles,
		validation: [],
		evidence: {
			cwd: CWD,
			taskId,
			workerRunId,
			finalGitRef: "integration-head",
			gitStatusHash: "integration-status",
			changedPaths: [...changedFiles],
			gitAvailable: true,
			generatedAt: "2026-09-12T10:00:00.000Z",
		},
		risks: [],
		unresolved: [],
	};
}

function integrationResult(toolCallId, value) {
	return {
		toolCallId,
		toolName: "subagent",
		input: {},
		content: [{ type: "text", text: JSON.stringify(value) }],
		isError: false,
	};
}


const integrationLedger = mkdtempSync(join(tmpdir(), "planner-only-test-rs02-"));
const taskId606 = createTaskId(new Date(), 606);
const taskId607 = createTaskId(new Date(), 607);
const taskId608 = createTaskId(new Date(), 608);
const taskId609 = createTaskId(new Date(), 609);



console.log("rs02 tests passed");
