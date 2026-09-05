# Changelog

## 0.2.4 - 2026-09-05

- **RF-1**: Evidence attribution: committed delta and content-changed baseline. Accounts for worker commits (diff between baseGitRef and finalGitRef) and baseline content modifications (blob hashing via hash-object for dirty paths).
- **RF-2**: Async delegation results reach Orchestration. Added `notify.ts` parser for `subagent-notify` custom messages and unified background task result handling.
- **RF-3**: E2E contract test against pi-subagents 0.65. Updated child-tool-plan imports and declared version range in `package.json`.
- **RF-4**: Per-session force-on via `PI_PLANNER_ONLY=1` (or `true`/`on`) regardless of `planner-only.off` marker. Added source reporting (`env`, `marker`, `default`) to `/planner-only status`.
- **RF-5**: Runtime correctness and documentation fixes:
  - **E1**: Removed dead `workflow === "review"` special case in policy.
  - **E2**: `filterPlannerTools` only retains safe tools from active tools, avoiding re-enabling user-disabled safe tools.
  - **E3**: Added `--no-ext-diff --no-textconv` to `git_audit` diff-* operations.
  - **E4**: Enforced working directory boundary check in `runGitAudit` with `git_audit cwd must stay inside the working directory`.
  - **E5**: Documented `/planner-only task abandon|reset <taskId>` in README commands.
  - **E6**: Removed `diffStat` from `PLANNER_PROMPT` example `expectedEvidence`.
