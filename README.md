# pi-planner-only

[中文](README.zh-CN.md) · English

A [Pi](https://pi.dev) extension for saving tokens: the expensive **Root** model
plans and reviews, and cheaper child agents do the bulk of the work through
[pi-subagents](https://github.com/nicobailon/pi-subagents).

This is the **lite** line (0.9+). The full-audit orchestration of 0.2–0.8
(TaskSpec/WorkerReport, ledger, closeout, verdict tools) is preserved at tag
`legacy-full-audit`; see `docs/pi-planner-only-subtraction-plan.md` for why it
was removed.

## What it adds

| Tool | Purpose |
|---|---|
| `delegate({role, task, cwd?})` | Run one child agent and wait. Returns the child's text report, host status, model and usage, and a Git summary of what changed (new commits, diff stat, untracked files). |
| `git_audit({operation, base?, path?, maxEntries?})` | Read-only `status` / `diff-stat` / `diff` / `log`, with fixed argv. |
| `git_commit({message, paths?})` | Stage and commit accepted work. Never pushes. |

Roles map to pi-subagents builtin agents:

| Role | Agent | Holds the cwd |
|---|---|---|
| `worker` | `worker` | yes |
| `explorer` | `scout` | yes |
| `validator` | `oracle` | yes |
| `reviewer` | `reviewer` | no (read-only) |

A role "holds the cwd" when its agent has bash or write: a second such child in
the same directory is refused until the first ends. If a stop cannot be
confirmed, the directory stays held until the late terminal arrives.

Root also gets a short prompt (about 300 tokens): do small things yourself,
delegate larger work, judge results by the diff and check output rather than
the child's claims, and re-delegate with the previous report plus specific
fixes when rework is needed.

The status line shows Root and child tokens and cost for the session.

## Models

Child models come from your pi-subagents settings, not from this plugin.
Configure `subagents.agentOverrides` in `~/.pi/agent/settings.json`:

```json
{
  "subagents": {
    "agentOverrides": {
      "worker":   { "model": "provider/cheap-model", "thinking": "medium" },
      "scout":    { "model": "provider/cheap-model", "thinking": "low" },
      "oracle":   { "model": "provider/mid-model",   "thinking": "medium" },
      "reviewer": { "model": "provider/mid-model",   "thinking": "high" }
    }
  }
}
```

The delegate result names the model the host actually ran.

## Install

```bash
pi install https://github.com/bioShaun/pi-planner-only       # user-level
pi install https://github.com/bioShaun/pi-planner-only -l    # project-level
pi install /path/to/pi-planner-only                          # local checkout
```

Restart Pi or run `/reload`. Requires pi-subagents `>=0.70 <1`.

## Switches

| Setting | Effect |
|---|---|
| `/planner-only on` / `off` | Toggle via the marker file `~/.pi/agent/planner-only.off`. |
| `/planner-only status` | Show state and session cost totals. |
| `PI_PLANNER_ONLY=1` / `0` | Force on / off, overriding the marker. |
| `PI_PLANNER_ONLY_STRICT=1` | Block Root's own `edit`, `write`, and `bash`. Off by default, because small tasks are cheaper done directly. |
| `PI_PLANNER_ONLY_TIMEOUT_MS` | Child wall-clock limit passed to the host (default 600000). |
| `PI_PLANNER_ONLY_MAX_TOKENS` | Cancel a child whose reported tokens exceed this (default 1500000). The count is the child's cumulative input+output tokens from its progress events, excluding cache reads. |
| `PI_PLANNER_ONLY_START_TIMEOUT_MS` | Give up if the child has not started (default 30000). |
| `PI_PLANNER_ONLY_CANCEL_GRACE_MS` | Wait for a cancel to be confirmed (default 5000). |

When disabled, the three tools are removed from the active set and no prompt is
added. Child processes (`PI_SUBAGENT_CHILD=1`) never load the extension.

## Development

```bash
npm run typecheck
TMPDIR=/path/outside/repo npm test
```

`contract.test.mjs` checks event names, agent names, and the exact request
shape against the installed pi-subagents (`PI_SUBAGENTS_DIR` to override the
location); it skips when pi-subagents is absent.
