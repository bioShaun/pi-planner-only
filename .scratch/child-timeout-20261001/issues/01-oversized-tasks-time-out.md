# Oversized child tasks time out; the timed-out run is the main cost

Status: needs-triage
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
