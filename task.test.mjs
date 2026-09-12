import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync } from "node:fs";
import {
	TaskStore,
	TaskIdAllocator,
	createTaskId,
	createTaskSpec,
	isExplicitlyNoValidation,
	extractTaskSpec,
	extractTaskSpecDetails,
	findWriterConflict,
	isExecutingStale,
	validateTaskSpec,
	canTransition,
	TASKSPEC_CHARACTERISTIC_FIELDS,
	buildTaskSpecExample,
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
assert.equal(createTaskSpec({ objective: "required without commands", cwd, validation: { required: true } }).validation.commands, undefined);
assert.equal(createTaskSpec({ objective: "required with empty commands", cwd, validation: { required: true, commands: [] } }).validation.commands, undefined);
assert.deepEqual(validateTaskSpec(createTaskSpec({ objective: "required without commands", cwd, validation: { required: true } })), []);


const explicitlyDisabledSpec = createTaskSpec({ objective: "skip validation", cwd, validation: { required: false } }, "T-20260831-002");
assert.equal(isExplicitlyNoValidation(explicitlyDisabledSpec), true);

assert.equal(isExplicitlyNoValidation(createTaskSpec({ objective: "default validation", cwd }, "T-20260831-003")), false);

// IS-01/I01-I05 — the persistent allocator owns ids outside the restored
// in-memory subset, including claims and unreadable historical snapshots.
{
	const root = mkdtempSync(join(cwd, ".planner-only-task-id-"));
	const now = () => new Date("2026-09-11T12:00:00.000Z");
	try {
		const firstAllocator = new TaskIdAllocator(root, { now });
		assert.equal(firstAllocator.allocate(), "T-20260911-001");
		const secondAllocator = new TaskIdAllocator(root, { now });
		assert.equal(secondAllocator.allocate(), "T-20260911-002", "a fresh process skips the first durable claim");
		mkdirSync(join(root, "planner-only", "ledger"), { recursive: true });
		writeFileSync(
			join(root, "planner-only", "ledger", "T-20260911-003.json"),
			"not parseable but still occupied",
		);
		assert.equal(secondAllocator.allocate(), "T-20260911-004", "unparseable historical ids are never reused");
		assert.throws(
			() => secondAllocator.reserve("T-20260911-003"),
			(error) => error?.code === "TASK_ID_CONFLICT",
			"explicit reuse reports a structured conflict",
		);
		const moduleUrl = new URL("./task.ts", import.meta.url).href;
		const childCode = `import { TaskIdAllocator } from ${JSON.stringify(moduleUrl)}; const allocator = new TaskIdAllocator(process.argv[1], { now: () => new Date("2026-09-11T12:00:00.000Z") }); console.log(allocator.allocate());`;
		const runChild = () => new Promise((resolve) => {
			const child = spawn(process.execPath, ["--experimental-strip-types", "-e", childCode, root], { stdio: ["ignore", "pipe", "pipe"] });
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (chunk) => { stdout += chunk; });
			child.stderr.on("data", (chunk) => { stderr += chunk; });
			child.on("close", (code) => resolve({ code, stdout, stderr }));
		});
		const [childA, childB] = await Promise.all([runChild(), runChild()]);
		assert.equal(childA.code, 0, `first concurrent allocator exited cleanly: ${childA.stderr}`);
		assert.equal(childB.code, 0, `second concurrent allocator exited cleanly: ${childB.stderr}`);
		assert.notEqual(childA.stdout.trim(), childB.stdout.trim(), "independent processes receive distinct ids");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

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
assert.deepEqual(validateTaskSpec({ ...spec, cumulativeBudget: { tokens: 50_000, costUsd: 1.5 } }), []);
assert.ok(validateTaskSpec({ ...spec, cumulativeBudget: "not-an-object" }).includes("cumulativeBudget must be an object when present"));


assert.ok(validateTaskSpec({ ...spec, cumulativeBudget: { tokens: 0 } }).includes("cumulativeBudget.tokens must be a positive finite number"));
assert.ok(validateTaskSpec({ ...spec, cumulativeBudget: { tokens: -1 } }).includes("cumulativeBudget.tokens must be a positive finite number"));
assert.ok(validateTaskSpec({ ...spec, cumulativeBudget: { costUsd: "x" } }).includes("cumulativeBudget.costUsd must be a positive finite number"));
const extractedCumulative = extractTaskSpecDetails(JSON.stringify({ taskId: "T-cumulative", objective: "budgeted", cwd, role: "worker", cumulativeBudget: { tokens: 100, costUsd: 2 } }));
assert.deepEqual(extractedCumulative.spec.cumulativeBudget, { tokens: 100, costUsd: 2 });
assert.equal(extractTaskSpecDetails(JSON.stringify({ ...spec, budget: { tokens: 10 } })).spec.cumulativeBudget, undefined);

// Variant C — additionalWorktreeRoots on TaskSpec
assert.deepEqual(validateTaskSpec({ ...spec, additionalWorktreeRoots: ["/worktrees/review"] }), []);
assert.ok(validateTaskSpec({ ...spec, additionalWorktreeRoots: "nope" }).includes("additionalWorktreeRoots must be an array of strings"));
assert.ok(validateTaskSpec({ ...spec, additionalWorktreeRoots: ["", "  "] }).includes("additionalWorktreeRoots entries must be non-empty strings"));
const withRoots = createTaskSpec({
	objective: "cross-worktree",
	cwd,
	additionalWorktreeRoots: ["/worktrees/review", "/worktrees/review", cwd, "  "],
}, "T-worktree-c");
assert.deepEqual(withRoots.additionalWorktreeRoots, [resolve("/worktrees/review")]);
const extractedRoots = extractTaskSpecDetails(JSON.stringify({
	taskId: "T-worktree-c2",
	objective: "cross-worktree extract",
	cwd,
	role: "worker",
	additionalWorktreeRoots: ["/worktrees/review"],
}));
assert.deepEqual(extractedRoots.spec.additionalWorktreeRoots, [resolve("/worktrees/review")]);
assert.equal(extractTaskSpecDetails(JSON.stringify({ ...spec, budget: { tokens: 10 } })).spec.additionalWorktreeRoots, undefined);

assert.ok(validateTaskSpec({ ...spec, budget: { tokens: Number.POSITIVE_INFINITY } }).some((e) => /budget\.tokens must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { tokens: "5000" } }).some((e) => /budget\.tokens must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { costUsd: 0 } }).some((e) => /budget\.costUsd must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { costUsd: -0.05 } }).some((e) => /budget\.costUsd must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { costUsd: Number.NaN } }).some((e) => /budget\.costUsd must be a positive finite number/.test(e)));



