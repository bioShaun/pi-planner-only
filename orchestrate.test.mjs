import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { LedgerSnapshotStore } from "./ledger-store.ts";
import { createTaskSpec, TaskStore } from "./task.ts";
import { hashStatus, describeComparison } from "./evidence.ts";
import { emptyTaskUsage } from "./usage.ts";

// Fixture ids are stamped 2026-09-05; pin the store clock so id replacement
// never depends on the wall clock of the machine running the suite.
const FIXED_NOW = () => new Date(2026, 8, 5);
const pinnedStore = () => new TaskStore({ now: FIXED_NOW });

// --------------------------------------------------------------------------
// Fixture: a GitRunner seam whose responses tests can override mid-flight, so
// an "external edit" can happen between a worker report and a Root verdict.
// --------------------------------------------------------------------------

const BASE = "/repo";
const emptyStatus = "";
const dirtyStatus = [
	"1 .M N... 100644 100644 100644 1111111 2222222 src/parser.ts",
	"",
].join("\n");
const cleanHash = hashStatus(dirtyStatus);

const gitDefaults = new Map([
	["rev-parse --git-dir", ".git\n"],
	["rev-parse HEAD", "abc1234\n"],
	["status --porcelain=v2 --branch", emptyStatus],
	["diff HEAD --stat", ""],
]);
const gitOverrides = new Map();
const gitRunner = async (args) => {
	const key = args.join(" ");
	const stdout = gitOverrides.has(key) ? gitOverrides.get(key) : gitDefaults.get(key) ?? "";
	return { stdout, stderr: "", code: 0 };
};

function setDirtyTree() {
	gitOverrides.set("status --porcelain=v2 --branch", dirtyStatus);
	gitOverrides.set("diff HEAD --stat", " src/parser.ts | 2 +-\n");
}

function setCleanTree() {
	gitOverrides.delete("status --porcelain=v2 --branch");
	gitOverrides.delete("diff HEAD --stat");
}

function specFor(taskId, role = "worker", cwd = `/fixture/${taskId}`) {
	return {
		taskId,
		objective: `implement ${taskId}`,
		cwd,
		role,
		scope: { allowedPaths: ["src/parser.ts"] },
		constraints: ["no new deps"],
		acceptanceCriteria: ["tests pass"],
		validation: { required: true, commands: ["npm test"] },
		expectedEvidence: { changedFiles: true, tests: true },
		stopConditions: ["ask if ambiguous"],
	};
}

function reportFor(taskId, toolCallId) {
	return {
		version: 1,
		taskId,
		status: "completed",
		summary: "Implemented the change.",
		changedFiles: ["src/parser.ts"],
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "1 passed" }],
		evidence: {
			cwd: `/fixture/${taskId}`,
			taskId,
			workerRunId: toolCallId,
			baseGitRef: "abc1234",
			finalGitRef: "abc1234",
			gitStatusHash: cleanHash,
			changedPaths: ["src/parser.ts"],
			gitAvailable: true,
			generatedAt: "2026-09-01T10:00:00.000Z",
		},
		risks: [],
		unresolved: [],
	};
}

