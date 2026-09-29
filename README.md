# pi-planner-only

[中文](README.zh-CN.md) · English

A [Pi](https://pi.dev) extension for saving tokens: the expensive **Root** model
plans and reviews, and cheaper child agents do the bulk of the work through
[pi-subagents](https://github.com/nicobailon/pi-subagents).

Lite is the default mode in this 0.9+ line. The full-audit orchestration of 0.2–0.8
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

Root also gets a short prompt (roughly 400 tokens; estimate): do small things yourself,
delegate larger work, decide public interfaces and cross-module choices before
delegating (explore first when facts are missing), assign one independently
checkable deliverable per delegation, judge results by the diff and check output
rather than the child's claims, and re-delegate a corrected task (add context,
settle the interface, or split only if too big) with the previous report when
rework is needed.

A worker first checks supplied references and existing code patterns, then stops
and reports `BLOCKED:` only if a required public-interface or cross-module decision
is still unresolved, the task conflicts with the code, or changes are out of scope;
this is a text convention, not parsed by the plugin. Example task package (illustrative):

```text
Goal: expired cache entries return a miss on read; unexpired ones return their value.
Scope: src/cache.ts and test/cache.test.ts only; do not change the storage interface or eviction policy.
Decided: keep get(key) and the injected clock.now(); an entry is expired when now >= expiresAt.
Approach: in get(), compare clock.now() with entry.expiresAt before returning; follow the existing has() check.
Acceptance: tests for a valid entry, one exactly at expiresAt, and one past it.
Check: npm test -- cache.test.ts, exit code 0; report the diff.
```

The status line shows Root and child tokens and cost for the session, and Root's share of each, for example `root 4.17M $3.854 · children(3, 1 failed) 2.82M $0.103 · root share 60% tok · 97% $`. Token counts include cache reads.

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

The builtin `scout` writes an output file (`context.md`) whose content replaces its final message as the explorer report. The explorer task text accounts for this; adding `"output": false` to the `scout` override turns the file off.

## Install

```bash
pi install https://github.com/bioShaun/pi-planner-only       # user-level
pi install https://github.com/bioShaun/pi-planner-only -l    # project-level
pi install /path/to/pi-planner-only                          # local checkout
```

Restart Pi or run `/reload`. Requires pi-subagents `>=0.70 <1`.

## Switches

| Mode | Behavior |
|---|---|
| `off` | This extension is inactive; pi-subagents remains under its own control. |
| `native` | Adds only: 实现和跑测试交给子代理，自己负责拆分、检查 git diff 与测试结果。 Native pi-subagents tools remain under pi-subagents' control. No Lite tools, strict block, handoff, context warning, or cost accounting. |
| `lite` (default) | The delegation tools, prompt, checks, and cost line described above. |

Modes do not select models. Keep the same Root and child model settings when comparing modes.

The mode for a **fresh** session is chosen in this order: nonempty
`PI_PLANNER_ONLY_MODE=off|native|lite`, legacy `PI_PLANNER_ONLY=1|0`,
the saved `~/.pi/agent/planner-only.mode` preference, the legacy
`planner-only.off` marker, then `lite`. An unknown nonempty `MODE` value
fails closed to `off`; an empty value is unset. Legacy `PI_PLANNER_ONLY`
remains a live override when `MODE` is unset. The selected mode is recorded in
the session history; `/reload` and `/resume` keep it, while `/new` selects the
current fresh-session default. Sessions created before this entry existed
should start fresh for reliable mode selection. For a fair A/B comparison,
start a fresh session in each mode. Native's instruction comes from the
extension and does not reproduce an older benchmark's user-message prefix byte for byte.

| Setting | Effect |
|---|---|
| `/planner-only native` / `lite` | Save a preference for the **next fresh session**; do not switch the current session. |
| `/planner-only on` / `off` | Legacy immediate Lite/off switch; update the marker and next-session preference. Refused while a Lite child is in flight or its cwd is held. |
| `/planner-only status` | Show effective mode, next fresh-session mode, saved preference, and Lite session totals when applicable. |
| `PI_PLANNER_ONLY_MODE=off|native|lite` | Choose the mode for new sessions (highest fresh-session priority). |
| `/planner-only handoff [goal]` | Ask Root to write a brief and continue in a fresh session (`handoff drop` discards a failed one). Root self-initiation above the context threshold is allowed only with `PI_PLANNER_ONLY_HANDOFF=confirm` or `auto`. |
| `/planner-only handoff-mode [off|confirm|auto]` | Show or save the handoff mode. Resolution order: nonempty `PI_PLANNER_ONLY_HANDOFF` > `~/.pi/agent/planner-only.handoff` > default `off`; status shows the effective value and source. |
| `PI_PLANNER_ONLY=1` / `0` | Legacy live Lite/off override when `MODE` is unset; overrides saved preference and marker for new sessions. |
| `PI_PLANNER_ONLY_STRICT=1` | Block Root's own `edit`, `write`, and `bash` by name. It does not block write capabilities provided by other plugins, so it is not a security boundary. Off by default, because small tasks are cheaper done directly. |
| `PI_PLANNER_ONLY_TIMEOUT_MS` | Child wall-clock limit passed to the host (default 600000). |
| `PI_PLANNER_ONLY_MAX_TOKENS` | Cancel a child whose reported tokens exceed this (default 1500000). The count is the child's cumulative input+output tokens from its progress events, excluding cache reads. |
| `PI_PLANNER_ONLY_START_TIMEOUT_MS` | Give up if the child has not started (default 30000). |
| `PI_PLANNER_ONLY_CANCEL_GRACE_MS` | Wait for a cancel to be confirmed (default 5000). |
| `PI_PLANNER_ONLY_HANDOFF` | Overrides the persisted `/planner-only handoff-mode` preference when nonempty. Resolution order is env > persisted preference > default `off`. `confirm` allows Root self-initiation above the threshold and puts the brief in the editor; `auto` does the same but submits automatically (experimental; savings not measured, smoke tests only show the flow runs). |
| `PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS` | Root context size that turns the status red and sends Root one message suggesting delegation, a new session, or `/compact` (default 150000). |

In off and native, the extension's four Lite tools are inactive even if called
directly. Native restores only pi-subagents tools that Lite had hidden; it does
not activate tools that the upstream extension did not register or activate.
Child processes (`PI_SUBAGENT_CHILD=1`) never load this extension. Preferences live
in `planner-only.mode` in the user agent directory and apply to new sessions using
that directory; they do not modify `settings.json`, model settings, or install/reload extensions.
New/resumed sessions, forks, and tree navigation are refused while a Lite child
is active or its stop remains unconfirmed. Active `/reload` does not guarantee
lock isolation across plugin instances; finish and confirm child stops before reloading.

## Development

```bash
npm run typecheck
TMPDIR=/path/outside/repo npm test
```

`contract.test.mjs` checks event names, agent names, and the exact request
shape against the installed pi-subagents (`PI_SUBAGENTS_DIR` to override the
location); it skips when pi-subagents is absent.
