# Evidence baseline lag

**Status:** ready-for-agent

Arbitration (2026-09-10): compareEvidence stays pure; the first-parent walk is precomputed onto the C sample. Lag is a `lagPaths` field, not a `reasons[]` entry, so lag-only stays `fresh: true`. `decideReview` receives `previousComparison` from before `setLastComparison`. Coverage and merge holes fail closed to unsplit T2. No Worker-attributed commit ⇒ effective Reviewer baseline is C. Spin guard only when `verifiable`. Cap `MAX_BASELINE_LAG_COMMITS = 200`.

Incident (2026-09-10): a Worker committed only `.scratch/root-idle-phase/` files at `8bab410`. The review loop used A = `4dd63ca` (release 0.4.1), treated `CHANGELOG.md` / `README.md` / `index.ts` (from already-pushed `5f0ab0d` and `09c5955`) as changed after the report, re-delegated Validators for three rounds, then blocked. Oracle blame showed those paths were not this Task. `planner_verdict` stayed blocked because it compares A↔C, not first-parent blame.

## Problem Statement

When an operator finishes a bounded Task, the review loop can still declare Evidence stale and burn every correction round, even though the Worker only committed the files it declared.

The comparison treats every path committed between the Task's A sample and HEAD as this Task's delta. If A is an old commit — a restored Task, a rebound identity, or a long-lived A that never moved — the first-parent history that landed on the branch before this WorkerRun looks like edits after the report. The prescribed fix is to re-delegate a Validator. Validators do not resample A. The comparison cannot change. Three rounds later the Task is blocked, and only an operator override can record a Verdict.

## Solution

The C sample carries a bounded first-parent name list for `A..C`. Evidence comparison stays a pure function over A, C, and the WorkerReport: it splits that list into Worker-attributed T2 and baseline lag.

Baseline lag is first-parent history **strictly before** the oldest Worker-attributed commit. It is not "changed after the report", does not enter `reasons[]`, does not set `unexplained`, and leaves lag-only comparisons `fresh: true`. `lagPaths` holds those paths; `truthPaths` and `undeclaredPaths` hold only Worker-attributed paths so the Reviewer packet does not advertise lag files as this Task.

The Reviewer's patch is bounded against the parent of the oldest Worker-attributed commit, or against C when this WorkerRun made no attributed commit, so the Reviewer is not shown a release-to-HEAD dump.

True post-report drift still forces revalidate. Incomplete walks fail closed to today's unsplit T2. Identical verifiable revalidate reasons do not consume a correction round. Identity sentinel aliases stay in the Idle-phase tickets.

## User Stories

