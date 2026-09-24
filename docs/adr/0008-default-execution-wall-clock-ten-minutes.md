# ADR-0008: Default execution wall clock is ten minutes; heavy workers get a full explicit envelope

Status: Accepted (operational default; no claim of an empirically optimal threshold)
Lite (2026-09-24): the ten-minute default is kept (`PI_PLANNER_ONLY_TIMEOUT_MS`, sent to the host as `timeoutMs`); the explicit heavy-worker envelope is gone.
Date: 2026-09-20

## Context

P1-A gave every ordinary worker, explorer, and validator execution a finite default envelope when the caller omits one: `maxTokens=100000`, `maxWallMs=300000`. The five-minute wall clock was a placeholder awaiting P3 calibration. Before shipping it we looked at this machine's history:

| Source | Observation |
|---|---|
| `~/.pi/agent/run-history.jsonl`, 61 worker runs | p50 1.0 min, p90 4.1 min, max 30 min. Under 5 min: 55/61 (90.2%). Under 10 min: 56/61 (91.8%). The remaining 5 runs are all over 10 min. |
| `~/.pi/agent/planner-only/usage.jsonl`, 72 unique worker children | input+output p90 78k tokens, max 128k; 1 child over 100k |
| `request-control.ts` | the Request deadline is first activity + 15 minutes; it closes the Request and cancels every child in it, regardless of any execution envelope |

Limits of this evidence:

- The run-history rows are launcher-wide, not planner-only launches (run ids do not join the usage rows), and nothing shows whether the long runs were legitimate work or stuck children. They are an order-of-magnitude reference only.
- Five versus ten minutes is not distinguished by this sample: ten minutes covers exactly one more run. Any argument that ten minutes lowers recovery cost is not supported by the data.
- The TaskExecutionRecord carries `endedAt` and `cancelRequestedAt` but no launch time and no defined duration basis, so the plugin cannot yet measure its own child wall time.

What a breach costs: the child is cancelled, its result is not admitted, the Task is flagged `recovery.required`, and Root spends a round on a recovery decision. Workspace modifications are not discarded; residual changes stay and are handled through `worktreeDecision` (`keep` or `manual`). What a longer default costs: a silently hung child is noticed later. A child that burns tokens in a loop is caught by the token bound regardless of the wall clock.

## Decision

1. `DEFAULT_EXECUTION_MAX_WALL_MS` stays `600000` (ten minutes) as the accepted operational default. The P3 small-task comparison does not distinguish five from ten minutes, so it supplies no reason to change the configured value. The rationale remains qualitative, not statistical: with the token bound in place, the wall clock mainly catches silent hangs, where a later cancel costs wall time only, while a false cancel costs a recovery round of Root tokens. This remains an assumption to verify, not a measured saving or a statistically calibrated optimum. Acceptance finalizes the current policy choice, not the calibration claim.
2. `DEFAULT_EXECUTION_MAX_TOKENS` stays `100000`. It is measured on the same input+output snapshot as the usage rows, where one child in 72 exceeded it, and it is the bound that catches a looping child cheaply.
3. **An explicit envelope replaces the defaults entirely** (`delegate.ts`, the `validateEnvelope(...) ?? defaults` expression). Therefore the recommended envelope for a heavy coding worker carries **both** fields, for example `{ maxTokens: 150000, maxWallMs: 720000 }`. Passing `{ maxWallMs }` alone silently drops the token bound and is not recommended. Letting an omitted dimension inherit the default would be a separate semantic change with its own `source` labelling; it is not decided here.
4. **The wall clock must be sized to the Request's remaining time, not to the 15-minute constant.** The deadline runs from the Request's first activity, so a worker delegated after 7 minutes of exploration has about 8 minutes left whatever its envelope says, and validation and review still have to fit before the deadline. Today the plugin does not expose remaining Request time to Root; until it does, Root must estimate it from elapsed activity and leave a reserve.
5. The operator environment variables remain the machine-wide override but are not the recommended way to accommodate long tasks: they apply to every role and project and are easy to forget per shell.

## Considered options

- **Keep five minutes.** Not chosen, but not refuted by the data either: the sample covers one fewer run. It remains a valid fallback if calibration shows ten minutes only delays detection of hangs.
- **No default (observe only).** Rejected: this is the pre-P1 behaviour that let runaway children run to the Request deadline.
- **Align the default with the Request deadline.** Rejected: the per-execution envelope would then never fire before the Request, and a stuck child would cost the whole window.
- **Raise the token default as well.** Rejected: no pressure at 100k in the data, and the token bound is the cheap loop detector.

## Consequences

- Executions that omit an envelope persist `{ maxTokens: 100000, maxWallMs: 600000, source: "default" }`; `p1-delegation.test.mjs` and `delegate.test.mjs` assert this.
- README, README.zh-CN, CONTEXT.md, the `envelope` parameter description, and both delegation tools' prompt guidelines state the default, the both-fields rule, and the remaining-time rule.
- Separate empirical calibration and observability follow-ups (tracked in `.scratch/stability-next-20260920/issues/07-execution-duration-and-request-remaining.md`):
  - Record a launch timestamp on the TaskExecutionRecord and define the duration basis (launcher wait, excluding pre-launch evidence sampling) so calibration uses the plugin's own data.
  - Expose the Request's remaining time to Root at delegation time, or clamp an explicit `maxWallMs` to it with a warning, so the sizing rule in point 4 does not depend on Root arithmetic.
  - Calibrate on three figures together, not on timeout counts alone: the default-breach rate, Root tokens spent on recovery rounds, and the completion rate of whole Requests. Extending the wall clock is only justified if the second and third improve without the first merely moving later.


## P3 decision closure (2026-09-20)

The controlled comparison uses Gemini Root / Luna child, low, three small tasks and three repetitions per arm. All measured child durations are below five minutes. Five-minute and ten-minute defaults therefore predict the same outcome for these observations; the study cannot estimate false cancels, long-task recovery cost or a better threshold. Exact runs, timing bases and final-version provenance are in `.scratch/stability-next-20260920/execution-20260920/closeout.md` and the linked study summary.

Keep ten minutes and 100,000 tokens as the operational defaults, preserving the explicit-envelope replacement rule and the enclosing Request deadline. Do not infer token savings, a causal benefit of P1, or permission to relax Root's reading policy from these small tasks. Launch timestamps, Request remaining-time visibility and representative long-task calibration remain the separate work in issue 07; none is silently approximated here.
