import { UsageLedger, summarizeTaskBudget, summarizeSessionUsage, emptyPricingTable } from "../../../usage.ts";
const pricing = emptyPricingTable();
pricing.rates["probe/root"] = { input: 15e-6, output: 75e-6, cacheRead: 1.5e-6, cacheWrite: 18.75e-6 };
const ledger = new UsageLedger({ pricing });
const u = (i, o) => ({ input: i, output: o, cacheRead: 0, cacheWrite: 0 });
// A perfectly ordinary session: every Root turn is attributed, every cost is priced.
ledger.recordRootTurn({ taskId: "T1", state: "planning", model: "probe/root", provider: "probe", usage: u(1000, 100), messageId: "m1" });
ledger.recordChild("T1", { kind: "worker", input: 10, output: 2, cacheRead: 0, cacheWrite: 0, pending: false, source: "sync-details", model: "probe/root", costUsd: 0.001 });
const s = summarizeSessionUsage(ledger);
console.log("session.unattributed:", JSON.stringify(s.unattributed));
console.log("session.costUnknownParts:", s.costUnknownParts, "(nothing is actually unknown here)");
// A Task with children but no Root turn yet.
ledger.recordChild("T2", { kind: "explorer", input: 5, output: 1, cacheRead: 0, cacheWrite: 0, pending: false, source: "sync-details", model: "probe/root", costUsd: 0.0005 });
const t2 = summarizeTaskBudget(ledger.taskUsage("T2"), { costUsd: 1 });
console.log("T2 root turns:", ledger.taskUsage("T2").root.turns, "costUsd.unknownParts:", t2.costUsd.unknownParts, "byRole.root:", JSON.stringify(t2.byRole.root));
