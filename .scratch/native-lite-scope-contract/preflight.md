# Offline Preflight and Calibration Plan

## Current Result

- Protocol v2 separates infrastructure terminal, Root content verdict, and comparison eligibility. Formal eligibility is deterministic: a pair contributes to the primary acceptance outcome only if both arms reached observed infrastructure completion, both reports exist and hash-verify, neither arm has candidate/config/runtime/brief drift, and Root recorded a completed `accepted` or `rejected` content verdict for each. For that primary metric, accepted=1 and rejected=0; neither result is filtered. `incomplete`, unreviewed, refusal, missing/invalid evidence, timeout, stopped/unobserved terminal, or infrastructure failure makes the pair ineligible for that metric but remains in the attempted-results table with its reason. No retrospective selection. Cost/usage is a separate metric and is reportable only when both arms have verified comparable usage records; missing usage never changes the primary content verdict.
- Briefs are restored from the full original run contract and narrowly amended for truthful Root decisions, unknown boundaries, and role responsibilities. They include sanitized session formula, batch/attempt substitutions, child fields, Lite receipt fields, Native acceptance:none, model/topology restrictions, exact report names and S2 parent commits. Controller `root-acceptance` only represents accepted completion; rejected/incomplete outcomes stay in raw failure/terminal and separate classification, never fabricated JSON.
- The production per-arm CLI reads the current sealed ledger with the existing `readLedger` and `BUDGET_USD`, validates strict `<26` reserve semantics, checksum/event sum/shape, unchanged frozen prefix and prefix reserve, lock absence, and permits valid later appends. It checks actual controller/model/user settings/Pi/pi-subagents files against manifests, worktree Git tree/diff/nonignored-file hashes, exact pair brief bytes, common S2 diff bytes, frozen batch/attempt/arm/candidate/ledger path, exact runtime-lock bytes and per-arm manifest core. Worktree and path overrides are rejected. Output and lock reads fail closed; completed arms are not modified.
- `prepareBatch` supports explicit fixture dependency injection and the real review-only command. It renders `{{BATCH_ROOT}}`, `{{BATCH_ID}}`, `{{ATTEMPT_ID}}`, `{{SANITIZED_BATCH_ID}}`, freezes per-arm workspace snapshots/manifests, and cross-binds manifest core, lock and actual lock bytes. End-to-end fixture calls `prepareBatch` and then `runArmPreflight` against generated manifests; it checks the retained completed-arm + legal append state.
- No formal batch is prepared or frozen. Fixture worktrees are isolated under the specified project tmp. No provider/RPC experiment, ledger write, lock creation, controller/product/history evidence change, install or reload occurred.

## Red/Green and Legacy Baseline

The untouched first-round implementation is archived at `/project/tmp/pi-native-lite-scope-next/review-1/scope-contract/`; its implementation-before-test history remains explicitly non-TDD and is not reclassified.

R2 tests were added before changing that checker and reproduced actual first-round behavior: tracked source drift returned success; a different ledger file and unbound worktree override returned success. Raw output is `/project/tmp/pi-native-lite-scope-next/r2-red-current.log` (3 failures, 4 passes) and `/project/tmp/pi-native-lite-scope-next/r2-red-current-2.log` (3 failures, 4 passes; these runs used the then-current fixture revision). The exact immutable first-round checker remains preserved, and the regression suite now uses the actual guard ledger schema. R2 green runs must be read separately; no first-round failure is described as a historical red that it was not.

