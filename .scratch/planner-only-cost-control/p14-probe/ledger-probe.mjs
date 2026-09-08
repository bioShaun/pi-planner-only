// p14 probe 3 (ticket 13): what does UsageLedger already give us, and what is missing
// for a cumulative Task budget: known consumed / unknown / remaining, by role,
// plus a session-level unattributed bucket and a whole-session total?
import { UsageLedger, emptyPricingTable } from "../../../usage.ts";

const pricing = emptyPricingTable();
pricing.rates["probe/root"] = { input: 15e-6, output: 75e-6, cacheRead: 1.5e-6, cacheWrite: 18.75e-6 };
pricing.rates["probe/worker"] = { input: 1e-6, output: 5e-6, cacheRead: 0.1e-6, cacheWrite: 1.25e-6 };

const ledger = new UsageLedger({ pricing });
const u = (i, o) => ({ input: i, output: o, cacheRead: 0, cacheWrite: 0 });

// 1. Root planning BEFORE any Task exists -> must stay session-level unattributed.
ledger.recordRootTurn({ model: "probe/root", provider: "probe", usage: u(5000, 900), messageId: "m-pre" });

const T = "T-20260908-013";
// 2. Root planning / executing / reviewing turns attributed to the Task.
for (const [state, msg] of [["planning", "m1"], ["executing", "m2"], ["reviewing", "m3"]]) {
	ledger.recordRootTurn({ taskId: T, state, model: "probe/root", provider: "probe", usage: u(4000, 600), messageId: msg });
}
// 3. Children of every role, including a retry of the same role and one with unknown cost.
const child = (kind, tok, extra = {}) => ({ kind, input: tok, output: tok / 4, cacheRead: 0, cacheWrite: 0, pending: false, source: "sync-details", model: "probe/worker", ...extra });
ledger.recordChild(T, child("worker", 20000, { toolCallId: "c1" }));
ledger.recordChild(T, child("validator", 8000, { toolCallId: "c2" }));
ledger.recordChild(T, child("reviewer", 12000, { toolCallId: "c3" }));
ledger.recordChild(T, child("explorer", 4000, { toolCallId: "c4" }));
ledger.recordChild(T, child("worker", 9000, { toolCallId: "c5" }));          // the retry
ledger.recordChild(T, child("worker", 3000, { toolCallId: "c6", model: "unpriced/model" })); // unknown cost

const task = ledger.taskUsage(T);
const session = ledger.sessionUsage();

const byRole = {};
for (const c of task.children) {
	const r = byRole[c.kind] ??= { calls: 0, input: 0, output: 0, costUsd: 0, unknownCost: 0 };
	r.calls += 1; r.input += c.input; r.output += c.output;
	if (c.costUsd === undefined) r.unknownCost += 1; else r.costUsd += c.costUsd;
}
console.log("PROBE root turns:", task.root.turns, "byPhase:", JSON.stringify(Object.fromEntries(Object.entries(task.root.byPhase).map(([k, v]) => [k, v.turns]))));
console.log("PROBE root costUsd:", task.root.costUsd, "costUnknown:", task.costUnknown);
console.log("PROBE byRole:", JSON.stringify(byRole));
console.log("PROBE untasked turns:", session.untasked.turns, "untasked costUsd:", session.untasked.costUsd, "tasks:", JSON.stringify(session.tasks));
console.log("PROBE untasked leaked into task?", task.root.turns === 3 ? "no" : "YES — attribution bug");
// What a cumulative budget would need but nothing exposes today:
console.log("PROBE ledger method names:", Object.getOwnPropertyNames(Object.getPrototypeOf(ledger)).join(","));

// ---- prototype of the summary the ticket needs, to prove it is computable ----
const TOK = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;
function summarizeTaskBudget(usage, limits) {
	const childTokens = usage.children.reduce((n, c) => n + TOK(c), 0);
	const knownTokens = TOK(usage.root) + childTokens;
	const unknownTokenParts = usage.root.tokensUnknownTurns
		+ usage.children.filter((c) => c.pending || c.source === "unavailable").length;
	const knownCost = (usage.root.costUsd ?? 0)
		+ usage.children.reduce((n, c) => n + (c.costUsd ?? 0), 0);
	const unknownCostParts = (usage.root.costUsd === undefined ? 1 : 0)
		+ usage.children.filter((c) => c.costUsd === undefined).length;
	const dim = (limit, known, unknownParts) => ({
		limit, known, unknownParts,
		remaining: limit === undefined ? undefined : limit - known,
	});
	return {
		configured: limits?.tokens !== undefined || limits?.costUsd !== undefined,
		tokens: dim(limits?.tokens, knownTokens, unknownTokenParts),
		costUsd: dim(limits?.costUsd, knownCost, unknownCostParts),
	};
}
console.log("PROTO no limits:", JSON.stringify(summarizeTaskBudget(task)));
console.log("PROTO with limits:", JSON.stringify(summarizeTaskBudget(task, { tokens: 200000, costUsd: 1.0 })));
console.log("PROTO overspend:", JSON.stringify(summarizeTaskBudget(task, { tokens: 1000 }).tokens));
