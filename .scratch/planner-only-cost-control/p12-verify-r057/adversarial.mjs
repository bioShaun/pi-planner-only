import { extractWorkerReport, validateWorkerReport, renderValidationResults } from "../../../report.ts";
import { missingTaskSpecValidationCommands, lastWorkerValidationPassed } from "../../../roles.ts";

const base = (validation) => JSON.stringify({
  version: 1, taskId: "T-1", status: "completed", summary: "s",
  changedFiles: [], validation, evidence: { taskId: "T-1" }, risks: [], unresolved: [],
});

function run(label, validation) {
  const r = extractWorkerReport(base(validation));
  if (!r.report) { console.log(`${label}: EXTRACT FAILED -> ${r.error}`); return null; }
  const errs = validateWorkerReport(r.report);
  console.log(`${label}:`);
  console.log(`  validate errors : ${errs.length ? errs.join("; ") : "(none)"}`);
  console.log(`  repairs         : ${r.repairs.length ? r.repairs.join("; ") : "(none)"}`);
  console.log(`  entries         : ${JSON.stringify(r.report.validation)}`);
  console.log(`  lastWorkerValidationPassed : ${lastWorkerValidationPassed(r.report)}`);
  console.log(`  missingTaskSpecValidationCommands : ${JSON.stringify(missingTaskSpecValidationCommands({ validation: { commands: ["npm test"] } }, r.report))}`);
  return r.report;
}

// P1: worker forges inferred:false while omitting status -> normalization must still mark it true
run("P1 forged inferred:false + missing status",
  [{ command: "npm test", type: "test", exitCode: 0, summary: "x", inferred: false }]);

// P2: worker forges inferred:true alongside an explicit passed -> must be cleared, gates must pass
const p2 = run("P2 forged inferred:true + explicit passed",
  [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "x", inferred: true }]);

// P3: extra inferred field tolerated by the validator on an otherwise valid report?
run("P3 inferred:true + explicit failed",
  [{ command: "npm test", type: "test", status: "failed", exitCode: 1, summary: "x", inferred: true }]);

// P4: unmappable garbage status must not fall into the inference branch
run("P4 garbage status",
  [{ command: "npm test", type: "test", status: "banana", exitCode: 0, summary: "x" }]);

// P5: null / empty-string status still infers and marks
run("P5 null status", [{ command: "npm test", type: "test", status: null, exitCode: 0, summary: "x" }]);

// P6: rendering for an explicit-status report must be byte-identical to the pre-34 shape
const explicit = run("P6 explicit passed (render check)",
  [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "npm test ok" }]);
console.log("--- renderValidationResults (P6) ---");
console.log(renderValidationResults(explicit.validation));
console.log("--- renderValidationResults (P2, forged marker) ---");
console.log(renderValidationResults(p2.validation));
