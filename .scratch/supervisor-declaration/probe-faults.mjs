import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const base = resolve('.scratch/supervisor-declaration');
const source = readFileSync(join(base, 'live-probe.ts'), 'utf8');
const fixture = readFileSync(join(base, 'probe-test.mjs'), 'utf8');
const faults = [
  ['session-filter', 'count >= 100 || ctx.sessionManager.getSessionId() !== TARGET', 'count >= 100', 11],
  ['record-cap', 'count >= 100 || ctx.sessionManager.getSessionId() !== TARGET', 'ctx.sessionManager.getSessionId() !== TARGET', 19],
  ['allowlist', "typeof name === 'string' && ALLOWED.has(name)", "typeof name === 'string'", 20],
  ['namespace', "if (tool.type === 'namespace') visit(tool.tools, depth + 1);", "if (tool.type === 'namespace') continue;", 13],
];
for (const [name, from, to, line] of faults) {
  assert.equal(source.split(from).length, 2, `unique injection point: ${name}`);
  const dir = mkdtempSync(join(base, `fault-${name}-`));
  writeFileSync(join(dir, 'live-probe.ts'), source.replace(from, to));
  writeFileSync(join(dir, 'probe-test.mjs'), fixture);
  const command = ['node', '--experimental-strip-types', join(dir, 'probe-test.mjs')];
  const run = spawnSync(command[0], command.slice(1), { encoding: 'utf8', timeout: 10000 });
  console.log(`fault=${name} command=${command.join(' ')} exit=${run.status}`);
  const output = run.stdout + run.stderr;
  assert.equal(run.status, 1, `expected assertion failure: ${name}`);
  assert.match(output, /AssertionError \[ERR_ASSERTION\]/);
  assert(output.includes(`probe-test.mjs:${line}:`), `wrong failure location: ${name}`);
  console.log(output.trim());
}
console.log('four targeted behavioral failures confirmed');
