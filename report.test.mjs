import assert from "node:assert/strict";
import {
	compactWorkerReport,
	extractWorkerReport,
	normalizeWorkerReport,
	renderWorkerReport,
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

function assertRepaired(raw, expectedPatch, notePattern, context) {
	const { report, repairs } = normalizeWorkerReport(raw, context);
	assert.equal(validateWorkerReport(report).length, 0, `still invalid: ${validateWorkerReport(report).join("; ")}`);
	for (const [key, value] of Object.entries(expectedPatch)) {
		assert.deepEqual(report[key], value, `repaired ${key}`);
	}
	assert.ok(repairs.length > 0, "expected a repairs note");
	assert.ok(repairs.some((note) => notePattern.test(note)), `repairs ${JSON.stringify(repairs)} did not match ${notePattern}`);
}

// L-1: normalizeWorkerReport version row — 1 / "1" / 1.0 / "1.0" / missing
{
	const fromString = normalizeWorkerReport(validShape({ version: "1" }));
	assert.equal(fromString.report.version, 1);
	assert.ok(fromString.repairs.includes('version "1" → 1'));

	const fromOnePointZero = normalizeWorkerReport(validShape({ version: "1.0" }));
	assert.equal(fromOnePointZero.report.version, 1);
	assert.ok(fromOnePointZero.repairs.includes('version "1.0" → 1'));

	const numbered = validShape();
	delete numbered.version;
	const fromMissing = normalizeWorkerReport(numbered);
	assert.equal(fromMissing.report.version, 1);
	assert.ok(fromMissing.repairs.some((note) => /^version missing → 1$/.test(note)));

	const already = normalizeWorkerReport(validShape({ version: 1 }));
	assert.equal(already.report.version, 1);
	assert.equal(already.repairs.some((note) => note.startsWith("version ")), false);

	const fromFloat = normalizeWorkerReport(validShape({ version: 1.0 }));
	assert.equal(fromFloat.report.version, 1);
}

// L-1: normalizeWorkerReport taskId copied from evidence.taskId or expectedTaskId
{
	const fromEvidence = normalizeWorkerReport({
		...validShape({ taskId: "" }),
		evidence: { taskId: "T-20260831-100" },
	}, { expectedTaskId: "T-EXPECTED" });
	assert.equal(fromEvidence.report.taskId, "T-20260831-100");
	assert.ok(fromEvidence.repairs.some((note) => /taskId/.test(note)));

	const missing = validShape();
	delete missing.taskId;
	delete missing.evidence.taskId;
	const fromExpected = normalizeWorkerReport(missing, { expectedTaskId: "T-EXPECTED" });
	assert.equal(fromExpected.report.taskId, "T-EXPECTED");
	assert.ok(fromExpected.repairs.some((note) => /taskId/.test(note)));
}

// L-1: normalizeWorkerReport status done/success/succeeded/complete/ok → completed
{
	for (const status of ["done", "success", "succeeded", "complete", "ok", " DONE "]) {
		const { report, repairs } = normalizeWorkerReport(validShape({ status }));
		assert.equal(report.status, "completed", status);
		assert.ok(repairs.some((note) => /status/.test(note) && /completed/.test(note)), status);
	}
}

// L-1: normalizeWorkerReport status in_progress/in-progress/incomplete/partially_completed → partial
{
	for (const status of ["in_progress", "in-progress", "incomplete", "partially_completed"]) {
		const { report, repairs } = normalizeWorkerReport(validShape({ status }));
		assert.equal(report.status, "partial", status);
		assert.ok(repairs.some((note) => /status/.test(note) && /partial/.test(note)), status);
	}
}

// L-1: normalizeWorkerReport status error/errored → failed
{
	for (const status of ["error", "errored"]) {
		const { report, repairs } = normalizeWorkerReport(validShape({ status }));
		assert.equal(report.status, "failed", status);
		assert.ok(repairs.some((note) => /status/.test(note) && /failed/.test(note)), status);
	}
}

// L-1: normalizeWorkerReport summary missing → ""
{
	const raw = validShape();
	delete raw.summary;
	assertRepaired(raw, { summary: "" }, /summary/);
}

// L-1: normalizeWorkerReport changedFiles/risks/unresolved/notes single string wrapped in array
{
	const { report, repairs } = normalizeWorkerReport(validShape({
		changedFiles: "src/parser.ts",
		risks: "scope risk",
		unresolved: "docs",
		notes: "n1",
	}));
	assert.deepEqual(report.changedFiles, ["src/parser.ts"]);
	assert.deepEqual(report.risks, ["scope risk"]);
	assert.deepEqual(report.unresolved, ["docs"]);
	assert.deepEqual(report.notes, ["n1"]);
	assert.ok(repairs.some((note) => /changedFiles/.test(note)));
	assert.ok(repairs.some((note) => /risks/.test(note)));
	assert.ok(repairs.some((note) => /unresolved/.test(note)));
	assert.ok(repairs.some((note) => /notes/.test(note)));
}

// L-1: normalizeWorkerReport array of objects mapped via path/file/filePath/name/text/summary/description/message
{
	const { report, repairs } = normalizeWorkerReport(validShape({
		changedFiles: [{ path: "src/parser.ts", change: "modified" }, { file: "src/b.ts" }],
		risks: [{ message: "leak" }],
		unresolved: [{ description: "later" }],
		notes: [{ text: "note" }],
	}));
	assert.deepEqual(report.changedFiles, ["src/parser.ts", "src/b.ts"]);
	assert.deepEqual(report.risks, ["leak"]);
	assert.deepEqual(report.unresolved, ["later"]);
	assert.deepEqual(report.notes, ["note"]);
	assert.ok(repairs.some((note) => /changedFiles/.test(note)));
}

// L-1: normalizeWorkerReport missing changedFiles/risks/unresolved → []; notes stays absent
{
	const raw = validShape();
	delete raw.changedFiles;
	delete raw.risks;
	delete raw.unresolved;
	delete raw.notes;
	const { report, repairs } = normalizeWorkerReport(raw);
	assert.deepEqual(report.changedFiles, []);
	assert.deepEqual(report.risks, []);
	assert.deepEqual(report.unresolved, []);
	assert.equal("notes" in report, false);
	assert.ok(repairs.some((note) => /changedFiles/.test(note)));
	assert.equal(repairs.some((note) => /notes/.test(note)), false);
}

// L-1: normalizeWorkerReport unresolvedItems/unresolved_items/changed_files/changedPaths renamed to canonical keys
{
	const raw = validShape();
	delete raw.unresolved;
	delete raw.changedFiles;
	raw.unresolvedItems = ["item"];
	raw.changed_files = ["src/a.ts"];
	const { report, repairs } = normalizeWorkerReport(raw);
	assert.deepEqual(report.unresolved, ["item"]);
	assert.deepEqual(report.changedFiles, ["src/a.ts"]);
	assert.ok(repairs.some((note) => /unresolvedItems/.test(note) && /unresolved/.test(note)));
	assert.ok(repairs.some((note) => /changed_files/.test(note) && /changedFiles/.test(note)));

	const snake = validShape();
	delete snake.unresolved;
	delete snake.changedFiles;
	snake.unresolved_items = ["u"];
	snake.changedPaths = ["p.ts"];
	const renamed = normalizeWorkerReport(snake);
	assert.deepEqual(renamed.report.unresolved, ["u"]);
	assert.deepEqual(renamed.report.changedFiles, ["p.ts"]);
}

// L-1: normalizeWorkerReport validation missing or null → []
{
	const missing = validShape();
	delete missing.validation;
	assertRepaired(missing, { validation: [] }, /validation/);
	assertRepaired(validShape({ validation: null }), { validation: [] }, /validation/);
}

// L-1: normalizeWorkerReport validation single object wrapped in array
{
	const { report, repairs } = normalizeWorkerReport(validShape({
		validation: { command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" },
	}));
	assert.equal(Array.isArray(report.validation), true);
	assert.equal(report.validation.length, 1);
	assert.equal(report.validation[0].type, "test");
	assert.ok(repairs.some((note) => /validation/.test(note)));
}

// L-1: normalizeWorkerReport validation[].type free text mapped by first-match substring
{
	const cases = [
		["npm test", "test"],
		["jest specs", "test"],
		["tsc --noEmit", "typecheck"],
		["types", "typecheck"],
		["eslint .", "lint"],
		["webpack build", "build"],
		["manual", "manual"],
		["code review", "manual"],
		["inspect", "manual"],
		["mystery", "other"],
	];
	for (const [type, expected] of cases) {
		const { report, repairs } = normalizeWorkerReport(validShape({
			validation: [{ command: "x", type, status: "passed", exitCode: 0, summary: "ok" }],
		}));
		assert.equal(report.validation[0].type, expected, type);
		if (type !== expected) {
			assert.ok(repairs.some((note) => /type/.test(note)), type);
		}
	}
}

// L-1: normalizeWorkerReport validation[].status token map
{
	const cases = [
		["pass", "passed"],
		["ok", "passed"],
		["success", "passed"],
		["green", "passed"],
		["true", "passed"],
		["fail", "failed"],
		["error", "failed"],
		["red", "failed"],
		["false", "failed"],
		["skipped", "not-run"],
		["skip", "not-run"],
		["not_run", "not-run"],
		["not run", "not-run"],
		["none", "not-run"],
		["n/a", "not-run"],
	];
	for (const [status, expected] of cases) {
		const { report, repairs } = normalizeWorkerReport(validShape({
			validation: [{ command: "x", type: "test", status, exitCode: 0, summary: "ok" }],
		}));
		assert.equal(report.validation[0].status, expected, status);
		assert.ok(repairs.some((note) => /status/.test(note)), status);
	}
}

// L-1: normalizeWorkerReport validation[].status missing inferred from exitCode
{
	const passed = normalizeWorkerReport(validShape({
		validation: [{ command: "x", type: "test", exitCode: 0, summary: "ok" }],
	}));
	assert.equal(passed.report.validation[0].status, "passed");
	assert.ok(passed.repairs.some((note) => /status/.test(note)));

	const failed = normalizeWorkerReport(validShape({
		validation: [{ command: "x", type: "test", exitCode: 1, summary: "ok" }],
	}));
	assert.equal(failed.report.validation[0].status, "failed");

	const notRun = normalizeWorkerReport(validShape({
		validation: [{ command: "x", type: "test", summary: "ok" }],
	}));
	assert.equal(notRun.report.validation[0].status, "not-run");
}

// L-1: normalizeWorkerReport validation[].summary missing → command, else raw type, else "(no summary)"
{
	const fromCommand = normalizeWorkerReport(validShape({
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0 }],
	}));
	assert.equal(fromCommand.report.validation[0].summary, "npm test");
	assert.ok(fromCommand.repairs.some((note) => /summary/.test(note)));

	const fromType = normalizeWorkerReport(validShape({
		validation: [{ type: "npm test", status: "passed", exitCode: 0 }],
	}));
	assert.equal(fromType.report.validation[0].summary, "npm test");

	const fallback = normalizeWorkerReport(validShape({
		validation: [{ status: "passed", exitCode: 0 }],
	}));
	assert.equal(fallback.report.validation[0].summary, "(no summary)");
}

