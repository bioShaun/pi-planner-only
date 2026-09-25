// Actual installed Pi SDK + actual pi-subagents children; scripted Root, real child provider.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,"../../..");
// Deploy check (2026-09-21): RUNAWAY_PLUGIN_DIR points the harness at the installed plugin copy instead of this repo.
const pluginDir=process.env.RUNAWAY_PLUGIN_DIR?path.resolve(process.env.RUNAWAY_PLUGIN_DIR):repo;
assert.ok(fs.statSync("/project/tmp").isDirectory());
const runtime=fs.mkdtempSync("/project/tmp/runaway-host-");
fs.chmodSync(runtime,0o700);
const evidence=fs.mkdtempSync(path.join(here,"host-run-"));
const agent=path.join(runtime,"agent"), work=path.join(runtime,"workspace");
fs.mkdirSync(agent,{mode:0o700}); fs.mkdirSync(work);
const childModel=process.env.RUNAWAY_CHILD_MODEL??"tcuni-luna/gpt-5.6-luna";
const upstream=path.join(os.homedir(),".pi/agent/git/github.com/nicobailon/pi-subagents");
const host=path.join(os.homedir(),".nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent");
const piEntry=path.join(os.homedir(),".nvm/versions/node/v24.14.0/bin/pi");
process.argv[1]=piEntry;
Object.assign(process.env,{PI_CODING_AGENT_DIR:agent,TMPDIR:runtime,TMP:runtime,TEMP:runtime,
 PI_PLANNER_ONLY:"1",PI_PLANNER_ONLY_SEED_PRICING:"0",PI_PLANNER_ONLY_REQUIRE_REVIEW:"0"});
delete process.env.PI_SUBAGENT_CHILD; delete process.env.PI_OFFLINE;
for(const key of Object.keys(process.env)) if(key.startsWith("PI_PLANNER_ONLY_REQUEST_")) delete process.env[key];
const run=(cmd,args,opts={})=>{
 const r=spawnSync(cmd,args,{encoding:"utf8",...opts});
 if(r.error||r.signal||r.status!==0)throw new Error(cmd+" failed: "+(r.error?.code??r.signal??r.status)+" "+r.stderr);
 return r.stdout;
};
const save=(name,value)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2)+"\n");
for(const name of ["models.json","auth.json"]){
 const source=path.join(os.homedir(),".pi/agent",name);
 if(fs.existsSync(source)){fs.copyFileSync(source,path.join(agent,name));fs.chmodSync(path.join(agent,name),0o600);}
}
const settings={subagents:{defaultModel:childModel,agentOverrides:{
 worker:{model:childModel,thinking:"low"},"planner-scout":{model:childModel,thinking:"low"}}},
 compaction:{enabled:false},retry:{enabled:false}};
fs.writeFileSync(path.join(agent,"settings.json"),JSON.stringify(settings));
fs.writeFileSync(path.join(work,"fixture.txt"),"bounded preparation acceptance fixture\n");
run("git",["init","-q"],{cwd:work});run("git",["add","fixture.txt"],{cwd:work});
run("git",["-c","user.name=acceptance","-c","user.email=acceptance@invalid","commit","-qm","fixture"],{cwd:work});
save("versions.json",{host:JSON.parse(fs.readFileSync(path.join(host,"package.json"))).version,
 launcher:JSON.parse(fs.readFileSync(path.join(upstream,"package.json"))).version,
 launcherCommit:run("git",["-C",upstream,"rev-parse","HEAD"]).trim(),childModel,
 runtime,pluginDir,pluginHead:run("git",["-C",pluginDir,"rev-parse","HEAD"]).trim(),scope:"Real SDK, plugin, launcher, child model/tools, Git and ledgers; scripted Root provider."});
const load=p=>import(pathToFileURL(path.join(host,p)).href);
const {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager}=await load("dist/index.js");
const {fauxProvider,fauxAssistantMessage,fauxToolCall}=await load("node_modules/@earendil-works/pi-ai/dist/providers/faux.js");
const faux=fauxProvider({provider:"runaway-root-probe"});
const modelRuntime=await ModelRuntime.create({authPath:path.join(agent,"auth.json"),
 modelsPath:path.join(agent,"models.json"),allowModelNetwork:false,refreshOnCreate:false});
