# Planner-only reliability hardening

Parent sources (do not duplicate; implement against these):

- `docs/pi-planner-only-hardening-spec.md` — evidence, delegation identity, write lock, reviewer packet, tool restore, release gates
- `docs/pi-planner-only-pending-delegation-blocker.md` — pending Delegation deadlock when `subagent-notify` never arrives (gap in the hardening spec)

Out of scope for new work (already implemented; keep as regression):

- Composite `tasks` / `chain` execution rejected before launch
- Reviewer does not rebind the original Task
- Async launch receipt is not treated as a completion report
- Default tool filtering does not auto-activate every registered safe tool

Tickets live in `issues/`. Work the frontier: any `ready-for-agent` ticket whose blockers are done.
