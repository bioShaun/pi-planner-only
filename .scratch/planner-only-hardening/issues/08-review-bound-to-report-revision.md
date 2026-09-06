# 08: Reviewer PASS cannot accept a newer WorkerReport

**What to build:** Each Worker execution of a Task carries its own report revision (and the workspace summary ticket 02 already binds). A ReviewResult is accepted only when it names that same Task, that report revision, and the digest/summary it reviewed. An old Reviewer PASS must not complete the Task after a newer WorkerReport exists. Unknown or mismatched identity is refused; Orchestration does not guess. Root’s own `planner_verdict` still arbitrates, but it must not treat a stale Reviewer PASS as current.

**Blocked by:** 02: Evidence comparison refuses fake-fresh

**Status:** ready-for-agent

- [ ] After report revision N is reviewed PASS, a new WorkerReport N+1 is recorded: applying the stored N PASS does not complete the Task.
- [ ] A ReviewResult whose report revision or workspace summary does not match the latest report is refused; Task state is unchanged.
- [ ] A well-formed ReviewResult that matches Task id, report revision, and current summary is still recorded as today.
- [ ] Root `planner_verdict` does not inherit a stale Reviewer’s `evidenceFresh` as proof of the new report.

## Comments

Parent: hardening FR-03 / D09 (reportRevision binding). WorkspaceSnapshot digest as the sole freshness key is ticket 10.