Legacy full-batch behavior was tested on an isolated fixture using a copied `.scratch/native-lite-budget-scope/verify-batch.mjs`. Its sole adaptation is the absolute ledger path, changed to a sealed fixture ledger path; the source file, hash, complete one-line diff, command metadata, and output are under `/project/tmp/pi-native-lite-scope-next/legacy-baseline/evidence/`. Original verifier SHA-256 is `17c378ba3db3a1ba28afd02016892a7112e1ad465bcafd1d9783d7138a789b9a`. The untouched legacy initial full-batch fixture passes. Separate scenarios prove a valid sealed append is rejected by the original full-length prefix assertion and an existing completed-arm output is rejected by its all-empty-output assertion. These are limitations of the legacy whole-batch preflight, not defects in its original contract. The new prepare-to-manifest-to-checker fixture accepts the same two continuation conditions. The actual shared ledger and prior worktrees were not written.

Focused checker tests cover real sealed event shape/checksum/sum, prefix rewrite/truncation, strict cap, lock/output failures, candidate/brief/settings/runtime lock drift, actual controller/model/user-settings/Pi/subagents files, workspace source diff, paired brief bytes, S2 common/paired diff bytes, CLI identities/paths and generated-manifest compatibility. Every guard has fault injection.

R2 raw behavioral evidence (cwd `/home/tcuni-claw/pi/pi-planner-only`; `TMPDIR=TMP=TEMP=/project/tmp/pi-native-lite-scope-next/tmp`; all commands exit 1 for the stated expected red):

| Red scenario | Command/log | Observed gap |
| --- | --- | --- |
| First-round implementation allowed worktree drift, alternate ledger path, and worktree override | `node --test .scratch/native-lite-scope-contract/arm-preflight.test.mjs`; `r2-red-current-2.log`, SHA-256 `168f576dc7124c9a768f07262dfe5762527af9a6599cccd49413de93f8546fe2` | Expected rejection assertions fail with actual CLI status 0. Its one checksum assertion in that run was an invalid fixture and is explicitly not counted as red evidence. |
| Prepared manifest could not be passed through the actual CLI using confined fixture dependencies | `node --test --test-name-pattern='prepareBatch' .scratch/native-lite-scope-contract/arm-preflight.test.mjs`; `r2-prepared-cli-red-2.log`, SHA-256 `13c2fa1fc79103924cd1f67184fcfa989c90d53118c5eebd56531389cf8059ad` | CLI ignored fixture injection and demanded the production ledger path; it did not yet offer a confined test-only dependency mode. |
| Empty symlinked target output was followed and accepted | `node --test --test-name-pattern='symlinked target' .scratch/native-lite-scope-contract/arm-preflight.test.mjs`; `r2-symlink-output-red.log`, SHA-256 `c5b205a9d0955b4b85b3fc246385c27861e6b947c09869da0ddbd21bae8ed84c` | Expected fail-closed rejection was missing. |
| Runtime launcher file changed while declared manifest/fingerprint stayed unchanged | `node --test --test-name-pattern='runtime verification reads' .scratch/native-lite-scope-contract/arm-preflight.test.mjs`; `r2-runtime-launcher-red.log`, SHA-256 `2cf80463479ef6d2cac72e22b36821d2545e22bab859be013a94930fbcb0ab76` | Expected actual launcher-byte rejection was missing. |

**TDD blocker, not waived:** the first R2 checksum-total test mistakenly called `sealed(events, 2)` while the fixture helper accepted only one argument. The extra total was ignored; `/project/tmp/pi-native-lite-scope-next/r2-pre-impl-current.log` therefore shows a fixture-level `Missing expected rejection`, not a behavioral red. The helper was corrected and genuine schema tests are green, but chronology cannot be repaired retroactively. A supplemental replay against the frozen first-round checker with a valid version-1 ledger and corrupted checksum failed as expected (`Missing expected rejection`) in `/project/tmp/pi-native-lite-scope-next/r2-first-version-real-ledger-replay-red.log`; it happened after implementation and is diagnostic only, not TDD compliance. Full audit: `/project/tmp/pi-native-lite-scope-next/r2-tdd-fixture-audit.md`. Root explicitly keeps this checksum-specific chronology gap as an overall acceptance blocker. Other R2 behavior reds listed above preceded their corresponding code fixes; first-round history remains non-TDD.

