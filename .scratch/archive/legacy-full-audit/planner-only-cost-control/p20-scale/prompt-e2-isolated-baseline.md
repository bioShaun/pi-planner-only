You are running under the planner-only extension in this worktree. Do this one Task, then stop.

Working directory (do not cd elsewhere):
/home/tcuni-claw/pi/pi-planner-only-p19-experiment

Role-model policy stays ON. Your worker, if you delegate, is the same expensive model as root. Do not unset PI_PLANNER_ONLY_ROLE_MODELS. Do not switch models.

## Task

LedgerSnapshotStore.writeErrorFor() is only read by tests. Product status never shows a failed ledger write.

In orchestrate.ts renderTaskStatus: if this.snapshots?.writeErrorFor(task.taskId) is truthy, append this exact line:

Ledger write: 本会话无法写入该 taskId 的账本（writeErrorFor）

Do not change the existing 余额不可信 wording. Do not delete writeErrorFor or lastWriteError. If snapshots is missing, do not add the line. Do not implement in-session isolation lifting (E1). Do not change Set behavior.

In orchestrate.test.mjs, after the existing L15 assertion (placeholder persist leaves the corrupt bytes), add one assertion: renderTaskStatus again and match /本会话无法写入该 taskId 的账本/. Do not change L10 or L14b (those run before persist, so writeErrorFor is still empty). Do not delete or rewrite existing asserts.

Acceptance:
- git diff -- orchestrate.ts orchestrate.test.mjs | grep '^-.*assert' is empty.
- Existing /余额不可信/ asserts still match.
- Do not commit, do not git add, do not push.

## Then

If a planner-only Task exists, run:
/planner-only usage record --arm isolated-baseline
If the slash command is unavailable in this harness, say so in one line and stop. Do not start a second Task to compensate.

Then stop. Do not implement E1 or another E3 edit. Do not run the full test suite unless you need it to decide the edit is done.
