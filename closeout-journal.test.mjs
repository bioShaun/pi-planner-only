import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { CloseoutJournal } from "./closeout-journal.ts";
import { canonicalSha256, decodeCloseoutGrant, decodeCloseoutRuntimeObservation, validateCloseoutEvidence } from "./closeout-evidence.ts";

const workspace = process.cwd();
const scratchParent = join(workspace, ".scratch");
assert.equal(existsSync(workspace), true);
mkdirSync(scratchParent, { recursive: true });
const zero = "0".repeat(64);
const hash = (label) => canonicalSha256({ label });
const capturedAt = "2026-09-22T00:00:00.000Z";

function fixture(root, suffix = "one") {
	const identity = { taskId: `task-${suffix}`, originExecutionId: `origin-${suffix}`, executionId: `execution-${suffix}`, requestId: `request-${suffix}`, ownerRunId: `owner-${suffix}` };
	const claimHash = canonicalSha256({ version: 1, workspace, taskId: identity.taskId, originExecutionId: identity.originExecutionId });
	const input = { workspaceId: hash("workspace"), head: "abc123", sourceManifestSha256: hash("source"), gitMetadataManifestSha256: hash("git"), dependencyManifestSha256: hash("dependency"), isolationProfileSha256: hash("profile"), snapshotArtifactId: "snapshot-1", capturedAt, state: "complete" };
	const descriptorBase = { commandId: "command-1", specCommandIndex: 0, originalCommand: "node test.mjs", executable: "/usr/bin/node", argv: ["test.mjs"], cwd: workspace, environmentProfileId: "node-v1", timeoutMs: 1000 };
	const command = { ...descriptorBase, descriptorSha256: canonicalSha256(descriptorBase) };
	const controls = { memoryMaxBytes: 1073741824, memorySwapMaxBytes: 0, pidsMax: 32, cpuQuotaUs: 100000, cpuPeriodUs: 100000 };
	const grant = { version: 1, grantId: `grant-${suffix}`, ...identity, specSha256: hash("spec"), originEvidenceSha256: hash("origin-evidence"), expectedInputs: input, expectedControls: controls, commands: [command], workAttemptsLimit: 5, reportAttemptsLimit: 1, executionDeadline: "2026-09-22T01:00:00.000Z", journalId: claimHash };
	return { root, identity, input, command, controls, grant: decodeCloseoutGrant(grant) };
}

function create(f) {
	const journal = CloseoutJournal.claim({ root: f.root, workspace, grant: f.grant });
	journal.associate(hash("ledger-association"));
	journal.bindRun("run-1");
	return journal;
}

if (process.argv[2] === "claim-child") {
	const f = fixture(process.argv[3], "race");
	try { CloseoutJournal.claim({ root: f.root, workspace, grant: f.grant }); process.exit(0); }
	catch { process.exit(2); }
}

async function concurrentClaims() {
	const root = join(scratchParent, `closeout-race-${process.pid}`);
	rmSync(root, { recursive: true, force: true });
	const children = Array.from({ length: 8 }, () => new Promise((resolveChild) => {
		const child = spawn(process.execPath, ["--experimental-strip-types", import.meta.filename, "claim-child", root], { stdio: "ignore" });
		child.on("exit", resolveChild);
	}));
	const codes = await Promise.all(children);
	assert.equal(codes.filter((code) => code === 0).length, 1, "exactly one process claims an origin");
	rmSync(root, { recursive: true, force: true });
}

await concurrentClaims();

{
	const root = join(scratchParent, `closeout-count-${process.pid}`);
	const f = fixture(root, "count");
	const journal = create(f);
	const attempts = [];
	for (let i = 0; i < 6; i += 1) attempts.push(journal.recordAttempt({ modelToolCallId: `read-${i}`, toolName: "closeout_read", args: { pathId: "p", offset: 0, limit: 1 } }));
	assert.equal(attempts.filter((entry) => entry.decision === "permitted").length, 5);
	assert.equal(attempts[5].categoryOrdinal, 6);
	for (const attempt of attempts.slice(0, 5)) journal.settleAttempt(attempt.sequence, "completed");
	const report = journal.recordAttempt({ modelToolCallId: "report-1", toolName: "structured_output", args: {} });
	assert.equal(report.decision, "permitted");
	journal.settleAttempt(report.sequence, "completed");
	assert.equal(journal.recordAttempt({ modelToolCallId: "report-2", toolName: "structured_output", args: {} }).decision, "denied");
	journal.finish();
	assert.throws(() => journal.putArtifact(Buffer.from("late mutation")), /sealed/);
	const reopened = CloseoutJournal.open({ root, workspace, taskId: f.identity.taskId, originExecutionId: f.identity.originExecutionId });
	assert.equal(reopened.audit().valid, true, "sealed journal remains valid after restart");
	assert.throws(() => reopened.recordAttempt({ modelToolCallId: "replay", toolName: "closeout_read", args: { pathId: "p", offset: 0, limit: 1 } }), /read-only/);
	rmSync(root, { recursive: true, force: true });
}