After their corresponding implementation changes, `node --test .scratch/native-lite-scope-contract/arm-preflight.test.mjs` passed 11/11, raw `/project/tmp/pi-native-lite-scope-next/r2-preflight-green-final.log`, SHA-256 `9fc6e58e79976d06d65204a2b090fd7869ab26c01e2f82f602201bce6f53ca70`. It includes actual `prepareBatch` output loaded by the spawned `arm-preflight.mjs` process using the test-only path-confined dependency option, then legal append plus retained output acceptance. The final legacy test command `node --test .scratch/native-lite-scope-contract/legacy-preflight-red.test.mjs` passed 3/3; raw `/project/tmp/pi-native-lite-scope-next/r2-legacy-baseline-final.log`, SHA-256 `88d5a544757501d16d309f7e815a560ca5e95dafc2248dcecbb56b9e45290a06`. `node --check` on both modules and tests plus `git diff --check` passed.

## R3 Real Runner Consumer

The real `run-rpc-arm.mjs` was invoked in each isolated worktree with `PI_BIN` set to a local mock executable. The mock only writes `argv`, cwd and selected environment fields to a marker, then exits 23; it cannot import Pi, extensions, a provider or make network requests. No controller changes were made.

Before repair, the matrix red ran `node --test --test-name-pattern='real RPC-arm runner' .scratch/native-lite-scope-contract/arm-preflight.test.mjs` from repo cwd with all TMP values set to the requested directory. Exit 1; all 16 arm/template cases stopped at the actual consumer assertion `manifest?.version !== 1` before mock spawn. Raw log `/project/tmp/pi-native-lite-scope-next/r3-runner-consumer-matrix-red.log`, SHA-256 `1114fa1b6c9336452d7063b81339242f5862cb1b4343eee19d1c2061c02446e0`.

The runner consumes manifest version 1, so new freeze fields are additive under that envelope. Both formal briefs now put the exact path contract in line 1. They include the consumer's required `plain-text reports` contract. S2 formal and topology briefs use the exact immutable precomputed reviewer diff sentence. All six calibration templates carry the shared execution/model/role/report/hash/Root-acceptance shell; semantic packets are evaluations of a supplied synthetic report, with the object verdict separate from whether the worker completed the evaluator task. Sealed expected outcomes live only in `calibration/expected-decisions.md` and are never copied into an evaluated prompt.

An intermediate mock run reached the runner but revealed the next literal contract mismatch: the six calibration shells needed the exact `plain-text reports` phrase. Raw `/project/tmp/pi-native-lite-scope-next/r3-runner-consumer-green-attempt1.log`, SHA-256 `b52b078dde9af20d43f6288d92b6817aa0e16c3f9d51817ad997a3e665ed6fcf`. After that correction, all 16 cases (formal S1/S2, S1 link, S2 topology, semantic A-D, Native/Lite pairs) passed runner preflight and produced the mock marker. Tests verify session/model/arm args and TMP variables equal the fresh batch root's `tmp`; runner exit 23 is deliberately expected. Raw `/project/tmp/pi-native-lite-scope-next/r3-runner-consumer-green-attempt2.log`, SHA-256 `0594fb652c5c8703d3df258a5a8c822ca5b45e901e9935e344e7015ee0a7398f`. This is startup-consumer validation only, not a successful controller arm, RPC handshake or provider/semantic experiment.

The final R3-focused suite, including the previous preflight checks and the real-consumer matrix, passed 12/12. Command: `node --test .scratch/native-lite-scope-contract/arm-preflight.test.mjs`, cwd `/home/tcuni-claw/pi/pi-planner-only`, `TMPDIR=TMP=TEMP=/project/tmp/pi-native-lite-scope-next/tmp`; exit 0. Raw `/project/tmp/pi-native-lite-scope-next/r3-preflight-final.log`, SHA-256 `13a9cc279086a3b766914a6263464d08388e6e18c9d11a00156413191ce022f3`.

