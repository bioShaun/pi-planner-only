import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	UsageLedger,
	summarizeTaskBudget,
	summarizeSessionUsage,
	childUsageFromValue,
	childOutcomeFromExitCode,
	buildRunRecord,
	summarizeRuns,
	emptyTaskUsage,
	hasUsableRate,
	loadPricingTable,
	lookupRates,
	modelIdForPricing,
	renderUsage,
	renderUsageLine,
	shouldFlushUsageOnShutdown,
} from "./usage.ts";

const now = () => new Date("2026-09-05T12:00:00.000Z");

function ledger(rates = {}, currency = "USD") {
	return new UsageLedger({
		now,
		pricing: { version: 1, currency, rates },
	});
}

function piUsage(overrides = {}) {
	return {
		input: 1000,
		output: 200,
		cacheRead: 800,
		cacheWrite: 0,
		cost: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		...overrides,
	};
}

// --------------------------------------------------------------------------
// Task cumulative budget summaries (T1-T5, T7)
// --------------------------------------------------------------------------

{
	const u = ledger({ "m": { input: 0.001, output: 0.001, cacheRead: 0.001, cacheWrite: 0.001 } });
	const taskId = "T-summary";
	const component = (input, output, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite, cost: { total: (input + output + cacheRead + cacheWrite) * 0.001 } });
	u.recordRootTurn({ taskId, state: "planning", model: "m", usage: component(10, 2, 3, 4) });
	u.recordRootTurn({ taskId, state: "executing", model: "m", usage: component(20, 2, 3, 4) });
	u.recordRootTurn({ taskId, state: "reviewing", model: "m", usage: component(30, 2, 3, 4) });
	for (const [kind, id] of [["worker", "w1"], ["validator", "v1"], ["reviewer", "r1"], ["explorer", "e1"], ["worker", "w2"]]) {
		u.recordChild(taskId, { kind, runId: id, source: "sync-details", pending: false, input: 1, output: 2, cacheRead: 3, cacheWrite: 4, costUsd: 0.01 });
	}
	const summary = summarizeTaskBudget(u.taskUsage(taskId), { tokens: 200, costUsd: 1 });
	assert.equal(summary.tokens.known, 137);
	assert.equal(summary.byRole.worker.calls, 2);
	assert.deepEqual(Object.keys(summary.byRole).sort(), ["explorer", "reviewer", "root", "validator", "worker"]);
	assert.equal(summary.tokens.limit, 200);
	assert.equal(summary.tokens.remaining, 63);
	assert.equal(summary.costUsd.limit, 1);
	assert.equal(summary.costUsd.remaining, 0.863);
	assert.equal(summarizeTaskBudget(u.taskUsage(taskId), { tokens: 1 }).tokens.remaining, -136);
	assert.equal(summarizeTaskBudget(u.taskUsage(taskId)).configured, false);
	assert.equal(summarizeTaskBudget(u.taskUsage(taskId)).tokens.remaining, undefined);
	assert.equal(summarizeTaskBudget(u.taskUsage(taskId)).costUsd.remaining, undefined);
}

{
	const u = ledger();

	u.recordRootTurn({ model: "m", usage: { input: 7, output: 3, cacheRead: 2, cacheWrite: 1 } });
	u.recordRootTurn({ taskId: "T-created", state: "planning", model: "m", usage: { input: 11, output: 5, cacheRead: 2, cacheWrite: 1 } });
	u.recordChild("T-created", { kind: "worker", source: "unavailable", pending: true, input: 4, output: 1, cacheRead: 0, cacheWrite: 0 });
	const taskSummary = summarizeTaskBudget(u.taskUsage("T-created"));
	assert.equal(taskSummary.tokens.known, 24);

	assert.equal(taskSummary.tokens.unknownParts, 1);
	assert.equal(summarizeSessionUsage(u).unattributed.turns, 1);
	assert.equal(summarizeSessionUsage(u).unattributed.tokens, 13);
	assert.equal(taskSummary.costUsd.unknownParts, 2);
	assert.equal(taskSummary.costUsd.known, 0);
	assert.equal(taskSummary.tokens.unknownParts, 1);
	assert.equal(summarizeSessionUsage(u).totalTokens, 37);
}

// --------------------------------------------------------------------------
// unknown cost and zero-token root remain separate dimensions (T5)
// --------------------------------------------------------------------------