// Ticket 22 round p10-r046 — strict fresh review requires reviewer evidence.
{
	const previous = process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
	try {
		process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = "1";
		const makeStrictTask = (taskId) => {
			const store = new TaskStore({ now: FIXED_NOW });
			const task = store.create(createTaskSpec({ objective: "strict review", cwd: BASE }, taskId));
			store.recordReport(taskId, reportFor(taskId, `${taskId}-worker`));
			return { store, task: store.require(taskId) };
		};
		const noReviewer = makeStrictTask("T-20260905-220a");
		assert.equal(noReviewer.store.require(noReviewer.task.taskId).reviewMode, "fresh");
		const noReviewerOrch = new PlannerOrchestrator({ gitRunner, store: noReviewer.store });
		assert.match(noReviewerOrch.rootVerdictRefusal(noReviewer.task, "pass").reason, /reviewer ReviewResult/);

		const zeroPaths = makeStrictTask("T-20260905-220b");
		zeroPaths.store.recordReview(zeroPaths.task.taskId, {
			taskId: zeroPaths.task.taskId, verdict: "pass", summary: "reviewed", findings: [], evidenceFresh: true, source: "reviewer",
		});
		zeroPaths.store.setLastComparison(zeroPaths.task.taskId, {
			verifiable: true, fresh: true, reasons: [], truthPaths: [], undeclaredPaths: [], extraDeclaredPaths: [],
			overlappingPaths: [], unrelatedPaths: [], missingPaths: [], unexplained: false,
		});
		const zeroPathsOrch = new PlannerOrchestrator({ gitRunner, store: zeroPaths.store });
		assert.match(zeroPathsOrch.rootVerdictRefusal(zeroPaths.task, "pass").reason, /attribution paths are 0/);

		const attributed = makeStrictTask("T-20260905-220c");
		attributed.store.recordReview(attributed.task.taskId, {
			taskId: attributed.task.taskId, verdict: "pass", summary: "reviewed", findings: [], evidenceFresh: true, source: "reviewer",
		});
		const comparison = {
			verifiable: true, fresh: true, reasons: [], truthPaths: ["src/parser.ts"], undeclaredPaths: [], extraDeclaredPaths: [],
			overlappingPaths: [], unrelatedPaths: [], missingPaths: [], unexplained: false,
		};
		attributed.store.setLastComparison(attributed.task.taskId, comparison);
		const attributedOrch = new PlannerOrchestrator({ gitRunner, store: attributed.store });
		assert.equal(attributedOrch.rootVerdictRefusal(attributed.task, "pass"), undefined);
		const receipt = attributedOrch.renderDecisionBlock(attributed.task, { action: "accept", reason: "accepted", guidance: [] }, describeComparison(comparison));
		assert.match(receipt, /review mode: fresh/);
		assert.ok(receipt.includes(`evidence: ${describeComparison(comparison)}`));

		delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
		const defaultStore = new TaskStore({ now: FIXED_NOW });
		const defaultTask = defaultStore.create(createTaskSpec({ objective: "default review", cwd: BASE }, "T-20260905-220e"));
		defaultStore.recordReport(defaultTask.taskId, reportFor(defaultTask.taskId, "default-worker"));
		const defaultOrch = new PlannerOrchestrator({ gitRunner, store: defaultStore });
		assert.equal(defaultTask.reviewMode, "root");
		assert.equal(defaultOrch.rootVerdictRefusal(defaultTask, "pass"), undefined);
	} finally {
		if (previous === undefined) delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
		else process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = previous;
	}
}

// Ticket 11 D1 — refused Root verdicts land on verdictRefusals, never reviews.
{
	const taskId = "T-20260916-301";
	const store = new TaskStore({ now: FIXED_NOW });
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const task = store.create(createTaskSpec({ objective: "refusal audit", cwd: BASE }, taskId));
	store.transition(task.taskId, "executing");
	store.recordReport(taskId, reportFor(taskId, `${taskId}-worker`));
	store.recordReview(taskId, {
		taskId, verdict: "request_changes", summary: "needs more coverage", findings: [], evidenceFresh: true, source: "reviewer",
	});
	orch.recordRootVerdictRefusal(store.require(taskId), "pass", { kind: "fresh-review-pending", reason: "test refusal" });
	const withRefusal = store.require(taskId);
	assert.equal(withRefusal.reviews.length, 1);
	assert.equal(withRefusal.verdictRefusals?.length, 1);
	assert.equal(withRefusal.verdictRefusals?.[0].kind, "fresh-review-pending");
	assert.equal(withRefusal.verdictRefusals?.[0].requestedVerdict, "pass");
	assert.equal(typeof withRefusal.verdictRefusals?.[0].at, "string");
	assert.match(orch.renderTaskStatus(withRefusal), /Refused verdicts: 1 \(fresh-review-pending\)/);

	await orch.recordRootVerdict(store.require(taskId), "pass", "override after refusal");
	const afterOverride = store.require(taskId);
	assert.equal(afterOverride.overrides.length, 1);
	assert.equal(afterOverride.overrides[0].reviewerVerdict, "request_changes");
}

// Ticket 11 D1 — a ledger record written before verdictRefusals existed restores and renders cleanly.
{
	const store = new TaskStore({ now: FIXED_NOW });
	const legacy = {
		taskId: "T-20260916-399",
		role: "worker",
		cwd: BASE,
		state: "completed",
		reviewRound: 1,
		reviewMode: "root",
		reports: [],
		validatorReports: [],
		reviews: [],
		overrides: [],
		aliases: [],
		reportCorrections: 0,
		executions: [],
		findings: [],
		recoveryAttempts: 0,
		recoveryStates: [],
		usage: emptyTaskUsage(),
		createdAt: "2026-09-16T00:00:00.000Z",
		updatedAt: "2026-09-16T00:00:00.000Z",
	};
	store.restore(legacy);
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const rendered = orch.renderTaskStatus(store.require("T-20260916-399"));
	assert.equal(rendered.includes("Refused verdicts"), false);
}

