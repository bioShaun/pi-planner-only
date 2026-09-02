# pi-planner-only

[中文](README.zh-CN.md) · English

A [Pi](https://pi.dev) extension that keeps the **root session** a planner and
reviewer. All file edits, shell, and tests go to subagents.

While the guard is on, the parent never sees `bash`, `edit`, or `write` in its
tool schema. `tool_call` policy is a second gate for stale or resumed calls.
Child sessions start with `--no-extensions`; the extension also no-ops when
`PI_SUBAGENT_CHILD=1`.

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

## Commands

- `/planner-only status`
- `/planner-only on`
- `/planner-only off`
- `/planner-only task [taskId]` — lifecycle state
- `/planner-only review [taskId] [root|fresh|pass|request_changes|blocked] [summary]`

Non-interactive override: `PI_PLANNER_ONLY=0 pi`. Persistent off marker:
`~/.pi/agent/planner-only.off`.

`/planner-only off` restores only tools this extension removed. The set is
restored on `session_shutdown` so reload can recapture the full tool list.

## What the parent may use

Kept when present: `read`, `grep`, `find`, `ls`, `git_audit`, `subagent`,
`bg_wait`, `subagent_wait`, `subagent_supervisor`, `contact_supervisor`,
`question`, `questionnaire`.

Blocked: `edit`, `write`, generic `bash`, unknown mutators, and host-command
`subagent` paths such as `workflow: "run-ci"` or `gate`.

A small git/`pwd` allowlist exists only in `tool_call` policy for stale calls.
The model schema never includes `bash`.

## v0.2 orchestration

The parent embeds a `TaskSpec` JSON object in the subagent task:

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

`subagent` calls are intercepted: the task is registered, the workspace is
sampled, and a second declared `worker` for the same cwd is blocked (one writer
per cwd). Restricted roles remap onto builtin agents:

| Role | Builtin agent | Child tools |
|---|---|---|
| `worker` | unchanged | agent's own allowlist |
| `explorer` / `reviewer` | `reviewer` | read, grep, find, ls |
| `validator` | `oracle` | read, grep, find, ls, bash |

A `reviewer` child always launches with `context: "fresh"` and a packet of
TaskSpec + WorkerReport + evidence refs — not a fork of the parent session.
The packet is a `ReviewRequest`: an invocation over the Task, never a new
TaskSpec. The Task's original role, objective, and spec stay unchanged through
worker, reviewer, and validation runs.

Workers must return a versioned `WorkerReport`. The parent extracts it,
compacts anything over 12k characters, checks evidence freshness, and appends
the next review action. Malformed output gets one report-only correction, then
blocks.

### Task identity and the PASS boundary

Both child contracts are checked against the delegation they answer:

- A `WorkerReport` is accepted only when `taskId`, `evidence.taskId`, and (when
  present) `evidence.workerRunId` match the delegated task and subagent call.
  A structurally valid report for the wrong task is rejected like a malformed
  one: never stored, one report-only correction.
- A `ReviewResult` is accepted only when its `taskId` matches the reviewed
  task; mismatched verdicts are never recorded and no state changes.

Evidence is authoritative only at the acceptance boundary. Root samples Git
when a delegation starts (A) and again when the result is handled or a Root
`pass` is recorded (C). The A-to-C delta is the scope denominator; Worker
`changedFiles` and Git fingerprints are a declaration, cross-checked but not
authoritative. Missing Worker `gitStatusHash` / `finalGitRef` does not disable
Root attribution. Stale or unverifiable evidence forces `revalidate` instead
of completion, and a fresh reviewer's `evidenceFresh: true` never bypasses
that Root-side check. The per-cwd writer lock is exact-path only: overlapping
worktrees are a known attribution limitation.

### Strict delegation (optional)

By default a worker delegation without an embedded `TaskSpec` is allowed with a
warning. Set `PI_PLANNER_ONLY_STRUCTURED_DELEGATION=strict` to block it
instead. Explorers stay permissive; validators are warned in both modes.

Reviewers have no `git_audit` (children run with `--no-extensions`, and that
tool belongs to the parent extension). Root samples Git itself and ships a
bounded evidence packet — HEAD, status, current changed files, A-to-C
attributed / undeclared / extra-declared paths, diff stat, diff check —
in the `ReviewRequest`; reviewers work with `read`/`grep`/`find`/`ls` only.
No full diff crosses the seam by default.

Review states: `planning → executing → reviewing → completed | changes_requested | blocked`.
At most three corrections (`MAX_REVIEW_ROUNDS`). Stale in-scope evidence cannot
PASS. Root may override a reviewer; the override is recorded in memory.

### git_audit

Parent-only read-only Git: `status`, `diff-stat`, `diff-names`, `diff-check`,
`head`, `log`. Fixed argv, no shell, mutating subcommands rejected.

## Design specs

- [v0.2 specification](docs/pi-planner-only-v0.2-spec.md) covers the core protocol and architecture.
- [Evidence Authority specification](docs/pi-planner-only-evidence-authority-spec.md) defines Root-owned delegation attribution.
- [P0/P1 hardening specification](docs/pi-planner-only-p0-p1-hardening-spec.md) covers evidence, lifecycle, and trust-boundary hardening.

## Tests

```bash
npm test          # unit + in-process integration (excludes the E2E suite)
npm run typecheck # tsc --noEmit (Pi loads .ts directly; this is for local checking)
npm run test:e2e  # real pi-subagents contracts (requires pi-subagents; otherwise loudly skips)
```

`npm test` does not verify the runtime role downgrade mapping. That coverage is
only exercised by `test:e2e`, and is unverified when `pi-subagents` is absent.

The E2E suite runs against the installed `pi-subagents` package — its builtin
agent allowlists, child launch argv (`--no-extensions`, tool ceiling, fresh
session), and the payload fields the planner mutates — without any model calls.

## Layout

| File | Responsibility |
|---|---|
| `types.ts` | `TaskSpec`, `WorkerReport`, `EvidenceRef`, `ReviewResult`, `ReviewRequest` |
| `policy.ts` | parent tool allowlist and `tool_call` decisions |
| `task.ts` | validation, compaction, state machine, writer lock |
| `report.ts` | `WorkerReport` extraction, compaction, identity |
| `review.ts` | verdicts, review loop, fresh-review packet |
| `roles.ts` | TaskRole profiles and agent remapping |
| `evidence.ts` | Git probe, A-to-C attribution, review evidence packets |
| `git-audit.ts` | `git_audit` resolution and output bounds |
| `orchestrate.ts` | delegation launch, review loop, Task store writes |
| `index.ts` | hooks, tool, commands |

No background advisor, persistence, queues, or telemetry.