const explorerExample = buildTaskSpecExample({ toolName: "read", input: { path: "docs/api.md" }, cwd: "/repo" });
const explorerConstraints = explorerExample.constraints.join("\n");
assert.match(explorerConstraints, /canonical Task id from your launch packet/);
assert.match(explorerConstraints, /must not ask Root or supervisor for the taskId/);
assert.match(explorerConstraints, /status must be exactly completed, partial, blocked, or failed/);
assert.match(explorerConstraints, /validation status must be exactly passed, failed, or not-run/);
assert.match(explorerConstraints, /final message must contain only the WorkerReport JSON/);


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

{
	const empty = extractWorkerReport("");
	assert.equal(empty.ok, false);
	assert.deepEqual(empty, { ok: false, error: "worker returned no output", repairs: [] });
}
{
	const prose = extractWorkerReport("I finished the task");
	assert.equal(prose.ok, false);
	assert.ok(prose.error);
}

const fenced = `Here is the result:

\`\`\`json
${JSON.stringify(report, null, 2)}
\`\`\`

Let me know if you want changes.`;
{
	const extracted = extractWorkerReport(fenced);
	assert.equal(extracted.ok, true);
	assert.deepEqual(extracted.report, report);
}

// prose-wrapped JSON whose strings contain braces must still parse whole
const braced = makeReport({ summary: "uses {a,b} syntax and } too" });
{
	const extracted = extractWorkerReport(`Done! ${JSON.stringify(braced)} Let me know.`);
	assert.equal(extracted.ok, true);
	assert.deepEqual(extracted.report, braced);
}

