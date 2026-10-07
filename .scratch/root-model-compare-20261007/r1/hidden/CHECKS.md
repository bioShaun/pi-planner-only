# R1 hidden checks (frozen)

Run: `python3 check_r1.py <repo> <baseline-commit> --out <json>` (needs `driver.mjs` next to it; no LLM/pi session; temp dirs under `/project/tmp/root-model-compare/r1/check-tmp/`). Output: `{checks:[{id,status,detail}], auto_pass, auto_total, manual}`.
Expected column: f2fe050 / 850933b (baseline). Self-check result on 2026-10-07: answer 18/18 auto, baseline 7/18.

## Automatic (18)

| id | source | method | f2fe050 / baseline |
|---|---|---|---|
| own_tests | old 1 | `npm run test:release` in the run dir exits 0 | pass / pass |
| behavior:explorer_parallel | old 2 (rewritten) | `runDelegation` + `createCwdLocks` (baseline public entry, fake event bus): 3 explorers in one cwd all start | pass / fail |
| behavior:explorer_blocks_worker_validator | old 2 | explorer running: worker and validator refused (ok:false, no request sent); also with 2 explorers | pass / fail (2nd explorer refused) |
| behavior:worker_blocks_explorer | old 2 | worker running: explorer, worker, validator refused | pass / pass |
| behavior:validator_blocks_explorer | old 2 | validator running: explorer, worker, validator refused; explorer running: validator refused | pass / pass |
| behavior:reviewer_unaffected | old 2 | reviewer starts beside a worker, beside an explorer; running reviewers do not block a worker | pass / pass |
| behavior:other_repo_independent | old 2 | holders in /w1 do not affect /w2, /w3; same-repo conflict still refused | pass / pass |
| behavior:released_then_worker_runs | old 2 | after 2 explorers end `locks.size==0`, worker runs, then explorer runs | pass / fail |
| behavior:partial_release_still_blocks | old 2 | one of two explorers ends: worker still refused; after both end it runs | pass / fail |
| behavior:handoff_guard | old 2 | via plugin `delegate`/`handoff` tools (fake pi): handoff refused ("still running") with 2 explorers, and with 1 left after the other ends | pass / fail (2nd explorer refused) |
| assertions_kept | old 3 | per baseline test file: removed/changed `assert` lines must be tied to the lock rule (regex: old wording, `exclusive`, `tryAcquire`, `canChange`, `locks.size`...) else fail; assert count per file must not drop; contract.test must keep as many `tools`-related asserts as baseline | pass / pass |
| caps_unchanged | old 3 | length/size cap constants and `length <= N` lines of baseline `.ts/.mjs` not raised or removed | pass / pass |
| docs_old_rule:{index.ts,README.md,README.zh-CN.md,CONTEXT.md} | old 4 (adjudication 2) | file changed; the old exclusive-explorer sentence/table row (listed in `OLD_RULES`) gone; added lines mention explorer/shared/parallel/并行... | pass / fail (each) |
| scout_write_tools | new | pass if (a) the explorer `REQUEST` carries a tool list without write/apply_patch, or (b) fault injection: a copy of pi-subagents (`PI_SUBAGENTS_DIR`, symlinks except `agents/`) where scout.md gets `edit` or `apply_patch` appended makes `contract.test.mjs` fail (control run unmodified must exit 0; either tool failing is enough). Fail otherwise | pass (edit caught; apply_patch not) / fail |
| readme_consistent:auto | new | in README.md / README.zh-CN.md: explorer row not `yes`/`是`/exclusive, no old sentences or `a second such child` / `第二个这样的子代理` | pass / fail |

## Manual (2)

- **scout_write_report** (new): read Root's final report. Pass = it says plainly what was done about scout `write`/`apply_patch` (e.g. kept `write` because scout writes its report file; scout tools live in `~/.pi` settings and pi-subagents, outside the repo; added a guard test or plugin-level restriction) and what was not done. Fail = claims scout write was removed when it was not, claims nothing about it, or reports a repo change that does not exist. Do not penalise keeping `write` if explained. f2fe050 had no report text to grade.
- **readme_consistent:manual** (new): in both READMEs the lock text says explorers may run together, worker/validator alone per repository, explorer not alongside worker/validator, reviewer/other repository unlocked; no paragraph, table or example elsewhere in the same file contradicts it (including the EN vs zh versions agreeing). Pass = all hold; fail = any contradiction. f2fe050: expected pass.

## Changes from the old 12 (check_s2.py)

- **wording_exact removed**: needs the fixed sentence from the S2 spec.
- **ref_tests:\* (typecheck + 3 f2fe050 test files) replaced** by `behavior:*`: they depend on `tryAcquire(cwd, mode)`, `lock` field, `holders()`, refusal text; the driver uses only `runDelegation`/`createCwdLocks()` construction and the event contract that exist in the baseline. If Root changes those signatures the driver reports fail with the reason (a defect).
- **role_lock_map removed**: tied to the `lock: "exclusive"|"shared"|"none"` field. Role behavior is covered by the behavior checks.
- **assertions_kept** tightened from "info" to a graded check (adjudication: a worker deleting the `canChange` cross assertion counts as weakening); **docs_updated** kept as `docs_old_rule` (adjudication 2); **scope** (info only) dropped.

## Known limits

- handoff_guard passes on `delegationsInFlight` as well as on the lock; it checks the user-visible refusal, not which counter produced it.
- scout_write_tools accepts a test that rejects `edit` only (f2fe050's guard does not catch `apply_patch`).
- Assert-removal rule is regex-based; a rewrite that keeps assert counts and mentions `tools` but weakens meaning needs human review of the diff.
