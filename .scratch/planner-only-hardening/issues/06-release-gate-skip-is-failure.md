# 06: Release CI fails closed when contract tests skip

**What to build:** A publish or release run must not go green because upstream contract tests were skipped. Missing or out-of-range pi-subagents (or equivalent host peer) in the release environment fails the gate. Local developers may still skip those tests when the peer is absent. Package metadata states a Pi host compatibility range instead of an unbounded any-version peer. Existing typecheck and unit tests remain part of the gate; skip is not pass.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] In a release-like run with the upstream peer missing or outside the declared range, the contract suite fails the job (non-zero), and does not exit 0 with skip.
- [ ] Local invocation without the peer may still skip, with the skip reason visible.
- [ ] Package metadata declares a Pi host compatibility range; the previous unbounded host peer is no longer the documented support claim.
- [ ] Typecheck (`tsc --noEmit`) is required in the same release gate as the contract tests.

## Comments

Parent: hardening FR-07 / C01. If the actual GitHub/release workflow lives outside this repo, keep this ticket `ready-for-agent` for in-repo scripts and document the remaining human CI wiring rather than silently dropping the gate.
