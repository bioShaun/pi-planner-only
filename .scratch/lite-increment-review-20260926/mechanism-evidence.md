# Installed implementation evidence

Read-only cross-file exploration completed; no tests or source changes were performed by the explorer.

- Interface: `index.ts:48,451`, `delegate.ts:34,210`, installed `pi-subagents/src/extension/schemas.js:319,335`. Lite exposes role/task/cwd, four configured roles, closing instructions; native exposes broader model/workflow/budget controls.
- Cancellation/timeout: `delegate.ts:494,602,647`; installed `src/slash/delegation-adapters.js:170`, `src/slash/prompt-template-bridge.js:300`. Native owns execution controller/terminal; lite supplies request timeout and observed-token cancellation policy. See `CONTEXT.md:29` for non-hard-limit semantics.
- Cwd lock: `delegate.ts:95,475,592`. Shared within the plugin instance, keyed by Git root or canonical cwd; reviewer is nonexclusive, write/bash roles hold until terminal. Not a machine-global lock across separate Roots.
- Native entry distinction: installed `src/runs/foreground/subagent-executor.js:7047` public guard; `:7091` public entry; `:7109` structured executeDelegated calls execute directly; `src/slash/prompt-template-bridge.js:204` request/node identity guard.
- Output/recovery: `delegate.ts:210,403,531` and installed `src/slash/delegation-adapters.js:233`. Native terminal text/usage/status plus lite clipping, Git summary, last update and native artifacts.
- Existing test evidence: `contract.test.mjs:19`; `delegate.test.mjs:100,357,370,398`; `index.test.mjs:363`. Contract/role mapping, lock refusal, token cancellation, late release, start timeout, clipping/recovery, tool hiding and strict Root blocking. These deterministic checks establish mechanics, not economic benefit.

Installed upstream root: `/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/` (version 0.71.0 during the pilot).
