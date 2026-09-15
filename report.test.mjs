import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compactWorkerReport, isExtractedOk, isToolCallId, renderWorkerReport, validateWorkerReport, validateWorkerReportIdentity, workerReportShapeReminder } from "./report.ts";

const RUN5_ARTIFACTS = join(
	dirname(fileURLToPath(import.meta.url)),
	".scratch/planner-only-cost-control/phase-a-08-run5/artifacts/subagent-artifacts",
);

function readRun5Output(prefix) {
	const name = readdirSync(RUN5_ARTIFACTS).find(
		(file) => file.startsWith(prefix) && file.endsWith("_output.md"),
	);
	assert.ok(name, `run5 artifact ${prefix}-*_output.md must exist`);
	return readFileSync(join(RUN5_ARTIFACTS, name), "utf8");
}

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
			gitStatusHash: "0123456789abcdef",
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

// L-5: identity accepts the Task id or any alias
{
	const aliases = { taskId: "T-20260905-001", aliases: ["T-20260220-001"], workerRunId: "call-100" };
	const echoing = {
		...makeReport(),
		taskId: "T-20260220-001",
		evidence: { ...makeReport().evidence, taskId: "T-20260220-001" },
	};
	assert.deepEqual(validateWorkerReportIdentity(echoing, aliases), []);
	const unrelated = {
		...makeReport(),
		taskId: "T-20260831-999",
		evidence: { ...makeReport().evidence, taskId: "T-20260831-999" },
	};
	assert.deepEqual(validateWorkerReportIdentity(unrelated, aliases), [
		"WorkerReport taskId mismatch: expected T-20260905-001, got T-20260831-999",
		"WorkerReport evidence.taskId mismatch: expected T-20260905-001, got T-20260831-999",
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

// gitStatusHash / finalGitRef are optional declaration fields, not required
{
	const report = makeReport();
	delete report.evidence.gitStatusHash;
	delete report.evidence.finalGitRef;
	assert.deepEqual(validateWorkerReport(report), []);
	const rendered = renderWorkerReport(report);
	assert.match(rendered, /Worker declaration/);
	assert.match(rendered, /head: \(none\)/);
	assert.match(rendered, /statusHash: \(none\)/);
}

function validShape(overrides = {}) {
	return {
		version: 1,
		taskId: "T-20260831-100",
		status: "completed",
		summary: "Implemented the parser.",
		changedFiles: ["src/parser.ts"],
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "42 passed" }],
		evidence: { taskId: "T-20260831-100" },
		risks: [],
		unresolved: [],
		...overrides,
	};
}



























{
	const reminder = workerReportShapeReminder("T-20260831-100");
	const parsed = JSON.parse(reminder);
	assert.deepEqual(validateWorkerReport(parsed), []);
	assert.equal(parsed.status, "completed");
	assert.equal(typeof parsed.summary, "string");
	assert.notEqual(parsed.summary, "...");
	const item = parsed.validation[0];
	assert.equal(typeof item, "object");
	assert.equal(item.type, "test");
	assert.equal(item.status, "not-run");
	assert.equal("exitCode" in item, false);
	assert.equal(typeof item.summary, "string");
	assert.ok(item.summary.length > 0);
	assert.equal(typeof item.command, "string");
	assert.equal("exitCode" in item, false);
}










// --------------------------------------------------------------------------
// ExtractedReport discriminant (behavior-preserving type tightening)
// --------------------------------------------------------------------------






console.log("planner-only report: PASS");