{
	const u = ledger();
	u.recordRootTurn({ taskId: "T-unknown", state: "planning", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
	u.recordChild("T-unknown", { kind: "worker", source: "unavailable", pending: false, input: 9, output: 1, cacheRead: 0, cacheWrite: 0 });
	const summary = summarizeTaskBudget(u.taskUsage("T-unknown"));
	assert.equal(summary.tokens.known, 10);
	assert.equal(summary.tokens.unknownParts, 2);
	assert.equal(summary.costUsd.known, 0);
	assert.equal(summary.costUsd.unknownParts, 2);
}

// --------------------------------------------------------------------------
// zero is not unknown: a bucket that never took a turn spent nothing, and must
// not fabricate an unknown cost component (planner fix on top of p14-r067)
// --------------------------------------------------------------------------

{
	const u = ledger({ "m": { input: 0.001, output: 0.001, cacheRead: 0.001, cacheWrite: 0.001 } });
	// An ordinary session: every Root turn is attributed and every cost is priced.
	u.recordRootTurn({ taskId: "T-priced", state: "planning", model: "m", usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0.012 } } });
	u.recordChild("T-priced", { kind: "worker", runId: "w1", source: "sync-details", pending: false, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.002 });
	const session = summarizeSessionUsage(u);
	assert.equal(session.unattributed.turns, 0);
	assert.equal(session.unattributed.costUnknown, false, "an empty unattributed bucket is known-zero, not unknown");
	assert.equal(session.costUnknownParts, 0, "nothing in this session is unknown");

	// A Task whose children arrived before any Root turn: Root spent nothing.
	u.recordChild("T-no-root", { kind: "explorer", runId: "e1", source: "sync-details", pending: false, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.001 });
	const noRoot = summarizeTaskBudget(u.taskUsage("T-no-root"), { costUsd: 1 });
	assert.equal(noRoot.byRole.root.calls, 0);
	assert.equal(noRoot.costUsd.unknownParts, 0, "a Root with zero turns contributes no unknown cost");
	assert.equal(noRoot.byRole.root.costUnknownParts, 0);
	// The sticky-unknown Root case still reports exactly one unknown component.
	u.recordRootTurn({ taskId: "T-unpriced", state: "planning", model: "no-such-model", usage: { input: 5, output: 1, cacheRead: 0, cacheWrite: 0 } });
	u.recordRootTurn({ taskId: "T-unpriced", state: "executing", model: "no-such-model", usage: { input: 5, output: 1, cacheRead: 0, cacheWrite: 0 } });
	assert.equal(summarizeTaskBudget(u.taskUsage("T-unpriced")).costUsd.unknownParts, 1);
}


{
	const empty = emptyTaskUsage();
	assert.equal(empty.root.turns, 0);
	assert.equal(empty.root.tokensUnknownTurns, 0);
	assert.equal(empty.root.reviewLeakBytes, 0);
	assert.equal(empty.root.injectedBytes, 0);
	assert.equal(empty.root.byPhase.planning.turns, 0);
	assert.equal(empty.root.byPhase.executing.turns, 0);
	assert.equal(empty.root.byPhase.reviewing.turns, 0);
	assert.deepEqual(empty.children, []);
	assert.equal(empty.costUnknown, false);
	assert.equal(empty.root.costUsd, undefined);
}

// --------------------------------------------------------------------------
// model id thinking suffix
// --------------------------------------------------------------------------

assert.equal(modelIdForPricing("qwen-local/qwen3.8-27b:high"), "qwen-local/qwen3.8-27b");
assert.equal(modelIdForPricing("volcengine/glm-5-3"), "volcengine/glm-5-3");

// --------------------------------------------------------------------------
// lookupRates: provider/model key, bare model key, thinking suffix stripping
// --------------------------------------------------------------------------

{
	const pricing = {
		version: 1,
		currency: "USD",
		rates: {
			"volcengine/glm-5-3": { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.5 },
			"bare-model": { input: 3, output: 4, cacheRead: 1, cacheWrite: 2 },
		},
	};
	assert.equal(lookupRates(pricing, "volcengine", "glm-5-3"), pricing.rates["volcengine/glm-5-3"]);
	assert.equal(lookupRates(pricing, undefined, "bare-model"), pricing.rates["bare-model"]);
	assert.equal(lookupRates(pricing, "volcengine", "glm-5-3:high"), pricing.rates["volcengine/glm-5-3"]);
}

// --------------------------------------------------------------------------
// Phase bucketing per state; untasked when no Task
// --------------------------------------------------------------------------

{
	const u = ledger();
	u.recordRootTurn({ taskId: "T-20260905-001", state: "planning", model: "m", usage: piUsage() });
	u.recordRootTurn({ taskId: "T-20260905-001", state: "executing", model: "m", usage: piUsage() });
	u.recordRootTurn({ taskId: "T-20260905-001", state: "reviewing", model: "m", usage: piUsage() });
	u.recordRootTurn({ taskId: "T-20260905-001", state: "changes_requested", model: "m", usage: piUsage() });
	const task = u.taskUsage("T-20260905-001");
	assert.equal(task.root.byPhase.planning.turns, 1);
	assert.equal(task.root.byPhase.executing.turns, 1);
	assert.equal(task.root.byPhase.reviewing.turns, 2);
	assert.equal(task.root.turns, 4);
	assert.equal(task.rootModel, "m");

	u.recordRootTurn({ usage: piUsage({ input: 50, output: 5, cacheRead: 0 }) });
	u.recordRootTurn({ taskId: "T-20260905-001", state: "completed", usage: piUsage({ input: 7, output: 1, cacheRead: 0 }) });
	const session = u.sessionUsage();
	assert.equal(session.untasked.turns, 2);
	assert.equal(session.untasked.input, 50 + 7);
	assert.ok(session.tasks.includes("T-20260905-001"));
	assert.equal(u.taskUsage("T-20260905-001").root.turns, 4, "terminal turns stay out of the Task");
}