// Ticket 49: the verdict target resolves through the ledger-aware lookup, so a
// Task beyond the session restore cap can still be addressed by id — and a miss
// that is not simply "unknown" says why.
{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-49-verdict-"));
	try {
		const ledger = new LedgerSnapshotStore(dir);
		const seed = new TaskStore({ now: FIXED_NOW });
		ledger.write(seed.create(specFor("T-20260912-940", "worker", dir)));
		ledger.write(seed.create(specFor("T-20260912-941", "worker", "/public/scripts/finance-check-workspace")));

		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		assert.equal(orch.store.get("T-20260912-940"), undefined, "precondition: nothing was restored");

		const beyond = orch.resolveVerdictTask("T-20260912-940", dir);
		assert.equal(beyond.task?.taskId, "T-20260912-940", "a beyond-cap id resolves from the ledger");
		assert.equal(beyond.note, undefined);

		const foreign = orch.resolveVerdictTask("T-20260912-941", dir);
		assert.equal(foreign.task, undefined, "a foreign-workspace record is never adopted");
		assert.match(foreign.note ?? "", /belongs to workspace/);

		const unknown = orch.resolveVerdictTask("T-20260912-999", dir);
		assert.equal(unknown.task, undefined);
		assert.equal(unknown.note, undefined, "a plain unknown id carries no extra note");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Ticket 49: an id two Tasks claim as an alias is ambiguous, and the note names them.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const first = orch.store.create(specFor("T-20260914-942", "worker", BASE));
	const second = orch.store.create(specFor("T-20260914-943", "worker", BASE));
	first.aliases.push("T-20260914-944");
	second.aliases.push("T-20260914-944");
	const resolved = orch.resolveVerdictTask("T-20260914-944", BASE);
	assert.equal(resolved.task, undefined, "an ambiguous id resolves to no single Task");
	assert.match(resolved.note ?? "", /T-20260914-942/);
	assert.match(resolved.note ?? "", /T-20260914-943/);
}

// Ticket 14A V5-V11 — bounded cumulative budget and lifecycle behavior.
function budgetTaskFixture(taskId, cumulativeBudget, usage, role = "worker") {
	const store = pinnedStore();
	const task = store.create({ ...specFor(taskId, role), cumulativeBudget });
	task.usage = usage;
	return { store, task };
}
function boundedBudgetUsage(tokens, costUsd) {
	const usage = usageFixture(tokens, costUsd);
	usage.children = [{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0 }];
	return usage;
}

function statusWithBudget(cumulativeBudget, usage) {
	const store = pinnedStore();
	const task = store.create({ ...specFor("T-20260908-budget"), cumulativeBudget });
	task.usage = usage;
	return new PlannerOrchestrator({ gitRunner, store }).renderTaskStatus(task);
}
function usageFixture(output = 0, costUsd) {
	const usage = emptyTaskUsage();
	usage.root = { ...usage.root, turns: output ? 1 : 0, output, ...(costUsd === undefined ? {} : { costUsd }) };
	return usage;
}
{
	const status = statusWithBudget(undefined, usageFixture(120, 0));
	assert.equal(status.includes("Budget: 未设累计上限（已知消耗 tokens=120，费用 $0.0000；未知项 tokens 0 项、费用 0 项）"), true);
	assert.equal(status.includes("剩余"), false);
}
{
	const usage = usageFixture(700, 0.1234);
	usage.children = [{ input: 0, output: 300, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0.4567 }];
	const status = statusWithBudget({ tokens: 1500, costUsd: 1 }, usage);
	assert.equal(status.includes("  tokens: 已用 1000 / 上限 1500，剩余 500，未知项 0 项"), true);
	assert.equal(status.includes("  费用: 已用 $0.5801 / 上限 $1.0000，剩余 $0.4199，未知项 0 项"), true);
}
{
	assert.equal(statusWithBudget({ tokens: 1000 }, usageFixture(1200, 0.5)).includes("剩余 -200，未知项 0 项（已超支）"), true);
}
{
	const status = statusWithBudget({ costUsd: 2 }, usageFixture(7, 0.25));
	assert.equal(status.includes("  tokens: 已用 7，未设累计上限，未知项 0 项"), true);
	assert.equal(status.includes("  费用: 已用 $0.2500 / 上限 $2.0000，剩余 $1.7500，未知项 0 项"), true);
}
{
	const usage = usageFixture(10, 0.1);
	usage.root.tokensUnknownTurns = 1;
	assert.equal(statusWithBudget({ tokens: 20, costUsd: 1 }, usage).includes("已用 10（不含 1 个未知项） / 上限 20，剩余 10，未知项 1 项"), true);
}
{
	const usage = usageFixture(10, 0.1);
	usage.children = [1, 2].map((output) => ({ input: 0, output, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0.2 }));
	const status = statusWithBudget({ tokens: 100 }, usage);
	assert.equal(status.includes("  - root: 1 turns, tokens=10, 费用 $0.1000"), true);
	assert.equal(status.includes("  - worker: 2 calls, tokens=3, 费用 $0.4000"), true);
	assert.equal(status.includes("reviewer"), false);
}
{
	// A role with zero calls is absent, not zero-filled: children arrived before
	// any Root turn, so there must be no "root: 0 turns" row.
	const usage = usageFixture(0);
	usage.children = [{ input: 0, output: 5, cacheRead: 0, cacheWrite: 0, kind: "explorer", pending: false, source: "sync-details", costUsd: 0.01 }];
	const status = statusWithBudget({ tokens: 100 }, usage);
	assert.equal(status.includes("  - explorer: 1 calls, tokens=5, 费用 $0.0100"), true);
	assert.equal(status.split("\n").some((line) => line.startsWith("  - root:")), false, "a Root with zero turns must not get a role row");
}
{
	const store = pinnedStore();
	const task = store.create(specFor("T-20260908-no-usage"));
	task.usage = undefined;
	assert.equal(new PlannerOrchestrator({ gitRunner, store }).renderTaskStatus(task).split("\n").some((line) => line.startsWith("Budget")), false);
}

function withHostEnforcementEnv(overrides, fn) {
	const keys = ["PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS", "PI_PLANNER_ONLY_HOST_ENFORCES_COST_USD"];
	const saved = {};
	for (const key of keys) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
	for (const [key, value] of Object.entries(overrides)) {
		process.env[key] = value;
	}
	try {
		return fn();
	} finally {
		for (const key of keys) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	}
}

// Ticket 14B/17 W7 — configured limits without a declaration are labelled observation-only.
{
	const usage = usageFixture(700, 0.1234);
	usage.children = [{ input: 0, output: 300, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0.4567 }];
	const status = withHostEnforcementEnv({}, () => statusWithBudget({ tokens: 1500, costUsd: 1 }, usage));
	assert.equal(status.split("\n").some((line) => line.startsWith("  tokens:") && line.endsWith("；宿主未强制该维度，仅事后观测")), true, "W7: tokens line is observation-only");
	assert.equal(status.split("\n").some((line) => line.startsWith("  费用:") && line.endsWith("；宿主未强制该维度，仅事后观测")), true, "W7: cost line is observation-only");
}

// Ticket 14B/17 W8 — declaring tokens enforcement must not flip the cost line.
{
	const status = withHostEnforcementEnv({ PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS: "1" }, () => statusWithBudget({ tokens: 1500, costUsd: 1 }, usageFixture(100, 0.1)));
	const tokenLine = status.split("\n").find((line) => line.startsWith("  tokens:"));
	const costLine = status.split("\n").find((line) => line.startsWith("  费用:"));
	assert.equal(tokenLine.includes("；宿主在上限处强制停止"), true, "W8: tokens line is host-enforced");
	assert.equal(costLine.includes("；宿主未强制该维度，仅事后观测"), true, "W8: cost line stays observation-only");
}

// Ticket 14B/17 W9 — a dimension without a limit carries no enforcement suffix.
// The cost assertion is the positive anchor: without it the two negatives below
// also hold when the enforcement suffix is removed from the renderer entirely,
// so the block would pass against a feature that does not exist.
{
	const status = withHostEnforcementEnv({}, () => statusWithBudget({ costUsd: 2 }, usageFixture(7, 0.25)));
	const tokenLine = status.split("\n").find((line) => line.startsWith("  tokens:"));
	const costLine = status.split("\n").find((line) => line.startsWith("  费用:"));
	assert.equal(costLine.endsWith("；宿主未强制该维度，仅事后观测"), true, "W9: the limited cost line in the same render does carry the observation suffix");
	assert.equal(tokenLine.includes("；宿主未强制该维度，仅事后观测"), false, "W9: unlimited tokens line has no observation suffix");
	assert.equal(tokenLine.includes("；宿主在上限处强制停止"), false, "W9: unlimited tokens line has no hard-stop suffix");
}

// Ticket 14B/17 W10 — Root spend on the disclosure line is the Root ledger, not the Task total.
{
	const usage = usageFixture(700, 0.1234);
	usage.children = [{ input: 0, output: 300, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0.4567 }];
	const status = withHostEnforcementEnv({}, () => statusWithBudget({ tokens: 1500, costUsd: 1 }, usage));
	assert.equal(status.includes("  Root: 无预调用控制，Root 自身消耗只能事后计入（已计入 tokens=700、费用 $0.1234）"), true, "W10: Root line uses Root's own tokens and cost");
}

// Ticket 14B/17 W11 — the overspend named on the disclosure line is attributed to
// the Task, not to Root: a child can exhaust the limit on its own.
{
	const status = withHostEnforcementEnv({}, () => statusWithBudget({ tokens: 10000, costUsd: 1 }, usageFixture(15000, 0.1)));
	assert.equal(status.includes("；本 Task 当前已超额：tokens 5000"), true, "W11: tokens overspend suffix is frozen as ；本 Task 当前已超额：tokens 5000");
	assert.equal(status.includes("；当前tokens"), false, "W11: the unattributed 当前tokens wording must not come back");
}

// Ticket 14B/17 W12 — both overspent dimensions are joined with an ideographic comma.
{
	const status = withHostEnforcementEnv({}, () => statusWithBudget({ tokens: 10000, costUsd: 1 }, usageFixture(15000, 1.5)));
	assert.equal(status.includes("；本 Task 当前已超额：tokens 5000、费用 $0.5000"), true, "W12: both overspend items are joined with 、");
}

// Ticket 14B/17 W13 — the unconfigured-budget branch is byte-identical to before this ticket.
{
	const status = withHostEnforcementEnv({}, () => statusWithBudget(undefined, usageFixture(120, 0)));
	assert.equal(status.includes("Budget: 未设累计上限（已知消耗 tokens=120，费用 $0.0000；未知项 tokens 0 项、费用 0 项）"), true, "W13: unconfigured budget line is unchanged");
	assert.equal(status.includes("宿主未强制"), false, "W13: unconfigured branch has no observation suffix");
	assert.equal(status.includes("宿主在上限处强制停止"), false, "W13: unconfigured branch has no hard-stop suffix");
	assert.equal(status.includes("Root: 无预调用控制"), false, "W13: unconfigured branch has no Root disclosure line");
}

// renderTaskStatus shows the explicit TaskSpec opt-out reason, but not the default false
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const disabled = orch.store.create(createTaskSpec({ objective: "no validation", cwd: BASE, validation: { required: false } }, "T-20260905-236"));
	const disabledStatus = orch.renderTaskStatus(disabled);
	assert.match(disabledStatus, /Validation: not required \(TaskSpec 明确不要求验证\)/);

	const defaulted = orch.store.create(createTaskSpec({ objective: "default validation", cwd: BASE }, "T-20260905-237"));
	assert.doesNotMatch(orch.renderTaskStatus(defaulted), /Validation: not required/);
}

