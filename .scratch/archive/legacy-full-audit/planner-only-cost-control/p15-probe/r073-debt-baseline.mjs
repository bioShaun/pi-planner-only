// Ticket 15 baseline probe: what today's ledger does with unknown child cost.
import { UsageLedger, summarizeTaskBudget, loadPricingTable } from "../../../usage.ts";

const ledger = new UsageLedger({ pricing: loadPricingTable(), now: () => new Date(2026, 8, 8) });
const T = "T-20260908-950";
const LIMITS = { tokens: 200000, costUsd: 0.5 };

const keyless = (kind) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, kind, pending: true, source: "unavailable" });

// A. keyless pending child recorded twice (index.ts:576 / index.ts:622 shape).
ledger.recordChild(T, keyless("worker"));
ledger.recordChild(T, keyless("worker"));
let u = ledger.taskUsage(T);
console.log("A children after two identical keyless pending records:", u.children.length);

// B. a keyed pending child recorded twice, then resolved.
const K = "T-20260908-951";
ledger.recordChild(K, { ...keyless("worker"), toolCallId: "call-1" });
ledger.recordChild(K, { ...keyless("worker"), toolCallId: "call-1" });
console.log("B children after two identical KEYED pending records:", ledger.taskUsage(K).children.length);
ledger.recordChild(K, { input: 30000, output: 9000, cacheRead: 0, cacheWrite: 0, kind: "worker", toolCallId: "call-1", pending: false, source: "sync-details", model: "no-such-model/x" });
const kb = summarizeTaskBudget(ledger.taskUsage(K), LIMITS);
console.log("B after resolve: children=", ledger.taskUsage(K).children.length,
	"tokens.known=", kb.tokens.known, "cost.known=", kb.costUsd.known, "cost.unknownParts=", kb.costUsd.unknownParts);

// C. the gate's view: 39000 real tokens burned at an unknown rate.
const b = summarizeTaskBudget(ledger.taskUsage(K), LIMITS);
console.log("C cost.remaining as the gate sees it:", b.costUsd.remaining, "of limit", LIMITS.costUsd);
console.log("C => the money those 39000 tokens cost is worth", b.costUsd.known, "on the cost dimension");
