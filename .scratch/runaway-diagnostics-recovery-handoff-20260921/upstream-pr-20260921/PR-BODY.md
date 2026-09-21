## Problem

A structured delegation UPDATE exposes only `tokens = input + output`. When a parent cancels a child before the terminal response arrives (bounded preparation guards, wall-clock stops, operator abort), the parent cannot explain what part of the observed tokens was cache traffic, and cannot keep classified usage for the cancelled attempt. Consumers that account usage per attempt have to either guess or discard the attempt.

## Change

Add an optional cumulative per-attempt snapshot on `SubagentDelegationUpdate`:

```ts
usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; turns: number };
```

- All counters describe the same attempt at the same observation time and are finite non-negative numbers. Missing `usage` means unavailable, not zero.
- `tokens` keeps its existing `input + output` meaning; legacy payloads are unchanged.
- An UPDATE still does not promise final billed usage or cost. The terminal response's `usage` stays authoritative; attempts are never aggregated into one snapshot.

Implementation:

- `src/api/delegation.ts`: `SubagentDelegationUpdateUsage` and the optional `usage` field, documented as above.
- `src/shared/types.ts`, `src/runs/foreground/execution.ts`: `AgentProgress` carries cumulative `cacheRead`/`cacheWrite` next to the existing `inputTokens`/`outputTokens`/`turnCount`, updated from `result.usage` on every assistant message and after `reconcileAttemptUsage`. The internal progress-change gate also compares cache and turn counters so a cache-only change is not dropped as an unchanged heartbeat before it reaches the bridge. `window = input + cacheRead` remains a per-message context-window figure and is not projected as usage.
- `src/slash/delegation-adapters.ts`: the progress bridge shapes carry the counters; `usage` is projected as a fresh object only when all five counters are finite non-negative, so an emitted snapshot cannot be mutated by later accumulation.
- `src/slash/prompt-template-bridge.ts`: `sameStructuredDelegationUpdateProgress` compares the usage counters, so a change in `cacheRead`, `cacheWrite` or `turns` with unchanged `tokens`/tool progress emits an UPDATE instead of being suppressed.

## Tests

- `test/unit/delegation-api.test.ts`: cache-only and turn-only changes emit an UPDATE while exact duplicates are suppressed; absent/negative/NaN counters omit `usage`; cancellation after two UPDATEs leaves the already-emitted snapshots untouched.
- `test/unit/prompt-template-bridge.test.ts`: legacy payloads project no `usage`; a full payload projects exactly; a previously emitted snapshot stays unchanged after the source progress mutates.
- `test/integration/single-execution.part-2.test.ts`: drives real foreground execution through two assistant messages with distinct cache values; cumulative UPDATE counters never regress and the last snapshot equals the terminal usage.

Ran locally: `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, all exit 0 (unit 3279 pass / 0 fail / 13 skip; integration 1058 pass / 0 fail / 7 skip).

## Scope notes

Hot-path cost is five numeric comparisons per progress update and one small object per emitted UPDATE. No cache classification policy, cost fields, or accounting modes are added; downstream consumers decide how to use the counters.
