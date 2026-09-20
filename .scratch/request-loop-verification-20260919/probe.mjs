import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// No subprocesses, network, model calls, or writes outside this directory.
const base = dirname(fileURLToPath(import.meta.url));
const run = mkdtempSync(join(base, 'run-'));
const agent = join(run, 'agent');
const workspace = join(run, 'workspace');
mkdirSync(agent); mkdirSync(workspace);
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PI_PLANNER_ONLY = '1';
process.env.PI_PLANNER_ONLY_SEED_PRICING = '0';
process.env.PI_PLANNER_ONLY_QUIESCENCE_MS = '0';
process.env.PI_PLANNER_ONLY_CANCEL_GRACE_MS = '50';
delete process.env.PI_SUBAGENT_CHILD;
const { default: plannerOnly } = await import('../../index.ts');
const { SUBAGENT_DELEGATION_REQUEST_EVENT: REQUEST, SUBAGENT_DELEGATION_UPDATE_EVENT: UPDATE,
  SUBAGENT_DELEGATION_RESPONSE_EVENT: RESPONSE, SUBAGENT_DELEGATION_CANCEL_EVENT: CANCEL } = await import('../../subagent-delegation-contract.ts');

const handlers = new Map(), tools = new Map(), listeners = new Map();
const entries = [], notices = [], trace = [];
let abortCalls = 0, cancelEvents = 0, launches = 0, seq = 0;
const events = {
  on(name, fn) { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); return () => set.delete(fn); },
  emit(name, value) { for (const fn of [...(listeners.get(name) ?? [])]) fn(value); },
};
events.on('pi-subagents:runtime-agent-register:v1', request => { request.result = { ok: true, registration: { name: request.name } }; });
events.on(REQUEST, request => {
  launches++;
  const identity = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
  // Every child makes no progress and exceeds the 100-token envelope.
  queueMicrotask(() => events.emit(UPDATE, { ...identity, tokens: 101, runId: `fake-run-${launches}` }));
});
events.on(CANCEL, identity => {
  cancelEvents++;
  queueMicrotask(() => events.emit(RESPONSE, { ...identity, status: 'cancelled', runId: `fake-run-${launches}`, agent: 'planner-scout', model: 'fixture/no-model', usage: { input: 101, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1, toolCalls: 0, durationMs: 1 } }));
});
const pi = {
  on(name, fn) { handlers.set(name, fn); }, registerTool(tool) { tools.set(tool.name, tool); }, registerCommand() {},
  getActiveTools() { return ['read', 'bash', 'write']; }, getAllTools() { return [...tools.keys(), 'read', 'bash', 'write'].map(name => ({ name })); },
  setActiveTools() {}, appendEntry(customType, data) { entries.push({ type: 'custom', customType, data }); }, events,
  async exec() { return { stdout: '', stderr: 'fatal: not a git repository', code: 128 }; },
};
const ctx = {
  cwd: workspace, hasUI: true,
  abort() { abortCalls++; }, isIdle() { return false; },
  ui: { notify(message, type) { notices.push({ message, type }); }, setStatus() {}, theme: { fg(_, text) { return text; } } },
  sessionManager: { getEntries() { return entries; }, getSessionId() { return 'probe-root-session'; }, getSessionFile() { return join(agent, 'session.jsonl'); } },
};
plannerOnly(pi);
await handlers.get('session_start')({}, ctx);

async function call(name, params) {
  const toolCallId = `probe-${++seq}`;
  const event = { toolName: name, toolCallId, input: params };
  const gate = await handlers.get('tool_call')(event, ctx);
  let result;
  if (gate?.block) result = { blocked: true, error: gate.reason };
  else try { result = { value: await tools.get(name).execute(toolCallId, params, undefined, undefined, ctx) }; }
  catch (error) { result = { error: error.message, code: error.code }; }
  trace.push({ toolCallId, name, params, ...result });
  return { toolCallId, ...result };
}

