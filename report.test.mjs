import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	compactWorkerReport,
	extractWorkerReport,
	extractFinalAssistantText,
	isExtractedOk,
	isToolCallId,
	normalizeWorkerReport,
	renderWorkerReport,
	validateWorkerReport,
	validateWorkerReportIdentity,
	workerReportShapeReminder,
} from "./report.ts";

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
{
	const extracted = extractWorkerReport(`done:\n\`\`\`json\n${JSON.stringify(makeReport())}\n\`\`\``);
	assert.equal(extracted.ok, true);
	assert.deepEqual(extracted.report, makeReport());
}
{
	const extracted = extractWorkerReport("I gave up.");
	assert.equal(extracted.ok, false);
	assert.ok(extracted.error);
}

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

// C23: completed_with_limits is an exact status token mapped to partial.
{
	const raw = validShape({ status: "completed_with_limits" });
	const { report, repairs } = normalizeWorkerReport(raw);
	assert.equal(raw.status, "completed_with_limits", "normalization does not mutate the original value");
	assert.equal(report.status, "partial");
	assert.ok(repairs.some((note) => /status "completed_with_limits" → partial/.test(note)));
	assert.equal(normalizeWorkerReport(report).report.status, "partial");
	assert.deepEqual(normalizeWorkerReport(report).repairs, [], "normalization is idempotent");

	const unsupported = normalizeWorkerReport(validShape({ status: "completed-with-limits" }));
	assert.equal(unsupported.report.status, "completed-with-limits", "near-match status is not normalized");
}

