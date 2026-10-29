import { appendFileSync, readFileSync, statSync } from 'node:fs';

const TARGET = '01a17c4f-b3b8-752b-a6e0-149ee18fcf56';
const LOG = '/home/tcuni-claw/pi/pi-planner-only/.scratch/supervisor-declaration/live-tools.jsonl';
const ALLOWED = new Set(['subagent', 'contact_supervisor', 'subagent_supervisor', 'subagents_enable', 'bg_wait']);

function names(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const result = values.flatMap(value => {
    const name = typeof value === 'string' ? value : value?.name;
    return typeof name === 'string' && ALLOWED.has(name) ? [name] : [];
  });
  return [...new Set(result)].sort();
}

function providerNames(payload: any): string[] {
  const found: string[] = [];
  const visit = (tools: unknown, depth: number) => {
    if (!Array.isArray(tools) || depth > 8) return;
    for (const tool of tools) {
      if (!tool || typeof tool !== 'object') continue;
      if (tool.type === 'namespace') visit(tool.tools, depth + 1);
      else found.push(...names([tool, tool.function]));
    }
  };
  visit(payload?.tools, 0);
  return names(found);
}

function systemNames(messages: unknown): { systemAdded: string[]; systemRemoved: string[]; systemActive: string[] } {
  const added: string[] = [], removed: string[] = [], active = new Set<string>();
  if (Array.isArray(messages)) for (const message of messages) {
    if (message?.role !== 'system') continue;
    const add = names(message.toolsAdded), remove = names(message.toolsRemoved);
    removed.push(...remove); added.push(...add);
    for (const name of remove) active.delete(name);
    for (const name of add) active.add(name);
  }
  return { systemAdded: names(added), systemRemoved: names(removed), systemActive: names([...active]) };
}

export function createProbe(pi: any, sink: (record: object) => void, initialCount = 0): void {
  let count = initialCount;
  const on = (event: string, handler: (event: any, ctx: any) => void) => pi.on(event, (value: any, ctx: any) => {
    try { handler(value, ctx); } catch { /* Ignore malformed diagnostic input. */ }
  });
  const record = (event: string, ctx: any, fields: object = {}) => {
    try {
      if (count >= 100) return;
      const data = { event, registered: names(pi.getAllTools()), active: names(pi.getActiveTools()), ...fields };
      sink(data);
      count++;
    } catch { /* Diagnostics must not interrupt the host. */ }
  };
  on('session_start', (_event: any, ctx: any) => record('session_start', ctx));
  on('before_agent_start', (event: any, ctx: any) => record('before_agent_start', ctx, { selected: names(event.systemPromptOptions?.selectedTools) }));
  on('context', (_event: any, ctx: any) => record('context', ctx));
  on('context_with_system', (event: any, ctx: any) => record('context_with_system', ctx, systemNames(event.messages)));
  on('message_end', (event: any, ctx: any) => {
    if (event.message?.role === 'custom' && event.message?.customType === 'subagent_supervisor_request') record('supervisor_request', ctx);
  });
  on('before_provider_request', (event: any, ctx: any) => record('before_provider_request', ctx, { providerTools: providerNames(event.payload) }));
}

export default function liveProbe(pi: any): void {
  let count = 0;
  try {
    if (statSync(LOG).size > 1024 * 1024) return;
    count = readFileSync(LOG, 'utf8').split('\n').filter(Boolean).length;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') return;
  }
  createProbe(pi, record => appendFileSync(LOG, JSON.stringify(record) + '\n', { mode: 0o600 }), count);
}
