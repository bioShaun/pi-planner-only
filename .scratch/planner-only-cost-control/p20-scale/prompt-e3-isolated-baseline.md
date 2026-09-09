You are running under the planner-only extension in this worktree. Do this one Task, then stop.

Working directory (do not cd elsewhere):
/home/tcuni-claw/pi/pi-planner-only-p19-experiment

Role-model policy stays ON. Your worker, if you delegate, is the same expensive model as root. Do not unset PI_PLANNER_ONLY_ROLE_MODELS. Do not switch models.

## Task

In orchestrate.ts, beginDelegationInner has two refusal paths that do not start a child:

1. Untrusted ledger (untrustedBalances): deletes input.usageBudget and input.__floorLimits, then returns the untrusted block.
2. Cumulative budget exhausted (reservation.refused): returns cumulativeBudgetRefusal without deleting those fields.

Make path 2 delete the same two fields on the same input object before returning, matching path 1. Do not change the refusal message text. Do not delete usageBudget on a successful reserve. Do not change Set behavior or unrelated functions.

In orchestrate.test.mjs, add one test: a worker beginDelegation whose input includes usageBudget, refused with /cumulative budget exhausted/, after which input.usageBudget is absent (undefined). Follow the existing budgetTaskFixture / boundedBudgetUsage style near the Ticket 14A V5-V11 tests. Do not delete or rewrite existing asserts.

Acceptance:
- git diff -- orchestrate.ts orchestrate.test.mjs | grep '^-.*assert' is empty.
- The exhausted refusal still matches /cumulative budget exhausted/.
- Do not commit, do not git add, do not push.

## Then

If a planner-only Task exists, run:
/planner-only usage record --arm isolated-baseline
If the slash command is unavailable in this harness, say so in one line and stop. Do not start a second Task to compensate.

Then stop. Do not implement E1/E2. Do not run the full test suite unless you need it to decide the edit is done.
