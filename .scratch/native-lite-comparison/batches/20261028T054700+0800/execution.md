# Formal Execution Record

> Final Root disposition: **stopped, 0 valid samples, retry exhausted; other arms cancelled.** See [final closeout](closeout.md) for final cost reconciliation and causal corrections. Later references to launch release or pending decisions below are historical gate records, not current authorization. Retry1 Root yielded while awaiting its async child; the harness mistook that turn end for arm completion and closed Root before the child returned. This does not show Root claiming the investigation complete.

Batch: `20261028T054700+0800`.

## Authorization

Parent C gate accepted and released **S1 Native only, one start**. No permission was given for S1 Lite, S2 Lite, or S2 Native. No retry is authorized for this formal attempt.

## Budget Cutoff at Authorization

Parent-reconciled retained session usage cutoff: 138 assistant messages, total reported cost `$0.24991268`, inclusive of the original run `$0.05480434`; the original amount is not counted twice. Resume increment to cutoff: `$0.19510834`. Prior five-run reported control total `$1.12124704`; old plus current known control usage `$1.37115972`. Remaining nominal amount in the unchanged `$3` seed reserve `$1.62884028`. Additional usage after this cutoff, parent/main session charges, and actual billing are unknown pending receipts. These reported model costs are not a provider invoice.

## Formal Attempt

S1 Native launched and stopped incomplete; all other arms remain not started and not released.

- Slot job ID: `3643`, label `native-lite-S1-native`; fresh audit and status both exit 0 and are preserved as `/project/tmp/pi-native-lite-20261028T054700+0800/logs/S1-native-launch-slot-{audit,status}.{txt,exit}`. Audit found no bypass processes.
- Exact arm cwd: `/project/tmp/pi-native-lite-20261028T054700+0800/worktrees/S1-native`.
- Session ID: `nl-20261028T054700-0800-S1-native`.
- Control log launch: `2026-10-27T22:09:23.030Z`; first `get_state` sent `22:09:23.034Z`; matching state received `22:09:23.488Z` (`tcuni/gpt-6.1-terra`, high, correct session); task prompt accepted `22:09:23.579Z`, disposition `started`.
- Root explicitly reported that its actual cwd `/project/tmp/pi-native-lite-20261028T054700+0800/worktrees/S1-native` violates the brief's hard-coded `/project/tmp/pi-native-lite-pairs/<pair>/<mode>` path constraint and asked for the correct path. Therefore it did not launch a worker child. This is a retry1-eligible path-contract/configuration failure, not evidence about Native behavior. No delegate child launch receipt or child session exists.
- `/subagent-cost` returned `subagent-slash-text-result`, not the `subagent-slash-result` expected by the frozen runner. It says “No subagent child usage found in this session.” Two Root usage messages in the retained session sum to input `11434`, output `348`, cacheRead `8704`, cacheWrite `0`, reasoning `98`, 2 turns, reported cost `$0.0136092`. This is a usage report, not an invoice. No child invocation occurred; child usage is not applicable because no child call happened, not a completed zero-cost child. This runner mismatch caused the control process to keep waiting after Root's path-clarification response; runner was not modified after formal launch.
- After confirming Root had ended without a child and runner remained waiting, slot job `3643` was stopped with `slot kill cpu 3643`. Slot queue reports finished exit `-1`; runner and Pi processes are absent. Stop was confirmed by `2026-10-28T06:12:40+08:00`; exact kill timestamp was not recorded. No retry was attempted.

## Requests and Fingerprints

Two Terra requests were reserved before transport in the shared ledger, total estimated reserve `$0.2523125`; this is not actual billing.

| Request | Reserve USD | Ledger/payload hash | Fingerprint payload hash | System field | Tools SHA-256 |
| --- | ---: | --- | --- | --- | --- |
| 1 | 0.1178875 | `7f128fc3781f1ff0b7c1c933fa8cb18c63239efbbb51306eebdcc5a5185d9821` | same | absent (`instructions` missing) | `68ad18b3cffccd9454ae912e417171e2e43962b0de142ff3c9db2b04b2ac4ee5` |
| 2 | 0.134425 | `2a82e4f76e00436697b761d248f79d0ed73e78476e16ae304a911d774ad9d66c` | same | absent (`instructions` missing) | `68ad18b3cffccd9454ae912e417171e2e43962b0de142ff3c9db2b04b2ac4ee5` |

For both, ledger `payloadHash` equals observer `payloadSha256`; tools were present. `systemPresent=false` hashes JSON null and **does not prove complete system prompt coverage**. Source inspection of the configured OpenAI Responses API builder plus the retry1 synthetic builder test shows system/developer prompt items are encoded inside `input`; the failed attempt's raw `input` content was not persisted, so its exact system message cannot be reconstructed. The C observer therefore missed system content. Do not modify/reload that frozen observer or rerun it; the separate retry1 observer correction is under authorized configuration preparation.

The shared ledger now has `reservedUsd=3.2523125`: original `$3.00` seed plus the two `$0.2523125` non-refundable request reservations. This remains below the `$16` estimated-request refusal threshold. It is not actual provider billing. Parent's `$1.37115972` known preparation/control usage cutoff remains separate; any additional control usage is unknown until final receipts.

## Evidence and Disposition

- Raw session, RPC, control, runner stdout/stderr, and request fingerprints are under `/project/tmp/pi-native-lite-20261028T054700+0800/results/20261028T054700+0800/S1-native/`.
- Cost result is preserved in the Pi session JSONL as `subagent-slash-text-result`; no child usage records or child session exist.
- Root/worker execution does not meet the S1 acceptance condition that implementation/investigation be assigned to a worker child. This attempt is incomplete/failed, not a valid scenario sample.
- Mandatory guard and fingerprint observer were registered in the prompt-free offline root registry, but their propagation and shared-ledger use in an actual child are not demonstrated by this attempt.
- Stop all later arms. No retry has been paid/launched. Parent has authorized preparation of one retry1 configuration correction only; paid retry1 launch requires a new freeze-gate approval.
