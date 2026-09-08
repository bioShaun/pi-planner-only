// Does "Validation: not required" ever fire on the REAL (JSON-parsed) spec path?
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore, createTaskSpec, isExplicitlyNoValidation } from "../../../task.ts";
import { extractTaskSpecDetails } from "../../../task.ts";

const BASE = "/repo";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });

const raw = {
	taskId: "T-20260908-950", objective: "no validation needed", cwd: BASE, role: "worker",
	scope: { allowedPaths: ["src/a.ts"] }, constraints: [], acceptanceCriteria: ["ship"],
	validation: { required: false },
	expectedEvidence: { changedFiles: true }, stopConditions: [],
};

// Path A: the test-only helper.
const viaHelper = createTaskSpec(raw);
console.log("A createTaskSpec  -> isExplicitlyNoValidation:", isExplicitlyNoValidation(viaHelper));

// Path B: the real production path — embedded JSON parsed by extractTaskSpecDetails.
const details = extractTaskSpecDetails(JSON.stringify(raw), BASE);
console.log("B parsed spec valid:", Boolean(details.spec), "| required:", details.spec?.validation?.required);
console.log("B extractTaskSpecDetails -> isExplicitlyNoValidation:", isExplicitlyNoValidation(details.spec));

// End to end: what does /planner-only status actually print for such a Task?
const orch = new PlannerOrchestrator({ store: new TaskStore({ now: () => new Date(2026, 8, 8) }), gitRunner });
await orch.beginDelegation({ toolCallId: "c1", input: { task: JSON.stringify(raw) } }, BASE);
const task = orch.store.get("T-20260908-950");
const status = orch.renderTaskStatus(task);
console.log("C status contains 'Validation: not required':", status.includes("Validation: not required"));
console.log("C status lines:", JSON.stringify(status.split("\n").filter(l => l.startsWith("Validation") || l.startsWith("Evidence") || l.startsWith("State:"))));