// L-1: normalizeWorkerReport validation[].exitCode numeric string parsed to integer
{
	const { report, repairs } = normalizeWorkerReport(validShape({
		validation: [{ command: "x", type: "test", status: "passed", exitCode: "0", summary: "ok" }],
	}));
	assert.equal(report.validation[0].exitCode, 0);
	assert.equal(typeof report.validation[0].exitCode, "number");
	assert.ok(repairs.some((note) => /exitCode/.test(note)));
}

// L-1: normalizeWorkerReport evidence missing → { taskId }
{
	const raw = validShape();
	delete raw.evidence;
	const { report, repairs } = normalizeWorkerReport(raw);
	assert.deepEqual(report.evidence, { taskId: "T-20260831-100" });
	assert.ok(repairs.some((note) => /evidence/.test(note)));
}

// L-1: normalizeWorkerReport evidence.taskId missing copied from taskId
{
	const { report, repairs } = normalizeWorkerReport(validShape({
		evidence: { cwd: "/repo" },
	}));
	assert.equal(report.evidence.taskId, "T-20260831-100");
	assert.ok(repairs.some((note) => /evidence\.taskId/.test(note)));
}

// L-1: evidence.taskId present and !== taskId is not repaired
{
	const { report, repairs } = normalizeWorkerReport(validShape({
		taskId: "T-A",
		evidence: { taskId: "T-B" },
	}));
	assert.equal(report.taskId, "T-A");
	assert.equal(report.evidence.taskId, "T-B");
	assert.equal(repairs.some((note) => /evidence\.taskId/.test(note) && /T-B/.test(note)), false);
	assert.ok(validateWorkerReport(report).some((error) => /evidence\.taskId must match/.test(error)));
}

