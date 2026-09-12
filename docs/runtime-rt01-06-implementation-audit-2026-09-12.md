# RT-01–RT-06 implementation and test audit

Date: 2026-09-12. Audited HEAD: `daf5716e90508d7ce45d0fafa4b8b2898aeea85a`.

## Scope and method

Code/test research against `docs/runtime-session-143619-2026-09-11-optimization-spec.md`, especially contracts at lines 157–256 and acceptance B01–B24. Read root `AGENTS.md`, `CONTEXT.md`, `docs/agents/domain.md`, and the research skill. No applicable nested docs instructions or ADR files were found. This is the code-focused research supporting the companion runtime evidence report and next-round spec.

The working tree was clean before research and HEAD remained unchanged through checks. References below are repository-relative physical line numbers at this HEAD, not the spec's historical source coordinates. Only this audit document is added. Runtime home sessions, ledgers, metadata, saved outputs, and installed home packages were not inspected. Historical counts and named run IDs are acceptance targets from the spec, not independently verified observations here.

**Conclusion: the spec's “implemented; host replay pending” summary overstates current implementation coverage. All six RT areas have code, but several contracts are missing at the adapter boundary or contradicted by existing behavior/tests. Passing the offline suite does not establish B01–B24 host acceptance.**

## Checks executed

| Exact command | Outcome |
|---|---|
| `git status --short && git rev-parse HEAD` | Success; clean initial tree; HEAD as above. |
| `npm run typecheck` | Exit 0; `tsc --noEmit` passed. |
| `HOME=/tmp/opencode PI_CODING_AGENT_DIR=/tmp/opencode npm test` | Exit 0; all suites in `package.json:55` passed, including RS and RT suites. Environment overrides isolate default home/runtime access. The A04 permutation test took approximately 15.06 seconds. |
| `PI_CODING_AGENT_DIR=/public/pi/pi-planner-only/node_modules PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` | Exit 1; “pi-subagents is not installed; public host contract is unavailable”; release gate reported §G unverified/FAIL. The script resolves `<PI_CODING_AGENT_DIR>/npm/node_modules/pi-subagents`, so this deliberately workspace-only invocation could not exercise the installed-home contract. This is an unavailable-contract failure, not a demonstrated incompatibility. |
| `git status --short && git diff --check && git rev-parse HEAD` | Success before document creation; tree remained clean and HEAD unchanged. |
| `git diff --check && git status --short && git rev-parse HEAD` | Success after document creation; only this audit was untracked; HEAD unchanged. Note that ordinary `git diff --check` does not inspect an untracked file. |

No model calls, new host session, runtime repair command, or historical host replay was run. E2E's existing budget section only checks accepted schema shapes (`e2e.pi-subagents.test.mjs:309–399`); even a pass there would not prove counting, interception, or batch behavior. Its package lookup and release-gate handling are at lines 68–105.

## Principal implementation findings

### 1. RT-01 grace is fixed at 15 seconds, with incomplete notification-race delivery

- **Actual value: hard-coded 15,000 ms, polling every 250 ms**, not a configurable default: `orchestrate.ts:3699–3734`, particularly 3717–3720. No grace option is used by this implementation.
- If a notification consumes the run during the grace loop, the processed-ID branch returns `content: []` (`orchestrate.ts:3719`). If it consumed the run before recovery begins, `authorizedWaitId` rejects processed/unregistered IDs (`orchestrate.ts:3677–3688`). Neither branch retrieves the recorded report or its revision for the promised “already ingested through notify” response.
- Grace exhaustion returns only a generic reason (`orchestrate.ts:3724–3727`), rendered directly by `index.ts:1352–1357`. It omits `outputRef` and the async-output directory. Pending run-state does carry `nextAction: retry-output-reconcile` in `orchestrate.ts:1675–1678`, but that field is not included in this wait response.
- The completion store clears `lastError` on loaded/recorded transitions (`completion.ts:365–381`). **It does not preserve `lastErrorHistory`**; the RunRecord type has only `lastError` (`completion.ts:51–95`). This contradicts the spec's S02 summary that history is retained; the core requirement to clear the error does have implementation.
- Validator handling marks a bound execution `terminal/recorded` and clears its error, but puts `judged-directly` in **terminalReason**, not ingestionState (`orchestrate.ts:4922–4931`). `completion.ts:62` has no `judged-directly` enum. This also happens when raw output is delivered for future judgment, before Root actually judges it.
- Session fallback has an initialization defect: construction uses env/provenance/`unknown-session` (`orchestrate.ts:846–849`); the adapter immediately installs provenance created without context (`index.ts:379–380`), whose fallback session ID is `unknown` (`index.ts:158–166`). `setLoadedProvenance` only replaces `runSessionId` when it equals `unknown-session` (`orchestrate.ts:882–886`). Thus an env-less initial `unknown` can remain latched even when `session_start` installs real provenance (`index.ts:1242–1245`). The filename fallback is the entire timestamp-plus-UUID stem, not the UUID alone. Status prints provenance (`index.ts:1547–1551`) without a dedicated unknown-session warning.

