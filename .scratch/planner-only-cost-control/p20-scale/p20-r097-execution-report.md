# p20-r097-iso-e1r2 execution report

- round_id: `p20-r097-iso-e1r2`
- experiment: `ISO-E1R2` (luna root + luna worker, E1 ticket)
- `CAP_USD` was unset; the driver-defined `2.86` cap was not changed

## HEADs

- main repo start HEAD: `8b22568038140dda95a50351ac8c90dd099f325e` (carried forward from the immediately preceding verified main-repo end state; no product-file changes were made in this round)
- main repo end HEAD: `8b22568038140dda95a50351ac8c90dd099f325e`
- worktree start HEAD: `45d9493e25f47c58911edc01757c6133caeaa39d`
- worktree end HEAD: `45d9493e25f47c58911edc01757c6133caeaa39d`

## Step 2: baseline verification, raw output

The exact worktree verification commands were run before the experiment. The diff command produced no output:

```text
$ git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment rev-parse HEAD
45d9493e25f47c58911edc01757c6133caeaa39d
$ git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment diff -- orchestrate.ts orchestrate.test.mjs
```

The worktree was clean, so no restore was needed.

## Run and spend

- exact run: `slot cpu -- bash .scratch/planner-only-cost-control/p20-scale/run.sh ISO-E1R2`
- `ISO-E1R2` exit: `0`
- `.scratch/planner-only-cost-control/p20-scale/runs/session-ISO-E1R2`: present

Raw `spend.py` output, in required command order:

```text
0.278854
0.737262
```

Both spend commands exited `0`.

## Step 4 sample-content verification, raw output

```text
$ grep -c isQuarantined <WT>/orchestrate.ts
1
$ git -C <WT> diff -- orchestrate.ts orchestrate.test.mjs | grep 隔离在会话内不解除
+\t\t\tlines.push("Ledger quarantine: 本会话拒绝写入该 taskId 的账本（隔离在会话内不解除）");
$ git -C <WT> diff -- orchestrate.ts orchestrate.test.mjs | grep writeErrorFor
$ git -C <WT> diff -- orchestrate.ts orchestrate.test.mjs | grep 本会话无法写入该 taskId 的账本
```

The last two grep commands intentionally had no matches (exit `1`), confirming the E2 residual-sample markers are absent.

Main-repo acceptance check:

```text
$ git diff -- index.ts orchestrate.ts orchestrate.test.mjs
[empty]
```

Worktree diff stat after the run:

```text
 orchestrate.test.mjs | 20 ++++++++++++++++++++
 orchestrate.ts       |  3 +++
 2 files changed, 23 insertions(+)
```

The inner run generated the E1 sample changes; the worktree was not checked out, restored, or otherwise modified after the run.

## Slot logs

- `.scratch/planner-only-cost-control/p20-scale/p20-r097-slot-audit.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r097-slot-status.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r097-baseline-before.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r097-iso-e1r2.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r097-spend.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r097-sample-content.log`

## Not done / assumptions

- No second group, prohibited experiment, product-file edit, commit, push, checkout, quarantine edit, or existing-session edit was performed.
- The main-repo start HEAD is carried forward from the prior verified round because this round's mandatory baseline commands concern the worktree; end HEAD and the required empty product diff were independently verified.
- Existing `session-*` directories, including `session-ABORT-ISO-E1R2`, were left untouched; only `session-ISO-E1R2` was created by this run.
