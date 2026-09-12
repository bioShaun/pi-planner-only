# p23 TaskSpec ≠ execution controls — execution report

- round_id: `p23-taskspec-exec-split`
- ticket: `43-taskspec-rejects-execution-controls`
- branch: `cloud-backlog-2-taskspec-exec-2026-09-12`
- worktree: `/workspace/pi-planner-only-taskspec-exec` (ONLY; did not touch `/workspace/pi-planner-only`)
- start HEAD: `5b76f0df8d93775e3b09794f341bd9ab36f52369`
- PR base: `main`
- NEVER pushed: `main`

## Change summary

Enforce **TaskSpec ≠ runtime execution controls** (ticket 43):

1. **`validateTaskSpec` (`task.ts`)** — errors when TaskSpec carries `model`, `thinking`, `timeoutMs`, `toolBudget`, or `usageBudget`. Business `budget` / `cumulativeBudget` remain allowed. Exported `TASKSPEC_FORBIDDEN_EXECUTION_CONTROLS`. Stopped copying model/thinking onto extracted specs.
2. **Resolution chain (`role-models.ts`)** — dropped `task-spec` from effective `ModelSelectionSource`. Priority is now role-policy > explicit input > host-default. Nested TaskSpec model/thinking, if passed into preflight, are recorded only on `ignored` (audit) and never become effective or write back.
3. **`orchestrate.ts`** — still forwards nested TaskSpec model/thinking for ignore-audit only; emits a warning when ignored; never treats them as an effective write-back source.
4. **Issue file** — `.scratch/planner-only-cost-control/issues/43-taskspec-rejects-execution-controls.md`.
5. **Tests** — validateTaskSpec rejects forbidden keys; preflight/rs03 assert TaskSpec is ignored; role-policy / explicit paths still pass; orchestrate C23 no longer embeds model/thinking on TaskSpec.

Out of scope left alone: per-child `timeoutMs`, skill/artifacts as execution controls.

## Validation gates

1. `npm run typecheck` / `tsc --noEmit`: exit 0. Log: `typecheck.log`.
2. `npm test`: exit 0; includes `planner-only architecture: PASS` and `planner-only naming: PASS`. Log: `npm-test.log`.
3. `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e`: exit 1 — `pi-subagents is not installed`. Marked **「e2e 待本机终验」**. Log: `e2e.log`.
4. `git diff --check`: exit 0. Log: `diff-check.log`.
5. Related assert updates only (former `source === "task-spec"` expectations rewritten to ignored/host-default); no unrelated assert deletions.

## HEAD / PR

- HEAD: _(filled after commit)_
- PR: _(filled after create)_

## Not done / assumptions

- e2e contract gate needs a machine with `pi-subagents` installed.
- package-lock.json version aligned to package.json `0.4.1` (install drift fix).
