import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createAgentSession, createEventBus, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

const root = mkdtempSync(resolve('.scratch/supervisor-declaration/runtime-'));
console.error(`stage=setup path=${root}`);
process.env.PI_CODING_AGENT_DIR = root;
process.env.PI_SUBAGENTS_TEMP_ROOT = join(root, 'managed');
process.env.TMPDIR = root;
process.env.PI_PLANNER_ONLY_MODE = 'native';
delete process.env.PI_SUBAGENT_CHILD;
const pkg = '/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents';
const require = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
const { createJiti } = require('jiti');
const alias = Object.fromEntries(['typebox', 'typebox/compile', 'typebox/value', '@earendil-works/pi-agent-core', '@earendil-works/pi-ai', '@earendil-works/pi-coding-agent', '@earendil-works/pi-tui'].map(name => [name, fileURLToPath(import.meta.resolve(name))]));
const jiti = createJiti(import.meta.url, { alias });
const { createNativeSupervisorChannel } = await jiti.import(`${pkg}/bundle/chunk-CZTMUBUI.js`);
const modelRuntime = await ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: null, modelsStorePath: join(root, 'models'), allowModelNetwork: false, refreshOnCreate: false });
const model = modelRuntime.getModels()[0];
await modelRuntime.setRuntimeApiKey(model.provider, 'offline-fixture');
const names = (items) => items.map(item => typeof item === 'string' ? item : item.name).filter(name => ['subagent', 'contact_supervisor', 'subagent_supervisor', 'subagents_enable', 'bg_wait'].includes(name)).sort();
for (const planner of [false, true]) {
  for (const replay of [false, true]) {
    console.error(`stage=load planner=${planner} selection=${replay ? 'synthetic' : 'fresh'}`);
    const bus = createEventBus();
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const extensions = [join(pkg, 'bundle/index.js'), resolve('.scratch/supervisor-declaration/capture.js'), '/home/tcuni-claw/.pi/agent/extensions/slim-tools.ts', resolve('.scratch/supervisor-declaration/live-probe.ts')];
    if (planner) extensions.push('/home/tcuni-claw/.pi/agent/git/github.com/bioShaun/pi-planner-only/index.ts');
    const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager, eventBus: bus, additionalExtensionPaths: extensions, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime, model, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(root) });
    await session.bindExtensions({ mode: 'rpc', onError: () => { throw new Error('extension handler failure'); } });
    const pi = globalThis.__supervisorDiagnosticPi;
    const registered = names(pi.getAllTools());
    assert(registered.includes('subagent_supervisor'), 'reply tool must be registered');
    if (replay) session.setActiveToolsByName(['read', 'bash', 'edit', 'write', 'subagent', 'contact_supervisor']);
    else session.setActiveToolsByName(session.agent.state.tools.map(tool => tool.name).filter(name => name !== 'subagent_supervisor'));
    const before = names(pi.getActiveTools());
    const channelDir = join(root, `channel-${Number(planner)}-${Number(replay)}`);
    mkdirSync(join(channelDir, 'requests'), { recursive: true });
    const state = { supervisorOwnerSessionId: 'fixture-owner', foregroundControls: new Map(), foregroundRuns: new Map(), asyncJobs: new Map() };
    let wakes = 0;
    const channel = createNativeSupervisorChannel(pi, state, { getChannelDirs: () => ({ dirs: [channelDir] }), parentWake: { sendMessage: () => { wakes++; return true; } } });
    try {
    channel.start();
    writeFileSync(join(channelDir, 'requests', 'fixture.json'), JSON.stringify({ type: 'subagent.supervisor.request', id: 'fixture', reason: 'need_decision', message: 'fixture', runId: 'fixture', agent: 'worker', childIndex: 0, orchestratorSessionId: 'fixture-owner', expectsReply: true, createdAt: Date.now(), expiresAt: Date.now() + 60000 }));
    console.error('stage=request');
    channel.activateTransport();
    const after = names(pi.getActiveTools());
    assert.equal(wakes, 1, 'actual channel must accept the synthetic request');
    assert(after.includes('subagent_supervisor'), 'request must activate reply tool');
    let declared;
    session.agent.streamFunction = (_model, context) => {
      const active = new Set();
      for (const message of context.messages) {
        for (const tool of message.toolsAdded ?? []) active.add(typeof tool === 'string' ? tool : tool.name);
        for (const tool of message.toolsRemoved ?? []) active.delete(typeof tool === 'string' ? tool : tool.name);
      }
      declared = names([...active]);
      const message = { role: 'assistant', content: [{ type: 'text', text: 'done' }], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'start', partial: message });
      stream.push({ type: 'done', reason: 'stop', message });
      return stream;
    };
    console.error('stage=host-prompt');
    await session.prompt('fixture');
    assert(declared?.includes('subagent_supervisor'), 'model stream must declare reply tool');
    console.log(JSON.stringify({ planner, replay, registered, before, after, declared, wakes }));
    } finally {
      console.error('stage=cleanup');
      channel.dispose();
      session.dispose();
      bus.clear();
    }
  }
}
console.error('stage=complete');
// Installed extension owns background timers without an SDK-wide shutdown method.
process.exit(0);
