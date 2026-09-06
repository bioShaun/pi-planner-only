# 03: All writable Delegations share one write lock

**What to build:** Write coordination follows actual write ability, not the Worker role name or the presence of a TaskSpec. A warn-mode unstructured Worker, a Validator that can run a general shell, a second writable call on the same Task, and a cwd that is only a path alias of an already locked worktree must all contend for one writer. Two such calls on the same worktree: only one proceeds; the other is refused before the child starts. Explorer stays unlocked. Independent worktrees are not serialized by this ticket.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Two concurrent writable Delegations on the same worktree: only one obtains the lock; the other is blocked before launch and no executing state is created for the loser.
- [ ] A second writable Delegation for the same Task still goes through invocation-level conflict detection (same-Task is not a free pass).
- [ ] Warn-mode Worker without a TaskSpec still takes the write lock.
- [ ] Validator with bash (or any general shell) is treated as writable and takes the same lock; absence of edit/write tools is not enough to skip it.
- [ ] Relative-path and symlink aliases of the same worktree are recognized as one tree for conflict.

## Comments

Parent: hardening FR-04 / D02–D06. Process-lifetime of the lock is ticket 09.
