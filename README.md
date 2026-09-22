# pi-planner-only

[中文](README.zh-CN.md) · English

A [Pi](https://pi.dev) extension that keeps the **root session** a planner and
reviewer. All file edits, shell, and tests go to subagents.

While the guard is on, Root must not edit, write, or run a general shell.
`tool_call` policy is the gate. The parent keeps `bash`/`edit`/`write` in its
active tool set so pi-subagents can give those tools to children — the host
applies `setActiveTools` only on the next turn, so stripping the schema
starves oracle/worker/delegate launches in the same turn.
Foreground children do not load ambient extensions. Background children may;
this extension no-ops when `PI_SUBAGENT_CHILD=1`.

v0.2 adds a thin orchestration layer on top of that guard: structured
`TaskSpec` / `WorkerReport`, a bounded review loop, read-only `git_audit`,
evidence freshness, and isolated fresh reviewers. The v0.2.x hardening pass
tightens the lifecycle seams: task-identity checks on both child contracts, a
Root-side evidence re-check at every PASS boundary, reviewer invocations that
no longer mutate a Task, and an optional strict-delegation mode.

## Install

```bash
pi install https://github.com/bioShaun/pi-planner-only    # user-level
# or
pi install https://github.com/bioShaun/pi-planner-only -l # project-level
```

Then restart Pi or run `/reload`.

SSH works too: `pi install git:git@github.com:bioShaun/pi-planner-only`.

```bash
pi update https://github.com/bioShaun/pi-planner-only
pi remove https://github.com/bioShaun/pi-planner-only
```

Do **not** also copy this repo into `~/.pi/agent/extensions/` — Pi would load
the extension twice.

Local checkout:

```bash
pi install /path/to/pi-planner-only
# or try the package once without installing
pi -e .
```

`typebox` and `@earendil-works/pi-coding-agent` are peer dependencies: Pi
already bundles them. Do not add them to `dependencies`.

Supported host range: `@earendil-works/pi-coding-agent` `>=0.84 <1` and
`pi-subagents` `>=0.65 <0.70` (declared in `package.json`). Releases must run
`npm run test:release` (typecheck plus the unit suite).

## Commands

- `/planner-only status`
- `/planner-only on`
- `/planner-only off`
- `/planner-only task [taskId]` — lifecycle state
- `/planner-only task abandon|reset <taskId>` — abandon active or specified task
- `/planner-only review [taskId] [root|fresh|pass|request_changes|blocked] [summary]`
- `/planner-only budget [on|off]` — session root spend gate (off by default)
- `/planner-only usage [taskId | session | reload]`

Per-session override: `PI_PLANNER_ONLY=1` (also `true`, `on`) forces the guard on regardless of the marker; `PI_PLANNER_ONLY=0` (`false`, `off`) disables it. Persistent off marker:
`~/.pi/agent/planner-only.off`.

`/planner-only off` turns the policy off. `session_shutdown` still restores any
tools a previous build had stripped, so reload can recapture the full list.

## What the parent may use

Kept when present: `read`, `grep`, `find`, `ls`, `git_audit`, `planner_verdict`,
`planner_abort`, `planner_delegate`, `planner_redelegate`, `planner_tasks`, `git_commit`, `question`,
`questionnaire`.

Blocked: `edit`, `write`, generic `bash`, unknown mutators, and host-command
`subagent` paths such as `workflow: "run-ci"` or `gate`.

A small git/`pwd` allowlist exists only in `tool_call` policy for stale calls.
Root `bash`/`edit`/`write` calls stay blocked by policy even though those
names remain active for the child ceiling.

### Reader recovery and diagnostics

`acceptanceMode` is chosen only when `planner_delegate` creates a Task. It is
immutable on rebind; omit it for the default `worktree` mode. Use
`acceptanceMode: "observation"` only with `role: "explorer"` for read-only
information delivery. Observation accepts a trusted restricted-reader report
as information and never claims that code changes were verified. A restricted
reader with a matching terminal is confirmed by `terminal+restricted-reader`,
does not need Git, and never receives a writer reservation or `writerHold`.
Without a matching terminal, it remains unconfirmed and follows recovery
diagnostics without gaining a writer hold.

Worktree tasks and writer-capable or unknown executions retain the normal
Evidence requirements. A writer whose pre-launch environment cannot provide
the required samples is refused with `ENVIRONMENT_UNVERIFIABLE` before launch;
no child execution or new hold is created. A sampling or hash gap discovered
after launch keeps the writer isolated and the hold active until recovery is
resolved.

`planner_tasks` without `taskId` still lists live Tasks. With a canonical
`taskId`, and optionally an `executionId`, it returns read-only diagnostics for
in-memory or ledger-only Tasks without delegation, Git sampling, or shell
access. It reports execution status, capability and confirmation basis,
termination and report admission, probe failures, recovery requirements,
writer hold state, execution timing, the originating Request identity, the
current Request deadline/remaining-time observation, and session-log location.
`launchedAt` is the local REQUEST outbound boundary, `startedAt` is the local
receipt of launcher STARTED (explicitly unknown when absent), and `durationMs`
uses a monotonic REQUEST-outbound-to-finalization interval that includes stop
confirmation but excludes pre-launch Git capture. Wall timestamps retain their
own meaning and are not subtracted to derive duration. A location is classified as a
verified readable file, a known but unavailable file, a directory hint, or
unknown; a directory is never presented as a verified log file. Diagnostic
details are bounded to a fixed 64 KiB structured budget and disclose
truncation. `executionId` identifies the Task execution used for diagnostics;
it is distinct from a child `runId`.

## v0.2 orchestration

Root passes a `TaskSpec` as the `planner_delegate` parameters — no `taskId`
key exists on this tool; it always mints a new Task and returns the canonical
id in `details.taskId`:

```json
{
  "objective": "Add a CSV parser",
  "cwd": "/repo",
  "role": "worker",
  "scope": { "allowedPaths": ["src/parser.ts"] },
  "constraints": ["no new dependencies"],
  "acceptanceCriteria": ["empty input returns []"],
  "validation": { "required": true, "commands": ["npm test"] },
  "expectedEvidence": { "changedFiles": true, "tests": true },
  "stopConditions": ["ask if the schema is ambiguous"]
}
```

Re-entering an existing Task — a correction round after `request_changes`, a
reviewer invocation over its latest WorkerReport, or a recovery re-execution —
goes through `planner_redelegate`, which requires the canonical `taskId`
verbatim from a prior result's `details.taskId` (never construct one). Its
public input is only `taskId`, invocation `role`, and optional `instructions`,
`envelope`, and `recovery`:

```json
{
  "taskId": "T-20260831-001",
  "role": "reviewer"
}
```

If the canonical id is not in context (after compaction or a session resume),
`planner_tasks` lists the workspace's live Tasks — non-final states plus
blocked Tasks awaiting a recovery decision — with `taskId`, `state`, `role`,
`recoveryRequired`, and where the record came from (`memory` or `ledger`,
since the restore cap can leave a live Task on disk only). It is read-only:
it never mints, binds, restores, or launches.

`planner_delegate` registers the task, samples the workspace, and refuses a
second `worker` for the same cwd (at most one worker per cwd); `subagent` and
`bg_wait` calls are refused outright. The minted id is reserved in the shared ledger
namespace with an atomic cross-process claim: restored, terminal, over-cap, and
unreadable snapshot ids remain occupied. `planner_redelegate` binds the
existing record verbatim — its full stored spec, including workspace and
validation, is the child contract and is never rewritten — and checks the host
context workspace. Legacy repeated definition fields are ignored with a
warning; `instructions` augments only that child packet. An id collision is
never treated as continuation. Restricted roles remap onto builtin agents:

Invalid TaskSpec refusals show a repair summary that preserves the trusted
role and validation intent. A command-list shorthand becomes explicit mandatory
validation; an unconvertible validation shape remains refused and asks for
input, rather than silently becoming `required: false`. Every
`validation.commands` entry must be executable-shaped — a shell command
starting with a program name or path; instruction prose is refused
(`TASKSPEC_VALIDATION_COMMAND_NOT_EXECUTABLE`), since the worker runs the
entries and the verifier compares them verbatim. Unknown or foreign-workspace
`taskId`s on `planner_redelegate` are refused before child launch and never create a
placeholder.

| Role | Builtin agent | Child tools |
|---|---|---|
| `worker` | unchanged | agent's own allowlist |
| `explorer` / `reviewer` | `reviewer` | read, grep, find, ls |
| `validator` | `oracle` | read, grep, find, ls, bash |

Validation runs are delegated by Root explicitly through `planner_redelegate`
with `role=validator` and the existing Task's canonical `taskId`. First create
a worker Task with `planner_delegate`; standalone validator Tasks are refused
before allocation or launch. Oracle reports supplement the worker report;
nothing is auto-dispatched.

`planner_delegate` and `planner_redelegate` use launcher defaults for `model` and `thinking` unless operator role routing is enabled. Enabled routing sends an exactly verified available `provider/model` and thinking, then checks actual terminal identity before accepting completion. Ordinary worker, explorer, validator, and reviewer requests omit `toolBudget`; the Task's one report-only correction binds the registered `planner-report-only` agent (`tools: []`, with only the launcher's structured result tool appended) and sends `toolBudget: { hard: 1, block: "*" }`. The immutable execution record, not re-delegation arguments, selects that mode and persists the sent budget, registration proof, agent binding, and raw terminal. `timeoutMs` remains unset because the plugin owns its execution envelope. Usage rows retain the child response identity for attribution. `planner-scout` and `planner-report-only` are runtime-registered agents whose definitions carry no `model`/`thinking`; with pi-subagents at or after upstream commit `bbb30096` (#2369, 2026-09-20, "apply model settings to runtime-registered agents"; first release after 0.70.0) they follow `subagents.defaultModel` / `defaultThinking` and the `model`/`thinking` fields of `subagents.agentOverrides.planner-scout` (or `planner-report-only`). `agentOverrides.scout` configures only the builtin scout and never reaches the Explorer. On pi-subagents 0.70.0 and older, runtime agents skip every operator model setting and inherit the Root session model.

A `reviewer` child always launches with `context: "fresh"` carrying a
`ReviewRequest` — the Task's spec, the latest WorkerReport, Root's Git
evidence, and a bounded patch — not a fork of the parent session. The
ReviewRequest is an invocation over the Task, never a new TaskSpec; reviewer
invocations only exist through `planner_redelegate` (there is nothing to
review on a fresh mint). The Task's
original role, objective, and spec stay unchanged through worker, reviewer,
and validation runs. A `validator` run via `planner_redelegate` is an
invocation over the task under review; its report is recorded in that
Task's `validatorReports`.

Workers return a versioned `WorkerReport`; the launcher validates it against
the schema and it lands in `details.report` — never re-read from the child's
text. A non-completed launcher status is a tool error (thrown), not a parse
failure. A reviewer works only from its invocation payload and may use read,
grep, find, and ls: it must not `git log`, run `npm test`, or re-probe the
tree.

A missing or invalid report grants exactly one report-only correction. Its
closed agent exposes only one structured report submission; any other tool is
absent, and the hard-one budget blocks calls after that submission. A
`tool_budget_exhausted` terminal is recorded as a report-only budget failure
and can never admit a WorkerReport. A malformed correction blocks the Task,
and the correction execution cannot add Truth paths. pi-subagents 0.69.0 does
not expose a pre-budget partial grace or the raw malformed structured output,
so those capabilities remain unsupported rather than inferred from text.

Validators (`oracle`) default to a bounded check when the worker's validation
already exited 0: `git rev-parse HEAD`, `git status --porcelain`, and that
named tests exist. Set `PI_PLANNER_ONLY_ORACLE=full` to re-run the full
suite. Failed worker validation still re-runs the listed commands.

### Task identity and the PASS boundary

Both child contracts are checked against the delegation they answer:

- A `WorkerReport` is accepted only when `taskId` and `evidence.taskId` match
  the delegated task. Execution identity (`evidence.workerRunId`) is stamped by
  Root from the launcher terminal (ADR-0004); any child-provided runId is stripped
  and disclosed in warnings rather than rejected. A structurally valid report
  for the wrong task lands flagged with identity errors on the review decision
  rather than being silently accepted.
- A `ReviewResult` is accepted only when its `taskId` matches the reviewed
  task; mismatched verdicts are never recorded and no state changes.

Evidence is per-execution and Root-owned. Each actual child execution gets an
evidence record: Root samples Git immediately before it starts (`A_run`) and
again when the execution's final result arrives (`C_report`), even when the
report cannot be parsed. Truth and scope are the pure `diff(A_run, C_report)`
cross-checked against the report declaration — anything predating `A_run`
(including unrelated history on the branch) is outside the window by
construction. Freshness is the separate `diff(C_report, C_now)`: Root
re-samples at review and at the acceptance boundary, and drift after the
report forces `revalidate` instead of completion. A fresh reviewer's
`evidenceFresh: true` never bypasses that Root-side check. Findings
(under-report, out-of-scope changes, drift) persist across correction rounds
and block PASS until a review confirms the repair; ledger records written
before per-execution evidence existed are marked unverifiable and cannot
complete automatically. A correction run may restate paths attributed to
earlier executions of the same Task in `changedFiles`; only paths never
attributed to the Task count as over-reported. The writer lock follows the worktree's real path:
aliases of one worktree (relative path, symlink) share the lock, while
independent worktrees stay independent.

### Idle gather policy

Root's gather phase is derived from the Task store for the adapter workspace.
While a non-final Task is live for this cwd, the ordinary allowlist applies
(inspect tools, `git_audit`, Verdict, one Delegation at a time). When no Task
is live (Idle for gather), Root may only start a Delegation with
`planner_delegate`, re-enter an existing Task with `planner_redelegate`, look up live Tasks with `planner_tasks`, ask a
question, record a Verdict (`planner_verdict`
works on blocked/failed Tasks too), abandon a `recovery.required` execution
with `planner_abort`, or commit a completed Task with
`git_commit`. `git_audit` is allowed while Idle. Every
Idle refusal of an inspect, shell, or mutation tool carries a fenced TaskSpec
JSON that passes validation, filled from the refused call, so the repair is
one paste; `subagent` and `bg_wait` are refused outright. A standalone
Explorer Task — one with its own TaskSpec — closes like a
Worker Task: validated WorkerReport → reviewing → Root `planner_verdict`; a
read-only zero-change outcome is valid, and a malformed terminal report blocks
the Task with a repair instruction. Blocked and failed Tasks do not keep
gather live; re-delegation is the path to inspect the tree again.

Reviewers have no `git_audit` (foreground children do not load ambient
extensions, and that tool belongs to the parent extension). Root samples Git itself and ships a
bounded evidence packet — HEAD, status, current changed files, A-to-C
attributed / undeclared / extra-declared paths, diff stat, diff check —
in the `ReviewRequest`; reviewers work with `read`/`grep`/`find`/`ls` only.
A bounded patch against the Task's start baseline does cross the seam in the
`ReviewRequest` (committed Task changes stay reviewable); if the packet was
truncated (`patchTruncated` or omitted patch paths), a reviewer PASS is
refused and only `request_changes` or `blocked` can be recorded from it.

A reviewer PASS is snapshot-digest-bound: it must name the report revision and
the WorkspaceSnapshot digest it was shown, and Root re-samples the workspace
snapshot at accept time — a mismatching, stale, or unknown sample forces
`revalidate` instead of completion. HEAD/status hashes are Git attribution
evidence only; they never stand in as the PASS identity. The write lock is
held by the live writable delegation (worker or validator) for its whole
invocation, so a second writable child on the same worktree is refused before
launch even while the Task is reviewing or blocked.

Review states: `planning → executing → reviewing → completed | changes_requested | blocked`.
Root records verdicts with `planner_verdict`: tasks in `blocked` or `failed` state can directly pass as long as they have a recorded report; `completed` is the sole terminal state. At most three corrections (`MAX_REVIEW_ROUNDS`). Stale in-scope evidence cannot
PASS. Root may override a reviewer; the override is recorded in memory.

### Request limits and recovery

Each Root request shares a durable allowance across all Tasks and child roles:
32 tool attempts, 8 child launch claims, 3 unresolved failures in the same family,
2 genuine parameter repairs, and a 15-minute deadline from its first activity.
Changing wording, Task IDs, policies, or recovery execution IDs does not reset it.
Delegation results expose `details.request.{requestId, requestDeadline,
remainingMs, observedAt}`; before first activity the remaining value is `null` with
`unavailableReason: request-not-started`. These are observations only and do not
refresh or clamp the deadline.
The next tool/launch over its allowance is refused before execution; the third
same-family failure closes admission immediately. Only an accepted correction
resolves its own same-Task, same-family failure ancestors. An unrelated success
or a structurally valid report does not clear failures.

Use `/planner-only request status` to inspect admission, child stop, and Root stop
separately. Closure is persisted before active children are cancelled. A launch
claim is persisted before REQUEST emission and is not refunded after an uncertain
send, failed child, or cancellation. An unconfirmed writer keeps its Writer hold,
including after reload or request recovery. Evidence revalidation also consumes
its existing per-Task allowance once per dispatch; a fourth attempt is refused.

After `agent_settled`, a new idle interactive input opens a fresh request.
Extension messages, queued continuations, steering, RPC input, and reload do not.
`/planner-only request resume` is a command-only recovery path, requires an idle
host and human UI confirmation, and never clears Writer holds. Hosts without a
confirmation UI cannot use it. Missing/corrupt/interrupted request records stay
closed for operator reconciliation instead of silently granting a fresh allowance.

Operator environment settings are positive finite integers and freeze when a
request starts. Zero, empty, negative, fractional, or unlimited values are invalid:

| Environment variable | Default |
|---|---:|
| `PI_PLANNER_ONLY_REQUEST_TOOL_ATTEMPTS` | 32 |
| `PI_PLANNER_ONLY_REQUEST_CHILD_LAUNCHES` | 8 |
| `PI_PLANNER_ONLY_REQUEST_FAILURES` | 3 |
| `PI_PLANNER_ONLY_REQUEST_REPAIRS` | 2 |
| `PI_PLANNER_ONLY_REQUEST_ACTIVE_MS` | 900000 |

The durable state lives under the agent directory's `planner-only/requests/`.
Committed claims, observed sends, terminal receipt, and confirmed stop remain
separate diagnostics. Do not delete this state to recover an unconfirmed writer.
Root abort is reasserted at every subsequent agent start while the Request is closed.
The real SDK 0.85.1 / faux-provider queue probe observes zero extra model calls
with this guard; interactive TUI behavior remains unverified. Other host paths
may still require additional stop support. Provider-request hooks are observations, may be absent for some
providers, and are not a token, cost, or exact model-call hard limit.

### Composite workflows

Execution `subagent` calls that carry a non-empty `workflowScript`,
`workflowScriptPath`, or `workflow`, or a non-empty `tasks` / `chain` array,
are rejected before launch. Planner-only cannot audit or rewrite those
internal steps and does not parse JavaScript `workflowScript`. Each lifecycle
stage must be a separate direct `{agent, task}` call: wait for the worker
`WorkerReport`, then call the reviewer so it receives the latest TaskSpec,
WorkerReport, and Root Git evidence. Management or `validate` calls that
include `action` are unchanged.

### git_audit

Parent-only read-only Git: `status`, `diff-stat`, `diff-names`, `diff-check`,
`head`, `log`. Fixed argv, no shell, mutating subcommands rejected.

### Usage accounting

Token counts are authoritative; dollar costs are derived values. The plugin tracks Root turns by lifecycle phase (`planning`, `executing`, `reviewing`), child turns by delegation run, review leakage bytes from read-only tool inspection, and injected prompt bytes.

Pricing rates are resolved in priority order:
1. Provider-reported costs (`usage.cost` from Pi core or `pi-subagents`);
2. Local pricing table configured in `~/.pi/agent/planner-only/pricing.json` (overridable with `PI_PLANNER_ONLY_PRICING`);
3. Otherwise cost is marked unknown (never rendered as `$0.00`).

The pricing table format:

```json
{
  "version": 1,
  "currency": "USD",
  "rates": {
    "example-provider/expensive-root-model": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 },
    "cheap-worker-model": { "input": 0.2, "output": 1.2, "cacheRead": 0.02, "cacheWrite": 0.2 }
  }
}
```

- Keys are bare model names by default (`gpt-5.6-luna`). Write `provider/model` only when that provider's price differs.
- On first load the plugin copies bundled defaults into `~/.pi/agent/planner-only/pricing.json` if the file is missing; later upgrades add missing keys and never overwrite yours.
- Lookup prefers an explicit `provider/model` key, then the bare model name.
- Rates are expressed per million tokens in `currency` (`USD` or `CNY`).
- A `null` rate means the rate is unknown (yields `cost unknown`); `0` indicates free.
- Keys starting with `_` are ignored (useful for comments).
- Reload rates in-session with `/planner-only usage reload`.

Session-level root spend gating is **off by default**. `/planner-only budget on` turns it on for this machine (marker: `~/.pi/agent/planner-only/session-root-budget.on`); `/planner-only budget off` turns it off. Soft cap warns at 3× the worker-initial floor; the 5× hard threshold is reported only — it does not refuse delegations yet. `PI_PLANNER_ONLY_SESSION_ROOT_BUDGET=1` or `=0` overrides the marker. Ordinary worker, explorer, and validator executions always have finite anomaly bounds. Omitting `envelope` uses `maxTokens=100000` and `maxWallMs=600000` (ADR-0008); operators may replace either default with the positive safe-integer environment variables `PI_PLANNER_ONLY_EXECUTION_MAX_TOKENS` and `PI_PLANNER_ONLY_EXECUTION_MAX_WALL_MS`. An explicit envelope still replaces token/default inheritance, but its effective wall bound is capped at the original Request remainder minus a provisional 60-second reserve (ADR-0010); a token-only explicit envelope therefore receives a Request-derived wall cap. If the fresh post-sampling remainder is unavailable or does not exceed the reserve, the Task records a launch refusal and no child, correction, recovery, revalidation, or writer hold is consumed. The ledger and tool details retain the original and effective envelopes, source, clamp flag, and Request observation. Reviewer invocations remain bounded by the enclosing Request and may use the reserve window. The session evidence export carries `statuses` (task / workerReport / reviewResult / rootVerdict / refusalKind), `findings`, `usage`, `breakdown`, and `unattributed`; the linkage / requirements / evidenceMatrix / analysis blocks are gone.

**Alternative:** The preferred approach is to specify `cost` directly in `~/.pi/agent/models.json`. This enables native cost calculation across both Pi and `pi-subagents` (e.g. `/subagent-cost`). The plugin table serves as a fallback or override when you prefer not to modify `models.json`.

### Cancellation and orphaned children

In the TUI, pressing Esc during a `planner_delegate`/`planner_redelegate` call sends CANCEL to the child; the Task transitions to `blocked` and the usage already consumed is recorded. Print mode (`-p`) has no tool-level abort entry: SIGINT ends Root outright, the delegated agent (which runs in-process) dies with it, no `cancelled` terminal or usage row is written, and any shell command the child had started may survive as an orphan (observed once during the host spike) — check and clean up by hand. `/exit` typed while a delegation is in flight is treated as steering input, not exit; use Ctrl-D.

**Stop confirmation (P0-A).** A terminal status alone does not prove the writer went quiet. After an identity-matched terminal, the delegation waits `quiescenceWaitMs` (default 10 s; `PI_PLANNER_ONLY_QUIESCENCE_MS` overrides) and then requires two consecutive identical worktree samples — only then is the stop `confirmed` (`confirmationBasis: terminal+quiet-worktree`) and the writer reservation released, with the residual sample recorded as `cTerminal`. This predicate also gates an ordinary `completed` writer result: if quiescence is not confirmed, its report is not admitted and the Task remains `blocked` with a hold. If the 5 s cancel grace expires with no terminal, the execution is `stop_unconfirmed`: the Task goes `blocked`, the writer reservation converts to a persisted `writerHold` that keeps refusing a second writer — across restarts and beyond the normal ledger restore cap — and the launcher keeps its RESPONSE subscription so a late terminal still finalizes the execution exactly once (usage, `cTerminal`, release). Sampling failure records `evidenceIncomplete` and also holds. Non-completed delegations (cancelled, timed_out, failed, …) no longer throw: the delegation call returns structured `details.termination` — host status, ended reason, confirmation basis, execution lifecycle state, `usageComplete` — plus a text summary for display. A `completed` report arriving after the cancel request is collected as `executions[].lateReport` for evidence only; it never advances review.

**Runaway envelope and recovery (P0-B).** Both delegation tools accept an explicit `envelope: { maxTokens?, maxWallMs?, softTokensShare? }` — cumulative UPDATE tokens (snapshot input+output, no cache) and an independent wall clock covering the actual launcher wait, not pre-launch evidence sampling. When `maxTokens` is present, one best-effort close-out reminder is attempted after usage crosses 70% by default; `softTokensShare` may set a value greater than 0 and less than 1. Its queued/unavailable/gone/failed/unconfirmed acknowledgement is retained in execution diagnostics and grants no extension or grace. A breach fires the same CANCEL path as Esc, once; the execution ends `worker_runaway`, including when its terminal arrives after the cancel grace, and a confirmed stop plus an unconfirmed one both flag `task.recovery.required`. Re-executing the Task then requires a structured `recovery` decision on `planner_redelegate` (`retry_same_plan` / `fix_environment` / `resume_report_only`, naming the abnormal `executionId`, a reason, and a `worktreeDecision`), or `planner_abort` — the dedicated give-up surface (ADR-0003) that records a blocked verdict and consumes the requirement in one call — to hand it to the operator. A decision is consumed once; equivalent action/evidence/worktree decisions are refused even if the reason is reworded or evidence references are reordered. `worktreeDecision: "manual"` clears a persisted hold only as the operator's explicit assertion that residual writers were resolved. Unwired P1 actions refuse explicitly. On `planner_redelegate`, a `recovery` key on a non-final Task is refused `RECOVERY_NOT_APPLICABLE` before dispatch for workers, explorers, validators, and reviewers; omit it for ordinary correction or review rounds. Final calls retain their role-specific guards: non-reviewer execution uses `TASK_CLOSED` except for `blocked + recovery.required`, while reviewer invocation keeps its existing `REVIEW_TERMINAL` handling. `planner_verdict` has different compatibility behavior: it strips a stray `recovery` key, records the plain verdict, and discloses the strip in `warnings` without consuming recovery.

Each execution persists a bounded tail of 64 launcher UPDATE observations, including bounded tool arguments and output lines. These fields can contain sensitive content already present in the host payload. `planner_tasks` reports the first observed non-read-only tool ordinal, the largest observed token jump, and a read-only fraction with coverage counts; a non-read-only tool is classification evidence, not proof that a write succeeded. Cancelled runs retain an uncategorized token snapshot until real terminal usage replaces it. Worker executions may opt into `maxReadOnlyTools` and `preparationTokensShare` (the latter requires `maxTokens`); exact tool names determine `preparation_runaway`. Recovery packets carry a separate structured `priorExecution` field, and `retry_same_plan` refuses token budgets below the prior observed token breach.

## Design specs

- [v0.2 specification](docs/pi-planner-only-v0.2-spec.md) covers the core protocol and architecture.
- [Evidence Authority specification](docs/pi-planner-only-evidence-authority-spec.md) defines Root-owned delegation attribution.
- [P0/P1 hardening specification](docs/pi-planner-only-p0-p1-hardening-spec.md) covers evidence, lifecycle, and trust-boundary hardening.
- [v0.3.1 specification](docs/pi-planner-only-v0.3.1-spec.md) covers fewer Root turns and lenient WorkerReport normalisation.
- [v0.3.2 specification](docs/pi-planner-only-v0.3.2-spec.md) covers compressed repeated Root input and reactive JSON guidance.

## Tests

```bash
npm test          # unit + in-process integration
npm run typecheck # tsc --noEmit (Pi loads .ts directly; this is for local checking)
npm run test:release  # release gate: typecheck + unit tests
```

The PASS-boundary workspace snapshot covers the task's exact scope paths plus
the paths Git reports changed; dependency, config, or lockfile inputs outside
those sets are not freshness-bound unless you list them in the TaskSpec scope.

`test:release` is `typecheck` + the unit suite. Host-level coverage is
recorded as evidence captures in the repository's typed-delegation acceptance
runs, not as a release-gate suite.

## Layout

The restricted closeout host primitives have a separate production-runner suite:
`npm run test:closeout:host` (normal Linux terminal with slot, bubblewrap,
libseccomp, and delegated systemd cgroups). The initial runtime profile supports
system Python/unittest; the optional pinned tools profile also supports pytest,
Ruff and mypy. Eligible cancellations can use `resume_report_only`; see [the execution and evidence contract](docs/closeout-validation.md).

| File | Responsibility |
|---|---|
| `types.ts` | `TaskSpec`, `WorkerReport`, `EvidenceRef`, `ReviewResult`, `ReviewRequest` |
| `policy.ts` | parent tool allowlist and `tool_call` decisions |
| `request-control.ts` | durable Request limits, closure, lifecycle and failure chains |
| `request-events.ts` | typed Task/host observations for Request control |
| `task.ts` | validation, compaction, state machine |
| `report.ts` | `WorkerReport` schema validation and identity |
| `review.ts` | verdicts, review loop, fresh-review packet |
| `roles.ts` | TaskRole profiles and agent remapping |
| `evidence.ts` | Git probe, A-to-C attribution, review evidence packets |
| `git-audit.ts` | `git_audit` resolution and output bounds |
| `orchestrate.ts` | delegation launch, write lock, review loop, Task store writes |
| `notify.ts` | async subagent notifications and child metadata |
| `usage.ts` | pure usage ledger, cost resolution, report rendering |
| `index.ts` | hooks, tool, commands |

No background advisor or telemetry. Persistence includes Task ledger snapshots, Request control records, session custom entries, and the local append-only usage log.

### Operator-selected delegation models

`PI_PLANNER_ONLY_ROLE_MODELS=1` enables routing on the typed delegation tools.
Set `PI_PLANNER_ONLY_MODEL_WORKER=provider/model` and
`PI_PLANNER_ONLY_THINKING_WORKER=low` (likewise `EXPLORER`, `VALIDATOR`, or
`REVIEWER`). With routing disabled, the launcher retains its existing selection.
Tool arguments cannot override operator routing. The configured model must be
available in the host registry before a Task or child is allocated. Only explicitly
configured `PI_PLANNER_ONLY_MODEL_WORKER_FALLBACK` candidates may replace it.

The launcher terminal must report the expected qualified model and thinking
(either a separate field or a known `:thinking` suffix). Missing or conflicting
identity prevents completed reports from being accepted; usage and diagnostic
reports remain recorded. Tool `details.modelRoute` and session entries of type
`planner-only-model-route` preserve expected and actual identity. This wiring has
fixture coverage; real provider routing and cost savings still require measurement.

### Restricted closeout recovery

`resume_report_only` is a one-shot recovery for a persisted `cancelled` worker runaway caused by the token or wall limit. It requires confirmed quiescence, a complete `C_terminal`, and non-empty attributed in-scope origin changes. The host exposes exactly `closeout_read`, `closeout_validate`, and `structured_output`, with five work attempts and one report attempt. Every required command needs a current host-journal receipt. The origin remains cancelled and reportless; the closeout execution inherits its paths and contributes no new Truth. Completed reports still require normal review and verdict. Failed closeout permits only a full `retry_same_plan` or `planner_abort`.
