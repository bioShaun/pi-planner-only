# Changelog

## Unreleased

- Bundled pricing: add `gpt-6-astra` at $10 / $1 / $12.50 / $50 per million tokens (input / cacheRead / cacheWrite / output). Existing `~/.pi/agent/planner-only/pricing.json` keys are not overwritten; a missing key is filled on next load.
- Review wrap-up: undeclared untracked files with no allow-list are attributed (empty declaration cannot PASS); declaration-only findings use the report-only counter; missing `A_run`/`C_report` fail closed even in-session; unbound Explorer recovery returns saved output without creating a Task.
- Idle gather Policy with Explorer lifecycle closure: the gather phase derives from `activeForCwd` — with a live Task the ordinary allowlist applies, while Idle Root may only Delegate, ask a question, record a Verdict, or recover one registered pending run through an exact-id `bg_wait` (≤ 60 s; prefixes, all-runs, unknown fields, and other workspaces refused). Explorer ownership is fixed at launch (standalone / auxiliary / unbound): standalone Explorer Tasks close like Worker Tasks (validated WorkerReport + bound Evidence → reviewing → `planner_verdict`), auxiliary runs never touch the assisted Task, and a malformed terminal standalone report blocks with a repair instruction. PLANNER_PROMPT states the Idle contract within the existing 1800-byte bound.
- Pasteable TaskSpec repair JSON: Policy parent-tool refusals and Orchestration invalid-TaskSpec refusals share one example renderer (owned next to TaskSpec validation). The fenced JSON always passes TaskSpec validation, fills from the refused tool input (inspect path → constraints + Explorer; shell command → objective + Explorer; write/edit → Worker), collapses an invalid `validation` to `{ required: false }`, and preserves submitted valid fields. The documented `taskId` sentinel `T-pending` is always replaced by a generated canonical id and is never stored as an alias, so pasting the same example JSON twice starts a new Task. Composite-workflow refusals are unchanged and gain no JSON.
- Retry classification and bounded stop-loss: every Review decision carries a structured failure class (`implementation` / `environment` / `contract` / `evidence`) and reason code. Environment failures (unreadable Git/workspace) and contract failures (malformed reports) block without consuming code-correction rounds; recovery revalidations are bounded by a persisted per-Task counter (same evidence state retried at most once, at most three automatic attempts per Task) keyed by evidence state, not reason text — a moved workspace grants a new bounded attempt, and a rewritten message or a restart resets nothing.
- Per-execution Evidence (truth/scope vs freshness): every actual child execution gets Root-owned `A_run` (pre-execution) and `C_report` (result-receive) samples, even when the report cannot be parsed. Truth/scope is the pure `diff(A_run, C_report)` against the report declaration; freshness is the separate `diff(C_report, C_now)` re-sampled at review and acceptance. Unrelated history that predates `A_run` can no longer be attributed to an execution (baseline-lag fix).
- Evidence findings (under-report, out-of-scope, over-declaration, missing, drift) persist across correction rounds and block PASS until a review confirms an evidence-proven repair; report-only corrections inherit the original execution window, and drift during a correction is explicit drift handling.
- Reviewer packets carry per-round attribution (`rounds`), the cumulative attributed set, and unresolved findings; a packet missing part of the execution chain is truncated and a PASS over it is ineligible. Ledger records written before per-execution evidence existed are marked unverifiable and cannot complete automatically.
- Subdirectory `cwd` and quoted non-ASCII Git paths are normalized correctly (status paths against the probed cwd, committed deltas against the repository top-level).
- Stop stripping Root `bash`/`edit`/`write` via `setActiveTools`. The host applies that change on the next turn, so a launch-window restore could not give children a mutation ceiling in the same turn. Policy still blocks Root; children inherit the parent's active tools.

## 0.4.1 - 2026-09-10

- Session root budget is off by default. `/planner-only budget on` / `off` toggles it (persisted as `session-root-budget.on`); `PI_PLANNER_ONLY_SESSION_ROOT_BUDGET=1` or `=0` overrides the marker. Per-delegation worker floors are unchanged.

## 0.4.0 - 2026-09-10

- Task-level cumulative budget: ledger, atomic pre-launch reservation, refuse new paid work when exhausted, and restore the same budget after reload.
- Session-level root spend gate: warn at 3× a single-task floor, refuse new paid delegations at 5×; reviewer stays exempt so Tasks can still close.
- Default floors on paid delegations; failed launches still settle; `/planner-only status` discloses budget stop, isolation, and write errors.
- Machine-generated report-only correction rounds embed the original TaskSpec and an explicit `reportOnly` flag instead of sniffing the prompt.
- `blocked` Tasks can be abandoned to `failed`; late child receipts are parked and do not reopen the Task; Root `planner_verdict` remains the escape hatch.
- Evidence sampling covers declared additional worktree roots; report-only rounds do not treat over-reported declarations as unexplained.
- The host still does not enforce `usageBudget`; hard caps are plugin-side only.
- Bundled `pricing.defaults.json` seeds `~/.pi/agent/planner-only/pricing.json` on first load (bare model keys; `provider/model` only as an override). Existing keys are never overwritten.

## 0.3.3 - 2026-09-07

- Worker tasks now receive a compact WorkerReport JSON shape up front and are told not to run `/code-review`; review stays on the plugin Reviewer.
- Validators (`oracle`) default to a bounded HEAD/status/named-test check when worker validation already exited 0. Set `PI_PLANNER_ONLY_ORACLE=full` to re-run the full suite.
- Reviewer packets now forbid `git log`, `npm test`, and repository-wide re-probes; Root is told one ticket per TaskSpec.
- Completed `usage.jsonl` snapshots harvest oracle/reviewer `_meta.json` even when sync `details.results` is empty, so child cost is not dropped at PASS.
- `evidence` arrays in WorkerReports are repaired to `{ taskId }` instead of forcing a report-only round.

## 0.3.2 - 2026-09-05

- **I-1**: Compressed extension-controlled Root input. Reduced `PLANNER_PROMPT` to 1,469 UTF-8 bytes while retaining every planner/reviewer contract, and stopped appending the full fresh-reviewer template to accepted worker results. Fresh reviewer delegations still receive the complete generated packet when launched.
- **I-2**: Reactive JSON reminder. A first prose-only WorkerReport strike now adds one compact JSON shape to the existing report-only correction; empty, parseable-invalid, identity-rejected, exhausted, validator, and reviewer paths remain unchanged.
- Folded in the 0.3.1 re-measurement follow-ups: unbound explorers no longer create placeholder Tasks; worker-guessed Git hashes are dropped and delegation run ids are stamped by Root; task status reports validator counts; prose `evidence` is preserved in notes and repaired; validator normalisation repairs are echoed to Root.

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