const malformed = extractWorkerReport('```json\n{"version":1,"taskId":"T-1"}\n```');
assert.equal(malformed.ok, false);
assert.ok(malformed.error);
assert.match(malformed.error, /invalid WorkerReport/);

// a report whose evidence disagrees with its own taskId is rejected outright
{
	const extracted = extractWorkerReport(JSON.stringify(makeReport({ taskId: "T-other" })));
	assert.equal(extracted.ok, false);
	assert.ok(extracted.error);
}
// identity against the delegated task is asserted by the caller
{
	const extracted = extractWorkerReport(JSON.stringify(report));
	assert.equal(extracted.ok, true);
	assert.equal(extracted.report.taskId, "T-20260831-001");
}

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

// L-4: blocked → reviewing and failed → reviewing
assert.equal(canTransition("blocked", "reviewing"), true);
assert.equal(canTransition("failed", "reviewing"), true);
assert.equal(canTransition("blocked", "executing"), true);
assert.equal(canTransition("failed", "executing"), true);
assert.equal(canTransition("blocked", "failed"), true); // ticket 41 Option 3
{
	const hop = new TaskStore();
	const blocked = hop.create(createTaskSpec({ objective: "blocked hop", cwd }, "T-20260905-hop-b"));
	hop.transition(blocked.taskId, "executing");
	hop.transition(blocked.taskId, "blocked");
	hop.transition(blocked.taskId, "reviewing");
	assert.equal(hop.require(blocked.taskId).state, "reviewing");
	const failed = hop.create(createTaskSpec({ objective: "failed hop", cwd }, "T-20260905-hop-f"));
	hop.transition(failed.taskId, "executing");
	hop.transition(failed.taskId, "failed");
	hop.transition(failed.taskId, "reviewing");
	assert.equal(hop.require(failed.taskId).state, "reviewing");
}

const store = new TaskStore();
const task = store.create(spec);
assert.equal(task.state, "planning");
assert.equal(task.reviewRound, 0);
assert.equal(task.reviewMode, "root");
{
	const previous = process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
	try {
		process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = "1";
		const strictTask = new TaskStore({ now: () => new Date("2026-08-31T00:00:00Z") }).create(
			createTaskSpec({ objective: "strict review", cwd }, "T-20260831-strict"),
		);
		assert.equal(strictTask.reviewMode, "fresh");
	} finally {
		if (previous === undefined) delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
		else process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = previous;
	}
}
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

// activeForCwd() excludes terminal tasks, even when they match the cwd.
{
	const terminal = store.create(createTaskSpec({ objective: "terminal cwd", cwd }, "T-20260831-terminal-cwd"));
	store.transition(terminal.taskId, "executing");
	store.transition(terminal.taskId, "reviewing");
	store.transition(terminal.taskId, "completed");
	assert.notEqual(store.activeForCwd(cwd)?.taskId, terminal.taskId);
	assert.equal(store.activeForCwd("/no-such-workspace"), undefined);
}

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

