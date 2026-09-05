import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	UsageLedger,
	childUsageFromValue,
	emptyTaskUsage,
	loadPricingTable,
	modelIdForPricing,
	renderUsage,
	renderUsageLine,
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
// empty TaskUsage
// --------------------------------------------------------------------------

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
	assert.match(pricedBlock, /Estimated Root-only cost of the child work:/);
	assert.match(pricedBlock, /review leak 18\.4 KB/);
	assert.match(pricedBlock, /injected 27\.9 KB/);

	const pricedLine = renderUsageLine(priced);
	assert.match(pricedLine, /root share 93%/);
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
// pricing table loader: currency, null, _-prefixed keys, env override
// --------------------------------------------------------------------------

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

console.log("planner-only usage: PASS");
