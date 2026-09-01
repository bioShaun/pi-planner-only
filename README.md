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
evidence freshness, and isolated fresh reviewers.

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
# or try once without installing
pi -e ./index.ts
```

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

Workers must return a versioned `WorkerReport`. The parent extracts it,
compacts anything over 12k characters, checks evidence freshness, and appends
the next review action. Malformed output gets one report-only correction, then
blocks.

Review states: `planning → executing → reviewing → completed | changes_requested | blocked`.
At most three corrections (`MAX_REVIEW_ROUNDS`). Stale in-scope evidence cannot
PASS. Root may override a reviewer; the override is recorded in memory.

### git_audit

Parent-only read-only Git: `status`, `diff-stat`, `diff-names`, `diff-check`,
`head`, `log`. Fixed argv, no shell, mutating subcommands rejected.

## Tests

```bash
npm test
```

## Layout

| File | Responsibility |
|---|---|
| `types.ts` | `TaskSpec`, `WorkerReport`, `EvidenceRef`, `ReviewResult` |
| `policy.ts` | parent tool allowlist and `tool_call` decisions |
| `task.ts` | validation, compaction, state machine, writer lock |
| `review.ts` | verdicts, review loop, fresh-review packet |
| `roles.ts` | TaskRole profiles and agent remapping |
| `evidence.ts` | Git probe and freshness |
| `git-audit.ts` | `git_audit` resolution and output bounds |
| `index.ts` | hooks, tool, commands |

No background advisor, persistence, queues, or telemetry.