### 2. RT-02 successor metadata exists, but public acknowledgement and recovery semantics are incomplete

- Reciprocal successor storage exists (`task.ts:1412–1418`, restoration at 1470–1481); TaskSpec parent/commit fields and closure decisions are exercised by `rs02.test.mjs:263–337`.
- **Root cannot supply the new acknowledgement through `planner_verdict`.** The schema and execute parameter type omit it (`index.ts:1131–1174`), and the call forwards only findings/source (`index.ts:1207–1210`). The internal method supports it (`orchestrate.ts:3797,3855–3856`), so direct helper tests bypass the missing public contract.
- Attribution uses the union of truth paths across **terminal** successors (`orchestrate.ts:1834–1854`), rather than requiring the referenced successor to be completed. It can classify paths jointly covered by multiple successors even when no single owner exists. Terminal failed/blocked successors are not excluded by this selection. Matching path names does not establish that a later edit of the same path came from that successor.
- The committed branch checks HEAD changed, clean working tree, and committed-path membership (`orchestrate.ts:1856–1867`). It does not perform the required empty `git diff <C_report tree> HEAD -- <truth paths>` comparison. It also requires successor candidates/truth paths first, so a clean HEAD advance alone is not sufficient. The preceding superseded branch can win before committed attribution.
- Review acknowledges only metadata kind/ID/link membership (`review.ts:495–525`); it does not independently verify completed successor state. Unacknowledged metadata yields `closed-superseded` (`review.ts:785–804`). Export omits reciprocal successor/parent fields from linkage (`usage.ts:1496–1516`).
- **B08 is contradicted by the live review path.** Applying any revalidate decision with an evidence key increments recovery immediately (`review.ts:871–875`; `task.ts:1676–1685`), without a dispatch. `recordRootVerdict` calls that path (`orchestrate.ts:3859–3867`). Existing integration assertions explicitly expect a stale pass to increment recovery to 1, then repeated passes to block (`orchestrate.test.mjs:7254–7291`). The RT B08 test only calls pure `decideReview` and observes no mutation (`rs02.test.mjs:339–355`); it does not test application.

### 3. RT-03 repair is real; raw judgment and its export are only partial

- Repairable schema aliases are exercised by `rt03.test.mjs:8–24`; the normalizer is wired into ingestion, with repairs displayed (`orchestrate.ts:4750–4755`, validator equivalent 4972–4977).
- Structured irreparable output is retained in `rawReport`, and the Task enters `report-invalid` rather than immediately blocked (`orchestrate.ts:4653–4675`). Retention is truncated at `RAW_OUTPUT_FALLBACK_CHARS` (4657); the response explicitly limits this path to a structured irreparable envelope (4711–4715), while prose still requests report correction.
- Internal Root judgment records `reportSource: raw-judged` and a proposed next revision number when there is no prior report (`orchestrate.ts:3818–3859`). It does **not** append a report revision containing the raw summary. If a prior report exists, the same code selects that report and `reportSource: worker` instead. The export linkage omits `reportSource` (`usage.ts:1496–1516`).
- Bound validator execution sampling/report recording is implemented (`orchestrate.ts:4898–4931`). The RT-03 test itself only checks parser results, transitions, contextPack validation, and direct rawReport assignment (`rt03.test.mjs:26–46`), not a full invalid-output → public verdict → export flow or the original T-024/T-029 saved outputs.

### 4. RT-04 exploration counting is a helper, not an active host integration