modelRuntime.registerNativeProvider(faux.provider);
const requests=[], events=[];
const observe=pi=>{
 for(const event of ["request","started","update","response","cancel"]){
  pi.events.on("prompt-template:subagent:"+event,p=>{
   if(event==="request")requests.push(structuredClone(p));
   const row={event,at:new Date().toISOString(),payload:structuredClone(p)};
   events.push(row);fs.appendFileSync(path.join(evidence,"events.jsonl"),JSON.stringify(row)+"\n");
  });
 }
 pi.on("tool_result",e=>fs.appendFileSync(path.join(evidence,"root-tools.jsonl"),JSON.stringify(e)+"\n"));
};
const settingsManager=SettingsManager.create(work,agent);
const loader=new DefaultResourceLoader({cwd:work,agentDir:agent,settingsManager,
 noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,
 additionalExtensionPaths:[path.join(upstream,"index.ts"),path.join(pluginDir,"index.ts")],
 extensionFactories:[{name:"runaway-observer",factory:observe}],
 systemPrompt:"Deterministic Root for bounded plugin acceptance."});
await loader.reload();
const extensionErrors=loader.getExtensions().errors;save("extension-errors.json",extensionErrors);
assert.equal(extensionErrors.length,0);
const {session}=await createAgentSession({cwd:work,agentDir:agent,model:faux.getModel(),modelRuntime,
 resourceLoader:loader,settingsManager,sessionManager:SessionManager.create(work,path.join(agent,"sessions")),
 tools:["planner_delegate","planner_redelegate","planner_tasks","planner_abort"],thinkingLevel:"off"});
