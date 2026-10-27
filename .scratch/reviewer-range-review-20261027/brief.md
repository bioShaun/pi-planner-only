# Frozen review brief

Baseline: cd5362490251aabdb1214b8041e70542cd5ff54a. Review uncommitted final candidate in /home/tcuni-claw/pi/worktrees/reviewer-range-20261027, not the concurrently edited main checkout. Candidate has no commits beyond baseline. full.diff is `git diff cd53624 --` plus the new reviewer-range.test.mjs. sha256-final.txt binds the candidate; no writer runs during review.

## Root-approved spec (supersedes original ticket's proposed file artifact)

- Optional `base` on Lite delegate, reviewer only. No-base behavior unchanged, no Native/off feature changes, no new host request field.
- Fixed base...HEAD semantics with full base, HEAD and unique merge-base SHA in task/outcome. Complete text patch inline, not input artifact. Input grammar: HEAD/HEAD~N, valid named branch/remote/tag, full 40/64 SHA; reject option/control/other revision expression, ambiguous/unresolved/noncommit.
- Worktree with commits must be clean (tracked/index/nonignored untracked), errors fail closed. Freeze SHAs, recheck HEAD/clean before dispatch; cancelled preflight emits zero requests. Named refs resolve to canonical refs. No or multiple merge bases produce explicit refusal.
- Safe fixed Git argv; disable fsmonitor, external diff, textconv, color; force submodule visibility; bounded execution must not silently truncate output. Reject empty, binary, gitlink/submodule changes. Max complete UTF-8 patch 32768 bytes, inclusive. Reject over-limit; no clipping. Reject final built task >1MiB before dispatch.
- Task labels patch as data, asks complete review or INCOMPLETE, declares live checkout and no immutable snapshot guarantee. Existing reviewer no-lock semantics unchanged. On terminal recheck HEAD/clean; stale or failed check sets ok=false and prefixes invalid/unconfirmed message, preserving host status and usage. Unknown/unfinished terminal keeps original failure behavior. Completed never means business accepted.
- English/Chinese README and delegate schema guidance explain option/limits. No plannerPrompt expansion, configuration option, snapshot platform, persistent artifact lifecycle or public helper tool.
- Original red proves missing inline committed diff. New behavior fixes require real failing test before change; existing working behaviors may receive direct green coverage. Fault-injection for added guards; preserve existing assertions. Complete isolated release includes real test:release. No paid reviewer behavior test required. Actual old Git not available/tested is a disclosed limitation, not an automatic blocker; avoid using known unsupported flags. Before/after checks cannot exclude transient change-and-revert.

## Evidence

All paths relative to candidate worktree:
- .scratch/reviewer-range-implementation-20261027/{execution.md,red.log,green.log,followup-red.log,followup-green.log,release-final.log,sha256-final.txt}
- New reviewer-range.test.mjs is imported by delegate.test.mjs.
- Resource logs contain unrelated jobs: do not reproduce or include them in review outputs.

## Review discipline

Read actual code/diff and critical tests; do not infer acceptance solely from worker's COMPLETED. Report only concrete issues with paths/lines, severity, reproduction reasoning and smallest fix. Distinguish optional style concerns from blockers. Do not re-run tests or edit files. Reports under 400 words, Chinese, concluding PASS or CHANGES REQUESTED. No supervisor tool investigation or main-checkout writes.

Standards sources: AGENTS.md, CONTEXT.md, docs/agents/domain.md, docs/agents/issue-tracker.md, relevant local established code patterns. Historical ADRs superseded by CONTEXT are not current requirements.

Smell baseline (heuristics, not hard rules; repository standards override; skip tooling-enforced points): Mysterious Name—unclear names, rename honestly; Duplicated Code—same logic, share appropriate extraction; Feature Envy—logic using another module's data, move to owner; Data Clumps—repeated related fields, consider one type; Primitive Obsession—domain values without useful type; Repeated Switches—repeated decision trees, map only if simpler; Shotgun Surgery—one change scattered, consolidate ownership; Divergent Change—unrelated reasons to edit one module, separate responsibilities; Speculative Generality—unused abstractions/hooks, delete; Message Chains—caller traverses internals, hide navigation; Middle Man—pass-through module with no benefit, inline; Refused Bequest—inherited contract unused/overridden, avoid inappropriate inheritance. Label any smell as possible, with evidence, never automatic violation.