- `floors.ts:15–56` recognizes read/grep/find/ls and listed bash inspection patterns and provides one-shot soft/hard notices at default 16/20 calls. `orchestrate.ts:1016–1031` wraps this in an in-memory **Task-keyed** map.
- **No tool-result handler calls the exploration counter or injects these notices.** The actual handler routes bg_wait, review-leak accounting, and subagent completion (`index.ts:1340–1397`); child extensions are disabled by the early child return (`index.ts:317–321`). The helper therefore does not establish unified Worker exploration enforcement, next-turn instructions, or a parseable partial checkpoint after hard interception.
- Initial Workers omit a default tool hard limit, but correction Workers still receive the bounded default **20** (`floors.ts:75–91,346–361`). Explicit caller/TaskSpec tool limits can also be 20 (`floors.ts:365–396`). “Worker hard is no longer 20” is only true for the initial default, not all Worker launches.
- contextPack is retained/validated in TaskSpec (`task.ts:471,531–539,873,1072`), with a serialization test (`rt04.test.mjs:38–45`). No readFirst >60% dispatch warning is implemented in the delegation path. The RT test does not execute a Worker or reproduce T-016 within 20 calls.
- No dedicated repository host counting/interception/batch probe artifact was found. The historical distribution in the target spec is not the new-build probe required by B13. `rt04.test.mjs:10–36` tests synthetic helper calls, not C/5c4589a5's sequence or host interception.

### 5. RT-05 closes one attribution fallback, but metadata, turn binding, and export remain incomplete

- Orphan harvest now resolves a session run or uses `unattributed`, instead of charging the active Task (`index.ts:728–755`; `orchestrate.ts:889–896`). This is a substantive improvement.
- It still scans all artifact directories, has no transcript-under-current-session ownership fallback, and attaches the **current Root session filename/provenance as sessionHint**, rather than inferring the foreign source session from transcriptPath (`index.ts:745–750`). `childFromMeta` only adds outcome/sessionHint (`index.ts:572–586`); ChildUsage lacks `sessionId`, `sourceDir`, and `metaTimestamp` (`types.ts:599–608`).
- The “no automatic store.active attribution” contract is not globally satisfied: unbound Explorer delegation assigns `accountingTaskId` using `activeForCwd(cwd) ?? active` (`orchestrate.ts:2840–2864`), and review-leak attribution still uses active (`index.ts:1362–1367`).
- Root usage no longer defaults every assistant message to the active Task: it uses a collected target set or untasked (`index.ts:1399–1422`). But targets are added only in the subagent delegation branch (`index.ts:1305–1333`), **not bg_wait/planner_verdict/git_audit**, so those required cases become untasked. Multiple targets collapse to the last insertion. The collection is cleared at message_end, so actual host ordering of message_end versus tool_call also needs acceptance coverage.
- **The public usage export omits the usage ledger and loose entries.** `index.ts:1818–1821` calls `orchestrator.exportEvidence`, which supplies only tasks/runRecords/fingerprint (`orchestrate.ts:907–914`). Consequently live untasked Root usage and orphan foreign usage without a Task snapshot do not reach it. The pure export test supplies `usageEntries` directly (`rt06.test.mjs:19–27`), bypassing this omission.
- Export's categories are root/children/unattributed, not mutually exclusive in-session/foreign/untasked (`usage.ts:1540–1542`). Passing a bare `entry.child` to `exportTaskUsage` at 1560 does not count its tokens: that helper only reads nested root/children (1372–1399). Foreign breakdown can count that child separately, so its totals need not agree with usage totals. Linkage also omits successors/parent and raw reportSource.
- Repair functions and an explicit file-based command exist (`usage.ts:193–258`; `scripts/repair-t004-ledger.mjs:17–20,61–98`). The synthetic 79-child test checks removal, sessionHint existence, idempotent pure-function rerun, and an already-clean wrapped snapshot (`rs05.test.mjs:104–145`). It is not shutdown replay or verification of actual T-004 membership.
- Repair preserves moved child values and sourceTaskId, but rewrites source records/files rather than retaining the full original snapshot. CLI cross-file writes are separately atomic, not transactional; deduplication of ledger-only moves uses only `usageRepair.moved` from this invocation (`scripts/repair-t004-ledger.mjs:68–70`), not already-existing unattributed records. A partially repaired pair can append a duplicate. No CLI interruption/recovery test was found; no repair was executed here.

