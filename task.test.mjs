import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
	TaskStore,
	createTaskId,
	createTaskSpec,
	extractTaskSpec,
	findWriterConflict,
	isExecutingStale,
	validateTaskSpec,
	canTransition,
} from "./task.ts";
import {
	compactWorkerReport,
	extractWorkerReport,
	isWorkerReport,
	renderWorkerReport,
	stableStringify,
	validateWorkerReport,
} from "./report.ts";
import { EXECUTING_STALE_MS, MAX_WORKER_REPORT_CHARS, WORKER_REPORT_VERSION } from "./types.ts";

const cwd = process.cwd();

function makeReport(overrides = {}) {
	return {
		version: WORKER_REPORT_VERSION,
		taskId: "T-20260831-001",
		status: "completed",
		summary: "Added the parser and covered it with tests.",
		changedFiles: ["src/parser.ts", "src/parser.test.ts"],
		validation: [
			{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "42 passed" },
		],
		evidence: {
			cwd,
			taskId: "T-20260831-001",
			workerRunId: "call-1",
			baseGitRef: "abc1234",
			finalGitRef: "abc1234",
			gitStatusHash: "deadbeefdeadbeef",
			changedPaths: ["src/parser.ts", "src/parser.test.ts"],
			gitAvailable: true,
			generatedAt: "2026-08-31T10:00:00.000Z",
		},
		risks: ["parser is strict about trailing commas"],
		unresolved: [],
		...overrides,
	};
}

// --------------------------------------------------------------------------
// TaskSpec
// --------------------------------------------------------------------------

assert.match(createTaskId(new Date("2026-08-31T00:00:00Z"), 7), /^T-20260831-007$/);

const spec = createTaskSpec(
	{
		objective: "Add a CSV parser",
		cwd,
		role: "worker",
		scope: { allowedPaths: ["src/parser.ts"], forbiddenPaths: ["src/legacy/"] },
		constraints: ["no new dependencies"],
		acceptanceCriteria: ["empty input returns []"],
		validation: { required: true, commands: ["npm test"] },
		expectedEvidence: { changedFiles: true, tests: true },
		stopConditions: ["ask if the schema is ambiguous"],
	},
	"T-20260831-001",
);
assert.deepEqual(validateTaskSpec(spec), []);
assert.equal(spec.cwd, resolve(cwd));
assert.equal(spec.role, "worker");
assert.equal(spec.validation.required, true);

assert.ok(validateTaskSpec({ ...spec, taskId: "" }).length > 0);
assert.ok(validateTaskSpec({ ...spec, role: "admin" }).length > 0);
assert.ok(validateTaskSpec({ ...spec, objective: "  " }).length > 0);
assert.ok(validateTaskSpec({ ...spec, constraints: [1] }).length > 0);
assert.ok(validateTaskSpec("not an object").length > 0);

// TaskSpec.budget validation (U-5)
assert.deepEqual(validateTaskSpec({ ...spec, budget: { tokens: 50_000, costUsd: 1.5 } }), []);
assert.deepEqual(validateTaskSpec({ ...spec, budget: { tokens: 10_000 } }), []);
assert.deepEqual(validateTaskSpec({ ...spec, budget: { costUsd: 0.25 } }), []);
assert.ok(validateTaskSpec({ ...spec, budget: "not-an-object" }).some((e) => /budget must be an object/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { tokens: 0 } }).some((e) => /budget\.tokens must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { tokens: -100 } }).some((e) => /budget\.tokens must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { tokens: Number.POSITIVE_INFINITY } }).some((e) => /budget\.tokens must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { tokens: "5000" } }).some((e) => /budget\.tokens must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { costUsd: 0 } }).some((e) => /budget\.costUsd must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { costUsd: -0.05 } }).some((e) => /budget\.costUsd must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { costUsd: Number.NaN } }).some((e) => /budget\.costUsd must be a positive finite number/.test(e)));


// --------------------------------------------------------------------------
// WorkerReport validation
// --------------------------------------------------------------------------

const report = makeReport();
assert.deepEqual(validateWorkerReport(report), []);
assert.equal(isWorkerReport(report), true);