// Drive the real tool_call hook AND the registered execute wrapper.
const same = [];
for (let i = 0; i < 12; i++) same.push(await call('planner_verdict', { taskId: 'T-99999999-001', verdict: 'pass', summary: 'same missing task' }));
assert.equal(same.filter(r => r.blocked).length, 9);
assert.equal(same.filter(r => r.error && !r.blocked).length, 3);
assert.equal(abortCalls, 0);
const changed = [];
for (let i = 0; i < 12; i++) changed.push(await call('planner_verdict', { taskId: 'T-99999999-001', verdict: 'pass', summary: `same missing task, wording ${i}` }));
assert.equal(changed.filter(r => r.blocked).length, 0);
assert.ok(changed.every(r => r.error?.includes('unknown task')));
assert.equal(abortCalls, 0);

const spec = { role: 'explorer', acceptanceMode: 'observation', objective: 'Read one fixture; injected child never progresses', scope: { allowedPaths: ['fixture.txt'] }, constraints: ['Read only'], acceptanceCriteria: ['Return a word count'], validation: { required: false }, envelope: { maxTokens: 100 } };
const { acceptanceMode, ...retrySpec } = spec;
let previous = await call('planner_delegate', spec);
assert.ok(previous.value, JSON.stringify(previous));
const taskId = previous.value.details.taskId;
for (let i = 1; i < 12; i++) {
  const executionId = previous.value.details.executionId;
  previous = await call('planner_redelegate', { ...retrySpec, taskId, recovery: { executionId, action: 'retry_same_plan', reason: 'Retry after the latest identical failure', worktreeDecision: 'keep', evidenceRefs: [`execution:${executionId}:tokens=101:limit=100`] } });
  assert.ok(previous.value, JSON.stringify(previous));
  assert.equal(previous.value.details.termination.reason, 'worker_runaway');
  assert.equal(previous.value.details.termination.terminationConfirmed, true);
}
assert.equal(launches, 12); assert.equal(cancelEvents, 12); assert.equal(abortCalls, 0);

// Positive control: changing only reason must NOT authorize the same recovery basis.
const lastAccepted = trace.filter(t => t.name === 'planner_redelegate' && t.value).at(-1);
const repeatedBasis = await call('planner_redelegate', { ...retrySpec, taskId, recovery: { ...lastAccepted.params.recovery, executionId: previous.value.details.executionId, reason: 'Different wording only' } });
assert.match(repeatedBasis.error ?? '', /equivalent recovery decision/);
assert.equal(launches, 12);
const ledgerPath = join(agent, 'planner-only', 'ledger', `${taskId}.json`);
const task = JSON.parse(readFileSync(ledgerPath, 'utf8')).task;
assert.equal(task.executions.length, 12);
assert.equal(task.reports.length, 0);
assert.equal(task.recovery.required, true);
assert.equal(task.reviewRound, 0);

const results = { sameArguments: { attempts: 12, executedRefusals: 3, preExecutionBlocks: 9 }, changedSummary: { attempts: 12, executedRefusals: 12, preExecutionBlocks: 0 }, repeatedRunaway: { launches, cancelEvents, reports: task.reports.length, reviewRound: task.reviewRound, recoveryHistory: task.recoveryHistory.length, recoveryRequired: task.recovery.required }, sameRecoveryBasisRefused: true, rootAbortCalls: abortCalls, run, ledgerPath, scope: 'Actual plugin hooks, tool execute, transport adapter, lifecycle and ledger; injected host and child events. No real Pi model loop.' };
writeFileSync(join(run, 'trace.json'), JSON.stringify(trace, null, 2));
writeFileSync(join(run, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
console.log('REPRODUCED: child cancellation and exact-call refusal blocking do not terminate the Root request in this fixture.');
if (process.argv.includes('--assert-request-stop')) {
  assert.ok(abortCalls > 0, 'REQUEST_STOP_MISSING: 12 identical refusals + 12 changed-summary refusals + 12 no-progress child executions did not invoke Root abort');
}
