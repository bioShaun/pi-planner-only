import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
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

const root = mkdtempSync(join(process.cwd(), ".planner-only-test-rs02-concurrency-"));
const workspaceA = join(root, "workspace-a");
const workspaceB = join(root, "workspace-b");
const workspaceC = join(root, "workspace-c");
const workspaceD = join(root, "workspace-d");
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });

function spec(taskId, cwd, role = "worker") {
	return {
		version: 1,
		taskId,
		objective: `exercise ${taskId}`,
		cwd,
		role,
		scope: { allowedPaths: ["src/file.ts"] },
		constraints: [],
		acceptanceCriteria: [],
		validation: { required: false },
		expectedEvidence: {},
		stopConditions: [],
	};
}

async function enter(orchestrator, id, taskId, cwd, role = "worker") {
	return orchestrator.beginDelegation({
		toolCallId: id,
		input: { agent: role, task: JSON.stringify(spec(taskId, cwd, role)) },
	}, cwd);
}

function result(id, taskId, cwd) {
	return {
		toolCallId: id,
		toolName: "subagent",
		input: {},
		content: [{ type: "text", text: JSON.stringify({
			version: 1,
			taskId,
			status: "completed",
			summary: "concurrency adapter test",
			changedFiles: [],
			validation: [],
			evidence: {
				cwd,
				taskId,
				workerRunId: id,
				finalGitRef: "head-a",
				gitStatusHash: "clean-a",
				changedPaths: [],
				gitAvailable: true,
				generatedAt: "2026-09-12T10:00:00.000Z",
			},
			risks: [],
			unresolved: [],
		}) }],
		isError: false,
	};
}

try {
	// A10 uses PlannerOrchestrator's delegation entry, which is the adapter seam
	// that performs admission before creating or mutating a Task.
	const orchestrator = new PlannerOrchestrator({
		ledgerDir: root,
		gitRunner,
		concurrency: new ConcurrencyController(),
	});
	const first = await enter(orchestrator, "writer-a", "T-20260912-201", workspaceA);
	assert.ok(first.task, "first writer admitted through delegation entry");

	const sameWorkspaceWriter = await enter(orchestrator, "writer-a-alias", "T-20260912-202", workspaceA);
	assert.equal(sameWorkspaceWriter.conflict?.conflict, true, "same-worktree writer is rejected");

	const structuredRetry = await enter(orchestrator, "writer-a-retry", "T-20260912-201", workspaceA);
	assert.equal(structuredRetry.conflict?.conflict, true, "same-task structured retry cannot bypass workspace conflict");

	const second = await enter(orchestrator, "writer-b", "T-20260912-203", workspaceB);
	const third = await enter(orchestrator, "writer-c", "T-20260912-204", workspaceC);
	assert.ok(second.task);
	assert.ok(third.task);
	const saturated = await enter(orchestrator, "writer-d", "T-20260912-205", workspaceD);
	assert.equal(saturated.block?.code, "CONCURRENCY_LIMIT_REACHED", "fourth independent task is rejected at default capacity");

	await orchestrator.handleSubagentResult(result("writer-b", "T-20260912-203", workspaceB));
	const afterRelease = await enter(orchestrator, "writer-d-after-release", "T-20260912-206", workspaceD);
	assert.ok(afterRelease.task, "released slot admits a subsequent independent task");

	const readers = new PlannerOrchestrator({
		ledgerDir: join(root, "readers"),
		gitRunner,
		concurrency: new ConcurrencyController(),
	});
	const readA = await enter(readers, "reader-a", "T-20260912-207", workspaceA, "explorer");
	const readB = await enter(readers, "reader-b", "T-20260912-208", workspaceB, "explorer");
	const readC = await enter(readers, "reader-c", "T-20260912-209", workspaceC, "explorer");
	assert.ok(readA.task);
	assert.ok(readB.task);
	assert.ok(readC.task);
	const readD = await enter(readers, "reader-d", "T-20260912-210", workspaceD, "explorer");
	assert.equal(readD.block?.code, "CONCURRENCY_LIMIT_REACHED", "independent read-only executions use the same default capacity");
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log("rs02 concurrency tests passed");
