// Does B7/B8's fixture actually reach reserve()'s refusal branch?
import { BudgetReservations } from "../../../reservations.ts";
const r = new BudgetReservations();
const budget = { tokens: { limit: 100, known: 0 }, costUsd: { limit: 0.5, known: 0 } };
r.reserve("t", budget, { toolCallId: "c1", tokens: 100, costUsd: 0.5 });
console.log("after first: heldCount =", r.heldCount("t"));
const out = r.reserve("t", budget, { toolCallId: "c2", tokens: 1, costUsd: 0.01 });
console.log("second refused =", Boolean(out.refused), "heldCount =", r.heldCount("t"));
