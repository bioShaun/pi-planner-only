import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CloseoutBroker, CLOSEOUT_TOOLS } from "./closeout-broker.ts";
import { stableStringify } from "./report.ts";
const hash = (x) => createHash("sha256").update(stableStringify(x)).digest("hex");
const identity = {taskId:"t",originExecutionId:"origin",executionId:"execution",requestId:"request",ownerRunId:"owner",runId:"run"};
const descriptor={commandId:"command",specCommandIndex:0,originalCommand:"python3 -m unittest",executable:"/usr/bin/python3",argv:["-m","unittest"],cwd:process.cwd(),environmentProfileId:"test-v1",timeoutMs:1000};
const grant = {version:1,grantId:"grant",...identity,specSha256:"a".repeat(64),originEvidenceSha256:"b".repeat(64),journalId:"test-journal",
  expectedInputs:{workspaceId:"workspace",head:"a".repeat(40),sourceManifestSha256:"a".repeat(64),gitMetadataManifestSha256:"b".repeat(64),dependencyManifestSha256:"c".repeat(64),isolationProfileSha256:"a".repeat(64),snapshotArtifactId:"snapshot",capturedAt:new Date().toISOString(),state:"complete"},
  expectedControls:{memoryMaxBytes:1073741824,memorySwapMaxBytes:0,pidsMax:32,cpuQuotaUs:100000,cpuPeriodUs:100000},commands:[{...descriptor,descriptorSha256:hash(descriptor)}],workAttemptsLimit:5,reportAttemptsLimit:1,
  executionDeadline:new Date(Date.now()+60_000).toISOString()};
