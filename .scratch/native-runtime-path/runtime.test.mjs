import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, symlinkSync, lstatSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = mkdtempSync('/project/tmp/native-runtime-path-test/run-');
const agent = join(root, 'agent');
const config = join(root, 'runtime-env.sh');
const state = join(root, 'state');
const tmp = join(root, 'tmp');
const marker = join(root, 'called');
const launcher = join(agent, 'bin/pi');
test('installed launcher retains executable mode', () => {
  assert.equal(lstatSync('/home/tcuni-claw/.pi/agent/bin/pi').mode & 0o777, 0o755);
});
mkdirSync(join(agent, 'bin'), {recursive:true});
mkdirSync(join(agent, 'install/releases/v/node_modules/.bin'), {recursive:true});
writeFileSync(join(agent, 'install/current-version'), 'v\n');
const actual = readFileSync('/home/tcuni-claw/.pi/agent/bin/pi', 'utf8');
writeFileSync(launcher, actual.replaceAll('/home/tcuni-claw/.config/pi/runtime-env.sh', config), {mode:0o755});
const stub = join(agent, 'install/releases/v/node_modules/.bin/pi');
writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$PI_SUBAGENTS_TEMP_ROOT" "$TMPDIR" "$TMP" "$TEMP" "$PI_MANAGED_INSTALL_ROOT" "$#" "$1" "$2" > '${marker}'\nexit 37\n`, {mode:0o755});
const realConfig = '/home/tcuni-claw/.config/pi/runtime-env.sh';
let configText;
try { configText = readFileSync(realConfig, 'utf8').replaceAll('/home/tcuni-claw/.pi/agent/runtime/pi-subagents', state).replaceAll('/home/tcuni-claw/.pi/agent/runtime', join(root, 'runtime')).replaceAll('/project/tmp/pi-1000', tmp); }
catch { configText = `export PI_SUBAGENTS_TEMP_ROOT='${state}' TMPDIR='${tmp}' TMP='${tmp}' TEMP='${tmp}'\n`; }
writeFileSync(config, configText);
const run = () => spawnSync(launcher, ['a b', '--flag'], {encoding:'utf8', env:{...process.env, TMPDIR:'/project/tmp/native-runtime-path-test', TMP:'/project/tmp/native-runtime-path-test', TEMP:'/project/tmp/native-runtime-path-test'}});
test('launcher exports configuration and preserves argv and exit status', () => {
  const result = run();
  assert.equal(result.status, 37, result.stderr);
  const lines = readFileSync(marker, 'utf8').trimEnd().split('\n');
  assert.deepEqual(lines, [state, tmp, tmp, tmp, join(agent,'install'), '2', 'a b', '--flag']);
  for (const dir of [state,tmp]) { const s = lstatSync(dir); assert.ok(s.isDirectory()); assert.equal(s.uid, process.getuid()); assert.equal(s.mode & 0o777, 0o700); }
});
test('missing configuration prevents exec', () => {
  rmSync(marker, {force:true}); rmSync(config);
  const result = run(); assert.notEqual(result.status, 0); assert.notEqual(result.status, 37); assert.throws(() => lstatSync(marker));
});
test('unsafe symlink directory prevents exec', () => {
  writeFileSync(config, configText); rmSync(marker,{force:true}); rmSync(tmp,{recursive:true,force:true});
  symlinkSync(root,tmp); const result = run(); assert.notEqual(result.status,0); assert.notEqual(result.status,37); assert.throws(() => lstatSync(marker));
});
test('configuration failure prevents exec', () => {
  rmSync(marker,{force:true}); writeFileSync(config, 'return 1\n');
  const result = run(); assert.notEqual(result.status,0); assert.notEqual(result.status,37); assert.throws(() => lstatSync(marker));
});
test('non-private directory prevents exec', () => {
  rmSync(tmp,{force:true}); mkdirSync(tmp,{mode:0o755}); chmodSync(tmp,0o755);
  writeFileSync(config,configText); rmSync(marker,{force:true});
  const result = run(); assert.notEqual(result.status,0); assert.notEqual(result.status,37); assert.throws(() => lstatSync(marker));
});
test('symlinked runtime parent prevents exec', () => {
  rmSync(join(root,'runtime'),{recursive:true,force:true}); symlinkSync(root,join(root,'runtime'));
  rmSync(marker,{force:true}); const result = run(); assert.notEqual(result.status,0); assert.notEqual(result.status,37); assert.throws(() => lstatSync(marker));
});
test('symlink launcher resolves managed release', () => {
  rmSync(join(root,'runtime'),{force:true}); chmodSync(tmp,0o700);
  const alias = join(root,'pi'); symlinkSync(launcher,alias);
  const result = spawnSync(alias,['a b','--flag'],{encoding:'utf8',env:process.env});
  assert.equal(result.status,37,result.stderr);
});
test('wrong ownership prevents exec', () => {
  const fakeBin = join(root,'fake-bin'); mkdirSync(fakeBin);
  writeFileSync(join(fakeBin,'stat'), '#!/bin/sh\nprintf "9999:700\\n"\n', {mode:0o755});
  rmSync(marker,{force:true});
  const result = spawnSync(launcher,['a b','--flag'],{encoding:'utf8',env:{...process.env,PATH:`${fakeBin}:${process.env.PATH}`}});
  assert.notEqual(result.status,0); assert.notEqual(result.status,37); assert.throws(() => lstatSync(marker));
});
test('directory creation failure prevents exec', () => {
  rmSync(tmp,{recursive:true,force:true});
  const fakeBin = join(root,'fake-mkdir'); mkdirSync(fakeBin);
  writeFileSync(join(fakeBin,'mkdir'), '#!/bin/sh\nexit 1\n', {mode:0o755});
  rmSync(marker,{force:true});
  const result = spawnSync(launcher,['a b','--flag'],{encoding:'utf8',env:{...process.env,PATH:`${fakeBin}:${process.env.PATH}`}});
  assert.notEqual(result.status,0); assert.notEqual(result.status,37); assert.throws(() => lstatSync(marker));
});