1. As an operator, I want a Worker that only committed its declared files to be Evidence-fresh even if A sits on an older ancestor, so that already-pushed unrelated commits cannot block the Task.
2. As Root, I want an explicit `lagPaths` field, and I want `truthPaths` / `undeclaredPaths` to contain only Worker-attributed paths, so that Reviewer `attributedFiles` / `undeclaredFiles` and `under-reported:` reasons cannot carry CHANGELOG-class lag.
3. As Root, I want undeclared paths from the oldest Worker-attributed commit through C to stay under-reported, so that a Worker cannot hide extra files in that commit or in later commits.
4. As Root, I want working-tree paths that became dirty after A and are not declared (T1) to stay post-report drift, so that a real parallel edit still cannot PASS.
5. As Root, I want content-hash drift on paths hashed in the report and in C to stay unexplained, so that porcelain-unchanged content edits still cannot PASS.
6. As Root, I want HEAD movement after the report's bound `finalGitRef` to stay unexplained, so that a later commit or checkout still cannot PASS as the same report.
7. As Root, I want baseline lag omitted from `reasons[]` and not to set `unexplained`, so that lag-only stays `fresh: true` and `evidenceAction` is `review`, and so bounded-oracle / `Validation: passed` sites that key off `fresh === true` do not change.
8. As Root, I want `describeComparison` to label lag-only as lag from `lagPaths.length` (for example `fresh (attributed X; lagged N)`), never as `stale (revalidate)` or `stale (out-of-scope only)`, so that Root is not told to re-delegate validation.
9. As a Reviewer, I want the review packet's patch baseline to be the first-parent parent of the oldest Worker-attributed commit when one exists, or C when none exists, so that I see this Task's diff or a working-tree packet rather than a release-to-HEAD dump.
10. As a Reviewer, I want that effective baseline to be a first-parent SHA derived from the walk that matches the existing Git-ref shape check, not a Root-sampled ref, not `origin/main`, and not a release tag.
11. As an operator, I want a clean tree whose HEAD commit only touches declared files, with unrelated commits between a lagged A and that HEAD, to compare fresh with those unrelated paths only in `lagPaths`, so that the 8bab410 incident cannot repeat.
12. As an operator, I want a Worker that also changes an undeclared in-scope file in the same HEAD commit, or in any commit after the oldest Worker-attributed commit, to still be under-reported, so that lag is not a laundering hatch for hides at or after Worker work. A disjoint commit strictly before any Worker-attributed commit remains lag (accepted residual).
13. As an operator, after a valid report, I want an external dirty file to still revalidate, so that lag attribution does not disable the existing stale-working-tree guard.
14. As Orchestration, I want the Reviewer packet to use the comparison's effective baseline, not `baseEvidence.finalGitRef` alone, so that prepare-review and compareEvidence cannot disagree on which diff the Reviewer saw.
15. As Root, I want `planner_verdict` pass still to re-sample the workspace snapshot at accept time, so that this spec does not weaken snapshot PASS.
16. As Root, I want write locks, fresh Reviewer context, and identity checks unchanged, so that lag attribution does not reopen hardening.
17. As a Validator, I want a revalidate decision whose reasons are identical to `previousComparison` (the comparison recorded before this one was written) to consume no correction round when the new comparison is verifiable, so that oracle spinning cannot exhaust `MAX_REVIEW_ROUNDS` on an unfixable A.
18. As an operator, I want that identical-revalidate path to tell Root the comparison did not change and that another Validator will not move A, so that the next step is a new Worker round (which may resample A) or an operator Verdict, not a third oracle.
19. As Root, when a Worker report is recorded and `baseRoundEnded` is true, I still want the next Worker Delegation to resample A, so that a real new round gets a current baseline.
20. As Root, I want Validators and Explorers never to resample A, so that inspection cannot quietly move the attribution window.
21. As Root, I want the first-parent walk to run at C-sample time on the existing read-only Git runner (fixed argv, no shell), so that compareEvidence stays synchronous and pure.
22. As Root, I want that walk capped at `MAX_BASELINE_LAG_COMMITS` (200), so that a huge lagged history cannot hang the comparison.
23. As Root, when the walk is over cap, a ref is missing, the oldest walked commit's first parent is not A, or any `committedPaths` entry is not covered by a walked non-merge commit, I want today's unsplit T2, so that an incomplete partition cannot mark extra files as lag.
24. As Root, I want merge commits (more than one parent) skipped for the intersection test, so that a merge's first-parent name-only dump of incoming main files is not treated as Worker-attributed just because it intersects the declaration. Paths that then sit in T2 but in no walked non-merge commit fail closed via story 23. This spec does not claim merge-second-parent history is absent from the tree diff.
25. As an operator, I do not want A to be defined as `origin/main` or the latest tag, so that a disconnected clone and a release tag cannot become the hidden baseline.
26. As an operator, I want README and the Chinese README to say that first-parent history strictly before this WorkerRun's attributed commits is baseline lag, not post-report drift, so that the incident is documented as product behaviour.
27. As an operator, I want CONTEXT.md to define baseline lag as Evidence: paths from first-parent non-merge commits strictly before the oldest Worker-attributed commit, disjoint from the WorkerReport declaration, so that later tickets do not say "stale" for that set.
28. As an operator, I want CHANGELOG Unreleased to record baseline-lag attribution and the identical-revalidate non-consumption, so that the behaviour change is visible.
29. As Root, I want out-of-scope-only working-tree drift to keep today's action (`review` when not unexplained), so that lag is a new T2 class, not a rewrite of scope rules.
30. As Root, I want report-only corrections to keep today's over-report exception, so that schema-only fix rounds do not deadlock.
31. As an operator, I want the Idle-phase sentinel-alias tickets to remain the identity fix; this spec assumes a Task may still carry an old A (ledger restore, long session) and must still converge, so that fixing aliases is not a prerequisite for unblocking the incident class. If that A is not a first-parent ancestor of C, story 23 fail-closes rather than inventing lag.
32. As Root, I want `describeComparison` to list lag path counts from `lagPaths` without dumping the full release diff into Root's injected text, so that v0.3.2 injection budget is not reopened.
33. As a Reviewer, I want a truncated packet still ineligible for PASS, so that a huge remaining worker diff cannot complete by truncation.
34. As Root, I want L-4 blocked→pass with a report and fresh Evidence (no post-report drift) unchanged, including lag-only remaining `fresh: true`, so that the verdict hatch and `fresh === true` downstream sites stay aligned.
35. As an operator, I want existing RF-1 tests (worker commits between A and C attributed as T2) to keep passing when those commits intersect the declaration, so that lag is a split of T2, not a deletion of T2.
36. As Root, I want declared additional worktree roots each walked with that root's A/C refs and absolute paths, and I want a root that cannot be walked to fail closed for the combined sample, so that Variant C does not mix vocabularies or silently drop a root.
37. As Root, I want the identical-reason spin guard to apply only when the new comparison is `verifiable`, so that a stuck `git unavailable` reason list cannot disable `consumesRound` forever; unverifiable comparisons keep today's round consumption and can still block.
38. As Orchestration, I want `decideReview` / `advanceReview` to receive `previousComparison` captured before `setLastComparison` overwrites the Task, so that "identical to last recorded" cannot compare the new comparison to itself.

