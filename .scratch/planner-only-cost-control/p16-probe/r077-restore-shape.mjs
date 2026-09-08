// Planner prototype for 16-b before dispatch: if the snapshot is loaded back
// into a fresh TaskStore, does the gate actually clamp to the RESTORED balance,
// and does the lifecycle let a restored `changes_requested` Task delegate again?
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LedgerSnapshotStore } from "../../../ledger-store.ts";
import { TaskStore } from "../../../task.ts";
import { PlannerOrchestrator } from "../../../orchestrate.ts";

const dir = mkdtempSync(join(process.cwd(), ".p16-probe-"));
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const TASK = "T-20260908-960";

// --- session A: build a Task that has spent $0.04 of $0.05, then snapshot it.
const ledger = new LedgerSnapshotStore(dir);
const storeA = new TaskStore({ onPersist: (r) => ledger.write(r) });
const specA = {
	taskId: TASK, objective: "restore probe", cwd: `/fixture/${TASK}`, role: "worker",
	scope: { allowedPaths: ["src/parser.ts"] }, constraints: ["no new deps"],
	acceptanceCriteria: ["tests pass"], validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true }, stopConditions: ["ask if ambiguous"],
	cumulativeBudget: { tokens: 200000, costUsd: 0.05 },
};
const taskA = storeA.create(specA);
taskA.usage.children = [{ input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0.04 }];
storeA.transition(TASK, "executing");
storeA.persist(storeA.require(TASK));

const snapshot = JSON.parse(readFileSync(join(dir, "planner-only", "ledger", `${TASK}.json`), "utf8"));
console.log("snapshot state       :", snapshot.task.state);
console.log("snapshot children $  :", snapshot.task.usage.children.map((c) => c.costUsd));

// --- session B: fresh store, hand-restore the record, then delegate.
const storeB = new TaskStore();
storeB.tasks.set(snapshot.task.taskId, snapshot.task);   // the shape restore() would install
const orch = new PlannerOrchestrator({ gitRunner, store: storeB });

const input = { agent: "worker", task: JSON.stringify(specA) };
const out = await orch.beginDelegation({ toolCallId: "call-restored", input }, "/repo");
console.log("\nafter restore, delegating again:");
console.log("  blocked?", out?.block ? "YES: " + String(out.block.reason).split("\n")[0] : "no");
console.log("  usageBudget handed:", JSON.stringify(input.usageBudget));
console.log("\nstatus of the restored Task:");
console.log(orch.renderTaskStatus(storeB.require(TASK)));

rmSync(dir, { recursive: true, force: true });
