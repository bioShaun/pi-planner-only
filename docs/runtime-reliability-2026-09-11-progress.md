# Runtime Reliability Progress Handoff

Date: 2026-09-11
Pass: second-pass re-acceptance and live host replay
Task: T-20260911-018
Source: `/public/pi/pi-planner-only`
Installed clone: `/home/tcuni/.pi/agent/git/github.com/bioShaun/pi-planner-only`

## COMMITS LANDED on main

- `02a886c feat(runtime): persist reliable child execution state (RR-05)`.
- `87f0f7c fix(contract): stamp canonical WorkerReport task identity (launch-packet canonical id injection + worker contract)`.
- `4bdf2a0 fix(contract): enforce canonical report status tokens (RR-08 C22/C23: both enums in all report-returning prompts incl. wrapOracleContract, completed_with_limits→partial normalization, not-run exitCode drop)`.
- `d17e4d9 feat(restore): add bound planner recovery (RR-06 C18: planner_recover Root tool, RUN_UNBOUND/FOREIGN_RECEIPT/RUN_ALREADY_RECORDED, no subprocess, no paths, corrections-stable duplicates)`.
- `3ede155 feat(launch): add model preflight (RR-07 C20/C21: five-tier source attribution, MODEL_UNAVAILABLE with bounded candidates, explicit-configured-only fallback, preflight before budget reservation)`.

## Acceptance Matrix Update

| Criterion | Result | Evidence and limits |
|---|---|---|
| C17 | pass | Source guards are present in `orchestrate.ts:2427-2435`. Three identical live duplicate-verdict refusals on 2026-09-11 returned the stable `already completed; verdicts are final` error. |
| C18 | pass | Bound planner recovery is implemented and independently oracle-verified. |
| C19 | PARTIAL | Live replay on the pi host on 2026-09-11 exercised the exact-id `bg_wait` recovery path all day with structured reasons. Native-notification mode was confirmed working; asynchronous completions were delivered without polling. Bogus-model delegation was blocked pre-launch. A failed launch left no live task/write-lock; launch-failure cleanup was verified. Detached/unknown capability modes and cross-reload artifact recovery remain unproven. |
| C20 | PARTIAL-PASS | Unknown model was blocked pre-launch by the HOST's own `Unknown subagent model in the active Pi model registry` guard. The planner-only preflight did not visibly engage, live-confirming that `ctx.modelRegistry` is not exposed to the extension on this host. The major finding stands: preflight silently skips when the registry seam is absent. The host-level guard mitigates the risk, but the extension-level check is absent here. |
| C21 | pass | Implemented and covered by tests. End-to-end `stateReason` behavior after a real retry is still to be observed. |
| C22 | pass | All five prompt surfaces state both enums. Subsequent oracle reports demonstrably used the legal top-level status `completed`. |
| C23 | pass | `completed_with_limits` normalization to `partial` is implemented with repair notes, is idempotent, and is tested. |

The matrix distinguishes implemented and independently verified behavior from live-replay evidence. A partial result is not treated as a full host-capability pass.

## Live Host Replay Notes

The 2026-09-11 second pass confirmed the exact-id recovery and native-notification paths on the pi host, including structured recovery reasons and launch-failure cleanup. It also confirmed that host-side model validation can block an unknown model even when the extension cannot access the model registry. This host behavior mitigates the immediate unknown-model risk but does not verify the planner-only preflight seam.

## Open Items

- Replay detached/unknown host capability modes.
- Replay artifact and recovery behavior across a session reload.
- Decide whether an absent model registry should be documented as unverified-and-continue or should block.
- Observe `stateReason` during a live C21 retry.
- Tooling improvements: `commit-task` changedFiles convention should declare committed files; report-only corrections must embed a `TaskSpec` to bind correctly; `ORACLE_SUITE=missing` may skip non-command checks.

The spec and audit documents were not modified in this pass; this update records only the progress and replay results.
