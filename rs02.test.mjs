import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	compareEvidence,
	compareExecutionTruth,
	compareFreshness,
} from "./evidence.ts";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { TaskStore, createTaskSpec } from "./task.ts";
import { decideReview } from "./review.ts";
import { resolveDelegationTarget, stampReportOnlyCorrectionInput } from "./roles.ts";

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

async function runIntegrationFlow(orch, taskId, toolCallId, role, changedFiles = []) {
	const outcome = await orch.beginDelegation({
		toolCallId,
		input: { agent: role === "explorer" ? "explorer" : "worker", task: JSON.stringify(integrationSpec(taskId, role)) },
	}, CWD);
	assert.equal(outcome.task?.taskId, taskId);
	await orch.handleSubagentResult(integrationResult(toolCallId, integrationReport(taskId, toolCallId, changedFiles)));
	return orch.store.require(taskId);
}

const integrationLedger = mkdtempSync(join(process.cwd(), ".planner-only-test-rs02-"));
try {
	// A06: a read-only explorer observes concurrent external dirt without
	// attributing it or creating an execution finding.
	integrationStatus.paths = ["external.txt"];
	const a06 = new PlannerOrchestrator({ ledgerDir: integrationLedger, gitRunner: integrationGitRunner });
	const a06Task = await runIntegrationFlow(a06, "T-20260912-606", "rs02-a06", "explorer");
	assert.deepEqual(a06Task.lastComparison?.undeclaredPaths, []);
	assert.deepEqual(a06.store.openFindings(a06Task.taskId), []);

	// A07: edits arriving after the report are freshness drift. Read-only
	// guidance must not suggest reverting a path the explorer never owned.
	integrationStatus.paths = [];
	const a07 = new PlannerOrchestrator({ ledgerDir: integrationLedger, gitRunner: integrationGitRunner });
	await runIntegrationFlow(a07, "T-20260912-607", "rs02-a07", "explorer");
	integrationStatus.paths = ["src/target.ts"];
	const a07Verdict = await a07.recordRootVerdict(a07.store.require("T-20260912-607"), "pass", "stale check");
	assert.equal(a07Verdict.decision.action, "revalidate");
	assert.doesNotMatch(a07.renderDecisionBlock(a07Verdict.task, a07Verdict.decision), /revert/i);

	// A08: an omitted writable change remains an undeclared finding. Corrupting
	// the correction's origin link must fail closed and preserve that finding.
	integrationStatus.paths = [];
	const a08 = new PlannerOrchestrator({ ledgerDir: integrationLedger, gitRunner: integrationGitRunner });
	const a08Outcome = await a08.beginDelegation({
		toolCallId: "rs02-a08",
		input: { agent: "worker", task: JSON.stringify(integrationSpec("T-20260912-608", "worker")) },
	}, CWD);
	assert.equal(a08Outcome.task?.taskId, "T-20260912-608");
	integrationStatus.paths = ["src/target.ts"];
	await a08.handleSubagentResult(integrationResult("rs02-a08", integrationReport("T-20260912-608", "rs02-a08", [])));
	const a08Task = a08.store.require("T-20260912-608");
	assert.equal(a08.store.openFindings(a08Task.taskId).some((finding) => finding.kind === "undeclared"), true);
	integrationStatus.paths = [];
	const repair = await a08.beginDelegation({
		toolCallId: "rs02-a08-repair",
		input: { agent: "worker", reportOnly: true, task: JSON.stringify(integrationSpec("T-20260912-608")) },
	}, CWD);
	assert.equal(repair.task?.taskId, a08Task.taskId);
	const repairExecution = a08.store.require(a08Task.taskId).executions.at(-1);
	assert.ok(repairExecution);
	repairExecution.previousExecutionId = "missing-origin";
	await a08.handleSubagentResult(integrationResult("rs02-a08-repair", integrationReport("T-20260912-608", "rs02-a08-repair", ["src/target.ts"])));
	const a08AfterRepair = a08.store.require("T-20260912-608");
	assert.match(a08AfterRepair.lastComparison?.missingMaterials ?? "", /no linked prior execution/);
	assert.equal(a08.store.openFindings("T-20260912-608").some((finding) => finding.kind === "undeclared"), true);

	// Deadlock replay: a fresh correction baseline clears prior drift evidence,
	// allowing a verified PASS to complete the task.
	integrationStatus.paths = [];
	const replay = new PlannerOrchestrator({ ledgerDir: integrationLedger, gitRunner: integrationGitRunner });
	await runIntegrationFlow(replay, "T-20260912-609", "rs02-replay-1", "worker");
	integrationStatus.paths = ["src/target.ts"];
	const stale = await replay.recordRootVerdict(replay.store.require("T-20260912-609"), "pass", "drift");
	assert.equal(stale.decision.action, "revalidate");
	integrationStatus.paths = [];
	await runIntegrationFlow(replay, "T-20260912-609", "rs02-replay-2", "worker");
	const clean = await replay.recordRootVerdict(replay.store.require("T-20260912-609"), "pass", "replayed clean baseline");
	assert.equal(clean.task.state, "completed");
} finally {
	rmSync(integrationLedger, { recursive: true, force: true });
}