// C23: not-run validation cannot claim a successful exit code; drop the code.
{
	for (const exitCode of [0, "0", null]) {
		const { report, repairs } = normalizeWorkerReport(validShape({
			validation: [{ command: "npm test", type: "test", status: "not-run", exitCode, summary: "not run" }],
		}));
		assert.equal(report.validation[0].status, "not-run");
		assert.equal("exitCode" in report.validation[0], false);
		assert.ok(repairs.some((note) => /validation\[0\]\.exitCode.*not-run/.test(note)));
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
	assert.ok(passed.report.validation[0].inferred);
	assert.ok(passed.repairs.some((note) => /status/.test(note)));

	const failed = normalizeWorkerReport(validShape({
		validation: [{ command: "x", type: "test", exitCode: 1, summary: "ok" }],
	}));
	assert.equal(failed.report.validation[0].status, "failed");

	const notRun = normalizeWorkerReport(validShape({
		validation: [{ command: "x", type: "test", summary: "ok" }],
	}));
	assert.equal(notRun.report.validation[0].status, "not-run");
	assert.ok(notRun.report.validation[0].inferred);
}

// Ticket 34: real run5 reports with omitted status remain inferred, not worker-declared.
for (const prefix of ["75d7ae1c", "e63c7583"]) {
	const extracted = extractWorkerReport(readRun5Output(prefix));
	assert.equal(extracted.ok, true, prefix);
	assert.ok(isExtractedOk(extracted));
	assert.ok(extracted.report.validation.length > 0, prefix);
	assert.ok(extracted.report.validation.every((item) => item.status === "passed" && item.inferred === true), prefix);
}

// L-1: normalizeWorkerReport validation[].status empty and null are inferred.
{
	for (const status of ["", null]) {
		const result = normalizeWorkerReport(validShape({
			validation: [{ command: "x", type: "test", status, exitCode: 0, summary: "ok" }],
		}));
		assert.equal(result.report.validation[0].status, "passed");
		assert.equal(result.report.validation[0].inferred, true);
		assert.ok(result.repairs.some((note) => /status missing → passed/.test(note)));
	}
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

	const badEvidence = normalizeWorkerReport(validShape({ evidence: 1 }));
	assert.ok(validateWorkerReport(badEvidence.report).includes("evidence must be an object"));
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

{
	const { report, repairs } = normalizeWorkerReport(validShape({
		evidence: ["HEAD abc1234", "status clean"],
	}));
	assert.equal(report.evidence.taskId, "T-20260831-100");
	assert.ok(repairs.some((note) => /evidence array/.test(note)));
	assert.ok(report.notes.some((note) => /HEAD abc1234/.test(note)));
	assert.equal(validateWorkerReport(report).length, 0);
}

// L-1: extractWorkerReport calls normalize before validate; repairs is [] for an already-valid report
{
	const extracted = extractWorkerReport(`done:\n\`\`\`json\n${JSON.stringify(makeReport())}\n\`\`\``);
	assert.equal(extracted.ok, true);
	assert.deepEqual(extracted.report, makeReport());
	assert.deepEqual(extracted.repairs, []);
	assert.equal(extracted.level, "schema-valid");
}

// R15/T4 finding: worker-supplied Root-owned evidence fields are dropped or stamped
{
	const raw = {
		version: 1, taskId: "T-1", status: "completed", summary: "", changedFiles: [], validation: [],
		risks: [], unresolved: [],
		evidence: {
			taskId: "T-1",
			workerRunId: "call-guessed",
			baseGitRef: "4cb1ae55aed8be45128d590d382bd1d6a46ab905",
			finalGitRef: "4cb1ae55aed8be45128d590d382bd1d6a46ab905",
			gitStatusHash: "uncommitted worktree changes only; nothing staged or committed",
		},
	};
	const { report, repairs } = normalizeWorkerReport(raw, { expectedTaskId: "T-1", expectedWorkerRunId: "call-real" });
	assert.equal(report.evidence.gitStatusHash, undefined);
	assert.equal(report.evidence.finalGitRef, "4cb1ae55aed8be45128d590d382bd1d6a46ab905");
	assert.equal(report.evidence.workerRunId, "call-real");
	assert.ok(repairs.some((n) => /gitStatusHash .* dropped \(not a Root hash\)/.test(n)));
	assert.ok(repairs.some((n) => /workerRunId "call-guessed" → call-real/.test(n)));
	assert.deepEqual(validateWorkerReport(report), []);
	assert.deepEqual(validateWorkerReportIdentity(report, { taskId: "T-1", workerRunId: "call-real" }), []);

	// A real-looking hash and a matching run id are left alone; a missing run id is stamped.
	const ok = normalizeWorkerReport(
		{ ...raw, evidence: { taskId: "T-1", gitStatusHash: "0123456789abcdef", finalGitRef: "abc1234" } },
		{ expectedTaskId: "T-1", expectedWorkerRunId: "call-real" },
	);
	assert.equal(ok.report.evidence.gitStatusHash, "0123456789abcdef");
	assert.equal(ok.report.evidence.finalGitRef, "abc1234");
	assert.equal(ok.report.evidence.workerRunId, "call-real");
	assert.deepEqual(ok.repairs, ["evidence.workerRunId missing → call-real"]);

	// Without an expected run id nothing is stamped or replaced.
	const none = normalizeWorkerReport({ ...raw, evidence: { taskId: "T-1", workerRunId: "call-guessed" } });
	assert.equal(none.report.evidence.workerRunId, "call-guessed");
	assert.deepEqual(none.repairs, []);
}

// R15/T5 finding: a prose `evidence` string is rebuilt as { taskId } and kept as a note
{
	const raw = {
		version: 1, taskId: "T-1", status: "completed", summary: "", changedFiles: [], validation: [],
		risks: [], unresolved: [],
		evidence: "HEAD 3c0bfa0, two files modified, nothing staged",
	};
	const { report, repairs } = normalizeWorkerReport(raw, { expectedTaskId: "T-1", expectedWorkerRunId: "call-1" });
	assert.deepEqual(report.evidence, { taskId: "T-1", workerRunId: "call-1" });
	assert.deepEqual(report.notes, ["evidence (worker text): HEAD 3c0bfa0, two files modified, nothing staged"]);
	assert.ok(repairs.includes("evidence string → { taskId } (text kept in notes)"));
	assert.deepEqual(validateWorkerReport(report), []);
	// An empty string leaves no note.
	const empty = normalizeWorkerReport({ ...raw, evidence: "  " }, { expectedTaskId: "T-1" });
	assert.equal(empty.report.notes, undefined);
	assert.deepEqual(empty.report.evidence, { taskId: "T-1" });
}

{
	const mixed = [
		"notes",
		JSON.stringify({ taskId: "T-20260908-028", head: "abc", lockfileDiff: "none" }),
		"report:",
		JSON.stringify({
			version: 1,
			taskId: "T-20260908-028",
			status: "completed",
			summary: "done",
			changedFiles: [],
			validation: ["npm test passed", "npm run typecheck passed"],
			evidence: { taskId: "T-20260908-028" },
			risks: [],
			unresolved: [],
		}),
	].join("\n");
	const extracted = extractWorkerReport(mixed);
	assert.equal(extracted.ok, false, "string validation entries are still invalid");
	assert.match(extracted.error, /picked candidate with keys \[/);
	assert.match(extracted.error, /version/);
	assert.match(extracted.error, /validation/);
	assert.match(extracted.error, /validation\[\d+] must be an object/);
	assert.equal(extracted.level, "irreparable");
	assert.equal("report" in extracted, false);
}

{
	const good = extractWorkerReport(readRun5Output("74f164e8"));
	assert.equal(good.ok, true);
	assert.equal(good.report.status, "completed");
}

{
	for (const prefix of ["68b5f76e", "a5b8f153", "e567653d"]) {
		const extracted = extractWorkerReport(readRun5Output(prefix));
		assert.equal(extracted.ok, false, `${prefix} must still fail extraction`);
		assert.match(
			extracted.error,
			/validation\[\d+] must be an object/,
			`${prefix} must present the real report's validation errors, not the small object's status error`,
		);
		assert.match(extracted.error, /picked candidate with keys \[/);
		assert.match(extracted.error, /validation/);
		assert.equal(extracted.level, "irreparable");
		assert.equal("report" in extracted, false);
	}
}

// Regression: Role-based assistant extraction prevents prompt example or tool echoes from overriding final report.
{
	const promptCompleted = JSON.stringify({
		version: 1, taskId: "T-diag-001", status: "completed", summary: "Scoped change is done.",
		changedFiles: [], validation: [{ command: "npm test", type: "test", status: "not-run", summary: "not run" }],
		evidence: { taskId: "T-diag-001" }, risks: [], unresolved: [],
	});
	const toolEcho = JSON.stringify({
		version: 1, taskId: "T-other", status: "completed", summary: "permuted completion",
		changedFiles: [], validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
		evidence: { taskId: "T-other", workerRunId: "call_tool" }, risks: [], unresolved: [],
	});
	const assistantPartial = JSON.stringify({
		version: 1, taskId: "T-diag-001", status: "partial", summary: "Real diagnosis was partial.",
		changedFiles: [], validation: [{ command: "npm test", type: "diagnostic", status: "not-run", summary: "replay not run" }],
		evidence: { taskId: "T-diag-001", cwd: "/public/pi/pi-planner-only" },
		risks: ["risk a"], unresolved: ["unresolved item 1", "unresolved item 2"],
	});

	// 1. Role-bearing transcript with prompt completed + tool echo + assistant partial -> picks assistant partial
	const transcript = [
		JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: `Task:\n${promptCompleted}` }] } }),
		JSON.stringify({ type: "tool_execution_end", toolName: "read", result: { content: [{ type: "text", text: toolEcho }] } }),
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: assistantPartial }] } }),
	].join("\n");

	const extracted = extractWorkerReport(transcript);
	assert.equal(extracted.error, undefined);
	assert.equal(extracted.report?.status, "partial");
	assert.equal(extracted.report?.summary, "Real diagnosis was partial.");
	assert.deepEqual(extracted.report?.unresolved, ["unresolved item 1", "unresolved item 2"]);

	// 2. Role-bearing transcript where assistant output is invalid/prose -> MUST fail, never fall back to prompt example or tool echo
	const invalidAssistantTranscript = [
		JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: `Task:\n${promptCompleted}` }] } }),
		JSON.stringify({ type: "tool_execution_end", toolName: "read", result: { content: [{ type: "text", text: toolEcho }] } }),
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "I tried to finish the task but failed to produce a valid report." }] } }),
	].join("\n");

	const extractedInvalid = extractWorkerReport(invalidAssistantTranscript);
	assert.ok(extractedInvalid.error, "invalid final assistant message must fail");
	assert.equal(extractedInvalid.report, undefined, "must not return a report from user prompt or tool echo");

	// 3. Role-bearing transcript with NO assistant message -> MUST fail, never fall back to prompt example
	const noAssistantTranscript = [
		JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: `Task:\n${promptCompleted}` }] } }),
		JSON.stringify({ type: "tool_execution_end", toolName: "read", result: { content: [{ type: "text", text: toolEcho }] } }),
	].join("\n");

	const extractedNoAssistant = extractWorkerReport(noAssistantTranscript);
	assert.ok(extractedNoAssistant.error, "transcript with no assistant message must fail");
	assert.equal(extractedNoAssistant.report, undefined);

	// 4. Raw text containing [PLANNER-ONLY WORKER CONTRACT] example does not pick the example
	const rawWithContract = [
		"Task details here",
		"[PLANNER-ONLY WORKER CONTRACT]",
		"Do not run /code-review or spawn a reviewer. Return only a WorkerReport JSON object:",
		promptCompleted,
		"Do not run npm install, pnpm install, or any other command that modifies a lockfile, unless the TaskSpec explicitly requires it.",
		"If dependencies must be installed, use a lockfile-readonly install (npm ci, pnpm install --frozen-lockfile).",
		"If a lockfile is modified anyway, list it in changedFiles.",
		"",
		"Worker execution finishes here.",
		assistantPartial,
	].join("\n");

	const extractedRaw = extractWorkerReport(rawWithContract);
	assert.equal(extractedRaw.error, undefined);
	assert.equal(extractedRaw.report?.status, "partial");
	assert.equal(extractedRaw.report?.summary, "Real diagnosis was partial.");

	// 5. Tool-call-only / non-text final assistant message following earlier assistant text
	// MUST NOT fall back to earlier assistant text, prompt contract example, or tool echo.
	const toolCallOnlyTranscript = [
		JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: `Task:\n${promptCompleted}` }] } }),
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "I will now begin investigating the repo..." }] } }),
		JSON.stringify({ type: "tool_execution_end", toolName: "read", result: { content: [{ type: "text", text: toolEcho }] } }),
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "call_123", name: "bash", arguments: "{}" }] } }),
	].join("\n");

	const finalToolOnly = extractFinalAssistantText(toolCallOnlyTranscript);
	assert.equal(finalToolOnly.text, undefined, "final assistant with tool-call-only must have text: undefined, not earlier assistant text");
	assert.equal(finalToolOnly.hasRoles, true, "hasRoles must be true when role-bearing messages exist");

	const extractedToolOnly = extractWorkerReport(toolCallOnlyTranscript);
	assert.ok(extractedToolOnly.error, "session with tool-call-only final assistant must fail extraction");
	assert.equal(extractedToolOnly.report, undefined, "must not fall back to earlier assistant text, prompt, or tool echo");
	assert.match(extractedToolOnly.error ?? "", /worker session did not produce a final assistant report/);

	// 6. Non-text final assistant message (e.g. thinking-only)
	const thinkingOnlyTranscript = [
		JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: `Task:\n${promptCompleted}` }] } }),
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "Thinking about the task..." }] } }),
	].join("\n");

	const finalThinkingOnly = extractFinalAssistantText(thinkingOnlyTranscript);
	assert.equal(finalThinkingOnly.text, undefined, "thinking-only assistant must have text: undefined");
	assert.equal(finalThinkingOnly.hasRoles, true);

	const extractedThinkingOnly = extractWorkerReport(thinkingOnlyTranscript);
	assert.ok(extractedThinkingOnly.error);
	assert.equal(extractedThinkingOnly.report, undefined);

	// 7. Session ending on tool_execution_end (terminated before assistant response)
	const interruptedToolTranscript = [
		JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: `Task:\n${promptCompleted}` }] } }),
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Running tool..." }] } }),
		JSON.stringify({ type: "tool_execution_end", toolName: "bash", result: { content: [{ type: "text", text: toolEcho }] } }),
	].join("\n");

	const finalInterrupted = extractFinalAssistantText(interruptedToolTranscript);
	assert.equal(finalInterrupted.text, undefined, "interrupted session ending on tool must not treat earlier running text as final report");
	assert.equal(finalInterrupted.hasRoles, true);

	const extractedInterrupted = extractWorkerReport(interruptedToolTranscript);
	assert.ok(extractedInterrupted.error);
	assert.equal(extractedInterrupted.report, undefined);
}

