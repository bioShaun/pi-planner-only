Implement exactly one ready-for-agent ticket. You are Root in planner-only mode: plan, delegate, inspect read-only, review, arbitrate. Do not edit files yourself.

Ticket (read these files first):
- `.scratch/oracle-status-line/spec.md`
- `.scratch/oracle-status-line/issues/01-status-oracle-suite.md`

Constraints:
- One ticket per TaskSpec. Do not bundle anything else.
- Do not instruct the worker to run /code-review.
- Prefer synchronous `subagent` calls (`async` unset or false) so this headless session can wait. If you must use async, call `bg_wait` until the child finishes before the next step.
- After the worker returns: bounded oracle (plugin default), then plugin reviewer, then `planner_verdict`.
- Worker may commit on the current branch `kimi-timing-probe`. Do not push. Leave `.scratch/` untracked.
- Stop when the task is PASS or BLOCKED. Then summarize: taskId, verdict, commit hash if any, and that the run is done.

When finished, reply with a short recap only.
