# pi-planner-only Evidence Authority Spec

> Scope: the evidence comparison and review-boundary code in `bioShaun/pi-planner-only` after commit `e840e9a`
>
> Goal: make Root-owned Git samples authoritative for delegation attribution while retaining Worker evidence as a bounded declaration that can be cross-checked.
>
> Principle: **the process that controls the review boundary must sample the evidence used to make that boundary decision.**

## Status

**IMPLEMENTED** — Root A-to-C attribution is the comparison denominator; Worker evidence is a declaration cross-check.

## 1. Summary

The current orchestration path can capture three evidence snapshots for one delegation, but the comparison currently uses only two of them:

```text
A: Root captures base evidence when delegation begins
B: Worker reports evidence in WorkerReport
C: Root captures current evidence when the result arrives

Current: compare(B, C)
Target:  diff(A, C) -> authoritative delegation changes
         compare(B, diff(A, C)) -> declaration cross-check
```

Snapshot A is stored as `TaskRecord.baseEvidence` by `TaskStore.setBaseEvidence()`. Its current consumers only extract `baseEvidence.finalGitRef` into a `baseGitRef` field used in delegation/review packet data and rendered by `report.ts`; it is not an input to `compareEvidence()`. The current implementation therefore answers a freshness question, not the attribution question required by scope and PASS review.

This proposal is deliberately split into a semantics phase and a rendering phase. The first phase establishes the truth computation and its tests. The second updates the presentation and downstream contracts after the new comparison shape is stable.

# 2. EA-1 — Root-Owned Evidence Model

## Problem

`captureEvidence()` is Root's Git probe. `orchestrate.ts` captures and stores the delegation-time sample in `baseEvidence`, then captures a new sample at result handling. However, `evidence.ts` currently declares `compareEvidence(report, current, options)` and begins with `const reported = report.evidence`; its comparison is Worker B against Root C.

The two comparisons answer different questions:

```text
B vs C: Has the workspace changed since the Worker wrote its report?
        This is report freshness.

A vs C: What changed during the delegation window?
        This is delegation attribution.
```

The README and planner prompt require scope boundaries and an evidence-aware PASS boundary. Those boundaries need A vs C. A Worker report must not define the denominator used to assess the Worker itself.

## Required invariant

For a Git-verifiable delegation, Root must compute the authoritative changed set from two Root-owned samples:

```text
base := evidence sampled by Root before delegation
current := evidence sampled by Root when the result is handled
truth := diff(base, current)
```

`truth` is the source of the scope denominator and of the changed paths attributed to the delegation. The Worker report is not an authority for that set.

If either endpoint cannot be verified as Git evidence, the comparison remains `verifiable: false`, is not presented as fresh, and follows the existing `evidenceAction()` revalidation path.

# 3. EA-2 — Authoritative Attribution and Declaration Cross-Check

## Problem

The current `compareEvidence()` constructs `reportedPaths` from `report.evidence.changedPaths`, falling back to `report.changedFiles`, and then builds `scopePaths` from those reported paths plus allowed scope paths. A Worker that forgets to report one edited file removes that file from the denominator. The resulting edit can be treated as unrelated/out-of-scope and downgrade the review path instead of being detected as an inaccurate declaration.

No malicious Worker is required for this failure. Incomplete or malformed Worker reports are a normal failure mode, and the auditee supplying the audit denominator makes the boundary weaker than intended.

## Required invariant

The target API must accept the Root base sample, Root current sample, and Worker report:

```ts
compareEvidence(base, current, report, options)
```

The exact type-level shape may follow the existing local conventions, but its semantics must be equivalent to:

```text
truthPaths = paths changed between base and current
scopePaths = truthPaths + normalized allowed task paths
```

`report.changedFiles` and the Worker evidence path fields are declaration data only. A mismatch between the declaration and `truthPaths` produces an explicit comparison reason/finding:

```text
truth path absent from declaration -> under-reporting / concealment
reported path absent from truth   -> over-reporting / unreliable declaration
```

Neither mismatch may change the authoritative scope classification. In particular, an under-reported path must remain visible to scope and PASS decisions.

The comparison must continue to preserve existing checks where they remain meaningful, including cwd mismatch, superseded tasks, HEAD changes, missing paths, overlapping paths, unrelated paths, and the `unexplained` decision signal. The new shape must make clear which fields describe attribution and which describe declaration consistency.

# 4. EA-3 — Worker Contract Simplification

## Problem

Workers run as restricted child processes and do not have access to the Root extension's `evidence.ts` implementation. Requiring a Worker to reproduce Root's exact `git status --porcelain=v2` sampling and status-hash convention is not a reliable protocol boundary.

## Required invariant

