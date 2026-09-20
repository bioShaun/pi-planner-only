# Strict review request r4: P0 Request admission, post normal-terminal release

Project cwd `/home/tcuni-claw/pi/pi-planner-only`, baseline `3991c5c762584cbbc235576359734259f69931ce`. User authorised "采用建议值和拆分，继续实现" and then "将 05 处理完". Original approved contract `.scratch/request-stop-p0-20260919/spec.md`, tickets `issues/01–05`. Roadmap P1–P3 and model routing are out of scope. This request is self-contained; earlier rounds are context only.

## What to review

The frozen 63 files listed in `source.sha256` in THIS directory (`evidence/review-r4/`), with `tracked.patch`, `status-before.txt`, `head.txt`, `frozen-at.txt`. Untracked production files are `request-control.ts` and `request-events.ts`; untracked tests are `request-control.test.mjs`, `request-stop.test.mjs`, `revalidation-accounting.test.mjs`. Confirm the manifest matches the working tree before reading.

Five files changed since the r3 freeze (`evidence/review-r3/source.sha256`), all after the normal-terminal release gate first ran and failed:

1. `index.ts` `requestFor`: `previouslyManaged` now requires a `planner-only-request` session entry whose `data.sessionId` and `data.workspace` equal the controller's own namespace. Before, any such entry in the session marked every other workspace's first controller as "record missing from an established session", an unrecoverable `request-persistence` fault (`input()` and `resume()` refuse while `fault` is set). Trigger observed in `policy-cutover.test.mjs` and `index.test.mjs` when one host session addresses several workspaces.
2. `policy-cutover.test.mjs`, `index.test.mjs`: fixtures that cross to another workspace (or to a ctx without a session file) in the same host now pass through the designed boundary first: `agent_settled` then an idle interactive `input`, the same sequence the P0 implementer already used for the shutdown case. No assertion was removed or weakened; `policy-cutover` gained `isIdle()` on its ctx.
3. `request-stop.test.mjs`: new case `sibling-workspace`: another workspace's entry does not fault this namespace (it closes with `session-boundary-unverified`, reopens after settled idle interactive input), and the same namespace losing its own directory still faults with `request-persistence: request record missing` after reload.
4. `docs/adr/0005-durable-request-admission.md`: one sentence qualifies the session entry as namespace-scoped.

Product limits, closure precedence, claims, cancellation and the `session-switch`/`session-boundary-unverified` behaviour are unchanged from r3. Review current correctness, spec fit and affected callers of `requestFor`, the boundary closure, and the reopen paths independently.

## Executable evidence available (inspect raw files; do not trust summaries)

- Normal-terminal release gate: `.scratch/request-stop-p0-20260919/release-run-Xg0XFH/` — `exit-code.txt` 0, full `test-release.log` (typecheck + all 33 test files including subprocess-running ones), `source-before.sha256` = `source-after.sha256`, both equal to the current `*.ts`, `*.test.mjs`, `package.json`. `slot-audit.txt`/`slot-status.txt` recorded before the run. The temp root was under `/project/tmp` (recorded in `tmp-root.txt`), not `/tmp` and not inside a Git worktree.
- The earlier failing release run is retained: `release-run-LICUcN/` (exit 1: `policy-cutover.test.mjs:178` persistence fault) with `per-file/*.log` showing `index.test.mjs:1758` same fault, `evidence.test.mjs:1532` failing only because that run's temp root was inside the repository worktree (`baseline-wt/` shows the same evidence failure on untouched baseline 3991c5c), and the `after-fix*.log` sequence.
- Real CLI + pi-subagents 0.69.0 (print mode) on the current source: `.scratch/request-stop-p0-20260919/cli-acceptance/` — `REPORT.md`, `run-cli.mjs`, passive `probe-events.ts`, and two run directories with `versions.json`, `events.jsonl`, `stdout.jsonl`, `request-state.json`, `ledger.json`, `usage.jsonl`, `summary.json`, session files. `natural`: default limits, request open at exit, 2 REQUEST/2 terminal/1 CANCEL (existing runaway controller), task completed. `deadline`: `PI_PLANNER_ONLY_REQUEST_ACTIVE_MS=45000`, closure `active-time-limit`, CANCEL then `cancelled` terminal on the real transport, zero model calls/tool calls/REQUEST after closure, `rootStop: confirmed`.
- Prior rounds unchanged: `evidence/final-validation/`, `evidence/final-validation-r2/`, SDK faux probe `request-host-run-mZtnv0/`, behavioural reviews `evidence/strict-review/`, `evidence/review-r2/`, `evidence/review-r3/behavioral-review.md` (r3 PASS predates the five changes above).

Not available: interactive TUI evidence (no TTY); treat as unverified, not as failure.

## Constraints

Read-only. AGENTS.md forbids running `npm test`/`test:release` or subprocess-spawning tests inside a sandboxed agent executor; they were run in a normal terminal above and must not be rerouted or weakened. No `/tmp`; the outer script sets `TMPDIR` to a directory under `/project/tmp`. Do not start heavy work (>1 minute, >2 GB, `/data_0`), do not kill processes, do not change slot capacity. Confirm actual parent and child runtime filesystem permissions with evidence; a role TOML or a refusal is not proof. Missing required executable evidence is BLOCKED, not a guessed REQUEST_CHANGES. Return PASS / REQUEST_CHANGES / BLOCKED with independently verified content, limitations, and findings ordered by severity, each with location, problem, impact, evidence and minimal correction direction.