assert.ok(validateWorkerReport({ ...report, taskId: "" }).length > 0);
assert.ok(validateWorkerReport({ ...report, status: "done" }).length > 0);
assert.ok(validateWorkerReport({ ...report, version: 2 }).length > 0);
assert.ok(validateWorkerReport({ ...report, changedFiles: "src/a.ts" }).length > 0);
assert.ok(validateWorkerReport({ ...report, validation: [{}] }).length > 0);
// mismatched taskId between report and evidence must be rejected
assert.ok(
	validateWorkerReport({
		...report,
		evidence: { ...report.evidence, taskId: "T-20260831-999" },
	}).some((error) => /evidence\.taskId must match/.test(error)),
);
// missing taskId is rejected, not silently accepted
assert.ok(validateWorkerReport({ ...report, taskId: undefined }).length > 0);

// --------------------------------------------------------------------------
// WorkerReport extraction
// --------------------------------------------------------------------------

assert.deepEqual(extractWorkerReport(""), { error: "worker returned no output" });
assert.ok(extractWorkerReport("I finished the task").error);

const fenced = `Here is the result:

\`\`\`json
${JSON.stringify(report, null, 2)}
\`\`\`

Let me know if you want changes.`;
assert.deepEqual(extractWorkerReport(fenced).report, report);

// prose-wrapped JSON whose strings contain braces must still parse whole
const braced = makeReport({ summary: "uses {a,b} syntax and } too" });
assert.deepEqual(
	extractWorkerReport(`Done! ${JSON.stringify(braced)} Let me know.`).report,
	braced,
);

const malformed = extractWorkerReport('```json\n{"version":1,"taskId":"T-1"}\n```');
assert.ok(malformed.error);
assert.match(malformed.error, /invalid WorkerReport/);

// a report whose evidence disagrees with its own taskId is rejected outright
assert.ok(extractWorkerReport(JSON.stringify(makeReport({ taskId: "T-other" }))).error);
// identity against the delegated task is asserted by the caller
assert.equal(extractWorkerReport(JSON.stringify(report)).report.taskId, "T-20260831-001");

// --------------------------------------------------------------------------
// Compaction
// --------------------------------------------------------------------------

const small = compactWorkerReport(report);
assert.equal(small.compacted, false);

const huge = makeReport({
	summary: "x".repeat(40000),
	changedFiles: Array.from({ length: 900 }, (_, index) => `src/file-${index}.ts`),
	validation: Array.from({ length: 300 }, () => ({
		command: "npm test",
		type: "test",
		status: "failed",
		exitCode: 1,
		summary: "y".repeat(400),
	})),
	risks: Array.from({ length: 200 }, () => "z".repeat(200)),
	unresolved: Array.from({ length: 200 }, () => "w".repeat(200)),
	notes: Array.from({ length: 50 }, () => "n".repeat(300)),
});
const compacted = compactWorkerReport(huge);
assert.equal(compacted.compacted, true);
assert.ok(stableStringify(compacted.report).length <= MAX_WORKER_REPORT_CHARS);
// validation identity survives compaction: the parent reviews on these
assert.ok(compacted.report.validation.length > 0);
assert.equal(compacted.report.validation[0].exitCode, 1);
assert.equal(compacted.report.validation[0].status, "failed");
assert.equal(compacted.report.taskId, huge.taskId);
assert.equal(compacted.report.status, huge.status);

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

const rendered = renderWorkerReport(report, { round: 1, state: "reviewing", evidence: "fresh" });
assert.match(rendered, /\[PLANNER-ONLY WORKER REPORT\]/);
assert.match(rendered, /taskId: T-20260831-001/);
assert.match(rendered, /status: completed/);
assert.match(rendered, /round: 1\/3/);
assert.match(rendered, /evidence: fresh/);
assert.match(rendered, /- \[passed\] test: npm test exit 0/);
assert.match(rendered, /src\/parser\.ts/);

// --------------------------------------------------------------------------
// State machine
// --------------------------------------------------------------------------

assert.equal(canTransition("planning", "executing"), true);
assert.equal(canTransition("executing", "reviewing"), true);
assert.equal(canTransition("reviewing", "completed"), true);
assert.equal(canTransition("reviewing", "changes_requested"), true);
assert.equal(canTransition("changes_requested", "executing"), true);
assert.equal(canTransition("completed", "executing"), false);
assert.equal(canTransition("executing", "completed"), false);

const store = new TaskStore();
const task = store.create(spec);
assert.equal(task.state, "planning");
assert.equal(task.reviewRound, 0);
assert.equal(task.reviewMode, "root");
assert.equal(task.usage.root.turns, 0);
assert.deepEqual(task.usage.children, []);
assert.equal(task.usage.costUnknown, false);

