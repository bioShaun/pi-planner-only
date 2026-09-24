import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractWorkerReport } from "../../../report.ts";
const DIR = ".scratch/planner-only-cost-control/phase-a-08-run5/artifacts/subagent-artifacts";
for (const f of readdirSync(DIR).filter((n) => n.endsWith("_output.md"))) {
  const r = extractWorkerReport(readFileSync(join(DIR, f), "utf8"));
  const rep = (r.repairs ?? []).filter((x) => x.includes("status missing"));
  if (rep.length) console.log(f.slice(0, 8), JSON.stringify(rep));
}
console.log("scan done");
