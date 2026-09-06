# 04: Reviewer sees a bounded patch against the Task baseline

**What to build:** A Reviewer invocation receives enough diff to judge the Task, not only path lists and stat summaries. The ReviewRequest includes a bounded patch relative to the Task’s start baseline, covering staged, unstaged, added, deleted, renamed, and already-committed Task changes. Oversized diffs are truncated with omitted-path / truncated counts so the Reviewer cannot treat a partial packet as complete. Diff-check covers staged and unstaged and keeps exit code plus stderr. Binary changes keep a fingerprint, not a fake text patch.

**Blocked by:** None (can start immediately).

**Status:** done (implemented in c479be6)

- [x] A Worker that only staged whitespace-breaking changes: Reviewer packet diff-check reports the problem and retains the non-zero exit.
- [x] Deleting a required check is visible as a patch against the Task baseline, not only as a path name.
- [x] Worker commits the Task’s changes: Reviewer still sees a patch relative to the Task baseline, not “empty because HEAD moved”.
- [x] When the patch exceeds size or file budget, the packet marks omitted paths and truncated totals; a Reviewer must request more or return incomplete, not PASS as if the packet were whole.

## Comments

Parent: hardening FR-05 / R01–R04.

- Implemented in c479be6; acceptance criteria covered by the suite described in the commit message.
