# Execution Report

- round_id: `p19-r089`
- main HEAD at start/end: `54cc814479befa190fcc3af6921b183fd6e275de` / `54cc814479befa190fcc3af6921b183fd6e275de`
- experiment worktree HEAD at start/end: `45d9493e25f47c58911edc01757c6133caeaa39d` / `45d9493e25f47c58911edc01757c6133caeaa39d`
- slot preflight: `.scratch/planner-only-cost-control/p19-experiment/p19-r089-slot-audit.log`, `.scratch/planner-only-cost-control/p19-experiment/p19-r089-slot-status.log`
- command: `slot cpu -- bash .scratch/planner-only-cost-control/p19-experiment/run.sh ISO-38`
- ISO-38 exit: `0`
- session: `.scratch/planner-only-cost-control/p19-experiment/runs/session-ISO-38` present
- main target diff (`index.ts orchestrate.ts orchestrate.test.mjs`): empty
- worktree sample diff stat (`orchestrate.ts`): `orchestrate.ts | 13 ++++++++-----` (`8 insertions(+), 5 deletions(-)`)

## spend.py output

```text
0.030139
0.077359
```

## Not done

No second group was started. `CAP_USD` was not set. No files were changed in the main worktree, no commit or push was made, and the experiment worktree HEAD was not changed. The pre-existing `session-ISO-39` directory was observed; no new `session-ISO-39` or `session-SPLIT-38` was created.

## Assumptions

The existing `session-ISO-39` is prior state and is outside this round; only `session-ISO-38` was executed. The worktree's `orchestrate.ts` diff is the sample change produced by the inner run and was left in place as required.