// FR-04 — the lock follows write ability; same-Task re-entry is not a free pass
assert.equal(findWriterConflict([writerA], cwd, "worker").conflict, true);
assert.equal(findWriterConflict([writerA], cwd, "worker").taskId, "A");
const clash = findWriterConflict([writerA], cwd, "worker");
assert.equal(clash.conflict, true);
assert.equal(clash.taskId, "A");
assert.match(clash.reason, /write lock/);
// readers never take the lock and never conflict
assert.equal(findWriterConflict([writerA], cwd, "explorer").conflict, false);
assert.equal(findWriterConflict([readerC], cwd, "worker").conflict, false);
// a shell-capable validator is writable and contends; explorers do not
const shellValidator = { ...writerA, taskId: "V", role: "validator" };
assert.equal(findWriterConflict([writerA], cwd, "validator").conflict, true);
assert.equal(findWriterConflict([shellValidator], cwd, "worker").conflict, true);
assert.equal(findWriterConflict([shellValidator], cwd, "explorer").conflict, false);
// store-level helper still keys on executing; live lock is Orchestration
assert.equal(
	findWriterConflict([{ ...writerA, state: "reviewing" }], cwd, "worker").conflict,
	false,
);
// different cwd is fine
assert.equal(findWriterConflict([writerA], "/elsewhere", "worker").conflict, false);
// relative and symlink aliases of one worktree collide
{
	const real = mkdtempSync(join(process.cwd(), ".planner-only-lock-"));
	const aliasParent = mkdtempSync(join(process.cwd(), ".planner-only-lock-"));
	const alias = join(aliasParent, "alias");
	symlinkSync(real, alias);
	const holder = { ...writerA, cwd: real };
	assert.equal(findWriterConflict([holder], alias, "worker").conflict, true, "symlink alias collides");
	assert.equal(findWriterConflict([holder], `${real}/sub/..`, "worker").conflict, true, "relative alias collides");
	assert.equal(findWriterConflict([holder], alias, "explorer").conflict, false);
}

// D07 — a stale-looking holder still blocks: timeout is not exit
const staleWriter = { ...writerA, updatedAt: new Date(Date.now() - EXECUTING_STALE_MS - 1).toISOString() };
assert.equal(isExecutingStale(staleWriter), true);
const staleClash = findWriterConflict([staleWriter], cwd, "worker");
assert.equal(staleClash.conflict, true, "stale executing must keep blocking until the child is confirmed stopped");
assert.match(staleClash.reason, /not been confirmed exited/);
assert.equal(findWriterConflict([writerA], cwd, "worker").conflict, true);
const abandoned = store.create(createTaskSpec({ objective: "stuck", cwd }, "T-abandon-001"));
store.transition(abandoned.taskId, "executing");
store.abandon(abandoned.taskId, "operator reset");
assert.equal(store.require(abandoned.taskId).state, "failed");
assert.equal(store.require(abandoned.taskId).stateReason, "operator reset");
assert.throws(() => store.abandon(abandoned.taskId), /terminal task/);

// Ticket 41: abandon allows blocked → failed
{
	const blockedStore = new TaskStore();
	const blocked = blockedStore.create(createTaskSpec({ objective: "blocked abandon", cwd }, "T-abandon-blocked"));
	blockedStore.transition(blocked.taskId, "executing");
	blockedStore.transition(blocked.taskId, "blocked");
	assert.ok(blockedStore.require(blocked.taskId).sealedAt);
	blockedStore.abandon(blocked.taskId, "stop-loss");
	assert.equal(blockedStore.require(blocked.taskId).state, "failed");
	assert.equal(blockedStore.require(blocked.taskId).stateReason, "stop-loss");
}

// L-2: setBaseEvidence is write-once; clearBaseEvidence then set takes the new ref
{
	const once = new TaskStore();
	const task = once.create(createTaskSpec({ objective: "base once", cwd }, "T-20260905-base"));
	const first = {
		cwd,
		taskId: task.taskId,
		workerRunId: "run-a",
		finalGitRef: "aaaaaaa",
		gitAvailable: true,
		generatedAt: "2026-09-05T00:00:00.000Z",
	};
	const second = { ...first, workerRunId: "run-b", finalGitRef: "bbbbbbb" };
	once.setBaseEvidence(task.taskId, first);
	once.setBaseEvidence(task.taskId, second);
	assert.equal(once.require(task.taskId).baseEvidence?.finalGitRef, "aaaaaaa");
	once.clearBaseEvidence(task.taskId);
	assert.equal(once.require(task.taskId).baseEvidence, undefined);
	once.setBaseEvidence(task.taskId, second);
	assert.equal(once.require(task.taskId).baseEvidence?.finalGitRef, "bbbbbbb");
}

