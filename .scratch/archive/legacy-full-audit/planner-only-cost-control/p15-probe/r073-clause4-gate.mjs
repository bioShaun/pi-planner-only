// Ticket 15 clause 4, operative half: an unknown child's debt must reach the
// 14A pre-launch gate, so a cost limit that is exhausted only by debt refuses.
import assert from "node:assert";
import { UsageLedger, summarizeTaskBudget, loadPricingTable } from "../../../usage.ts";
import { BudgetReservations } from "../../../reservations.ts";

const LIMITS = { tokens: 200000, costUsd: 0.5 };
const T = "T-clause4";
const ledger = new UsageLedger({ pricing: loadPricingTable(), now: () => new Date(2026, 8, 8) });

// Four children launched with a $0.13 grant each, none of which ever reported usage.
for (const n of [1, 2, 3, 4]) {
	ledger.recordChild(T, {
		input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
		kind: "worker", pending: true, source: "unavailable",
		toolCallId: `call-${n}`, costDebtUsd: 0.13,
	});
}
const budget = summarizeTaskBudget(ledger.taskUsage(T), LIMITS);
console.log("visible measured cost =", budget.costUsd.known - budget.costUsd.debt,
	"| debt =", budget.costUsd.debt, "| remaining =", budget.costUsd.remaining);

const outcome = new BudgetReservations().reserve(T, budget, { toolCallId: "call-5", tokens: 40000, costUsd: 0.1 });
assert.equal(outcome.grant, undefined, "a debt-exhausted cost limit must not grant");
assert.equal(outcome.refused?.dimension, "costUsd", "refusal must name the costUsd dimension");
console.log("refused on:", outcome.refused.dimension, "available:", outcome.refused.available.toFixed(4));

// Control: without the debt the very same visible subtotal would have been let through.
const blind = { ...budget, costUsd: { ...budget.costUsd, known: budget.costUsd.known - budget.costUsd.debt, debt: 0 } };
const blindOutcome = new BudgetReservations().reserve(T, blind, { toolCallId: "call-5", tokens: 40000, costUsd: 0.1 });
assert.notEqual(blindOutcome.grant, undefined, "control: the debt-blind view does grant -- that is the hole 15-a closes");
console.log("control (debt-blind view) granted:", JSON.stringify(blindOutcome.grant));
console.log("clause4-gate: PASS");
