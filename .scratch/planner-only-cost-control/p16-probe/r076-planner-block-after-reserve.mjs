// Planner-side probe for p16-r076 (ticket 37).
// Question: after the new first-delegation gate reserves against spec.taskId,
// is there a guard that blocks the delegation *later* in beginDelegation?
// If so the reservation is never released (no delegation record, no Task),
// and the retry of the same TaskSpec is refused forever.
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";

const BASE = "/repo";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const FIXED_NOW = () => new Date("2026-09-05T10:00:00.000Z");
const pinnedStore = () => new TaskStore({ now: FIXED_NOW });

function specFor(taskId, role = "worker") {
	return {
		taskId,
		objective: `implement ${taskId}`,
		cwd: `/fixture/${taskId}`,
		role,
		scope: { allowedPaths: ["src/parser.ts"] },
		constraints: ["no new deps"],
		acceptanceCriteria: ["tests pass"],
		validation: { required: true, commands: ["npm test"] },
		expectedEvidence: { changedFiles: true, tests: true },
		stopConditions: ["ask if ambiguous"],
	};
}

// --- scenario: validator first delegation whose TaskSpec has no validation commands.
// roles.ts:75 hasMissingRequiredValidationCommands -> orchestrate.ts:802 blocks,
// but orchestrate.ts:749 has already reserved.
const TASK = "T-20260905-880";
const bad = { ...specFor(TASK, "validator"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
bad.validation = { required: true, commands: [] };

const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
const first = await orch.beginDelegation({ toolCallId: "call-bad", input: { agent: "validator", task: JSON.stringify(bad) } }, BASE);
console.log("1st (invalid validator spec) blocked?", first?.block ? "YES: " + String(first.block.reason).split("\n")[0] : "no");
console.log("   task created in store?", orch.store.get?.(TASK) ? "yes" : "no");
console.log("   inFlight on spec.taskId :", JSON.stringify(orch.reservations.inFlight(TASK)));
console.log("   heldCount on spec.taskId:", orch.reservations.heldCount(TASK));

// --- the consequence: fix the spec and retry, same taskId, new toolCallId.
const good = { ...specFor(TASK, "validator"), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
const second = await orch.beginDelegation({ toolCallId: "call-retry", input: { agent: "validator", task: JSON.stringify(good) } }, BASE);
console.log("2nd (corrected spec) blocked?", second?.block ? "YES: " + String(second.block.reason).split("\n")[0] : "no");
console.log("   inFlight after retry    :", JSON.stringify(orch.reservations.inFlight(TASK)));
console.log("   heldCount after retry   :", orch.reservations.heldCount(TASK));