A valid WorkerReport must not require `gitStatusHash` or `finalGitRef` for authoritative evidence attribution. The Worker may provide those fields as optional declaration data for cross-checking, but Root must be able to compute the authoritative result when they are absent.

The required Worker contract should focus on the task identity, status, changed-file declaration, validation results, and bounded summary already defined by `WorkerReport`. Missing Worker-side Git fingerprints must not silently disable Root's A-to-C attribution check.

# 5. EA-4 — Dirty Baseline and Trust Boundary

## Problem

A repository may already contain edits before a delegation begins. A comparison against the present tree alone cannot distinguish those edits from work performed during the delegation window.

## Required invariant

Root's base sample is the lower boundary of attribution. Changes already represented in A must not be attributed to the delegation when C is compared with A:

```text
pre-existing dirty paths in A -> excluded from delegation delta
new paths introduced by A -> C -> included in delegation delta
```

Only after this change does the planner's rule, **"Never trust a worker that reports its own PASS"**, hold in implementation rather than only in the prompt: the PASS boundary can be based on Root-owned samples even when Worker evidence is incomplete or inaccurate.

# 6. EA-5 — Verifiability and Known Limitations

## Problem

Git evidence is not available in every workspace, and Root samples cannot identify which actor made a concurrent edit.

## Required invariant

Non-Git workspaces remain `unverifiable`. The existing `EvidenceComparison.verifiable` field in `evidence.ts` must remain false when Git cannot be sampled; such a result must not be described as `fresh`, and `evidenceAction()` must request `revalidate`.

The A-to-C model attributes all changes in its window to the delegation, including a human edit or another agent's edit. Therefore the existing per-cwd writer lock is a precondition for correct attribution, not merely a convenience. `findWriterConflict()` currently compares resolved cwd values for exact equality. A writer in `/repo` and another in `/repo/packages/a` consequently do not register as conflicting even though their paths overlap. This proposal does not silently solve that separate path-prefix/worktree policy issue.

The evidence refactor changes `EvidenceComparison` semantics and may add fields for authoritative paths and declaration mismatches. Downstream consumers must be updated deliberately:

- `describeComparison()` and `evidenceAction()` in `evidence.ts`;
- the review evidence packet builder in `evidence.ts`;
- comparison storage through `TaskStore.setLastComparison()`;
- comparison creation and rendering in `orchestrate.ts`, including worker and reviewer paths;
- `report.ts` rendering of evidence fields, including its `baseGitRef`/head display.

# 7. EA-6 — Two-Phase Rollout

## Problem

Changing comparison semantics and changing every display string at the same time increases the diagnostic surface. A failing test would not show whether the truth computation or the presentation contract was wrong.

## Required invariant

Implementation must proceed in two phases.

### Phase 1 — Semantics

Change the comparison contract to take Root base evidence, Root current evidence, and the Worker report. Compute the delegation delta from A to C, use that delta as the scope denominator, and add declaration-mismatch findings. Update the comparison call sites in `orchestrate.ts` and focused assertions in `evidence.test.mjs`. This phase must prove the truth computation independently of final wording.

Required semantic cases include:

- a Worker that omits a changed path cannot hide it from scope evaluation;
- a Worker that reports a path not present in the Root delta is flagged as unreliable;
- pre-existing dirty paths are excluded by the base sample;
- missing Git evidence remains unverifiable and requires revalidation;
- optional Worker Git fingerprints do not prevent Root attribution.

### Phase 2 — Rendering

Update `describeComparison()`, `evidenceAction()` where its new fields require it, the review packet representation, and `report.ts` evidence rendering. Preserve bounded output and make authoritative attribution, declaration mismatch, and unverifiable state distinguishable to the parent.

The phase boundary exists because the new `EvidenceComparison` shape affects four or five presentation and transport sites. Keeping rendering separate makes a semantics failure attributable to the A-to-C calculation rather than to changed labels or packet formatting.

# 8. EA-7 — Acceptance and Non-Goals

## Problem

A design proposal can accidentally become a general multi-agent attribution system. This change is narrower: it establishes a Root-owned evidence boundary within the existing in-memory orchestration lifecycle.

## Required invariant

The implementation must not add persistence, background watchers, telemetry, a queue, or a general conflict-resolution service as part of this refactor. It must preserve the existing fixed, read-only Git access model and bounded review packets.

Acceptance requires:

```text
Root samples A and C
A-to-C changed paths drive scope classification
Worker declarations are cross-checked but not authoritative
non-Git results are unverifiable
Phase 1 and Phase 2 have focused tests
```

The existing writer-lock limitation and concurrent-edit attribution limitation must remain documented until addressed by a separate proposal.
