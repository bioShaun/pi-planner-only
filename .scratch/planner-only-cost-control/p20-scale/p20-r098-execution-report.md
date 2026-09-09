# p20-r098-split-e1 execution report

- round_id: `p20-r098-split-e1`
- experiment: `SPLIT-E1` (luna root + qwen-local worker, E1 ticket)
- `CAP_USD` was unset; the driver-defined `2.86` cap was not changed

## HEADs

- main repo start HEAD: `8b22568038140dda95a50351ac8c90dd099f325e` (prior verified main-repo end state; no main product files were changed in this round)
- main repo end HEAD: `8b22568038140dda95a50351ac8c90dd099f325e`
- worktree start HEAD: `45d9493e25f47c58911edc01757c6133caeaa39d`
- worktree end HEAD: `45d9493e25f47c58911edc01757c6133caeaa39d`

## Step 2: baseline verification, raw output

Before restore, the required commands produced:

```text
$ git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment rev-parse HEAD
45d9493e25f47c58911edc01757c6133caeaa39d
$ git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment diff -- orchestrate.ts orchestrate.test.mjs
orchestrate.test.mjs | 20 ++++++++++++++++++++
 orchestrate.ts       |  3 +++
 2 files changed, 23 insertions(+)

Changes:

orchestrate.test.mjs
  @@ -5886,6 +5886,26 @@ function spentTaskRecord(taskId, costUsd = 0.04, limit = 0.05) {
  +{ ... ISO-E1R2 sample test block ... }
  +20 -0

orchestrate.ts
  @@ -1302,6 +1302,9 @@ export class PlannerOrchestrator {
  +\t\t\tlines.push("Ledger quarantine: 本会话拒绝写入该 taskId 的账本（隔离在会话内不解除）");
  +3 -0
```

Because the diff was non-empty, only the permitted restore was performed. Re-verification after restore produced:

```text
$ git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment rev-parse HEAD
45d9493e25f47c58911edc01757c6133caeaa39d
$ git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment diff -- orchestrate.ts orchestrate.test.mjs
```

The second diff command produced no output; the worktree was clean before the run.

## Run and spend

- exact run: `slot cpu -- bash .scratch/planner-only-cost-control/p20-scale/run.sh SPLIT-E1`
- `SPLIT-E1` exit: `0`
- `.scratch/planner-only-cost-control/p20-scale/runs/session-SPLIT-E1`: present

Raw `spend.py` output, in required command order:

```text
0.009859
0.747121
```

Both spend commands exited `0`.

## Step 4: sample-content verification, raw output

```text
$ git -C <WT> diff -- orchestrate.ts orchestrate.test.mjs | grep 隔离在会话内不解除
+\t\t\tlines.push("Ledger quarantine: 本会话拒绝写入该 taskId 的账本（隔离在会话内不解除）");
$ grep -c isQuarantined <WT>/orchestrate.ts
1
$ git -C <WT> diff -- orchestrate.ts orchestrate.test.mjs | grep writeErrorFor
$ git -C <WT> diff -- orchestrate.ts orchestrate.test.mjs | grep 本会话无法写入该 taskId 的账本
```

The final two grep commands intentionally produced no output, confirming the E2 residual-sample markers are absent.

Main-repo acceptance check:

```text
$ git diff -- index.ts orchestrate.ts orchestrate.test.mjs
[empty]
```

Worktree diff stat after the run:

```text
 orchestrate.test.mjs | 22 ++++++++++++++++++++++
 orchestrate.ts       |  3 +++
 2 files changed, 25 insertions(+)
```

## Logs

- `.scratch/planner-only-cost-control/p20-scale/p20-r098-baseline-before.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r098-baseline-after.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r098-slot-audit.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r098-slot-status.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r098-split-e1.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r098-spend.log`
- `.scratch/planner-only-cost-control/p20-scale/p20-r098-sample-content.log`

## Not done / assumptions

- No second group, prohibited experiment, main product-file edit, commit, push, checkout, quarantine edit, or existing-session edit was performed.
- The main-repo start HEAD is carried forward from the preceding verified round; end HEAD and the required empty product diff were independently verified.
- Existing session directories were left untouched; only `session-SPLIT-E1` was created by this run.
- The worktree's final diff is the inner `pi` SPLIT-E1 sample; its HEAD remains the required baseline and it was not restored after the run.
