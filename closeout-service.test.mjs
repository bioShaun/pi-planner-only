import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { CloseoutJournal } from "./closeout-journal.ts";
import { CloseoutBroker, CLOSEOUT_TOOLS } from "./closeout-broker.ts";
import { createCloseoutEffects } from "./closeout-service.ts";
import { createCloseoutSnapshot, createCloseoutCommands, verifyCloseoutSnapshot } from "./closeout-snapshot.ts";
import { discoverCloseoutRuntimeProfile } from "./closeout-sandbox.ts";
import { canonicalSha256, validateCloseoutEvidence } from "./closeout-evidence.ts";

assert.ok(fs.statSync(process.cwd()).isDirectory());
fs.mkdirSync(".scratch",{recursive:true});
const root=fs.mkdtempSync(path.resolve(".scratch/closeout-service-test-"));
const cwd=path.join(root,"source");const stagingParent=path.join(root,"snapshots");const journalRoot=path.join(root,"journal");
for(const dir of [cwd,stagingParent,journalRoot])fs.mkdirSync(dir,{mode:0o700});
const git=(...args)=>execFileSync("/usr/bin/git",["-C",cwd,...args],{stdio:["ignore","pipe","pipe"]});
git("init","--quiet");git("config","user.email","test@example.invalid");git("config","user.name","Test");
fs.writeFileSync(path.join(cwd,"test_fixture.py"),"import unittest\nclass Check(unittest.TestCase):\n    def test_ok(self):\n        self.assertEqual(2 + 2, 4)\n");git("add",".");git("commit","-qm","fixture");
const profile=await discoverCloseoutRuntimeProfile();
const outcomes=[];
async function fixture({failSeal=false}={}) {
  const deadlineMs=Date.now()+60_000;
  const snapshot=createCloseoutSnapshot({cwd,stagingParent,dependencyManifestSha256:profile.dependencyManifestSha256,isolationProfileSha256:profile.isolationProfileSha256,deadlineMs});
  const identity={taskId:randomUUID(),originExecutionId:randomUUID(),executionId:randomUUID(),requestId:randomUUID(),ownerRunId:randomUUID(),runId:randomUUID()};
  const {runId,...grantIdentity}=identity;
  const commands=createCloseoutCommands(["python3 -m unittest discover"],cwd,profile,15_000);
  const grant={version:1,grantId:randomUUID(),...grantIdentity,specSha256:canonicalSha256({commands:["python3 -m unittest discover"]}),originEvidenceSha256:"a".repeat(64),expectedInputs:snapshot.binding,
    expectedControls:{memoryMaxBytes:1073741824,memorySwapMaxBytes:0,pidsMax:32,cpuQuotaUs:100000,cpuPeriodUs:100000},commands,workAttemptsLimit:5,reportAttemptsLimit:1,executionDeadline:new Date(deadlineMs).toISOString(),
    journalId:canonicalSha256({version:1,workspace:fs.realpathSync(cwd),taskId:identity.taskId,originExecutionId:identity.originExecutionId})};
  const journal=CloseoutJournal.claim({root:journalRoot,workspace:cwd,grant});
  const artifactRoot=path.join(root,`runner-${randomUUID()}`);fs.mkdirSync(artifactRoot,{mode:0o700});
  const effects=createCloseoutEffects({journal,snapshot,runtimeProfile:profile,artifactRoot,submitReport:async args=>args});
  const broker=new CloseoutBroker({grant,nodeId:identity.executionId,journal,effects});
  await broker.associate(async()=>{
    const association={executionId:identity.executionId,grantSha256:journal.grantSha256};
    const fd=fs.openSync(path.join(root,`association-${identity.executionId}.json`),"wx",0o600);
    try{fs.writeFileSync(fd,JSON.stringify(association));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const parent=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
    return canonicalSha256(association);
  });
  broker.bindSession({requestId:identity.requestId,ownerRunId:identity.ownerRunId,nodeId:identity.executionId,runId,...broker.capability,activeTools:CLOSEOUT_TOOLS});
  if(failSeal) journal.putReceipt=()=>{throw new Error("injected receipt persistence failure");};
  const args={commandId:commands[0].commandId};broker.observeToolStart({modelToolCallId:"validate",toolName:"closeout_validate",args});
  const run=()=>broker.execute("validate","closeout_validate",args);
  return {grant,identity,journal,snapshot,broker,run};
}
const good=await fixture();
const result=await good.run();assert.equal(result.outcome,"passed");
const receipt=good.journal.loadReceipt(result.receiptId);
assert.equal(receipt.processTreeStopped,true);assert.equal(receipt.exitCode,0);
const observation=good.journal.loadObservation(receipt.runtimeObservationId);
assert.equal(observation.state,"complete");assert.deepEqual(observation.before.controls,good.grant.expectedControls);assert.deepEqual(observation.after.controls,good.grant.expectedControls);
assert.ok(good.journal.readArtifact(receipt.stderr).toString().includes("OK"));
good.broker.observeToolStart({modelToolCallId:"report",toolName:"structured_output",args:{receiptId:result.receiptId}});
await good.broker.execute("report","structured_output",{receiptId:result.receiptId});good.broker.close();
const reopened=CloseoutJournal.open({root:journalRoot,workspace:cwd,taskId:good.identity.taskId,originExecutionId:good.identity.originExecutionId});
const evidence={grant:good.grant,identity:good.identity,store:reopened,expectedCommandIds:good.grant.commands.map(c=>c.commandId),receiptIds:[result.receiptId],currentInputs:verifyCloseoutSnapshot(good.snapshot,Date.now()+60_000)};
const checked=validateCloseoutEvidence(evidence);assert.equal(checked.valid,true,checked.errors.join("\n"));
assert.equal(validateCloseoutEvidence({...evidence,identity:{...good.identity,executionId:"different"}}).valid,false);
assert.equal(validateCloseoutEvidence({...evidence,receiptIds:[result.receiptId,result.receiptId]}).valid,false);
await assert.rejects(good.broker.execute("report","structured_output",{receiptId:result.receiptId}),/revoked/);
outcomes.push({case:"sealed real validation survives normal close and read-only reopen",receiptId:result.receiptId,passed:true});

fs.writeFileSync(path.join(cwd,"test_fixture.py"),"import unittest\nclass Check(unittest.TestCase):\n    def test_failure(self):\n        print('PASS is only text')\n        self.assertTrue(False)\n");
assert.throws(()=>verifyCloseoutSnapshot(good.snapshot,Date.now()+60_000),/drifted/);
const bad=await fixture();const failed=await bad.run();assert.equal(failed.outcome,"failed");assert.notEqual(failed.exitCode,0);
const failCheck=validateCloseoutEvidence({grant:bad.grant,identity:bad.identity,store:bad.journal,expectedCommandIds:bad.grant.commands.map(c=>c.commandId),receiptIds:[failed.receiptId],currentInputs:bad.snapshot.binding});
assert.equal(failCheck.valid,false);bad.broker.revoke("test complete: failed validation");
outcomes.push({case:"printed PASS with failing exit cannot validate",receiptId:failed.receiptId,passed:true});

const disk=await fixture({failSeal:true});await assert.rejects(disk.run());assert.equal(disk.journal.audit().blocked,true);
assert.throws(()=>CloseoutJournal.claim({root:journalRoot,workspace:cwd,grant:disk.grant}));
try{disk.broker.revoke("seal failure fixture complete");}catch{}
outcomes.push({case:"receipt persistence failure consumes permanent origin claim",passed:true});
fs.writeFileSync(path.join(root,"result.json"),JSON.stringify({status:"PASS",scope:"03-A host broker/evidence only; no WorkerReport or recovery acceptance",outcomes},null,2)+"\n");
console.log(`PASS closeout production service: ${root}`);
