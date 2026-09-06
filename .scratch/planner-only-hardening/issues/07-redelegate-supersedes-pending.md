# 07: Same-Task re-delegation supersedes leftover pending children

**What to build:** Starting a new Delegation for a Task that already has a pending child must not leave two waiters that make every later completion notice ambiguous. The new start supersedes the old pending record for that Task (after ticket 01’s artifact reconcile has had a chance to consume a finished run). A completion notice that names that Task then matches exactly one waiter. A late notice for a superseded run is ignored or marked superseded — it must not attach to the new invocation or rewrite the new WorkerReport.

**Blocked by:** 01: Lost child completion no longer deadlocks Task verdicts

**Status:** ready-for-agent

- [ ] Re-delegating Worker (or Reviewer / Validator) on a Task that still has a pending child leaves at most one pending Delegation for that Task; the older one is superseded, not kept beside the new one.
- [ ] A single-run completion notice with that Task’s id matches the remaining waiter; two same-role leftovers no longer cause “match nothing”.
- [ ] A late notice for the superseded runId does not record a second report or move the Task backwards.
- [ ] Ticket 01’s reconcile still runs on the superseded record if its artifacts are already terminal, so a finished older run is not silently discarded when it still has a usable WorkerReport.

## Comments

Parent: pending-delegation-blocker (plugin defects 2–3 and match ambiguity) and hardening D08 (late/duplicate completion).