const readTask=()=>JSON.parse(fs.readFileSync(path.join(agent,"planner-only","ledger",requests[0].nodeId+".json"),"utf8"));
const unwrap=value=>value.task??value;
const envelope={maxTokens:100000,maxWallMs:120000,maxReadOnlyTools:1};
const recoveryReason="Intentional preparation guard acceptance; repeat the same bounded fixture reads to verify handoff.";
const rootInstructions="Continue the original fixture-only read sequence. Do not write or run shell commands.";
const objective="Acceptance probe: call read on fixture.txt twelve times sequentially, one call at a time. Do not replace these reads with bash, do not batch calls, and do not call any write or edit tool. The controller will intentionally cancel you early. This is an authorized cancellation test.";
faux.setResponses([
 fauxAssistantMessage([fauxToolCall("planner_delegate",{role:"worker",objective,cwd:work,
  scope:{allowedPaths:["fixture.txt"]},constraints:["Read fixture.txt only; no edits, shell, delegation or network."],
  acceptanceCriteria:["Execute the specified read-only loop for the controller acceptance probe."],
  validation:{required:false},envelope},{id:"probe-first"})]),
 ()=>{
  assert.equal(requests.length,1);
  const task=unwrap(readTask()); save("first-task.json",task);
  const execution=task.executions.find(e=>e.executionId==="probe-first");
  assert.equal(execution.endedReason,"preparation_runaway");
  assert.equal(execution.terminationConfirmed,true);
  assert.equal(task.writerHold,undefined);
  return fauxAssistantMessage([fauxToolCall("planner_redelegate",{taskId:task.taskId,role:"worker",
   envelope,instructions:rootInstructions,recovery:{executionId:execution.executionId,action:"retry_same_plan",
    reason:recoveryReason,worktreeDecision:"keep"}},{id:"probe-retry"})]);
 },
 ()=>{
  const task=unwrap(readTask());save("second-task.json",task);
  const execution=task.executions.find(e=>e.executionId==="probe-retry");
  assert.equal(execution.endedReason,"preparation_runaway");assert.equal(execution.terminationConfirmed,true);
  assert.equal(task.writerHold,undefined);
  return fauxAssistantMessage([fauxToolCall("planner_tasks",{taskId:task.taskId},{id:"probe-diagnostics"})]);
 },
 fauxAssistantMessage("Acceptance probe complete.")
]);
const deadline=setTimeout(()=>session.abort(),280000);
let result;
try{
 await session.bindExtensions({mode:"json"});
 await session.prompt("Run the bounded preparation and recovery acceptance sequence.",{source:"interactive"});
 assert.equal(requests.length,2,"both real children must have been launched");
 const diagnosticEvent=fs.readFileSync(path.join(evidence,"root-tools.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line)).find(e=>e.toolName==="planner_tasks");
 assert.ok(diagnosticEvent.details.diagnostics.executions.every(e=>e.updateTrace.some(frame=>frame.currentToolArgs?.includes("fixture.txt")||frame.recentTools?.some(tool=>tool.args.includes("fixture.txt")))), "preparation diagnostics expose tool arguments");
 const task=unwrap(readTask());save("task.json",task);
 const packet=JSON.parse(requests[1].task);
 assert.equal(packet.priorExecution.executionId,"probe-first");
 assert.equal(packet.priorExecution.endedReason,"preparation_runaway");
 assert.equal(packet.instructions,rootInstructions);
 assert.deepEqual(packet.spec,JSON.parse(requests[0].task).spec);
 assert.ok(task.executions.every(e=>e.endedReason==="preparation_runaway"&&e.terminationConfirmed));
 assert.ok(task.executions.every(e=>e.updateTrace?.length>0&&e.updateTrace.length<=64));
 const terminals=events.filter(e=>e.event==="response").map(e=>e.payload);
 assert.equal(terminals.length,2);
 assert.ok(terminals.every(t=>t.model?.replace(/:low$/,"")===childModel));
 assert.equal(run("git",["status","--porcelain"],{cwd:work}),"");
 // Keep only synthetic fixture transcripts and child inputs, never private runtime configuration.
 const artifacts=[];
 function scan(dir){
  for(const item of fs.readdirSync(dir,{withFileTypes:true})){
   const full=path.join(dir,item.name);
   if(item.isDirectory())scan(full);
   else if(/(?:transcript\.jsonl|_input\.md)$/.test(item.name)){
    const body=fs.readFileSync(full,"utf8");const dest="artifact-"+artifacts.length+"-"+item.name;
    fs.writeFileSync(path.join(evidence,dest),body);artifacts.push({path:full,copy:dest,body});
   }
  }
 }
 scan(runtime);
 const transcripts=artifacts.filter(a=>a.path.endsWith("transcript.jsonl"));
 const recoveryUser=transcripts.flatMap(a=>a.body.trim().split("\n").filter(Boolean).map(line=>({file:a.copy,entry:JSON.parse(line)})))
  .find(({entry})=>{const m=entry.message??entry;return m.role==="user"&&JSON.stringify(m.content).includes("priorExecution")&&JSON.stringify(m.content).includes("probe-first");});
 assert.ok(recoveryUser,"actual recovery child user message must include priorExecution");
 save("recovery-child-message.json",recoveryUser);
 result={verdict:"PASS",evidence,childModel,executions:task.executions.map(e=>({executionId:e.executionId,
  endedReason:e.endedReason,terminationConfirmed:e.terminationConfirmed,traceLength:e.updateTrace.length})),
  recoveryMessage:recoveryUser.file,limitations:"Installed Pi 0.86.1/launcher 0.70 integration only; does not expand declared compatibility. Scripted Root; real child provider."};
 save("result.json",result);console.log(JSON.stringify(result));
}catch(error){result={verdict:"FAIL",error:String(error),stack:error.stack,evidence};save("result.json",result);throw error;}
finally{
 clearTimeout(deadline);await session.abort();session.dispose();
 for(const name of ["auth.json","models.json"])fs.rmSync(path.join(agent,name),{force:true});
 // Harness correction 2 (2026-09-21): after a clean PASS the loaded upstream launcher keeps
 // interval/handle resources alive and node never drains; record what is still open, then
 // exit explicitly by verdict. Product code is unchanged; see REPORT.md.
 save("active-resources-at-exit.json",{activeResources:process.getActiveResourcesInfo(),
  handles:(process._getActiveHandles?.()??[]).map(h=>h?.constructor?.name??typeof h),verdict:result?.verdict});
 if(result?.verdict==="PASS")process.exit(0); // FAIL keeps the uncaught throw (stack on stderr, exit 1)
}