// RT-02 B05-B09: successor links and non-destructive supersession closure.
{
	const store = new TaskStore();
	const parent = store.create(createTaskSpec({
		taskId: "T-20260912-705",
		objective: "original work",
		cwd: CWD,
	}));
	const successor = store.create(createTaskSpec({
		taskId: "T-20260912-706",
		objective: "repair original work",
		cwd: CWD,
		parentTaskId: parent.taskId,
	}));
	const commit = store.create(createTaskSpec({
		taskId: "T-20260912-707",
		objective: "commit original work",
		cwd: CWD,
		commitOf: parent.taskId,
	}));
	assert.deepEqual(parent.successors, [successor.taskId, commit.taskId], "B05: parent records successor and commit Tasks");
	assert.equal(successor.parentTaskId, parent.taskId, "B07: correction retains parentTaskId");
	assert.equal(commit.spec?.commitOf, parent.taskId, "B05: commitOf declaration is retained");

	store.transition(parent.taskId, "executing");
	store.transition(parent.taskId, "reviewing");
	const workerReport = report({ workerRunId: "b05-report" });
	const supersededComparison = {
		verifiable: true,
		fresh: true,
		reasons: ["superseded by successor"],
		truthPaths: [],
		undeclaredPaths: [],
		extraDeclaredPaths: [],
		overlappingPaths: [],
		unrelatedPaths: [],
		missingPaths: [],
		unexplained: false,
		freshness: { verifiable: true, fresh: true, reasons: [], driftPaths: [], headChanged: false },
		supersession: { kind: "superseded", successorTaskId: successor.taskId },
	};
	const closed = decideReview({ task: parent, report: workerReport, comparison: supersededComparison, review: {
		taskId: parent.taskId,
		verdict: "pass",
		summary: "successor delivered the work",
		findings: [],
		evidenceFresh: true,
	} });
	assert.equal(closed.nextState, "closed-superseded", "B05: unacknowledged successor pass does not block");
	assert.equal(closed.completionKind, "superseded");

	const acknowledged = decideReview({ task: parent, report: workerReport, comparison: supersededComparison, review: {
		taskId: parent.taskId,
		verdict: "pass",
		summary: "successor explicitly acknowledged",
		findings: [],
		evidenceFresh: true,
		acknowledgeDrift: { successorTaskId: successor.taskId },
	} });
	assert.equal(acknowledged.nextState, "completed", "B05: acknowledged successor reaches completed");
	assert.equal(acknowledged.completionKind, "superseded");

	const committed = decideReview({ task: parent, report: workerReport, comparison: {
		...supersededComparison,
		supersession: { kind: "committed", successorTaskId: commit.taskId },
	}, review: {
		taskId: parent.taskId,
		verdict: "pass",
		summary: "commit acknowledged",
		findings: [],
		evidenceFresh: true,
		acknowledgeDrift: { commit: true },
	} });
	assert.equal(committed.nextState, "completed", "B05: committed successor reaches completed");
	assert.equal(committed.completionKind, "committed");

	const recoveryBefore = parent.recoveryAttempts;
	const staleComparison = {
		...supersededComparison,
		fresh: false,
		unexplained: true,
		freshness: { verifiable: true, fresh: false, reasons: ["external edit"], driftPaths: ["/repo/external.txt"], headChanged: false },
		supersession: undefined,
	};
	const rewrite = decideReview({ task: parent, report: workerReport, comparison: staleComparison, review: {
		taskId: parent.taskId,
		verdict: "pass",
		summary: "protocol rewrite",
		findings: [],
		evidenceFresh: false,
	} });
	assert.equal(rewrite.action, "revalidate", "B08: stale pass is rewritten to revalidate");
	assert.equal(parent.recoveryAttempts, recoveryBefore, "B08: deciding a rewrite does not mutate recoveryAttempts");

	const b09Store = new TaskStore();
	const b09Existing = b09Store.create(createTaskSpec({
		taskId: "T-20260912-709",
		objective: "report rebinding",
		cwd: CWD,
	}));
	const reboundInput = { agent: "worker", taskId: b09Existing.taskId, reportOnly: true };
	stampReportOnlyCorrectionInput(reboundInput);
	const rebound = resolveDelegationTarget(reboundInput, (taskId) => b09Store.get(taskId));
	assert.equal(rebound?.task?.taskId, b09Existing.taskId, "B09: report-only taskId-only input rebinds the existing Task");
	const taskCount = b09Store.list().length;
	const pendingInput = { agent: "worker", taskId: "T-pending", reportOnly: true };
	stampReportOnlyCorrectionInput(pendingInput);
	const pending = resolveDelegationTarget(pendingInput, (taskId) => b09Store.get(taskId));
	assert.equal(pending?.task, undefined, "B09: T-pending report-only input has no existing target");
	assert.equal(b09Store.list().length, taskCount, "B09: rejected sentinel does not create a placeholder Task");
}

console.log("rs02 tests passed");
