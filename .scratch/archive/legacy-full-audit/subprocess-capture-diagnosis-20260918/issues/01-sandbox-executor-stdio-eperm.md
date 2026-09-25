# Sandboxed agent executor returns EPERM on child-process stdio pipes

Status: ready-for-human
Type: task

## Symptom

Inside one agent's sandboxed command executor, `child_process.spawnSync(node, ['-e', "console.log('x')"], { encoding: 'utf8' })` returns `status: 0` together with `result.error.code === 'EPERM'` and empty `stdout`. `fs.writeSync(1, ...)` and `/bin/echo` deliver bytes to the pipe but still carry the EPERM error. Redirecting the child's stdout to a regular-file fd succeeds with `error: null`. Async `spawn` shows the same output loss with no `error` event.

The child does execute (side-effect marker is written); only the parent-side pipe capture / API result is broken.

## Control

Same machine, same binary `/home/tcuni-claw/.nvm/versions/node/v24.14.0/bin/node` (Node v24.14.0, libuv 1.51.0), run from a different executor: every case returns `error: null`, status 0, no signal, exact stdout. `baselineEvaluation.pass: true`, exit 0.

- Failing run: `attempt-2-failing-env/results.json` (2026-09-18T13:33:46Z)
- Green control: `results.json` (2026-09-18T13:40:16Z)

So the fault is in the sandboxed executor's handling of child stdio pipes, not in Node, libuv, this repo, or the OS.

## Reproduce

From the repo root, in the suspect environment:

    zsh .scratch/subprocess-capture-diagnosis-20260918/run-harness.sh

Pass criterion is `baselineEvaluation.pass: true` in `results.json` (requires `result.error === null`; status 0 alone is not evidence). The runner overwrites `results.json`; copy it aside first if the current one must be kept.

## Decision for this repo

- Not a bug in pi-planner-only. Tests were not changed to work around it.
- Commit 6f761fa adds `assert.ifError(probe.error)` / `signal === null` to all subprocess probes so a recurrence fails with the real EPERM instead of "PASS string missing".
- Subprocess-probe tests (`index.test.mjs`, `policy-cutover.test.mjs`, `task.test.mjs`, full `npm run test:release`) must be run from a normal terminal or CI. See AGENTS.md "Testing".

## Out of scope / for the executor owner

Identify which sandbox layer (seccomp/landlock/fd policy/ptrace wrapper) rejects the pipe operation while still reporting exit 0, and fix or document it. Nothing in this repo is waiting on that.
