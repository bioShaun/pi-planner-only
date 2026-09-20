# P0 request admission bounded validation, round 2

Status: **PASS**

Evidence capture window: 2026-09-20T00:19:22Z through 2026-09-20T00:20:55Z UTC. Root declared this validator the sole writer for artifacts during the window. Target was `/home/tcuni-claw/pi/pi-planner-only`, Node v24.14.0, npm 11.9.0. `TMPDIR`, `TMP`, and `TEMP` pointed to `final-validation-r2/tmp`; `/tmp`, `/project/tmp`, network, paid providers, and slot were not used. Each command completed in under 60 seconds and was expected under 2 GB with no `/data_0` access.

## Commands and result

All 7 requested commands exited 0:

1. `npm run typecheck`
2. `node --experimental-strip-types revalidation-accounting.test.mjs`
3. `node --experimental-strip-types request-control.test.mjs`
4. `node --experimental-strip-types request-stop.test.mjs`
5. `node --experimental-strip-types architecture.test.mjs`
6. `node --experimental-strip-types .scratch/request-stop-p0-20260919/request-host-probe.mjs`
7. `git diff --check`

Exact commands, UTC timestamps, exit codes, stdout, and stderr are under `checks/<check>/`; `check-results.tsv` is the aggregate. The previously failing revalidation accounting test now emits `revalidation-accounting: PASS`.

## SDK host correlation

The independent installed-host probe used pi-coding-agent 0.85.1 and emitted PASS. In `request-host-run-X60LCM/results.json`, the repaired request records 3 tool attempts, 2 repairs, 2 unresolved failures in the same `contract:planner_tasks:arguments` family, and 0 child launches. The successive non-coercible schema inputs reduced reported invalid fields from 2 to 1 to 0. The full probe records `extraModelCallsAfterClose: 1`, `modelCallsTotal: 15`, and exactly 1 child launch in the independent fresh interactive request; stopped, unknown-tool, and repaired requests each record 0 child launches. Raw event order is in `request-host-run-X60LCM/trace.json`, with hashes in `sdk-artifact-sha256.txt`.

## Integrity and mutations

The scoped source manifest is `source-scope.txt`. Before and after SHA-256 manifests are byte-identical (`source-hash-compare-exit.txt` is 0). No source, test, dependency configuration, or Git metadata was edited by validation.

Round-one evidence remains unchanged. `source-drift-from-r1.diff` records the authorized changes present before round two in the hashed scope: the SDK probe, `index.ts`, and `revalidation-accounting.test.mjs`. Validation created only `.scratch/request-stop-p0-20260919/evidence/final-validation-r2/` and the authorized SDK run directory `.scratch/request-stop-p0-20260919/request-host-run-X60LCM/`, including Node's compile cache under the round-two local temp directory.

## Scope limits

PASS applies only to this bounded single-process round-two matrix. Unchanged pure tests were not repeated. `npm test`, `npm run test:release`, subprocess-running tests, real CLI/TUI, pi-subagents 0.69 runtime acceptance, paid/network providers, and strict isolation review remain outside this validation.

Writing stopped after freezing this report; artifact ownership returns to Root.
