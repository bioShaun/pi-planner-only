# Subprocess capture diagnosis

Verdict: **FAIL**

The current host does not satisfy the baseline probe. The corrected red/green run returned 1 because `node-console-spawnSync` returned `status: 0` together with `result.error.code: "EPERM"` and empty stdout, rather than the required `error: null` and `stdout: "capture-probe\n"`. Status 0 alone is not evidence of a normal successful spawn and does not establish that the plugin behavior is correct.

## Command and runtime

Tool call:

```text
zsh .scratch/subprocess-capture-diagnosis-20260918/run-harness.sh
```

The runner recorded and executed:

```text
env TMPDIR=/home/tcuni-claw/pi/pi-planner-only/.scratch/subprocess-capture-diagnosis-20260918/runtime-tmp TMP=/home/tcuni-claw/pi/pi-planner-only/.scratch/subprocess-capture-diagnosis-20260918/runtime-tmp TEMP=/home/tcuni-claw/pi/pi-planner-only/.scratch/subprocess-capture-diagnosis-20260918/runtime-tmp NODE_COMPILE_CACHE=/home/tcuni-claw/pi/pi-planner-only/.scratch/subprocess-capture-diagnosis-20260918/node-compile-cache timeout 30s node .scratch/subprocess-capture-diagnosis-20260918/harness.mjs
```

Corrected run: `2026-09-18T13:33:46.020292352Z` to `2026-09-18T13:33:46.226616777Z`; exit 1; harness stderr empty. Runtime: Node `v24.14.0`, executable `/home/tcuni-claw/.nvm/versions/node/v24.14.0/bin/node`, libuv `1.51.0`, Linux x64. The complete requested commands, timestamps, pids, status, signal, stdout, stderr, and serialized error fields are in `results.json`.

## Correlated evidence

| Case | Actual result | Interpretation |
|---|---|---|
| sync Node `console.log`, pipe capture | status 0; empty stdout/stderr; `error.code=EPERM` | Baseline failure. |
| sync Node `fs.writeSync`, pipe capture | status 0; expected stdout; `error.code=EPERM` | Bytes arrived, but the API still reported an error; this is not a PASS. |
| sync `/bin/echo`, pipe capture | status 0; expected stdout; `error.code=EPERM` | Same distinction; this is not a PASS. |
| sync Node `console.log`, regular-file stdout fd | status 0; `error=null`; file contains expected output | This alternative transport succeeded on this host. |
| async Node `console.log`, pipe capture | exit/close 0; empty stdout; no `error` event | Console output was absent despite normal lifecycle events. |
| async Node `fs.writeSync`, pipe capture | exit/close 0; expected stdout; no `error` event | Direct write output was collected in the async case. |
| sync side-effect then `console.log` | marker exists with `marker-written\n`; status 0; empty stdout; `error.code=EPERM` | The child performed real work even though the parent result carried an API error and lost console output. |

The writeSync output is an actual newline, not the two characters backslash+n. Independent byte inspection returned `[99,97,112,116,117,114,101,45,112,114,111,98,101,10]`; JSON escapes the LF as `\n` and the embedded JavaScript source escape as `\\n`.

These results distinguish child execution, output delivery, and the parent API result. They support only a host-local transport/capture distinction. They do not identify a Linux, Node, libuv, sandbox, or plugin root cause, and no cross-environment inference is made.

## Attempts

Attempt 1 (`2026-09-18T13:32:53.494052176Z` to `2026-09-18T13:32:53.700146916Z`) produced the same per-case behavior but the initial harness exited 0 because it had not yet converted the baseline assertion into its process exit code. That attempt is retained under `attempt-1/` and is not accepted as passing evidence.

Attempt 2 added only the requested red/green baseline gate. It persisted all results and then exited 1 for the observed `EPERM` plus missing stdout. Alternative cases do not override that failure.

## Evidence and mutations

- Current complete result: `results.json`
- Concise stdout / empty stderr: `harness.stdout`, `harness.stderr`
- Exact command and execution record: `invocation-command.txt`, `execution-metadata.txt`
- Regular-file and marker evidence: `redirected-console.stdout`, `side-effect.marker`
- Frozen initial attempt: `attempt-1/`
- Harness and runner: `harness.mjs`, `run-harness.sh`

Before state: HEAD `4fa55e3486ea36a1fa9bc321e3d3eccfc106ee9d`; only this artifact directory was untracked. After state: same HEAD, `git diff --exit-code` outside this artifact directory returned 0, and only this artifact directory remains untracked. No source, test, tracked file, global environment, or system configuration was changed.

Baseline files were preserved: `base.txt` SHA-256 `6e885cc0c42b49b06b43f86c9a110af41cc0bf2a2416af1c002465db9ea9895c`; `before-status.txt` SHA-256 `6edb78c5f4392ffd6462a410b1027a257c62f168bc2dc895cbaee226d6d2e786`.

## Minimum next step

Run the exact recorded command from the repository root in a separate supported terminal or CI environment using the same Node `v24.14.0`. A valid green comparison requires exit 0 and `baselineEvaluation.pass: true`, specifically `result.error: null`, status 0, no signal, and exact baseline stdout. Preserve that environment's `results.json`, stdout, stderr, timestamps, Node executable, and libuv version for comparison. Do not treat status 0 with any returned error as a successful control.

No plugin test, release run, or Pi invocation was performed, so this report does not accept or reject plugin behavior beyond the subprocess capture prerequisite.