### 6. RT-06 commit, oracle, ceilings, and metrics need handler-level completion

- `git_commit` is a real registered primitive with completed-state checking, dirty-path refusal, staging/commit, and fallback npm checks (`index.ts:998–1069`). However, its allowed path set includes the Worker's declared changedFiles in addition to execution truth (`1025–1034`); gate reuse trusts the latest Worker validation type/command/status, not a recent oracle result (`1043–1053`). Gates are fixed npm typecheck/test, not TaskSpec-declared commands; executions use the shared 15-second timeout (`index.ts:75,1056`). No explicit allowPush path exists. Success returns text/details without recording committed completion attribution or successor linkage (`1062–1069`).
- **Automatic oracle is a steering prompt, not automatic launch.** Worker completion calls a once-per-Task callback (`orchestrate.ts:4639–4642`), whose adapter implementation merely `sendMessage`s serialized oracle input with triggerTurn (`index.ts:369–377`). It does not invoke a subagent tool, await an oracle, aggregate reviewer/oracle completion, or guarantee overlap or ≤2 Root calls. The dedup set is in-memory and Task-wide, not report-revision scoped. `rt06.test.mjs` contains no oracle scheduling assertion.
- **Root ceiling is only an explicit-range check.** `rootReadLimitNotice` returns no limit for omitted ranges or non-finite values (`index.ts:248–255`); it does not impose a default 200-line slice. Its tool-call block executes before disabled-policy handling (`index.ts:1287–1298`), so explicit oversized reads are blocked even with planner-only disabled. Tests only cover explicit 200 versus 201 (`rt06.test.mjs:16–17`).
- Notification boilerplate is still appended on each relevant result (`orchestrate.ts:4705–4707,4750–4755,4972–4977`); no first-occurrence reference replacement or same-event-count byte comparison is demonstrated.
- Status hides active Task when **there are no delegations**, but otherwise uses global `store.active()` (`index.ts:1564–1568`). This reduces the idle stale display, but is not selection by current session/cwd; it also hides a Task awaiting Root review after its delegation ends. `rt06.test.mjs` has no status-handler test.
- Breakdown fields exist (`usage.ts:1318`), but envelopeRepairs sums reportCorrections plus optional report repair metadata (`1564–1571`), not reliably repaired-envelope count. Successful normalization is displayed from transient `extracted.repairs`, rather than durably counted at ingestion (`orchestrate.ts:4607–4637,4753–4755`). Budget counting expects run fields/error codes (`usage.ts:1327–1330,1573–1574`) that the disconnected exploration helpers do not persist. Runs from durable records and delegations are concatenated without deduplication (`1415–1423`), and foreign contributions can be added from both runs and entries (`1573–1593`). B24's 3/2/28/79 is not reproduced by existing RT tests.

## Acceptance matrix: every B item

“Partial” describes code/test coverage, not a host pass. “Missing/contradicted” means a required behavior is absent or existing behavior conflicts. All historical new-build host replays remain unverified in this audit.

