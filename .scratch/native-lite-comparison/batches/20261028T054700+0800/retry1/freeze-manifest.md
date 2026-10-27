# Retry1 Freeze Manifest

> Final Root disposition: **stopped, 0 valid samples, retry exhausted; other arms cancelled.** See [final closeout](../closeout.md) for final cost reconciliation and causal corrections. Later references to launch release or pending decisions below are historical gate records, not current authorization. Retry1 Root yielded while awaiting its async child; the harness mistook that turn end for arm completion and closed Root before the child returned. This does not show Root claiming the investigation complete.

Status: **the one authorized retry1 S1 Native launch completed as an incomplete/failed sample**. Root/worker evidence is preserved; no other arm is released or launched. No further retry is permitted. Old C-gate runner/observer/briefs, first S1 output, and shared ledger remain preserved.

## First Attempt Cause and Retry Scope

The first S1 Native Root read its actual CWD `/project/tmp/pi-native-lite-20261028T054700+0800/worktrees/S1-native`; the byte-frozen brief required `/project/tmp/pi-native-lite-pairs/<pair>/<mode>`. Its final response explicitly asked for the correct worktree path and said it had not started a worker. Thus no child was launched because the CWD/output path contract conflicted, not because Native declined to delegate. Separately, the frozen runner waited for `subagent-slash-result` while installed Pi emitted `subagent-slash-text-result`; the job was stopped after Root completion. These are two distinct first-attempt control defects. They and both Terra requests/reservations remain in C `execution.md`; there is no reclassification as a valid sample.

Retry scope is limited to the approved path contract, result-type handling/child-count verification, and system fingerprint extraction from OpenAI Responses `input`. No task/acceptance content, source baseline, mode, model, role, ledger, guard/core, CLI, or global setup is changed.

## Retry1 Isolation and Inputs

- Same batch ID: `20261028T054700+0800`; retry ID: `retry1`.
- Four fresh detached worktrees: `/project/tmp/pi-native-lite-20261028T054700+0800/retry1-worktrees/{S1-native,S1-lite,S2-lite,S2-native}`. All HEADs are `f818cc91c98d6129a152fb28161e00d2f601e494`; tracked diffs are empty.
- Runner-valid CWD template: `/project/tmp/pi-native-lite-20261028T054700+0800/retry1-worktrees/<pair>-<mode>`.
- Results/session/log template: `/project/tmp/pi-native-lite-20261028T054700+0800/results/retry1/<pair>-<mode>/`.
- `S1-native` and `S1-lite` brief SHA-256: `cc49df5401b28c8afcacc06279f2ed7bfef9d1a2022cd502228659a145fc94bd`.
- `S2-lite` and `S2-native` brief SHA-256: `a33ef37980380252818fc7d5a88367ad20487f9f9e600e8f22d742fbb78bb195`.
- Path-contract regression normalizes only the allowed path substitutions and asserts exact equality with original frozen brief text. Pair hashes prove byte identity within S1/S2. It also checks actual cwd and derived results mapping for all four arms.
- Retry1 S2 reviewer input path is `/project/tmp/pi-native-lite-20261028T054700+0800/retry1-common/S2-candidate.diff`, SHA-256 `72a2fa5d3a66649aac9426542182378b715874a81cdbabf24e6aeb241282d647`; both S2 worktree inputs match it byte-for-byte. An initial copy command referenced the wrong old common directory and failed before writing; source was then located in the prior read-only batch and copied to this new retry1 path. The old source/input was not modified.
- All four source/lock hashes remain exact baseline values: `index.ts` `0a8b277e12d92ead7151fe9850dcaebfea2c10207f1134667cbe22a23f5887a1`; `package-lock.json` `105da12bbe51f12dfe2862e0cbf8641c0cd2bf6f7f1f1e266309ef5a828a6fd4`; `skills-lock.json` `83589059c6c7ba7a6ce32e47fe3d37e16769c191a3d34cc9cf78a5a532dffcb4`. Settings SHA-256 in each checkout: `f006d14252df39b2692c983c72060ac4a85bebc72c4aca805b34a2a08cd70577`.

## Retry1 Controller and Fingerprints

