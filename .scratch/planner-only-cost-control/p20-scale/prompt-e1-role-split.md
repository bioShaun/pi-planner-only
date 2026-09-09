You are running under the planner-only extension in this worktree. Do this one Task, then stop.

Working directory (do not cd elsewhere):
/home/tcuni-claw/pi/pi-planner-only-p19-experiment

Role-model policy stays ON. If you delegate, the worker model is the local qwen model already configured for this process. Do not unset PI_PLANNER_ONLY_ROLE_MODELS. Do not switch the CLI root model. Do not implement this as a solo luna edit if a worker is available — the point of this arm is the split.

## Task

LedgerSnapshotStore quarantines a corrupt taskId at session start (restoreFromLedger). The quarantine lives only in memory and is never lifted for the rest of the session, but product status never says so.

In orchestrate.ts renderTaskStatus: if this.snapshots?.isQuarantined(task.taskId) is truthy, append this exact line:

Ledger quarantine: 本会话拒绝写入该 taskId 的账本（隔离在会话内不解除）

Do not lift the quarantine in-session. Do not change the existing 余额不可信 wording. Do not add the E2 writeErrorFor line. Do not delete isQuarantined or quarantine. If snapshots is missing, do not add the line. Do not change Set behavior.

In orchestrate.test.mjs, after the existing L14–L24 block ends, add one new self-contained block with its own mkdtempSync(".planner-only-16b-l25-"): write a corrupt snapshot for T-20260908-965, run restoreFromLedger(), then repair the file mid-session with a fresh LedgerSnapshotStore, then assert renderTaskStatus matches /本会话拒绝写入该 taskId 的账本/ (L25: the file is really repaired; L25b: the disclosure is still shown). Do not change any existing assert in L14–L24 (or anywhere else). Do not delete or rewrite existing asserts.

Acceptance:
- git diff -- orchestrate.ts orchestrate.test.mjs | grep '^-.*assert' is empty.
- Existing /余额不可信/ asserts still match.
- Do not commit, do not git add, do not push.

## Then

If a planner-only Task exists, run:
/planner-only usage record --arm role-split
If the slash command is unavailable in this harness, say so in one line and stop. Do not start a second Task to compensate.

Then stop. Do not implement E2 or E3 edits. Do not run the full test suite unless you need it to decide the edit is done.
