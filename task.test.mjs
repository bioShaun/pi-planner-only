import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync } from "node:fs";
import { TaskStore, TaskIdAllocator, createTaskId, createTaskSpec, isExecutableCommandShape, isExplicitlyNoValidation, isExecutingStale, validateTaskSpec, VALIDATION_COMMANDS_REQUIRED_ERROR, canTransition, TASKSPEC_CHARACTERISTIC_FIELDS, TASKSPEC_FORBIDDEN_EXECUTION_CONTROLS, buildTaskSpecExample, buildTaskSpecRepair, appendTaskSpecRepair } from "./task.ts";
import { validateWorkerReport } from "./report.ts";
import { EXECUTING_STALE_MS, WORKER_REPORT_VERSION } from "./types.ts";

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
// Ticket 45 — the four shapes whose behavior must not change with the rule above.
for (const unchanged of [
	{ required: true, commands: ["npm test"] },
	{ required: false },
	{ required: false, commands: ["npm test"] },
	undefined,
]) {
	assert.deepEqual(
		validateTaskSpec({ ...spec, validation: unchanged }),
		[],
		`${JSON.stringify(unchanged)} must stay admissible`,
	);
}
assert.equal(spec.cwd, resolve(cwd));
assert.equal(spec.role, "worker");
// Ticket 03 — acceptanceMode: omitted defaults to "worktree" and persists;
// "observation" is explorer-only and validated at construction + validate.
assert.equal(spec.acceptanceMode, "worktree", "omitted acceptanceMode defaults to worktree");
assert.equal(
	createTaskSpec({ objective: "observe", cwd, role: "explorer", acceptanceMode: "observation", validation: { required: false } }).acceptanceMode,
	"observation",
);
assert.throws(
	() => createTaskSpec({ objective: "observe with a writer", cwd, role: "worker", acceptanceMode: "observation" }),
	(error) => error?.code === "TASKSPEC_ACCEPTANCE_MODE_INVALID",
);
assert.throws(
	() => createTaskSpec({ objective: "observe with a validator", cwd, role: "validator", acceptanceMode: "observation" }),
	(error) => error?.code === "TASKSPEC_ACCEPTANCE_MODE_INVALID",
);
assert.throws(
	() => createTaskSpec({ objective: "bogus mode", cwd, acceptanceMode: "audit" }),
	(error) => error?.code === "TASKSPEC_ACCEPTANCE_MODE_INVALID",
);
assert.deepEqual(validateTaskSpec({ ...spec, acceptanceMode: "worktree" }), []);
assert.deepEqual(validateTaskSpec({ ...spec, role: "explorer", acceptanceMode: "observation" }), []);
assert.ok(validateTaskSpec({ ...spec, acceptanceMode: "observation" }).some((e) => /acceptanceMode "observation" requires role "explorer"/.test(e)));
assert.ok(validateTaskSpec({ ...spec, acceptanceMode: "audit" }).some((e) => /acceptanceMode must be "worktree" or "observation"/.test(e)));
// Ticket 45 — "incomplete" counts USABLE commands, not array length. The
// constructor and the repair renderer both normalise through `uniqueNonEmpty`,
// which trims and drops blanks, so `["  "]` must be refused too: counting
// length admitted it and then handed the guard a definition with no commands.
for (const incomplete of [
	{ required: true },
	{ required: true, commands: [] },
	{ required: true, commands: ["  "] },
]) {
	assert.ok(
		validateTaskSpec({ ...spec, validation: incomplete }).includes(VALIDATION_COMMANDS_REQUIRED_ERROR),
		`the schema must reject ${JSON.stringify(incomplete)} and name the missing commands field`,
	);
	assert.throws(
		() => createTaskSpec({ objective: "incomplete validation", cwd, validation: incomplete }),
		(error) => {
			assert.equal(error?.code, "TASKSPEC_VALIDATION_INCOMPLETE");
			assert.match(error?.message, new RegExp(`received validation: ${JSON.stringify(incomplete).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
			return true;
		},
		`the constructor must refuse ${JSON.stringify(incomplete)}`,
	);
}
// A blank entry next to a real command is not "incomplete": the same
// normalisation drops the blank and leaves a satisfiable definition.
assert.deepEqual(validateTaskSpec({ ...spec, validation: { required: true, commands: ["  ", "npm test"] } }), []);
assert.deepEqual(
	createTaskSpec({ objective: "blank plus real", cwd, validation: { required: true, commands: ["  ", "npm test"] } }).validation.commands,
	["npm test"],
);

// Ticket 45 — the repair renderer must not paper over that refusal. Keeping the
// incomplete definition verbatim would hand back a template the validator guard
// is bound to refuse; downgrading it to `required: false` would silently drop a
// mandatory validation. It has to come back as needs-input instead — including
// for a blanks-only command list, which normalises down to no commands.
for (const incomplete of [
	{ required: true },
	{ required: true, commands: ["  "] },
]) {
	const incompleteRepair = buildTaskSpecRepair({
		toolName: "subagent",
		cwd,
		submitted: {
			taskId: "T-20260831-045",
			objective: "needs commands",
			cwd,
			role: "validator",
			validation: incomplete,
		},
	});
	assert.equal(incompleteRepair.status, "needs-input", `${JSON.stringify(incomplete)} must not be repairable`);
	assert.deepEqual(incompleteRepair.unresolvedFields, ["validation"]);
	assert.equal(incompleteRepair.example, undefined);
	const renderedIncompleteRepair = appendTaskSpecRepair("refused", incompleteRepair);
	assert.match(renderedIncompleteRepair, /validation\.commands/);
	assert.doesNotMatch(renderedIncompleteRepair, /resubmitted as-is/);
}

// Ticket 19 — validation.commands is the one TaskSpec field a machine consumes
// verbatim; an entry that is not executable-shaped is prose, not a command.
// The predicate is deliberately shallow: program/path-shaped first token
// (after leading env assignments), single line, arguments unrestricted.
for (const ok of [
	"node --experimental-strip-types delegate.test.mjs",
	"npx tsc --noEmit",
	"./scripts/run.sh --flag",
	"FOO=1 npm test",
	"FOO=1 BAR=2 npm test",
	"cd sub && npm test",
	"grep -r \"中文\" src/",
	"npm run test:release 2>&1 | tail -5",
	"~/bin/tool --verbose",
	"MSBuild /t:Build",
]) {
	assert.equal(isExecutableCommandShape(ok), true, `executable-shaped: ${ok}`);
}
for (const prose of [
	"按工单和 package.json 选择相关回归测试及必要检查，并在报告中记录准确命令和退出码",
	"Run the test suite and record exit codes",
	"\"quoted first token\"",
	"npm test\nnpm run build",
	"npm test\r\nnpm run build",
	"   ",
	"FOO=1",
]) {
	assert.equal(isExecutableCommandShape(prose), false, `not executable-shaped: ${JSON.stringify(prose)}`);
}

// createTaskSpec refuses prose commands at any `required` value — the
// validator may read the list even when validation is not mandatory.
for (const required of [true, false]) {
	assert.throws(
		() => createTaskSpec({
			objective: "prose commands",
			cwd,
			validation: { required, commands: ["按工单和 package.json 选择相关回归测试及必要检查，并在报告中记录准确命令和退出码"] },
		}),
		(error) => {
			assert.equal(error?.code, "TASKSPEC_VALIDATION_COMMAND_NOT_EXECUTABLE");
			assert.match(error?.message, /received: "按工单/);
			assert.match(error?.message, /acceptanceCriteria/);
			assert.match(error?.message, /required to false/);
			return true;
		},
		`prose commands must be refused at required: ${required}`,
	);
}
// A mixed list names only the prose entries by index; blank entries keep the
// ticket-45 normalisation (dropped, not refused) — covered above by
// "blank plus real".
assert.throws(
	() => createTaskSpec({
		objective: "mixed commands",
		cwd,
		validation: { required: true, commands: ["npm test", "然后运行全部测试", "npx tsc --noEmit"] },
	}),
	(error) => {
		assert.equal(error?.code, "TASKSPEC_VALIDATION_COMMAND_NOT_EXECUTABLE");
		assert.match(error?.message, /validation\.commands\[1\]/);
		assert.doesNotMatch(error?.message, /commands\[0\]/);
		assert.doesNotMatch(error?.message, /commands\[2\]/);
		return true;
	},
	"a mixed command list refuses and names only the prose entries",
);
// The schema asks the same question with the same predicate.
{
	const errors = validateTaskSpec({ ...spec, validation: { required: true, commands: ["npm test", "Verify the output and report the result"] } });
	assert.deepEqual(errors, ["validation.commands[1] is not an executable command shape"]);
}
// The repair renderer reports prose commands as needs-input — never kept
// verbatim, never silently dropped into a satisfiable-looking definition.
for (const submittedValidation of [
	["按工单选择相关回归测试"],
	{ required: true, commands: ["npm test", "然后运行全部测试"] },
	{ required: false, commands: ["Describe what to verify"] },
]) {
	const repair = buildTaskSpecRepair({
		toolName: "bash",
		input: { command: "npm test" },
		cwd,
		submitted: { validation: submittedValidation },
	});
	assert.equal(repair.status, "needs-input", `prose commands must be needs-input: ${JSON.stringify(submittedValidation)}`);
	assert.deepEqual(repair.unresolvedFields, ["validation"]);
	assert.equal(repair.example, undefined);
}


const explicitlyDisabledSpec = createTaskSpec({ objective: "skip validation", cwd, validation: { required: false } }, "T-20260831-002");
assert.equal(isExplicitlyNoValidation(explicitlyDisabledSpec), true);

assert.equal(isExplicitlyNoValidation(createTaskSpec({ objective: "default validation", cwd }, "T-20260831-003")), false);

// IS-01/I01-I05 — the persistent allocator owns ids outside the restored
// in-memory subset, including claims and unreadable historical snapshots.
{
	const root = mkdtempSync(join(tmpdir(), "planner-only-task-id-"));
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
		const runChild = () => new Promise((resolve, reject) => {
			const child = spawn(process.execPath, ["--experimental-strip-types", "-e", childCode, root], { stdio: ["ignore", "pipe", "pipe"] });
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (chunk) => { stdout += chunk; });
			child.stderr.on("data", (chunk) => { stderr += chunk; });
			child.on("error", reject);
			child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
		});
		const [childA, childB] = await Promise.all([runChild(), runChild()]);
		assert.equal(childA.signal, null);
		assert.equal(childB.signal, null);
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

assert.ok(validateTaskSpec({ ...spec, budget: { tokens: Number.POSITIVE_INFINITY } }).some((e) => /budget\.tokens must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { tokens: "5000" } }).some((e) => /budget\.tokens must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { costUsd: 0 } }).some((e) => /budget\.costUsd must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { costUsd: -0.05 } }).some((e) => /budget\.costUsd must be a positive finite number/.test(e)));
assert.ok(validateTaskSpec({ ...spec, budget: { costUsd: Number.NaN } }).some((e) => /budget\.costUsd must be a positive finite number/.test(e)));

// Ticket 43: TaskSpec must reject runtime execution controls (error, not warn).
{
	for (const key of TASKSPEC_FORBIDDEN_EXECUTION_CONTROLS) {
		const sample = key === "timeoutMs" ? 30_000
			: key === "toolBudget" ? { hard: 20 }
				: key === "usageBudget" ? { tokens: { hard: 1000 } }
					: "forbidden-value";
		const errors = validateTaskSpec({ ...spec, [key]: sample });
		assert.ok(
			errors.some((e) => e.includes(`${key} is an execution control`)),
			`expected validateTaskSpec to reject ${key}, got: ${JSON.stringify(errors)}`,
		);
	}
	// Business budget fields remain allowed.
	assert.deepEqual(validateTaskSpec({ ...spec, budget: { tokens: 10_000 }, cumulativeBudget: { costUsd: 0.5 } }), []);
}


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
// Stale executing detection (the write lock itself died in ticket 08)
// --------------------------------------------------------------------------

const staleWriter = {
	taskId: "A", role: "worker", state: "executing", cwd,
	reports: [], reviews: [], overrides: [], reportCorrections: 0,
	createdAt: "", updatedAt: new Date(Date.now() - EXECUTING_STALE_MS - 1).toISOString(),
};
assert.equal(isExecutingStale(staleWriter), true);
const abandoned = store.create(createTaskSpec({ objective: "stuck", cwd }, "T-abandon-001"));
store.transition(abandoned.taskId, "executing");
store.abandon(abandoned.taskId, "operator reset");
assert.equal(store.require(abandoned.taskId).state, "failed");
assert.equal(store.require(abandoned.taskId).stateReason, "operator reset");
assert.throws(() => store.abandon(abandoned.taskId), /terminal task/);

// --------------------------------------------------------------------------
// Ticket 46 — an alias must resolve to exactly one Task
// --------------------------------------------------------------------------
{
	const aliasStore = new TaskStore({ now: () => new Date("2026-09-14T00:00:00.000Z") });
	const owner = aliasStore.create(createTaskSpec({ objective: "canonical owner", cwd }, "T-20260914-920"));

	// An alias that is another Task's canonical id could never resolve: `get()`
	// prefers the canonical match, so the alias would be shadowed forever.
	assert.throws(
		() => aliasStore.create(createTaskSpec({ objective: "shadowed", cwd }, "T-20260914-921"), owner.taskId),
		(error) => error?.code === "TASK_ALIAS_CONFLICT",
		"an alias must not shadow a canonical id",
	);

	// Nor may two Tasks claim the same alias.
	const holder = aliasStore.create(createTaskSpec({ objective: "alias holder", cwd }, "T-20260914-922"), "T-46-shared-alias");
	assert.equal(aliasStore.get("T-46-shared-alias")?.taskId, holder.taskId, "a single-holder alias still resolves");
	assert.throws(
		() => aliasStore.create(createTaskSpec({ objective: "alias thief", cwd }, "T-20260914-923"), "T-46-shared-alias"),
		(error) => error?.code === "TASK_ALIAS_CONFLICT",
		"an alias resolves to one Task only",
	);

	// A ledger shared across hosts can still hold a duplicated alias. `get` must
	// then resolve to neither rather than silently picking the first holder.
	const first = aliasStore.create(createTaskSpec({ objective: "dup one", cwd }, "T-20260914-924"));
	const second = aliasStore.create(createTaskSpec({ objective: "dup two", cwd }, "T-20260914-925"));
	first.aliases.push("T-46-duplicated");
	second.aliases.push("T-46-duplicated");
	assert.equal(aliasStore.resolveCandidates("T-46-duplicated").length, 2, "both holders are reported");
	assert.equal(aliasStore.get("T-46-duplicated"), undefined, "get never picks the first of several holders");
}

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

// post-0.8.0 follow-up 01: a runaway stateReason belongs to the blocked state.
// Re-execution, review, and acceptance drop it; staying blocked (or a no-op
// transition while the current state still needs the text) keeps it.
{
	const reasonStore = new TaskStore();
	const stuck = reasonStore.create(createTaskSpec({ objective: "clear stale reason", cwd }, "T-clear-reason"));
	const runaway = "worker runaway: tokens 17027 exceeded envelope 12000; delegation cancelled";
	reasonStore.transition(stuck.taskId, "executing");
	reasonStore.transition(stuck.taskId, "blocked");
	reasonStore.setStateReason(stuck.taskId, runaway);
	assert.equal(reasonStore.require(stuck.taskId).stateReason, runaway, "blocked keeps the runaway reason");
	reasonStore.transition(stuck.taskId, "blocked");
	assert.equal(reasonStore.require(stuck.taskId).stateReason, runaway, "a no-op blocked transition keeps the reason");
	reasonStore.transition(stuck.taskId, "executing");
	assert.equal(reasonStore.require(stuck.taskId).state, "executing");
	assert.equal(reasonStore.require(stuck.taskId).stateReason, undefined, "re-execution clears the runaway reason");
	reasonStore.setStateReason(stuck.taskId, "needs reconcile");
	reasonStore.transition(stuck.taskId, "executing");
	assert.equal(reasonStore.require(stuck.taskId).stateReason, "needs reconcile", "staying executing keeps a reason the current state still needs");
	reasonStore.transition(stuck.taskId, "reviewing");
	assert.equal(reasonStore.require(stuck.taskId).stateReason, undefined, "entering review clears a stale reason");
	reasonStore.setStateReason(stuck.taskId, runaway);
	reasonStore.transition(stuck.taskId, "completed");
	assert.equal(reasonStore.require(stuck.taskId).state, "completed");
	assert.equal(reasonStore.require(stuck.taskId).stateReason, undefined, "acceptance clears a stale reason");
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