delete grant.runId;
function make(effects={}) {
  const starts=[], counts={work:0,report:0}; let revoked=false; let bound=false;
  const journal = {
    associate(digest) {assert.match(digest,/^[a-f0-9]{64}$/);},
    settleAttempt(){},
    finish(){},
    bindRun(id) {assert.equal(id,"run");assert.equal(bound,false);bound=true;},
    recordAttempt(input) {
      assert.equal(revoked,false);assert.equal(bound,true);
      const category=input.toolName==="structured_output"?"report":"work";
      const ordinal=++counts[category];
      const entry={...identity,version:1,sequence:starts.length+1,occurrenceId:`occurrence-${starts.length}`,modelToolCallId:input.modelToolCallId,toolName:input.toolName,category,categoryOrdinal:ordinal,argsSha256:hash(input.args),decision:ordinal<=(category==="work"?5:1)?"permitted":"denied"};
      starts.push(entry);return entry;
    },
    revoke(){revoked=true;},
  };
  const broker=new CloseoutBroker({grant,nodeId:"node",journal,effects:{read:async()=>"read",validate:async()=>"validate",report:async()=>"report",...effects}});
  return {broker,starts,counts,bind:async()=>{await broker.associate(async()=>"a".repeat(64));return broker.bindSession({requestId:"request",ownerRunId:"owner",nodeId:"node",runId:"run",...broker.capability,activeTools:CLOSEOUT_TOOLS});}};
}
const start=(broker,id,toolName,args={})=>broker.observeToolStart({modelToolCallId:id,toolName,args});
{
  const {broker,bind,starts}=make();
  assert.throws(()=>start(broker,"before","closeout_read"),/not been bound/);
  const ack=await bind();assert.equal(ack.grantSha256,broker.capability.grantSha256);
  await assert.rejects(broker.execute("fake","closeout_read",{}),/unused permit/);
  start(broker,"read","closeout_read");
  assert.equal(await broker.execute("read","closeout_read",{}),"read");
  await assert.rejects(broker.execute("read","closeout_read",{}),/unused permit/);
  assert.equal(starts.length,1);broker.revoke("done");
}
{
  const {broker,bind,counts}=make();await bind();
  for(let i=0;i<5;i++){start(broker,`invalid-${i}`,"closeout_read");broker.observeToolEnd(`invalid-${i}`);}
  start(broker,"sixth","closeout_read");await assert.rejects(broker.execute("sixth","closeout_read",{}),/unused permit/);
  start(broker,"report","structured_output");assert.equal(await broker.execute("report","structured_output",{}),"report");
  start(broker,"report-again","structured_output");await assert.rejects(broker.execute("report-again","structured_output",{}),/unused permit/);
  assert.deepEqual(counts,{work:6,report:2});broker.revoke("done");
}
{
  let release;const barrier=new Promise(resolve=>{release=resolve;});const effects=[];
  const {broker,bind}=make({validate:async()=>{effects.push("validate-start");await barrier;effects.push("receipt-sealed");},report:async()=>{effects.push("report");}});await bind();
  start(broker,"validation","closeout_validate");start(broker,"invalid","closeout_read");start(broker,"report","structured_output");
  const first=broker.execute("validation","closeout_validate",{});
  broker.observeToolEnd("invalid");
  const report=broker.execute("report","structured_output",{});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(effects,["validate-start"]);
  release();await Promise.all([first,report]);assert.deepEqual(effects,["validate-start","receipt-sealed","report"]);broker.revoke("done");
}
{
  let effects=0;const {broker,bind}=make({read:async()=>{effects++;}});await bind();
  start(broker,"x","closeout_read",{pathId:"a"});
  await assert.rejects(broker.execute("x","closeout_read",{pathId:"b"}),/arguments changed/);assert.equal(effects,0);
  start(broker,"x","closeout_read",{pathId:"a"});
  await assert.rejects(broker.execute("x","closeout_read",{pathId:"a"}),/revoked/);
}
{
  const {broker,bind,starts}=make();await bind();start(broker,"unknown","bash");assert.equal(starts.length,1);assert.throws(()=>start(broker,"next","closeout_read"),/revoked/);
}
{
  const {broker,bind}=make();await bind();assert.throws(()=>broker.assertTools([...CLOSEOUT_TOOLS,"bg_wait"]),/exactly three/);await assert.rejects(broker.execute("x","closeout_read",{}),/revoked/);
}
{
  let calls=0;const {broker}=make();let resolve;const waiting=new Promise(r=>{resolve=r;});
  const first=broker.associate(async()=>{calls++;await waiting;return "a".repeat(64);});await assert.rejects(broker.associate(async()=>{calls++;return "a".repeat(64);}),/already attempted/);
  resolve();await first;assert.equal(calls,1);broker.revoke("done");
}
{
  const {broker,bind}=make({report:async()=>{throw new Error("WorkerReport schema error");}});await bind();
  start(broker,"bad-report","structured_output");await assert.rejects(broker.execute("bad-report","structured_output",{}),/schema error/);
  start(broker,"corrected-report","structured_output");await assert.rejects(broker.execute("corrected-report","structured_output",{}),/unused permit/);broker.revoke("done");
}
{
  const order=[];const {broker,bind}=make({report:async()=>{order.push("host");}});await bind();
  start(broker,"report","structured_output",{value:{status:"completed"}});
  await broker.execute("report","structured_output",{value:{status:"completed"}},{validate:async args=>{order.push("schema");return args.value;},capture:()=>{order.push("capture");}});
  assert.deepEqual(order,["schema","host","capture"]);broker.close();
  await assert.rejects(broker.execute("report","structured_output",{}),/revoked/);
}
{
  const order=[];const {broker,bind,counts}=make({report:async()=>{order.push("host");}});await bind();
  start(broker,"report","structured_output",{value:{}});
  await assert.rejects(broker.execute("report","structured_output",{value:{}},{validate:async()=>{throw new Error("inner schema rejected");},capture:()=>{order.push("capture");}}),/inner schema/);
  assert.equal(counts.report,1);assert.deepEqual(order,[]);assert.throws(()=>broker.close(),/not ready/);
}
console.log("PASS closeout broker: pre-schema accounting seam, single-use permits, serial receipts, quota, replay, revocation");
