# 01: Partition T2 into Worker-attributed vs baseline lag

**What to build:** At C-sample time, Git-read attaches a bounded first-parent per-commit name list (`MAX_BASELINE_LAG_COMMITS = 200`) onto C. compareEvidence stays a pure function and reads that list (missing/incomplete ⇒ today's unsplit T2). Lag = non-merge commits strictly before the oldest declaration-intersecting commit. From that commit through C, all covered T2 is Worker-attributed. `lagPaths` is explicit; `truthPaths` / `undeclaredPaths` / unexplained overlapping-unrelated exclude lag. Lag is not a `reasons[]` entry. Lag-only: `fresh: true`, `unexplained: false`. Merges skipped for intersection; uncovered T2 fail closed. Coverage fail closed if oldest walked parent ≠ A or any `committedPaths` entry is uncovered. Effective baseline = parent of oldest Worker-attributed commit, or C only when T2 is empty (working-tree-only). Empty declaration plus non-empty A..C is under-report, not lag. Variant C: per-root walk, absolute paths, fail closed if a root cannot be walked. Do not put a Git runner on compareEvidence. Do not use upstream or tags as A.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Walker attaches per-commit `{ sha, parentSha, parentCount, paths }` on C when `baseGitRef` is set; cap 200; Git-read only.
- [ ] Injected lag fixture: unrelated commits then declared-only tip, clean tree → `fresh: true`, unrelated paths only in `lagPaths`, not in `truthPaths`/`undeclaredPaths`/`reasons`, `evidenceAction` is `review`, describeComparison is lag not `stale (out-of-scope only)`.
- [ ] Tip (or later) commit also touches an undeclared in-scope file → unexplained under-report; that path is not in `lagPaths`.
- [ ] Disjoint undeclared-only commit **before** the first intersecting commit → those paths are `lagPaths` (residual hide-before).
- [ ] T1 dirty path, content-hash drift, or report `finalGitRef` ≠ C → still unexplained / revalidate as today; lag-only still `fresh: true` so `fresh === true` call sites need no edit.
- [ ] A not first-parent ancestor of C, over cap, missing parent, or uncovered `committedPaths` (including merge-skip holes) → no `lagPaths`, unsplit T2.
- [ ] Merge commit intersecting the declaration does not Worker-attribute its whole first-parent dump; leftover uncovered T2 fail closed.
- [ ] Empty declaration (`changedFiles: []`) with non-empty A..C committed paths → no `lagPaths`, unexplained under-report, not `fresh: true`. No intersecting commit is unsplit T2, not "the whole walk is lag".
- [ ] Effective baseline = oldest Worker-attributed commit's first parent, or C.finalGitRef only when there is no intersecting commit **and** T2 is empty. Non-empty T2 with no intersection keeps today's A (unsplit).
- [ ] Additional worktree root: absolute paths; unwalkable root fail-closes the combined sample.
- [ ] RF-1 T2 still attributes intersecting worker commits. CHANGELOG Unreleased / CONTEXT.md baseline lag (or with ticket 02). compareEvidence tests do not construct a Git runner.

## Comments

Parent: `.scratch/evidence-baseline-lag/spec.md` (stories 1–8, 3b, 11–13, 21–25, 29–32, 35–36; P1-1(b), P1-2, P1-3, P1-5).

Incident note (2026-09-10, T-20260910-001): A = `8bab410`, C tip committed 4 in-scope files, recorded report `changedFiles: []`. That is under-report, not lag. A naive "no intersecting commit ⇒ whole T2 is lag ⇒ fresh" would PASS that Feishu empty report. The empty-declaration fixture above is that case.