store.transition(task.taskId, "executing");
store.transition(task.taskId, "reviewing");
store.transition(task.taskId, "changes_requested");
store.transition(task.taskId, "executing");
store.transition(task.taskId, "reviewing");
store.transition(task.taskId, "completed");
assert.equal(store.require(task.taskId).state, "completed");
assert.throws(() => store.transition(task.taskId, "executing"), /illegal task transition/);

// review round cap
const step = store.create(createTaskSpec({ objective: "s", cwd }, "T-20260831-002"));
assert.equal(store.canRequestAnotherFix(step.taskId), true);
store.incrementRound(step.taskId);
store.incrementRound(step.taskId);
store.incrementRound(step.taskId);
assert.equal(store.require(step.taskId).reviewRound, 3);
assert.equal(store.canRequestAnotherFix(step.taskId), false);

// report correction budget
assert.equal(store.canCorrectReport(step.taskId), true);
store.useReportCorrection(step.taskId);
assert.equal(store.canCorrectReport(step.taskId), false);

// unknown task
assert.throws(() => store.require("nope"), /unknown task/);

// active() prefers the most recently updated non-terminal task
const other = store.create(createTaskSpec({ objective: "t", cwd }, "T-20260831-003"));
store.transition(other.taskId, "executing");
assert.equal(store.active()?.taskId, "T-20260831-003");

// --------------------------------------------------------------------------
// One writer per cwd
// --------------------------------------------------------------------------

const writerA = {
	taskId: "A", role: "worker", state: "executing", cwd,
	reports: [], reviews: [], overrides: [], reportCorrections: 0,
	createdAt: "", updatedAt: "",
};
const writerB = { ...writerA, taskId: "B" };
const readerC = { ...writerA, taskId: "C", role: "explorer" };

assert.equal(findWriterConflict([writerA], cwd, "worker", "A").conflict, false);
const clash = findWriterConflict([writerA], cwd, "worker", "B");
assert.equal(clash.conflict, true);
assert.equal(clash.taskId, "A");
assert.match(clash.reason, /write lock/);
// readers never take the lock and never conflict
assert.equal(findWriterConflict([writerA], cwd, "explorer", "C").conflict, false);
assert.equal(findWriterConflict([readerC], cwd, "worker", "D").conflict, false);
// only executing tasks hold it
assert.equal(
	findWriterConflict([{ ...writerA, state: "reviewing" }], cwd, "worker", "B").conflict,
	false,
);
// different cwd is fine
assert.equal(findWriterConflict([writerA], "/elsewhere", "worker", "B").conflict, false);

const staleWriter = { ...writerA, updatedAt: new Date(Date.now() - EXECUTING_STALE_MS - 1).toISOString() };
assert.equal(isExecutingStale(staleWriter), true);
assert.equal(findWriterConflict([staleWriter], cwd, "worker", "B").conflict, false);
assert.equal(findWriterConflict([writerA], cwd, "worker", "B").conflict, true);
const abandoned = store.create(createTaskSpec({ objective: "stuck", cwd }, "T-abandon-001"));
store.transition(abandoned.taskId, "executing");
store.abandon(abandoned.taskId, "operator reset");
assert.equal(store.require(abandoned.taskId).state, "failed");
assert.equal(store.require(abandoned.taskId).stateReason, "operator reset");
assert.throws(() => store.abandon(abandoned.taskId), /terminal task/);

{
	const store = new TaskStore();
	const spec = createTaskSpec({ objective: "bind", cwd, role: "explorer" }, "T-bind-001");
	const task = store.create(createTaskSpec({ objective: "x", cwd, role: "worker" }, "T-bind-001"));
	store.bindSpec(task.taskId, spec);
	assert.equal(store.require(task.taskId).role, "explorer");
	assert.equal(store.require(task.taskId).spec?.objective, "bind");
	store.ensureCwd(task.taskId, "/should-not-overwrite");
	assert.equal(store.require(task.taskId).cwd, spec.cwd);
	const comparison = {
		verifiable: true,
		fresh: true,
		reasons: [],
		truthPaths: [],
		undeclaredPaths: [],
		extraDeclaredPaths: [],
		overlappingPaths: [],
		unrelatedPaths: [],
		missingPaths: [],
		unexplained: false,
	};
	store.setLastComparison(task.taskId, comparison);
	assert.equal(store.require(task.taskId).lastComparison?.fresh, true);
	assert.ok(extractTaskSpec(`please do:\n\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``));
}

console.log("planner-only task lifecycle: PASS");
