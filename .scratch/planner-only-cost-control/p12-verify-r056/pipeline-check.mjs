import { workerReportShapeReminder, extractWorkerReport, validateWorkerReport } from "../../../report.ts";
import { wrapOracleContract, lastWorkerValidationPassed, missingTaskSpecValidationCommands, oracleSuiteMode } from "../../../roles.ts";
const text = workerReportShapeReminder("T-20260908-033");
console.log("reminder:", text);
console.log("length:", text.length);
console.log("raw validate:", JSON.stringify(validateWorkerReport(JSON.parse(text))));

// full pipeline: worker pastes the contract example back as its output
const ex = extractWorkerReport(text);
console.log("extract error:", ex.error ?? "(none)");
console.log("repairs:", JSON.stringify(ex.repairs));
const r = ex.report;
console.log("normalised validation[0]:", JSON.stringify(r.validation[0]));
const spec = { validation: { commands: ["npm test"] } };
const passed = lastWorkerValidationPassed(r);
const missing = missingTaskSpecValidationCommands(spec, r);
console.log("AFTER NORMALISATION -> lastWorkerValidationPassed:", passed, " missing:", JSON.stringify(missing));
console.log(wrapOracleContract("t", oracleSuiteMode({}), passed, missing).split("\n")[1]);
