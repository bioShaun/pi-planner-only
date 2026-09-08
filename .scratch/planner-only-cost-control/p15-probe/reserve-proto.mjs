// Prototype for ticket 14A: check-and-reserve + balance-capped limits.
// Pure logic, exercised against the real summarizeTaskBudget output shape.
import { emptyTaskUsage, summarizeTaskBudget } from "../../../usage.ts";
import { resolveEffectiveLimits } from "../../../floors.ts";

class Reservations {
	#byTask = new Map();      // taskId -> Map<toolCallId, {tokens?, costUsd?}>
	inFlight(taskId) {
		let t = 0, c = 0;
		for (const r of this.#byTask.get(taskId)?.values() ?? []) { t += r.tokens ?? 0; c += r.costUsd ?? 0; }
		return { tokens: t, costUsd: c };
	}
	// ATOMIC: one synchronous body, no await. Returns a refusal or a reservation.
	reserve(taskId, budget, desired) {
		const held = this.inFlight(taskId);
		const avail = (dim, heldAmount) => dim.limit === undefined
			? undefined
			: dim.limit - dim.known - heldAmount;
		const availTokens = avail(budget.tokens, held.tokens);
		const availCost = avail(budget.costUsd, held.costUsd);
		for (const [name, a] of [["tokens", availTokens], ["costUsd", availCost]]) {
			if (a !== undefined && a <= 0) {
				return { refused: { dimension: name, available: a, held, budget } };
			}
		}
		const grant = {
			...(availTokens === undefined ? {} : { tokens: Math.min(availTokens, desired.tokens ?? Infinity) }),
			...(availCost === undefined ? {} : { costUsd: Math.min(availCost, desired.costUsd ?? Infinity) }),
		};
		const m = this.#byTask.get(taskId) ?? this.#byTask.set(taskId, new Map()).get(taskId);
		m.set(desired.toolCallId, grant);
		return { grant };
	}
	release(taskId, toolCallId) { this.#byTask.get(taskId)?.delete(toolCallId); }
}

const usage = emptyTaskUsage();
usage.children.push({ kind: "worker", calls: 1, turns: 1, input: 40000, output: 8000, cacheRead: 0, cacheWrite: 0, costUsd: 0.19 });
const limits = { tokens: 50000, costUsd: 0.20 };
const budget = summarizeTaskBudget(usage, limits);
const res = new Reservations();
const floors = resolveEffectiveLimits({ role: "worker", reportsCount: 1 });
const desiredFloor = { tokens: floors.tokens.value, costUsd: floors.costUsd.value };

// C1: remaining (2000 tok / $0.01) is smaller than the floor -> grant is the balance.
const r1 = res.reserve("T1", budget, { ...desiredFloor, toolCallId: "c1" });
console.log("C1 grant:", JSON.stringify(r1.grant), "(floor was", JSON.stringify(desiredFloor) + ")");

// C2: a concurrent second delegation sees the first reservation deducted.
const r2 = res.reserve("T1", budget, { ...desiredFloor, toolCallId: "c2" });
console.log("C2 second:", JSON.stringify(r2.refused ? { refused: r2.refused.dimension, available: r2.refused.available } : r2.grant));

// C3: caller stricter than the balance still wins (min of all candidates).
const capped = resolveEffectiveLimits({
	role: "worker", reportsCount: 1,
	callerUsageBudget: { tokens: { hard: 500 }, costUsd: { hard: 0.5 } },
});
console.log("C3 caller-stricter floors:", JSON.stringify(capped.tokens), JSON.stringify(capped.costUsd));
console.log("C3 with balance cap 2000 -> tokens should stay 500 (caller):",
	Math.min(capped.tokens.value, 2000), "| cost should be 0.01 (balance):", Math.min(capped.costUsd.value, 0.01));

// C4: cost exhausted while tokens are not.
const usage2 = emptyTaskUsage();
usage2.children.push({ kind: "worker", calls: 1, turns: 1, input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0.20 });
const b2 = summarizeTaskBudget(usage2, limits);
const r4 = new Reservations().reserve("T2", b2, { ...desiredFloor, toolCallId: "c1" });
console.log("C4 refusal:", JSON.stringify({
	dimension: r4.refused?.dimension, available: r4.refused?.available,
	knownTokens: b2.tokens.known, knownCost: b2.costUsd.known,
	unknownTok: b2.tokens.unknownParts, unknownCost: b2.costUsd.unknownParts,
}));

// C5: unconfigured cumulativeBudget -> no cap, no refusal.
const b3 = summarizeTaskBudget(usage, undefined);
const r5 = new Reservations().reserve("T3", b3, { ...desiredFloor, toolCallId: "c1" });
console.log("C5 unconfigured grant:", JSON.stringify(r5.grant), "refused:", Boolean(r5.refused));
