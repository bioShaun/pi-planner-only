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

assert.ok(process.env.PI_PLANNER_CLOSEOUT_PYTHON_TOOLS, "set PI_PLANNER_CLOSEOUT_PYTHON_TOOLS to the pinned tool closure");
const parent = process.env.CLOSEOUT_TEST_ROOT ?? path.resolve(".scratch");
assert.ok(fs.statSync(parent).isDirectory());
const root = fs.mkdtempSync(path.join(parent, "python-tools-test-"));
const cwd = path.join(root, "source");
const stagingParent = path.join(root, "snapshots");
const journalRoot = path.join(root, "journal");
for (const dir of [cwd, stagingParent, journalRoot]) fs.mkdirSync(dir);
const git = (...args) => execFileSync("/usr/bin/git", ["-C", cwd, ...args], { stdio: ["ignore", "pipe", "pipe"] });
git("init", "--quiet"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Fixture");
fs.writeFileSync(path.join(cwd, "app.py"), "def add(a: int, b: int) -> int:\n    return a + b\n");
fs.writeFileSync(path.join(cwd, "test_app.py"), `import errno
import os
from pathlib import Path
import socket
import subprocess
import sys
import pytest
from app import add


def test_add():
    assert add(2, 3) == 5


def test_isolation():
    for target in (Path('app.py'), Path('.git/config'), Path('/opt/planner-closeout/python-tools/pytest/__init__.py')):
        with pytest.raises(OSError) as caught:
            os.open(target, os.O_WRONLY)
        assert caught.value.errno in (errno.EROFS, errno.EACCES)
    with pytest.raises(OSError):
        socket.socket()
    assert os.environ['HOME'] == '/scratch/home'
    assert os.environ['TMPDIR'] == '/scratch/tmp'
    assert 'CLOSEOUT_TEST_HOST_SECRET' not in os.environ
    # Ensure the adversarial startup-hook fixture cannot short-circuit this
    # independent descendant write probe before the actual filesystem call.
    child = subprocess.run([sys.executable, '-I', '-S', '-c', "print('WRITE_ATTEMPT', flush=True); open('app.py', 'w').write('bad')"], capture_output=True)
    assert b'WRITE_ATTEMPT' in child.stdout
    assert child.returncode != 0
`);
// Adversarial module names must never replace the pinned validators.
for (const name of ["pytest", "ruff", "mypy"]) fs.writeFileSync(path.join(cwd, `${name}.py`), 'print("SHADOW VALIDATOR")\nraise SystemExit(0)\n');
// Startup hooks must not execute before the validator entry point.
fs.writeFileSync(path.join(cwd, "sitecustomize.py"), 'import os\nos._exit(0)\n');
git("add", "."); git("commit", "-qm", "fixture");
const profile = await discoverCloseoutRuntimeProfile();
assert.equal(profile.id, "system-python-tools-v1");
const commands = ["pytest -q", "ruff check .", "mypy app.py"];
const descriptors = createCloseoutCommands(commands, cwd, profile);
assert.deepEqual(descriptors.map(c => c.argv.slice(0, 2)), [["-m", "pytest"], ["-m", "ruff"], ["-m", "mypy"]]);
assert.deepEqual(createCloseoutCommands(["python3 -m pytest -q", "python3 -m ruff check .", "python3 -m mypy app.py"], cwd, profile).map(c => c.argv), descriptors.map(c => c.argv));
assert.throws(() => createCloseoutCommands(["python3 -c bad"], cwd, profile), /supported validation module/);
assert.throws(() => createCloseoutCommands(["pytest -q; echo PASS"], cwd, profile), /syntax/);
const outcomes = [];
async function fixture(label) {
  const deadlineMs = Date.now() + 180_000;
  const snapshot = createCloseoutSnapshot({ cwd, stagingParent, dependencyManifestSha256: profile.dependencyManifestSha256, isolationProfileSha256: profile.isolationProfileSha256, deadlineMs });
  const identity = { taskId: randomUUID(), originExecutionId: randomUUID(), executionId: randomUUID(), requestId: randomUUID(), ownerRunId: randomUUID(), runId: randomUUID() };
  const { runId, ...grantIdentity } = identity;
  const grant = { version: 1, grantId: randomUUID(), ...grantIdentity, specSha256: canonicalSha256(commands), originEvidenceSha256: "a".repeat(64), expectedInputs: snapshot.binding,
    expectedControls: profile.controls, commands: descriptors, workAttemptsLimit: 5, reportAttemptsLimit: 1, executionDeadline: new Date(deadlineMs).toISOString(),
    journalId: canonicalSha256({ version: 1, workspace: fs.realpathSync(cwd), taskId: identity.taskId, originExecutionId: identity.originExecutionId }) };
  const journal = CloseoutJournal.claim({ root: journalRoot, workspace: cwd, grant });
  const artifactRoot = path.join(root, label); fs.mkdirSync(artifactRoot);
  const broker = new CloseoutBroker({ grant, nodeId: identity.executionId, journal,
    effects: createCloseoutEffects({ journal, snapshot, runtimeProfile: profile, artifactRoot, submitReport: async args => args }) });
  await broker.associate(async () => {
    const body = { executionId: identity.executionId, grantSha256: journal.grantSha256 };
    const file = fs.openSync(path.join(artifactRoot, 'association.json'), 'wx', 0o600);
    try { fs.writeFileSync(file, JSON.stringify(body)); fs.fsyncSync(file); } finally { fs.closeSync(file); }
    const dir = fs.openSync(artifactRoot, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    return canonicalSha256(body);
  });
  broker.bindSession({ requestId: identity.requestId, ownerRunId: identity.ownerRunId, nodeId: identity.executionId, runId, ...broker.capability, activeTools: CLOSEOUT_TOOLS });
  const receipts = [];
  for (const command of descriptors) {
    const args = { commandId: command.commandId };
    broker.observeToolStart({ modelToolCallId: command.commandId, toolName: "closeout_validate", args });
    const result = await broker.execute(command.commandId, "closeout_validate", args);
    const receipt = journal.loadReceipt(result.receiptId);
    receipts.push(receipt);
    console.log(label, command.originalCommand, receipt.outcome, receipt.exitCode);
    if (receipt.outcome !== 'passed') console.log(journal.readArtifact(receipt.stdout).toString(), journal.readArtifact(receipt.stderr).toString());
  }
  const report = { status: label === 'success' ? 'completed' : 'blocked', receiptIds: receipts.map(r => r.receiptId) };
  broker.observeToolStart({ modelToolCallId: 'report', toolName: 'structured_output', args: report });
  await broker.execute('report', 'structured_output', report); broker.close();
  const reopened = CloseoutJournal.open({ root: journalRoot, workspace: cwd, taskId: identity.taskId, originExecutionId: identity.originExecutionId });
  const checked = validateCloseoutEvidence({ grant, identity, store: reopened, expectedCommandIds: descriptors.map(c => c.commandId), receiptIds: receipts.map(r => r.receiptId), currentInputs: verifyCloseoutSnapshot(snapshot, Date.now() + 10_000) });
  return { receipts, checked };
}
process.env.CLOSEOUT_TEST_HOST_SECRET = 'must-not-cross-sandbox';
const good = await fixture('success');
assert.equal(good.checked.valid, true, good.checked.errors.join('\n'));
assert.ok(good.receipts.every(r => r.outcome === 'passed' && r.exitCode === 0 && r.processTreeStopped));
outcomes.push({ case: 'all three tools pass; source/git/dependency/child/network/env isolation asserted', passed: true, receipts: good.receipts.map(r => r.receiptId) });
fs.writeFileSync(path.join(cwd, 'app.py'), 'import os\n\ndef add(a: int, b: int) -> int:\n    return "wrong"\n');
const bad = await fixture('failure');
assert.equal(bad.checked.valid, false);
assert.ok(bad.receipts.every(r => r.outcome === 'failed' && r.exitCode !== 0 && r.processTreeStopped));
outcomes.push({ case: 'pytest, ruff and mypy failures cannot validate', passed: true, receipts: bad.receipts.map(r => r.receiptId) });
fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ status: 'PASS', scope: 'real Python tools broker/runner; planner recovery verified separately', profile: { id: profile.id, hash: profile.isolationProfileSha256 }, outcomes }, null, 2) + '\n');
console.log(`PASS closeout Python tools: ${root}`);