// --------------------------------------------------------------------------
// Ticket 10 — the workspace snapshot is the freshness basis for PASS
// --------------------------------------------------------------------------

// A pre-snapshot report (no snapshot bound) cannot complete via PASS.
{
	const store = new TaskStore({ now: () => new Date(2026, 8, 5) });
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const taskId = "T-20260905-994";
	const task = store.create(createTaskSpec({ objective: "legacy", cwd: BASE }), undefined);
	store.transition(task.taskId, "executing");
	store.recordReport(task.taskId, reportFor(taskId, "call-t10-0"));
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "accepting legacy");
	assert.equal(outcome.decision.action, "blocked");
	assert.match(outcome.decision.reason, /evidence material missing/);
	assert.notEqual(outcome.task.state, "completed");
}

// --------------------------------------------------------------------------
// Ticket 15: status discloses debt as an estimate on 已用, never as remaining (X7–X10)
// --------------------------------------------------------------------------

{
	const usage = usageFixture(0, 0.01);
	usage.children = [{
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		kind: "worker",
		pending: true,
		source: "unavailable",
		toolCallId: "call-ticket15-d1",
		tokensDebt: 40000,
		costDebtUsd: 0.12,
	}];
	const status = statusWithBudget({ tokens: 200000, costUsd: 0.5 }, usage);
	const costLine = status.split("\n").find((line) => line.startsWith("  费用:"));
	// X7: the estimate is labelled as such; it is never dressed up as a measurement.
	assert.equal(costLine.includes("已用 $0.1300（其中 $0.1200 是 1 个未知项按授予额度估算，非实测） / 上限 $0.5000，剩余 $0.3700，未知项 1 项"), true);
	// X8: the note hangs on 已用, the figure it qualifies — not on 剩余.
	assert.equal(costLine.includes("剩余 $0.3700（其中"), false);
}