- Retry1 runner: `run-rpc-arm.mjs`, SHA-256 `3bebd64dde931f57cf2e7d3c35fb798f4c808ba56784a5247721add9b6154cdb`. The C runner copy remains unchanged. New unified diff against it is `/project/tmp/pi-native-lite-20261028T054700+0800/logs/retry1-runner-vs-c-attempt.diff` and `.meta` (diff exit 1 means differences present).
- It requires `PI_NATIVE_LITE_ATTEMPT_ID=retry1`, accepts only a CWD under `retry1-worktrees`, derives results under `results/retry1/<arm>`, keeps the shared ledger at the exact pre-existing `/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json`, and uses a unique `nl-20261028T054700-0800-retry1-<arm>` session.
- Before creating output, launching Pi, or submitting the brief, it parses the brief's arm-derived CWD/results contract and compares those paths to actual CWD/results. For S2 it also validates the declared retry1 common diff path and verifies its bytes equal the arm input. Wrong/old CWD, result base, S2 diff path, missing attempt ID, and existing outputs fail before fake Pi receives a command.
- RPC sequence stays `get_state` first, exact Terra/high/session check, then brief. It accepts `subagent-slash-result` and actual Pi `subagent-slash-text-result`, persists the cost report to `subagent-cost.txt`, and fails quickly on no child usage, unresolved child usage, or child line count not exactly the S1/S2 expected count. The tests generate displayed reports with installed pi-subagents `formatSubagentCostReport`, including exact `Parent`, `Child n (role)`, cache-read/write, turn and total lines; no stale hand-built `Child 1` format is used as the compatibility claim.
- Retry1 observer: `request-fingerprint.ts`, SHA-256 `1fe6a679d66c07946cfa84bdaebb7dabefa6cd5984519feffd6fe2959c33b537`. It hashes `instructions` plus system/developer entries inside provider `input` separately from user-role items; function tools are hashed separately from user/system text. The retry1 registry wrapper remains SHA `f1752005c0abde67f1d4a0e2077a84856c6825bff0ec4c240c7d049e12a8c0ef` and makes both frozen guard and retry1 fingerprint observer mandatory for every Pi child.
- The system-fingerprint regression uses installed `normalizeContext`, `convertResponsesMessages`, and `convertResponsesTools` from Pi's OpenAI Responses builder with synthetic system prompt, user input, and function-tool schema. It asserts the real builder puts system/developer text in `input`, hashes that component separately, excludes user content, hashes tools separately, and logs no plaintext. A no-op/pre-change observer red and retry1 observer green are directly captured. Missing observer log path remains exit 74 before transport.
- Frozen budget guard/core hashes remain unchanged: guard `421539411c9a853c2341b83ed69c3aa71bcf4c213599a95798abae77447fac0d`; core `632b82ccf67c6033032619ba629f0827c1edb7d8fbf006c975f9f6752f1f8268`.

## Runtime and Role Probe

Prompt-free real Pi 1.4.0 RPC probes were run from each retry1 CWD with the retry1 plugin/guard/observer/wrapper, `PI_OFFLINE=1`, retry1 role settings, exact Terra/high, one `get_state`, and local `/subagents-models`; no provider requests were made. Raw stdout/stderr/metadata: `/project/tmp/pi-native-lite-20261028T054700+0800/logs/retry1-probe-<arm>.{stdout,stderr,meta}`. Raw JSONL: `results/retry1/<arm>/runtime-probe-probe/driver.jsonl`.

All modes and active tool surfaces match their frozen Native/Lite behavior. All discovered roles report `tcuni/gpt-6-luna` / medium. Each live root-session registry contains `native-lite-budget-guard` and `native-lite-request-fingerprint`, both `requireForAllRunners:true` and exact retry1 paths. Retry1 child launch receipt also confirms both mandatory extensions were resolved and omitted count was zero. The worker ran and completed, but Root's usage snapshot was requested before its async usage was ready; the runner then failed fast and exited before Root could inspect/accept its report.

## Red/Green and Validation Evidence

Every listed test output is directly redirected; each `.meta` records cwd/start/end/exit. Pre-change red runs use the preserved C runner/observer or original briefs as explicit behavior snapshots, not syntax/import failures.

