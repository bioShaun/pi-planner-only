# Changelog

## 0.9.0-lite.0 - unreleased

Lite rewrite (`docs/pi-planner-only-subtraction-plan.md`). The 0.8.0 code is at tag `legacy-full-audit`.

- Root tools are now `delegate({role, task, cwd?})`, `git_audit`, and `git_commit`. `planner_delegate`, `planner_redelegate`, `planner_abort`, `planner_tasks`, and `planner_verdict` are removed.
- Children return plain text. TaskSpec/WorkerReport, the Task ledger, evidence snapshots, review rounds, closeout, request control, the refusal breaker, role-model routing, and the pricing table are removed (about 23k source lines down to about 700).
- Roles map to builtin pi-subagents agents (`worker`, `scout`, `oracle`, `reviewer`); models come from `subagents.agentOverrides`. The request no longer sends fields that pi-subagents 0.70 rejects.
- Every delegation returns the host status, actual model, usage, and a Git summary (new commits, diff stat, untracked files).
- Strict mode (blocking Root's `edit`/`write`/`bash`) is now opt-in with `PI_PLANNER_ONLY_STRICT=1`; the default prompt tells Root to do small tasks itself.
- Git calls now also disable fsmonitor (`-c core.fsmonitor=false`) and diffs disable textconv.
- Supported pi-subagents range: `>=0.70 <1`.
- Child token cap default raised from 200000 to 1500000 (`PI_PLANNER_ONLY_MAX_TOKENS`); the count is the child's cumulative non-cached input+output, and 200k cancelled real workers after about 90 seconds.
- While enabled, pi-subagents' `subagents_enable` and `subagent` are removed from Root's tools and system prompt and blocked if called, so delegation goes through `delegate`.
- om09 field fixes (`.scratch/om09-field-fixes/spec.md`):
  - Git 1.8 works: `--no-optional-locks` is sent only when `git --version` reports 2.15 or later (probed once per session). `status` uses `--porcelain` instead of `--porcelain=v1`.
  - `git_audit` and `git_commit` take an optional `cwd`. Outside a work tree they return `<cwd> is not inside a git work tree; pass cwd=<repo>`.
  - The delegation summary now tells "not a work tree" apart from "no commits yet". The prompt tells Root to pass `cwd` when the target repository is not the session cwd.
  - A child that does not complete now reports its runId and last activity (tool and arguments from the last progress update). When the output artifact exists at the default `session` location, the result includes its text and the transcript path. Otherwise it shows the child's recent output and says the artifact was not found.
  - The task text and the Root prompt state the child's time limit (`PI_PLANNER_ONLY_TIMEOUT_MS`, in whole minutes).
- om09 run4 follow-ups (`.scratch/om09-run4/spec.md`):
  - A child that does not complete also returns a transcript tail: slow tools and slow model turns (60s or more), the last 12 tool calls with time offsets, durations, commands and result excerpts, and the last assistant text. Root can reuse checks the child already ran.
  - The Git summary leaves out paths that were uncommitted before the delegation and that the child did not change, and lists them on a separate line. Paths the child changed again get a note about the earlier edits. Works with git 1.8.
  - The task text tells the child to report as soon as the required checks pass, to never search the whole filesystem, and to wrap slow commands in `timeout`.
  - The Root prompt tells Root to reuse a timed-out child's results, and to check a child's change against its own task before saying who made it.
  - The status line uses k/M/B units, shows Root's share of both tokens and cost, and counts children that did not complete: `root 4.17M $3.854 · children(3, 1 failed) 2.82M $0.103 · root share 60% tok · 97% $`.
  - `git_commit` accepts messages up to 2000 characters (was 500).
- Large-task measurement (`docs/lite-measurement-2026-09-24.md`): 12/12 runs pass; lite costs 0.48 of direct at opus-priced Root, 0.46 at astra, 0.52 at gpt-6-sol, with luna children.

## 0.8.0 - 2026-09-18

- **Run identity is Root-stamped (ADR-0004)**: child-facing schema drops `evidence.workerRunId`; Root stamps the launcher terminal's `response.runId` (defaulting to `executionId`) at the admission boundary; child-supplied passthrough values are stripped and disclosed in warnings; incident sentinel values (`planner-scout`, `T-20260918-004`, `not-provided-in-launch-packet`) no longer cause rejection.
- **Launcher capability gate removed**: `LAUNCHER_CAPABILITY_UNSUPPORTED`, `childRunIdentity`, and `pi-subagents:delegation-capability-probe:v1` completely removed; fixes 0.7.x regression that prevented launching worker, explorer, or validator subagents on installed `pi-subagents@0.68.0`.
- **Restricted reader opts out of the pi-subagents completion guard**: `planner-scout` is registered with `completionGuard: false`. The guard is a text heuristic over Root-authored spec prose and misread a read-only constraint ("do not create, modify, or delete any files") as an implementation task, refusing three explorer launches (2026-09-18, T-20260918-001..003) that were then reported as `provider_failure`; the declared tool allowlist is the capability proof.
- **Launch-time rejections classified and surfaced**: a `failed` terminal with zero turns and zero wall time is recorded as `launch_failure` (not `provider_failure`), and the host error text is rendered in the `planner_delegate`/`planner_redelegate` result, so Root no longer misdiagnoses a contract refusal as a provider outage.

## 0.7.0 - 2026-09-17

- **Abort gets its own tool surface (ADR-0003, wrc-incident-followups/02)**: `planner_verdict` no longer has a `recovery` key — pass, request_changes, and blocked are plain verdicts. Abandoning an abnormal execution on a Task flagged `recovery.required` goes through the new `planner_abort` (`taskId`, `executionId`, `reason`, `worktreeDecision`, optional `evidenceRefs`/`summary`), which records the blocked verdict and consumes the requirement atomically. A passthrough `recovery` on `planner_verdict` is stripped and disclosed in `warnings`, never refused. `planner_abort` refusals are recorded as `recovery-invalid` verdict refusals (closing the incident's audit blind spot), echo the received `executionId` vs the child `runId`, and stay inside the repeated-refusal breaker. The discriminated-union alternative was probed on the incident provider and rejected: the union schema is accepted but does not constrain generation.
- **Wall-timer deadline recheck (wrc-incident-followups/01)**: `maxWallMs` elapsed is read from a monotonic clock (`performance.now`, injectable via `deps.wallClock` for tests) instead of `Date.now`, and the deadline callback re-checks elapsed before breaching — a timer that fires early re-arms for the remainder, bounded by the limit, so `anomaly.observed >= anomaly.limit` always holds and a system-clock rollback can no longer produce a below-limit "exceeded" report.
- **Incident regression fixture (wrc-incident-followups/04)**: the verdict/recovery boundary sequence from the 2026-09-17 incident is a permanent test in `index.test.mjs` — runaway → consumed recovery requirement → stray recovery on verdict (stripped + warning) and on redelegate → `planner_abort` refusal recording, breaker repeat, and the valid abort path.

## 0.6.0 - 2026-09-16

- **Delegation contract split (ADR-0002)**: `planner_delegate` only mints a new Task — its schema no longer carries `taskId`, `recovery`, or the `reviewer` role, so an invented id can never reach the binding path. Re-entering an existing Task (a correction round after `request_changes`, a reviewer invocation, a recovery re-execution) goes through the new `planner_redelegate` tool, which requires the canonical `taskId` verbatim from a prior result's `details.taskId`. A `taskId`/`recovery` passed through a non-validating host on `planner_delegate` is ignored and disclosed in `warnings`, never refused; `planner_redelegate` without a `taskId` refuses `TASK_REQUIRED` rather than silently minting. Refusal codes and the ticket-13/14/15 guidance are unchanged — the refusal text now names the tool actually called.
- **Repeated-refusal breaker (ticket 16)**: a session-scoped `RefusalBreaker` counts byte-identical tool calls refused with the same code on `planner_delegate`, `planner_redelegate`, `planner_verdict`, and `git_commit`. The second refusal appends a repeat notice naming the previous toolCallId, the third prepends STOP and notifies the UI, and the fourth identical call is blocked in the `tool_call` hook before it reaches execute. Aborts, structured terminations, and store errors are never counted; state resets on `session_start`.
- **Executable-shape validation commands (ticket 19)**: every non-blank `validation.commands` entry must be shaped like a shell command — a single line whose first token (after `VAR=value` assignments) is a program name or path. Instruction prose is refused with `TASKSPEC_VALIDATION_COMMAND_NOT_EXECUTABLE` at `createTaskSpec`, `validateTaskSpec`, and the repair renderer (needs-input, never silently dropped) — the worker runs these entries and the verifier compares them verbatim, so a prose "command" could previously be echoed back as passed without ever executing.
- **Read-only Task lookup (ticket 18)**: new `planner_tasks` tool lists the workspace's live Tasks — non-final states plus blocked Tasks flagged `recovery.required` — merging the session store with ledger snapshots the restore cap left out (`source: "memory" | "ledger"`, `recoveryRequired` flags the recovery-gated ones). Listing never mints, binds, restores, or launches. `TASK_UNKNOWN` and `TASK_FOREIGN_WORKSPACE` guidance now points at `planner_tasks` instead of asking the caller to retry a guessed id.

## 0.5.0 - 2026-09-16

- Replaced the legacy prompt-parsed `subagent` / `bg_wait` / notify path with the typed `planner_delegate` contract: Root sends a schema-checked TaskSpec, the launcher validates WorkerReport or ReviewResult, and Policy keeps Root on delegation, verdict, and Git-read tools.
- Added execution termination correctness and the Worker Runaway Controller: identity-bound CANCEL, terminal-plus-worktree quiescence confirmation, persistent writer holds across restart, structured abnormal outcomes, explicit token/wall envelopes, and one-shot RecoveryDecision-gated retries.
- Removed the unreachable asynchronous receipt/recovery stack and its fixtures after host acceptance; retained Task identity, Evidence attribution, review, Usage, ledger restore, and Git commit semantics on the new seam.
- ExtractedReport is now a discriminated union (`ok: true` | `ok: false`) so WorkerReport parse failures cannot pretend success fields exist (same honesty bar as host invalid_request / SubagentDelegationInvalidResponse). Call sites narrow on `extracted.ok`; product outcomes unchanged.

- Batch A identity and repair closure: ledger-backed Task ids use cross-process atomic claims and never reuse restored, terminal, over-cap, or unreadable ids; report-only corrections with ambiguous, unknown, or terminal targets are refused before launch instead of creating placeholders; TaskSpec repair preserves the trusted Worker role and never drops validation intent. See [batch A acceptance](docs/runtime-batch-a-2026-09-11-acceptance.md).
- Model preflight writeback fix: host-default `provider/model/thinking` is retained for attribution but is not written into the downstream subagent input, so host settings fallbacks remain effective; explicit model selections remain launch parameters.
- Review wrap-up: undeclared untracked files with no allow-list are attributed (empty declaration cannot PASS); declaration-only findings use the report-only counter; missing `A_run`/`C_report` fail closed even in-session; unbound Explorer recovery returns saved output without creating a Task.
- Idle gather Policy with Explorer lifecycle closure: the gather phase derives from `activeForCwd` — with a live Task the ordinary allowlist applies, while Idle Root may only Delegate, ask a question, record a Verdict, or recover one registered pending run through an exact-id `bg_wait` (≤ 60 s; prefixes, all-runs, unknown fields, and other workspaces refused). Explorer ownership is fixed at launch (standalone / auxiliary / unbound): standalone Explorer Tasks close like Worker Tasks (validated WorkerReport + bound Evidence → reviewing → `planner_verdict`), auxiliary runs never touch the assisted Task, and a malformed terminal standalone report blocks with a repair instruction. PLANNER_PROMPT states the Idle contract within the existing 1800-byte bound.
- Pasteable TaskSpec repair JSON: Policy parent-tool refusals and Orchestration invalid-TaskSpec refusals share one repair renderer (owned next to TaskSpec validation). Trusted role sources are preserved; losslessly convertible validation command lists become explicit mandatory validation, while ambiguous validation shapes return `needs-input` without a template or a silent `required: false` downgrade. The documented `taskId` sentinel `T-pending` is replaced by a generated canonical id and is never stored as an alias.
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
