import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const dir=path.resolve(process.argv[2]);
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
const rows=name=>fs.readFileSync(path.join(dir,name),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
const task=read('task.json'),events=rows('events.jsonl'),tools=rows('root-tools.jsonl');
const requests=events.filter(e=>e.event==='request').map(e=>e.payload);
const terminals=events.filter(e=>e.event==='response').map(e=>e.payload);
const versions=read('versions.json');
assert.equal(requests.length,2);assert.equal(terminals.length,2);
assert.deepEqual(task.executions.map(e=>e.executionId),['probe-first','probe-retry']);
for(const execution of task.executions){
 assert.equal(execution.endedReason,'preparation_runaway');
 assert.equal(execution.terminationConfirmed,true);
 assert.equal(execution.runawayObservation.signal,'preparation');
 assert.equal(execution.runawayObservation.observed,2);
 assert.equal(execution.runawayObservation.limit,1);
 assert.ok(execution.updateTrace.length>0&&execution.updateTrace.length<=64);
 assert.equal(execution.traceSummary.totalToolCalls,2);
 assert.equal(execution.traceSummary.readOnlyToolFraction,1);
}
assert.equal(task.writerHold,undefined);
assert.ok(terminals.every(t=>t.status==='cancelled'&&t.model.replace(/:low$/,'')===versions.childModel));
assert.equal(events.filter(e=>e.event==='cancel').length,2);
const first=JSON.parse(requests[0].task),retry=JSON.parse(requests[1].task);
assert.deepEqual(first.spec,retry.spec);
assert.equal(retry.priorExecution.executionId,'probe-first');
assert.equal(retry.priorExecution.endedReason,'preparation_runaway');
assert.equal(retry.priorExecution.recoveryReason,'Intentional preparation guard acceptance; repeat the same bounded fixture reads to verify handoff.');
assert.ok(retry.priorExecution.recentTools.length>0);
assert.equal(retry.instructions,'Continue the original fixture-only read sequence. Do not write or run shell commands.');
assert.ok(tools.every(t=>t.isError===false));
const diagnostics=tools.find(t=>t.toolName==='planner_tasks').details.diagnostics;
assert.equal(diagnostics.executions.length,2);
assert.ok(diagnostics.executions.every(e=>e.traceSummary.totalToolCalls===2));
const transcripts=fs.readdirSync(dir).filter(name=>name.startsWith('artifact-')&&name.endsWith('transcript.jsonl'));
let recovered;
for(const file of transcripts){
 const messages=rows(file).map(entry=>entry.message??entry).filter(entry=>entry.role==='user');
 const taskMessage=messages.find(entry=>Array.isArray(entry.content)&&entry.content.some(p=>p.type==='text'&&p.text.startsWith('Task: ')));
 const text=taskMessage?.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');
 if(text?.includes(requests[1].task)){recovered={file,message:taskMessage};break;}
}
assert.ok(recovered,'first task-bearing user message in actual child transcript contains the exact recovery packet');
const result={verdict:'PASS',host:versions.host,launcher:versions.launcher,launcherCommit:versions.launcherCommit,
 childModel:versions.childModel,executions:task.executions.map(e=>({executionId:e.executionId,endedReason:e.endedReason,terminationConfirmed:e.terminationConfirmed})),
 recoveryTranscript:recovered.file,originalHarnessExit:1,
 harnessCorrection:'Parse JSON transcript messages before searching; raw archives escape quotes. Original failure retained in result.json.',
 limits:'Actual Pi SDK, launcher, child model/tools and Git; scripted Root. First task-bearing user message follows a host redacted-prompt placeholder. Installed 0.70 integration does not expand declared compatibility.'};
fs.writeFileSync(path.join(dir,'recovery-child-message.json'),JSON.stringify(recovered,null,2)+'\n');
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
