# 01: Live writable Delegations hold the worktree lock

**What to build:** Starting a writable Delegation (Worker, Validator, or warn-mode unstructured Worker) either consumes a finished leftover child, supersedes a waiter that is not actually running, or is refused — it never launches beside a live writer on the same worktree. The lock is owned by that live invocation, not by the Task sitting in executing. Explorer and Reviewer stay unlocked. Independent worktrees stay independent. A lost completion notice with terminal artifacts is reconciled before the lock is taken, so a finished run is not mistaken for a live writer. A leftover waiter whose child is not known stopped still blocks. Needs-reconcile notes on a stale holder are recorded through the Task store.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Two Validators (or a Validator beside a Worker) on one worktree: the second begin is refused before launch; no second child is registered.
- [ ] A Worker begin while the Task is reviewing and a writable Delegation is still pending is refused; a Worker begin while reviewing and only a Reviewer is live is allowed.
- [ ] Warn-mode unstructured Worker and same-Task second writable call contend for the same lock; relative-path and symlink aliases of one worktree share it.
- [ ] Lost-notify Worker still executing with terminal artifacts: next same-Task begin consumes the finished run, then starts. Without terminal artifacts, the next writable begin is refused; `blocked` remains allowed.
- [ ] A leftover waiter with no live child is superseded so a later notice matches one waiter; a late notice for the superseded run records nothing. A leftover whose child is not known stopped is not superseded into a second live writer.
- [ ] Confirmed never-started unlocks; timeout, cancel, and unreadable output do not. Unlock after confirmed exit is idempotent. Stale-holder needs-reconcile text goes through the Task store, not an in-place field write.

## Comments

Parent: `.scratch/planner-only-hardening-gaps/spec.md` (user stories 1–23, 35–36, 40). Hardening tickets 03 / 07 / 09 leftovers.
