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
`planner_delegate`, `git_commit`, `question`, `questionnaire`.

Blocked: `edit`, `write`, generic `bash`, unknown mutators, and host-command
`subagent` paths such as `workflow: "run-ci"` or `gate`.

A small git/`pwd` allowlist exists only in `tool_call` policy for stale calls.
Root `bash`/`edit`/`write` calls stay blocked by policy even though those
names remain active for the child ceiling.

## v0.2 orchestration

Root passes a `TaskSpec` as the `planner_delegate` parameters:

```json
{
  "taskId": "T-20260831-001",
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

`planner_delegate` registers the task, samples the workspace, and refuses a
second `worker` for the same cwd (at most one worker per cwd); `subagent` and
`bg_wait` calls are refused outright. If `taskId` is missing, malformed, or not today's date, the extension
replaces it with a generated id, keeps the original id as an alias, and notifies
Root in the delegation result. The generated id is reserved in the shared ledger
namespace with an atomic cross-process claim: restored, terminal, over-cap, and
unreadable snapshot ids remain occupied. Explicit continuation resolves a
canonical id or registered alias and checks the workspace; an id collision is
never treated as continuation. Restricted roles remap onto builtin agents:

Invalid TaskSpec refusals show a repair summary that preserves the trusted
role and validation intent. A command-list shorthand becomes explicit mandatory
validation; an unconvertible validation shape remains refused and asks for
input, rather than silently becoming `required: false`. Multiple or unknown
continuation ids are refused before child launch and never create a
placeholder.

| Role | Builtin agent | Child tools |
|---|---|---|
| `worker` | unchanged | agent's own allowlist |
| `explorer` / `reviewer` | `reviewer` | read, grep, find, ls |
| `validator` | `oracle` | read, grep, find, ls, bash |

Validation runs are delegated by Root explicitly (`planner_delegate` with
role=validator); nothing is auto-dispatched.

`planner_delegate` does not set `model`, `thinking`, `toolBudget`, or `timeoutMs` on the delegation request; the child runs with the host's defaults for all four. The `model` and `thinking` values in usage rows are read back from the child's response for attribution only.

A `reviewer` child always launches with `context: "fresh"` carrying a
`ReviewRequest` — the Task's spec, the latest WorkerReport, Root's Git
evidence, and a bounded patch — not a fork of the parent session. The
ReviewRequest is an invocation over the Task, never a new TaskSpec. The Task's
original role, objective, and spec stay unchanged through worker, reviewer,
and validation runs. A `validator` delegation is an invocation over the task
under review rather than creating a new Task; its report is recorded in that
Task's `validatorReports`.

Workers return a versioned `WorkerReport`; the launcher validates it against
the schema and it lands in `details.report` — never re-read from the child's
text. A non-completed launcher status is a tool error (thrown), not a parse
failure. A reviewer works only from its invocation payload and may use read,
grep, find, and ls: it must not `git log`, run `npm test`, or re-probe the
tree.

Validators (`oracle`) default to a bounded check when the worker's validation
already exited 0: `git rev-parse HEAD`, `git status --porcelain`, and that
named tests exist. Set `PI_PLANNER_ONLY_ORACLE=full` to re-run the full
suite. Failed worker validation still re-runs the listed commands.

### Task identity and the PASS boundary

Both child contracts are checked against the delegation they answer:

- A `WorkerReport` is accepted only when `taskId`, `evidence.taskId`, and (when
  present) `evidence.workerRunId` match the delegated task and subagent call.
  A structurally valid report for the wrong task lands flagged with identity
  errors on the review decision rather than being silently accepted.
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
`planner_delegate`, ask a question, record a Verdict (`planner_verdict`
works on blocked/failed Tasks too), or commit a completed Task with
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

Session-level root spend gating is **off by default**. `/planner-only budget on` turns it on for this machine (marker: `~/.pi/agent/planner-only/session-root-budget.on`); `/planner-only budget off` turns it off. Soft cap warns at 3× the worker-initial floor; the 5× hard threshold is reported only — it does not refuse delegations yet. `PI_PLANNER_ONLY_SESSION_ROOT_BUDGET=1` or `=0` overrides the marker. Per-execution anomaly bounds are explicit-only: `planner_delegate` accepts `envelope: { maxTokens?, maxWallMs? }` and cancels the child (via the same CANCEL path as Esc) when a bound trips; with no envelope the monitor only observes. The session evidence export carries `statuses` (task / workerReport / reviewResult / rootVerdict / refusalKind), `findings`, `usage`, `breakdown`, and `unattributed`; the linkage / requirements / evidenceMatrix / analysis blocks are gone.

**Alternative:** The preferred approach is to specify `cost` directly in `~/.pi/agent/models.json`. This enables native cost calculation across both Pi and `pi-subagents` (e.g. `/subagent-cost`). The plugin table serves as a fallback or override when you prefer not to modify `models.json`.

### Cancellation and orphaned children

In the TUI, pressing Esc during a `planner_delegate` call sends CANCEL to the child; the Task transitions to `blocked` and the usage already consumed is recorded. Print mode (`-p`) has no tool-level abort entry: SIGINT ends Root outright, the delegated agent (which runs in-process) dies with it, no `cancelled` terminal or usage row is written, and any shell command the child had started may survive as an orphan (observed once during the host spike) — check and clean up by hand. `/exit` typed while a delegation is in flight is treated as steering input, not exit; use Ctrl-D.

**Stop confirmation (P0-A).** A terminal status alone does not prove the writer went quiet. After an identity-matched terminal, the delegation waits `quiescenceWaitMs` (default 10 s; `PI_PLANNER_ONLY_QUIESCENCE_MS` overrides) and then requires two consecutive identical worktree samples — only then is the stop `confirmed` (`confirmationBasis: terminal+quiet-worktree`) and the writer reservation released, with the residual sample recorded as `cTerminal`. If the 5 s cancel grace expires with no terminal, the execution is `stop_unconfirmed`: the Task goes `blocked`, the writer reservation converts to a persisted `writerHold` that keeps refusing a second writer — across restarts too — and the launcher keeps its RESPONSE subscription so a late terminal still finalizes the execution exactly once (usage, `cTerminal`, release). Sampling failure records `evidenceIncomplete` and also holds. Non-completed delegations (cancelled, timed_out, failed, …) no longer throw: `planner_delegate` returns structured `details.termination` — host status, ended reason, confirmation basis, execution lifecycle state, `usageComplete` — plus a text summary for display. A `completed` report arriving after the cancel request is collected as `executions[].lateReport` for evidence only; it never advances review.

**Runaway envelope and recovery (P0-B).** `planner_delegate` accepts an explicit `envelope: { maxTokens?, maxWallMs? }` — cumulative UPDATE tokens (snapshot input+output, no cache) and an independent wall clock. A breach fires the same CANCEL path as Esc, once; the execution ends `worker_runaway`, and a confirmed stop plus an unconfirmed one both flag `task.recovery.required`. Re-executing the Task then requires a structured `recovery` decision on `planner_delegate` (`retry_same_plan` / `fix_environment`, naming the abnormal `executionId`, a reason, and a `worktreeDecision`), or `planner_verdict` with `verdict: "blocked"` + `recovery: { action: "abort" }` to hand it to the operator. A decision is consumed once; an identical one is refused. Unwired P1 actions refuse explicitly.

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

| File | Responsibility |
|---|---|
| `types.ts` | `TaskSpec`, `WorkerReport`, `EvidenceRef`, `ReviewResult`, `ReviewRequest` |
| `policy.ts` | parent tool allowlist and `tool_call` decisions |
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

No background advisor, queues, or telemetry. The only persistence is usage: session custom entries and a local append-only `usage.jsonl`.