// Regression: Tool call id cannot impersonate evidence.workerRunId; trusted host runId is preserved.
{
	const fakeToolCallId = "call_bUnZUxp6oD2AipaKGrOMMJa0|fc_08a9c3de653b161f016aa57576b51087d0b4fb69f7e94568b8";
	assert.equal(isToolCallId(fakeToolCallId), true);
	assert.equal(isToolCallId("tool_12345"), true);
	assert.equal(isToolCallId("toolu_12345"), true);
	assert.equal(isToolCallId("5104e118-b919-4a07-992a-e3ee2d6af34b"), false);
	assert.equal(isToolCallId("f0953eba-864e-4da2-baea-7cb6dbd80492"), false);

	// When tool call id is passed as expectedWorkerRunId, normalizeWorkerReport does not stamp it
	const rawReport = {
		version: 1, taskId: "T-1", status: "completed", summary: "done",
		changedFiles: [], validation: [], evidence: { taskId: "T-1" }, risks: [], unresolved: [],
	};
	const normalizedWithToolCallId = normalizeWorkerReport(rawReport, { expectedWorkerRunId: fakeToolCallId });
	assert.equal(normalizedWithToolCallId.report.evidence.workerRunId, undefined, "tool call id must not be stamped into workerRunId");

	// When report already had a tool call id, it is dropped as invalid
	const rawWithToolRunId = {
		...rawReport,
		evidence: { taskId: "T-1", workerRunId: fakeToolCallId },
	};
	const normalizedDropped = normalizeWorkerReport(rawWithToolRunId);
	assert.equal(normalizedDropped.report.evidence.workerRunId, undefined, "tool call id in evidence must be dropped");

	// When a real host runId is passed, it is stamped
	const realRunId = "f0953eba-864e-4da2-baea-7cb6dbd80492";
	const normalizedWithRealId = normalizeWorkerReport(rawReport, { expectedWorkerRunId: realRunId });
	assert.equal(normalizedWithRealId.report.evidence.workerRunId, realRunId);
}