// --------------------------------------------------------------------------
// tokensUnknownTurns
// --------------------------------------------------------------------------

{
	const u = ledger();
	u.recordRootTurn({
		taskId: "T-20260905-unk",
		state: "planning",
		usage: piUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
	});
	assert.equal(u.taskUsage("T-20260905-unk").root.tokensUnknownTurns, 1);
	assert.equal(u.taskUsage("T-20260905-unk").root.turns, 1);
}

// --------------------------------------------------------------------------
// injected / leak accumulation
// --------------------------------------------------------------------------

{
	const u = ledger();
	u.recordRootTurn({ taskId: "T-20260905-002", state: "reviewing", usage: piUsage() });
	u.recordInjected("T-20260905-002", 100);
	u.recordInjected("T-20260905-002", 20);
	u.recordReviewLeak("T-20260905-002", 40);
	u.recordReviewLeak("T-20260905-002", 10);
	const task = u.taskUsage("T-20260905-002");
	assert.equal(task.root.injectedBytes, 120);
	assert.equal(task.root.reviewLeakBytes, 50);
}

// --------------------------------------------------------------------------
// child pending → resolved through resolvePending
// --------------------------------------------------------------------------

{
	const u = ledger();
	u.recordChild("T-20260905-003", {
		kind: "worker",
		runId: "run-1",
		agent: "worker",
		pending: true,
		source: "unavailable",
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	});
	let task = u.taskUsage("T-20260905-003");
	assert.equal(task.children.length, 1);
	assert.equal(task.children[0].pending, true);
	assert.equal(task.children[0].source, "unavailable");
	assert.equal(u.taskUsage("T-20260905-003").costUnknown, true);
	assert.equal(task.children[0].costUsd, undefined, "missing meta stays unknown, never zero cost");

	const resolved = u.resolvePending("T-20260905-003", (child) => {
		if (child.runId !== "run-1") return undefined;
		return {
			...child,
			pending: false,
			input: 96_300,
			output: 14_800,
			cacheRead: 0,
			cacheWrite: 0,
			source: "meta-file",
		};
	});
	assert.equal(resolved, 1);
	task = u.taskUsage("T-20260905-003");
	assert.equal(task.children[0].pending, false);
	assert.equal(task.children[0].source, "meta-file");
	assert.equal(task.children[0].input, 96_300);
}

// --------------------------------------------------------------------------
// childUsageFromValue: pi-subagents Usage and pi-ai Usage
// --------------------------------------------------------------------------