## Release Dependency

Default `npm run test:release` still fails after typecheck and 7/7 isolated-release CLI tests because global pi-subagents cannot import missing `@earendil-works/pi-ai`. Root identified an already installed compatible pair at `/project/tmp/pi-planner-native-release-repro/compare-xh4zUD/node_modules/`.

Before release, compare read-only `package.json` versions and `src`/`agents` directories for candidate `pi-subagents` against `/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents`; also verify sibling `@earendil-works/pi-ai` exists and record its version. If versions/source/agents satisfy the already accepted isolated release contract, run `npm run test:release` with `PI_SUBAGENTS_DIR` set to that existing package root and the required external TMP variables. This uses no install/network access and does not claim the default global package is repaired. Preserve comparison and release logs/hash.

R2 actually ran the following from `/home/tcuni-claw/pi/pi-planner-only`, with all TMP variables at the designated external directory and no installs:

```sh
node -e 'for(const p of process.argv.slice(1)){const x=require(p); console.log(`${p} version=${x.version}`)}' /project/tmp/pi-planner-native-release-repro/compare-xh4zUD/node_modules/pi-subagents/package.json /home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/package.json /project/tmp/pi-planner-native-release-repro/compare-xh4zUD/node_modules/@earendil-works/pi-ai/package.json
diff -qr /home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/src /project/tmp/pi-planner-native-release-repro/compare-xh4zUD/node_modules/pi-subagents/src
diff -qr /home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/agents /project/tmp/pi-planner-native-release-repro/compare-xh4zUD/node_modules/pi-subagents/agents
PI_SUBAGENTS_DIR=/project/tmp/pi-planner-native-release-repro/compare-xh4zUD/node_modules/pi-subagents npm run test:release
```

The reused dependency comparison `/project/tmp/pi-native-lite-scope-next/reused-dependency-comparison.log` has SHA-256 `c495d53b7769049c5b3c0a3c5fb077c4d13d7819638234f6b7dee40c99a31c6e`. The latest release log `/project/tmp/pi-native-lite-scope-next/test-release-reused-r2.log` has SHA-256 `f3cfad46ad50ee93dfde52130301547cec26dd027bda4a210e541ce8bac5d74d` and exited 0. The preserved default failure is `/project/tmp/pi-native-lite-scope-next/test-release.log` from R1, SHA-256 `671924046dc44a1b530f9acd639fe651dddb616e6c241b4985dc9a361a955b4e`; it still records missing global `@earendil-works/pi-ai`.

## Concrete Calibration Materials

Inputs are under `calibration/inputs/`; expected decisions are kept separately in `calibration/expected-decisions.md` and must never enter evaluated prompts. They are new synthetic material and contain no old answer/report. S1's real candidate check was read-only verified: at the frozen candidate, `index.ts` declares `export interface ChildRunUsage` with `input`, `output`, `cacheRead`, `cacheWrite`, and `cost` (candidate lines 132-138). The link task asks only for that path/symbol/evidence. S2 topology input assigns `git rev-parse HEAD` exclusively to `oracle` and fixed-diff-only review to the no-shell `reviewer`. Four synthetic packets cover external unknown, answerable omission, unsupported zero/no-duplicate claim, and reviewer role overreach.

Use original frozen models/thinking: Root `tcuni/gpt-6.1-terra` high; S1 worker `tcuni/gpt-6-luna` medium; S2 oracle and reviewer `tcuni/gpt-6-luna` medium. Proposed live scope, only after separate Root launch approval:

