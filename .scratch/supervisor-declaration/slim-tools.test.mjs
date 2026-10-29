import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const extension = (await import(pathToFileURL('/home/tcuni-claw/.pi/agent/extensions/slim-tools.ts'))).default;

for (const event of ['before_agent_start', 'session_start']) {
  test(`${event} preserves supervisor and other tools, hiding bg_wait`, async () => {
    const handlers = new Map();
    let active = ['read', 'bg_wait', 'subagent', 'subagent_supervisor'];
    extension({
      on: (name, handler) => handlers.set(name, handler),
      getActiveTools: () => active,
      setActiveTools: (tools) => { active = tools; },
    });
    assert(handlers.has(event));
    await handlers.get(event)();
    assert(active.includes('subagent_supervisor'), 'activated supervisor must remain active');
    assert.deepEqual(active, ['read', 'subagent', 'subagent_supervisor']);
  });
}
