// Ticket 15 clause 1, second half: a duplicate completion must release the
// reservation once, and must not disturb any other in-flight reservation.
import assert from "node:assert";
import { BudgetReservations } from "../../../reservations.ts";

const budget = {
	tokens: { limit: 200000, known: 0, unknownParts: 0, debt: 0, remaining: 200000 },
	costUsd: { limit: 0.5, known: 0, unknownParts: 0, debt: 0, remaining: 0.5 },
};
const r = new BudgetReservations();
r.reserve("T1", budget, { toolCallId: "call-a", tokens: 40000, costUsd: 0.12 });
r.reserve("T1", budget, { toolCallId: "call-b", tokens: 40000, costUsd: 0.12 });
assert.deepEqual(r.inFlight("T1"), { tokens: 80000, costUsd: 0.24 });

r.release("T1", "call-a");
const afterFirst = r.inFlight("T1");
r.release("T1", "call-a");                       // the duplicate notification
const afterSecond = r.inFlight("T1");
assert.deepEqual(afterFirst, { tokens: 40000, costUsd: 0.12 }, "first release returns exactly call-a's hold");
assert.deepEqual(afterSecond, afterFirst, "the duplicate release must be inert");
assert.notEqual(r.grantFor("call-b"), undefined, "call-b's reservation must survive the duplicate");

r.releaseByToolCall("call-b");
r.releaseByToolCall("call-b");
assert.deepEqual(r.inFlight("T1"), { tokens: 0, costUsd: 0 });
console.log("clause1-double-release: PASS");