| Calibration run | Mode arms | Wall stop | Per-run reported-cost stop | Expected result/evidence |
| --- | --- | ---: | ---: | --- |
| S1 link | `S1-native`, then `S1-lite`, same bytes | 5 min each | USD 1.25 each | Exact `index.ts` / `ChildRunUsage`, request fingerprint, child create/async terminal, report hash, actual Root acceptance JSON, associated usage events. |
| S2 topology | `S2-native`, then `S2-lite`, same bytes | 8 min each | USD 1.25 each | One oracle command receipt/report and one reviewer diff-only report; verify reviewer had no shell, distinct run IDs, exact reports/hashes, Root decision. |
| Each semantic packet A-D | S1 Native/Lite paired task for each packet | 4 min each | USD 0.25 each | Record the synthetic report's object-level verdict separately from whether the worker faithfully completed its evaluation task. Root independently decides both and compares the object verdict to the separately sealed expectation after freeze; no keyword-only judgment. |

Total proposed observed-cost allocation is USD 7.00 across 12 runs. Hold USD 1.50 for unassigned test/usage variance, making USD 8.50 the requested aggregate observed-cost stop cap. This is a proposal within the existing cumulative USD 30 authorization, not a reservation or permission to call providers. Current ledger reserved is USD 16.204782395, leaving at most USD 9.795217605 to the guard's strict $26 reservation cap; this arithmetic does not guarantee request reservations will fit. Do not treat USD 8.50 observed-cost cap as a USD 8.50 reservation envelope. Each actual provider request must independently pass the existing dynamic guard (`reservedUsd + requestEstimate < 26`); no extra reservation or automatic add-on is allowed. Reservations are not reported costs and are never added to them. Before any call, Root must calculate exact deduplicated cumulative reported usage and ledger reservation separately, confirm USD 30 cumulative headroom and current guard capacity, and approve per-run reported-cost stops. Stop at any run's cost/time cap, if cost cannot be read, at cumulative reported USD 26, if a request reservation would reach/exceed USD 26, or for lock, drift, unexpected role/terminal/report, or slot/resource issue. No retry/repair after a failed calibration without a new Root decision. The USD 1.50 control-session checkpoint remains a report-and-stop checkpoint, not additional provider budget.

The evaluator task and evaluated synthetic report have separate outcomes. After each semantic arm, Root records the child-task/content-evaluation result and a distinct `calibrationObjectVerdict` (`accepted`, `rejected`, or `incomplete`) for the synthetic report, with reason and evidence. A synthetic report expected to be rejected is not a rejected evaluation task: if the worker correctly identifies the issue with evidence and Root independently confirms the judgment against the sealed expectation, Root can accept the child review task through the runner's accepted-only contract and separately record the object-level rejection. The next calibration arm is gated only after Root has checked the actual report/hash, identity/terminal, task fidelity, object verdict against the sealed expectation and usage/cost evidence. An unexpected object verdict, incorrect rationale, incomplete evaluator task, or infrastructure failure stops; no auto-retry. This does not alter formal-run rejected-report eligibility or the formal stop rule.

Preparation and command proposal (do not execute until Root authorizes each calibration batch):

```sh
export TMPDIR=/project/tmp/pi-native-lite-scope-next/tmp
export TMP=$TMPDIR TEMP=$TMPDIR
export PI_NATIVE_LITE_BATCH_ROOT=/project/tmp/pi-native-lite-calibration-<unique-id>
export PI_NATIVE_LITE_BATCH_ID=<matching-unique-id>
export PI_NATIVE_LITE_ATTEMPT_ID=<unique-attempt>
export PI_NATIVE_LITE_S1_TEMPLATE_PATH=/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-scope-contract/calibration/inputs/S1-link-task.md
export PI_NATIVE_LITE_S2_TEMPLATE_PATH=/home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-scope-contract/calibration/inputs/S2-topology-task.md
node .scratch/native-lite-scope-contract/prepare-batch.review.mjs
```

For a semantic packet, replace only the S1 template path with its exact `semantic-*.md`; keep S2 template at the topology input. Each packet/run gets a new external batch root and attempt so reports cannot contaminate another case. The preparer permits custom paths only beneath `calibration/inputs/`. Then Root inspects generated pair hashes/manifests and runs the checker immediately before each one-arm gate:

