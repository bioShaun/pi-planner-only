# Changelog

## 0.3.1 - 2026-09-05

- **L-1**: Lenient WorkerReport normalisation. Automatically repairs common schema deviations (e.g. `version: "1"`, `changedFiles` as object arrays, alias keys like `unresolvedItems`, free-text validation types, missing defaults) before validation and echoes applied fixes in a `Report normalised:` line.
- **L-2**: Review-round base evidence sampling. Scopes base evidence to each review round so that report-only corrections, re-bindings, and re-delegations keep the baseline without false `over-reported / unreliable declaration` warnings, and echoes `base <sha7>` in decision evidence.
- **L-3**: Validator delegations as task invocations. Binds `validator` (`oracle`) delegations directly to the task under review instead of creating new tasks; records output in `validatorReports`, attributes usage to the reviewed task, and allows Root verdicts to land on the implementation task.
- **L-4**: Root verdict lifecycle and prompt cleanup. Treats `completed` as the sole terminal state so that `blocked` or `failed` tasks with recorded reports can pass directly via `planner_verdict`; removes slash-command references from Root verdict refusal messages and planner prompts.
- **L-5**: Store-issued Task IDs and alias preservation. Automatically replaces missing, malformed, or non-today Task IDs in TaskSpecs with generated canonical IDs while keeping the original ID as an alias, notifying Root in delegation results and resolving aliases in subsequent delegations and reports.

## 0.3.0 - 2026-09-05

- **V-1**: Root verdict tool (`planner_verdict`). Enables Root to record pass, request_changes, or blocked directly with evidence re-check at acceptance boundary, lifecycle refusal guards, and review findings.
- **V-2**: Guidance and prompt alignment for root verdicts. Updated review guidance and planner prompt instructions to use `planner_verdict`, bounded planner prompt size, and preserved `/planner-only review` as operator override with bypass warnings.
- **U-1**: Pure usage accounting ledger (`usage.ts`). Implemented `UsageLedger`, phase bucketing (`planning`, `executing`, `reviewing`), cost resolution across provider/model pricing rates, and rendering blocks (`renderUsage`, `renderUsageLine`).
- **U-2**: Root usage capture. Captured Root assistant turns on `message_end`, phase attribution based on task state, review leak tracking for read-only inspection tools during review, and injected text accounting.
- **U-3**: Child usage capture. Captured child usage from sync `subagent` result details, background `bg_wait` completion records, and async `<runId>_<agent>_meta.json` artifacts with re-resolution for pending runs.
- **U-4**: Usage persistence. Appended session custom entries (`planner-only-usage`) for resume/reload rehydration, and recorded terminal task usage records to `usage.jsonl`.
- **U-5**: Usage reporting and budget controls. Added `/planner-only usage [taskId | session | reload]`, decision block `usage:` line, soft budget warnings on high root share with review leakage, and `TaskSpec.budget` passthrough to pi-subagents `usageBudget`.
- **RF-6**: Delegation launch failure handling. Added `isError` passthrough for subagent results; failed launches transition the task to `failed` and clear pending delegations instead of hanging.
- **RF-7**: Delegation target resolution without TaskSpec. Bound prompt-named tasks and active tasks in review/correction states directly to existing tasks instead of creating spurious new tasks.

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
