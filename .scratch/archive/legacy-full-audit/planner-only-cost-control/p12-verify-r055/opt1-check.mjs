import { validateWorkerReport } from "../../../report.ts";
import { missingTaskSpecValidationCommands, lastWorkerValidationPassed } from "../../../roles.ts";
const base = (v) => ({ version: 1, taskId: "T-1", status: "completed", summary: "s", changedFiles: [], validation: [v], evidence: { taskId: "T-1" }, risks: [], unresolved: [] });
const spec = { validation: { commands: ["npm test"] } };
for (const v of [
  { command: "npm test", type: "test", status: "not-run", summary: "not run yet" },
  { command: "npm test", type: "test", status: "not-run", exitCode: 0, summary: "not run yet" },
  { command: "npm test", type: "test", status: "failed", exitCode: 1, summary: "npm test failed" },
]) {
  const r = base(v);
  console.log(JSON.stringify(v.status), "exitCode" in v ? "w/exitCode" : "no-exitCode",
    "| validate:", JSON.stringify(validateWorkerReport(r)),
    "| gatePassed:", lastWorkerValidationPassed(r),
    "| missing:", JSON.stringify(missingTaskSpecValidationCommands(spec, r)));
}
