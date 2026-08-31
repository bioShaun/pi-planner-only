# Planner-only extension

This global Pi extension makes the root session a planner and reviewer. The
current `pi-subagents` runtime starts children with `--no-extensions`; the
extension also no-ops when `PI_SUBAGENT_CHILD=1` as a second boundary.

The root session can use read-only inspection tools and delegation/supervision
tools. While planner-only mode is enabled, `bash`, `edit`, `write`, and other
mutators are not exposed to the parent model at all. The small safe audit-command
allowlist exists only in the defense-in-depth `tool_call` policy for stale or
resumed calls. The `subagent` tool remains usable for child runs, but host-command
paths such as `workflow: "run-ci"` and `gate` are blocked.

The extension proactively filters the parent's active tool set at every session
start and before each model turn. It keeps configured `read`, `grep`, `find`, `ls`,
`git_audit`, `subagent`, `bg_wait`, `subagent_wait`, `contact_supervisor`, and
other planner/orchestration tools when present, while removing mutators and
unknown tools from the schemas the model receives. The `tool_call` policy remains
a defense-in-depth guard for stale, resumed, or dynamically exposed calls.

`/planner-only off` restores only the tools this extension removed, preserving
tools added by other extensions. `/planner-only on` filters the current active
set again. The set is restored during `session_shutdown` so reload and session
replacement can re-capture the complete active set.

The global installation directory is `~/.pi/agent/extensions/pi-planner-only`,
with its entrypoints symlinked to this repository. Pi derives local auto-discovered
extension labels from the path, so the directory name is the supported source of the
exact `pi-planner-only` name shown in `[Extensions]`.

Commands:

- `/planner-only status`
- `/planner-only off`
- `/planner-only on`
- `/planner-only task [taskId]` — task lifecycle state
- `/planner-only review [taskId] [root|fresh|pass|request_changes|blocked] [summary]`

Non-interactive override:

```bash
PI_PLANNER_ONLY=0 pi
```

The persistent off marker is `~/.pi/agent/planner-only.off`. Remove it or run
`/planner-only on` to restore the guard. Use `/reload` after editing extension
source.

Run the policy and extension self-tests with:

```bash
node policy.test.mjs
node index.test.mjs
node naming.test.mjs
node task.test.mjs
node review.test.mjs
node evidence.test.mjs
node git-audit.test.mjs
```

## v0.2 orchestration layer

Above the tool guard, v0.2 adds a small structured orchestration layer. Its job
is to keep the parent a planner and reviewer and to keep worker output bounded
and verifiable, not to become an agent framework.

### Structured delegation (TaskSpec)

The parent embeds a `TaskSpec` JSON object in the subagent task prompt:

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
sampled for baseline evidence, and a declared second `worker` for the same cwd is
blocked (one writer per cwd; readers and reviewers are unaffected).

### Structured worker return (WorkerReport)

Workers return a versioned `WorkerReport` (status, summary, changedFiles,
validation with exit codes, evidence reference, risks, unresolved). The
`tool_result` hook:

- extracts and schema-validates the report;
- compacts anything over 12k characters before it reaches the parent context;
- re-samples the workspace and checks evidence freshness;
- appends a review decision and concrete next steps.

Output that is not a valid `WorkerReport` is never accepted: the parent is told
to issue exactly one report-only correction, and a second failure blocks the
task.

### Review lifecycle

States follow `planning → executing → reviewing → completed | changes_requested |
blocked`, with at most `MAX_REVIEW_ROUNDS` (3) corrections before the loop
reports blocked. Stale evidence never passes directly: in-scope drift forces a
revalidation round, while purely out-of-scope drift lets review continue.
Verdicts are recorded with `/planner-only review pass|request_changes|blocked`,
and overriding a reviewer is recorded as an override rather than applied
silently.

### git_audit

A registered read-only Git tool for the parent: `status`, `diff-stat`,
`diff-names`, `diff-check`, `head`, `log`. Every operation maps to fixed argv
built in `git-audit.ts` — no shell is involved, mutating subcommands are
rejected by name, shell syntax in `operation`/`cwd` is rejected, and output is
bounded. The parent still never receives `bash`.

### Module layout

| File | Responsibility |
|---|---|
| `types.ts` | `TaskSpec`, `WorkerReport`, `EvidenceRef`, `ReviewResult`, constants |
| `policy.ts` | tool allowlist and `tool_call` decisions |
| `task.ts` | TaskSpec/WorkerReport validation, compaction, state machine, task store |
| `review.ts` | verdict derivation, bounded review loop, reviewer extraction |
| `evidence.ts` | Git probing, freshness comparison, stale classification |
| `git-audit.ts` | `git_audit` operation resolution and output bounds |
| `index.ts` | extension wiring, hooks, `git_audit` registration, commands |

The design target stays "small policy layer", not another agent framework: no
background advisor, no persistence, no queues, no telemetry.
