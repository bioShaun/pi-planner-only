import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Actual installed host, in process; scripted provider, no child OS processes.
const base = dirname(fileURLToPath(import.meta.url));
const run = mkdtempSync(join(base, 'host-run-'));
process.env.PI_OFFLINE = '1';
process.env.PI_CODING_AGENT_DIR = join(run, 'agent');
process.env.TMPDIR = join(run, 'tmp');
mkdirSync(process.env.PI_CODING_AGENT_DIR);
mkdirSync(process.env.TMPDIR);
const host = '/home/tcuni-claw/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent';
const load = (path) => import(pathToFileURL(join(host, path)).href);
const { createAgentSession } = await load('dist/core/sdk.js');
const { ModelRuntime } = await load('dist/core/model-runtime.js');
const { SessionManager } = await load('dist/core/session-manager.js');
const { SettingsManager } = await load('dist/core/settings-manager.js');
const { createExtensionRuntime, loadExtensionFromFactory } = await load('dist/core/extensions/loader.js');
const { createEventBus } = await load('dist/core/event-bus.js');
const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await load('node_modules/@earendil-works/pi-ai/dist/providers/faux.js');

const all = [];
for (const mode of ['plain', 'abort-queued', 'clear-abort-queued', 'terminate', 'terminate-queued', 'terminate-mixed']) {
  const trace = [];
  const faux = fauxProvider({ provider: `probe-${mode}` });
  const responses = Array.from({ length: 8 }, (_, i) => fauxAssistantMessage(`response ${i}`));
  if (mode.startsWith('terminate')) {
    const calls = [fauxToolCall('probe_blocked', {}, { id: 'blocked-call' })];
    if (mode === 'terminate-mixed') calls.push(fauxToolCall('probe_allowed', {}, { id: 'allowed-call' }));
    responses.unshift(fauxAssistantMessage(calls));
  }
  faux.setResponses(responses);
  const runtime = await ModelRuntime.create({
    authPath: join(run, `${mode}-auth.json`), modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false,
  });
  runtime.registerNativeProvider(faux.provider);
  const extensionRuntime = createExtensionRuntime();
  let piApi, extensionCtx, session, queued = false;
  const extension = await loadExtensionFromFactory((pi) => {
    piApi = pi;
    for (const name of ['input', 'before_agent_start', 'agent_start', 'turn_start', 'turn_end', 'agent_end', 'agent_settled', 'tool_call']) {
      pi.on(name, async (event, ctx) => {
        extensionCtx = ctx;
        trace.push({ event: name, source: event.source, streamingBehavior: event.streamingBehavior,
          calls: faux.state.callCount, idle: ctx.isIdle(), pending: ctx.hasPendingMessages() });
        if (name === 'tool_call' && event.toolName === 'probe_blocked') {
          if (mode === 'terminate-queued') {
            pi.sendMessage({ customType: 'probe-followup', content: 'queued continuation', display: false },
              { deliverAs: 'followUp' });
            trace.push({ event: 'queued-before-terminate', calls: faux.state.callCount });
          }
          trace.push({ event: 'terminating-block', calls: faux.state.callCount });
          return { block: true, terminate: true, reason: 'deterministic stop probe' };
        }
        if (name === 'agent_end' && ['abort-queued', 'clear-abort-queued'].includes(mode) && !queued) {
          queued = true;
          pi.sendMessage({ customType: 'probe-followup', content: 'queued continuation', display: false },
            { deliverAs: 'followUp' });
          trace.push({ event: 'queued-by-agent-end', calls: faux.state.callCount });
          if (mode === 'clear-abort-queued') session.clearQueue();
          ctx.abort();
          trace.push({ event: 'abort-called', calls: faux.state.callCount,
            pending: ctx.hasPendingMessages(), clearQueueOnContext: typeof ctx.clearQueue });
        }
      });
    }
  }, run, createEventBus(), extensionRuntime);
  const resourceLoader = {
    getExtensions: () => ({ extensions: [extension], errors: [], runtime: extensionRuntime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => 'Deterministic host control probe.',
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources() {}, async reload() {},
  };
  ({ session } = await createAgentSession({
    cwd: run, agentDir: process.env.PI_CODING_AGENT_DIR, model: faux.getModel(),
    modelRuntime: runtime, sessionManager: SessionManager.inMemory(run),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    resourceLoader, tools: ['probe_blocked', 'probe_allowed'], thinkingLevel: 'off',
    customTools: ['probe_blocked', 'probe_allowed'].map(name => ({
      name, label: name, description: 'No-op in-process probe tool.', parameters: { type: 'object', properties: {} },
      async execute() {
        trace.push({ event: `execute:${name}`, calls: faux.state.callCount });
        return { content: [{ type: 'text', text: 'done' }], details: {} };
      },
    })),
  }));
  const timer = setTimeout(() => { throw new Error(`HOST_PROBE_TIMEOUT:${mode}`); }, 10000);
  try {
    await session.bindExtensions({ mode: 'json' });
    await session.prompt('first user input', { source: 'interactive' });
    const afterFirst = faux.state.callCount;
    // Await the actual host method: ExtensionAPI.sendUserMessage is fire-and-forget.
    await session.sendUserMessage('extension initiated input');
    await session.prompt('next independent user input', { source: 'interactive' });
    const inputs = trace.filter(e => e.event === 'input').map(e => e.source);
    assert.deepEqual(inputs, ['interactive', 'extension', 'interactive']);
    assert.equal(afterFirst, ['abort-queued', 'terminate-queued', 'terminate-mixed'].includes(mode) ? 2 : 1);
    assert.ok(!trace.some(e => e.event === 'execute:probe_blocked'));
    assert.equal(trace.filter(e => e.event === 'execute:probe_allowed').length, mode === 'terminate-mixed' ? 1 : 0);
    assert.equal(typeof extensionCtx.clearQueue, 'undefined');
    assert.ok(trace.some(e => e.event === 'agent_settled'));
    all.push({ mode, afterFirst, finalCalls: faux.state.callCount, inputs, trace });
  } finally {
    clearTimeout(timer);
    await session.abort();
    session.dispose();
  }
}
const result = { hostVersion: JSON.parse(readFileSync(join(host, 'package.json'), 'utf8')).version,
  host, scenarios: all, scope: 'Actual SDK AgentSession/ExtensionRunner; faux provider; no planner plugin, launcher, network, or subprocess.',
  conclusion: 'ctx.abort alone permits queued continuation; terminate stops an all-blocked batch but not queued or mixed continuation; clearQueue exists only on session API.', run };
writeFileSync(join(run, 'results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
