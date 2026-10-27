# Guard Identity Fix

Implemented the Root-reviewed harness-only changes. No product code/global settings/install changes, paid experiment, or full release run occurred.

## Source Changes

In `budget-guard.ts`, `before_provider_request` now uses only the current hook context:

```ts
const model = ctx.model;
const sessionId = ctx.sessionManager?.getSessionId?.();
if (!model?.provider || !model.id || !sessionId) throw new Error("active provider model or session identity missing");
if (!event.payload || typeof event.payload !== "object" || event.payload.model !== model.id) {
	throw new Error("provider payload model does not match active Pi model");
}
await reserveProviderRequest(event.payload, {
	provider: model.provider,
	sessionId,
	ledgerPath: process.env.PI_NATIVE_LITE_BUDGET_LEDGER,
});
```

The hook no longer reads `PI_PROVIDER` or `PI_SESSION_ID`. Hook context is authoritative; a missing/mismatched identity fails closed before transport.

The allowed request subset is now text-only: recursive validation rejects `input_image`, image URL objects, audio and file blocks. Tool entries must be ordinary `function` tools; hosted/server-side tools are denied. Any `service_tier` field is rejected. Existing function tools remain allowed. The top-level provider model is still restricted to the configured Terra/Luna IDs and known OpenAI Responses fields.

## TDD Evidence

The real Pi loopback test was added before this source fix. It runs once with `PI_PROVIDER`/`PI_SESSION_ID` cleared and once with deliberately stale outer-worker values. Before the fix, both calls were denied by the env-based provider check; the mock HTTP server got zero requests, and the ledger contained only its seed event. This is a behavioral red, not an import or syntax failure.

```text
cwd=/home/tcuni-claw/pi/pi-planner-only
TMPDIR=/project/tmp/pi-native-lite-pairs/tmp TMP=/project/tmp/pi-native-lite-pairs/tmp TEMP=/project/tmp/pi-native-lite-pairs/tmp env -u PI_SUBAGENT_CHILD node --test .scratch/native-lite-comparison/preflight/budget-guard-provider.test.mjs
start=2026-10-27T21:03:33+08:00 end=2026-10-27T21:03:35+08:00 exit=1
```

Portable red excerpt; complete stdout is `/project/tmp/pi-native-lite-pairs/preflight/guard-ctx-red.stdout`:

```text
✖ allowed Pi requests use the active hook context identity, not inherited process identity
AssertionError: active Pi ctx.model/ctx.sessionManager identity must admit the request and be recorded
clear: HTTP did not arrive; budget guard denied provider request: budget guard denied provider outside allowlist
clear: ledger identity was tcuni/gpt-6-luna/seed
polluted: HTTP did not arrive; budget guard denied provider request: budget guard denied provider outside allowlist
polluted: ledger identity was tcuni/gpt-6-luna/seed
exit 1
```

After the fix, only the two affected test files were run:

```text
cwd=/home/tcuni-claw/pi/pi-planner-only
TMPDIR=/project/tmp/pi-native-lite-pairs/tmp TMP=/project/tmp/pi-native-lite-pairs/tmp TEMP=/project/tmp/pi-native-lite-pairs/tmp env -u PI_SUBAGENT_CHILD node --test .scratch/native-lite-comparison/preflight/budget-guard.test.mjs .scratch/native-lite-comparison/preflight/budget-guard-provider.test.mjs
start=2026-10-27T21:12:35+08:00 end=2026-10-27T21:12:38+08:00 exit=0
```

Green: **9 tests passed, 0 failed**. Full output: `/project/tmp/pi-native-lite-pairs/preflight/guard-final.stdout`. The loopback allow test proves, for both cleared and polluted process identity, that a real Pi hook admits the text request using the explicit current Pi session ID and `ctx.model.provider/id`; the localhost server receives it, ledger event model/session match, and outgoing `max_output_tokens` is an integer from 1 through 16384. The test server returns a local 400 response after recording the request. The existing over-budget test continues to prove denied requests make zero HTTP calls. New fault injection also rejects image input, server-side tools and service-tier pricing.

Earlier failed green attempts were retained at `guard-ctx-green.stdout` and `guard-ctx-green2.stdout`; those used `PI_OFFLINE=1` for the allowed localhost call and failed with connection errors. The final allowed-request probe removes offline mode only for the two local loopback test processes, sets `PI_TELEMETRY=0` and `NO_PROXY=127.0.0.1,localhost`, disables extension discovery, and points the model endpoint exclusively at localhost. It made no outside provider request. No release suite was run this turn.

## External Results

The arm briefs now direct sessions, reports and command logs to `/project/tmp/pi-native-lite-pairs/results/<pair>-<mode>/`, derived from the arm worktree CWD. Four result roots now exist: `results/S1-native`, `results/S1-lite`, `results/S2-native`, `results/S2-lite`. The command template in `budget-guard.md` uses `results/S1-native/session` for Pi's session directory and writes stdout/stderr in `results/S1-native/`. The equivalent substitutions apply to each arm. The shared execution-contract prefix is identical in S1 and S2; within each scenario the two arm brief hashes match:

- S1: `2071686d4f1f4d7b7d8614baf84e762ba9732ce59850361c68d90529388f7f64`
- S2: `6785646596487226f911c7c2756da64c10e3da7fe4059ac7eae3d8eff834785b`

The S2 reviewer reads the frozen `/project/tmp/pi-native-lite-pairs/common/S2-candidate.diff` and has no shell; validator owns commands. Existing worktree configuration, previous loader logs, and other offline history were not moved or overwritten.

The shared ledger `/project/tmp/pi-native-lite-pairs/budget-ledger.json` still contains one `$1.00` preparation reserve. Test ledgers were isolated under the configured `/project/tmp` tree; the shared ledger was read and verified unchanged. This reserve is not actual provider billing. No files are staged; `git diff --check -- .scratch/native-lite-comparison/preflight` exits 0.

Changed-file hashes:

- `budget-guard.ts`: `421539411c9a853c2341b83ed69c3aa71bcf4c213599a95798abae77447fac0d`
- `budget-guard-core.mjs`: `632b82ccf67c6033032619ba629f0827c1edb7d8fbf006c975f9f6752f1f8268`
- `budget-guard.test.mjs`: `b4de48f9c40651a9a9776bafcde21c05ee5fbfbe27fc9c4c6b1bcc81689473ef`
- `budget-guard-provider.test.mjs`: `12b415f2dece44eb8f1e3da6044e028c6fc0b03da1d8f3121b58eb074ceaa133`

Residual boundary: these tests exercise the real Pi root and context-identity request paths against loopback, not a parent-generated paid or child model turn. Child guard propagation remains through the pi-subagents required-child-extension registry and is unchanged by this fix.
