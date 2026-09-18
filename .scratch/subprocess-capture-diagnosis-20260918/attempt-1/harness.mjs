import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const artifactDir = path.resolve('.scratch/subprocess-capture-diagnosis-20260918');
const resultsPath = path.join(artifactDir, 'results.json');
const redirectedPath = path.join(artifactDir, 'redirected-console.stdout');
const markerPath = path.join(artifactDir, 'side-effect.marker');

function isoNow() {
  return new Date().toISOString();
}

function serializeError(error) {
  if (!error) return null;
  return {
    name: error.name ?? null,
    code: error.code ?? null,
    errno: error.errno ?? null,
    syscall: error.syscall ?? null,
    message: error.message ?? null,
    stack: error.stack ?? null,
  };
}

function commandRecord(file, args) {
  return { file, args, display: [file, ...args].map(JSON.stringify).join(' ') };
}

function syncCase(name, file, args, options = {}) {
  const startedAt = isoNow();
  let result;
  let thrownError = null;
  try {
    result = spawnSync(file, args, {
      encoding: 'utf8',
      timeout: 3000,
      ...options,
    });
  } catch (error) {
    thrownError = serializeError(error);
  }
  const finishedAt = isoNow();
  return {
    name,
    command: commandRecord(file, args),
    startedAt,
    finishedAt,
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    pid: result?.pid ?? null,
    stdout: result?.stdout ?? null,
    stderr: result?.stderr ?? null,
    error: serializeError(result?.error),
    thrownError,
  };
}

function asyncCase(name, file, args) {
  return new Promise((resolve) => {
    const startedAt = isoNow();
    const record = {
      name,
      command: commandRecord(file, args),
      startedAt,
      finishedAt: null,
      pid: null,
      stdout: '',
      stderr: '',
      events: [],
      error: null,
      timedOut: false,
    };
    let settled = false;
    let child;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      record.finishedAt = isoNow();
      resolve(record);
    };
    try {
      child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      record.pid = child.pid ?? null;
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => { record.stdout += chunk; });
      child.stderr?.on('data', (chunk) => { record.stderr += chunk; });
      child.on('error', (error) => {
        record.error = serializeError(error);
        record.events.push({ event: 'error', at: isoNow(), error: serializeError(error) });
      });
      child.on('exit', (code, signal) => {
        record.events.push({ event: 'exit', at: isoNow(), code, signal });
      });
      child.on('close', (code, signal) => {
        record.events.push({ event: 'close', at: isoNow(), code, signal });
        finish();
      });
    } catch (error) {
      record.error = serializeError(error);
      record.events.push({ event: 'throw', at: isoNow(), error: serializeError(error) });
      finish();
    }
    timer = setTimeout(() => {
      record.timedOut = true;
      record.events.push({ event: 'timeout', at: isoNow() });
      if (child && !child.killed) child.kill('SIGKILL');
      setTimeout(finish, 100).unref();
    }, 3000);
  });
}

const runStartedAt = isoNow();
const syncCases = [];

syncCases.push(syncCase(
  'node-console-spawnSync',
  process.execPath,
  ['-e', "console.log('capture-probe')"],
));
syncCases.push(syncCase(
  'node-writeSync-spawnSync',
  process.execPath,
  ['-e', "require('node:fs').writeSync(1,'capture-probe\\n')"],
));
syncCases.push(syncCase(
  'bin-echo-spawnSync',
  '/bin/echo',
  ['capture-probe'],
));

let redirectedCase;
let redirectedFd = null;
try {
  redirectedFd = fs.openSync(redirectedPath, 'w');
  redirectedCase = syncCase(
    'node-console-regular-file-fd-spawnSync',
    process.execPath,
    ['-e', "console.log('capture-probe')"],
    { stdio: ['ignore', redirectedFd, 'pipe'] },
  );
} finally {
  if (redirectedFd !== null) fs.closeSync(redirectedFd);
}
redirectedCase.redirectedFile = redirectedPath;
redirectedCase.redirectedFileContent = fs.readFileSync(redirectedPath, 'utf8');
syncCases.push(redirectedCase);

const sideEffectCode = [
  "const fs=require('node:fs')",
  `fs.writeFileSync(${JSON.stringify(markerPath)},'marker-written\\n')`,
  "console.log('capture-probe')",
].join(';');
const sideEffect = syncCase(
  'node-side-effect-then-console-spawnSync',
  process.execPath,
  ['-e', sideEffectCode],
);
sideEffect.markerPath = markerPath;
sideEffect.markerExists = fs.existsSync(markerPath);
sideEffect.markerContent = sideEffect.markerExists ? fs.readFileSync(markerPath, 'utf8') : null;

const asyncCases = [];
asyncCases.push(await asyncCase(
  'node-console-spawn',
  process.execPath,
  ['-e', "console.log('capture-probe')"],
));
asyncCases.push(await asyncCase(
  'node-writeSync-spawn',
  process.execPath,
  ['-e', "require('node:fs').writeSync(1,'capture-probe\\n')"],
));

const document = {
  schemaVersion: 1,
  runStartedAt,
  runFinishedAt: isoNow(),
  runtime: {
    node: process.version,
    execPath: process.execPath,
    libuv: process.versions.uv,
    platform: process.platform,
    arch: process.arch,
  },
  harness: {
    argv: process.argv,
    cwd: process.cwd(),
    timeoutMs: 3000,
    resultsPath,
  },
  syncCases,
  asyncCases,
  sideEffect,
};

fs.writeFileSync(resultsPath, `${JSON.stringify(document, null, 2)}\n`);
const summary = {
  resultsPath,
  sync: syncCases.map(({ name, status, signal, stdout, stderr, error }) => ({
    name, status, signal, stdout, stderr, errorCode: error?.code ?? null,
  })),
  async: asyncCases.map(({ name, pid, stdout, stderr, error, timedOut, events }) => ({
    name, pid, stdout, stderr, errorCode: error?.code ?? null, timedOut,
    events: events.map(({ event, code, signal }) => ({ event, code, signal })),
  })),
  sideEffect: {
    status: sideEffect.status,
    errorCode: sideEffect.error?.code ?? null,
    markerExists: sideEffect.markerExists,
    markerContent: sideEffect.markerContent,
  },
};
fs.writeSync(1, `${JSON.stringify(summary, null, 2)}\n`);
