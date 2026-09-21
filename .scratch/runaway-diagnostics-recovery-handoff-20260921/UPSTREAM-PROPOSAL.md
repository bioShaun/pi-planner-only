# Upstream proposal: cumulative usage on structured delegation UPDATE

Status: implemented and submitted 2026-09-21 as https://github.com/nicobailon/pi-subagents/pull/2374 (fork branch `delegation-update-cumulative-usage`, commit 9d9b656c on upstream main 1ac7b5e2 / v0.70.1). Record: [upstream-pr-20260921/REPORT.md](upstream-pr-20260921/REPORT.md). The text below is the proposal as prepared before implementation.

## Problem and API

Structured UPDATE exposes only `tokens = input + output`. A cancellation can arrive before terminal usage, leaving consumers unable to explain cache behavior or preserve classified usage. Add an optional cumulative per-attempt snapshot:

```ts
usage?: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  turns: number;
};
```

All counters describe the same attempt at the same observation time and are finite non-negative values. Keep existing `tokens` semantics unchanged for backward compatibility. Missing usage means unavailable, not zero. UPDATE does not promise final billed usage or cost; the terminal remains authoritative.

`window = input + cacheRead` in foreground execution describes the current assistant-message context window. It must not be projected as cumulative usage. Likewise, retry aggregation must not mix attempts silently.

## Minimal implementation scope

Primary source inspected locally: `/project/tmp/pi-subagents-runtime-agent-settings`, clean branch `runtime-agents-honor-subagent-settings` at `875bda1`; installed checkout `~/.pi/agent/git/github.com/nicobailon/pi-subagents`, clean main at `bbb30096`. Re-check upstream state before implementation; do not append unrelated work to the existing model-settings PR branch.

1. `src/api/delegation.ts`: extend `SubagentDelegationUpdate` with the optional shape above.
2. `src/shared/types.ts` and `src/runs/foreground/execution.ts`: make cumulative cache counters available alongside existing input/output/turn progress. The authoritative counters are already accumulated from assistant messages in `result.usage`; emit a copied snapshot so future updates cannot mutate previously emitted payloads.
3. `src/slash/delegation-adapters.ts`: extend the two progress bridge shapes and project the snapshot in `toSubagentDelegationUpdate`.
4. `src/slash/prompt-template-bridge.ts`: compare all usage counters in `sameStructuredDelegationUpdateProgress`. Otherwise a cache-only change with unchanged legacy tokens/tool progress will be suppressed as a heartbeat.
5. Trace final/cancelled/retry paths so each supported path emits correctly scoped counters without changing terminal accounting.

## Verification to include in a PR

- Extend `test/unit/delegation-api.test.ts` heartbeat/progress cases: unchanged counters suppress a duplicate; changing only cacheRead, cacheWrite or turns emits an UPDATE.
- Extend adapter projection coverage in `test/unit/prompt-template-bridge.test.ts`: legacy payloads remain valid; new fields project exactly; prior snapshots remain immutable.
- Drive foreground execution with at least two assistant messages with distinct cache values; assert cumulative UPDATE counters and final terminal counters agree.
- Cover cancellation before terminal, multiple attempts and absent/invalid counters. Retain existing terminal usage tests.
- Run the upstream project’s applicable checks from an isolated branch/worktree, following slot and temporary-directory rules; record actual output before claiming validation.

## Downstream follow-up

After the upstream contract ships, update the plugin’s local contract copy and parity checks. A separate opt-in `uncached | total` anomaly mode can use either input+output or input+output+cacheRead+cacheWrite. For old hosts, keep the current uncached policy; reject or visibly report unavailable total accounting rather than guessing. Cache classification and configurable accounting are not implemented by this proposal or by issues 01–04.