{
	const sub = childUsageFromValue(
		{ input: 10, output: 4, cacheRead: 2, cacheWrite: 1, cost: 1.25, turns: 3 },
		"worker",
		{ toolCallId: "call-1", agent: "worker", model: "volcengine/glm-5-3", source: "sync-details" },
	);
	assert.ok(sub);
	assert.equal(sub.input, 10);
	assert.equal(sub.output, 4);
	assert.equal(sub.turns, 3);
	assert.equal(sub.costUsd, 1.25);
	assert.equal(sub.pending, false);
	assert.equal(sub.source, "sync-details");
	assert.equal(sub.kind, "worker");

	const ai = childUsageFromValue(
		{ input: 8, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { total: 0.5 } },
		"reviewer",
		{ runId: "run-x", agent: "reviewer", source: "bg-wait" },
	);
	assert.ok(ai);
	assert.equal(ai.costUsd, 0.5);
	assert.equal(ai.source, "bg-wait");
	assert.equal(ai.runId, "run-x");

	assert.equal(childUsageFromValue(undefined, "worker", { source: "unavailable" }), undefined);
	assert.equal(childUsageFromValue("nope", "worker", { source: "sync-details" }), undefined);
	const zeroCost = childUsageFromValue(
		{ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
		"worker",
		{ source: "sync-details" },
	);
	assert.equal(zeroCost.costUsd, undefined, "cost 0 is not a resolved Pi/subagents price");
}

// --------------------------------------------------------------------------
// Cost resolution order: Pi cost > pricing table > unknown
// --------------------------------------------------------------------------

{
	const rates = {
		"volcengine/glm-5-3": { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 },
		"tcuni-claude/claude-fable-5-1": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		"volcengine/glm-5-3-null": { input: null, output: null, cacheRead: null, cacheWrite: null },
	};

	const piWins = ledger(rates);
	piWins.recordRootTurn({
		taskId: "T-pi",
		state: "planning",
		provider: "volcengine",
		model: "glm-5-3",
		usage: piUsage({ cost: { total: 9.99 } }),
	});
	assert.equal(piWins.taskUsage("T-pi").root.costUsd, 9.99);
	assert.equal(piWins.taskUsage("T-pi").costUnknown, false);

	const tableWins = ledger(rates);
	tableWins.recordRootTurn({
		taskId: "T-tbl",
		state: "planning",
		provider: "volcengine",
		model: "glm-5-3",
		usage: piUsage({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }),
	});
	assert.equal(tableWins.taskUsage("T-tbl").root.costUsd, 1);
	assert.equal(tableWins.taskUsage("T-tbl").costUnknown, false);

	const thinking = ledger({
		"qwen-local/qwen3.8-27b": { input: 3, output: 0, cacheRead: 0, cacheWrite: 0 },
	});
	thinking.recordRootTurn({
		taskId: "T-th",
		state: "executing",
		model: "qwen-local/qwen3.8-27b:high",
		usage: piUsage({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }),
	});
	assert.equal(thinking.taskUsage("T-th").root.costUsd, 3);

	const unknown = ledger(rates);
	unknown.recordRootTurn({
		taskId: "T-unk",
		state: "planning",
		model: "mystery/no-such-model",
		usage: piUsage({ cost: { total: 0 } }),
	});
	assert.equal(unknown.taskUsage("T-unk").root.costUsd, undefined);
	assert.equal(unknown.taskUsage("T-unk").costUnknown, true);

	const nullRates = ledger(rates);
	nullRates.recordRootTurn({
		taskId: "T-null",
		state: "planning",
		model: "volcengine/glm-5-3-null",
		usage: piUsage({ cost: { total: 0 } }),
	});
	assert.equal(nullRates.taskUsage("T-null").root.costUsd, undefined);
	assert.equal(nullRates.taskUsage("T-null").costUnknown, true);

	const free = ledger(rates);
	free.recordRootTurn({
		taskId: "T-free",
		state: "planning",
		model: "tcuni-claude/claude-fable-5-1",
		usage: piUsage({ cost: { total: 0 } }),
	});
	assert.equal(free.taskUsage("T-free").root.costUsd, 0);
	assert.equal(free.taskUsage("T-free").costUnknown, false);
}

// --------------------------------------------------------------------------
// costUnknown propagation across children
// --------------------------------------------------------------------------

{
	const u = ledger({
		"priced/m": { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	});
	u.recordRootTurn({
		taskId: "T-mix",
		state: "executing",
		model: "priced/m",
		usage: piUsage({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }),
	});
	assert.equal(u.taskUsage("T-mix").costUnknown, false);
	u.recordChild("T-mix", {
		kind: "worker",
		pending: false,
		source: "sync-details",
		model: "mystery/child",
		input: 10,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
	});
	assert.equal(u.taskUsage("T-mix").costUnknown, true);
}

// --------------------------------------------------------------------------
// Rendering: byte cap; never $0.00 for unknown
// --------------------------------------------------------------------------

{
	const unknown = emptyTaskUsage();
	unknown.root.turns = 12;
	unknown.root.input = 184_200;
	unknown.root.output = 6_100;
	unknown.root.cacheRead = 151_000;
	unknown.rootModel = "mystery/model";
	unknown.costUnknown = true;
	unknown.children.push({
		kind: "worker",
		pending: false,
		source: "meta-file",
		model: "other/m",
		input: 132_000,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		runId: "a1b2c3",
	});
	const block = renderUsage(unknown, { taskId: "T-20260905-003", state: "completed", rounds: 2 });
	assert.match(block, /Usage for T-20260905-003 \(completed, 2 rounds\)/);
	assert.match(block, /in 184\.2k/);
	assert.match(block, /out 6\.1k/);
	assert.doesNotMatch(block, /\$0\.00/);
	assert.match(block, /cost unknown/);
	assert.doesNotMatch(block, /Estimated Root-only cost/);

	const line = renderUsageLine(unknown);
	assert.match(line, /^usage: /);
	assert.match(line, /cost unknown/);
	assert.doesNotMatch(line, /\$0\.00/);
	assert.ok(Buffer.byteLength(line) <= 160, `line is ${Buffer.byteLength(line)} bytes`);

	const priced = emptyTaskUsage();
	priced.root.turns = 12;
	priced.root.input = 184_200;
	priced.root.output = 6_100;
	priced.root.cacheRead = 151_000;
	priced.root.costUsd = 1.23;
	priced.root.byPhase.planning.turns = 3;
	priced.root.byPhase.executing.turns = 4;
	priced.root.byPhase.reviewing.turns = 5;
	priced.root.reviewLeakBytes = 18_400;
	priced.root.injectedBytes = 27_900;
	priced.rootModel = "tcuni-claude/claude-fable-5-1";
	priced.children.push({
		kind: "worker",
		pending: false,
		source: "meta-file",
		model: "volcengine/glm-5-3",
		input: 96_300,
		output: 14_800,
		cacheRead: 0,
		cacheWrite: 0,
		costUsd: 0.09,
		runId: "a1b2c3",
	});
	const pricedBlock = renderUsage(priced, {
		taskId: "T-20260905-003",
		state: "completed",
		rounds: 2,
		rootRates: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 },
	});
	assert.match(pricedBlock, /\$1\.23/);
	assert.match(pricedBlock, /Root share of cost: 93%/);
	assert.match(pricedBlock, /同 token 用量换价估算/);
	assert.match(pricedBlock, /子进程用量保持不变、仅替换费率/);
	assert.doesNotMatch(pricedBlock, /upper bound/);
	assert.match(pricedBlock, /review leak 18\.4 KB/);
	assert.match(pricedBlock, /injected 27\.9 KB/);

	const pricedLine = renderUsageLine(priced);
	const unavailableBlock = renderUsage(priced, {
		taskId: "T-20260905-004",
		state: "completed",
		rounds: 1,
	});
	assert.match(unavailableBlock, /同 token 用量换价估算：不可估算/);
	assert.match(unavailableBlock, /缺少 Root 费率/);
	assert.doesNotMatch(unavailableBlock, /upper bound/);
	assert.doesNotMatch(unavailableBlock, /\$0\.00/);

	const childRateMissing = {
		...priced,
		children: priced.children.map((child) => ({ ...child, costUsd: undefined })),
	};
	const childRateMissingBlock = renderUsage(childRateMissing, {
		taskId: "T-20260905-005",
		rootRates: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 },
	});
	assert.match(childRateMissingBlock, /同 token 用量换价估算：不可估算/);
	assert.match(childRateMissingBlock, /缺少子进程费率.*volcengine\/glm-5-3/);
	assert.doesNotMatch(childRateMissingBlock, /\$0\.00/);
	assert.doesNotMatch(pricedLine, /cost unknown/);
	assert.ok(Buffer.byteLength(pricedLine) <= 160);

	const tiny = emptyTaskUsage();
	tiny.root.costUsd = 0.0123;
	tiny.root.turns = 1;
	tiny.costUnknown = false;
	assert.match(renderUsage(tiny, { taskId: "T-x", state: "planning", rounds: 0 }), /\$0\.0123/);
}