{
	// X9: a negative remainder is `-$0.0300`, never `$-0.0300`.
	const usage = usageFixture(0, 0.01);
	usage.children = [1, 2, 3, 4].map((n) => ({
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		kind: "worker",
		pending: true,
		source: "unavailable",
		toolCallId: `call-ticket15-d5-${n}`,
		tokensDebt: n === 1 ? 40000 : undefined,
		costDebtUsd: 0.13,
	}));
	const status = statusWithBudget({ tokens: 200000, costUsd: 0.5 }, usage);
	const costLine = status.split("\n").find((line) => line.startsWith("  费用:"));
	assert.equal(costLine.includes("剩余 -$0.0300"), true);
	assert.equal(costLine.includes("$-0.0300"), false);
}

{
	// X10: Budget by role carries the same debt the dimensions do.
	const usage = usageFixture(0, 0.01);
	usage.children = [{
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		kind: "worker",
		pending: true,
		source: "unavailable",
		toolCallId: "call-ticket15-d1",
		tokensDebt: 40000,
		costDebtUsd: 0.12,
	}];
	const status = statusWithBudget({ tokens: 200000, costUsd: 0.5 }, usage);
	assert.equal(status.includes("- worker: 1 calls, tokens=40000, 费用 $0.1200，费用未知 1 项"), true);
}

