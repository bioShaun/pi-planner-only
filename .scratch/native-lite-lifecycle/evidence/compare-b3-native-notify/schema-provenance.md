# Native Completion Notification Provenance

Observed installation: `pi-subagents` 0.83.0 at `/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents`.

## Installed Bundle

- `bundle/chunk-CDI3GMNV.js` SHA256 `ee4c9af84a78eb58a7995127e77c0c8934a52643636517d6e0be90ccb0e5d6d9`.
- `buildCompletionDetails(result)` copies `source` only when `result.source` is truthy: `...result5.source ? { source: result5.source } : {}`. It does not synthesize `source: "async"`.
- `notifyRunDetails({ resultPreview, childOutputs, ...run })` preserves the remaining fields from `run`; it also does not require or synthesize `source`.
- `sendCompletion` places these details into `customType: "subagent-notify"` / `details.runs`.
- `bundle/chunk-HJJAVHFB.js` SHA256 `08f8209f13e9a746b5ce96d513bb737a954ab3a317f833b9fb55bf3414830259` contains the async-result delivery call. It spreads stored `data`, then sets `id`, `runId`, ownership, wake and child fields; it does not add a `source` field at the call site.

## Captured Host Event

The actual compare-b3 S1-native root `session.jsonl` record 1243 was a custom `subagent-notify`. Its sole run had `runId=5a8550b7-fd12-4535-9df9-ade4914fdc04`, `agent=worker`, `status=completed`, `asyncDir`, `durationMs=64034`, `sessionLabel`, and `sessionValue`; it had no `source` property. The reduced raw fixture is `actual-notification.json`, SHA256 `3a8339a753107623cd2e0051a782930eb04d41430737520d0736d50a39f0ef00`. The exact child report is preserved as `child-report.md`, SHA256 `21074d78e8cdd4565d6024ef7cce1f95094c1be2c8693de08d9997be5b6b74a1`.

The installed producer contract does not guarantee a source field on this async-notify path. The harness may treat an omitted source as async only after matching a previously registered native-async run ID and expected agent; any explicit non-async source remains invalid. This evidence does not establish why the upstream result data omitted source in this run.

## Harness Baselines

- `stage-a-lifecycle.baseline.ts` SHA256 `fd7b684e1b424ed8de8cfb83925d9253905b51e155b7d5adec3db2dcada67b1f`.
- `run-rpc-arm.baseline.mjs` SHA256 `396e8697680f178a077615538a4a94ab16f87a43b017420521ca7a722c6ec809`.
- Parent runner raw session SHA256 `a490a9f50b42a293e10d532e901c428343ed68a2612e625a78c0201f1c7771b6`.

These copies preserve the compare-b3 failure-time source state and are not execution inputs.
