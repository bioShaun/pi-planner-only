# 02: Reviewer PASS is snapshot-bound; truncated packets cannot complete

**What to build:** A Reviewer PASS completes a Task only when it names the latest report revision and the WorkspaceSnapshot digest bound to that report, and a newly sampled snapshot at accept time still matches. HEAD/status hashes and a Reviewer’s `evidenceFresh` flag cannot stand in. A pre-snapshot report cannot complete via Reviewer PASS or via Root `planner_verdict`. If the ReviewRequest’s patch was truncated or omitted paths, PASS is refused and Task state is unchanged; `request_changes` and `blocked` still record. Root `planner_verdict` with a matching snapshot still completes. README (and the Chinese README) say a bounded patch crosses the Reviewer seam and that PASS is snapshot-digest-bound.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Reviewer PASS that omits report revision or workspace digest, or that names a HEAD/status fallback digest, does not complete the Task.
- [ ] Reviewer PASS whose digest does not match a newly sampled WorkspaceSnapshot (including unknown/over-budget samples) does not complete; a matching digest plus matching revision still does.
- [ ] A pre-snapshot WorkerReport cannot complete via Reviewer PASS or via Root `planner_verdict`.
- [ ] Reviewer PASS with `patchTruncated` or omitted patch paths is refused; `request_changes` and `blocked` still record.
- [ ] A Reviewer’s `evidenceFresh` flag does not override the snapshot comparison.
- [ ] README and the Chinese README state that a bounded patch is in the ReviewRequest and that PASS is snapshot-digest-bound.

## Comments

Parent: `.scratch/planner-only-hardening-gaps/spec.md` (user stories 24–34, 37–40). Hardening tickets 04 / 08 / 10 leftovers.
