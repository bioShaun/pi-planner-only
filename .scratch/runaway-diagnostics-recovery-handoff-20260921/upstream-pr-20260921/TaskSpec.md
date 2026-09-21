# TaskSpec: cumulative usage on structured delegation UPDATE (upstream pi-subagents)

Working copy: `/project/tmp/pi-subagents-runtime-agent-settings`, branch `delegation-update-cumulative-usage`
(based on GitHub `upstream/main`; do not switch branches, do not touch `~/.pi/agent/git/github.com/nicobailon/pi-subagents`).
Proposal (authoritative design): `/home/tcuni-claw/pi/pi-planner-only/.scratch/runaway-diagnostics-recovery-handoff-20260921/UPSTREAM-PROPOSAL.md`.
Read `AGENTS.md` and `VISION.md` in the working copy first; the change must fit VISION.md's acceptance policy.

## Change

Add an optional cumulative per-attempt usage snapshot to the structured delegation UPDATE:

```ts
usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; turns: number };
```

- `src/api/delegation.ts`: extend `SubagentDelegationUpdate` with the optional field above, documented: all counters describe the same attempt at the same observation time, finite non-negative; missing means unavailable, not zero; `tokens` keeps its meaning (input + output); UPDATE does not promise final billed usage or cost, the terminal response stays authoritative.
- `src/shared/types.ts` + `src/runs/foreground/execution.ts`: the progress object already carries `tokens`, `inputTokens`, `outputTokens`, `turnCount` (see execution.ts around lines 1055-1072 and 1300-1304, where `result.usage` is accumulated from assistant messages). Make cumulative `cacheRead`/`cacheWrite` available on the same progress shape alongside input/output/turns. Emit a copied snapshot (new object per update) so later mutation of `result.usage` cannot change an already emitted payload. Note `window = input + cacheRead` at line 1064 is a per-message context window and must NOT be projected as cumulative usage.
- `src/slash/delegation-adapters.ts`: extend the two progress bridge shapes that carry `tokens` (lines ~40 and ~54, and the `progressSummary` at ~95/110) and project `usage` in `toSubagentDelegationUpdate` only when all five counters are finite non-negative numbers.
- `src/slash/prompt-template-bridge.ts`: `sameStructuredDelegationUpdateProgress` must compare all usage counters; otherwise a cache-only change with unchanged `tokens`/tool progress is suppressed as a heartbeat.
- Trace final / cancelled / retry paths so each emits correctly scoped counters without changing terminal accounting. Retry aggregation must not silently mix attempts.

## Tests to add (extend existing files, keep all existing assertions)

- `test/unit/delegation-api.test.ts` heartbeat/progress cases: unchanged counters suppress a duplicate; changing only `cacheRead`, only `cacheWrite`, or only `turns` emits an UPDATE.
- `test/unit/prompt-template-bridge.test.ts` projection: legacy payloads without usage remain valid and project no `usage`; new fields project exactly; a previously emitted snapshot is unchanged after further accumulation (immutability).
- Drive foreground execution with at least two assistant messages with distinct cache values; assert cumulative UPDATE counters and the final terminal counters agree. Cover cancellation before terminal, multiple attempts, and absent/invalid counters (NaN/negative → no `usage`).

## Validation (must actually run; record real output)

Rules: heavy commands go through `slot cpu -- ...`; before the first heavy command run `slot audit` and `slot status` and save both outputs under the working copy's `../pi-subagents-pr-evidence/` directory (create it under `/project/tmp`, never `/tmp`). Set `TMPDIR=/project/tmp/pi-subagents-pr-tmp` (create it). Do not edit a script while it runs.

1. `slot cpu -- npm run typecheck`
2. `slot cpu -- npm run test:unit`
3. If `test:integration` exists and can run offline, `slot cpu -- npm run test:integration`; if it needs network/credentials, say so instead of pretending.

Save each command's exit code and full stdout/stderr as files in the evidence directory.

## Constraints

- Do not commit, push, or open a PR; leave the work as uncommitted changes on the branch. The Root will review the diff, commit, and open the PR.
- Do not delete or weaken existing assertions. Do not widen scope (no cache classification, no `uncached | total` policy, no cost fields).
- Do not modify anything under `~/.pi/agent`. Do not write under `/tmp`.
- Final report: list changed files with a one-line rationale each, the exact validation commands with exit codes and the evidence directory path, and any deviation from this spec with the reason.