// L-2: abandon clears baseEvidence
{
	const gone = new TaskStore();
	const task = gone.create(createTaskSpec({ objective: "abandon base", cwd }, "T-20260905-ab"));
	gone.transition(task.taskId, "executing");
	gone.setBaseEvidence(task.taskId, {
		cwd,
		taskId: task.taskId,
		workerRunId: "run-ab",
		finalGitRef: "ccccccc",
		gitAvailable: true,
		generatedAt: "2026-09-05T00:00:00.000Z",
	});
	gone.abandon(task.taskId, "operator reset");
	assert.equal(gone.require(task.taskId).baseEvidence, undefined);
}

// L-5: get/require resolve aliases; create accepts an optional alias
{
	const aliased = new TaskStore({ now: () => new Date(2026, 8, 5) });
	const spec = createTaskSpec({ objective: "alias", cwd }, "T-20260905-001");
	const task = aliased.create(spec, "T-20260220-001");
	assert.equal(task.taskId, "T-20260905-001");
	assert.deepEqual(task.aliases, ["T-20260220-001"]);
	assert.equal(aliased.get("T-20260220-001")?.taskId, "T-20260905-001");
	assert.equal(aliased.require("T-20260220-001").taskId, "T-20260905-001");
	assert.equal(aliased.now().getFullYear(), 2026);
	assert.equal(aliased.now().getMonth(), 8);
	assert.equal(aliased.now().getDate(), 5);
}

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

// --------------------------------------------------------------------------
// Issue 03: extractTaskSpecDetails unit tests
// --------------------------------------------------------------------------
{
	// 1. Characteristic fields present (taskId, acceptanceCriteria, scope) but missing objective
	const missingObjPrompt = `Please work on:\n\`\`\`json\n${JSON.stringify({
		taskId: "oracle-status-line-01",
		acceptanceCriteria: ["test passes"],
		scope: { allowedPaths: ["src/"] },
	})}\n\`\`\``;
	const res1 = extractTaskSpecDetails(missingObjPrompt);
	assert.equal(res1.hasCharacteristics, true);
	assert.equal(res1.spec, undefined);
	assert.ok(res1.errors.includes("objective must be a non-empty string"));
	assert.equal(res1.titleAliasUsed, false);

	// 2. validation.required is not a boolean
	const invalidValPrompt = `Please work on:\n\`\`\`json\n${JSON.stringify({
		taskId: "oracle-status-line-01",
		objective: "Fix bug",
		validation: { required: "true", commands: ["npm test"] },
	})}\n\`\`\``;
	const res2 = extractTaskSpecDetails(invalidValPrompt);
	assert.equal(res2.hasCharacteristics, true);
	assert.equal(res2.spec, undefined);
	assert.ok(res2.errors.includes("validation.required must be a boolean"));

	// 3. title used as alias for objective
	const titlePrompt = `Please work on:\n\`\`\`json\n${JSON.stringify({
		taskId: "oracle-status-line-01",
		title: "Fix bug via title",
		acceptanceCriteria: ["unit test passes"],
	})}\n\`\`\``;
	const res3 = extractTaskSpecDetails(titlePrompt);
	assert.equal(res3.hasCharacteristics, true);
	assert.ok(res3.spec !== undefined);
	assert.equal(res3.spec.objective, "Fix bug via title");
	assert.equal(res3.titleAliasUsed, true);
	assert.deepEqual(res3.errors, []);
	assert.equal(extractTaskSpec(titlePrompt)?.objective, "Fix bug via title");

	// 4. No characteristic fields
	const plainPrompt = "Just run npm test and let me know.";
	const res4 = extractTaskSpecDetails(plainPrompt);
	assert.equal(res4.hasCharacteristics, false);
	assert.equal(res4.spec, undefined);
	assert.equal(res4.errors.length, 0);

	// 5. Bare JSON without characteristic fields (e.g. random object)
	const randomJsonPrompt = `Context:\n\`\`\`json\n{"foo": "bar", "count": 42}\n\`\`\``;
	const res5 = extractTaskSpecDetails(randomJsonPrompt);
	assert.equal(res5.hasCharacteristics, false);
	assert.equal(res5.spec, undefined);
}

