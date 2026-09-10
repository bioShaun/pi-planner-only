# 02: Reviewer packet uses effective baseline; identical revalidate does not spin

**What to build:** Orchestration passes the comparison's effective Reviewer baseline into the Reviewer packet (parent of oldest Worker-attributed commit, or C when none — never a lagged A dump). Lag-only comparisons do not `revalidate`. Before `setLastComparison`, snapshot `previousComparison` into `DecideReviewInput`. Identical `reasons` spin guard runs only when the new comparison is `verifiable`; then do not consume a round and do not tell Root a Validator will move A. `!verifiable` identical reasons still consume rounds and can block. True post-report stale still revalidates. Snapshot PASS, write locks, Validators-never-resample-A unchanged. README ×2 document lag vs post-report drift. Downstream `fresh === true` sites are unchanged because lag-only stays fresh (ticket 01).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Incident-shaped fixture: Reviewer `baselineRef` is the Worker tip's first parent, not `4dd63ca`-class A; packet attributed files exclude `lagPaths`.
- [ ] No Worker-attributed commit (working-tree-only): Reviewer `baselineRef` is C, not A.
- [ ] Lag-only comparison does not enter `revalidate` / does not increment `reviewRound`.
- [ ] `advanceReview` is given `previousComparison` captured before overwrite. Two consecutive identical **verifiable** stale comparisons: second does not increment the round; guidance does not say re-delegate validation as if A will change.
- [ ] Two consecutive identical **!verifiable** comparisons: second still consumes a round (no infinite spin hatch).
- [ ] Distinct new post-report drift still `revalidate` and consumes a round; existing `MAX_REVIEW_ROUNDS` block still applies to real stale.
- [ ] `planner_verdict` pass still re-samples the workspace snapshot. L-4 blocked→pass with fresh Evidence still works. Validators do not call `setBaseEvidence`. Bounded oracle / status `Validation: passed` still key off `fresh === true` with no new special case.
- [ ] README and README.zh-CN describe baseline lag. CHANGELOG Unreleased if not already in 01.

## Comments

Parent: `.scratch/evidence-baseline-lag/spec.md` (stories 9–10, 14–20, 26–28, 33–34, 37–38; P1-4, P2-8, P2-10).
