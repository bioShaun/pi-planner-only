import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractWorkerReport } from "../../../report.ts";
const DIR = ".scratch/planner-only-cost-control/phase-a-08-run5/artifacts/subagent-artifacts";
for (const p of ["68b5f76e", "a5b8f153", "e567653d", "74f164e8"]) {
  const f = readdirSync(DIR).find((n) => n.startsWith(p) && n.endsWith("_output.md"));
  const r = extractWorkerReport(readFileSync(join(DIR, f), "utf8"));
  console.log(p, r.error ? "ERR " + r.error : "ok status=" + r.report.status);
}
