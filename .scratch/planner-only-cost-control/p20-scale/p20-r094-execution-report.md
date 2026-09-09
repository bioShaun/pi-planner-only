# p20-r094 execution report

- round_id: `p20-r094`
- experiment: `SPLIT-E2` (luna root + qwen-local worker, one E2 group)
- `CAP_USD`: unset; driver cap was not changed
- started: after baseline and slot preflight; exact run command was `slot cpu -- bash .scratch/planner-only-cost-control/p20-scale/run.sh SPLIT-E2`
- finished: after run exit and immediate spend reconciliation

## HEADs

- main repo start HEAD: not sampled before execution; current/end HEAD is `54cc814479befa190fcc3af6921b183fd6e275de` and the required product-file diff is empty, so treated as unchanged
- worktree start HEAD: `45d9493e25f47c58911edc01757c6133caeaa39d`
- worktree end HEAD: `45d9493e25f47c58911edc01757c6133caeaa39d`

## Results

- `SPLIT-E2` exit: `0`
- required sample: `.scratch/planner-only-cost-control/p20-scale/runs/session-SPLIT-E2` present
- no new second `session-ISO-E2` was created by this run; the existing `session-ISO-E2` remains

Raw `spend.py` output, in required command order:

```text
0.017618
0.224218
```

Both spend commands exited `0`.

## Diff checks

Main repo check `git diff -- index.ts orchestrate.ts orchestrate.test.mjs`: empty.

Worktree check:

```text
orchestrate.test.mjs | 1 +
 orchestrate.ts       | 1 +
2 files changed, 2 insertions(+)
```

The inner `pi` made those expected sample changes in the existing worktree; no checkout, commit, push, or restore was performed after the run.

## Logs

- slot audit: `.scratch/planner-only-cost-control/p20-scale/p20-r094-slot-audit.log`
- slot status: `.scratch/planner-only-cost-control/p20-scale/p20-r094-slot-status.log`
- run log: `.scratch/planner-only-cost-control/p20-scale/p20-r094-split-e2.log`
- spend log: `.scratch/planner-only-cost-control/p20-scale/p20-r094-spend.log`

## Not done / assumptions

- I did not alter the worktree sample files because the instructions require preserving the inner `pi` changes and forbid checkout/restore after execution.
- Main-repo start HEAD was not captured before running; the current HEAD and empty required diff are reported, with unchanged-main assumed.
- No second experiment or any ISO/SPLIT-E1/SPLIT-E3 run was started.