| Item | Code/test assessment | Existing evidence and remaining contract |
|---|---|---|
| B01 | Partial | Fixed grace and completion idempotency exist. `rs01.test.mjs:424–511` permutes synthetic receipt/recovery arrivals; its “wait” registers a receipt (490–492), and output is written after the first awaited action (496–497). It does not test output/notify arriving at 0/15 s during one wait or assert report-bearing race responses. See finding 1. |
| B02 | Partial | Grace timeout and retry state exist, but response lacks outputRef/directory/revision and notification-consumed retries are not report-delivering. Same A04 test exercises late output, not the full never-output response contract. |
| B03 | Partial | Bound validator terminal/recorded update exists (`orchestrate.ts:4922–4931`); no nine-oracle fixture replay/status assertion and no judged-directly ingestion enum. |
| B04 | Missing/contradicted in env-less adapter flow | Provenance fallback exists but initial unknown can latch; filename stem differs from UUID; missing explicit warning. `rs01.test.mjs:31–77` tests fingerprints, not both requested starts/run-state names. |
| B05 | Partial | Pure supplied-comparison tests (`rs02.test.mjs:263–337`) cover closure decisions; actual attribution, public acknowledgement, commit primitive linkage, and complete T-026 chain are not proved. |
| B06 | Partial | Unknown-path freshness still routes conservatively; same-path external edits can be attributed by path membership. Existing stale-pass integration (`orchestrate.test.mjs:7248–7291`) is not a successor-plus-foreign-edit → dispatched revalidation → completion replay. |
| B07 | Partial | Reciprocal links exist; test checks one correction link (`rs02.test.mjs:284`), not all three Tasks closing. Export has no reciprocal lineage fields. |
| B08 | Contradicted | Applied stale pass increments recovery without dispatch (`review.ts:871–875`); existing integration requires it (`orchestrate.test.mjs:7254–7258`). The RT pure test does not cover mutation; no 13-case replay. |
| B09 | Substantial local coverage | Task-id-only rebinding and sentinel noncreation are tested (`rs02.test.mjs:357–372`); these are binding/store tests, not named host run replays. |
| B10 | Partial | Synthetic normalization is tested (`rt03.test.mjs:8–24`); original two saved outputs are not repository test inputs verified here. |
| B11 | Partial | report-invalid/raw-judged fields exist; no persisted raw-summary report revision or reportSource export; RT test merely assigns rawReport (`rt03.test.mjs:42–46`). |
| B12 | Partial | Validator records its own execution sample/report (`orchestrate.ts:4898–4931`). Existing lifecycle machinery covers correction routing, but the RT-03 suite does not replay the combined bound-validator/export and T-004 writable-correction scenario. |
| B13 | Missing host probe | E2E budget schema checks are not count/intercept/batch execution. No new-build probe artifact or 87-interception fixture establishing all three contracts found. |
| B14 | Partial helper only | Bash classification and one-shot notice are tested (`rt04.test.mjs:10–36`); no adapter wiring, observed sequence replay, or universal Worker hard≠20 guarantee. |
| B15 | Partial schema only | contextPack roundtrip tested (`rt04.test.mjs:38–45`); readFirst warning and ≤20-call Worker outcome absent. |
| B16 | Unproved integration | Partial/checkpoint machinery from RS exists, but no active unified hard-trigger integration; RT-04 test never produces a terminal/recorded run with evidence-bearing partial. |
| B17 | Partial | Harvest no longer falls back to active Task; foreign source provenance incomplete. The 79 synthetic records are a repair-function test, not exit-handler replay. |
| B18 | Partial | No target maps to untasked (`index.ts:1411–1421`); no replay of the first 15 turns/T-013 preservation; required nondelegation call bindings absent. |
| B19 | Partial | Pure repair 79-record test passes (`rs05.test.mjs:104–145`); live export omits loose usage and lacks the three-way conserving partition. Actual T-004 and CLI cross-file recovery unverified. |
| B20 | Partial | Primitive handler exists; `rt06.test.mjs:6–14` tests argv/path helpers, not handler gate failure, git operations, six-commit replay, or zero Worker invocations. Truth/gate/commit-record contracts incomplete. |
| B21 | Missing actual automatic scheduling | Steering-message callback only; no launch/overlap/aggregate wait/tool-count assertion (`index.ts:369–377`; `rt06.test.mjs:1–35`). |
| B22 | Partial | Explicit 201-line helper refusal tested; omitted-range default and boilerplate deduplication absent; no 138 KB baseline comparison. |
| B23 | Partial | No-delegations display implemented (`index.ts:1564–1568`); global active fallback remains when any delegation exists; no RT status test. |
| B24 | Partial fields only | Synthetic 1 superseded/1 committed/2 corrections/1 foreign child test (`rt06.test.mjs:19–33`); no 3/2/28/79 replay. Live export inputs and durable counting do not support the claimed complete breakdown. |

## What constitutes remaining acceptance

First close the implementation gaps above, especially adapter acknowledgement, applied recovery counting, exploration hook integration, session initialization, export input/shape conservation, and actual oracle scheduling. Then test those paths through the existing real-handler harness rather than only supplied helper inputs. Host acceptance remains a separate run with a verified loaded fingerprint and the spec's named timing, budget, lineage, and attribution scenarios. Offline PASS, helper field existence, the spec's own status column, and schema-only E2E checks are not substitutes for that acceptance.
