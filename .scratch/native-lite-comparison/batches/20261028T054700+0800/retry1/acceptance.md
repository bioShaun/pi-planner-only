# Retry1 C Gate and S1 Result

> Final Root disposition: **stopped, 0 valid samples, retry exhausted; other arms cancelled.** See [final closeout](../closeout.md) for final cost reconciliation and causal corrections. Later references to launch release or pending decisions below are historical gate records, not current authorization. Retry1 Root yielded while awaiting its async child; the harness mistook that turn end for arm completion and closed Root before the child returned. This does not show Root claiming the investigation complete.

## C Gate

Parent reviewed the retry1 runner/observer diff and hashes, TDD path/RPC/system tests and raw outputs, four baseline worktrees, paired path-only briefs, offline tool/mode/role/registry probes, fixed S2 diff, and shared-ledger path/no-reset evidence. Parent explicitly authorized one S1 Native retry1 launch. It did not authorize any other arm or another retry.

## Cost Cutoff at Retry1 Authorization

Parent deduplicated 355 retained assistant usage entries for the control session: `$1.25798312` cumulative, including original `$0.05480434` (do not add twice). Prior five-run control `$1.12124704` gives known preparation/control `$2.37923016`, nominal remainder in the `$3` control reserve `$0.62076984`. These are usage reports, not provider invoice; additional control cost, main-session usage, and final billing remain unknown.

The shared ledger remains the original `/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json`; no copy, reset, refund, or test write occurred. It now has `$4.60623375` reserved: the `$3` seed, two first-attempt reservations, and retry1 Root/child request reservations of `$1.1933425` / `$0.16057875`. The first C S1 Root usage report `$0.0136092` is experiment usage, not control-reserve cost. Estimates are non-refundable, not provider billing. Maintain the `$16` request stop and at least `$4` margin below the user's `$20` ceiling.

## Retry1 S1 Native Outcome

Retry1 launched once via slot job `3645` from the exact retry1 S1 Native worktree with deadline override `1000000` ms. Root `get_state` and task acceptance matched the prescribed Terra/high/session and S1 brief. Root created worker async run `6a5551a6-56a0-4972-9a87-f4cecbda3f87` (Luna/medium) and replied to a child supervisor question affirming the task was read-only. The child later completed and wrote an 8495-byte report to the external results root, but after the Root had finalized. Child Pi status marks structured acceptance rejected because the report lacked the inferred acceptance attestation. Root never reviewed/accepted the child report, so this is an incomplete/failed attempt, not a valid S1 sample.

The retry1 runner requested `/subagent-cost` at Root completion while the worker was still async. Pi returned `subagent-slash-text-result` with no *completed* child usage at that instant; runner recognized the event, saved it, failed fast with `subagent-cost report found no child usage`, and exited 1. The worker completed ~39 seconds later; runner did not re-query and Root was no longer available. Preserve this early-cost race. Do not retry it.

The durable child receipt proves it was not “no child invoked”: child status is `complete`, exit 0, 8 turns, 11 tools, run duration `53813ms`, model `tcuni/gpt-6-luna` / medium, session `01a17f94-cfda-7079-8163-9409e198a794`. The parent session/async receipt/raw worker session are in `execution.md`. Child requested supervisor clarification and Root replied. Required guard and request-fingerprint extensions resolved in child launch plan with omitted count zero. Child output exists, but acceptance rejected and Root did not consume it.

## Usage and Fingerprints

Usage is from the retained Root and worker Pi session JSONL messages, cross-checked with child status/event receipts. It is provider-reported usage, not invoice.

| Entity | Model/thinking | Session | Input | Output | Cache read | Cache write | Reasoning | Cost |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Retry1 Root | Terra / high | `nl-20261028T054700-0800-retry1-S1-native` | 27,755 | 1,105 | 79,360 | 0 | 101 | `$0.037248` |
| Retry1 worker | Luna / medium | `01a17f94-cfda-7079-8163-9409e198a794` | 43,003 | 5,054 | 161,920 | 0 | 198 | `$0.0084465` |

Combined retry1 provider usage report: input `70,758`, output `6,159`, cacheRead `241,280`, cacheWrite `0`, cost `$0.0456945`; this sums session messages and is not an invoice. Lifecycle durations are not model compute time.

Ledger has 18 provider request events plus the seed: 2 C-attempt Terra requests and 8 retry1 Terra Root + 8 retry1 Luna worker requests. All 18 request `payloadHash` values match observer `payloadSha256` exactly. Retry1 root and worker each have 8 fingerprints; all report `systemPresent=true`, with distinct per-session system and tool hashes. C's first two events remain `systemPresent=false` because the first observer missed system/developer items inside `input`; those historical records are preserved and not rewritten. Request-level details are in `execution.md` and `request-fingerprints.jsonl`.

## Disposition

The single retry is consumed. The first C attempt was a brief/CWD configuration failure; retry1 launched a worker, but cost was queried before async completion and the Root finalized before reading the child result. No valid S1 sample or pair exists. Parent's final disposition is stopped/zero samples, with S1 Lite and both S2 arms cancelled. No more launches, retries, fixes, or tests are authorized in this batch.

The worker run status/events say complete/exit 0 but `process-terminal.json` remains pending while a terminal-candidate file exists; preserve this receipt discrepancy. The child report has an inferred checked acceptance rejection, and Root never reviewed it.