- Brief path contract actual CWD/result mismatch red: `logs/retry1-path-contract-red.{stdout,stderr,meta}`. Retry1 four-checkout path, pair-brief/hash and unchanged-body green: `logs/retry1-path-contract-green2.{stdout,stderr,meta}`.
- Retry1 runner behavior against copied C runner red: `logs/retry1-runner-red.{stdout,stderr,meta}`. Includes state-first and identity gates, attempt ID, retry1 output/ledger/extension paths, mismatch/timeout no-prompt, and fail-closed cases.
- Old-layout/wrong-results startup rejection red: `logs/retry1-path-startup-red2.{stdout,stderr,meta}`; includes actual fake argv/RPC proving the copied runner started despite wrong brief layout. S2 wrong common diff path red/green: `logs/retry1-s2-diff-path-{red,green}.{stdout,stderr,meta}`.
- Actual Pi cost-result type/formatter red with old runner: `logs/retry1-rpc-cost-red2.{stdout,stderr,meta}`; it waited for the deadline on real `subagent-slash-text-result` text. Green on retry1 runner: `logs/retry1-rpc-cost-green.{stdout,stderr,meta}`; no-child, one actual-format child, and wrong child count tests all pass and are bounded.
- Actual Responses builder system/developer fingerprint red with C observer: `logs/retry1-system-fingerprint-red2.{stdout,stderr,meta}`; retry1 observer green: `logs/retry1-system-fingerprint-green.{stdout,stderr,meta}`.
- Final combined suite retains the original frozen guard/provider tests plus retry1 path/runner/S1+S2 cost/system tests: `/project/tmp/pi-native-lite-20261028T054700+0800/logs/retry1-all-focused-final.{stdout,stderr,meta}`, 22/22 passed. It ran with external `TMPDIR`, `TMP`, and `TEMP`; `PI_SUBAGENT_CHILD` was cleared. Full release suite is not rerun; parent said the prior isolated release pass remains sufficient because no product source/dependency change occurred.
- Fresh slot audit/status before the four retry1 worktrees: `/project/tmp/pi-native-lite-20261028T054700+0800/logs/retry1-worktree-slot-{audit,status}.{txt,exit}`; audit exit 0, no bypass process. Four worktrees used `slot cpu`.

## Shared Ledger and Current State

Retry1 references the existing absolute ledger `/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json` directly. It does not create, copy, or reset it. Current SHA-256 is `e298b6aed2969b2256cdc5cdc3917b56994de966ed470203676883741a78863d`; current reserved total remains `$3.2523125`, consisting of the original `$3` reserve and the two first-attempt `$0.2523125` non-refundable Terra request reserves. No retry1/offline test wrote requests to it. The first-attempt Root's exact retained usage is input `11434`, output `348`, cacheRead `8704`, cacheWrite `0`, reasoning `98`, 2 turns, cost report `$0.0136092`; `/subagent-cost` separately confirms no child invocation. These are usage/guard reports, not invoices. Parent's earlier known preparation/control cutoff was `$1.37115972`; current preparation usage after that cutoff is unknown pending status receipt. Main-session charges and actual invoice remain unknown. No reset/refund was performed.

Exact retry1 launch command used (only once, with fresh slot audit/status recorded immediately before launch):

```bash
cd /project/tmp/pi-native-lite-20261028T054700+0800/retry1-worktrees/S1-native
PI_NATIVE_LITE_BATCH_ROOT=/project/tmp/pi-native-lite-20261028T054700+0800 \
PI_NATIVE_LITE_BATCH_ID=20261028T054700+0800 \
PI_NATIVE_LITE_ATTEMPT_ID=retry1 \
PI_NATIVE_LITE_RPC_DEADLINE_MS=1000000 \
env -u PI_SUBAGENT_CHILD slot cpu -b -L native-lite-retry1-S1-native -- bash -lc '
  cd /project/tmp/pi-native-lite-20261028T054700+0800/retry1-worktrees/S1-native && \
  started=$(date -Is) && \
  env -u PI_SUBAGENT_CHILD \
    PI_NATIVE_LITE_BATCH_ROOT=/project/tmp/pi-native-lite-20261028T054700+0800 \
    PI_NATIVE_LITE_BATCH_ID=20261028T054700+0800 \
    PI_NATIVE_LITE_ATTEMPT_ID=retry1 \
    PI_NATIVE_LITE_RPC_DEADLINE_MS=1000000 \
    TMPDIR=/project/tmp/pi-native-lite-20261028T054700+0800/tmp \
    TMP=/project/tmp/pi-native-lite-20261028T054700+0800/tmp \
    TEMP=/project/tmp/pi-native-lite-20261028T054700+0800/tmp \
    node /home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/batches/20261028T054700+0800/retry1/run-rpc-arm.mjs \
      > /project/tmp/pi-native-lite-20261028T054700+0800/results/retry1/S1-native/runner.stdout \
      2> /project/tmp/pi-native-lite-20261028T054700+0800/results/retry1/S1-native/runner.stderr; \
  result=$?; finished=$(date -Is); \
  printf "cwd=%s\\nstart=%s\\nend=%s\\nexit=%s\\n" "$PWD" "$started" "$finished" "$result" \
    > /project/tmp/pi-native-lite-20261028T054700+0800/results/retry1/S1-native/runner.meta; \
  exit "$result"
'
```

