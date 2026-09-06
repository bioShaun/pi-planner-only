# 10: Versioned WorkspaceSnapshot is the only freshness basis for PASS

**What to build:** Acceptance compares a versioned workspace snapshot digest, not HEAD/status hashes. The snapshot covers in-scope modifications, adds, deletes, and declared untracked inputs; file kind, symlink target, and execute bit participate. Digest is computed from a normalized sorted manifest and content hashes. Hitting file/byte/time budget, unreadable paths, or unstable sampling returns unknown with a reason — never truncated-but-fresh. Old WorkerReports that lack the new fields cannot auto-PASS. A ReviewResult from ticket 08 must also name this digest so review and acceptance share one snapshot identity.

**Blocked by:** 02: Evidence comparison refuses fake-fresh; 08: Reviewer PASS cannot accept a newer WorkerReport

**Status:** done (implemented in 07099f8)

- [x] Content-identical files with only mtime change do not flip the digest to stale.
- [x] In-scope add or delete changes the digest; PASS against the old digest is stale.
- [x] Symlink target change changes the digest or is explicitly unknown/unsupported — it is not omitted then called fresh.
- [x] Over-budget or unstable sampling returns unknown and does not accept.
- [x] A pre-snapshot WorkerReport cannot complete via PASS; it is unknown and asks for a new report.
- [x] ReviewResult without the matching workspace digest cannot complete a Task that has a newer snapshot.

## Comments

Parent: hardening FR-01 remainder (E03–E05, E08–E11) and D09 digest binding. Largest ticket; if scope explodes during implementation, split only after 02 and 08 have landed, do not start this in parallel with them.

- Implemented in 07099f8; acceptance criteria covered by the suite described in the commit message.
