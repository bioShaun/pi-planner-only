# Child resume is not exposed in Lite; recover timeouts by a fresh delegate with the partial report

Status: Accepted 2026-10-01. Facts gathered from the installed pi-subagents and `delegate.ts`; no code changed by this ADR.

A timed-out child currently costs a full re-exploration when Root dispatches a fresh `delegate`. pi-subagents can revive a run, so we considered resuming instead. We choose **not to expose resume in Lite for now**: Root recovers by a fresh `delegate` whose task embeds the previous child's report (or partial output) and what remains to do. Revisit only if upstream adds a resume field to the structured delegation request.

The two parts of this decision rest on different grounds. Option 2 is rejected on safety (it bypasses the cwd lock, Root-stamped identity and git summary); new cost data does not change that. Only option 3 waits on data, and the data below does not support it.

## Facts

- The structured request accepts only `requestId, ownerRunId, nodeId, agent, task, context, cwd, model, thinking, timeoutMs, toolBudget, skill, artifacts, intercomBridge, result`; any other key is rejected, and there is no `runId` or `resume` field (`pi-subagents/src/slash/delegation-request.js:4-23`). `delegate.ts` always sends `context: "fresh"` (`delegate.ts:522-532`).
- The response carries `runId` and a status in `completed | failed | timed_out | cancelled | interrupted | tool_budget_exhausted | ...` (`delegation-adapters.js:212-284`).
- Resume exists only as `subagent({action: "resume", id, message})` (`subagent-executor.js:1494-1579`) and in workflow scripts. Revival accepts terminal run states `complete | completed | failed | paused`; `stopped` is rejected (`async-resume.js:498-595`). `timed_out` is not itself an eligibility state: it is resumable only if the run ended up `failed` or `paused`.
- Lite hides `subagent` and `subagents_enable` and blocks calls to them (`index.ts:34-38`, `index.ts:338-356`).

## Options

1. **Fresh delegate with the partial report (chosen).** No code change; keeps the single dispatch path, so the lock, token cap, wall clock and git summary stay authoritative. Cost: the new child re-reads files, but not the conclusions already reached.
2. **Unhide `subagent` for `action: "resume"` only.** Rejected for now: a resumed run bypasses `createCwdLocks`, the Root-stamped identity and the `delegate` git summary, so a resumed worker could mutate a repo that another child holds. It would also make eligibility depend on run internals Root cannot see.
3. **Upstream field (`resume: <runId>`) on the structured request.** Preferred long-term, since `delegate` could then keep lock and summary ownership. Needs a pi-subagents change; no commitment here.

## Consequences

- Root's handoff for a timed-out child must include the child's report or last progress and an explicit "what is left" list. The Root prompt already carries this rule (`index.ts:99`: re-delegate with the child's report or last tool results, add context); it has 4 characters of headroom under the 1,500-character cap in `index.test.mjs:131`, so "say what is left to do" is not added there. Do not build tooling yet.
- Success measure for revisiting option 3: share of delegations that time out and the tokens spent on the repeat run. This is measured offline from Root session logs (see below); no extra recording in `delegate.ts` or the prompt is needed.
- Stopped (manually aborted) runs are never resumable under any option.

## Measured data (2026-10-01)

Source: 118 child `*_meta.json` under `~/.pi/agent/sessions/*/subagent-artifacts/` (14 project dirs, from 2026-09-24). `task` is redacted in these files, so a timeout cannot be paired with its repeat; the "next run in the same cwd" below is only a proxy.

- Runs that ended with `exitCode 1`: 10 of 118. Eight were `Subagent timed out` (7 workers at 600 s, 1 oracle at 120 s); one was `upstream_stream_read_error`; one was a manual abort (`Request aborted`).
- Worker timeout rate: 7 of 75 worker runs (9.3%).
- The eight timed-out runs cost $0.73 of $3.20 total (23%), 5.5M tokens, mostly cache reads. Two probe-design workers account for $0.66 of that; the other six are under $0.02 each.
- In 7 of 8 cases the next run in the same cwd was a worker or reviewer that finished (`exitCode 0`) within about 5 to 25 minutes. This does not show how much of the earlier work the repeat re-did.

Reading: timeouts are not rare, but the figure above is the cost of the timed-out run itself, not of the repeat.

### Paired from Root session logs (2026-10-01)

Root's own session files (`~/.pi/agent/sessions/<cwd>/<ts>.jsonl`, top level only) keep the full `delegate` task and the result line (status, tokens, cost, run id), so a timeout can be paired with what Root did next. All 8 timeouts:

| Session | Line | First run | What Root did next |
|---|---|---|---|
| maize 2026-09-28T06-08 | 64 | 143k tok, $0.005 | Re-delegated (line 67): 621k tok, $0.012, completed in 188 s |
| maize 2026-09-28T07-36 | 93 | 538k tok, $0.014 | No re-delegation; moved on to the HTML report (line 123) |
| planner 2026-09-24T08-54 | 31 | 163k tok, $0.006 | No re-delegation; reviewer checked the partial change (line 66) |
| planner 2026-09-24T10-17 | 7 | 6.7k tok, $0 | Deliberate timeout probe (sleep loop); not a real task |
| planner 2026-09-24T13-52 | 121 | 98k tok, $0.010 | No re-delegation; reviewer checked the partial change (line 165) |
| probe-v2 2026-09-29T07-34 | 28 | 2.29M tok, $0.035 | No later delegate in that session |
| probe-v2 2026-10-01T07-33 | 60 | 555k tok, $0.215 | Re-delegated (line 101): 423k tok, $0.158, completed in 417 s |
| probe-v2 2026-10-01T07-33 | 115 | 1.69M tok, $0.444 | No re-delegation; reviewer checked the partial change (line 167) |

- Only 2 of 8 timeouts were re-delegated. Together the repeats cost about 1.04M tokens and $0.17, and both also did new work (the maize repeat collated and re-ran selection after the first run had only launched BLAST). Re-exploration is a fraction of that $0.17, so resume would save cents per week.
- Both re-delegation tasks already stated the current state and the remaining steps (line 67: `State: 8/8 refill BLAST jobs finished` plus steps; line 101: "剩余验收项" plus the tools already built). The existing prompt rule is enough; no wording was added.
- The cost driver is the timed-out runs themselves (probe-v2 lines 60 and 115: $0.66), i.e. tasks too large for the 10-minute limit. That is a task-sizing question, tracked in `.scratch/child-timeout-20261001/`, not a resume question.

Conclusion: option 1 stands and option 3 is not worth an upstream PR. Re-pair the logs the same way if timeouts or repeat costs grow.
