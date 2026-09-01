import assert from "node:assert/strict";
import {
	compactWorkerReport,
	extractWorkerReport,
	validateWorkerReport,
	validateWorkerReportIdentity,
} from "./report.ts";

const CWD = "/repo";

function makeReport(overrides = {}) {
	return {
		version: 1,
		taskId: "T-20260831-100",
		status: "completed",
		summary: "Implemented the parser.",
		changedFiles: ["src/parser.ts"],
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "42 passed" }],
		evidence: {
			cwd: CWD,
			taskId: "T-20260831-100",
			workerRunId: "call-100",
			finalGitRef: "abc1234",
			gitStatusHash: "hash-one",
			changedPaths: ["src/parser.ts"],
			gitAvailable: true,
			generatedAt: "2026-08-31T10:00:00.000Z",
		},
		risks: [],
		unresolved: [],
		...overrides,
	};
}

// --------------------------------------------------------------------------
// WorkerReport schema
// --------------------------------------------------------------------------

assert.deepEqual(validateWorkerReport(makeReport()), []);
assert.ok(validateWorkerReport({ ...makeReport(), version: 2 }).length > 0);
assert.ok(validateWorkerReport("not a report").length > 0);
assert.deepEqual(
	extractWorkerReport(`done:\n\`\`\`json\n${JSON.stringify(makeReport())}\n\`\`\``).report,
	makeReport(),
);
assert.ok(extractWorkerReport("I gave up.").error);

// --------------------------------------------------------------------------
// WorkerReport task identity (§P0-1)
// --------------------------------------------------------------------------

const expected = { taskId: "T-20260831-100", workerRunId: "call-100" };

// correct identity: task, evidence.task, and the run that produced it
assert.deepEqual(validateWorkerReportIdentity(makeReport(), expected), []);

// wrong report taskId
assert.deepEqual(
	validateWorkerReportIdentity(makeReport({ taskId: "T-20260831-999" }), expected),
	["WorkerReport taskId mismatch: expected T-20260831-100, got T-20260831-999"],
);

// wrong evidence.taskId
assert.deepEqual(
	validateWorkerReportIdentity(
		{ ...makeReport(), evidence: { ...makeReport().evidence, taskId: "T-20260831-999" } },
		expected,
	),
	["WorkerReport evidence.taskId mismatch: expected T-20260831-100, got T-20260831-999"],
);

// wrong evidence.workerRunId: the report belongs to another run
assert.deepEqual(
	validateWorkerReportIdentity(
		{ ...makeReport(), evidence: { ...makeReport().evidence, workerRunId: "call-999" } },
		expected,
	),
	["WorkerReport evidence.workerRunId mismatch: expected call-100, got call-999"],
);

// a worker that reports no run id is still accepted; the check is opportunistic
assert.deepEqual(
	validateWorkerReportIdentity(
		{ ...makeReport(), evidence: { ...makeReport().evidence, workerRunId: undefined } },
		expected,
	),
	[],
);
assert.deepEqual(validateWorkerReportIdentity(makeReport(), { taskId: "T-20260831-100" }), []);

// every mismatch is reported, not just the first
assert.equal(
	validateWorkerReportIdentity(
		{
			...makeReport({ taskId: "T-20260831-999" }),
			evidence: { ...makeReport().evidence, taskId: "T-20260831-999", workerRunId: "call-999" },
		},
		expected,
	).length,
	3,
);

// a self-consistent report for the wrong task passes the schema — identity is a
// separate gate, enforced against the delegation before the report is stored
{
	const foreign = {
		...makeReport(),
		taskId: "T-20260831-999",
		evidence: { ...makeReport().evidence, taskId: "T-20260831-999" },
	};
	assert.deepEqual(validateWorkerReport(foreign), []);
	assert.deepEqual(validateWorkerReportIdentity(foreign, expected), [
		"WorkerReport taskId mismatch: expected T-20260831-100, got T-20260831-999",
		"WorkerReport evidence.taskId mismatch: expected T-20260831-100, got T-20260831-999",
	]);
}

// --------------------------------------------------------------------------
// Compaction keeps validation evidence
// --------------------------------------------------------------------------

{
	const { report, compacted } = compactWorkerReport(
		makeReport({
			summary: "x".repeat(40000),
			notes: ["n".repeat(2000)],
			risks: Array.from({ length: 50 }, (_, index) => `risk ${index}`),
		}),
		2000,
	);
	assert.equal(compacted, true);
	assert.equal(report.validation.length, 1);
	assert.equal(report.validation[0].exitCode, 0);
}

console.log("planner-only report: PASS");
