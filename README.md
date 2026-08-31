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
`subagent`, `bg_wait`, `subagent_wait`, `contact_supervisor`, and other
planner/orchestration tools when present, while removing mutators and unknown tools
from the schemas the model receives. The `tool_call` policy remains a defense-in-
depth guard for stale, resumed, or dynamically exposed calls.

`/planner-only off` restores only the tools this extension removed, preserving tools
added by other extensions. `/planner-only on` filters the current active set again.
The set is restored during `session_shutdown` so reload and session replacement can
re-capture the complete active set.

The global installation directory is `~/.pi/agent/extensions/pi-planner-only`,
with its entrypoints symlinked to this repository. Pi derives local auto-discovered
extension labels from the path, so the directory name is the supported source of the
exact `pi-planner-only` name shown in `[Extensions]`.

Commands:

- `/planner-only status`
- `/planner-only off`
- `/planner-only on`

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
```
