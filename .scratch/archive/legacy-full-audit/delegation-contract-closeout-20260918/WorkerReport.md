# WorkerReport

status: COMPLETED

changes:
- Removed the accidental tracked Explorer model-selection integration from `delegate.ts`, `index.ts`, `package.json`, and `rs01.test.mjs`; preserved both untracked Explorer files and recorded their hashes/recovery recipe.
- Removed `PI_SUBAGENTS_CAPABILITY_CHILD_RUN_IDENTITY` as a production capability override from both host-launcher and index capability resolution. Added false/missing-probe regressions and a registered-tool env=true regression.
- Added strict initial admission persistence: `LedgerSnapshotStore.writeOrThrow` propagates real snapshot failures, `TaskStore.createAllocated` writes before publishing/linking, and delegate admission releases only its new reservation on failure. Later lifecycle persistence remains best-effort.
- Corrected issue 01/03/04/05 status and unsupported host claims; recorded the installed launcher dependency precisely.

files_changed:
- delegate.ts, index.ts, task.ts, ledger-store.ts, orchestrate.ts, package.json
- delegate.test.mjs, index.test.mjs, rs01.test.mjs
- .scratch/delegation-contract-incident-20260918/issues/01-worker-report-run-identity.md
- .scratch/delegation-contract-incident-20260918/issues/02-atomic-admission-and-capacity.md
- .scratch/delegation-contract-incident-20260918/issues/03-validation-roundtrip-and-refusal.md
- .scratch/delegation-contract-incident-20260918/issues/04-unstarted-task-recovery.md
- .scratch/delegation-contract-incident-20260918/issues/05-host-incident-chain-acceptance.md
- .scratch/delegation-contract-closeout-20260918/{upstream-capability-evidence.md,explorer-integration-removal.patch,WorkerReport.md}

checks:
- PASS: `node --experimental-strip-types delegate.test.mjs` (exit 0, 7.08s; expected EISDIR diagnostic from real failure fixture, then all cases passed).
- PASS: `npm run typecheck` (exit 0, 4.48s).
- PASS: `node --experimental-strip-types rs01.test.mjs` (exit 0, 0.26s; 2/2 tests).
- PARTIAL/FAIL: `node --experimental-strip-types index.test.mjs` reaches and passes the new registered-tool env override regression, then exits 1 at the unchanged subprocess assertion line 359: expected `/planner-only toggle: PASS/`, child stdout was empty.
- PASS: `git diff --check` (no output).

risks:
- Real host report acceptance remains unavailable with installed `pi-subagents@0.68.0`; issue 01 and dependent 03/05 remain `ready-for-agent`. Issue 04 also remains open pending its required isolated real-host demo.
- Full release suite was not run because it requires the unavailable slot workflow and prior evidence already records an unrelated early task test failure. No release-pass claim is made.

blockers:
- Upstream launcher needs a supported pre-first-turn child runId channel plus documented capability advertisement.
- The existing index subprocess stdout failure prevents the remainder of `index.test.mjs` from running in this environment; the incident regression was placed before it and executed.

exact_verification_commands:
- `env TMPDIR=$PWD/.scratch/delegation-contract-closeout-20260918/runtime-tmp TMP=$PWD/.scratch/delegation-contract-closeout-20260918/runtime-tmp TEMP=$PWD/.scratch/delegation-contract-closeout-20260918/runtime-tmp npm_config_cache=$PWD/.scratch/delegation-contract-closeout-20260918/npm-cache NODE_OPTIONS=--max-old-space-size=768 timeout 55s node --experimental-strip-types delegate.test.mjs`
- `env TMPDIR=$PWD/.scratch/delegation-contract-closeout-20260918/runtime-tmp TMP=$PWD/.scratch/delegation-contract-closeout-20260918/runtime-tmp TEMP=$PWD/.scratch/delegation-contract-closeout-20260918/runtime-tmp npm_config_cache=$PWD/.scratch/delegation-contract-closeout-20260918/npm-cache NODE_OPTIONS=--max-old-space-size=768 timeout 55s npm run typecheck`
- `env TMPDIR=$PWD/.scratch/delegation-contract-closeout-20260918/runtime-tmp TMP=$PWD/.scratch/delegation-contract-closeout-20260918/runtime-tmp TEMP=$PWD/.scratch/delegation-contract-closeout-20260918/runtime-tmp npm_config_cache=$PWD/.scratch/delegation-contract-closeout-20260918/npm-cache NODE_OPTIONS=--max-old-space-size=768 timeout 55s node --experimental-strip-types rs01.test.mjs`
- `env TMPDIR=$PWD/.scratch/delegation-contract-closeout-20260918/runtime-tmp TMP=$PWD/.scratch/delegation-contract-closeout-20260918/runtime-tmp TEMP=$PWD/.scratch/delegation-contract-closeout-20260918/runtime-tmp npm_config_cache=$PWD/.scratch/delegation-contract-closeout-20260918/npm-cache NODE_OPTIONS=--max-old-space-size=768 timeout 55s node --experimental-strip-types index.test.mjs`
