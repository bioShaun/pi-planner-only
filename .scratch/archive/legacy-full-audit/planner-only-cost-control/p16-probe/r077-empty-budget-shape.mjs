// Ticket 37 precondition: does summarizeTaskBudget(emptyTaskUsage(), limits)
// give BudgetReservations.reserve() a usable ReservationBudget when the Task
// has spent nothing yet? (limit set, known 0, so available === limit)
import { emptyTaskUsage, summarizeTaskBudget } from "../../../usage.ts";
import { BudgetReservations } from "../../../reservations.ts";

const limits = { tokens: 200000, costUsd: 0.05 };
const s = summarizeTaskBudget(emptyTaskUsage(), limits);
console.log("tokens  dim:", JSON.stringify(s.tokens));
console.log("costUsd dim:", JSON.stringify(s.costUsd));

const r = new BudgetReservations();
const out = r.reserve("T-x", { tokens: s.tokens, costUsd: s.costUsd },
	{ toolCallId: "call-1", tokens: 100000, costUsd: 0.5 });
console.log("reserve outcome:", JSON.stringify(out));
console.log("inFlight after :", JSON.stringify(r.inFlight("T-x")));
console.log("heldCount      :", r.heldCount("T-x"));

// and the second one, with the first still in flight and nothing settled
const out2 = r.reserve("T-x", { tokens: s.tokens, costUsd: s.costUsd },
	{ toolCallId: "call-2", tokens: 100000, costUsd: 0.5 });
console.log("2nd reserve    :", JSON.stringify(out2));
