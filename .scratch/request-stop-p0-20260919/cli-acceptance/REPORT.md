# Ticket 05 — real CLI + pi-subagents 0.69.0 acceptance (2026-09-20)

Run from a normal terminal shell (Claude Code Bash, not the sandboxed agent executor that returned EPERM on 2026-09-18). Both runs went through `slot cpu`; `slot audit` and `slot status` are recorded in each run directory. Driver: [`run-cli.mjs`](run-cli.mjs). Passive observer: [`probe-events.ts`](probe-events.ts) (subscribes to the five delegation-contract events and public host hooks, returns nothing, changes nothing).

## Fixed versions

| Item | Value |
|---|---|
| Host binary | `/home/tcuni-claw/.nvm/versions/node/v24.14.0/bin/pi`, `pi --version` 0.85.1 (global `@earendil-works/pi-coding-agent` 0.85.1) |
| Local peer in repo `node_modules` | 0.84.4 (dev dependency; not the binary that ran) |
| Launcher | `~/.pi/agent/npm/node_modules/pi-subagents` **0.69.0** (`index.ts` sha256 in each `versions.json`) |
| Plugin | working tree at HEAD `3991c5c` plus the uncommitted P0 change set; per-file sha256 in `versions.json` and the review-r4 freeze |
| Root model | `tcuni-luna/gpt-5.6-luna` (natural: default thinking; deadline: `--thinking low`) |
| Child model | same provider/model, launcher-resolved: `tcuni-luna/gpt-5.6-luna` (natural), `tcuni-luna/gpt-5.6-luna:high` (deadline worker). No explorer/worker model routing exists in this plugin; nothing was configured under `subagents.agentOverrides`. |
| Mode | `pi -p --mode json --no-extensions -e <launcher> -e <plugin> -e <observer>`; isolated `PI_CODING_AGENT_DIR`; temp root under `/project/tmp` |

Run directories: `cli-run-natural-2026-09-20T01-27-49-699Z/` and `cli-run-deadline-2026-09-20T01-27-49-699Z/` (each holds `versions.json`, `command.txt`, `prompt.txt`, `env-knobs.json`, `events.jsonl`, `stdout.jsonl`, `stderr.txt`, `exit.json`, `request-state.json`, `ledger.json`, `usage.jsonl`, `summary.json`, the isolated `agent/` dir with session files and subagent artifacts, and the `workspace/`).

## Scenario `natural` — representative task, default limits, no knobs

Prompt: "Read fixture.txt in the current workspace and report its word count. Make no changes." No `PI_PLANNER_ONLY_REQUEST_*` variable set (limits recorded from the request record: 32 / 8 / 3 / 2 / 900000 ms).

| Observation | Value |
|---|---|
| pi exit | 0, no signal, 50.5 s |
| Final answer | "…contains **10 words**. No files were changed." (correct; workspace unchanged) |
| Request | open at exit (`closedReason` null), `rootStop` not-requested, settled true |
| Budget used | tool attempts 5/32, child claims 2/8, repairs 0/2, provider request hooks observed 6 |
| Failure families | `contract:read:ceiling` 1, `policy:read` 1 (Root's own read attempts refused by existing policy), `budget` 1 (first child hit the Root-chosen envelope; resolved by the successful redelegation) |
| Transport | 2 REQUEST, 2 terminal, 1 CANCEL. First child (`planner-scout`) cancelled by the existing worker-runaway controller at +4.6 s (envelope too small, same pattern as the 0.8.0 Scenario A record); second child completed at +13.6 s. Every REQUEST has a matching terminal by `requestId`; every claim has `emittedAt` and `terminalAt`, `stop: confirmed`, `waitSettled: true`. |
| Child usage (launcher terminal) | child 1: input 7955 / output 92, 2 turns; child 2: input 8825 / output 514 / cacheRead 15360, 3 turns |
| Ledger | `T-20260920-001` completed after 2 executions; usage rows carry the real child model |
| Host | `agent_settled` observed, `session_shutdown` reason `quit` |

Conclusion: a representative read-only task fits comfortably inside the approved defaults; nothing suggests raising them. The Root-chosen undersized envelope is pre-existing behaviour, not P0.

## Scenario `deadline` — environment-forced closure on the real launcher

Prompt (instruction-style): delegate a worker that runs `sleep 90` and then writes `done.txt`; verdict pass afterwards. Forcing knob: `PI_PLANNER_ONLY_REQUEST_ACTIVE_MS=45000`. This is programmatic forcing of one limit; the Root model, the launcher, the child and its shell command are real. It is recorded separately from the natural-language run above and from the faux-provider SDK probes.

| Observation | Value |
|---|---|
| pi exit | 0, no signal, 50.6 s |
| Timeline (s from session start) | 0.0 provider request; 8.0 `planner_delegate`; 8.2 REQUEST emitted; **45.0 CANCEL emitted; 45.0 terminal `cancelled` received (24 ms later)**; 45.4 `tool_result` returned to Root; 45.4 `agent_settled`; 45.4 `session_shutdown` quit |
| Request | `closedReason: active-time-limit`, `rootStop: confirmed`, settled true |
| After closure | model calls 0, tool calls 0, REQUEST 0 |
| Claim | committed 41 ms before REQUEST; `emittedAt` and `terminalAt` set; `stop: confirmed`; `waitSettled: true` |
| Child usage (launcher terminal) | input 8932 / output 151, 2 turns, 1 tool call, 36.8 s |
| Ledger | Task blocked, execution outcome failed (cancelled) |
| Workspace | `done.txt` never created (only `hello.txt`) |

Conclusion: on the real 0.69.0 transport, closure is persisted, CANCEL reaches the child, the child's terminal correlates to the same `requestId`, and Root makes no further model call, tool call or REQUEST in print mode. Root stop is confirmed by `agent_settled`.

## What this does and does not prove

- Proves for `pi -p` (print mode) with pi-subagents 0.69.0: request/terminal correlation, CANCEL delivery, usage on the terminal, model identity of Root and children, and — for the forced deadline — full Root stop after closure (no model/child/continuation).
- Does **not** cover the interactive TUI (no TTY in this terminal; unverified, and a replica binding would not count). The SDK probe (`request-host-run-mZtnv0`) remains the only evidence about queued continuation after closure, where one extra model call was observed; print mode here had no queued message.
- Does not establish cost figures; usage numbers are recorded, not priced.
