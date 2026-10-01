# Oversized child tasks time out; the timed-out run is the main cost

Status: wontfix
Type: research

## Problem

In real sessions from 2026-09-24 to 2026-10-01, 8 delegations timed out (7 workers at 600 s, 1 deliberate oracle probe at 120 s). Pairing them with Root's next step (ADR 0011, "Paired from Root session logs") shows that repeats are cheap: only 2 were re-delegated, about $0.17 in total. The real cost is the timed-out runs themselves. Two probe-v2 workers alone cost $0.66:

- `~/.pi/agent/sessions/--public-scripts-tc-probe-design-v2--/2026-10-01T07-33-56-583Z_01a0f662-5ce7-7373-9517-830e31ea91d0.jsonl` line 60 (555k tok, $0.215) and line 115 (1.69M tok, $0.444, 42 turns).
- Same repo, `2026-09-29T07-34-04-588Z_...jsonl` line 28 (2.29M tok, 46 turns).

These look like tasks too large for the 10-minute child limit (ADR 0008), not a missing resume feature.

## Question

Why did these tasks not fit in 10 minutes: too much scope in one deliverable, a slow model (kimi-for-coding), or long e2e checks inside the task? Would the existing Root rule "a child has 10 minutes; split work that needs longer" have caught them?

## Related

- `docs/adr/0011-child-resume-is-not-exposed-in-lite.md` (resume rejected; data source)
- `docs/adr/0008-default-execution-wall-clock-ten-minutes.md`
- `.scratch/root-decomp-trial-20260928/` (task decomposition trials)
- `.scratch/worker-time-20260929/` (worker time analysis)

## Comments

### 2026-10-01 Root: time attribution of the 6 worker timeouts with transcripts

Source: `~/.pi/agent/sessions/<cwd>/subagent-artifacts/<runId>_worker_0_transcript.jsonl`. Tool time is the union of `tool_start`..`tool_end` intervals; the rest of the 600 s is model time (request latency plus generation). The planner run at 2026-09-24T08-54 line 31 has no transcript.

| Run | Date | Model | Turns | Tool s | Model s | s/turn | Cause | At timeout |
|---|---|---|---|---|---|---|---|---|
| D maize 2903d8ec | 09-28 | gpt-6-luna | 7 | 533 | 67 | ~10 | LONG-CHECK: one 480 s bash waiting on BLAST jobs | jobs still running; repeat only collated |
| E maize 52bf2b7b | 09-28 | gpt-6-luna | 19 | 352 | 248 | ~13 | LONG-CHECK: three ~110-124 s rebuilds in a fix-rebuild loop | patching and rebuilding again |
| C probe 08a83dbb | 09-29 | gpt-6-luna | 46 | 33 | 567 | ~12 | SCOPE: TDD plus implementation in one task | running final mypy/pytest/diff; nearly done |
| F planner 53225e23 | 09-24 | mimo-v2.6-flash:high | 7 | 1 | 599 | ~85 | SLOW-MODEL: 21k output tokens over 7 turns | still exploring git behaviour |
| B probe fa497991 | 10-01 | kimi-for-coding | 19 | 13 | 587 | ~31 | open-ended diagnosis, 7 of 30 tool calls errored | had just got first measurements from its CDP script |
| A probe 5a7ee503 | 10-01 | kimi-for-coding | 42 | 56 | 544 | ~13 | SCOPE: building a print-lifecycle harness from scratch | still editing `lifecycle.py` |

Findings:

- D and E (long commands inside the child) predate `d186304` (2026-09-30), which added the delegate description rule "runs that outlast the child time limit take two delegations". No long-check timeout has happened since.
- F used a model/thinking setting that is no longer the worker default.
- A, B and C spent over 90% of their wall time on model turns, not tools. At about 12-30 s per turn a child gets roughly 20-45 turns, and open-ended harness or diagnosis work needed more. B's repeat (Root line 101) finished once Root passed on the diag tool B had built, so the existing re-delegate rule worked.
- The high probe-v2 cost is mostly the kimi-for-coding price, not the timeouts: completed kimi worker runs in the same session cost $0.268 (line 46) and $0.158 (line 103), against about $0.01-0.02 for comparable gpt-6-luna runs.

Decision: wontfix in this repo. The long-check pattern is already covered by the prompt, the remaining cases are ordinary task sizing that the existing "split work that needs longer" rule addresses, and the Root prompt has no room for more wording (ADR 0011). Choosing kimi-for-coding as the probe-v2 worker model is a user setting outside this repo.

### 2026-10-01 User decision

Keep kimi-for-coding as the probe-v2 worker model: the quota expires soon, so its per-run price is not a reason to switch now. Revisit the model choice after the quota expires.
