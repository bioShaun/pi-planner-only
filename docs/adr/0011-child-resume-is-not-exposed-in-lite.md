# Child resume is not exposed in Lite; recover timeouts by a fresh delegate with the partial report

Status: Proposed 2026-10-01. Facts gathered from the installed pi-subagents and `delegate.ts`; no code changed by this ADR.

A timed-out child currently costs a full re-exploration when Root dispatches a fresh `delegate`. pi-subagents can revive a run, so we considered resuming instead. We choose **not to expose resume in Lite for now**: Root recovers by a fresh `delegate` whose task embeds the previous child's report (or partial output) and what remains to do. Revisit only if upstream adds a resume field to the structured delegation request.

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
- Success measure for revisiting: share of delegations that time out and the tokens spent on the repeat run, taken from real sessions. Without that data, option 3 is not worth an upstream PR.
- Stopped (manually aborted) runs are never resumable under any option.

## Measured data (2026-10-01)

Source: 118 child `*_meta.json` under `~/.pi/agent/sessions/*/subagent-artifacts/` (14 project dirs, from 2026-09-24). `task` is redacted in these files, so a timeout cannot be paired with its repeat; the "next run in the same cwd" below is only a proxy.

- Runs that ended with `exitCode 1`: 10 of 118. Eight were `Subagent timed out` (7 workers at 600 s, 1 oracle at 120 s); one was `upstream_stream_read_error`; one was a manual abort (`Request aborted`).
- Worker timeout rate: 7 of 75 worker runs (9.3%).
- The eight timed-out runs cost $0.73 of $3.20 total (23%), 5.5M tokens, mostly cache reads. Two probe-design workers account for $0.66 of that; the other six are under $0.02 each.
- In 7 of 8 cases the next run in the same cwd was a worker or reviewer that finished (`exitCode 0`) within about 5 to 25 minutes. This does not show how much of the earlier work the repeat re-did.

Reading: timeouts are not rare, but the figure above is the cost of the timed-out run itself, not of the repeat. Resume would only save the repeat's re-exploration, and that is unmeasured. The data does not justify an upstream PR yet, so option 1 stands. If it is revisited, record the first-run and repeat token counts together (for example in the Root handoff) so the repeat share can be computed.