At retry1 launch approval, parent cutoff was 355 deduplicated assistant usage records totaling `$1.25798312` (including the original `$0.05480434`), plus old control `$1.12124704` = `$2.37923016`; nominal `$3` control reserve remainder `$0.62076984`. Costs since that cutoff and invoices remain unknown. The C S1 root cost report `$0.0136092` and retry1 Root/worker costs below are experiment model usage, separate from that control subtotal. Retry1 used the authorized `PI_NATIVE_LITE_RPC_DEADLINE_MS=1000000` ms. Slot job `3645` started `2026-10-28T06:56:48+08:00`; runner ended `06:57:15+08:00`, exit 1; the child finished `22:57:54.898Z` after the Root session had already finalized. Combined with the first attempt, elapsed time remained under 20 minutes. Fresh prelaunch audit/status/hash/output checks are in `logs/retry1-S1-native-launch-slot-*` and `retry1/execution.md`.

Retry1 Root session is `nl-20261028T054700-0800-retry1-S1-native`, model `tcuni/gpt-6.1-terra` / high. Worker run `6a5551a6-56a0-4972-9a87-f4cecbda3f87`, session `01a17f94-cfda-7079-8163-9409e198a794`, model `tcuni/gpt-6-luna` / medium, completed with exit 0 after `53813ms`. Worker exact assistant usage from session JSONL: input `43003`, output `5054`, cacheRead `161920`, cacheWrite `0`, reasoning `198`, reported cost `$0.0084465`; async status also reports 43,003 input tokens, 5,054 output tokens, and that cost. Root exact usage from session JSONL: input `27755`, output `1105`, cacheRead `79360`, cacheWrite `0`, reasoning `101`, reported cost `$0.037248`. These are usage reports, not invoice. Root's `/subagent-cost` snapshot preceded child completion; it said no completed child usage then. The child wrote `results/retry1/S1-native/report.md` (SHA-256 `750299da04bbe96899070e48dacd097800be13feb91c94d81d74b074d10b233b`). Root final said the report was not yet returned and did not review it. Pi child status marks its structured acceptance `rejected` because the required acceptance attestation was absent. The status/event receipt reports worker run complete, but `process-terminal.json` remains pending; preserve that lifecycle receipt gap. Therefore this is not a valid scenario sample, despite the later child output.

The worker made a supervisor clarification request because the brief was read-only while its generic worker/runtime contract requested implementation/acceptance. Root replied read-only/external report only; the worker then continued. Retry1 async child usage/launch is in the child status/session/event files named in `execution.md`. The worker session includes both required extensions in launch-resolved configuration with omitted count zero.

The shared ledger is the original absolute file, not a copy/reset. It now has `reservedUsd=4.60623375`: original `$3` seed, two C-attempt Terra reservations, and 16 retry1 reservations (8 Terra Root requests reserve `$1.1933425`; 8 Luna worker requests reserve `$0.16057875`). All 18 provider-request payload hashes (2 C + 8 retry1 Root + 8 retry1 child) match their observer `payloadSha256` entries. Retry1 fingerprints have `systemPresent=true` for all 16 retry1 requests; C's first two retained records remain `instructions`-absent and are not retroactively repaired. In retry1 all Root/worker fingerprints share system hashes by session and separate tools hashes. The first S1 attempt's $0.2523125 reservation and retry1 total `$1.35392125` reservation are non-refundable local estimates; the `$16` gate remains. No further request is permitted in this batch.

Parent final decision: **batch stopped with zero valid samples/pairs; S1 Lite, S2 Lite, and S2 Native are cancelled.** The single retry1 authorization is consumed. No further formal request or repair run is permitted in this batch.
