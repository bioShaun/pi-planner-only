# 01: Lost child completion no longer deadlocks Task verdicts

**What to build:** When a child run has actually finished but its completion notice never reaches Root, the Task can still leave executing. Orchestration reconciles each pending Delegation against the child-run artifacts it already knows how to read: a terminal run is consumed as a Worker or Validator result and the pending record is deleted. If artifacts are missing or still running, Root may record `blocked` through `planner_verdict`. `pass` and `request_changes` still wait on a live pending child. The operator override slash commands stay as a backstop, not the only exit.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Given a pending Delegation whose child-run meta shows a terminal exit, recording any verdict first consumes that run (WorkerReport / Validator result as appropriate) and clears the pending record instead of refusing forever.
- [ ] Given a pending Delegation with no terminal artifacts, `planner_verdict` with `blocked` is accepted and the Task becomes blocked; `pass` and `request_changes` still refuse with a pending-child reason.
- [ ] A later `subagent-notify` that does arrive still matches and completes a single pending Delegation; reconcile is idempotent and does not double-apply a run.
- [ ] Existing unit coverage that treats a live pending child as blocking `blocked` is updated so that *unreconciled live* pending still blocks non-blocked verdicts, while terminal artifacts or an explicit `blocked` escape hatch succeed.

## Comments

Parent: pending-delegation-blocker (plugin defects 1 and 4) plus hardening FR-04 failure-path cleanup for lost completion, not write-lock scope.
