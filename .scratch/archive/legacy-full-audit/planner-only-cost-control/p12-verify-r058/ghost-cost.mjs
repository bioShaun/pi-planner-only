import { UsageLedger, emptyPricingTable } from "../../../usage.ts";
const ledger = new UsageLedger({ pricing: emptyPricingTable() });
const ghost = "unbound-validator-call-xyz";
ledger.recordChild(ghost, {
  kind: "validator", agent: "oracle", runId: "r-ghost",
  input: 80, output: 16, cacheRead: 0, cacheWrite: 0, costUsd: 0.058, pending: false, source: "sync-details",
});
const u = ledger.taskUsage(ghost);
console.log("in-memory ledger under ghost id:", JSON.stringify(u && { children: u.children?.length, cost: u.childCostUsd ?? u.costUsd }));
console.log("children:", JSON.stringify(u?.children));