{
	const root = join(scratchParent, `closeout-poison-${process.pid}`);
	const f = fixture(root, "poison");
	const journal = create(f);
	const first = journal.recordAttempt({ modelToolCallId: "dup", toolName: "closeout_read", args: { pathId: "p", offset: 0, limit: 1 } });
	assert.equal(first.decision, "permitted");
	const duplicate = journal.recordAttempt({ modelToolCallId: "dup", toolName: "closeout_read", args: { pathId: "p", offset: 0, limit: 1 } });
	assert.equal(duplicate.decision, "denied");
	assert.equal(journal.audit().state.revoked, true);
	rmSync(root, { recursive: true, force: true });
}

{
	const root = join(scratchParent, `closeout-corrupt-${process.pid}`);
	const f = fixture(root, "corrupt");
	const journal = create(f);
	journal.recordAttempt({ modelToolCallId: "one", toolName: "closeout_read", args: { pathId: "p", offset: 0, limit: 1 } });
	const attemptsPath = join(root, "claims", journal.claimHash, "attempts.ndjson");
	writeFileSync(attemptsPath, readFileSync(attemptsPath, "utf8") + "{");
	assert.equal(journal.audit().blocked, true);
	rmSync(root, { recursive: true, force: true });
}

{
	const root = join(scratchParent, `closeout-fsync-${process.pid}`);
	const f = fixture(root, "fsync");
	const journal = create(f);
	process.env.CLOSEOUT_JOURNAL_TEST_FAULT = "attempt-fsync";
	try { assert.throws(() => journal.recordAttempt({ modelToolCallId: "blocked", toolName: "closeout_read", args: { pathId: "p", offset: 0, limit: 1 } }), /injected attempt fsync failure/); }
	finally { delete process.env.CLOSEOUT_JOURNAL_TEST_FAULT; }
	assert.equal(journal.audit().state.revoked, true, "append failure revokes the grant");
	rmSync(root, { recursive: true, force: true });
}

{
	const root = join(scratchParent, `closeout-state-${process.pid}`);
	const f = fixture(root, "state");const journal=create(f);
	const first=journal.recordAttempt({modelToolCallId:"one",toolName:"closeout_read",args:{pathId:"p",offset:0,limit:1}});
	const statePath=join(root,"claims",journal.claimHash,"state.json");
	const state=JSON.parse(readFileSync(statePath,"utf8"));state.extra="corrupt";writeFileSync(statePath,JSON.stringify(state));
	assert.throws(()=>journal.getAttempt(first.sequence),/invalid journal state/);
	assert.throws(()=>journal.recordAttempt({modelToolCallId:"two",toolName:"closeout_read",args:{pathId:"p",offset:0,limit:1}}),/invalid journal state/);
	assert.throws(()=>CloseoutJournal.claim({root,workspace,grant:f.grant}),/permanently consumed/);
	rmSync(root,{recursive:true,force:true});
}

