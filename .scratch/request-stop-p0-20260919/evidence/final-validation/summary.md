# P0 request admission bounded validation

Status: **FAIL**

Evidence capture window: 2026-09-20T00:12:47Z through 2026-09-20T00:14:52Z UTC (see `started-utc.txt` and `ended-utc.txt`). Root declared this validator the sole writer for the window. Target was `/home/tcuni-claw/pi/pi-planner-only`, Node v24.14.0, npm 11.9.0. `TMPDIR`, `TMP`, and `TEMP` pointed at `final-validation/tmp`; `/tmp`, `/project/tmp`, network, paid providers, and slot were not used. Each check completed in under 60 seconds and was expected under 2 GB with no `/data_0` access.

## Result

21 of 22 requested commands exited 0. `node --experimental-strip-types revalidation-accounting.test.mjs` exited 1. Its assertion at line 153 reported `planner-only request closed: tool-call-replay` when line 201 tried to continue after the intentional replay of tool call ID `revalidation-1`. This is retained as failed pre-fix evidence in `checks/15-revalidation-accounting/`.

The other requested checks passed: typecheck; 14 other direct test files; request-control; request-stop; SDK host probe; two syntax-only Node checks; release script Bash syntax; and `git diff --check`. Exact commands, UTC timestamps, exit codes, stdout, and stderr are in `checks/<check>/`; the aggregate is `check-results.tsv`.

## SDK host correlation

The installed-host probe used pi-coding-agent 0.85.1 and emitted PASS. `request-host-run-B7A0Gk/results.json` records the configured limits 32 tool attempts, 8 child launches, 3 unresolved failures per family, 2 repairs, and 900000 ms active deadline. It records three unresolved `contract:planner_verdict:TASK_NOT_FOUND` failures, `extraModelCallsAfterClose: 1`, zero child launches in the closed request despite the queued delegate attempt, two extension inputs without reopening the request, one child launch after a fresh interactive request, and three unknown-tool attempts/failures. The probe's PASS assertion covers the explicit slash-command reset case as well. Raw event order is in `request-host-run-B7A0Gk/trace.json`; hashes are in `sdk-artifact-sha256.txt`.

## Source integrity and mutations

The scoped source manifest is `source-scope.txt`. Before and after SHA-256 manifests are byte-identical (`source-hash-compare-exit.txt` is 0). No source, assertion, dependency configuration, or Git metadata was edited by validation.

Created artifacts are limited to `.scratch/request-stop-p0-20260919/evidence/final-validation/` and the authorized SDK run directory `.scratch/request-stop-p0-20260919/request-host-run-B7A0Gk/`. Node generated its compile cache under the authorized `final-validation/tmp` directory; no test workspace remained there. The pre-existing root fixture directory `.planner-only-request-fixture-P0vJ1w` predates this validation and was not changed or removed.

## Scope limits

This result covers only the bounded single-process checks requested by Root. `npm test`, `npm run test:release`, subprocess-running source tests, real CLI/TUI, pi-subagents 0.69 runtime acceptance, paid/network providers, and strict isolation review were not run. Root separately reported a host integration gap where host-rejected schema errors count as attempts but do not enter structural repair tracking; that finding is outside these executed checks and prevents acceptance until fixed and revalidated.

Writer ownership is returned to Root after this frozen report. No corrective rerun was performed.
