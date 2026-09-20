import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const here=path.dirname(fileURLToPath(import.meta.url));
const commands=[
 ["node",["--check",path.join(here,"run-study.mjs")]],
 ["node",["--experimental-strip-types","--check",path.join(here,"baseline-model-pin.ts")]],
 ["node",["--check",path.join(here,"run-report-only.mjs")]],
 ["node",["--experimental-strip-types","--check",path.join(here,"report-only-probe.ts")]],
 ["node",["--experimental-strip-types","--check",path.join(here,"study-observer.ts")]],
 ["node",["--experimental-strip-types","--check",path.join(here,"report-only-tool-observer.ts")]],
 ["node",[path.join(here,"study-summary.test.mjs")]],
 ["node",[path.join(here,"study-report.test.mjs")]],
 ["node",[path.join(here,"slot-audit-gate.test.mjs")]],
 ["python3",[path.join(here,"tui-proof.test.py")]]
];
const results=[];
for(const [command,args] of commands) {
 const r=spawnSync(command,args,{encoding:"utf8",env:{...process.env,PYTHONDONTWRITEBYTECODE:"1"}});
 results.push({command:[command,...args],status:r.status,signal:r.signal,error:r.error?.code,stdout:r.stdout,stderr:r.stderr});
 console.log(JSON.stringify(results.at(-1)));
}
fs.writeFileSync(path.join(here,"execution-20260920/harness-checks.json"),JSON.stringify(results,null,2)+"\n");
if(results.some(r=>r.status!==0||r.error||r.signal))process.exitCode=1;
