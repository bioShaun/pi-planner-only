# P6 Execution Controller Report

Result: **stopped before the first task brief/provider request**. The authorized order began with S1 Native. The first slot-wrapped RPC launcher used the wrong CWD and failed before Pi. Root approved the single protocol retry with corrected CWD. That Pi session started but the controller never sent its first `get_state`; it ended at Root's 240-second no-progress stop, exit 143. Both failures are preserved. No remaining arm was started.

## Prelaunch Evidence

Before the attempt, the following matched the frozen v2 manifest:

- All four detached worktrees resolved to `f818cc91c98d6129a152fb28161e00d2f601e494`; all four `git status --porcelain=v1 -uno` were empty. Only existing untracked `.pi/settings.json` and `input` files appeared in full status.
- S1 Native brief SHA-256 `2071686d4f1f4d7b7d8614baf84e762ba9732ce59850361c68d90529388f7f64`; settings SHA-256 `343dd87d14a081f2d33bd3072d913962561782e4a260fc4ca74b603800a2bcd1`.
- Candidate source `index.ts` `0a8b277e12d92ead7151fe9850dcaebfea2c10207f1134667cbe22a23f5887a1`; package lock `105da12bbe51f12dfe2862e0cbf8641c0cd2bf6f7f1f1e266309ef5a828a6fd4`; skills lock `83589059c6c7ba7a6ce32e47fe3d37e16769c191a3d34cc9cf78a5a532dffcb4`.
- Pi `1.4.0`; pi-subagents `0.83.0` at the explicit installed path. Guard/core matched the frozen hashes `421539411c9a853c2341b83ed69c3aa71bcf4c213599a95798abae77447fac0d` and `632b82ccf67c6033032619ba629f0827c1edb7d8fbf006c975f9f6752f1f8268`.
- The shared ledger was `$1.00`, one preparation event, before and after the failed launch. No request event was reserved.

The fresh S1 Native `slot audit` and `slot status` both exited 0 at `2026-10-27T21:42:33+08:00`, with no bypass/conflict match. The approved retry also had fresh audit/status exit 0 at `2026-10-27T21:59:23+08:00`, with no bypass/conflict match. Raw slot outputs are local under `/project/tmp/pi-native-lite-pairs/results/S1-native/`.

## Failed Start

Attempt window: `2026-10-27T21:48:08+08:00` to `2026-10-27T21:48:08+08:00`. The slot command exited 1 because `run-rpc-arm.mjs` observed the repo root CWD, not `/project/tmp/pi-native-lite-pairs/S1/native`. Stderr says `Error: unexpected arm cwd: /home/tcuni-claw/pi/pi-planner-only` at `run-rpc-arm.mjs:9`.

The failure records and exact commands/environment are in [S1-native-run-failure.md](S1-native-run-failure.md). The prelaunch manifest remains at `/project/tmp/pi-native-lite-pairs/results/S1-native/manifest-before-run.md`; original `controller.*` files from the first attempt were not overwritten, and the second attempt uses `controller-retry1.*`. The second attempt's RPC session existed but contained no task prompt. The RPC process was stopped by Root; no P6 child was started.

The corrected retry command included `cd /project/tmp/pi-native-lite-pairs/S1/native`. Pi created session `p6-S1-native-20261027`, but the driver only registered a `get_state` response handler; it did not send a `get_state` request. Thus the controller waited until Root stopped Pi. The session contains only startup UI notices and the project-session warning; `control.jsonl` has `launch` and process exit but no state, prompt acceptance, Root answer, or child record. The shared ledger remained `$1.00` with one preparation event. No provider request was made.

## Arm State

- S1 Native: two startup/controller failures, no task prompt, no Root answer, no child result, no provider request.
- S1 Lite: not started.
- S2 Lite: not started.
- S2 Native: not started.
- No other-arm results were read; their results directories remain empty.
- No raw or historical files were moved or overwritten. No product, protocol, global configuration, commit, or release changes were made.

The execution controller incurred Luna preparation/control usage that is not visible to this worker; report it as unknown, not zero. The `$1.00` preparation reserve remains intact and is not an actual invoice. Neither S1 Native attempt made a Terra/Luna model request from a P6 arm.

## RPC Handshake TDD

Red used a fake Pi process. It proves the controller did not send the first RPC command: the fake command log was empty and no brief command was delivered.

```text
cwd=/home/tcuni-claw/pi/pi-planner-only
TMPDIR=/project/tmp/pi-native-lite-pairs/tmp TMP=/project/tmp/pi-native-lite-pairs/tmp TEMP=/project/tmp/pi-native-lite-pairs/tmp env -u PI_SUBAGENT_CHILD node --test --test-name-pattern='RPC runner sends get_state first' .scratch/native-lite-comparison/preflight/budget-guard-provider.test.mjs
start=2026-10-27T22:26:24+08:00 end=2026-10-27T22:26:29+08:00 exit=1
```

Portable red excerpt from `/project/tmp/pi-native-lite-pairs/preflight/rpc-handshake-red2.stdout`:

```text
✖ RPC runner sends get_state first and gates the brief on a matching model/session
AssertionError: valid handshake must request state before submitting the brief
actual command log: empty; expected get_state:p6-state, then prompt:p6-task, then prompt:p6-child-cost
exit 1
```

Green used the fake Pi RPC process for the same valid/mismatch/timeout cases:

```text
cwd=/home/tcuni-claw/pi/pi-planner-only
TMPDIR=/project/tmp/pi-native-lite-pairs/tmp TMP=/project/tmp/pi-native-lite-pairs/tmp TEMP=/project/tmp/pi-native-lite-pairs/tmp env -u PI_SUBAGENT_CHILD node --test --test-name-pattern='RPC runner sends get_state first' .scratch/native-lite-comparison/preflight/budget-guard-provider.test.mjs
start=2026-10-27T22:29:48+08:00 end=2026-10-27T22:29:51+08:00 exit=0
```

The regression verifies first-command `get_state`, brief submission only after matching provider/model/thinking/session, no brief for model or session mismatch, and a bounded timeout with no brief if state never arrives. Final affected-suite command (guard plus provider/runner tests only; no release):

```text
cwd=/home/tcuni-claw/pi/pi-planner-only
TMPDIR=/project/tmp/pi-native-lite-pairs/tmp TMP=/project/tmp/pi-native-lite-pairs/tmp TEMP=/project/tmp/pi-native-lite-pairs/tmp env -u PI_SUBAGENT_CHILD node --test .scratch/native-lite-comparison/preflight/budget-guard.test.mjs .scratch/native-lite-comparison/preflight/budget-guard-provider.test.mjs
start=2026-10-27T22:30:51+08:00 end=2026-10-27T22:30:56+08:00 exit=0
```

Final affected suite: 10/10 pass. The fake RPC process makes no provider call. The two real S1 Native startup attempts remain failed/incomplete; no arm has a valid sample. Root decision is required before any future start.

Earlier handshake-test attempts using the test harness before `PI_BIN` injection were not discarded; they are preserved in `rpc-handshake-red.stdout`, `rpc-handshake-green.stdout`, `rpc-handshake-debug.stdout`, and `rpc-handshake-debug2.stdout`. The debug2 attempt launched a real Pi process unintentionally, but its isolated temp ledger path was absent: the budget guard exited 73 before HTTP/provider transport. The shared P6 ledger stayed at `$1.00` and the task brief was not submitted. The final fake-Pi regression no longer launches the real CLI.

Required evidence and no-staged-files state were checked; `git diff --check -- .scratch/native-lite-comparison/pairs .scratch/native-lite-comparison/preflight` exits 0.
