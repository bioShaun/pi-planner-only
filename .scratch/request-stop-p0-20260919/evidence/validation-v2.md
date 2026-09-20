PASS

Validation window: 2026-09-20T00:08:07.229768645+08:00 through 2026-09-20T00:08:28.449088437+08:00. Root supplied the sole write/execute window. Target cwd was `/home/tcuni-claw/pi/pi-planner-only`; the existing task and evidence directories were the only authorized parents. This host-only probe was expected under 10 seconds with no network, subprocess, heavy memory, or `/data_0` I/O, so slot preflight was not applicable. No child-spawning tests were run.

## Required commands and results

1. `sha256sum -c .scratch/request-stop-p0-20260919/evidence/pre-validation-v2.sha256`
   Exit 0. All eight scoped files reported `OK`.
2. `node .scratch/request-stop-p0-20260919/host-probe.mjs > .scratch/request-stop-p0-20260919/evidence/validated-host-v2.log 2>&1`
   Exit 0. The output identifies global host SDK 0.85.1 and run directory `host-run-h7zX1r`.

Parsed `results.json` assertions:

| Mode | `afterFirst` | `finalCalls` | Blocked executes | Allowed executes | Inputs | Final event |
|---|---:|---:|---:|---:|---|---|
| `plain` | 1 | 3 | 0 | 0 | interactive, extension, interactive | `agent_settled` |
| `abort-queued` | 2 | 4 | 0 | 0 | interactive, extension, interactive | `agent_settled` |
| `clear-abort-queued` | 1 | 3 | 0 | 0 | interactive, extension, interactive | `agent_settled` |
| `terminate` | 1 | 3 | 0 | 0 | interactive, extension, interactive | `agent_settled` |
| `terminate-queued` | 2 | 4 | 0 | 0 | interactive, extension, interactive | `agent_settled` |
| `terminate-mixed` | 2 | 4 | 0 | 1 | interactive, extension, interactive | `agent_settled` |

Every mode contains three `agent_settled` events and finishes on `agent_settled`. The probe conclusion is: `ctx.abort alone permits queued continuation; terminate stops an all-blocked batch but not queued or mixed continuation; clearQueue exists only on session API.`

## Inspection and hashes

All support commands exited 0: `pwd && date -Ins && git status --short -- .scratch/request-stop-p0-20260919`; `sed -n '1,200p' .scratch/request-stop-p0-20260919/evidence/pre-validation-v2.sha256`; `sed -n '1,320p' .scratch/request-stop-p0-20260919/evidence/validated-host-v2.log`; `find .scratch/request-stop-p0-20260919 -maxdepth 2 -type f -printf '%T@ %p\\n' | sort -nr | head -20`; the two `jq` summaries of `host-run-h7zX1r/results.json`; `rg -n "terminate|tool-execute|afterFirst|finalCalls|inputs|agent_settled|assert" .scratch/request-stop-p0-20260919/host-probe.mjs`; and `date -Ins`.

The final hash command was `sha256sum index.ts delegate.ts task.ts review.ts orchestrate.ts .scratch/request-stop-p0-20260919/host-probe.mjs .scratch/request-stop-p0-20260919/revalidation-probe.mjs .scratch/request-stop-p0-20260919/audit-models.py` (exit 0). Its output is preserved in `post-validation-v2.sha256` and matches `pre-validation-v2.sha256` for all eight scoped files.

## Mutations, limits, and release

New writes were limited to `evidence/validated-host-v2.log`, generated `host-run-h7zX1r/`, `evidence/post-validation-v2.sha256`, and this `evidence/validation-v2.md`. No source, probes, docs, unchanged revalidation/model evidence, dependency configuration, or external data were modified.

This validates the six-scenario faux-model/custom-resource host probe against the actual global SDK 0.85.1. It does not load the planner plugin, real launcher, model/network path, child process, or interactive TUI, and it does not rerun or extend the unchanged revalidation/model probes. Writer stopped after recording the required evidence; the exclusive window is released.