## Implementation Decisions

- Do not add a phase service. Evidence comparison remains the attribution seam and remains a **pure synchronous function**. It does not take a Git runner. Orchestration keeps sampling A on first non-Explorer writable Delegation and passing the Reviewer packet. The Review loop remains the consumer of `evidenceAction`.
- Do not redefine A as upstream or a tag. A stays the stored `baseEvidence` sample.
- Git-read: when capturing C with a `baseGitRef` (A.finalGitRef), also walk at most `MAX_BASELINE_LAG_COMMITS` (200) first-parent commits in `A..C` (exclusive A, inclusive C) and attach a per-commit list of `{ sha, parentSha, parentCount, paths }` (name-only) on the C sample. No shell. No `origin/main`. No `git describe`. If the walk is skipped, omit the list.
- compareEvidence reads that attached list. Missing list, over-cap, unreadable ref, oldest walked commit's `parentSha` not equal to A.finalGitRef, or any `committedPaths` entry not covered by a walked **non-merge** commit ⇒ behave as today (unsplit T2, no `lagPaths`). Do not invent lag.
- Merge commits (`parentCount > 1`) are skipped for the declaration-intersection test. They do not become Worker-attributed via their first-parent dump. Uncovered T2 from that skip hits the coverage fail-closed rule above.
- Oldest Worker-attributed commit = oldest walked non-merge commit whose paths intersect the WorkerReport declaration (`changedFiles` / report `changedPaths`). Commits strictly before it whose paths are disjoint are baseline lag. From that commit through C, every T2 path covered by the walk is Worker-attributed (declared or under-reported), including later disjoint-looking commits.
- `lagPaths` is the lag set. `truthPaths` and `undeclaredPaths` exclude `lagPaths`. overlapping/unrelated unexplained sets exclude `lagPaths`. Do not push a lag string into `reasons[]`.
- Lag-only (no other reasons): `fresh: true`, `unexplained: false`, `evidenceAction` `review`. Downstream `lastComparison.fresh === true` (bounded oracle wrap, status `Validation: passed`) is unchanged. `describeComparison` uses `lagPaths.length` for a compact lag clause; it must not emit `stale (out-of-scope only)` or `stale (revalidate)` for lag-only.
- Effective Reviewer baseline: first-parent parent of the oldest Worker-attributed commit when one exists; **C.finalGitRef** when none exist (working-tree-only or empty Worker delta). The value must satisfy the existing Git-ref shape. Orchestration passes this ref into the Reviewer packet instead of always `baseEvidence.finalGitRef`.
- Variant C: each declared additional root is walked with that root's refs; paths stay absolute. A root that cannot be walked fail-closes the combined sample (no partial lag).
- Review loop: Orchestration snapshots `task.lastComparison` into `DecideReviewInput.previousComparison`, then writes the new comparison, then calls `advanceReview`. Identical `reasons` spin guard runs only if the new comparison is `verifiable` and `previousComparison` exists and `reasons` are equal. Then: do not consume a correction round; do not tell Root another Validator will move A. `!verifiable` keeps today's `consumesRound` / block path. Validators never resample A.
- Undeclared Worker-attributed T2, T1, content drift, HEAD movement after the bound report ref, cwd change, missing Git, failed status probes: today's unexplained/revalidate rules.
- Identity sentinel aliases remain Idle-phase tickets. This spec must still pass the lagged-A incident without that fix landed.
- README ×2, CONTEXT.md (baseline lag as defined in story 27), CHANGELOG Unreleased. Do not claim A is now `origin/main`.
- Do not auto-PASS. Snapshot PASS at accept is unchanged.

