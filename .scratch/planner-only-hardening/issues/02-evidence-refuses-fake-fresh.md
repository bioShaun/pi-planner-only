# 02: Evidence comparison refuses fake-fresh

**What to build:** At the acceptance boundary, Root must not treat a WorkerReport as fresh when the validated content has changed or when Git probing did not actually succeed. A dirty or untracked file whose contents changed since the report still has the same status/HEAD fingerprint must be stale, and a PASS must not complete the Task. A failed status probe or a report missing required evidence fields must be unknown, never an empty clean tree. Existing `gitAvailable=false` revalidation stays. This ticket does not introduce a full workspace snapshot; it binds the hashes and probe outcomes already sampled.

**Blocked by:** None (can start immediately).

**Status:** done (implemented in 3408664)

- [x] Changing a dirty file’s contents without changing porcelain status makes compare-evidence stale; `decideReview` with PASS does not accept.
- [x] Changing an untracked in-scope file’s contents makes compare-evidence stale; PASS does not accept.
- [x] A non-zero or timed-out Git status probe yields unknown (not available-with-empty-status); PASS does not accept.
- [x] A report missing required HEAD / status / content-binding fields yields unknown and asks for re-validation; it does not default to fresh.
- [x] Regression tests cover these four cases in a real temporary Git repo, not only synthetic fixtures.

## Comments

Parent: hardening FR-01 core (E01, E02) and FR-02 (E06, E07). Full WorkspaceSnapshot is ticket 10.

- Implemented in 3408664; acceptance criteria covered by the suite described in the commit message.

## Implementation notes

- The "missing required fields" rule is two-tier: a report with no Git binding at all, or no HEAD binding (`finalGitRef`) while Git is verifiable, is unknown. Status/content bindings are enforced by Root stamping its own sample into every recorded report (`bindReportToSample`) plus the ticket-10 snapshot gate, so a report missing what Root would have bound is exactly one Root never validated.
