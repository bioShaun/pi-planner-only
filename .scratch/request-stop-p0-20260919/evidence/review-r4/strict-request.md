# Strict review request r4 (delta-scoped): P0 Request admission after the normal-terminal release gate

Project cwd `/home/tcuni-claw/pi/pi-planner-only`, baseline `3991c5c762584cbbc235576359734259f69931ce`. User authorised "采用建议值和拆分，继续实现" and "将 05 处理完". Contract: `.scratch/request-stop-p0-20260919/spec.md`, tickets `issues/01–05`. Roadmap P1–P3 and model routing are out of scope. This request is self-contained.

The whole run has a hard 240-second external deadline. A first attempt with a full-source scope (`strict-request-v1.md`, `../../strict-run-QRchAR/`) timed out before the reviewer answered. Work in this order and stop with a verdict before the deadline; list anything not inspected as a limitation rather than guessing.

## 1. Manifest (fast)

`evidence/review-r4/source.sha256` lists the 63 frozen files; `head.txt`, `frozen-at.txt`, `status-before.txt`, `tracked.patch` accompany it. Confirm the manifest matches the working tree (`sha256sum -c --quiet`) and HEAD equals the baseline. Untracked production files are `request-control.ts`, `request-events.ts`; untracked tests are `request-control.test.mjs`, `request-stop.test.mjs`, `revalidation-accounting.test.mjs`.

## 2. Delta since the r3 freeze (the review target)

`evidence/review-r3/behavioral-review.md` is a fresh PASS on the r3 freeze; only five files changed since. `evidence/review-r4/delta-from-r3.diff` is the exact diff for the three tracked ones:

1. `index.ts` `requestFor` (around line 530): `previouslyManaged` now requires a `planner-only-request` session entry whose `data.sessionId` and `data.workspace` equal this controller's namespace. Previously any such entry in the session made every other workspace's first controller construct with `previouslyManaged: true` and, with no directory yet, throw "request record missing from an established session" — a `request-persistence` fault that `input()` and `resume()` in `request-control.ts` never clear. Judge whether the scoping is correct, whether the entry data can be trusted for this purpose (it is written only by `requestFor` at line ~542), and whether the lost-namespace protection for the *same* namespace is intact.
2. `policy-cutover.test.mjs` and `index.test.mjs`: fixtures that move to another workspace, or to a ctx without a session file, now first emit `agent_settled` and an idle interactive `input` for that ctx (and again when returning), which is the designed reopen path after the `session-switch` / `session-boundary-unverified` closure in `requestFor`. `policy-cutover` ctx gained `isIdle()`. Confirm no assertion was deleted or weakened (`git diff -- '*.test.mjs' | grep '^-.*assert'` is empty) and that the boundary sequence does not hide a product defect.
3. `request-stop.test.mjs` lines ~307–328 (untracked; new block `sibling-workspace`): a sibling workspace's entry does not fault this namespace (closes `session-boundary-unverified`, reopens after settled idle interactive input, `planner_tasks` then executes); the same namespace losing its own directory still faults `request-persistence: request record missing` after reload.
4. `docs/adr/0005-durable-request-admission.md` line 5 (untracked): one sentence now qualifies the public session entry as namespace-scoped.

Everything else in the frozen set is byte-identical to r3. Do not re-review it beyond callers of the changed code.

## 3. Executable evidence to spot-check (raw files only)

- Normal-terminal release gate on this exact source: `.scratch/request-stop-p0-20260919/release-run-Xg0XFH/` — `exit-code.txt` = 0; `test-release.log` = typecheck + all 33 test files including subprocess-spawning ones; `source-before.sha256` = `source-after.sha256` = current `*.ts`, `*.test.mjs`, `package.json`; slot preflight recorded; temp root recorded in `tmp-root.txt` (under `/project/tmp`, outside any Git worktree). The failed first gate is kept in `release-run-LICUcN/` (exit 1 at `policy-cutover.test.mjs:178` with the fault above; `per-file/` shows `index.test.mjs:1758` same fault and `evidence.test.mjs:1532` failing only because that run's temp root was inside the repository — `baseline-wt/evidence.log` reproduces that on untouched 3991c5c).
- Real `pi -p` + installed pi-subagents 0.69.0 on this source: `.scratch/request-stop-p0-20260919/cli-acceptance/REPORT.md` with run directories `cli-run-natural-*/` and `cli-run-deadline-*/` (`summary.json`, `events.jsonl` from the passive observer `probe-events.ts`, `request-state.json`, `ledger.json`, `stdout.jsonl`, `exit.json`). Natural: default limits, request open at exit, task completed. Deadline: `PI_PLANNER_ONLY_REQUEST_ACTIVE_MS=45000`, closure `active-time-limit`, CANCEL then `cancelled` terminal on the real transport, zero model calls / tool calls / REQUEST after closure, `rootStop: confirmed`.
- Earlier rounds unchanged: `evidence/final-validation/`, `evidence/final-validation-r2/`, `request-host-run-mZtnv0/`, `evidence/strict-review/`, `evidence/review-r2/`, `evidence/review-r3/`.

Interactive TUI evidence does not exist (no TTY); treat as unverified, not as failure.

## Constraints

Read-only. AGENTS.md forbids running `npm test`/`test:release` or subprocess-spawning tests inside a sandboxed agent executor; they already ran in a normal terminal and must not be rerouted or weakened. No `/tmp` (the outer script sets `TMPDIR` under `/project/tmp`). No heavy work (>1 minute, >2 GB, `/data_0`), no process killing, no slot capacity changes. Prove the parent's and the child's actual runtime filesystem permissions with a probe (a role TOML or a refusal is not proof). Missing required executable evidence is BLOCKED, not a guessed REQUEST_CHANGES. Return PASS / REQUEST_CHANGES / BLOCKED with what was independently verified, limitations, and findings ordered by severity, each with location, problem, impact, evidence and minimal correction direction.
