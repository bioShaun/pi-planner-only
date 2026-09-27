import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.TMPDIR?.startsWith('/project/tmp/'));
const work = mkdtempSync(join(process.env.TMPDIR, 'host-'));
const agentDir = join(work, 'agent');
mkdirSync(agentDir);
process.env.PI_CODING_AGENT_DIR = agentDir;
for (const key of ['PI_PLANNER_ONLY', 'PI_PLANNER_ONLY_MODE', 'PI_PLANNER_ONLY_STRICT', 'PI_PLANNER_ONLY_HANDOFF', 'PI_SUBAGENT_CHILD']) delete process.env[key];
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('network disabled by offline host harness'); };
const sdkRoot = '/home/tcuni-claw/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent/dist';
const { createAgentSession } = await import(pathToFileURL(join(sdkRoot, 'core/sdk.js')));
const { createAgentSessionRuntime } = await import(pathToFileURL(join(sdkRoot, 'core/agent-session-runtime.js')));
const { DefaultResourceLoader } = await import(pathToFileURL(join(sdkRoot, 'core/resource-loader.js')));
const { SessionManager } = await import(pathToFileURL(join(sdkRoot, 'core/session-manager.js')));
const { SettingsManager } = await import(pathToFileURL(join(sdkRoot, 'core/settings-manager.js')));
const { Type } = await import('typebox');
const { default: planner, NATIVE_PROMPT, PLUGIN_TOOLS, MODE_PREFERENCE, OFF_MARKER } = await import(pathToFileURL(resolve('index.ts')));
const { SUBAGENT_DELEGATION_REQUEST_EVENT: REQUEST, SUBAGENT_DELEGATION_STARTED_EVENT: STARTED, SUBAGENT_DELEGATION_RESPONSE_EVENT: RESPONSE } = await import(pathToFileURL(resolve('subagent-delegation-contract.ts')));

const model = { id: 'offline-model', name: 'Offline fixture', api: 'openai-responses', provider: 'openai', baseUrl: 'http://127.0.0.1:9', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 };
const results = [];
let activeRuntime;