## Testing Decisions

Good tests assert external behaviour: `fresh` / `unexplained` / `evidenceAction` / `lagPaths` vs `truthPaths` / effective baseline / whether a round incremented. They do not snapshot full reason strings as the only assertion, and they do not assert helper names.

Seams (no new module):

1. Git-read walker (C sample) — attaches per-commit lists; over-cap / missing parent / non-ancestor A / uncovered `committedPaths` omit the list (fail closed).
2. Evidence comparison (pure) — tests **inject** the per-commit list on C; they do not pass a Git runner into compareEvidence. Assert lag vs under-report vs T1; `lagPaths` excluded from truth/undeclared; lag-only `fresh: true` and no lag entry in `reasons`; describeComparison lag label; effective baseline C when the list has no intersecting commit.
3. Review loop — `revalidate` on true post-report drift; identical **previousComparison** reasons do not increment the round when verifiable; unverifiable identical reasons still consume a round; lag-only does not `revalidate`.
4. Orchestration Reviewer packet — `baselineRef` is the comparison effective baseline.

Prior art: Evidence RF-1 T2/T3 tests, object-style compareEvidence fixtures, `rf1Runner` / real-git fixtures for capture, Review `consumesRound`, Orchestration L-4, Reviewer packet baseline.

A good lag test: inject commits (unrelated files) then a tip commit = declared files; A = old; C = tip; report declares tip files; `lagPaths` = unrelated; `truthPaths` = declared; `fresh: true`; effective baseline = tip's first parent. A good under-report test adds an extra undeclared file on the tip (or a later commit) and asserts unexplained. A good hide-before test: disjoint undeclared-only commit then declared tip → undeclared-only paths in `lagPaths`. A good coverage test: A not ancestor of C, or merge-only coverage hole → no `lagPaths`, unsplit T2. A good spin test: pass `previousComparison` with the same reasons as the new verifiable stale comparison and assert the round did not increase.

Do not require a live host session. Do not require `origin/main` in the fixture. Do not require compareEvidence to call git.

## Out of Scope

- Example-JSON `T-pending` alias (Idle-phase ticket 01).
- Idle gather Policy (Idle-phase ticket 02).
- Choosing A from `origin/main`, default branch, or release tags.
- Raising or removing `MAX_REVIEW_ROUNDS`.
- Snapshot PASS identity, write locks, structured-Delegation default, usage floors.
- Auto-recording `planner_verdict` pass.
- Showing the full A..C patch to Root.
- Walking merge-second-parent history (skipped merges fail closed when they leave uncovered T2).
- Making compareEvidence asynchronous or giving it a Git runner.

## Further Notes

The plugin never selected `v0.4.1` by name; it used A. If A is a release commit, the Reviewer packet looks like a release baseline. Fix attribution and the packet, not tag parsing.

Re-delegating a Validator cannot move A. Any design that leaves lag as `revalidate` will reproduce the three-round block.

Lag-only must remain `fresh: true` so bounded oracle and status `Validation: passed` do not silently degrade.

Baseline lag is an Evidence class, not a Task state.
