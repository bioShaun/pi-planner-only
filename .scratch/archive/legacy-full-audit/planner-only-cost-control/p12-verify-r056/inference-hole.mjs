import { extractWorkerReport } from "../../../report.ts";
import { lastWorkerValidationPassed, missingTaskSpecValidationCommands, wrapOracleContract, oracleSuiteMode } from "../../../roles.ts";
const spec = { validation: { commands: ["npm test"] } };
const mk = (v) => JSON.stringify({ version: 1, taskId: "T-1", status: "completed", summary: "s", changedFiles: [], validation: [v], evidence: { taskId: "T-1" }, risks: [], unresolved: [] });
for (const [label, v] of [
  ["status dropped, exitCode 0", { command: "npm test", type: "test", exitCode: 0, summary: "ran it" }],
  ["status empty string, exitCode 0", { command: "npm test", type: "test", status: "", exitCode: 0, summary: "ran it" }],
  ["status not-run kept (reminder)", { command: "npm test", type: "test", status: "not-run", exitCode: 0, summary: "not run" }],
]) {
  const ex = extractWorkerReport(mk(v));
  const r = ex.report;
  const passed = lastWorkerValidationPassed(r);
  const missing = missingTaskSpecValidationCommands(spec, r);
  console.log(label, "| repairs:", JSON.stringify(ex.repairs), "| status→", r.validation[0].status,
    "| gatePassed:", passed, "| missing:", JSON.stringify(missing),
    "|", wrapOracleContract("t", oracleSuiteMode({}), passed, missing).split("\n")[1].split(".")[0]);
}