{
	const seen = [];
	const persistStore = new TaskStore({
		now: () => new Date("2026-09-08T12:00:00.000Z"),
		onPersist: (record) => seen.push(record.taskId + ":" + record.state),
	});
	const rec = persistStore.create(createTaskSpec({ objective: "onPersist create", cwd }, "T-20260908-p1"));
	assert.deepEqual(seen, ["T-20260908-p1:planning"], "T1: create() invokes onPersist");
	persistStore.transition(rec.taskId, "executing");
	assert.deepEqual(seen, ["T-20260908-p1:planning", "T-20260908-p1:executing"], "T2: touch() invokes onPersist");
	persistStore.create(createTaskSpec({ objective: "onPersist create", cwd }, "T-20260908-p1"));
	assert.equal(seen.length, 2, "T3: create() of an existing id does not persist again");
	persistStore.persist(rec);
	assert.equal(seen.length, 3, "T4: persist() is the public usage-sync sink");
}

{
	const exploding = new TaskStore({
		onPersist: () => {
			throw new Error("sink exploded");
		},
	});
	assert.doesNotThrow(() => exploding.create(createTaskSpec({ objective: "sink must not explode create", cwd }, "T-20260908-p2")), "T5: onPersist throw must not fail create()");
	assert.doesNotThrow(() => exploding.transition("T-20260908-p2", "executing"), "T6: onPersist throw must not fail touch()");
}

{
	const seen = [];
	const frozen = new Date("2026-09-08T12:00:00.000Z");
	let now = frozen;
	const store = new TaskStore({
		now: () => now,
		onPersist: (record) => seen.push(record.taskId + ":" + record.updatedAt),
	});
	assert.equal(typeof store.restore, "function", "R1: restore is a real method");
	const snapshot = {
		taskId: "T-20260908-r1",
		role: "worker",
		cwd: "/fixture/T-20260908-r1",
		state: "changes_requested",
		reviewRound: 1,
		reviewMode: "root",
		reports: [],
		validatorReports: [],
		reviews: [],
		overrides: [],
		aliases: [],
		reportCorrections: 0,
		usage: { root: { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokensUnknownTurns: 0 }, children: [{ input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0.04 }] },
		createdAt: "2026-09-08T10:00:00.000Z",
		updatedAt: "2026-09-08T11:00:00.000Z",
		spec: createTaskSpec({ objective: "restore", cwd }, "T-20260908-r1"),
	};
	now = new Date("2026-09-08T13:00:00.000Z");
	store.restore(snapshot);
	assert.equal(store.require("T-20260908-r1").state, "changes_requested", "R2: restore installs the snapshot into the store");
	assert.equal(store.require("T-20260908-r1").updatedAt, "2026-09-08T11:00:00.000Z", "R3: restore does not rewrite updatedAt");
	assert.deepEqual(seen, [], "R4: restore does not call onPersist");
	const live = store.require("T-20260908-r1");
	live.state = "executing";
	store.restore({ ...snapshot, state: "failed", updatedAt: "2026-09-08T09:00:00.000Z" });
	assert.equal(store.require("T-20260908-r1").state, "executing", "R5: restore does not overwrite an in-memory record of the same id");
	assert.deepEqual(seen, [], "R6: a skipped restore still does not persist");
}

console.log("planner-only task lifecycle: PASS");
