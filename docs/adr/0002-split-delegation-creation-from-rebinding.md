# Delegation creation and rebinding are separate tools

Status: Superseded 2026-09-24 by the lite rewrite (`docs/pi-planner-only-subtraction-plan.md`); kept for history. Code: tag `legacy-full-audit`.

`planner_delegate` is split into two tool surfaces over the same
`runDelegation` seam:

- `planner_delegate` **only mints** a new Task. Its schema has no `taskId`,
  no `recovery`, and no `reviewer` role — there is no key left on the creation
  path into which a model can write an invented id.
- `planner_redelegate` **only binds** an existing Task. `taskId` is required
  and must be the canonical id verbatim from a prior result's
  `details.taskId`; all four roles plus the `recovery` decision live here —
  a correction round after `request_changes`, a reviewer invocation over the
  latest WorkerReport, or a recovery re-execution of a blocked Task.

`runDelegation` keeps its signature and semantics; `index.ts` registers both
tools through one execute factory that strips a passthrough `taskId`/`recovery`
on the minting surface (with a disclosed `warnings` entry, never a refusal)
and refuses a missing `taskId` on the binding surface (`TASK_REQUIRED`) before
it can silently mint.

## Why

An optional `taskId` on a single tool is an invitation to fill it in. Ticket
13 already made `TASK_UNKNOWN` actionable ("omit taskId to create a new
Task"), yet session `01a0a9cc` and ticket 13's own evidence show the model
reads the guidance and then replays the same invented id verbatim —
`T-20260717-001`, `T-20260918-015`. The prompt line "pass it as taskId on
every later call" pattern-matches to "always pass one". Refusal wording cannot
fix a surface that permits the mistake; the fix is structural: the creation
schema has no `taskId` key at all, so the only way to name a Task is the tool
whose contract requires a real one.

## Considered options

- **Keep one tool; treat an id that was never minted as omitted (1b).**
  Rejected: "was this id ever issued" needs agreement across the in-memory
  store, the persisted ledger, and allocator claims, and the restore cap
  means the in-memory view can be incomplete — three sources, still
  fallible. Worse, a typo of a real id would silently mint a new Task, which
  is a worse failure than a refusal.
- **Split the surface (1a, chosen).** No guessing about caller intent:
  `taskId` is meaningless on the creation tool and required on the binding
  tool. The "explicit id binds the stored record verbatim" contract moves to
  `planner_redelegate` unchanged.
- **Name the binding tool something else (`planner_continue`,
  `planner_bind`).** Rejected: `planner_redelegate` reads as "the delegate
  tool again, on the same Task" — it names the operation Root is performing
  (another delegation) rather than the mechanism (binding a record), which
  matches how the model already talks about the action.

## Consequences

- This is a contract change: `package.json` bumps a minor version. The old
  "pass `taskId` on `planner_delegate`" move now mints a new Task with a
  warning naming the ignored key — it can never produce `TASK_UNKNOWN` again.
- `planner_redelegate` keeps `TASK_UNKNOWN` / `TASK_FOREIGN_WORKSPACE` /
  `TASK_CLOSED` / the recovery gate and the ticket-13/14 role-aware guidance,
  surface-corrected: refusal text names the tool that was actually called and
  never advises omitting `taskId` on a bind-only surface.
- `planner_redelegate` joins `IDLE_TOOLS` and `ROOT_TOOLS` — a blocked Task
  flagged `recovery.required` is final, so its workspace reads Idle when the
  recovery call arrives.
- Supersedes the recovery entry-point part of ADR-0001's P0-B runtime note:
  `planner_delegate.recovery` is now `planner_redelegate.recovery`.
- The repeated-refusal breaker (`.scratch/nx-followups/issues/16`) stays
  wired on both surfaces for every refusal that remains.
- Superseded in part by ADR-0003 (2026-09-17): the `action:"abort"` half of
  the RecoveryDecision moved off `planner_verdict` onto the dedicated
  `planner_abort` tool — `planner_verdict` carries no `recovery` key at all.
