// Run in an ordinary terminal. Never import upstream raw TypeScript APIs.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertClearSlotAudit } from "./slot-audit-gate.mjs";
const here=path.dirname(fileURLToPath(import.meta.url));
const rootModel=process.env.STUDY_ROOT_MODEL, childModel=process.env.STUDY_CHILD_MODEL;
if(!rootModel?.includes("/") || !childModel?.includes("/")) throw new Error("Explicit Root and child models required");
if(!fs.statSync("/project/tmp").isDirectory() || !fs.statSync(here).isDirectory()) throw new Error("Invalid scratch parent");
const runtime=fs.mkdtempSync("/project/tmp/planner-zero-tools-");fs.chmodSync(runtime,0o700);
const evidence=fs.mkdtempSync(path.join(here,"report-only-run-"));
const agent=path.join(runtime,"agent"),work=path.join(runtime,"workspace");
fs.mkdirSync(agent,{mode:0o700});fs.mkdirSync(work);
const env={...process.env,TMPDIR:runtime,TMP:runtime,TEMP:runtime,PI_CODING_AGENT_DIR:agent,STUDY_PROBE_EVIDENCE:evidence,PI_PLANNER_ONLY:"0"};
delete env.PI_SUBAGENT_CHILD;
const run=(command,args,opts={})=>{
 const r=spawnSync(command,args,{encoding:"utf8",env,...opts});
 if(r.error || r.signal || r.status!==0) throw new Error(command+" failed: "+(r.error?.code??r.signal??r.status));
 return r.stdout;
};
for(const [name,source] of [["models.json",process.env.STUDY_MODELS_FILE??path.join(os.homedir(),".pi/agent/models.json")],
 ["auth.json",process.env.STUDY_AUTH_FILE??path.join(os.homedir(),".pi/agent/auth.json")]]) {
 if(fs.existsSync(source)){fs.copyFileSync(source,path.join(agent,name));fs.chmodSync(path.join(agent,name),0o600);}
}
fs.writeFileSync(path.join(agent,"settings.json"),"{}\n");
fs.writeFileSync(path.join(work,"fixture.txt"),"zero tools\n");
run("git",["init","-q"],{cwd:work});run("git",["add","."],{cwd:work});
run("git",["-c","user.name=study","-c","user.email=study@invalid","commit","-qm","fixture"],{cwd:work});
const launcher=path.join(os.homedir(),".pi/agent/npm/node_modules/pi-subagents");
const versions={host:run("pi",["--version"]).trim(),launcher:JSON.parse(fs.readFileSync(path.join(launcher,"package.json"))).version,rootModel,childModel,thinking:env.STUDY_THINKING??"low",runtime};
fs.writeFileSync(path.join(evidence,"versions.json"),JSON.stringify(versions,null,2)+"\n");
if(versions.host!=="0.85.1"||versions.launcher!=="0.69.0") throw new Error("Host/launcher version drift");
for(const check of ["audit","status"]) {
 const r=spawnSync("slot",[check],{encoding:"utf8",env});
 fs.writeFileSync(path.join(evidence,"slot-"+check+".json"),JSON.stringify(r,null,2)+"\n");
 if(r.error||r.signal||r.status!==0)throw new Error("slot "+check+" failed");
 if(check==="audit")assertClearSlotAudit(r.stdout,r.stderr);
}
const idx=rootModel.indexOf("/");
const args=["cpu","--","timeout","150","pi","-p","--mode","json","--no-extensions","--no-skills","--no-prompt-templates",
 "-e",path.join(launcher,"index.ts"),"-e",path.join(here,"report-only-probe.ts"),
 "--provider",rootModel.slice(0,idx),"--model",rootModel.slice(idx+1),"--thinking",env.STUDY_THINKING??"low","/study-zero-tools"];
const out=fs.openSync(path.join(evidence,"stdout.log"),"w"),err=fs.openSync(path.join(evidence,"stderr.log"),"w");
const started=Date.now();const r=spawnSync("slot",args,{cwd:work,env,stdio:["ignore",out,err]});fs.closeSync(out);fs.closeSync(err);
const changed=run("git",["status","--porcelain"],{cwd:work});
const execution={command:["slot",...args],status:r.status,signal:r.signal,error:r.error?.code,durationMs:Date.now()-started,changed};
fs.writeFileSync(path.join(evidence,"execution.json"),JSON.stringify(execution,null,2)+"\n");
const resultPath=path.join(evidence,"result.json");
const passed=r.status===0&&!r.error&&!r.signal&&changed===""&&fs.existsSync(resultPath)&&JSON.parse(fs.readFileSync(resultPath)).verdict==="PASS";
console.log(JSON.stringify({verdict:passed?"PASS":"NOT_PROVEN",evidence,runtime,...execution},null,2));
if(!passed)process.exitCode=1;
