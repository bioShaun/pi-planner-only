# Native vs Lite Usage Collection

## Scope and provenance

This is a read-only source/test comparison for baseline `f818cc91c98d6129a152fb28161e00d2f601e494`. Baseline was verified by the supervisor with `git rev-parse HEAD`; `git status --short --untracked-files=no` returned no output. Untracked-file state was not assessed. Inspection was limited to product source and relevant tests in this worktree; no runtime usage run was performed. `contract.test.mjs` does exercise the installed pi-subagents package when run, but here it was inspected as source only.

The report describes application accounting semantics, not measured model behavior or provider invoices. Neither source nor tests justify claiming Native or Lite is cheaper.

## Shared Root source

Both modes call `onMessageEnd` (`index.ts:494-502`) for non-off modes. `rootUsageOf` (`host.ts:45-52`) accepts only assistant messages with a usage object, sums finite `input`, `output`, `cacheRead`, and `cacheWrite` for tokens, and reads `usage.cost.total` when present, otherwise using zero. Root totals are added on every assistant message (`index.ts:221-226`), not replaced. Missing usage drops that message from totals; missing individual fields and missing/malformed cost silently contribute zero. Root context is separately `input + cacheRead + cacheWrite`, unless host `getContextUsage()` supplies a positive finite count (`host.ts:68-70`, `index.ts:499`).

This yields cumulative per-session Root-message accounting in either mode. It can be lower than actual Root activity where host messages lack usage or fields; zero cost is not evidence of zero billing.

## Lite child collection

Lite's `delegate` tool launches a structured request and waits for its matching terminal response (`delegate.ts:640-...`, `delegate.ts:670-...`). The local response contract includes usage fields `input`, `output`, `cacheRead`, `cacheWrite`, `cost`, `turns`, `toolCalls`, `durationMs` (`subagent-delegation-contract.ts:58-80`). The result usage is passed into `DelegationOutcome` (`delegate.ts:625-635`) and recorded by `executeDelegate` (`index.ts:404-406`).

`recordChildRun` (`index.ts:209-219`) adds all four token fields and cost for each returned usage object. It counts every non-refused outcome as a child, including failures without usage; refusal is excluded because no child launched. If usage is absent, child count/failure count still advances while token and cost totals do not. Lite therefore reports observed delegate terminal receipts, cumulatively added per invocation. The source does not deduplicate by underlying run ID. A receipt counted twice would count twice; normal path is one completion per delegate request, but duplicate suppression is not implemented here. Non-completed/late terminal behavior is managed by the launch state machine (`delegate.ts:640-...`); aggregate recording occurs after `runDelegation` resolves at the execute path.

`formatTotals` (`index.ts:114-128`) reports Root plus Lite children, and explicitly says tokens include cache reads on both sides. It sums cache read/write into token totals without exposing the components separately. Child usage is terminal-response data, not an independent session ledger; omissions in responses or absent/partial usage make totals incomplete.

## Native child collection

Native does not use Lite's delegate accounting path for child totals. `refreshNativeCost` (`index.ts:515-548`) requests `subagents:rpc:v1` method `cost`, scoped by active session ID. On a valid response, it replaces `session.nativeChild` with `childTotal.input + output + cacheRead + cacheWrite` and `childTotal.cost` (`index.ts:535-543`); it does not add each snapshot. Requests are refreshed on `subagent:async-complete` for the current session (`index.ts:550-553`) and Root message end also drives status processing (`index.ts:494-502` plus native event registration around `index.ts:...`). A five-second timeout, invalid reply, or unavailable bridge clears the current child snapshot (`index.ts:525-544`).

This is a cumulative snapshot supplied by installed pi-subagents, not per-call terminal usage. `contract.test.mjs:80-110` builds fixture metadata for an async child and a workflow child, checks their costs/inputs are summed, and asserts repeated `cost` queries remain cumulative snapshots. `contract.test.mjs:111-133` asserts planner display replacement rather than repeated addition and isolation across session branches. Those tests demonstrate intended bridge semantics with fixtures and the installed package; they are not observed provider/runtime billing evidence.

The Native child status is explicitly displayed as `≥` and the status text states child usage is a recorded lower bound and missing/incomplete workflow receipts may omit usage (`index.ts:305-308`, `index.ts:474`). The bridge model includes async/workflow receipts, but coverage depends on what the installed pi-subagents bridge can resolve from session branch/artifacts. The status result has no per-role or per-child breakdown in this plugin. Native's root totals remain the same per-message cumulative values as Lite.

## Comparison and boundaries

| Dimension | Native | Lite |
|---|---|---|
| Root | Assistant message usage, added per message; same in both modes. | Same. |
| Child source | pi-subagents cumulative `cost` RPC childTotal. | Matching structured delegate terminal `usage`. |
| Repeated values | Snapshot replaces prior snapshot; no double-add of repeated cumulative query. | Each delegate outcome's receipt adds to total; no run-ID deduplication in aggregate. |
| Root/child coverage | Root plus plugin-reported aggregate child lower bound; may include async/workflow work known to bridge. | Root plus only invocations through Lite delegate tool in this session. Other native async/workflow children are not collected by Lite delegate aggregation. |
| Token fields | RPC total adds input/output/cacheRead/cacheWrite. | Response total adds input/output/cacheRead/cacheWrite. |
| Field visibility | UI shows total tokens and cost, not components. | UI shows total tokens and cost, not components. |
| Missing values | Bad/missing RPC reply clears child snapshot to unavailable; missing receipts can undercount. | Missing usage leaves child run counted but adds no tokens/cost. |
| Cost | `childTotal.cost` required finite and nonnegative; display is an estimate/source-provided amount, not an invoice. | usage.cost from terminal response; root missing cost becomes zero. |

Duplicate counting boundaries differ: Native's client replacement prevents repeated RPC snapshots themselves being summed, while source-level correctness depends on pi-subagents deduplicating/appropriately selecting receipts. Lite adds one receipt per tool invocation and does not independently reconcile overlapping or repeated underlying child runs. Neither code path establishes provider-billed cost. Both can undercount when usage/receipt data is absent; treating missing root cost as zero can also make displayed cost appear complete when it is not.

## Evidence and limitations

Key symbols/locations: `host.ts:45-52` (`rootUsageOf`); `index.ts:209-226` (`recordChildRun`, `recordRootTurn`); `index.ts:305-308` (`nativeTotals`); `index.ts:404-406` (Lite outcome accumulation); `index.ts:494-502` (message-end Root handling); `index.ts:515-553` (Native cost RPC and refresh); `index.ts:474` (lower-bound disclosure); `subagent-delegation-contract.ts:58-80` (Lite usage contract); `contract.test.mjs:80-133` (RPC fixture, cumulative snapshot, branch behavior); `index.test.mjs:452-466, 563-570, 684-705` (Lite/root totals and Native snapshot behavior).

No runtime workload, host provider response, provider price schedule, invoice data, or external installed package implementation was executed/inspected beyond the product's contract test source. Consequently runtime completeness, actual duplicate behavior inside arbitrary workflow topologies, and billed cost are unknown. This report makes no cost-efficiency conclusion.
