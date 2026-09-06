# 09: Write lock outlives stale executing until the child is known stopped

**What to build:** The write lock from ticket 03 is held by the invocation, not by a timer on Task `executing`. Launch failure, operator cancel, timeout, and plugin disable must not release the lock while the child process may still be running. A holder whose executing state looks stale still blocks a new writer until Orchestration can show the process exited (or the operator explicitly abandons). Timeout is not the same as exit. Cleanup and unlock are idempotent. A launch that never created a process may unlock.

**Blocked by:** 03: All writable Delegations share one write lock

**Status:** ready-for-agent

- [ ] An executing Task that is past the stale-duration still blocks a second writable Delegation on that worktree if the child has not been confirmed exited.
- [ ] Cancel or report-parse failure does not drop the lock until the child is known stopped (or never started).
- [ ] Timeout moves the Task into an explicit blocked / needs-reconcile state rather than unlocking for the next writer.
- [ ] Confirmed start failure (no process) does unlock and does not leave a phantom holder.
- [ ] Unlock after confirmed exit is idempotent if completion and cancel both fire.

## Comments

Parent: hardening FR-04 / D07, plus pending-delegation-blocker suggestion to distrust a launch receipt that the host is not actually tracking as background.