// L-1: three not-repaired cases keep existing validateWorkerReport messages
{
	const noTaskId = validShape();
	delete noTaskId.taskId;
	delete noTaskId.evidence.taskId;
	const normalisedMissingId = normalizeWorkerReport(noTaskId);
	assert.ok(validateWorkerReport(normalisedMissingId.report).includes("taskId must be a non-empty string"));

	const unknownStatus = normalizeWorkerReport(validShape({ status: "maybe" }));
	assert.ok(validateWorkerReport(unknownStatus.report).includes("status must be one of completed, partial, blocked, failed"));

	const badEntry = normalizeWorkerReport(validShape({ validation: ["not-an-object"] }));
	assert.ok(validateWorkerReport(badEntry.report).includes("validation[0] must be an object"));

	const badEvidence = normalizeWorkerReport(validShape({ evidence: "nope" }));
	assert.ok(validateWorkerReport(badEvidence.report).includes("evidence must be an object"));
}

// L-1: extractWorkerReport calls normalize before validate; repairs is [] for an already-valid report
{
	const extracted = extractWorkerReport(`done:\n\`\`\`json\n${JSON.stringify(makeReport())}\n\`\`\``);
	assert.deepEqual(extracted.report, makeReport());
	assert.deepEqual(extracted.repairs, []);
}

console.log("planner-only report: PASS");