// --------------------------------------------------------------------------
// ExtractedReport discriminant (behavior-preserving type tightening)
// --------------------------------------------------------------------------

{
	const ok = extractWorkerReport(`done:\n\`\`\`json\n${JSON.stringify(makeReport())}\n\`\`\``);
	assert.equal(ok.ok, true);
	assert.ok(isExtractedOk(ok));
	assert.ok(ok.report);
	assert.equal("error" in ok, false);
	assert.equal(ok.level, "schema-valid");
	assert.deepEqual(ok.repairs, []);
}

{
	const repaired = extractWorkerReport(`done:\n\`\`\`json\n${JSON.stringify({
		...makeReport(),
		version: "1",
	})}\n\`\`\``);
	assert.equal(repaired.ok, true);
	assert.equal(repaired.level, "repairable");
	assert.ok(repaired.repairs.length > 0);
	assert.equal(repaired.report.version, 1);
	assert.equal("error" in repaired, false);
}

{
	const empty = extractWorkerReport("");
	assert.equal(empty.ok, false);
	assert.equal(empty.error, "worker returned no output");
	assert.equal("report" in empty, false);
	assert.equal("level" in empty, false);
}

{
	const prose = extractWorkerReport("I gave up without JSON.");
	assert.equal(prose.ok, false);
	assert.equal(prose.error, "worker output did not contain a WorkerReport object");
	assert.equal("report" in prose, false);
	assert.equal("level" in prose, false);
}

{
	const bad = extractWorkerReport("```json\n" + JSON.stringify({
		version: 1,
		taskId: "T-1",
		status: "completed",
		summary: "x",
		changedFiles: [],
		validation: "not-an-array",
		evidence: { taskId: "T-1" },
		risks: [],
		unresolved: [],
	}) + "\n```");
	assert.equal(bad.ok, false);
	assert.equal(bad.level, "irreparable");
	assert.ok(bad.error);
	assert.match(bad.error, /picked candidate with keys \[/);
	assert.equal(typeof bad.seenKeys, "string");
	assert.ok(bad.seenKeys.includes("validation"));
	assert.equal("report" in bad, false);
}

console.log("planner-only report: PASS");
