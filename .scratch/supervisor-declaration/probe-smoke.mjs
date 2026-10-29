import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createEventBus, DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';

const root = resolve('.scratch/supervisor-declaration');
const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: SettingsManager.inMemory(), eventBus: createEventBus(), additionalExtensionPaths: [resolve(root, 'live-probe.ts')], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
await loader.reload();
const result = loader.getExtensions();
assert.deepEqual(result.errors, []);
assert.equal(result.extensions.length, 1);
for (const event of ['session_start', 'before_agent_start', 'context', 'context_with_system', 'message_end', 'before_provider_request']) assert(result.extensions[0].handlers.has(event), event);
console.log('Pi loader: probe loaded; six event handlers registered');
