# Runtime Reliability Fixtures (2026-09-11)

These are small, offline replay inputs for RR-01. They preserve the identity and
shape details that triggered the 2026-09-11 failures without containing user
paths, business results, credentials, or model calls.

## Files

- `completion-l19-l76.json` contains two `bg_wait` completion envelopes. Each
  completion has `runId`, `agent`, `outputState: "present"`,
  `artifactPaths.outputPath`, `artifactPaths.archivePath`, and child `results`.
  The L19 case explicitly names a missing legacy run directory. The report text
  is synthetic but schema-valid.
- `resume-c8e08f46-to-873bcc27.json` records the old and new run identity,
  `previousRunId`, `runId`, `executionId`, task identity, and output paths.
- `stale-same-name-agent-notification.json` models a completed old Task and an
  executing new Task that both use `reviewer`; the old notification includes a
  complete task hint and must not mutate the new Task.
- `contract-shapes.md` documents the frozen completion, resume, notification,
  and child packet interfaces used by these fixtures.
- `delegation-step2-handoff.json` keeps the raw Step 2 and handoff bodies beside
  their expected child packets. The packet shape is the RR-04 target:
  `{ version, spec, instructions, knownFacts, artifactRefs }`.

## Path and execution rules

Fixture JSON uses `${TEMP_ROOT}` and `${WORKSPACE}` tokens only. The replay
harness replaces these tokens with directories created by `mkdtempSync` under
the repository working directory. Tests create any output files after
replacement; no fixture points at a user directory or `/tmp`.

The fixture suite is a contract foundation, not an RR-02+ implementation. It
checks that the frozen host envelopes, report schema, notification identity,
resume linkage, and required raw delegation facts remain available for later
runtime changes. It does not treat process completion as Task acceptance.

## Shape notes

`bg_wait` is represented as `details.completions[]`; each completion is handled
as one child result. `artifactPaths` are references supplied by the host and
are intentionally not inferred from the largest file in a directory.

A notification's `taskIdHint` is only a routing identity. An old notification
whose agent name matches a current Task is not authorization to consume the
current Task's state, budget, or report slot.

The resume receipt is a new execution (`873bcc27`) linked to the previous
execution (`c8e08f46`) on the same canonical Task. The short IDs are retained
verbatim because they are the audit evidence used by the regression scenario.
