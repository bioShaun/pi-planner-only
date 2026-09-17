# Abandoning an abnormal execution is its own tool surface

Status: accepted 2026-09-17 (`.scratch/wrc-incident-followups/issues/02`)

`planner_verdict` no longer carries a `recovery` key at all. Giving up on an
abnormal execution — the `action:"abort"` half of the old RecoveryDecision —
moves to a dedicated `planner_abort` tool:

- `planner_verdict` records plain verdicts only: `pass` / `request_changes` /
  `blocked`. A passthrough `recovery` key arriving on a non-validating host
  is stripped and disclosed in `warnings`, never refused — the same shape as
  the ADR-0002 `taskId` strip on `planner_delegate`.
- `planner_abort` is the blocked verdict plus the abort RecoveryDecision as
  one atomic call: required `taskId`, `executionId`, `reason`,
  `worktreeDecision`; optional `evidenceRefs`, `summary`. There is no
  `action` field — the tool's identity is the action. It is only admissible
  while the Task flags `recovery.required`, validated through the same
  `validateRecoveryDecision` gate (executionId match, not yet consumed, no
  structural duplicate, non-empty reason); every refusal is recorded through
  `recordVerdictRefusal` with `kind: "recovery-invalid"` and echoes the
  received `executionId`, the Task state, and `required`/`consumedBy` so the
  caller can repair without guessing.

## Why

The 2026-09-17 WRC incident (Root session `01a0ac7f`) showed the old flat
contract — `verdict` plus an optional `recovery` — could not stop the model
from attaching an irrelevant recovery object to ordinary verdicts. The
refusal text was correct; the model replayed the combination anyway until the
refusal breaker intercepted it. Two structural options were considered:

- **Option B, a discriminated union** (`anyOf` over a no-recovery variant and
  a blocked+abort variant): rejected by direct probe on the incident
  provider. The `tcuni-agy` gateway + `gemini-3.8-flash-high` accept a
  top-level `anyOf` `parametersJsonSchema` (HTTP 200, correct branch picked
  for clean prompts) but do not constrain generation against it — prompted
  to attach recovery to `request_changes`, the model emitted exactly that
  illegal combination 3/3 times. A union that is accepted but unenforced
  offers only cosmetic safety.
- **Option A, a separate tool**: the "verdict plus maybe recovery"
  combination becomes inexpressible — there is no key left to write it into.
  This also closes a ledger blind spot found while building the regression
  fixture: the old cross-field refusal threw before
  `recordRootVerdictRefusal`, so recovery refusals left no audit row.

## Consequences

- Contract change: `package.json` bumps a minor version. `planner_abort`
  joins `ROOT_TOOLS` and `IDLE_TOOLS` (a blocked Task flagged
  `recovery.required` is final, so the abort call arrives while the
  workspace reads Idle) and the ticket-16 refusal breaker.
- `worktreeDecision:"manual"` on `planner_abort` releases the persisted
  writer hold, same as the old verdict path.
- Supersedes the abort entry points noted in ADR-0001 (P0-B runtime fact)
  and ADR-0002 (consequences): `planner_verdict` blocked + `recovery` is now
  `planner_abort`.
- Guidance everywhere — `PLANNER_PROMPT`, tool descriptions,
  `renderDelegationOutcome`'s `recovery.required` line, README/CONTEXT —
  names `planner_abort` and never again suggests a verdict carries recovery.
