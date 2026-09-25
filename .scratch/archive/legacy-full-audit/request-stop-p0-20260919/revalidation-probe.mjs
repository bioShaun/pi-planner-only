import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = dirname(fileURLToPath(import.meta.url));
const run = mkdtempSync(join(base, 'revalidation-run-'));
const agent = join(run, 'agent'), workspace = join(run, 'workspace');
mkdirSync(agent); mkdirSync(workspace);
writeFileSync(join(workspace, 'fixture.txt'), 'initial\n');
Object.assign(process.env, { PI_CODING_AGENT_DIR: agent, PI_PLANNER_ONLY: '1',
  PI_PLANNER_ONLY_SEED_PRICING: '0', PI_PLANNER_ONLY_QUIESCENCE_MS: '0',
  PI_PLANNER_ONLY_CANCEL_GRACE_MS: '50', PI_PLANNER_ONLY_REQUIRE_REVIEW: '0' });
delete process.env.PI_SUBAGENT_CHILD;
const { default: plannerOnly } = await import('../../index.ts');
const { hashStatus } = await import('../../evidence.ts');
const { SUBAGENT_DELEGATION_REQUEST_EVENT: REQUEST,
  SUBAGENT_DELEGATION_RESPONSE_EVENT: RESPONSE } = await import('../../subagent-delegation-contract.ts');
const handlers = new Map(), tools = new Map(), listeners = new Map(), entries = [], trace = [];
let launches = 0, seq = 0, currentHead = 'abc1234';
const events = {
  on(name, fn) { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); return () => set.delete(fn); },
  emit(name, value) { for (const fn of [...(listeners.get(name) ?? [])]) fn(value); },
};
events.on(REQUEST, request => {
  launches++;
  trace.push({ event: 'child-launch', executionId: request.requestId, taskId: request.nodeId });
  queueMicrotask(() => events.emit(RESPONSE, {
    requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
    status: 'completed', runId: `fixture-run-${launches}`, agent: 'worker', model: 'fixture/no-model',
    result: { kind: 'structured', value: {
      version: 1, taskId: request.nodeId, status: 'completed', summary: 'read fixture; no changes',
      changedFiles: [], validation: [], risks: [], unresolved: [],
      evidence: { cwd: workspace, taskId: request.nodeId, gitAvailable: true,
        baseGitRef: currentHead, finalGitRef: currentHead, gitStatusHash: hashStatus(''), changedPaths: [],
        generatedAt: new Date().toISOString() },
    } },
  }));
});
const pi = {
  on(name, fn) { handlers.set(name, fn); }, registerTool(tool) { tools.set(tool.name, tool); }, registerCommand() {},
  getActiveTools() { return ['read', 'bash', 'write']; }, getAllTools() { return [...tools.keys()].map(name => ({ name })); },
  setActiveTools() {}, appendEntry(customType, data) { entries.push({ type: 'custom', customType, data }); }, events,
  async exec(_, args) {
    const key = args.join(' ');
    const values = { 'rev-parse --git-dir': '.git\n', 'rev-parse --show-toplevel': `${workspace}\n`,
      'rev-parse HEAD': `${currentHead}\n`, 'status --porcelain=v2 --branch': '' };
    return { stdout: values[key] ?? '', stderr: '', code: 0 };
  },
};
const ctx = { cwd: workspace, hasUI: false, abort() {}, isIdle() { return false; },
  ui: { notify() {}, setStatus() {}, theme: { fg(_, text) { return text; } } },
  sessionManager: { getEntries() { return entries; }, getSessionId() { return 'revalidation-probe'; },
    getSessionFile() { return join(agent, 'session.jsonl'); } } };
plannerOnly(pi);
await handlers.get('session_start')({}, ctx);
async function call(name, params) {
  const toolCallId = `revalidate-${++seq}`;
  const gate = await handlers.get('tool_call')({ toolName: name, toolCallId, input: params }, ctx);
  assert.ok(!gate?.block, gate?.reason);
  const result = await tools.get(name).execute(toolCallId, params, undefined, undefined, ctx);
  trace.push({ event: 'tool-result', name, details: result.details });
  return result;
}
const params = { role: 'worker', objective: 'Inspect fixture', scope: { allowedPaths: ['fixture.txt'] },
  constraints: [], acceptanceCriteria: ['report inspection'], validation: { required: false } };
const first = await call('planner_delegate', params);
const taskId = first.details.taskId;
const ledgerPath = join(agent, 'planner-only', 'ledger', `${taskId}.json`);
const task = () => JSON.parse(readFileSync(ledgerPath, 'utf8')).task;
const rounds = [];
for (let i = 1; i <= 4; i++) {
  currentHead = `abc123${i + 4}`;
  writeFileSync(join(workspace, 'fixture.txt'), `external update ${i}\n`);
  const verdict = await call('planner_verdict', { taskId, verdict: 'pass', summary: `inspect current revision ${i}` });
  assert.equal(verdict.details.action, 'revalidate', JSON.stringify(verdict));
  const granted = task();
  assert.ok(granted.pendingRevalidationKey);
  const launchBefore = launches;
  await call('planner_redelegate', { ...params, taskId });
  const after = task();
  assert.equal(launches, launchBefore + 1);
  assert.equal(after.recoveryAttempts, 0, 'baseline missing dispatch accounting');
  assert.equal(after.pendingRevalidationKey, granted.pendingRevalidationKey);
  assert.equal((after.recoveryDispatches ?? []).length, 0);
  rounds.push({ round: i, grant: granted.pendingRevalidationKey, launches,
    recoveryAttempts: after.recoveryAttempts, recoveryDispatches: after.recoveryDispatches ?? [],
    pendingRevalidationKey: after.pendingRevalidationKey, reviewRound: after.reviewRound });
}
const result = { launches, rounds, ledgerPath, run,
  scope: 'Real plugin hook, registered tools, transport adapter, lifecycle and ledger; injected Git/child events; no model/network/subprocess.',
  conclusion: 'Four actual revalidation dispatches exceed the defined cap of three; counter stays zero.' };
writeFileSync(join(run, 'trace.json'), JSON.stringify(trace, null, 2));
writeFileSync(join(run, 'results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes('--assert-counter-wired')) {
  assert.ok(task().recoveryAttempts > 0, 'RECOVERY_COUNTER_UNWIRED');
}
