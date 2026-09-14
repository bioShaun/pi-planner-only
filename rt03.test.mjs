import assert from "node:assert/strict";
import { extractWorkerReport } from "./report.ts";
import { createTaskSpec, validateTaskSpec, TaskStore, canTransition } from "./task.ts";

const taskId = "T-20260912-026";
const evidence = { taskId, cwd: "/repo", workerRunId: "run-b10", generatedAt: "2026-09-12T00:00:00.000Z" };

const repaired = extractWorkerReport(JSON.stringify({
	version: "1",
	taskId,
	status: "done",
	summary: "completed",
	changedFiles: "src/index.ts",
	validation: { type: "tsc", status: "pass", command: "npm run typecheck" },
	evidence,
	risks: [],
	unresolved: [],
}));
assert.equal(repaired.ok, true);
assert.equal(repaired.level, "repairable");
assert.equal(repaired.report.status, "completed");
assert.deepEqual(repaired.report.changedFiles, ["src/index.ts"]);
assert.equal(repaired.report.validation[0].type, "typecheck");
assert.equal(repaired.report.validation[0].status, "passed");
assert.ok(repaired.repairs.length > 0);

const invalid = extractWorkerReport(JSON.stringify({ version: 1, taskId, status: "???" }));
assert.equal(invalid.ok, false);
assert.equal(invalid.level, "irreparable");
assert.equal("report" in invalid, false);

assert.equal(canTransition("executing", "report-invalid"), true);
assert.equal(canTransition("report-invalid", "reviewing"), true);

const spec = createTaskSpec({
	taskId,
	objective: "use pre-located evidence",
	cwd: "/repo",
	contextPack: [{ path: "src/index.ts", startLine: 10, endLine: 20, summary: "delegation boundary" }],
});
assert.deepEqual(validateTaskSpec(spec), []);
assert.deepEqual(spec.contextPack?.[0], { path: "src/index.ts", startLine: 10, endLine: 20, summary: "delegation boundary" });

const store = new TaskStore();
const task = store.create(spec);
task.state = "report-invalid";
task.rawReport = { executionId: "run-b10", text: "{malformed}", error: "invalid WorkerReport", receivedAt: new Date().toISOString() };
assert.equal(task.rawReport.executionId, "run-b10");

console.log("rt03: PASS");
