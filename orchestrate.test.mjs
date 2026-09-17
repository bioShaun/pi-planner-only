import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { ConcurrencyController } from "./concurrency.ts";
import { LedgerSnapshotStore } from "./ledger-store.ts";
import { createTaskSpec, TaskStore, isExecutingStale } from "./task.ts";
import { hashStatus, describeComparison, captureEvidence } from "./evidence.ts";
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

function reportFor(taskId, toolCallId, cwd = `/fixture/${taskId}`) {
	return {
		version: 1,
		taskId,
		status: "completed",
		summary: "Implemented the change.",
		changedFiles: ["src/parser.ts"],
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "1 passed" }],
		evidence: {
			cwd,
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

function workerResult(toolCallId, report, wrapped = false) {
	const text = wrapped
		? `Working on it...\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\nDone.`
		: JSON.stringify(report);
	return { toolCallId, toolName: "subagent", input: {}, content: [{ type: "text", text }], isError: false };
}

function reviewerResult(toolCallId, taskId, verdict = "pass", overrides = {}) {
	return {
		toolCallId,
		toolName: "subagent",
		input: {},
		content: [{
			type: "text",
			text: JSON.stringify({
				taskId,
				verdict,
				summary: `${verdict} from reviewer`,
				evidenceFresh: true,
				findings: [],
				reportRevision: 1,
				...overrides,
			}),
		}],
		isError: false,
	};
}

function asyncNotify(_runId, preview) {
	return `Background task completed: **worker**\n\n${preview}`;
}

function artifactLayout(runId, agent, exitCode, report) {
	const tmp = mkdtempSync(join(tmpdir(), "planner-only-reconcile-"));
	const asyncDir = join(tmp, "async-subagent-runs", runId);
	mkdirSync(asyncDir, { recursive: true });
	mkdirSync(join(tmp, "artifacts", "outputs", runId), { recursive: true });
	if (report) writeFileSync(join(tmp, "artifacts", "outputs", runId, "result.json"), JSON.stringify(report));
	writeFileSync(join(tmp, "artifacts", `${runId}_${agent}_meta.json`), JSON.stringify({ runId, agent, exitCode }));
	return { tmp, asyncDir };
}

function receiptFor(toolCallId, runId, asyncDir) {
	return {
		toolCallId,
		toolName: "subagent",
		details: { asyncId: runId, runId, asyncDir },
		content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
	};
}

async function delegateWorker(orch, toolCallId, taskId) {
	setCleanTree();
	const outcome = await orch.beginDelegation(
		{ toolCallId, input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	setDirtyTree();
	return outcome;
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

// wrc-incident-followups 02 review — the recovery guidance inside
// renderTaskStatus names planner_abort (ADR-0003); pointing at
// planner_verdict would teach a combination that no longer exists.
{
	const store = pinnedStore();
	const task = store.create(specFor("T-20260917-501", "worker", BASE));
	store.setRecoveryRequired(task.taskId, { reason: "worker runaway: tokens", executionId: "call-x1" });
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const live = orch.renderTaskStatus(store.require(task.taskId));
	assert.match(live, /Recovery required:.*planner_abort/, "live requirement guidance names planner_abort");
	assert.doesNotMatch(live, /planner_verdict/);
	task.recovery = { required: false, executionId: "call-x1", reason: "x", consumedBy: "planner_abort", nextAction: "abort" };
	assert.match(orch.renderTaskStatus(task), /Recovery: aborted.*planner_abort/);
	task.recovery.consumedBy = undefined;
	const fallback = orch.renderTaskStatus(task);
	assert.match(fallback, /Recovery: aborted.*planner_abort/, "fallback attribution names planner_abort too");
	assert.doesNotMatch(fallback, /planner_verdict/);
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
	const task = store.create(createTaskSpec({ objective: "legacy", cwd: BASE }), undefined);
	store.transition(task.taskId, "executing");
	store.recordReport(task.taskId, reportFor(task.taskId, "call-t10-0"));
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
// Ticket 19 — a ledger record written before the executable-command check
// (prose in validation.commands) must restore verbatim: the guard lives in
// createTaskSpec, which the restore path never calls. Status rendering stays
// intact on the legacy shape.
{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-19-restore-"));
	try {
		const legacy = spentTaskRecord("T-20260908-prose");
		legacy.spec = { ...legacy.spec, validation: { required: true, commands: ["按工单选择相关回归测试并记录退出码"] } };
		new LedgerSnapshotStore(dir).write(legacy);
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const result = orch.restoreFromLedger();
		assert.equal(result.restored, 1, "a pre-check record with prose commands restores");
		const restored = orch.store.require("T-20260908-prose");
		assert.deepEqual(restored.spec.validation.commands, ["按工单选择相关回归测试并记录退出码"], "stored spec is restored verbatim");
		assert.doesNotThrow(() => orch.renderTaskStatus(restored), "status render does not crash on the legacy shape");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
// Ticket 18 — listLiveTasks merges ledger-only live records without adopting
// them: the restore cap may leave a live Task on disk only, and listing must
// still surface it (source: "ledger") while store.get stays undefined.
{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-18-"));
	try {
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		orch.store.create({ ...specFor("T-20260908-mem18"), cwd: "/live/workspace" });
		const completed = orch.store.create({ ...specFor("T-20260908-done18"), cwd: "/live/workspace" });
		completed.state = "completed";
		const legacy = spentTaskRecord("T-20260908-live18");
		legacy.state = "blocked";
		legacy.cwd = "/live/workspace";
		legacy.recovery = { required: true, executionId: "e18", reason: "worker_runaway" };
		legacy.spec = { ...legacy.spec, objective: "blocked ledger-only task" };
		legacy.updatedAt = "2020-01-01T00:00:00.000Z";
		new LedgerSnapshotStore(dir).write(legacy);
		const foreign = spentTaskRecord("T-20260908-far18");
		foreign.state = "executing";
		foreign.cwd = "/other/workspace";
		new LedgerSnapshotStore(dir).write(foreign);

		const listed = orch.listLiveTasks("/live/workspace");
		const byId = new Map(listed.map((task) => [task.taskId, task]));
		assert.equal(byId.get("T-20260908-mem18")?.source, "memory", "in-memory live Task listed");
		assert.equal(byId.has("T-20260908-done18"), false, "completed Tasks are not live");
		const ledgerTask = byId.get("T-20260908-live18");
		assert.equal(ledgerTask?.source, "ledger", "the cap-orphaned live Task lists from the ledger");
		assert.equal(ledgerTask?.recoveryRequired, true, "blocked + recovery.required is flagged");
		assert.equal(ledgerTask?.objective, "blocked ledger-only task");
		assert.equal(byId.has("T-20260908-far18"), false, "another workspace's live Task is not listed");
		assert.equal(orch.store.get("T-20260908-live18"), undefined, "listing never restores into the store");
		assert.deepEqual(orch.listLiveTasks("/nowhere"), [], "empty workspace lists nothing");
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

{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-wrc-cap-hold-"));
	try {
		const ledger = new LedgerSnapshotStore(dir);
		const { MAX_LEDGER_RESTORE_PER_SESSION } = await import("./types.ts");
		const held = spentTaskRecord("T-20260908-hcap", 0.01, 0.05);
		held.state = "blocked";
		held.updatedAt = "2026-09-01T00:00:00.000Z";
		held.writerHold = { executionId: "call-cap-held", reason: "stop unconfirmed", since: "2026-09-01T00:00:00.000Z" };
		held.executions.push({
			executionId: "call-cap-held",
			taskId: held.taskId,
			kind: "worker",
			cwd: held.cwd,
			worktreeRoots: [held.cwd],
			aRun: { cwd: held.cwd, taskId: held.taskId, workerRunId: "call-cap-held" },
			status: "stop_unconfirmed",
			endedReason: "operator_cancel",
		});
		ledger.write(held);
		for (let i = 0; i < MAX_LEDGER_RESTORE_PER_SESSION + 3; i += 1) {
			const task = spentTaskRecord(`T-20260908-hc${String(i).padStart(3, "0")}`, 0.01, 0.05);
			task.updatedAt = new Date(Date.UTC(2026, 8, 8, 0, 0, i)).toISOString();
			ledger.write(task);
		}
		const concurrency = new ConcurrencyController();
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir, concurrency });
		const result = orch.restoreFromLedger();
		assert.equal(result.restored, MAX_LEDGER_RESTORE_PER_SESSION + 1);
		assert.ok(orch.store.get(held.taskId));
		assert.ok(concurrency.status().reservations.some((reservation) => reservation.id === "writerhold:call-cap-held"));
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

// --------------------------------------------------------------------------
// WRC P0-A — a persisted writerHold survives restore: the workspace keeps
// refusing a second writer (the lost in-memory reservation is never trusted).
// --------------------------------------------------------------------------
{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-wrc-hold-"));
	try {
		const held = spentTaskRecord("T-20260916-h01", 0.01, 0.05);
		held.state = "blocked";
		held.writerHold = {
			executionId: "call-held",
			reason: "cancel grace expired without a terminal; writer stop unconfirmed",
			since: "2026-09-16T00:00:00.000Z",
		};
		held.executions.push({
			executionId: "call-held",
			taskId: held.taskId,
			kind: "worker",
			cwd: held.cwd,
			worktreeRoots: [held.cwd],
			aRun: { cwd: held.cwd, taskId: held.taskId, workerRunId: "call-held" },
			status: "stop_unconfirmed",
			endedReason: "operator_cancel",
		});
		new LedgerSnapshotStore(dir).write(held);
		const concurrency = new ConcurrencyController();
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir, concurrency });
		const result = orch.restoreFromLedger();
		assert.equal(result.restored, 1);
		assert.ok(
			concurrency.status().reservations.some((r) => r.id === "writerhold:call-held"),
			"the persisted hold is re-registered on restore",
		);
		const admission = concurrency.reserve({
			id: "call-second",
			role: "worker",
			capability: "writer",
			workspaces: [held.cwd],
		});
		assert.equal(admission.refusal?.code, "WORKSPACE_CONFLICT", "a second writer is refused after restart");
		const status = orch.renderTaskStatus(orch.store.require(held.taskId));
		assert.match(status, /Writer hold: kept/);
		assert.match(status, /call-held: stop_unconfirmed \(operator_cancel\)/);
		assert.equal(orch.resolveWriterHold(held.taskId).writerHold, undefined);
		assert.equal(concurrency.status().reservations.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// P0-A — a host that died mid-stop (execution stuck in cancel_requested,
// no confirmation) gets a synthesized hold on restore, same as a persisted one.
{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-wrc-inflight-"));
	try {
		const inflight = spentTaskRecord("T-20260916-h03", 0.01, 0.05);
		inflight.state = "executing";
		inflight.executions.push({
			executionId: "call-inflight",
			taskId: inflight.taskId,
			kind: "worker",
			cwd: inflight.cwd,
			worktreeRoots: [inflight.cwd],
			aRun: { cwd: inflight.cwd, taskId: inflight.taskId, workerRunId: "call-inflight" },
			status: "cancel_requested",
			cancelRequestedAt: "2026-09-16T00:00:01.000Z",
		});
		new LedgerSnapshotStore(dir).write(inflight);
		const concurrency = new ConcurrencyController();
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir, concurrency });
		assert.equal(orch.restoreFromLedger().restored, 1);
		const record = orch.store.require(inflight.taskId);
		assert.equal(record.writerHold?.executionId, "call-inflight", "in-flight stop synthesizes a persisted hold");
		assert.ok(
			concurrency.status().reservations.some((r) => r.id === "writerhold:call-inflight"),
			"the synthesized hold is registered too",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// P0-A — a pre-P0-A ledger record (no execution status fields) restores and
// renders untouched: absent status is unknown, never "stopped".
{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-wrc-legacy-"));
	try {
		const legacy = spentTaskRecord("T-20260916-h02", 0.01, 0.05);
		new LedgerSnapshotStore(dir).write(legacy);
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		assert.equal(orch.restoreFromLedger().restored, 1);
		const status = orch.renderTaskStatus(orch.store.require(legacy.taskId));
		assert.equal(status.includes("Writer hold"), false, "no hold line without a hold");
		assert.equal(status.includes("stop_unconfirmed"), false, "legacy executions are not upgraded to a stop state");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// --------------------------------------------------------------------------
// Issue 01 Acceptance Tests: Live writable Delegations hold the worktree lock
// --------------------------------------------------------------------------

// 1. Two Validators (or a Validator beside a Worker) on one worktree: the second
// begin is refused before launch; no second child is registered.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const spec1 = specFor("T-20260905-v01", "validator", "/fixture/wt-val");
	const first = await orch.beginDelegation({ toolCallId: "call-v1", input: { agent: "oracle", task: JSON.stringify(spec1) } }, "/fixture/wt-val");
	assert.equal(first.conflict, undefined);
	assert.equal(orch.pendingDelegationCount(), 1);

	// Second validator on same worktree: refused before launch; no second child registered
	const spec2 = specFor("T-20260905-v02", "validator", "/fixture/wt-val");
	const second = await orch.beginDelegation({ toolCallId: "call-v2", input: { agent: "oracle", task: JSON.stringify(spec2) } }, "/fixture/wt-val");
	assert.equal(second.conflict?.conflict, true, "two validators on one worktree must conflict");
	assert.equal(orch.pendingDelegationCount(), 1, "no second child registered");

	// Validator beside a Worker on another worktree: second begin refused
	const specW = specFor("T-20260905-w01", "worker", "/fixture/wt-mixed");
	const worker = await orch.beginDelegation({ toolCallId: "call-w1", input: { task: JSON.stringify(specW) } }, "/fixture/wt-mixed");
	assert.equal(worker.conflict, undefined);
	assert.equal(orch.pendingDelegationCount(), 2);

	const specV3 = specFor("T-20260905-v03", "validator", "/fixture/wt-mixed");
	const validatorMixed = await orch.beginDelegation({ toolCallId: "call-v3", input: { agent: "oracle", task: JSON.stringify(specV3) } }, "/fixture/wt-mixed");
	assert.equal(validatorMixed.conflict?.conflict, true, "validator beside worker must conflict");
	assert.equal(orch.pendingDelegationCount(), 2, "no second child registered");
}

// 2. A Worker begin while the Task is reviewing and a writable Delegation is still
// pending is refused; a Worker begin while reviewing and only a Reviewer is live is allowed.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-rw01";
	await delegateWorker(orch, "call-rw-1", taskId);
	await orch.handleSubagentResult(workerResult("call-rw-1", reportFor(taskId, "call-rw-1")));
	assert.equal(orch.store.require(taskId).state, "reviewing");

	// Start a second worker delegation that goes async and stays pending (waiter)
	await orch.beginDelegation(
		{ toolCallId: "call-rw-2", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	await orch.handleSubagentResult(receiptFor("call-rw-2", "run-rw-2", "/no-such-async-dir"));
	assert.equal(orch.pendingDelegationCount(), 1);

	// While Task is reviewing and writable Delegation is still pending, Worker begin is refused
	const refusedWorker = await orch.beginDelegation(
		{ toolCallId: "call-rw-3", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.equal(refusedWorker.conflict?.conflict, true, "Worker begin while reviewing with writable pending must be refused");
	assert.equal(orch.pendingDelegationCount(), 1);

	// Now for another task: Task is reviewing and ONLY a Reviewer is live
	const taskId2 = "T-20260905-rw02";
	await delegateWorker(orch, "call-rw-4", taskId2);
	await orch.handleSubagentResult(workerResult("call-rw-4", reportFor(taskId2, "call-rw-4")));
	assert.equal(orch.store.require(taskId2).state, "reviewing");

	// Start a Reviewer delegation
	const revBegin = await orch.beginDelegation(
		{ toolCallId: "call-rw-rev", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId2, "reviewer")) } },
		BASE,
	);
	assert.equal(revBegin.conflict, undefined);
	assert.equal(orch.pendingDelegationCount(), 2); // call-rw-2 (on taskId) + call-rw-rev (on taskId2)

	// Worker begin on taskId2 while only Reviewer is live is allowed!
	const allowedWorker = await orch.beginDelegation(
		{ toolCallId: "call-rw-5", input: { task: JSON.stringify(specFor(taskId2)) } },
		BASE,
	);
	assert.equal(allowedWorker.conflict, undefined, "Worker begin while reviewing with only Reviewer live must be allowed");
}

// 3. Warn-mode unstructured Worker and same-Task second writable call contend for
// the same lock; relative-path and symlink aliases of one worktree share it.
{
	const real = mkdtempSync(join(process.cwd(), ".planner-only-wlock-"));
	const aliasParent = mkdtempSync(join(process.cwd(), ".planner-only-wlock-"));
	const alias = join(aliasParent, "wt");
	symlinkSync(real, alias);
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore(), structuredDelegationMode: "warn" });
	try {
		setCleanTree();
		// Warn-mode unstructured worker takes the write lock
		const first = await orch.beginDelegation(
			{ toolCallId: "call-wl-1", input: { agent: "worker", task: "unstructured prompt", cwd: real } },
			real,
		);
		assert.ok(first.task);
		assert.equal(first.task.state, "executing");
		assert.equal(first.conflict, undefined);

		// Second writable call on symlink alias of the same worktree contends and is refused
		const second = await orch.beginDelegation(
			{ toolCallId: "call-wl-2", input: { task: JSON.stringify(specFor("T-20260905-971", "worker", alias)) } },
			alias,
		);
		assert.equal(second.conflict?.conflict, true, "symlink alias of locked worktree must conflict");
		assert.match(second.conflict.reason, new RegExp(first.task.taskId));
		assert.equal(orch.pendingDelegationCount(), 1, "loser registers no delegation");

		// Second writable call on same Task also contends
		const sameTaskSecond = await orch.beginDelegation(
			{ toolCallId: "call-wl-3", input: { task: JSON.stringify(specFor(first.task.taskId, "worker", real)) } },
			real,
		);
		assert.equal(sameTaskSecond.conflict?.conflict, true, "same-Task second writable call contends for the lock");
		assert.equal(orch.pendingDelegationCount(), 1);
	} finally {
		rmSync(real, { recursive: true, force: true });
		rmSync(aliasParent, { recursive: true, force: true });
	}
}

// 4. Lost-notify Worker still executing with terminal artifacts: next same-Task begin
// consumes the finished run, then starts. Without terminal artifacts, the next
// writable begin is refused; blocked remains allowed.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-rec1";
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-rec-1", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	const runId = "run-rec-1";
	const layout = artifactLayout(runId, "worker", 0, reportFor(taskId, "call-rec-1"));
	await orch.handleSubagentResult(receiptFor("call-rec-1", runId, layout.asyncDir));
	assert.equal(orch.pendingDelegationCount(), 1);

	// Next same-Task begin consumes the finished run from artifacts, then starts
	setCleanTree();
	const nextBegin = await orch.beginDelegation(
		{ toolCallId: "call-rec-2", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.equal(nextBegin.conflict, undefined, "finished run was consumed; lock was freed for next begin");
	assert.ok(orch.store.require(taskId).reports.length >= 1, "report from finished run was recorded");
	assert.equal(orch.pendingDelegationCount(), 1, "new waiter registered");
	rmSync(layout.tmp, { recursive: true, force: true });

	// Without terminal artifacts: next writable begin is refused, blocked remains allowed
	const taskId2 = "T-20260905-rec2";
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-rec-3", input: { task: JSON.stringify(specFor(taskId2)) } },
		BASE,
	);
	await orch.handleSubagentResult(receiptFor("call-rec-3", "run-no-art", "/no-such-async-dir"));
	assert.equal(orch.pendingDelegationCount(), 2);

	const refusedBegin = await orch.beginDelegation(
		{ toolCallId: "call-rec-4", input: { task: JSON.stringify(specFor(taskId2)) } },
		BASE,
	);
	assert.equal(refusedBegin.conflict?.conflict, true, "without terminal artifacts next writable begin is refused");
	// user story 23: pass and request_changes keep waiting on a truly live pending child
	assert.equal(orch.rootVerdictRefusal(orch.store.require(taskId2), "pass")?.kind, "child-pending");
	assert.equal(orch.rootVerdictRefusal(orch.store.require(taskId2), "request_changes")?.kind, "child-pending");
	// user story 22: blocked remains allowed as escape hatch
	assert.equal(orch.rootVerdictRefusal(orch.store.require(taskId2), "blocked"), undefined, "blocked remains allowed");
	const blockedOutcome = await orch.recordRootVerdict(orch.store.require(taskId2), "blocked", "escape hatch while child pending");
	assert.ok(blockedOutcome.decision);
	assert.equal(orch.store.require(taskId2).state, "blocked");
}

// 5. A leftover waiter with no live child is superseded so a later notice matches
// one waiter; a late notice for the superseded run records nothing. A leftover
// whose child is not known stopped is not superseded into a second live writer.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-sup1";
	await delegateWorker(orch, "call-s1", taskId);
	await orch.handleSubagentResult(workerResult("call-s1", reportFor(taskId, "call-s1")));

	// First re-delegation goes async; notice lost, child not known stopped
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-s2", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	await orch.handleSubagentResult(receiptFor("call-s2", "run-s2-zombie", "/no-such-async-dir"));
	assert.equal(orch.pendingDelegationCount(), 1);

	// Child is NOT known stopped: next re-delegation is refused, NOT superseded into a second live writer
	const redoBlocked = await orch.beginDelegation(
		{ toolCallId: "call-s3", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.equal(redoBlocked.conflict?.conflict, true, "waiter whose child is not known stopped keeps lock and refuses");
	assert.equal(orch.pendingDelegationCount(), 1, "no second waiter registered");
	assert.ok(orch.getDelegation("call-s2"), "leftover waiter kept");

	// Operator abandons task: known stop
	orch.store.abandon(taskId, "operator abandon");

	// Now re-delegation supersedes leftover waiter with no live child
	const redo = await orch.beginDelegation(
		{ toolCallId: "call-s4", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	assert.equal(redo.conflict, undefined);
	assert.ok((redo.warnings ?? []).some((w) => /supersedes the pending child run/.test(w)));
	assert.equal(orch.pendingDelegationCount(), 1, "one waiter remains");
	assert.equal(orch.getDelegation("call-s2"), undefined, "s2 superseded");

	// Late notice for superseded run records nothing
	const beforeReports = orch.store.require(taskId).reports.length;
	const beforeState = orch.store.require(taskId).state;
	const late = await orch.handleAsyncNotify(asyncNotify("run-s2-zombie", JSON.stringify(reportFor(taskId, "call-s2"))));
	assert.equal(late, undefined);
	assert.equal(orch.store.require(taskId).reports.length, beforeReports);
	assert.equal(orch.store.require(taskId).state, beforeState);

	// Single-run completion notice for s4 matches remaining waiter
	setDirtyTree();
	await orch.handleSubagentResult(receiptFor("call-s4", "run-s4", "/no-such-async-dir"));
	const outcome = await orch.handleAsyncNotify(asyncNotify(undefined, JSON.stringify(reportFor(taskId, "call-s4"))));
	assert.match(outcome.content[0].text, /\[PLANNER-ONLY REVIEW STATE\]/);
	assert.equal(orch.store.require(taskId).reports.length, beforeReports + 1);
	assert.equal(orch.pendingDelegationCount(), 0);
}

// 6. Confirmed never-started unlocks; timeout, cancel, and unreadable output do not.
// Unlock after confirmed exit is idempotent. Stale-holder needs-reconcile text goes
// through the Task store, not an in-place field write.
{
	let clock = new Date(2026, 8, 5, 12, 0, 0);
	const store = new TaskStore({ now: () => clock });
	const orch = new PlannerOrchestrator({ gitRunner, store });

	// Confirmed never-started unlocks
	const taskId0 = "T-20260905-unl0";
	setCleanTree();
	await orch.beginDelegation({ toolCallId: "call-unl-fail", input: { task: JSON.stringify(specFor(taskId0)) } }, BASE);
	assert.equal(orch.pendingDelegationCount(), 1);
	// Error with no runId/receipt: confirmed start failure -> unlocks
	await orch.handleSubagentResult({
		toolCallId: "call-unl-fail",
		toolName: "subagent",
		isError: true,
		content: [{ type: "text", text: "launch failed before start" }],
	});
	assert.equal(orch.pendingDelegationCount(), 0, "confirmed never-started unlocks");

	// Timeout does NOT unlock; stale-holder needs-reconcile recorded through store
	const taskId = "T-20260905-unl1";
	setCleanTree();
	await orch.beginDelegation({ toolCallId: "call-unl-1", input: { task: JSON.stringify(specFor(taskId)) } }, BASE);
	clock = new Date(2026, 8, 5, 13, 0, 0); // 1 hour later
	assert.equal(isExecutingStale(orch.store.require(taskId), clock.getTime()), true);

	const second = await orch.beginDelegation({ toolCallId: "call-unl-2", input: { task: JSON.stringify(specFor("T-20260905-unl2", "worker", "/fixture/T-20260905-unl1")) } }, BASE);
	assert.equal(second.conflict?.conflict, true, "timeout does not unlock");
	assert.match(second.conflict.reason, /not been confirmed exited/);
	assert.match(orch.store.require(taskId).stateReason ?? "", /needs reconcile.*past the stale duration/, "stale holder needs-reconcile recorded through Task store");

	// Cancel/error on live async child does NOT unlock
	const taskId3 = "T-20260905-unl3";
	await delegateWorker(orch, "call-unl-3", taskId3);
	await orch.handleSubagentResult(receiptFor("call-unl-3", "run-unl-3", "/no-async-dir"));
	const cancelRes = await orch.handleSubagentResult({
		toolCallId: "call-unl-3",
		toolName: "subagent",
		isError: true,
		content: [{ type: "text", text: "cancel signal received" }],
	});
	assert.match(cancelRes.content[0].text, /not been confirmed stopped/);
	assert.equal(orch.pendingDelegationCount(), 2, "cancel on async child does not unlock");

	// Idempotent unlock: completion then late error/cancel is a no-op
	const taskId4 = "T-20260905-unl4";
	await delegateWorker(orch, "call-unl-4", taskId4);
	await orch.handleSubagentResult(workerResult("call-unl-4", reportFor(taskId4, "call-unl-4")));
	const lateErr = await orch.handleSubagentResult({
		toolCallId: "call-unl-4",
		toolName: "subagent",
		isError: true,
		content: [{ type: "text", text: "late error after completion" }],
	});
	assert.equal(lateErr, undefined, "late event on consumed delegation is no-op");
}

// --------------------------------------------------------------------------
// Hardening-gaps Ticket 02 — Reviewer PASS is snapshot-bound; truncated packets cannot complete
// --------------------------------------------------------------------------

{
	const scratchBase = join(process.cwd(), ".scratch");
	mkdirSync(scratchBase, { recursive: true });

	function setupRealGitRepo(prefix) {
		const dir = mkdtempSync(join(scratchBase, `test-git-02-${prefix}-`));
		const run = (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
		run(["init", "-q"]);
		run(["config", "user.name", "Test Runner"]);
		run(["config", "user.email", "test@example.com"]);
		run(["config", "commit.gpgSign", "false"]);
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "src", "parser.ts"), "export const x = 1;\n");
		run(["add", "."]);
		run(["commit", "-m", "init", "-q"]);
		const head = run(["rev-parse", "HEAD"]).trim();
		const runner = async (args) => {
			try {
				const stdout = execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
				return { stdout, stderr: "", code: 0 };
			} catch (err) {
				return { stdout: err.stdout?.toString() ?? "", stderr: err.stderr?.toString() ?? "", code: err.status ?? 1 };
			}
		};
		return { dir, runner, head };
	}

	function realWorkerReport(taskId, toolCallId, dir, head) {
		return {
			version: 1,
			taskId,
			status: "completed",
			summary: "Implemented parser change.",
			changedFiles: ["src/parser.ts"],
			validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "tests passed" }],
			evidence: {
				cwd: dir,
				taskId,
				workerRunId: toolCallId,
				baseGitRef: head,
				finalGitRef: head,
				gitStatusHash: cleanHash,
				changedPaths: ["src/parser.ts"],
				gitAvailable: true,
				generatedAt: new Date().toISOString(),
			},
			risks: [],
			unresolved: [],
		};
	}

	// 1. Reviewer PASS omitting reportRevision or workspaceDigest, or with HEAD/status fallback digest, does NOT complete Task
	{
		const { dir, runner, head } = setupRealGitRepo("r01");
		try {
			const store = pinnedStore();
			const orch = new PlannerOrchestrator({ gitRunner: runner, store });
			const taskId = "T-20260905-r01";

			// Worker delegates and completes, binding snapshot
			await orch.beginDelegation(
				{ toolCallId: "call-w1", input: { task: JSON.stringify(specFor(taskId, "worker", dir)) } },
				dir,
			);
			await orch.handleSubagentResult(workerResult("call-w1", realWorkerReport(taskId, "call-w1", dir, head)));
			const taskAfterWorker = orch.store.require(taskId);
			assert.equal(taskAfterWorker.state, "reviewing");
			assert.ok(taskAfterWorker.snapshot?.digest, "snapshot must be bound after worker report");
			const boundDigest = taskAfterWorker.snapshot.digest;

			// (a) Reviewer PASS omits reportRevision -> refused, Task state unchanged
			await orch.beginDelegation({ toolCallId: "call-r1", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer", dir)) } }, dir);
			const res1 = await orch.handleSubagentResult(reviewerResult("call-r1", taskId, "pass", { reportRevision: undefined, workspaceDigest: boundDigest }));
			assert.match(res1.content[0].text, /rejected/i, "PASS without reportRevision must be rejected");
			assert.equal(orch.store.require(taskId).state, "reviewing");
			assert.equal(orch.store.require(taskId).reviews.length, 0);

			// (b) Reviewer PASS omits workspaceDigest -> refused, Task state unchanged
			await orch.beginDelegation({ toolCallId: "call-r2", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer", dir)) } }, dir);
			const res2 = await orch.handleSubagentResult(reviewerResult("call-r2", taskId, "pass", { reportRevision: 1, workspaceDigest: undefined }));
			assert.match(res2.content[0].text, /rejected/i, "PASS without workspaceDigest must be rejected");
			assert.equal(orch.store.require(taskId).state, "reviewing");
			assert.equal(orch.store.require(taskId).reviews.length, 0);

			// (c) Reviewer PASS with HEAD/status fallback digest (e.g. cleanHash or head) -> refused, Task state unchanged
			await orch.beginDelegation({ toolCallId: "call-r3", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer", dir)) } }, dir);
			const res3 = await orch.handleSubagentResult(reviewerResult("call-r3", taskId, "pass", { reportRevision: 1, workspaceDigest: cleanHash }));
			assert.match(res3.content[0].text, /rejected/i, "PASS with HEAD/status fallback digest must be rejected");
			assert.equal(orch.store.require(taskId).state, "reviewing");
			assert.equal(orch.store.require(taskId).reviews.length, 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	// 2. Pre-snapshot report cannot complete via Reviewer PASS or via Root planner_verdict
	{
		const { dir, runner, head } = setupRealGitRepo("r02");
		try {
			const store = pinnedStore();
			const orch = new PlannerOrchestrator({ gitRunner: runner, store });
			const taskId = "T-20260905-r02";
			const task = store.create(createTaskSpec(specFor(taskId, "worker", dir), taskId));
			store.transition(taskId, "executing");
			// Record report manually without binding snapshot (pre-snapshot report)
			store.recordReport(taskId, realWorkerReport(taskId, "call-w-presnap", dir, head));
			store.transition(taskId, "reviewing");
			assert.equal(store.require(taskId).snapshot, undefined, "no snapshot bound");

			// Reviewer PASS cannot complete pre-snapshot report
			await orch.beginDelegation({ toolCallId: "call-r-presnap", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer", dir)) } }, dir);
			const res = await orch.handleSubagentResult(reviewerResult("call-r-presnap", taskId, "pass", { reportRevision: 1, workspaceDigest: "any-digest" }));
			assert.match(res.content[0].text, /rejected.*pre-snapshot/i, "reviewer PASS on pre-snapshot report must be rejected");
			assert.equal(orch.store.require(taskId).state, "reviewing");
			assert.equal(orch.store.require(taskId).reviews.length, 0);

			// Root planner_verdict cannot complete pre-snapshot report
			const rootOutcome = await orch.recordRootVerdict(orch.store.require(taskId), "pass", "Root accept");
			assert.notEqual(rootOutcome.task.state, "completed", "Root planner_verdict must not complete pre-snapshot report");
			assert.notEqual(rootOutcome.decision.action, "accept");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	// 3. Reviewer PASS with packetTruncated or omitted patch paths is refused; request_changes and blocked still record
	{
		const { dir, runner, head } = setupRealGitRepo("r03");
		try {
			const store = pinnedStore();
			const orch = new PlannerOrchestrator({ gitRunner: runner, store });
			const taskId = "T-20260905-r03";

			// Worker completes, snapshot bound
			await orch.beginDelegation({ toolCallId: "call-w3", input: { task: JSON.stringify(specFor(taskId, "worker", dir)) } }, dir);
			await orch.handleSubagentResult(workerResult("call-w3", realWorkerReport(taskId, "call-w3", dir, head)));
			const boundDigest = orch.store.require(taskId).snapshot.digest;

			// (a) Truncated packet PASS is refused; Task state unchanged
			await orch.beginDelegation({
				toolCallId: "call-r-trunc-pass",
				input: { agent: "reviewer", packetTruncated: true, task: JSON.stringify(specFor(taskId, "reviewer", dir)) },
			}, dir);
			const passRes = await orch.handleSubagentResult(reviewerResult("call-r-trunc-pass", taskId, "pass", { reportRevision: 1, workspaceDigest: boundDigest }));
			assert.match(passRes.content[0].text, /rejected.*truncated/i, "truncated packet PASS must be rejected");
			assert.equal(orch.store.require(taskId).state, "reviewing");
			assert.equal(orch.store.require(taskId).reviews.length, 0);

			// (b) Truncated packet with request_changes still records and transitions state
			await orch.beginDelegation({
				toolCallId: "call-r-trunc-rc",
				input: { agent: "reviewer", packetTruncated: true, task: JSON.stringify(specFor(taskId, "reviewer", dir)) },
			}, dir);
			const rcRes = await orch.handleSubagentResult(reviewerResult("call-r-trunc-rc", taskId, "request_changes", { reportRevision: 1, workspaceDigest: boundDigest }));
			assert.match(rcRes.content[0].text, /request_changes/, "request_changes still recorded");
			assert.equal(orch.store.require(taskId).state, "changes_requested");
			assert.equal(orch.store.require(taskId).reviews.length, 1);

			// Transition back to reviewing to test blocked
			orch.store.transition(taskId, "executing");
			orch.store.transition(taskId, "reviewing");

			// (c) Truncated packet with blocked still records and transitions state
			await orch.beginDelegation({
				toolCallId: "call-r-trunc-blk",
				input: { agent: "reviewer", packetTruncated: true, task: JSON.stringify(specFor(taskId, "reviewer", dir)) },
			}, dir);
			const blkRes = await orch.handleSubagentResult(reviewerResult("call-r-trunc-blk", taskId, "blocked", { reportRevision: 1, workspaceDigest: boundDigest }));
			assert.match(blkRes.content[0].text, /blocked/, "blocked still recorded");
			assert.equal(orch.store.require(taskId).state, "blocked");
			assert.equal(orch.store.require(taskId).reviews.length, 2);

			// (d) ReviewRequest with patchOmittedPaths in evidencePacket -> PASS refused
			orch.store.transition(taskId, "reviewing");
			await orch.beginDelegation({
				toolCallId: "call-r-trunc-omitted",
				input: {
					agent: "reviewer",
					task: JSON.stringify({
						...specFor(taskId, "reviewer", dir),
						evidencePacket: { patchOmittedPaths: ["src/big.ts"] },
					}),
				},
			}, dir);
			const omittedRes = await orch.handleSubagentResult(reviewerResult("call-r-trunc-omitted", taskId, "pass", { reportRevision: 1, workspaceDigest: boundDigest }));
			assert.match(omittedRes.content[0].text, /rejected.*truncated/i, "packet with patchOmittedPaths must reject PASS");
			assert.equal(orch.store.require(taskId).state, "reviewing");
			assert.equal(orch.store.require(taskId).reviews.length, 2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	// 4. Reviewer evidenceFresh flag cannot override snapshot comparison; workspace drift refuses PASS
	{
		const { dir, runner, head } = setupRealGitRepo("r04");
		try {
			const store = pinnedStore();
			const orch = new PlannerOrchestrator({ gitRunner: runner, store });
			const taskId = "T-20260905-r04";

			await orch.beginDelegation({ toolCallId: "call-w4", input: { task: JSON.stringify(specFor(taskId, "worker", dir)) } }, dir);
			await orch.handleSubagentResult(workerResult("call-w4", realWorkerReport(taskId, "call-w4", dir, head)));
			const boundDigest = orch.store.require(taskId).snapshot.digest;

			// Drift the workspace by modifying a file in scope
			writeFileSync(join(dir, "src", "parser.ts"), "export const x = 999; // drift\n");

			// (b) Reviewer returns PASS when snapshot sampling is unknown at accept time -> refused!
			// Chmod 000 on in-scope file makes samplingPass fail with unreadable path
			chmodSync(join(dir, "src", "parser.ts"), 0);
			await orch.beginDelegation({ toolCallId: "call-r-unknown", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer", dir)) } }, dir);
			const unknownRes = await orch.handleSubagentResult(reviewerResult("call-r-unknown", taskId, "pass", {
				reportRevision: 1,
				workspaceDigest: boundDigest,
				evidenceFresh: true,
			}));
			assert.match(unknownRes.content[0].text, /rejected.*workspace snapshot/i, "unknown snapshot must reject PASS");
			assert.equal(orch.store.require(taskId).state, "reviewing");
			assert.equal(orch.store.require(taskId).reviews.length, 0);
			chmodSync(join(dir, "src", "parser.ts"), 0o644);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	// 5. Matching snapshot digest plus matching report revision completes via Reviewer PASS (happy path)
	{
		const { dir, runner, head } = setupRealGitRepo("r05");
		try {
			const store = pinnedStore();
			const orch = new PlannerOrchestrator({ gitRunner: runner, store });
			const taskId = "T-20260905-r05";

			await orch.beginDelegation({ toolCallId: "call-w5", input: { task: JSON.stringify(specFor(taskId, "worker", dir)) } }, dir);
			writeFileSync(join(dir, "src", "parser.ts"), "export const x = 2;\n");
			await orch.handleSubagentResult(workerResult("call-w5", realWorkerReport(taskId, "call-w5", dir, head)));
			const boundDigest = orch.store.require(taskId).snapshot.digest;

			// Workspace unchanged; Reviewer returns matching PASS
			await orch.beginDelegation({ toolCallId: "call-r-happy", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer", dir)) } }, dir);
			const passRes = await orch.handleSubagentResult(reviewerResult("call-r-happy", taskId, "pass", {
				reportRevision: 1,
				workspaceDigest: boundDigest,
				evidenceFresh: true,
			}));
			assert.match(passRes.content[0].text, /verdict for task T-20260905-r05: pass.*Action: accept/i);
			assert.equal(orch.store.require(taskId).state, "completed");
			assert.equal(orch.store.require(taskId).reviews.length, 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	// 6. Root planner_verdict with matching snapshot still completes (no regression of ticket 10)
	{
		const { dir, runner, head } = setupRealGitRepo("r06");
		try {
			const store = pinnedStore();
			const orch = new PlannerOrchestrator({ gitRunner: runner, store });
			const taskId = "T-20260905-r06";

			await orch.beginDelegation({ toolCallId: "call-w6", input: { task: JSON.stringify(specFor(taskId, "worker", dir)) } }, dir);
			const aSample = await captureEvidence(runner, { cwd: dir, taskId, workerRunId: "call-w6" });
			orch.store.beginExecution(taskId, {
				executionId: "call-w6",
				kind: "worker",
				cwd: dir,
				worktreeRoots: [dir],
				aRun: aSample,
			});
			writeFileSync(join(dir, "src", "parser.ts"), "export const x = 2;\n");
			const cSample = await captureEvidence(runner, { cwd: dir, taskId, workerRunId: "call-w6", baseGitRef: head });
			await orch.handleSubagentResult(workerResult("call-w6", realWorkerReport(taskId, "call-w6", dir, head)));
			orch.store.completeExecution(taskId, "call-w6", {
				status: "completed",
				endedReason: "normal",
				endedAt: new Date().toISOString(),
				cReport: cSample,
				reportIndex: 0,
				truthPaths: ["src/parser.ts"],
			});
			assert.equal(orch.store.require(taskId).state, "reviewing");

			// Root verdict with matching snapshot
			const outcome = await orch.recordRootVerdict(orch.store.require(taskId), "pass", "Root acceptance check passed");
			assert.equal(outcome.decision.action, "accept");
			assert.equal(outcome.task.state, "completed");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}

// ============================================================================
// Ticket 02 — restore: a recorded restricted reader never synthesizes a
// writer hold; an execution missing capability metadata stays conservative.
// ============================================================================
{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-restore-reader-"));
	try {
		const ledger = new LedgerSnapshotStore(dir);
		const reader = spentTaskRecord("T-20260908-rdr", 0.01, 0.05);
		reader.state = "blocked";
		reader.cwd = dir;
		reader.executions.push({
			executionId: "call-rdr",
			taskId: reader.taskId,
			kind: "explorer",
			cwd: dir,
			worktreeRoots: [dir],
			aRun: { cwd: dir, taskId: reader.taskId, workerRunId: "call-rdr" },
			status: "stop_unconfirmed",
			endedReason: "operator_cancel",
			readOnly: true,
			capability: "restricted-reader",
			capabilityBasis: "bound at launch",
		});
		const writer = spentTaskRecord("T-20260908-wtr", 0.01, 0.05);
		writer.state = "blocked";
		writer.cwd = dir;
		writer.executions.push({
			executionId: "call-wtr",
			taskId: writer.taskId,
			kind: "worker",
			cwd: dir,
			worktreeRoots: [dir],
			aRun: { cwd: dir, taskId: writer.taskId, workerRunId: "call-wtr" },
			status: "stop_unconfirmed",
			endedReason: "operator_cancel",
		});
		// A pre-T02 explorer record (no capability field) stays conservative.
		const legacyReader = spentTaskRecord("T-20260908-lrd", 0.01, 0.05);
		legacyReader.state = "blocked";
		legacyReader.cwd = dir;
		legacyReader.executions.push({
			executionId: "call-lrd",
			taskId: legacyReader.taskId,
			kind: "explorer",
			cwd: dir,
			worktreeRoots: [dir],
			aRun: { cwd: dir, taskId: legacyReader.taskId, workerRunId: "call-lrd" },
			status: "stop_unconfirmed",
			endedReason: "operator_cancel",
			readOnly: true,
		});
		ledger.write(reader);
		ledger.write(writer);
		ledger.write(legacyReader);
		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const result = orch.restoreFromLedger();
		assert.equal(result.restored, 3);
		assert.equal(orch.store.get(reader.taskId).writerHold, undefined, "no hold synthesized for a restricted reader");
		assert.ok(orch.store.get(writer.taskId).writerHold, "writer stop_unconfirmed still synthesizes the hold");
		assert.ok(orch.store.get(legacyReader.taskId).writerHold, "missing capability is conservative — hold synthesized");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ============================================================================
// Ticket 06 — read-only task diagnostics: canonical ids, lifecycle truth,
// and no side effects (no mint, no restore, no launch).
// ============================================================================
{
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const task = store.create(createTaskSpec({
		taskId: "T-20260908-dg1",
		objective: "where did the logs go",
		cwd: "/fixture/diag",
		role: "explorer",
		acceptanceMode: "observation",
		validation: { required: false },
	}));
	store.beginExecution(task.taskId, {
		executionId: "call-dg1",
		kind: "explorer",
		cwd: "/fixture/diag",
		worktreeRoots: ["/fixture/diag"],
		aRun: {
			cwd: "/fixture/diag",
			taskId: task.taskId,
			workerRunId: "call-dg1",
			gitAvailable: false,
			probeFailures: [{ operation: "rev-parse --git-dir", kind: "not-a-git-repository", cwd: "/fixture/diag", exitCode: 128, error: "fatal: not a git repository" }],
		},
		capability: "restricted-reader",
		capabilityBasis: "test",
		readOnly: true,
	});
	store.finalizeExecution(task.taskId, "call-dg1", {
		status: "stop_unconfirmed",
		endedReason: "operator_cancel",
		endedAt: "2026-09-05T00:00:00.000Z",
		terminationConfirmed: false,
		unacceptedReport: {
			version: 1,
			taskId: task.taskId,
			status: "completed",
			summary: "logs are under /var/log/x",
			changedFiles: [],
			validation: [],
			evidence: { cwd: "/fixture/diag", taskId: task.taskId, workerRunId: "run-dg1" },
			risks: [],
			unresolved: [],
		},
		unacceptedReportReason: "delegation ended cancelled; report not admitted",
	});
	store.transition(task.taskId, "blocked");

	const before = structuredClone(store.require(task.taskId));
	const result = orch.describeTaskDiagnostics("/fixture/diag", task.taskId);
	assert.ok("diagnostics" in result);
	const d = result.diagnostics;
	assert.equal(d.taskId, task.taskId);
	assert.equal(d.state, "blocked");
	assert.equal(d.acceptanceMode, "observation");
	assert.equal(d.source, "memory");
	assert.equal(d.executions.length, 1);
	const execution = d.executions[0];
	assert.equal(execution.executionId, "call-dg1");
	assert.equal(execution.status, "stop_unconfirmed");
	assert.equal(execution.capability, "restricted-reader");
	assert.equal(execution.terminationConfirmed, false);
	assert.equal(execution.reportReceived, true);
	assert.equal(execution.reportAccepted, false);
	assert.equal(execution.unacceptedReport.status, "completed");
	assert.equal(execution.unacceptedReport.workerRunId, "run-dg1");
	assert.equal(execution.probeFailures[0].kind, "not-a-git-repository");
	assert.ok(execution.guidance.length > 0);
	assert.deepEqual(store.require(task.taskId), before, "diagnostics never mutate the record");

	// executionId narrows the view; unknown ids get a structured error.
	const narrowed = orch.describeTaskDiagnostics("/fixture/diag", task.taskId, "call-dg1");
	assert.equal(narrowed.diagnostics.executions.length, 1);
	const miss = orch.describeTaskDiagnostics("/fixture/diag", task.taskId, "call-nope");
	assert.equal(miss.diagnostics.executions.length, 0);
	const unknown = orch.describeTaskDiagnostics("/fixture/diag", "T-19990101-000");
	assert.equal(unknown.error, "TASK_UNKNOWN");
	const foreign = orch.describeTaskDiagnostics("/other/workspace", task.taskId);
	assert.equal(foreign.error, "TASK_FOREIGN_WORKSPACE");
}

// ============================================================================
// Ticket 03 — observation acceptance: the pass verdict binds the restricted
// reader report; modification declarations or untrusted producers refuse.
// ============================================================================
{
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const task = store.create(createTaskSpec({
		taskId: "T-20260908-obs",
		objective: "report the log locations",
		cwd: "/fixture/obs",
		role: "explorer",
		acceptanceMode: "observation",
		validation: { required: false },
	}));
	assert.equal(task.spec.acceptanceMode, "observation", "the mode persists on the spec");
	store.transition(task.taskId, "executing");
	store.beginExecution(task.taskId, {
		executionId: "call-obs",
		kind: "explorer",
		cwd: "/fixture/obs",
		worktreeRoots: ["/fixture/obs"],
		aRun: { cwd: "/fixture/obs", taskId: task.taskId, workerRunId: "call-obs", gitAvailable: false },
		capability: "restricted-reader",
		capabilityBasis: "bound at launch",
		readOnly: true,
	});
	const report = {
		version: 1,
		taskId: task.taskId,
		status: "completed",
		summary: "logs live under /var/log/x",
		changedFiles: [],
		validation: [],
		evidence: { cwd: "/fixture/obs", taskId: task.taskId, workerRunId: "call-obs", gitAvailable: false },
		risks: [],
		unresolved: [],
	};
	store.recordReport(task.taskId, report);
	store.completeExecution(task.taskId, "call-obs", {
		status: "completed",
		endedAt: "2026-09-05T00:00:00.000Z",
		terminationConfirmed: true,
		confirmationBasis: "terminal+restricted-reader",
		reportIndex: 0,
		usageComplete: true,
	});
	store.transition(task.taskId, "reviewing");

	// The pass binds the report + reader execution — no Git freshness check.
	assert.equal(orch.rootVerdictRefusal(store.require(task.taskId), "pass"), undefined);
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "findings verified by inspection");
	assert.equal(outcome.decision.action, "accept");
	assert.equal(outcome.task.state, "completed");
	assert.match(outcome.evidence ?? "", /observation/);
	assert.equal(store.require(task.taskId).lastComparison, undefined, "observation never records a Git comparison");
}

{
	// A report declaring changed files cannot pass under observation.
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const task = store.create(createTaskSpec({
		taskId: "T-20260908-ob2",
		objective: "report plus a stray write",
		cwd: "/fixture/ob2",
		role: "explorer",
		acceptanceMode: "observation",
		validation: { required: false },
	}));
	store.transition(task.taskId, "executing");
	store.beginExecution(task.taskId, {
		executionId: "call-ob2",
		kind: "explorer",
		cwd: "/fixture/ob2",
		worktreeRoots: ["/fixture/ob2"],
		aRun: { cwd: "/fixture/ob2", taskId: task.taskId, workerRunId: "call-ob2", gitAvailable: false },
		capability: "restricted-reader",
		capabilityBasis: "bound at launch",
		readOnly: true,
	});
	const report = {
		version: 1,
		taskId: task.taskId,
		status: "completed",
		summary: "found it and wrote notes",
		changedFiles: ["notes.md"],
		validation: [],
		evidence: { cwd: "/fixture/ob2", taskId: task.taskId, workerRunId: "call-ob2", gitAvailable: false },
		risks: [],
		unresolved: [],
	};
	store.recordReport(task.taskId, report);
	store.completeExecution(task.taskId, "call-ob2", {
		status: "completed",
		terminationConfirmed: true,
		reportIndex: 0,
	});
	store.transition(task.taskId, "reviewing");
	const refusal = orch.rootVerdictRefusal(store.require(task.taskId), "pass");
	assert.equal(refusal?.kind, "observation-inadmissible");
	assert.match(refusal.reason, /changed file/);
	orch.recordRootVerdictRefusal(task, "pass", refusal);
	assert.equal(store.require(task.taskId).state, "reviewing", "refused verdict does not complete the task");
}

{
	// A report bound to an execution that was never a proven reader cannot pass.
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const task = store.create(createTaskSpec({
		taskId: "T-20260908-ob3",
		objective: "untrusted producer",
		cwd: "/fixture/ob3",
		role: "explorer",
		acceptanceMode: "observation",
		validation: { required: false },
	}));
	store.transition(task.taskId, "executing");
	store.beginExecution(task.taskId, {
		executionId: "call-ob3",
		kind: "explorer",
		cwd: "/fixture/ob3",
		worktreeRoots: ["/fixture/ob3"],
		aRun: { cwd: "/fixture/ob3", taskId: task.taskId, workerRunId: "call-ob3" },
		// capability absent — a pre-T02 record is "unknown", never a reader.
		readOnly: true,
	});
	const report = {
		version: 1,
		taskId: task.taskId,
		status: "completed",
		summary: "surveyed",
		changedFiles: [],
		validation: [],
		evidence: { cwd: "/fixture/ob3", taskId: task.taskId, workerRunId: "call-ob3" },
		risks: [],
		unresolved: [],
	};
	store.recordReport(task.taskId, report);
	store.completeExecution(task.taskId, "call-ob3", { status: "completed", terminationConfirmed: true, reportIndex: 0 });
	store.transition(task.taskId, "reviewing");
	const refusal = orch.rootVerdictRefusal(store.require(task.taskId), "pass");
	assert.equal(refusal?.kind, "observation-inadmissible");
	assert.match(refusal.reason, /capability "unknown"/);
}

// ============================================================================
// Audit follow-ups — verdict-time report identity, declared Git evidence
// verified against Root's own sample, and honest diagnostics.
// ============================================================================

// Helper: a proven restricted-reader execution bound to report revision 0.
function boundReaderExecution(store, task, { executionId, runId, report }) {
	store.transition(task.taskId, "executing");
	store.beginExecution(task.taskId, {
		executionId,
		kind: "explorer",
		cwd: task.cwd,
		worktreeRoots: [task.cwd],
		aRun: { cwd: task.cwd, taskId: task.taskId, workerRunId: executionId, gitAvailable: false },
		capability: "restricted-reader",
		capabilityBasis: "test runtime binding [read, grep, find, ls]",
		readOnly: true,
	});
	store.recordReport(task.taskId, report);
	store.completeExecution(task.taskId, executionId, {
		status: "completed",
		endedAt: "2026-09-05T00:00:00.000Z",
		terminationConfirmed: true,
		confirmationBasis: "terminal+restricted-reader",
		reportIndex: 0,
		...(runId ? { runId } : {}),
		usageComplete: true,
	});
	store.transition(task.taskId, "reviewing");
}

// A report revision whose taskId names a foreign Task can never pass — even
// under observation acceptance, even when the record predates the admission
// check.
{
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const task = store.create(createTaskSpec({
		taskId: "T-20260908-idm",
		objective: "identity mismatch under observation",
		cwd: "/fixture/idm",
		role: "explorer",
		acceptanceMode: "observation",
		validation: { required: false },
	}));
	boundReaderExecution(store, task, {
		executionId: "call-idm",
		report: {
			version: 1,
			taskId: "T-99999999-999",
			status: "completed",
			summary: "a report for a different task",
			changedFiles: [],
			validation: [],
			evidence: { cwd: "/fixture/idm", taskId: "T-99999999-999", workerRunId: "call-idm", gitAvailable: false },
			risks: [],
			unresolved: [],
		},
	});
	const refusal = orch.rootVerdictRefusal(store.require(task.taskId), "pass");
	assert.equal(refusal?.kind, "report-identity", "the pre-screen names the structured kind");
	assert.match(refusal.reason, /taskId mismatch/);
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "trying to accept");
	assert.equal(outcome.decision.action, "blocked", "the verdict is refused, never recorded");
	assert.match(outcome.decision.reason, /report-identity/);
	assert.notEqual(store.require(task.taskId).state, "completed", "a mismatched report can never complete the Task");
}

// The bound run is re-checked too: a report that names the right Task but a
// run that is not the producing execution's refuses the same way.
{
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const task = store.create(createTaskSpec({
		taskId: "T-20260908-idr",
		objective: "run-id mismatch under observation",
		cwd: "/fixture/idr",
		role: "explorer",
		acceptanceMode: "observation",
		validation: { required: false },
	}));
	boundReaderExecution(store, task, {
		executionId: "call-idr",
		runId: "run-idr",
		report: {
			version: 1,
			taskId: task.taskId,
			status: "completed",
			summary: "right task, wrong run",
			changedFiles: [],
			validation: [],
			evidence: { cwd: "/fixture/idr", taskId: task.taskId, workerRunId: "run-foreign", gitAvailable: false },
			risks: [],
			unresolved: [],
		},
	});
	const refusal = orch.rootVerdictRefusal(store.require(task.taskId), "pass");
	assert.equal(refusal?.kind, "report-identity");
	assert.match(refusal.reason, /workerRunId/);
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "trying to accept");
	assert.equal(outcome.decision.action, "blocked");
	assert.notEqual(store.require(task.taskId).state, "completed");
}

// expectedEvidence.gitRef is verified against Root's own sample: a
// self-reported ref in a non-Git workspace (or one that does not match the
// sampled HEAD) refuses; a matching ref in a readable worktree passes.
{
	let gitCalls = 0;
	const noGitRunner = async () => {
		gitCalls += 1;
		return { stdout: "", stderr: "fatal: not a git repository", code: 128 };
	};
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner: noGitRunner, store });
	const task = store.create(createTaskSpec({
		taskId: "T-20260908-obg",
		objective: "observe logs at a required Git revision",
		cwd: "/fixture/non-git-obg",
		role: "explorer",
		acceptanceMode: "observation",
		expectedEvidence: { gitRef: true },
		validation: { required: false },
	}));
	boundReaderExecution(store, task, {
		executionId: "call-obg",
		report: {
			version: 1,
			taskId: task.taskId,
			status: "completed",
			summary: "observed logs",
			changedFiles: [],
			validation: [],
			evidence: { cwd: "/fixture/non-git-obg", taskId: task.taskId, workerRunId: "call-obg", finalGitRef: "deadbeef", gitAvailable: false },
			risks: [],
			unresolved: [],
		},
	});
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "accept required git ref");
	assert.ok(gitCalls > 0, "Root samples the workspace before accepting a declared ref");
	assert.equal(outcome.decision.action, "blocked", "an unverifiable declared ref refuses the pass");
	assert.match(outcome.decision.reason, /observation-inadmissible/);
	assert.match(outcome.decision.reason, /no HEAD|cannot be verified/);
	assert.notEqual(outcome.task.state, "completed");
	const refusals = store.require(task.taskId).verdictRefusals ?? [];
	assert.ok(refusals.some((entry) => entry.kind === "observation-inadmissible"), "the refusal is recorded as an audit row");
}

{
	// A declared ref that does not match the sampled HEAD refuses.
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const task = store.create(createTaskSpec({
		taskId: "T-20260908-obm",
		objective: "observe at pinned ref",
		cwd: "/repo",
		role: "explorer",
		acceptanceMode: "observation",
		expectedEvidence: { gitRef: true },
		validation: { required: false },
	}));
	boundReaderExecution(store, task, {
		executionId: "call-obm",
		report: {
			version: 1,
			taskId: task.taskId,
			status: "completed",
			summary: "observed at HEAD",
			changedFiles: [],
			validation: [],
			evidence: { cwd: "/repo", taskId: task.taskId, workerRunId: "call-obm", finalGitRef: "deadbeef", gitAvailable: true },
			risks: [],
			unresolved: [],
		},
	});
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "accept stale ref claim");
	assert.equal(outcome.decision.action, "blocked");
	assert.match(outcome.decision.reason, /does not match the current HEAD/);
	assert.notEqual(outcome.task.state, "completed");
}

{
	// The matching declared ref passes — verification runs and confirms.
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const task = store.create(createTaskSpec({
		taskId: "T-20260908-oba",
		objective: "observe at pinned ref",
		cwd: "/repo",
		role: "explorer",
		acceptanceMode: "observation",
		expectedEvidence: { gitRef: true },
		validation: { required: false },
	}));
	boundReaderExecution(store, task, {
		executionId: "call-oba",
		report: {
			version: 1,
			taskId: task.taskId,
			status: "completed",
			summary: "observed at HEAD",
			changedFiles: [],
			validation: [],
			evidence: { cwd: "/repo", taskId: task.taskId, workerRunId: "call-oba", finalGitRef: "abc1234", gitAvailable: true },
			risks: [],
			unresolved: [],
		},
	});
	const outcome = await orch.recordRootVerdict(store.require(task.taskId), "pass", "verified at declared ref");
	assert.equal(outcome.decision.action, "accept", "a verified declared ref passes");
	assert.equal(outcome.task.state, "completed");
}

// Ticket 06 follow-ups — diagnostics report the workspace as occupied when a
// reservation matching the held execution (or its writerhold re-registration)
// is live, and keep no-reservation drift distinct.
{
	const store = pinnedStore();
	const concurrency = new ConcurrencyController();
	const orch = new PlannerOrchestrator({ gitRunner, store, concurrency });
	const task = store.create(createTaskSpec({
		taskId: "T-20260908-hold",
		objective: "hold diagnostics",
		cwd: "/fixture/hold",
		role: "worker",
		validation: { required: false },
	}));

	// A live writer reservation bound to the held execution reads as active.
	const live = concurrency.reserve({
		id: "call-held",
		taskId: task.taskId,
		role: "worker",
		capability: "writer",
		workspaces: ["/fixture/hold"],
	});
	assert.ok(live.reservation, "fixture reservation held");
	store.setWriterHold(task.taskId, {
		executionId: "call-held",
		reason: "stop unconfirmed",
		since: "2026-09-05T00:00:00.000Z",
	});
	let d = orch.describeTaskDiagnostics("/fixture/hold", task.taskId).diagnostics;
	assert.equal(d.writerHold?.active, true, "a live reservation for the held execution reports active isolation");
	assert.ok(d.reservations.some((item) => item.id === "call-held"));
	assert.ok(d.guidance.some((line) => line.includes("writer hold active")));

	// The post-restart shape: only a writerhold:<id> re-registration exists.
	concurrency.release("call-held");
	concurrency.hold({
		id: "writerhold:call-held",
		taskId: task.taskId,
		role: "worker",
		capability: "writer",
		workspaces: ["/fixture/hold"],
		reservedAt: "2026-09-05T00:00:00.000Z",
	});
	d = orch.describeTaskDiagnostics("/fixture/hold", task.taskId).diagnostics;
	assert.equal(d.writerHold?.active, true, "a restored writerhold re-registration reports active isolation");

	// No reservation of any kind — the hold is recorded but inactive.
	concurrency.release("writerhold:call-held");
	d = orch.describeTaskDiagnostics("/fixture/hold", task.taskId).diagnostics;
	assert.equal(d.writerHold?.active, false, "no live occupancy reports inactive");
	assert.ok(d.guidance.some((line) => line.includes("restart state drift")));
}

// Diagnostics resolve where the session log is known to live: a path
// persisted on the Task's own usage record wins (verified or flagged
// unavailable), then the host session file when this session owns the Task,
// then a disclosed directory hint, then an honest unknown.
{
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const task = store.create(createTaskSpec({
		taskId: "T-20260908-slog",
		objective: "session log diagnostics",
		cwd: "/fixture/slog",
		role: "worker",
		validation: { required: false },
	}));
	store.beginExecution(task.taskId, {
		executionId: "call-slog",
		kind: "worker",
		cwd: "/fixture/slog",
		worktreeRoots: ["/fixture/slog"],
		aRun: { cwd: "/fixture/slog", taskId: task.taskId, workerRunId: "call-slog" },
		capability: "writer",
	});

	// Nothing recorded, no host metadata: honest unknown.
	let d = orch.describeTaskDiagnostics("/fixture/slog", task.taskId).diagnostics;
	assert.equal(d.sessionLog.status, "unknown");
	assert.equal(d.sessionLog.path, undefined, "a fabricated path is never emitted");

	// A directory hint is disclosed as a directory, never as a file guess.
	d = orch.describeTaskDiagnostics("/fixture/slog", task.taskId, undefined, { sessionDir: "/tmp/session-logs" }).diagnostics;
	assert.equal(d.sessionLog.status, "default-directory");
	assert.equal(d.sessionLog.path, "/tmp/session-logs");

	// A persisted child transcript path is verified before it is claimed.
	const logDir = mkdtempSync(join(tmpdir(), "planner-only-slog-"));
	try {
		const logFile = join(logDir, "child-transcript.jsonl");
		writeFileSync(logFile, "{}\n", "utf8");
		task.usage.children.push({
			input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
			kind: "worker", pending: false, source: "sync-details",
			toolCallId: "call-slog", runId: "run-slog",
			transcriptPath: logFile,
		});
		d = orch.describeTaskDiagnostics("/fixture/slog", task.taskId).diagnostics;
		assert.equal(d.sessionLog.status, "verified-file");
		assert.equal(d.sessionLog.path, logFile);
		assert.equal(d.sessionLog.source, "task-usage-record");

		// The recorded path is gone — reported as known-unavailable, not silent.
		task.usage.children[0].transcriptPath = join(logDir, "gone.jsonl");
		d = orch.describeTaskDiagnostics("/fixture/slog", task.taskId).diagnostics;
		assert.equal(d.sessionLog.status, "known-unavailable");
		assert.equal(d.sessionLog.path, join(logDir, "gone.jsonl"));
	} finally {
		rmSync(logDir, { recursive: true, force: true });
	}
}

// A corrupt ledger record is a corrupt ledger record — never TASK_UNKNOWN.
// A valid ledger-only record still resolves read-only; a quarantined
// placeholder (written into memory by restoreFromLedger) keeps the same
// corrupt classification.
{
	const dir = mkdtempSync(join(tmpdir(), "planner-only-diag-corrupt-"));
	try {
		const ledger = new LedgerSnapshotStore(dir);
		const corruptId = "T-20260908-cor";
		mkdirSync(join(dir, "planner-only", "ledger"), { recursive: true });
		writeFileSync(join(dir, "planner-only", "ledger", `${corruptId}.json`), "this is not json", "utf8");

		const orch = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		const corrupt = orch.describeTaskDiagnostics("/fixture/cor", corruptId);
		assert.equal(corrupt.error, "TASK_LEDGER_CORRUPT", "a damaged ledger record is not an unknown Task");
		assert.match(corrupt.reason, /corrupt/);

		const unknown = orch.describeTaskDiagnostics("/fixture/cor", "T-20260908-nop");
		assert.equal(unknown.error, "TASK_UNKNOWN", "a genuinely absent record stays TASK_UNKNOWN");

		// Ledger-only record: source "ledger", no adoption.
		const only = spentTaskRecord("T-20260908-dsk");
		only.cwd = "/fixture/cor";
		ledger.write(only);
		const disk = orch.describeTaskDiagnostics("/fixture/cor", "T-20260908-dsk");
		assert.equal(disk.diagnostics?.source, "ledger");
		assert.equal(orch.store.get("T-20260908-dsk"), undefined, "diagnostics never restore");

		// After startup restore quarantined the corrupt id, the classification
		// still wins over the placeholder in memory.
		const orch2 = new PlannerOrchestrator({ gitRunner, ledgerDir: dir });
		orch2.restoreFromLedger();
		assert.ok(orch2.store.get(corruptId), "quarantine placeholder is in memory");
		const still = orch2.describeTaskDiagnostics("/fixture/cor", corruptId);
		assert.equal(still.error, "TASK_LEDGER_CORRUPT", "a quarantined placeholder still reports as corrupt");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Diagnostics output is bounded: executions show the latest N with a
// disclosed truncation, probe failures cap per execution, and the guidance
// list is capped.
{
	const store = pinnedStore();
	const orch = new PlannerOrchestrator({ gitRunner, store });
	const task = store.create(createTaskSpec({
		taskId: "T-20260908-cap",
		objective: "bounded diagnostics",
		cwd: "/fixture/cap",
		role: "worker",
		validation: { required: false },
	}));
	for (let index = 0; index < 25; index += 1) {
		store.beginExecution(task.taskId, {
			executionId: `call-cap-${index}`,
			kind: "worker",
			cwd: "/fixture/cap",
			worktreeRoots: ["/fixture/cap"],
			aRun: {
				cwd: "/fixture/cap",
				taskId: task.taskId,
				workerRunId: `call-cap-${index}`,
				probeFailures: index === 24
					? Array.from({ length: 15 }, (_, n) => ({
						operation: `probe-${n}`,
						kind: "probe-error",
						cwd: "/fixture/cap",
						exitCode: 1,
						error: `failure ${n}`,
					}))
					: undefined,
			},
			capability: "writer",
		});
	}
	const d = orch.describeTaskDiagnostics("/fixture/cap", task.taskId).diagnostics;
	assert.equal(d.totalExecutions, 25, "the total count survives the cap");
	assert.equal(d.executions.length, 20, "the listing is capped");
	assert.equal(d.executions[0].executionId, "call-cap-5", "the cap keeps the latest executions");
	assert.equal(d.truncated, true, "truncation is disclosed on the diagnostics object");
	assert.ok(d.guidance.some((line) => /latest 20 of 25/.test(line)), "the render discloses what was omitted");
	const last = d.executions.at(-1);
	assert.equal(last.probeFailures.length, 10, "probe failures are capped per execution");
	assert.equal(last.probeFailuresTruncated, 5, "the omitted failure count is disclosed");

	// Narrowing by executionId still reaches an omitted record.
	const narrowed = orch.describeTaskDiagnostics("/fixture/cap", task.taskId, "call-cap-0").diagnostics;
	assert.equal(narrowed.executions.length, 1);
	assert.equal(narrowed.executions[0].executionId, "call-cap-0");
}

console.log("planner-only orchestration: PASS");