{
	const root = join(scratchParent, `closeout-evidence-${process.pid}`);
	const f = fixture(root, "evidence");
	const journal = create(f);
	const attempt = journal.recordAttempt({ modelToolCallId: "validate", toolName: "closeout_validate", args: { commandId: f.command.commandId } });
	const stdout = journal.putArtifact(Buffer.from("PASS\n"));
	const stderr = journal.putArtifact(Buffer.alloc(0));
	const kernelEvidence = journal.putArtifact(Buffer.from("kernel"));
	const identity = { ...f.identity, runId: "run-1" };
	const sample = { observedAt: capturedAt, controls: f.controls };
	const observationBase = { version: 1, ...identity, observationId: "observation-1", attemptSequence: attempt.sequence, isolationProfileSha256: f.input.isolationProfileSha256, state: "complete", scopeUnit: "unit.scope", cgroupPath: "/closeout", cgroupId: "42", hostBootId: "boot", namespaceInitPid: 123, namespaceInitStartTicks: "99", before: sample, after: sample, kernelEvidence };
	const observation = { ...observationBase, observationSha256: canonicalSha256(observationBase) };
	journal.putObservation(observation);
	const receiptBase = { version: 1, ...identity, receiptId: "receipt-1", attemptSequence: attempt.sequence, commandId: f.command.commandId, descriptorSha256: f.command.descriptorSha256, grantSha256: canonicalSha256(f.grant), startedAt: capturedAt, endedAt: capturedAt, durationMs: 1, outcome: "passed", exitCode: 0, signal: null, timedOut: false, cancelled: false, startupError: null, processTreeStopped: true, beforeInputs: f.input, afterInputs: f.input, stdout, stderr, runtimeObservationId: observation.observationId, runtimeObservationSha256: observation.observationSha256 };
	const receipt = { ...receiptBase, receiptSha256: canonicalSha256(receiptBase) };
	journal.putReceipt(receipt);
	const result = validateCloseoutEvidence({ grant: f.grant, identity, store: journal, expectedCommandIds: [f.command.commandId], receiptIds: [receipt.receiptId], currentInputs: f.input });
	assert.equal(result.valid, true, result.errors.join("\n"));
	const wrongIdentity = validateCloseoutEvidence({ grant: f.grant, identity: { ...identity, runId: "other-run" }, store: journal, expectedCommandIds: [f.command.commandId], receiptIds: [receipt.receiptId], currentInputs: f.input });
	assert.equal(wrongIdentity.valid, false, "cross-run evidence is rejected");
	const validate = (overrides = {}) => validateCloseoutEvidence({ grant: f.grant, identity, expectedCommandIds: [f.command.commandId], receiptIds: [receipt.receiptId], currentInputs: f.input,
		store: {audit:()=>journal.audit(),getAttempt:n=>journal.getAttempt(n),loadReceipt:id=>journal.loadReceipt(id),loadObservation:id=>journal.loadObservation(id),readArtifact:d=>journal.readArtifact(d),...overrides} });
	const reseal = (record, key) => { const body={...record};delete body[key];return {...body,[key]:canonicalSha256(body)}; };
	for (const side of ["before","after"]) for (const control of Object.keys(f.controls)) {
		const changed=structuredClone(observation);changed[side].controls[control]++;
		const changedObservation=reseal(changed,"observationSha256");
		const changedReceipt=reseal({...receipt,runtimeObservationSha256:changedObservation.observationSha256},"receiptSha256");
		assert.equal(validate({loadObservation:()=>changedObservation,loadReceipt:()=>changedReceipt}).valid,false,`${side}.${control} mismatch fails even with consistent hashes`);
	}
	for (const mutation of [{exitCode:1},{outcome:"failed"},{timedOut:true},{cancelled:true},{signal:"SIGTERM"},{startupError:"failed"},{processTreeStopped:false}]) {
		assert.equal(validate({loadReceipt:()=>reseal({...receipt,...mutation},"receiptSha256")}).valid,false,JSON.stringify(mutation));
	}
	assert.equal(validate({audit:()=>({valid:false,blocked:true,reasons:[]})}).valid,false,"empty audit errors cannot turn invalid into valid");
	assert.equal(validate({loadObservation:()=>{throw new Error("missing");}}).valid,false,"missing host observation fails");
	assert.equal(validate({readArtifact:()=>Buffer.from("forged")}).valid,false,"changed raw bytes fail");
	assert.equal(validate({getAttempt:()=>undefined}).valid,false,"receipt without permit fails");
	const forged = { ...receipt, exitCode: 1 };
	assert.throws(() => journal.putReceipt(forged), /receiptSha256/);
	journal.finish();
	rmSync(root, { recursive: true, force: true });
}

assert.throws(() => decodeCloseoutRuntimeObservation({}), /unknown field|missing/);
assert.throws(() => decodeCloseoutGrant({ ...fixture("unused", "strict").grant, extra: true }), /unknown field/);
assert.throws(() => decodeCloseoutGrant({ ...fixture("unused", "finite").grant, expectedControls: { ...fixture("unused", "finite").controls, pidsMax: Number.POSITIVE_INFINITY } }), /safe integer/);
console.log("closeout-journal tests: PASS");
