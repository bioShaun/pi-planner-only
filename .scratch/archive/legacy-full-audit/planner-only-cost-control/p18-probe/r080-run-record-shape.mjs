import { buildRunRecord, summarizeRuns, emptyTaskUsage } from "../../../usage.ts";

const pricing = { path: "/fixture/pricing.json", version: 1, currency: "USD", loadedAt: "2026-09-09T00:00:00.000Z" };

function facts(id, state, rounds, ms) {
	return {
		taskId: id, objective: "对照实验样本", acceptanceCriteria: ["npm test 通过"],
		state, reviewRounds: rounds, cwd: "/fixture",
		createdAt: "2026-09-09T00:00:00.000Z",
		updatedAt: new Date(Date.parse("2026-09-09T00:00:00.000Z") + ms).toISOString(),
		baseGitRef: "abc1234", finalGitRef: "def5678",
	};
}

function usageOf({ rootCost, children }) {
	const u = emptyTaskUsage();
	u.root.turns = 3; u.root.input = 1000; u.root.output = 200; u.root.costUsd = rootCost;
	u.rootModel = "gpt-5.6-luna";
	u.children = children;
	return u;
}

const okChild = { kind: "worker", agent: "pi", model: "qwen3.8-27b", input: 500, output: 100, cacheRead: 0, cacheWrite: 0, costUsd: 0.02, pending: false, source: "sync-details", turns: 1 };
const debtChild = { ...okChild, costUsd: undefined, costDebtUsd: 0.05, pending: true, source: "unavailable" };
const unratedChild = { ...okChild, costUsd: undefined, costDebtUsd: undefined, pending: false, source: "sync-details" };

const a = buildRunRecord({ runId: "r1", arm: "isolated-baseline", task: facts("T-1", "completed", 0, 60000), usage: usageOf({ rootCost: 0.10, children: [okChild] }), pricing });
const b = buildRunRecord({ runId: "r2", arm: "isolated-baseline", task: facts("T-2", "blocked", 2, 120000), usage: usageOf({ rootCost: 0.30, children: [okChild] }), pricing });
const c = buildRunRecord({ runId: "r3", arm: "isolated-baseline", task: facts("T-3", "completed", 1, 90000), usage: usageOf({ rootCost: undefined, children: [unratedChild] }), pricing });
const d = buildRunRecord({ runId: "r4", arm: "isolated-baseline", task: facts("T-4", "completed", 0, 30000), usage: usageOf({ rootCost: 0.10, children: [debtChild] }), pricing });

console.log("A comparable:", a.comparable, "total:", a.cost.totalUsd, "duration:", a.durationMs);
console.log("B comparable:", b.comparable, "total:", b.cost.totalUsd, "completed:", b.outcome.completed);
console.log("C comparable:", c.comparable, "reasons:", JSON.stringify(c.incomparableReasons), "total:", c.cost.totalUsd);
console.log("D comparable:", d.comparable, "reasons:", JSON.stringify(d.incomparableReasons), "debt:", d.cost.debtUsd);
console.log("A cache:", JSON.stringify(a.cache), "models:", JSON.stringify(a.models));

const s = summarizeRuns([a, b, c, d]);
console.log("SUMMARY", JSON.stringify(s, null, 1));

// clause 3: a missing rate must NOT be counted as zero spend.
const spendIfZeroCounted = [a, b, c, d].reduce((sum, r) => sum + (r.cost.totalUsd ?? 0), 0);
console.log("totalSpend(comparable only) =", s.totalSpendUsd, " naive-with-zeros =", spendIfZeroCounted, " differ:", s.totalSpendUsd !== spendIfZeroCounted || s.incomparable > 0);