```sh
env PI_NATIVE_LITE_BATCH_ROOT="$PI_NATIVE_LITE_BATCH_ROOT" PI_NATIVE_LITE_BATCH_ID="$PI_NATIVE_LITE_BATCH_ID" PI_NATIVE_LITE_ATTEMPT_ID="$PI_NATIVE_LITE_ATTEMPT_ID" PI_NATIVE_LITE_ARM=S1-native PI_NATIVE_LITE_SHARED_LEDGER=/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json node .scratch/native-lite-scope-contract/arm-preflight.mjs
```

After Root confirms that single arm, the proposed launch shell invocation supplies its named stops (example for the first S1 arm):

```sh
env BATCH_ROOT="$PI_NATIVE_LITE_BATCH_ROOT" BATCH_ID="$PI_NATIVE_LITE_BATCH_ID" ATTEMPT="$PI_NATIVE_LITE_ATTEMPT_ID" ARM=S1-native GATE_LOG_ID=link-s1-native-a1 ARM_DEADLINE_MS=300000 ARM_COST_STOP_USD=1.25 bash .scratch/native-lite-scope-contract/run-arm.review.sh.txt
```

Use `ARM_DEADLINE_MS=480000` for S2 topology or `240000` for each semantic packet; set the per-run cost stop from the table. Launcher/control TMPDIR/TMP/TEMP remain `/project/tmp/pi-native-lite-scope-next/tmp`. Root has explicitly approved the existing runner's child override: launched calibration Root/children use `$BATCH_ROOT/tmp` for `TMPDIR`, `TMP`, `TEMP`, and `PI_SUBAGENTS_TEMP_ROOT`. Each batch root must be a new `/project/tmp/pi-native-lite-<unique-id>/`, never this evidence root or a retired batch; prepare it via `prepareBatch`, then verify `realpath "$BATCH_ROOT/tmp"` is under `/project/tmp` and not `/tmp`. The launch script performs a fresh audit/status and requires interactive Root reconfirmation. The next arm gets another audit/status and checker. It remains review-only; no launch gate exists. Each calibration is excluded from formal sample/pair counts and formal manifests. Preserve command, cwd, launcher and child env subsets, slot audit/status, request fingerprint, terminal receipt, report bytes/hash, Root verdict/reason, usage association, wall time and raw logs in the batch evidence.

Evidence record for every run:

| Record | Required values |
| --- | --- |
| Frozen input | Batch/attempt/arm, exact brief and common-diff SHA-256, candidate commit, config/runtime/workspace hashes, model/thinking and role topology. |
| Invocation | Full command, cwd, selected env, slot audit/status, start/end and wall time, exit code. |
| Link | Request fingerprint/ID, child role/agent/run ID, async terminal, Root session/attempt ID, report path and byte hash. |
| Decision | Root accepted/rejected/incomplete note, reason and evidence references; accepted-only controller JSON if and only if accepted. For A-D compare rationale against the sealed expected file after records freeze. |
| Usage | Root and child usage/cost entries, shared-ledger event IDs and session correlation; explicitly mark missing data, never infer zero. |

## Still Blocked

The offline checker, legacy baseline and real-runner startup-consumer evidence have been reviewed by Root; existing-dependency comparison and release passed. Overall acceptance remains blocked on the checksum-specific TDD chronology exception, not an outstanding release run. See [Root final review](root-review-final.md) for the final decision, fees and evidence. No live calibration has run. Semantic judgments, true RPC completion, report/usage correlation under providers, and actual S2 role enforcement remain unverified. Once the process exception is resolved, prepare and verify only the initial S1 link pair before per-arm Root launch gates. Formal four-arm preparation/freezing still requires the later calibration evidence and current budget/lock/slot/runtime gates.
