# 01: Print oracle suite on `/planner-only status`

**What to build:** `/planner-only status` includes a line `Oracle suite: bounded` or `Oracle suite: full`, using `oracleSuiteMode()` from `roles.ts` (the same helper that wraps Validator prompts). Default env → `bounded`. `PI_PLANNER_ONLY_ORACLE=full` → `full`.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] `index.ts` status action prints `Oracle suite: ${oracleSuiteMode()}`.
- [ ] Existing `/planner-only status` tests still pass; add coverage that the line is present for default (bounded) and that `PI_PLANNER_ONLY_ORACLE=full` prints `full` (extend `index.test.mjs` near the current status assertions).
- [ ] Do not change README unless a one-line mention is required for the status command list to stay accurate. Prefer code + tests only.
- [ ] Commit on the current branch. Do not push. Leave `.scratch/` untracked.
- [ ] Do not run `/code-review`. Return a WorkerReport JSON object only.

## Comments

Timing probe for planner-only 0.3.3 on kimi-coding. One ticket, one Worker.
