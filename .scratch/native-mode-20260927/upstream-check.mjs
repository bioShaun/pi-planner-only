import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.TMPDIR?.startsWith('/project/tmp/'));
const dir = mkdtempSync(join(process.env.TMPDIR, 'upstream-'));
const agentDir = join(dir, 'agent'); mkdirSync(agentDir);
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_SUBAGENTS_TEMP_ROOT = join(dir, 'subagents');
process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT = '/home/tcuni-claw/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent';
process.env.PI_PLANNER_ONLY_MODE = 'native';
delete process.env.PI_PLANNER_ONLY;
delete process.env.PI_SUBAGENT_CHILD;
delete process.env.HERDR_PI_MODE;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('network disabled'); };
const sdk = process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT + '/dist';
const { createAgentSession } = await import(pathToFileURL(sdk + '/core/sdk.js'));
const { DefaultResourceLoader } = await import(pathToFileURL(sdk + '/core/resource-loader.js'));
const { SettingsManager } = await import(pathToFileURL(sdk + '/core/settings-manager.js'));
const { SessionManager } = await import(pathToFileURL(sdk + '/core/session-manager.js'));
const upstreamPath = '/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/index.js';
const plannerPath = resolve('index.ts');
const { default: planner, NATIVE_PROMPT, PLUGIN_TOOLS } = await import(pathToFileURL(resolve('index.ts')));
const model = { id: 'offline-model', name: 'Offline fixture', api: 'openai-responses', provider: 'openai', baseUrl: 'http://127.0.0.1:9', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 };
let session;
const results = [];
try {
  for (const order of ['upstream-first', 'planner-first']) {
    const cwd = join(dir, order); mkdirSync(cwd);
    const settingsManager = SettingsManager.inMemory({ packages: [], extensions: [] });
    const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalExtensionPaths: order === 'upstream-first' ? [upstreamPath, plannerPath] : [plannerPath, upstreamPath] });
    await loader.reload();
    const created = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd), model });
    assert.deepEqual(created.extensionsResult.errors, []);
    session = created.session;
    const errors = [];
    await session.bindExtensions({ onError: error => errors.push(error) });
    assert.ok(session.getAllTools().some(tool => tool.name === 'subagent'));
    const prompt = await session.extensionRunner.emitBeforeAgentStart('offline native probe', undefined, { cwd, forceSystemPrompt: 'BASE', selectedTools: [...session.getActiveToolNames()] });
    assert.ok(prompt.systemPromptOptions.forceSystemPrompt.includes(NATIVE_PROMPT));
    assert.ok(!prompt.systemPromptOptions.forceSystemPrompt.includes('[PLANNER-ONLY]'));
    assert.ok(PLUGIN_TOOLS.every(name => !prompt.systemPromptOptions.selectedTools.includes(name)));
    assert.ok(session.getActiveToolNames().includes('subagent') || session.getActiveToolNames().includes('subagents_enable'));
    const activationTool = session.getToolDefinition('subagents_enable');
    if (activationTool) {
      const enabled = await activationTool.execute('probe-enable', {}, new AbortController().signal, undefined, session.extensionRunner.createContext());
      assert.notEqual(enabled.isError, true);
      assert.ok(session.getActiveToolNames().includes('subagent'));
    }
    const enabledPrompt = await session.extensionRunner.emitBeforeAgentStart('offline enabled probe', undefined, { cwd, forceSystemPrompt: 'BASE', selectedTools: [...session.getActiveToolNames()] });
    assert.ok(enabledPrompt.systemPromptOptions.selectedTools.includes('subagent'));
    assert.ok(PLUGIN_TOOLS.every(name => !enabledPrompt.systemPromptOptions.selectedTools.includes(name)));
    const result = await session.getToolDefinition('subagent').execute('probe-list', { action: 'list' }, new AbortController().signal, undefined, session.extensionRunner.createContext());
    assert.notEqual(result.isError, true);
    assert.equal(result.details.mode, 'management');
    assert.deepEqual(result.details.results, []);
    assert.deepEqual(errors, []);
    results.push({ order, loadedPaths: created.extensionsResult.extensions.map(extension => extension.path), activeTools: session.getActiveToolNames(), native_management_list: 'PASS', planner_tools_hidden: true });
    session.dispose(); session = undefined;
  }
  assert.equal(networkCalls, 0);
  console.log(JSON.stringify({ status: 'PASS', results, networkCalls, modelTurns: 0, dir, note: 'Actual installed pi-subagents management path; no child or model launched.' }, null, 2));
  process.exit(0);
} catch (error) {
  try { session?.dispose(); } catch {}
  console.error(error.stack);
  console.error(JSON.stringify({ status: 'FAIL', results, networkCalls, dir }));
  process.exit(1);
}
