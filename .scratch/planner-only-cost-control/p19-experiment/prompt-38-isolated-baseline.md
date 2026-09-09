You are running under the planner-only extension in this worktree. Do this one Task, then stop.

Working directory (do not cd elsewhere):
/home/tcuni-claw/pi/pi-planner-only-p19-experiment

Role-model policy stays ON. Your worker, if you delegate, is the same expensive model as root. Do not unset PI_PLANNER_ONLY_ROLE_MODELS. Do not switch models.

## Task

Objective: In orchestrate.ts, put this exact English comment at both
processedRunIds and confirmedNotLaunchedIds. Same text at both sites. Do not
invent a FIFO, a numeric cap, prune, or max. Do not change Set construction
or any add/has/delete call.

```
// Intentionally unbounded session-scoped Sets. A FIFO cap would evict IDs and
// allow a repeated completion/not-launched event to be settled twice.
// Boundedness and idempotency are in tension here; until that is resolved
// in product, no prune and no max.
```

Replace any existing JSDoc on those two fields so both declarations carry this
same block and nothing else above the field. No other product files.

Acceptance:
- Both fields have that comment verbatim (four lines, same wording).
- git diff -- orchestrate.ts shows no change to Set behavior; only comments.
- Do not commit, do not git add, do not push.

## Then

If a planner-only Task exists, run:
/planner-only usage record --arm isolated-baseline
If the slash command is unavailable in this harness, say so in one line and stop. Do not start a second Task to compensate.

Then stop. Do not implement ticket 39. Do not run tests unless you need them to decide the edit is done.
