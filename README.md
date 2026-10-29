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
| `delegate({role, task, cwd?, timeoutSeconds?, base?})` | Run one child agent and wait. Returns the child's text report, host status, model and usage, and a Git summary of what changed (new commits, diff stat, untracked files). |
| `git_audit({operation, base?, path?, maxEntries?})` | Read-only `status` / `diff-stat` / `diff` / `log`, with fixed argv. |
| `git_commit({message, paths?})` | Stage and commit accepted work. Never pushes. |

For a committed review, pass `base` with role `reviewer` to include the complete `base...HEAD` text diff, up to 32 KiB. Each changed blob must be at most 1 MiB to inspect. The repository must have commits and a clean worktree; empty, binary, non-UTF-8, and submodule changes are refused. The range commits are fixed, but source files remain a live checkout and concurrent changes cannot be ruled out. Without `base`, delegation behaves as before.

Roles map to pi-subagents builtin agents and this package's validator agent:

| Role | Agent | cwd lock |
|---|---|---|
| `worker` | `worker` | exclusive (alone) |
| `explorer` | `scout` | shared (other explorers) |
| `validator` | `planner-validator` (package) | exclusive (alone) |
| `reviewer` | `reviewer` | none (read-only) |

worker and validator run alone per repository; explorers can run together but
not alongside a worker or validator; a reviewer or another repository can run
alongside. If a stop cannot be confirmed, the directory stays held until the
late terminal arrives.

The optional `timeoutSeconds` parameter (integer 1..86400, e.g. `120` for quick tasks, `900` for 15-minute heavier implementations) sets the child's wall-clock limit for that single delegation only. When omitted, it defaults to the environment value `PI_PLANNER_ONLY_TIMEOUT_MS` (in milliseconds; default 600000 = 10 minutes). It does not change the global default or subsequent calls, and other limits (`PI_PLANNER_ONLY_MAX_TOKENS`, start timeout, cancel grace) remain unchanged.

Root also gets a short prompt (under 1,500 characters, roughly 375 tokens): do small things yourself,
delegate larger work, decide scope, public interfaces, and cross-module approach before
delegating (send an explorer first only when unknown facts could change those decisions or the split), assign one independently
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

### Root prompt cache while waiting for children

While Native Root waits asynchronously for children, its prompt cache can expire. In local measurements, every Anthropic Claude Root turn awakened by a child notification after at least 5 minutes was a cold start that rewrote the entire prefix; models using an OpenAI responses-type provider mostly retained cache hits after 5-60 minutes. The Claude sample was small.

`PI_CACHE_RETENTION=long` is a pi process environment variable, not a setting applied by this plugin. It extends Anthropic cache retention to 1 hour (24 hours for direct OpenAI), but Anthropic cache writes rise from 1.25x to 2x the base price. Children launched from that environment usually inherit it too.

Long retention may be worthwhile when Root uses Claude and often waits asynchronously for children for more than 5 minutes. When most turns are consecutive and closely spaced, it increases total cache costs. Decide based on your own usage; it is not enabled by default.

From a checkout of this repository, run `python3 bench/root_cache.py <sessions-dir>` to inspect cache hit rates and cold starts by provider in your own sessions (bench/ is not part of the installed package).

## Models

Child models come from your pi-subagents settings, not from this plugin.
Configure `subagents.agentOverrides` in `~/.pi/agent/settings.json`:

```json
{
  "subagents": {
    "agentOverrides": {
      "worker":   { "model": "provider/cheap-model", "thinking": "medium" },
      "scout":    { "model": "provider/cheap-model", "thinking": "low" },
      "planner-validator": { "model": "provider/mid-model", "thinking": "medium" },
      "reviewer": { "model": "provider/mid-model",   "thinking": "high" }
    }
  }
}
```

The delegate result names the model the host actually ran.

Move or copy any existing `oracle` tuning intended for Lite validation deliberately to `planner-validator`. The `oracle` override now affects oracle/advisor consultations only; it is not a fallback for Lite validation. Without a `planner-validator` model override, the agent inherits `subagents.defaultModel`, or the parent model when that is absent. Checks may create test or build artifacts; the validator is not an OS sandbox.

The builtin `scout` writes an output file (`context.md`) whose content replaces its final message as the explorer report. The explorer task text accounts for this; adding `"output": false` to the `scout` override turns the file off.

## Install

```bash
pi install https://github.com/bioShaun/pi-planner-only       # user-level
pi install https://github.com/bioShaun/pi-planner-only -l    # project-level
pi install /path/to/pi-planner-only                          # local checkout
```

Restart Pi or run `/reload`. Requires Pi **1.4.0**, Node **>=22.19.0**, and
pi-subagents `>=0.70 <1`. The host and development dependency are pinned to the
same verified version; other host versions are not currently declared supported.

## Switches

| Mode | Behavior |
|---|---|
| `off` | This extension is inactive; pi-subagents remains under its own control. |
| `native` | Prefers delegating implementation and tests while Root splits work and checks diffs and results. Root may complete both changes and necessary verification when it already has the context, the remaining work is clear and local, and no further investigation, test design, or independent review is needed; otherwise it continues delegating. Native pi-subagents tools remain under pi-subagents' control. Shows observational usage and shares context warnings and handoff, without Lite delegation or Git tools or strict blocking. |
| `lite` (default) | The delegation tools, prompt, checks, and cost line described above. |