async function scenario(order) {
  rmSync(MODE_PREFERENCE, { force: true });
  rmSync(OFF_MARKER, { force: true });
  const cwd = join(work, order); mkdirSync(cwd);
  const sessions = join(cwd, 'sessions'); mkdirSync(sessions);
  const errors = [], sent = [], tools = new Map();
  let api;
  const plannerFactory = (pi) => {
    api = pi;
    tools.clear();
    planner({ ...pi,
      registerTool(tool) { tools.set(tool.name, tool); pi.registerTool(tool); },
      sendMessage(...args) { sent.push(['custom', ...args]); },
      sendUserMessage(...args) { sent.push(['user', ...args]); throw new Error('No turns allowed in offline harness'); },
    });
  };
  const upstreamFactory = (pi) => {
    for (const name of ['subagent', 'subagents_enable']) pi.registerTool({ name, label: name, description: 'Offline native tool fixture', parameters: Type.Object({}), execute: async () => ({ content: [{ type: 'text', text: 'no model executed' }], details: {} }) });
    pi.on('before_agent_start', (event) => {
      const selected = event.systemPromptOptions?.selectedTools;
      if (selected && !selected.includes('subagents_enable')) selected.push('subagents_enable');
    });
  };
  const factory = async ({ sessionManager, sessionStartEvent }) => {
    const settingsManager = SettingsManager.inMemory({ packages: [], extensions: [] });
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: order === 'upstream-first' ? [upstreamFactory, plannerFactory] : [plannerFactory, upstreamFactory],
    });
    await resourceLoader.reload();
    const created = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader, sessionManager, sessionStartEvent, model });
    assert.deepEqual(created.extensionsResult.errors, []);
    return { ...created, services: { cwd, agentDir }, diagnostics: [] };
  };
  const runtime = await createAgentSessionRuntime(factory, { cwd, agentDir, sessionManager: SessionManager.create(cwd, sessions) });
  activeRuntime = runtime;
  const bind = async (session) => session.bindExtensions({ onError: error => errors.push(error) });
  runtime.setRebindSession(bind);
  await bind(runtime.session);
  const command = async (text) => {
    const runner = runtime.session.extensionRunner;
    await runner.getCommand('planner-only').handler(text, runner.createCommandContext());
  };
  const prompt = async () => runtime.session.extensionRunner.emitBeforeAgentStart('offline probe', undefined, { cwd, forceSystemPrompt: 'BASE', selectedTools: [...runtime.session.getActiveToolNames()] });
  const current = () => runtime.session.getActiveToolNames();
  const persistFixture = () => {
    // Synthetic metadata only to make the real SessionManager flush a file; no model request.
    runtime.session.sessionManager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'offline fixture; no inference' }], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() });
    return runtime.session.sessionFile;
  };

  assert.ok(current().includes('delegate'));
  const liteFile = persistFixture();
  await command('native');
  assert.ok(current().includes('delegate'), 'queued mode cannot switch current Lite');
  await runtime.session.reload();
  assert.ok(current().includes('delegate'), 'actual reload retains bound Lite');
  assert.equal((await runtime.newSession()).cancelled, false);
  assert.ok(current().includes('subagent'));
  assert.ok(current().includes('subagents_enable'));
  assert.ok(PLUGIN_TOOLS.every(name => !current().includes(name)));
  let prepared = await prompt();
  assert.equal(prepared.systemPromptOptions.forceSystemPrompt, `BASE\n\n${NATIVE_PROMPT}`);
  assert.ok(PLUGIN_TOOLS.every(name => !prepared.systemPromptOptions.selectedTools.includes(name)));
  assert.ok(prepared.systemPromptOptions.selectedTools.includes('subagent'));
  const nativeFile = persistFixture();
  process.env.PI_PLANNER_ONLY_STRICT = '1';
  process.env.PI_PLANNER_ONLY_HANDOFF = 'auto';
  for (const [name, params] of [['delegate', { role: 'worker', task: 'must not run' }], ['git_audit', { operation: 'status' }], ['git_commit', { message: 'must not commit' }], ['handoff', { brief: 'x'.repeat(200) }]]) {
    const result = await tools.get(name).execute('blocked-fixture', params, undefined, undefined, runtime.session.extensionRunner.createContext());
    assert.equal(result.details.ok, false, `${name} direct call refused in real Native runtime`);
  }
  await command('handoff');
  assert.deepEqual(sent, []);
  delete process.env.PI_PLANNER_ONLY_STRICT;
  delete process.env.PI_PLANNER_ONLY_HANDOFF;
  await command('lite');
  await runtime.session.reload();
  assert.ok(!current().includes('delegate'), 'reload remains Native despite Lite preference');
  assert.equal((await runtime.newSession()).cancelled, false);
  assert.ok(current().includes('delegate'));
  await command('native');
  assert.equal((await runtime.switchSession(liteFile)).cancelled, false);
  assert.ok(current().includes('delegate'), 'resume existing Lite despite Native preference');
  assert.equal((await runtime.switchSession(nativeFile)).cancelled, false);
  assert.ok(!current().includes('delegate'));
  await command('off');
  await command('native');
  await runtime.session.reload();
  prepared = await prompt();
  assert.equal(prepared.systemPromptOptions.forceSystemPrompt, 'BASE', 'legacy off survives reload despite Native preference');
  await command('on');
  assert.ok(current().includes('delegate'));
  assert.deepEqual(errors, []);
  results.push({ order, new_reload_resume: 'PASS', prompt_and_tools: 'PASS', direct_lite_tools_refused: 'PASS', legacy_on_off: 'PASS' });

  if (process.argv.includes('--busy')) {
    let request;
    const bus = api.events;
    bus.on(REQUEST, req => { request = req; bus.emit(STARTED, { requestId: req.requestId, nodeId: req.nodeId }); });
    const abort = new AbortController();
    const pending = tools.get('delegate').execute('busy-fixture', { role: 'worker', task: 'offline held request', cwd }, abort.signal, undefined, runtime.session.extensionRunner.createContext());
    for (let i = 0; i < 200 && !request; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(request, 'held request started');
    await command('native');
    try {
      const switched = await runtime.newSession();
      assert.equal(switched.cancelled, true, 'real /new must not discard a live Lite delegation before mode switch');
    } finally {
      try { bus.emit(RESPONSE, { requestId: request.requestId, nodeId: request.nodeId, agent: request.agent, status: 'completed', result: { kind: 'text', text: 'offline finished' }, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } }); } catch {}
      abort.abort();
      await Promise.race([pending.catch(() => {}), new Promise(resolve => setTimeout(resolve, 100))]);
    }
    results.at(-1).inflight_boundary = 'PASS';
  }
  runtime.session.dispose(); activeRuntime = undefined;
}

try {
  await scenario('upstream-first');
  await scenario('planner-first');
  assert.equal(networkCalls, 0);
  console.log(JSON.stringify({ status: 'PASS', results, networkCalls, modelTurns: 0, work, note: 'Real installed Pi lifecycle with native-tool fixture; no live backend inference.' }, null, 2));
  process.exit(0);
} catch (error) {
  try { activeRuntime?.session.dispose(); } catch {}
  console.error(error.stack);
  console.error(JSON.stringify({ status: 'FAIL', results, networkCalls, work }));
  process.exit(1);
}
