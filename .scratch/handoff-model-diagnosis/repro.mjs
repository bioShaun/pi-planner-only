// Diagnostic only: repository extension + installed Pi replacement/model resolver;
// fixture models/session shell, no network calls or user settings writes.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const host = '/home/tcuni-claw/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/';
const { AgentSessionRuntime } = await import(pathToFileURL(host + 'agent-session-runtime.js'));
const { SessionManager } = await import(pathToFileURL(host + 'session-manager.js'));
const { findInitialModel } = await import(pathToFileURL(host + 'model-resolver.js'));
process.env.PI_CODING_AGENT_DIR = new URL('./isolated-agent', import.meta.url).pathname;
process.env.PI_PLANNER_ONLY_MODE = 'lite';
process.env.PI_PLANNER_ONLY_HANDOFF = 'off';
delete process.env.PI_SUBAGENT_CHILD;
const { default: plannerOnly } = await import('../../index.ts');
const rootModel = { provider: 'fixture', id: 'current-root' };
const defaultModel = { provider: 'fixture', id: 'configured-default' };
const selectedDefault = process.env.PROBE_DEFAULT_ROOT ? rootModel : defaultModel;
const modelRuntime = {
  getModel: (_, id) => [rootModel, defaultModel].find(m => m.id === id),
  hasConfiguredAuth: () => true,
  getAvailableSnapshot: () => [rootModel, defaultModel],
};
const sends = [];
const notes = [];
const factories = [];
const selections = { source: null, replacement: null, oldPiSetModelCalls: 0, replacementCalls: [] };
const services = { cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR };
function sessionShell(model, sessionManager, state = { model, thinkingLevel: 'high' }) {
  return {
    get model() { return state.model; }, sessionManager, sessionFile: sessionManager.getSessionFile(),
    get thinkingLevel() { return state.thinkingLevel; },
    extensionRunner: { hasHandlers: () => false },
    abort: async () => {}, dispose() {},
    createReplacedSessionContext: () => ({
      get model() { return state.model; }, get thinkingLevel() { return state.thinkingLevel; },
      modelRegistry: { getModel: (provider, id) => [rootModel, defaultModel].find(m => m.provider === provider && m.id === id) },
      ui: { notify: m => notes.push(m) },
      sendUserMessage: async text => sends.push({ model: state.model.id, text }),
    }),
  };
}
const initial = sessionShell(rootModel, SessionManager.inMemory(process.cwd()));
const runtime = new AgentSessionRuntime(initial, services, async options => {
  factories.push({ keys: Object.keys(options), parent: options.sessionManager.getHeader().parentSession });
  const result = await findInitialModel({
    scopedModels: [], isContinuing: false,
    defaultProvider: selectedDefault.provider, defaultModelId: selectedDefault.id,
    modelRuntime,
  });
  const state = { model: result.model, thinkingLevel: 'medium' };
  const session = sessionShell(result.model, options.sessionManager, state);
  selections.replacement = { model: state.model.id, thinkingLevel: state.thinkingLevel };
  plannerOnly({
    on() {}, registerTool() {}, registerCommand() {}, events: { on: () => () => {}, emit() {} },
    getActiveTools: () => [], setActiveTools() {}, appendEntry() {}, sendUserMessage() {},
    exec: async () => ({ code: 128, stdout: '', stderr: 'not a repository' }),
    setModel: async model => { selections.replacementCalls.push({ method: 'setModel', id: model.id }); state.model = model; return true; },
    setThinkingLevel: level => { selections.replacementCalls.push({ method: 'setThinkingLevel', level }); state.thinkingLevel = level; },
  });
  return { session, services, diagnostics: [] };
});
const commands = new Map();
const tools = new Map();
plannerOnly({
  on() {}, registerTool: t => tools.set(t.name, t),
  registerCommand: (name, command) => commands.set(name, command),
  events: { on: () => () => {}, emit() {} },
  getActiveTools: () => [], setActiveTools() {}, appendEntry() {}, sendUserMessage() {},
  exec: async () => ({ code: 128, stdout: '', stderr: 'not a repository' }),
  setModel: async () => { selections.oldPiSetModelCalls++; throw new Error('stale pi instance'); },
});
const ctx = {
  cwd: process.cwd(), hasUI: true, isIdle: () => true,
  get model() { return rootModel; }, thinkingLevel: 'high',
  sessionManager: { getSessionFile: () => '/fixture/previous.jsonl' },
  ui: { notify: m => notes.push(m) },
  newSession: options => runtime.newSession(options),
};
await commands.get('planner-only').handler('handoff', ctx);
selections.source = { model: ctx.model.id, thinkingLevel: ctx.thinkingLevel };
const scheduled = await tools.get('handoff').execute('repro', { brief: 'Preserve the current Root model after handoff. '.repeat(6) }, undefined, undefined, ctx);
assert.equal(scheduled.details.ok, true);
await commands.get('planner-only').handler('handoff', ctx);
assert.equal(sends.length, 1, JSON.stringify(notes));
console.log(JSON.stringify({ selections, before: rootModel.id, configuredDefault: selectedDefault.id, after: sends[0].model, factories, notes }, null, 2));
assert.equal(selections.source.model, rootModel.id);
assert.equal(selections.replacement.model, selectedDefault.id, 'replacement starts from configured default before restore');
if (!process.env.PROBE_DEFAULT_ROOT) assert.notEqual(selections.replacement.model, selections.source.model, 'fixture must distinguish replacement default from source selection');
assert.equal(sends[0].model, rootModel.id, 'first message uses restored current Root model');
assert.equal(selections.oldPiSetModelCalls, 0, 'old extension instance must not be used');
assert.equal(sends[0].model, rootModel.id, 'handoff must retain current Root model for the first message');