// --------------------------------------------------------------------------
// Ticket 16-b: restore the ledger after reload; refuse when a snapshot is unreadable.
// --------------------------------------------------------------------------

function spentTaskRecord(taskId, costUsd = 0.04, limit = 0.05) {
	const store = new TaskStore();
	const spec = { ...specFor(taskId), cumulativeBudget: { tokens: 200000, costUsd: limit } };
	const task = store.create(spec);
	task.state = "changes_requested";
	task.usage = emptyTaskUsage();
	task.usage.children = [{ input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd }];
	task.reports.push(reportFor(task.taskId, "prior-run"));
	return task;
}

{
	const orch = new PlannerOrchestrator({ gitRunner });
	assert.deepEqual(orch.restoreFromLedger(), { restored: 0, corrupt: [] }, "L3: restoreFromLedger is a no-op without ledgerDir");
}

{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-16b-l2-"));
	try {
		new LedgerSnapshotStore(dir).write(spentTaskRecord("T-20260908-l2"));
		const injected = new TaskStore();
		const orch = new PlannerOrchestrator({ gitRunner, store: injected, ledgerDir: dir });
		assert.deepEqual(orch.restoreFromLedger(), { restored: 0, corrupt: [] }, "L2: injected deps.store plus ledgerDir does not read the disk ledger");
		assert.equal(orch.store.list().length, 0, "L2b: the injected store stays empty");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-16b-l13-"));
	try {
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const spec = { ...specFor("T-20260908-l13"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
		const live = orch.store.create(spec);
		const path = join(dir, "planner-only", "ledger", `${live.taskId}.json`);
		const envelope = JSON.parse(readFileSync(path, "utf8"));
		envelope.task.state = "failed";
		writeFileSync(path, JSON.stringify(envelope));
		const result = orch.restoreFromLedger();
		assert.equal(result.restored, 0, "L13: an in-memory record is not counted as restored");
		assert.equal(orch.store.require("T-20260908-l13").state, "planning", "L13b: live memory wins over the disk snapshot");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-16b-l25-"));
	try {
		const bad = spentTaskRecord("T-20260908-965", 0.04, 0.05);
		new LedgerSnapshotStore(dir).write(bad);
		const path = join(dir, "planner-only", "ledger", `${bad.taskId}.json`);
		writeFileSync(path, "this is not json", "utf8");
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const result = orch.restoreFromLedger();
		assert.equal(result.corrupt.some((item) => item.taskId === "T-20260908-965"), true, "L25a: restoreFromLedger reports the unreadable file as corrupt");
		const statusBeforeRepair = orch.renderTaskStatus(orch.store.require("T-20260908-965"));
		assert.match(statusBeforeRepair, /本会话拒绝写入该 taskId 的账本/, "L25: the quarantined task's status discloses the ledger quarantine");
		new LedgerSnapshotStore(dir).write(bad);
		const repaired = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(repaired.task.taskId, "T-20260908-965", "L25c: the fresh store repairs the snapshot on disk mid-session");
		const statusAfterRepair = orch.renderTaskStatus(orch.store.require("T-20260908-965"));
		assert.match(statusAfterRepair, /本会话拒绝写入该 taskId 的账本/, "L25b: the session still discloses the quarantine after the mid-session repair");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
// B1-B10 pin the unchanged post-stop lifecycle surface.
{
	const { store, task } = budgetTaskFixture("T-20260908-16c-b1", { tokens: 100, costUsd: 0.5 }, boundedBudgetUsage(0, 0));
	const orch = new PlannerOrchestrator({ gitRunner, store });
	assert.doesNotThrow(() => orch.renderTaskStatus(task), "B1: stopped Task status remains queryable");
	assert.match(orch.renderTaskStatus(task), /Budget \(累计\):/);
	task.reports.push(reportFor(task.taskId, "b2-report"));
	assert.equal(task.reports.length, 1, "B2: a child report is still recorded on a stopped Task");
	const request = await orch.recordRootVerdict(task, "request_changes", "stopped", { source: "root" });
	assert.equal(request.task.state, "changes_requested", "B4: request_changes still lands after the stop");
}
{
	const { store, task } = budgetTaskFixture("T-20260908-16c-b5", { tokens: 1, costUsd: 0.01 }, usageFixture(1, 0.01));
	const blocked = await new PlannerOrchestrator({ gitRunner, store }).recordRootVerdict(task, "blocked", "stopped", { source: "root" });
	assert.equal(blocked.task.state, "blocked", "B5: blocked remains available after stop");
}
// B9 (reviewer stays exempt after the stop) is already pinned by Z8 above, which is
// the assertion that actually fails when the `role !== "reviewer"` guard is removed.
// A second copy here was measured insensitive to that same mutation, so it is not kept:
// a vacuous assertion advertises coverage the suite does not have.
{
	const stopped = budgetTaskFixture("T-20260908-16c-b10a", { tokens: 1, costUsd: 0.01 }, usageFixture(1, 0.01));
	const ample = budgetTaskFixture("T-20260908-16c-b10b", { tokens: 1000, costUsd: 5 }, usageFixture(1, 0.01));
	const a = await new PlannerOrchestrator({ gitRunner, store: stopped.store }).recordRootVerdict(stopped.task, "blocked", "same", { source: "root" });
	const b = await new PlannerOrchestrator({ gitRunner, store: ample.store }).recordRootVerdict(ample.task, "blocked", "same", { source: "root" });
	assert.equal(a.task.state, b.task.state, "B10: stop does not alter the state machine");
}

// --------------------------------------------------------------------------
// Ticket 38 / F6 — session_start restore is capped and skips empty-cwd ghosts
// --------------------------------------------------------------------------
{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-38-restore-"));
	try {
		const ledger = new LedgerSnapshotStore(dir);
		const real = spentTaskRecord("T-20260908-38a", 0.01, 0.05);
		ledger.write(real);
		const ghostPath = join(dir, "planner-only", "ledger", "T-20260908-38ghost.json");
		writeFileSync(ghostPath, JSON.stringify({
			version: 1,
			writtenAt: "2026-09-08T00:00:00.000Z",
			task: {
				taskId: "T-20260908-38ghost",
				role: "worker",
				cwd: "",
				state: "planning",
				reviewRound: 0,
				reviewMode: "root",
				reports: [],
				validatorReports: [],
				reviews: [],
				overrides: [],
				aliases: [],
				reportCorrections: 0,
				usage: emptyTaskUsage(),
				createdAt: "1970-01-01T00:00:00.000Z",
				updatedAt: "1970-01-01T00:00:00.000Z",
				stateReason: "stray placeholder",
			},
		}), "utf8");
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const result = orch.restoreFromLedger();
		assert.equal(result.restored, 1, "38-a: only the real Task is restored");
		assert.equal(orch.store.get("T-20260908-38a")?.taskId, "T-20260908-38a", "38-b: real Task is present");
		assert.equal(orch.store.get("T-20260908-38ghost"), undefined, "38-c: empty-cwd ghost without TaskSpec is skipped");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-38-cap-"));
	try {
		const ledger = new LedgerSnapshotStore(dir);
		const { MAX_LEDGER_RESTORE_PER_SESSION } = await import("./types.ts");
		for (let i = 0; i < MAX_LEDGER_RESTORE_PER_SESSION + 3; i += 1) {
			const id = `T-20260908-38c${String(i).padStart(3, "0")}`;
			const task = spentTaskRecord(id, 0.01, 0.05);
			task.updatedAt = new Date(Date.UTC(2026, 8, 8, 0, 0, i)).toISOString();
			ledger.write(task);
		}
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const result = orch.restoreFromLedger();
		assert.equal(result.restored, MAX_LEDGER_RESTORE_PER_SESSION, "38-d: restore is capped at MAX_LEDGER_RESTORE_PER_SESSION");
		assert.ok(orch.store.get("T-20260908-38c066"), "38-e: freshest records are preferred");
		assert.equal(orch.store.get("T-20260908-38c000"), undefined, "38-f: oldest beyond the cap are skipped");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// --------------------------------------------------------------------------
// Ticket 41 — blocked lifecycle: abandon, receipt parking, verdict, status
// --------------------------------------------------------------------------
{
	const store = pinnedStore();
	const task = store.create(specFor("T-20260908-41ab"));
	store.transition(task.taskId, "executing");
	store.transition(task.taskId, "blocked");
	assert.ok(store.require(task.taskId).sealedAt, "41-a: entering blocked sets sealedAt");
	const abandoned = store.abandon(task.taskId, "operator stop-loss");
	assert.equal(abandoned.state, "failed", "41-b: abandon allows blocked → failed");
	assert.equal(abandoned.stateReason, "operator stop-loss");
	assert.equal(abandoned.sealedAt, undefined, "41-c: sealedAt cleared on abandon");
	assert.throws(() => store.abandon(task.taskId), /terminal task: failed/, "41-d: failed remains non-abandonable");
}

{
	const store = pinnedStore();
	const task = store.create(specFor("T-20260908-41vd"));
	store.transition(task.taskId, "executing");
	store.recordReport(task.taskId, reportFor(task.taskId, "r-41vd"));
	store.transition(task.taskId, "blocked");
	const orch = new PlannerOrchestrator({ gitRunner, store });
	setDirtyTree();
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "blocked", "independent close", { source: "root" });
	// planner_verdict on blocked remains open — decision applied (escape hatch).
	assert.ok(outcome.decision, "41-j: planner_verdict still accepted on blocked");
	assert.equal(store.require(task.taskId).reviews.at(-1)?.verdict, "blocked", "41-k: verdict recorded");
	setCleanTree();
}

{
	const store = pinnedStore();
	const task = store.create(specFor("T-20260908-41st"));
	store.transition(task.taskId, "executing");
	store.transition(task.taskId, "blocked");
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const status = orch.renderTaskStatus(store.require(task.taskId));
	assert.match(status, /Blocked lifecycle:.*planner_verdict/, "41-l: status discloses verdict still accepted");
	assert.match(status, /late child receipts are parked/, "41-m: status discloses receipt parking");
	assert.match(status, /abandon → failed/, "41-n: status discloses abandon path");
	assert.match(status, /Sealed at:/, "41-o: status shows sealedAt");
}

// E01 ledger restore: a pre-E01 record without per-execution material cannot
// complete through the PASS gate; a restored record with full material can.
{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-e01-ledger-"));
	try {
		const ledgerDir = join(dir, "state");
		mkdirSync(join(ledgerDir, "planner-only", "ledger"), { recursive: true });
		const legacyTask = {
			taskId: "T-20260905-980",
			role: "worker",
			cwd: BASE,
			state: "reviewing",
			reviewRound: 0,
			reviewMode: "root",
			reports: [{
				version: 1,
				taskId: "T-20260905-980",
				status: "completed",
				summary: "done long ago",
				changedFiles: ["src/parser.ts"],
				validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "1 passed" }],
				evidence: { cwd: BASE, taskId: "T-20260905-980", workerRunId: "call-old", gitAvailable: false, generatedAt: "2026-09-01T10:00:00.000Z" },
				risks: [],
				unresolved: [],
			}],
			validatorReports: [],
			reviews: [],
			overrides: [],
			aliases: [],
			reportCorrections: 0,
			usage: emptyTaskUsage(),
			createdAt: "2026-09-01T10:00:00.000Z",
			updatedAt: "2026-09-01T10:00:00.000Z",
		};
		writeFileSync(
			join(ledgerDir, "planner-only", "ledger", "T-20260905-980.json"),
			JSON.stringify({ version: 1, writtenAt: "2026-09-01T10:00:00.000Z", task: legacyTask }),
		);
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir });
		const restored = orch.restoreFromLedger();
		assert.equal(restored.restored, 1);
		const verdict = await orch.recordRootVerdict(orch.store.require("T-20260905-980"), "pass", "trust the tree");
		assert.equal(verdict.decision.action, "blocked", verdict.decision.reason);
		assert.match(verdict.decision.reason, /evidence material missing/);
		assert.notEqual(verdict.task.state, "completed", "a restored record without A_run/C_report never auto-completes");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// E01 missing materials fail closed in-session too: a report with no
// A_run/C_report record cannot fall back to the legacy mixed comparison.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-980b";
	const spec = specFor(taskId);
	orch.store.create(spec);
	orch.store.transition(taskId, "executing");
	orch.store.transition(taskId, "reviewing");
	orch.store.recordReport(taskId, reportFor(taskId, "call-no-exec"));
	assert.equal(orch.store.require(taskId).executions.length, 0);
	setCleanTree();
	const verdict = await orch.recordRootVerdict(orch.store.require(taskId), "pass", "trust the tree");
	assert.equal(verdict.decision.action, "blocked", verdict.decision.reason);
	assert.match(verdict.decision.reason, /evidence material missing/);
	assert.notEqual(verdict.task.state, "completed", "an in-session record without A_run/C_report never auto-completes");
	setCleanTree();
}

console.log("planner-only orchestration: PASS");
