import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

// =========================================================================
// (c) unlock:
// blocked attribution-gap task + oracle-passed validator execution at current
// revision + fresh workspace + verdict findings documenting reason/snapshot/oracle/paths
// => recordRootVerdict pass completes the task;
// WITHOUT the oracle execution => stays blocked;
// with drifted workspace => stays blocked.
// =========================================================================
{
	const tempDir = mkdtempSync(join(process.cwd(), ".planner-only-test-nx10-"));
	try {
		mkdirSync(join(tempDir, "src"), { recursive: true });
		writeFileSync(join(tempDir, "src/target.ts"), "initial content");

		const gitState = {
			head: "head-1",
			statusPaths: ["src/target.ts"],
			hashFail: true,
		};

		const mockGitRunner = async (args) => {
			const key = args.join(" ");
			if (key === "rev-parse --git-dir") return { stdout: ".git\n", stderr: "", code: 0 };
			if (key === "rev-parse HEAD") return { stdout: `${gitState.head}\n`, stderr: "", code: 0 };
			if (key === "status --porcelain=v2 --branch") {
				const stdout = gitState.statusPaths
					.map((path) => `1 .M N... 100644 100644 100644 1111111 2222222 ${path}`)
					.join("\n");
				return { stdout, stderr: "", code: 0 };
			}
			if (key === "diff HEAD --stat") {
				return { stdout: gitState.statusPaths.map((p) => ` ${p} | 1 +`).join("\n"), stderr: "", code: 0 };
			}
			if (args[0] === "hash-object") {
				if (gitState.hashFail) {
					return { stdout: "", stderr: "hash-object failed", code: 1 };
				}
				return { stdout: "hash1234567890abcdef\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		};

		const orch = new PlannerOrchestrator({ ledgerDir: tempDir, gitRunner: mockGitRunner });
		const taskId = "T-20260913-003";

		// Begin worker delegation
		const workerOutcome = await orch.beginDelegation({
			toolCallId: "call-worker-1",
			input: {
				agent: "worker",
				task: JSON.stringify({
					version: 1,
					taskId,
					objective: "test attribution-gap unlock",
					cwd: tempDir,
					role: "worker",
					scope: { allowedPaths: ["src/target.ts"] },
					constraints: [],
					acceptanceCriteria: [],
					validation: { required: true, commands: ["npm test"] },
					expectedEvidence: {},
					stopConditions: [],
				}),
			},
		}, tempDir);

		// Worker reports with changed file src/target.ts
		const workerReport = {
			version: 1,
			taskId,
			status: "completed",
			summary: "worker completed change",
			changedFiles: ["src/target.ts"],
			validation: [
				{ type: "test", status: "passed", summary: "tests passed", exitCode: 0, command: "npm test" },
			],
			evidence: {
				cwd: tempDir,
				taskId,
				workerRunId: "call-worker-1",
				finalGitRef: "head-1",
				gitStatusHash: "status-1",
				changedPaths: ["src/target.ts"],
				gitAvailable: true,
				generatedAt: new Date().toISOString(),
			},
			risks: [],
			unresolved: [],
		};

		await orch.handleSubagentResult({
			toolCallId: "call-worker-1",
			toolName: "subagent",
			input: {},
			content: [{ type: "text", text: JSON.stringify(workerReport) }],
			isError: false,
		});

		let task = orch.store.require(taskId);
		assert.equal(task.state, "blocked", "Task should be blocked due to attribution gap");
		assert.equal(task.blockedReasonCode, "attribution-gap");

		// Subcase 1: WITHOUT the oracle execution => stays blocked
		const refusedWithoutOracle = await orch.recordRootVerdict(
			task,
			"pass",
			"Root override: attribution-gap on revision 1 hash 1111111 validator pass src/target.ts",
			{ source: "root" },
		);
		assert.equal(refusedWithoutOracle.task.state, "blocked", "Without oracle execution, task must stay blocked");

		// Add oracle-passed validator report
		const validatorReport = {
			version: 1,
			taskId,
			status: "completed",
			summary: "validator passed",
			changedFiles: [],
			validation: [
				{ type: "test", status: "passed", summary: "oracle check passed", exitCode: 0, command: "npm test" },
			],
			evidence: {
				cwd: tempDir,
				taskId,
				workerRunId: "call-val-1",
				finalGitRef: "head-1",
				gitStatusHash: "status-1",
				changedPaths: [],
				gitAvailable: true,
				generatedAt: new Date().toISOString(),
			},
			risks: [],
			unresolved: [],
		};
		orch.store.recordValidatorReport(taskId, validatorReport);

		// Subcase 2: with drifted workspace => stays blocked
		gitState.head = "head-drifted";
		const refusedWithDrift = await orch.recordRootVerdict(
			orch.store.require(taskId),
			"pass",
			"Root override: attribution-gap on revision 1 status 1111111 oracle passed src/target.ts",
			{ source: "root" },
		);
		assert.equal(refusedWithDrift.task.state, "blocked", "With drifted workspace, task must stay blocked");

		// Restore fresh workspace
		gitState.head = "head-1";

		// Subcase 3: the recorded gap names NO paths => the override cannot
		// document the affected paths, so the unlock must fail closed. Without
		// the non-empty requirement this case accepted vacuously.
		const recordedComparison = orch.store.require(taskId).lastComparison;
		const recordedGapPaths = recordedComparison.attributionGapPaths;
		assert.ok(
			recordedGapPaths && recordedGapPaths.length > 0,
			"precondition: the blocked revision records the affected gap paths",
		);
		orch.store.setLastComparison(taskId, { ...recordedComparison, attributionGapPaths: [] });
		const refusedWithoutPaths = await orch.recordRootVerdict(
			orch.store.require(taskId),
			"pass",
			"Root override: attribution-gap on report revision 1 status hash 1111111, oracle passed",
			{ source: "root" },
		);
		assert.equal(
			refusedWithoutPaths.task.state,
			"blocked",
			"An attribution-gap unlock that names no affected path must stay blocked",
		);
		orch.store.setLastComparison(taskId, {
			...orch.store.require(taskId).lastComparison,
			attributionGapPaths: recordedGapPaths,
		});

		// Subcase 4: fresh workspace + oracle-passed validator + explicit override findings
		const passedOutcome = await orch.recordRootVerdict(
			orch.store.require(taskId),
			"pass",
			"Root override for attribution-gap on report revision 1 status hash 1111111: oracle passed for src/target.ts",
			{
				source: "root",
				findings: [
					{
						severity: "info",
						category: "evidence",
						summary: "attribution-gap override on revision 1 hash 1111111 oracle pass src/target.ts",
					},
				],
			},
		);

		assert.equal(passedOutcome.decision.action, "accept", "Root override should accept");
		assert.equal(passedOutcome.task.state, "completed", "Task should transition to completed");
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

// =========================================================================
// (d) scope classification inside the recorded comparison:
// a task scoped to "sub/" whose report leaves sub/other.txt undeclared must
// record that path as overlapping (under-report), not unrelated (independent
// out-of-scope finding). An exact set of resolved scope paths could never
// match it, because path.resolve drops the trailing slash that carries the
// directory-vs-file meaning.
// =========================================================================
{
	const tempDir = mkdtempSync(join(process.cwd(), ".planner-only-test-nx10-scope-"));
	try {
		mkdirSync(join(tempDir, "sub"), { recursive: true });
		writeFileSync(join(tempDir, "sub/declared.txt"), "declared");
		writeFileSync(join(tempDir, "sub/other.txt"), "other");

		// Clean at delegation start (A), dirty at result handling (C): the A->C
		// delta is what makes sub/other.txt an undeclared change.
		const gitState = { head: "head-scope", statusPaths: [] };

		const mockGitRunner = async (args) => {
			const key = args.join(" ");
			if (key === "rev-parse --git-dir") return { stdout: ".git\n", stderr: "", code: 0 };
			if (key === "rev-parse HEAD") return { stdout: `${gitState.head}\n`, stderr: "", code: 0 };
			if (key === "status --porcelain=v2 --branch") {
				const stdout = gitState.statusPaths
					.map((path) => `1 .M N... 100644 100644 100644 1111111 2222222 ${path}`)
					.join("\n");
				return { stdout, stderr: "", code: 0 };
			}
			if (key === "diff HEAD --stat") {
				return { stdout: gitState.statusPaths.map((p) => ` ${p} | 1 +`).join("\n"), stderr: "", code: 0 };
			}
			if (args[0] === "hash-object") {
				return { stdout: "hash1234567890abcdef\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		};

		const orch = new PlannerOrchestrator({ ledgerDir: tempDir, gitRunner: mockGitRunner });
		const taskId = "T-20260913-004";

		await orch.beginDelegation({
			toolCallId: "call-worker-scope",
			input: {
				agent: "worker",
				task: JSON.stringify({
					version: 1,
					taskId,
					objective: "test scope classification in the recorded comparison",
					cwd: tempDir,
					role: "worker",
					scope: { allowedPaths: ["sub/"] },
					constraints: [],
					acceptanceCriteria: [],
					validation: { required: true, commands: ["npm test"] },
					expectedEvidence: {},
					stopConditions: [],
				}),
			},
		}, tempDir);

		gitState.statusPaths = ["sub/declared.txt", "sub/other.txt"];

		await orch.handleSubagentResult({
			toolCallId: "call-worker-scope",
			toolName: "subagent",
			input: {},
			content: [
				{
					type: "text",
					text: JSON.stringify({
						version: 1,
						taskId,
						status: "completed",
						summary: "declared one of the two dirty files",
						changedFiles: ["sub/declared.txt"],
						validation: [
							{ type: "test", status: "passed", summary: "tests passed", exitCode: 0, command: "npm test" },
						],
						evidence: {
							cwd: tempDir,
							taskId,
							workerRunId: "call-worker-scope",
							finalGitRef: "head-scope",
							gitStatusHash: "status-scope",
							changedPaths: ["sub/declared.txt"],
							gitAvailable: true,
							generatedAt: new Date().toISOString(),
						},
						risks: [],
						unresolved: [],
					}),
				},
			],
			isError: false,
		});

		const comparison = orch.store.require(taskId).lastComparison;
		const other = join(tempDir, "sub/other.txt");
		assert.ok(comparison, "the ingested report records a comparison");
		assert.ok(
			comparison.overlappingPaths.includes(other),
			`in-scope undeclared path must be overlapping, got ${JSON.stringify(comparison.overlappingPaths)}`,
		);
		assert.deepEqual(comparison.unrelatedPaths, [], "a path inside a scoped directory is never unrelated");
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

console.log("nx10-attribution.test.mjs passed!");
