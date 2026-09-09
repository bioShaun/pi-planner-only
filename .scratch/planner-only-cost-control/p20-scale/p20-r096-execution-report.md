# p20-r096-iso-e1 execution report

- round_id: `p20-r096-iso-e1`
- experiment: `ISO-E1` (luna root + luna worker, one E1 group)
- `CAP_USD` was unset in the shell; the driver-defined cap was not changed

## HEADs

- main repo start HEAD: `8b22568038140dda95a50351ac8c90dd099f325e`
- main repo end HEAD: `8b22568038140dda95a50351ac8c90dd099f325e`
- worktree start HEAD: `45d9493e25f47c58911edc01757c6133caeaa39d`
- worktree end HEAD: `45d9493e25f47c58911edc01757c6133caeaa39d`

The worktree SPLIT-E2 sample was restored before execution using only the permitted `git restore -- orchestrate.ts orchestrate.test.mjs`. The inner run then produced its expected two-file sample diff; it was not restored after the run.

## Results

- `ISO-E1` exit: `0`
- `.scratch/planner-only-cost-control/p20-scale/runs/session-ISO-E1`: present
- no `SPLIT-E1` session was created and no second group was started

Raw `spend.py` output, in required command order:

```text
0.157509
0.381727
```

Both spend commands exited `0`.

## Acceptance checks

- Main repo `git diff -- index.ts orchestrate.ts orchestrate.test.mjs`: empty.
- Worktree `git diff --stat -- orchestrate.ts orchestrate.test.mjs`:

```text
 orchestrate.test.mjs | 1 +
 orchestrate.ts       | 1 +
 2 files changed, 2 insertions(+)
```

## Logs

- `.scratch/planner-only-cost-control/p20-scale/p20-r096-slot-audit.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r096-slot-status.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r096-iso-e1.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r096-spend.log`

## Not done / assumptions

- No product files, existing runs, prompt/spec files, quarantine files, commits, or pushes were changed.
- The worktree's two-file diff is the inner `pi` sample produced by `ISO-E1`; its HEAD remains the required baseline.
- Existing session directories were left untouched; only the new `session-ISO-E1` was created by this round.