// --------------------------------------------------------------------------
// load() idempotency; drain() returns each record once
// --------------------------------------------------------------------------

{
	const usage = emptyTaskUsage();
	usage.root.turns = 1;
	usage.root.input = 10;
	usage.root.output = 2;
	usage.root.costUsd = 0.05;
	const record = buildRunRecord({
		runId: "run-1", arm: "isolated-baseline",
		task: { taskId: "T-1", objective: "objective", acceptanceCriteria: ["pass"], state: "completed", reviewRounds: 1, createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:01:00Z", cwd: "/repo", baseGitRef: "abc" },
		usage, pricing: { path: "/pricing.json", version: 1, currency: "USD", loadedAt: "2026-09-09T00:02:00Z" }, now: () => new Date("2026-09-09T00:02:00Z"),
	});
	assert.equal(record.comparable, true);
	assert.equal(record.task.baseGitRef, "abc");
	assert.equal(record.cache.cacheRead, 0);
	assert.equal(record.outcome.completed, true);
	const missingBase = { ...record, comparable: false, cost: { ...record.cost, totalUsd: undefined }, task: { ...record.task, baseGitRef: undefined }, incomparableReasons: ["no baseline git ref"] };
	const summary = summarizeRuns([record, missingBase]);
	assert.equal(summary.runs, 2);
	assert.equal(summary.completed, 2);
	assert.equal(summary.comparable, 1);
	assert.equal(summary.totalSpendUsd, 0.05);
	assert.equal(summary.costPerSuccessUsd, 0.05);
}


{
	const u = ledger();
	u.recordRootTurn({
		taskId: "T-load",
		state: "planning",
		model: "m",
		messageId: "msg-1",
		usage: piUsage(),
	});
	const first = u.drain();
	assert.equal(first.length, 1);
	assert.equal(first[0].kind, "root-turn");
	assert.match(first[0].id, /^root-turn:/);
	assert.equal(u.drain().length, 0, "drain returns each record once");

	u.recordInjected("T-load", 12);
	u.recordReviewLeak("T-load", 3);
	u.recordChild("T-load", {
		kind: "worker",
		toolCallId: "c1",
		pending: false,
		source: "sync-details",
		input: 1,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
	});
	const more = u.drain();
	assert.equal(more.length, 3);

	const replay = ledger();
	replay.load([...first, ...first, ...more]);
	assert.equal(replay.taskUsage("T-load").root.turns, 1, "duplicate ids are not applied twice");
	assert.equal(replay.taskUsage("T-load").root.injectedBytes, 12);
	assert.equal(replay.taskUsage("T-load").root.reviewLeakBytes, 3);
	assert.equal(replay.taskUsage("T-load").children.length, 1);
	assert.equal(replay.drain().length, 0, "loaded records are not re-drained");

	replay.load(first);
	assert.equal(replay.taskUsage("T-load").root.turns, 1);
}

// --------------------------------------------------------------------------
// run4 regression fixture: failed worker and unbound scout are the exact gap
// --------------------------------------------------------------------------

{
	const fixtureRoot = join(process.cwd(), ".scratch/planner-only-cost-control/phase-a-08-run4/artifacts");
	const logged = readFileSync(join(fixtureRoot, "usage.jsonl"), "utf8")
		.trim().split("\n").map((line) => JSON.parse(line));
	const finalRecord = logged.at(-1);
	const loggedRunIds = new Set(finalRecord.children.map((child) => child.runId));
	const metaFiles = [
		"4e032aed-40ae-4e88-87b6-fcd6b1351d63_worker_0_meta.json",
		"c22defe6-1944-4fe4-b992-5a50a94d9d88_delegate_0_meta.json",
		"f1d2b014-f7b6-4591-adbd-32cd3d9e2582_worker_0_meta.json",
		"2d9ca9b6-ba2d-4491-908f-307855167e7d_delegate_0_meta.json",
		"73bd7b92-06a4-4c17-a5c8-e9936494f47f_worker_0_meta.json",
		"eb50ca15-b655-40f5-85cf-c1b8a96062ce_scout_meta.json",
	].map((name) => JSON.parse(readFileSync(join(fixtureRoot, "metas", name), "utf8")));
	const missing = metaFiles.filter((meta) => !loggedRunIds.has(meta.runId));
	assert.deepEqual(missing.map((meta) => meta.runId), [
		"73bd7b92-06a4-4c17-a5c8-e9936494f47f",
		"eb50ca15-b655-40f5-85cf-c1b8a96062ce",
	]);
	assert.equal(childOutcomeFromExitCode(1), "failed");
	assert.equal(childOutcomeFromExitCode(0), "succeeded");
	assert.equal(childOutcomeFromExitCode(undefined), "unknown");

	const u = ledger();
	for (const child of finalRecord.children) u.recordChild(finalRecord.taskId, child);
	for (const meta of missing) {
		u.recordChild(finalRecord.taskId, {
			...childUsageFromValue(meta.usage, meta.agent === "scout" ? "explorer" : "worker", {
				runId: meta.runId,
				agent: meta.agent,
				source: "meta-file",
				pending: false,
			}),
			outcome: childOutcomeFromExitCode(meta.exitCode),
		});
	}
	// Re-seeing an inner scout run must not create another child.
	u.recordChild(finalRecord.taskId, {
		...childUsageFromValue(metaFiles.at(-1).usage, "explorer", {
			runId: metaFiles.at(-1).runId,
			agent: "scout",
			source: "meta-file",
			pending: false,
		}),
		outcome: "succeeded",
	});
	const task = u.taskUsage(finalRecord.taskId);
	const childTotal = task.children.reduce((sum, child) => sum + (child.costUsd ?? 0), 0);
	const total = finalRecord.root.costUsd + childTotal;
	assert.equal(task.children.length, 6);
	assert.ok(Math.abs(childTotal - 0.24052828) < 1e-8, `children total ${childTotal}`);
	assert.ok(Math.abs(total - 0.29581593) < 1e-8, `total ${total}`);
	assert.equal(task.children.find((child) => child.runId === missing[0].runId).outcome, "failed");
	assert.equal(task.children.find((child) => child.runId === missing[1].runId).outcome, "succeeded");
	console.log(`run4 fixture: children ${childTotal.toFixed(8)} total ${total.toFixed(8)}`);
}


{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-test-"));
	try {
		const path = join(dir, "pricing.json");
		writeFileSync(path, JSON.stringify({
			version: 1,
			currency: "CNY",
			rates: {
				_comment: { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 },
				"volcengine/glm-5-3": { input: null, output: null, cacheRead: null, cacheWrite: null },
				"local/free": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
		}));
		const previous = process.env.PI_PLANNER_ONLY_PRICING;
		process.env.PI_PLANNER_ONLY_PRICING = path;
		try {
			const table = loadPricingTable();
			assert.equal(table.currency, "CNY");
			assert.equal("_comment" in table.rates, false);
			assert.equal(table.rates["volcengine/glm-5-3"].input, null);
			assert.equal(table.rates["local/free"].input, 0);
		} finally {
			if (previous === undefined) delete process.env.PI_PLANNER_ONLY_PRICING;
			else process.env.PI_PLANNER_ONLY_PRICING = previous;
		}

		const missing = loadPricingTable({ PI_PLANNER_ONLY_PRICING: join(dir, "nope.json") });
		assert.equal(missing.currency, "USD");
		assert.deepEqual(missing.rates, {});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// --------------------------------------------------------------------------
// hasUsableRate: missing entry, null field, and zero rates
// --------------------------------------------------------------------------

{
	const pricing = {
		version: 1,
		currency: "USD",
		rates: {
			"test-priced/has-rate": { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.5 },
			"test-priced/zero-rate": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			"test-priced/null-rate": { input: null, output: 2, cacheRead: 0.5, cacheWrite: 1.5 },
		},
	};
	assert.equal(hasUsableRate(pricing, "test-priced", "has-rate"), true);
	assert.equal(hasUsableRate(pricing, undefined, "test-priced/has-rate:high"), true, "thinking suffix still resolves");
	assert.equal(hasUsableRate(pricing, "test-priced", "zero-rate"), true, "zero rates count as a usable rate");
	assert.equal(hasUsableRate(pricing, "test-priced", "null-rate"), false, "a null field makes the rate unusable");
	assert.equal(hasUsableRate(pricing, "test-unpriced", "no-rate"), false, "a missing entry is unusable");
	assert.equal(hasUsableRate(pricing, undefined, undefined), false);
}

// --------------------------------------------------------------------------
// Issue 07: Root cost unknown is never zero; totals say "excluding Root"
// --------------------------------------------------------------------------

{
	const usage = emptyTaskUsage();
	usage.root.turns = 5;
	usage.root.input = 120_000;
	usage.root.output = 4_000;
	usage.root.cacheRead = 30_000;
	usage.rootModel = "test-unpriced/no-rate";
	usage.costUnknown = true;
	usage.children.push({
		kind: "worker",
		pending: false,
		source: "sync-details",
		model: "test-priced/has-rate",
		input: 90_000,
		output: 10_000,
		cacheRead: 0,
		cacheWrite: 0,
		costUsd: 0.09,
	});

	const block = renderUsage(usage, { taskId: "T-20260907-001", state: "reviewing", rounds: 1 });
	assert.match(block, /Root {3}test-unpriced\/no-rate/);
	assert.match(block, /cost unknown/);
	assert.match(block, /excluding Root/, "totals must state they exclude Root");
	assert.match(block, /\$0\.09/, "the known child cost is still shown");
	assert.doesNotMatch(block, /\$0\.00/, "unknown must never render as $0.00 for Root or the total");
	assert.doesNotMatch(block, /¥0/);

	const line = renderUsageLine(usage);
	assert.match(line, /^usage: /);
	assert.match(line, /cost unknown/);
	assert.match(line, /excluding Root/);
	assert.match(line, /\$0\.09/);
	assert.doesNotMatch(line, /\$0\.00/);
	assert.ok(Buffer.byteLength(line) <= 160, `line is ${Buffer.byteLength(line)} bytes`);

	// No known component costs at all: the total is unknown, not $0.00.
	const allUnknown = emptyTaskUsage();
	allUnknown.root.turns = 3;
	allUnknown.root.input = 10_000;
	allUnknown.costUnknown = true;
	allUnknown.children.push({
		kind: "worker",
		pending: false,
		source: "meta-file",
		model: "test-unpriced/no-rate",
		input: 5_000,
		output: 500,
		cacheRead: 0,
		cacheWrite: 0,
	});
	const allUnknownBlock = renderUsage(allUnknown, { taskId: "T-20260907-002" });
	assert.match(allUnknownBlock, /excluding Root/);
	assert.doesNotMatch(allUnknownBlock, /\$0\.00/);
	const allUnknownLine = renderUsageLine(allUnknown);
	assert.match(allUnknownLine, /excluding Root/);
	assert.doesNotMatch(allUnknownLine, /\$0\.00/);
	assert.ok(Buffer.byteLength(allUnknownLine) <= 160);
}

{
	assert.equal(shouldFlushUsageOnShutdown("quit"), true);
	assert.equal(shouldFlushUsageOnShutdown("new"), true);
	assert.equal(shouldFlushUsageOnShutdown("fork"), true);
	assert.equal(shouldFlushUsageOnShutdown("resume"), true);
	assert.equal(shouldFlushUsageOnShutdown("reload"), false);
	assert.equal(shouldFlushUsageOnShutdown(undefined), false);
	assert.equal(shouldFlushUsageOnShutdown({}), false);
}

// --------------------------------------------------------------------------
// Ticket 15: unknown child spend is charged as bounded debt (X1–X6)
// --------------------------------------------------------------------------

const TICKET15_LIMITS = { tokens: 200000, costUsd: 0.5 };

function ticket15PendingChild(overrides = {}) {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		kind: "worker",
		pending: true,
		source: "unavailable",
		toolCallId: "call-ticket15",
		tokensDebt: 40000,
		costDebtUsd: 0.12,
		...overrides,
	};
}

function ticket15ResolvedNoRate(overrides = {}) {
	return {
		input: 30000,
		output: 9000,
		cacheRead: 0,
		cacheWrite: 0,
		kind: "worker",
		pending: false,
		source: "sync-details",
		toolCallId: "call-ticket15",
		tokensDebt: 40000,
		costDebtUsd: 0.12,
		...overrides,
	};
}

{
	// X1 (ticket 15 clause 4): a pending child is charged its grant, not zero.
	const u = ledger();
	u.recordChild("T-ticket15-d1", ticket15PendingChild());
	const d1 = summarizeTaskBudget(u.taskUsage("T-ticket15-d1"), TICKET15_LIMITS);
	assert.equal(d1.costUsd.known, 0.12);
	assert.equal(d1.costUsd.debt, 0.12);
	assert.equal(d1.costUsd.remaining, 0.38);
}

{
	// X2 (ticket 15 clause 5): real tokens settle; cost stays as debt while unpriced.
	const u = ledger();
	u.recordChild("T-ticket15-d2", ticket15PendingChild());
	u.recordChild("T-ticket15-d2", ticket15ResolvedNoRate());
	const d2 = summarizeTaskBudget(u.taskUsage("T-ticket15-d2"), TICKET15_LIMITS);
	assert.equal(d2.tokens.known, 39000);
	assert.equal(d2.tokens.debt, 0);
	assert.equal(d2.costUsd.debt, 0.12);
	assert.equal(d2.costUsd.unknownParts, 1);
}

{
	// X3 (ticket 15 clause 1): a second completion for the same toolCallId is an upsert.
	const u = ledger();
	u.recordChild("T-ticket15-d3", ticket15PendingChild());
	u.recordChild("T-ticket15-d3", ticket15ResolvedNoRate());
	u.recordChild("T-ticket15-d3", ticket15ResolvedNoRate());
	const taskUsage = u.taskUsage("T-ticket15-d3");
	const d3 = summarizeTaskBudget(taskUsage, TICKET15_LIMITS);
	assert.equal(taskUsage.children.length, 1);
	assert.equal(d3.tokens.known, 39000);
	assert.equal(d3.tokens.debt, 0);
	assert.equal(d3.costUsd.known, 0.12);
	assert.equal(d3.costUsd.debt, 0.12);
	assert.equal(d3.costUsd.unknownParts, 1);
}

{
	// X4: arriving real cost replaces debt, it does not add to it.
	const u = ledger();
	u.recordChild("T-ticket15-d4", ticket15PendingChild());
	u.recordChild("T-ticket15-d4", ticket15ResolvedNoRate());
	u.recordChild("T-ticket15-d4", {
		input: 30000,
		output: 9000,
		cacheRead: 0,
		cacheWrite: 0,
		kind: "worker",
		pending: false,
		source: "sync-details",
		toolCallId: "call-ticket15",
		costUsd: 0.0731,
	});
	const d4 = summarizeTaskBudget(u.taskUsage("T-ticket15-d4"), TICKET15_LIMITS);
	assert.notEqual(d4.costUsd.known, 0.12 + 0.0731);
	assert.equal(d4.costUsd.known, 0.0731);
	assert.equal(d4.costUsd.debt, 0);
	assert.equal(d4.costUsd.unknownParts, 0);
}

{
	// X5: four pending cost debts can drive remaining negative (the gate's view).
	const u = ledger();
	for (const n of [1, 2, 3, 4]) {
		u.recordChild("T-ticket15-d5", ticket15PendingChild({
			toolCallId: `call-ticket15-d5-${n}`,
			tokensDebt: n === 1 ? 40000 : undefined,
			costDebtUsd: 0.13,
		}));
	}
	const d5 = summarizeTaskBudget(u.taskUsage("T-ticket15-d5"), TICKET15_LIMITS);
	assert.equal(d5.costUsd.remaining < 0, true);
}

{
	// X6: leftover debt fields on an already-resolved child are inert.
	const u = ledger();
	u.recordChild("T-ticket15-stale", {
		input: 1000,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		kind: "worker",
		pending: false,
		source: "sync-details",
		toolCallId: "call-ticket15-stale",
		costUsd: 0.05,
		tokensDebt: 40000,
		costDebtUsd: 0.12,
	});
	const stale = summarizeTaskBudget(u.taskUsage("T-ticket15-stale"), TICKET15_LIMITS);
	assert.equal(stale.tokens.debt, 0);
	assert.equal(stale.costUsd.debt, 0);
}

console.log("planner-only usage: PASS");