Native child usage is a recorded lower bound from pi-subagents' current-session cost RPC, not a complete total: missing or incomplete workflow receipts and unavailable metadata can omit usage. An unavailable RPC is shown as unavailable. Root usage is counted from observed turns and resets on session start or reload; child snapshots can recover recorded usage from the current session branch and available artifacts. Context warnings and color use the same threshold as Lite.

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
| `/planner-only status` | Show effective mode, next fresh-session mode, saved preference, Lite session totals, and current loaded session per-role diagnostics (`calls`, completed runtime terminals, timed_out, incomplete, refused, cumulative duration including concurrent overlap). Role statistics are in-memory diagnostics for the active session only; they reset on `/new` and are not restored across `/reload`. |
| `PI_PLANNER_ONLY_MODE=off|native|lite` | Choose the mode for new sessions (highest fresh-session priority). |
| `/planner-only handoff [goal]` | Ask Root to write a brief and continue in a fresh session, automatically submitting even in confirm mode. Retry a failed delivery, discard it with `handoff drop`, or let Root replace it with a new brief. Root self-initiation above the context threshold follows the effective handoff mode (`confirm` or `auto`). Resolution order: nonempty `PI_PLANNER_ONLY_HANDOFF` > `~/.pi/agent/planner-only.handoff` > default `off`. |
| `/planner-only handoff-mode [off|confirm|auto]` | Show or save the handoff mode. Resolution order: nonempty `PI_PLANNER_ONLY_HANDOFF` > `~/.pi/agent/planner-only.handoff` > default `off`; status shows the effective value and source. |
| `PI_PLANNER_ONLY=1` / `0` | Legacy live Lite/off override when `MODE` is unset; overrides saved preference and marker for new sessions. |
| `PI_PLANNER_ONLY_STRICT=1` | Block Root's own `edit`, `write`, and `bash` by name. It does not block write capabilities provided by other plugins, so it is not a security boundary. Off by default, because small tasks are cheaper done directly. |
| `PI_PLANNER_ONLY_TIMEOUT_MS` | Child wall-clock limit passed to the host (default 600000). |
| `PI_PLANNER_ONLY_MAX_TOKENS` | Cancel a child whose reported tokens exceed this (default 1500000). The count is the child's cumulative input+output tokens from its progress events, excluding cache reads. |
| `PI_PLANNER_ONLY_START_TIMEOUT_MS` | Give up if the child has not started (default 30000). |
| `PI_PLANNER_ONLY_CANCEL_GRACE_MS` | Wait for a cancel to be confirmed (default 5000). |
| `PI_PLANNER_ONLY_HANDOFF` | Overrides the persisted `/planner-only handoff-mode` preference when nonempty. Resolution order is env > persisted preference > default `off`. `confirm` allows Root self-initiation above the threshold and puts its brief in the editor; user-initiated handoffs submit automatically. `auto` also submits Root handoffs automatically (experimental; savings not measured, smoke tests only show the flow runs). |
| `PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS` | Root context size at which the status reaches red and Root gets one message suggesting delegation, a new session, or `/compact` (default 150000). The status heats up with the context: the theme accent when empty, the warning color at half the threshold, red at the threshold. |

In off, all four tools are inactive even if called directly. Native enables only
`handoff` from this extension; the Lite delegation and Git tools remain inactive.
Native restores only pi-subagents tools that Lite had hidden; it does
not activate tools that the upstream extension did not register or activate.
Child processes (`PI_SUBAGENT_CHILD=1`) never load this extension. Preferences live
in `planner-only.mode` in the user agent directory and apply to new sessions using
that directory; they do not modify `settings.json`, model settings, or install/reload extensions.
New/resumed sessions, forks, and tree navigation are refused while a Lite child
is active or its stop remains unconfirmed. Active `/reload` does not guarantee
lock isolation across plugin instances; finish and confirm child stops before reloading.

Native handoff queries pi-subagents status both when the brief is scheduled and
immediately before switching. Active or uncertain status at scheduling rejects
the brief without retaining it; on a replacement, neither brief is retained.
At dispatch it retains the brief for manual retry, `handoff drop`, or replacement
by Root's next handoff call; it does not cancel work. This is best effort,
not an atomic barrier: a scheduled job can start between the final check and
session replacement. In one isolated Pi 1.4.0 / pi-subagents 0.83.0 RPC probe,
a detached single run continued after replacement and its completion notification
reached the new session; a running workflow stopped with `runtime-replaced` while
its child continued. One active run remained visible across reload, which does not
prove all restoration timings are safe. User-initiated `/new` is unchanged.

The verified host is Pi 1.4.0; other host versions are not declared supported.

## Development

```bash
npm run typecheck
TMPDIR=/path/outside/repo npm test
```

`contract.test.mjs` checks event names, agent names, and the exact request
shape against the installed pi-subagents (`PI_SUBAGENTS_DIR` to override the
location); it skips when pi-subagents is absent.

First run `npm ci` in the root project to install its development dependencies.
With an existing directory outside the repository as `TMPDIR`,
`TMPDIR=/path/outside/repo npm run test:release:isolated` installs the locked
registry fixture (pi-subagents 0.83.0 and pi-ai 1.4.0) in a fresh temporary
directory, checks its source, runs `test:release`, and removes that directory on
normal completion or reported failure. Cleanup after interruption is not guaranteed.
This checks the fixed versions; `npm run test:release` continues to check the
locally installed pi-subagents instead. Installation requires registry access.
