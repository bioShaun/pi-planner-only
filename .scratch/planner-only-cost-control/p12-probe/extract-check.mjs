import { readFileSync, readdirSync } from "node:fs";
import { extractWorkerReport, validateWorkerReport, workerReportShapeReminder } from "../../../report.ts";

const dir = ".scratch/planner-only-cost-control/phase-a-08-run5/artifacts/subagent-artifacts";
const wanted = ["68b5f76e", "a5b8f153", "e567653d", "74f164e8"];
for (const prefix of wanted) {
	const file = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith("_output.md"));
	const text = readFileSync(`${dir}/${file}`, "utf8");
	const out = extractWorkerReport(text, {});
	console.log(`${prefix}  ${out.report ? `OK status=${out.report.status}` : `ERR: ${out.error}`}`);
}
console.log("\n-- shape reminder itself --");
const shape = workerReportShapeReminder("T-20260908-001");
console.log(shape);
console.log("validateWorkerReport(shape) =", JSON.stringify(validateWorkerReport(JSON.parse(shape))));
