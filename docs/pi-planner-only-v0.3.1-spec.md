# pi-planner-only v0.3.1 Spec — Fewer Root Turns per Task

> Scope: `bioShaun/pi-planner-only` after commit `756b2a6` (v0.3.0 plus the three U-6 follow-ups
> already landed). Target host unchanged: Pi 0.85.x with pi-subagents 0.65.x. Companion data:
> `.handoff/baseline/README.md` (U-6 baseline, three real Tasks, 2026-09-05) and
> `.handoff/closeout-0.3.0.md` (acceptance ledger and open items).

## Status

Draft, 2026-09-05. Authored by the Planner seat. Each L item is one acceptance-ledger entry; do
not renumber. Items are ordered by measured impact in the U-6 baseline, and that order is also the
execution order (§8). Rounds may be re-cut; item numbers may not.

## 1. Summary

U-6 measured Root at 60–78 % of Task cost while it never edited a file and read ≤ 6.7 KB of review
material. The cost is turn count × context re-read: 11–18 Root turns per Task, ~30–50k cached
tokens per turn. Most of those turns were spent on mechanics the extension inflicted on Root, not
on planning or review:

| Baseline finding | Root turns lost | Item |
|---|---|---|
| Every Task lost 2–3 Root turns and 1–2 worker runs to WorkerReport schema rejections that a parser could have repaired (`version: "1"`, `changedFiles` as objects, `unresolvedItems`, free-text `validation[].type`, missing `evidence.taskId`) | ~40 % of Root turns | **L-1** |
| Every correction or re-bind re-sampled the base evidence, so a correct diff was judged "over-reported / unreliable declaration" and forced a validator round plus a `blocked` ending (T3, both probes) | 3–5 per affected Task | **L-2** |
| A validator (oracle) delegation embedded a fresh TaskSpec and became its own Task, so Root's verdict landed on the validator's id and the implementation Task stayed `blocked` (T2) | 2 plus a wrong ledger line | **L-3** |
| `planner_verdict` refused a reviewed, `blocked` Task with "use /planner-only task reset", a command Root cannot run and which would not reopen the Task anyway (T1) | Task could not be closed at all | **L-4** |
| Root chose Task ids with a wrong date (`T-20260220-*` on 2026-09-05); harmless today but the id is the key for usage lines, rebinding, and the identity check, and it should not be a model choice | cosmetic | **L-5** |

v0.3.1 ships L-1 … L-5. Expected effect: Root turns per Task drop from 11–18 to roughly 6–9, and
every correctly executed Task ends `completed` with the verdict on the right id. Whether that holds
is re-measured in §7 before anything else is opened.

**Non-goals for 0.3.1** (decided on the U-6 numbers, see §10): fresh reviewer as the default;
per-round injection compression; a JSON-schema block in the worker prompt; explorer delegations
that name no Task (they still create a placeholder Task; not measured); the `bg_wait({all:true})`
registration race (pi-subagents side); Task store persistence, prefix write locks, worktree lanes.

---

# 2. Verified facts (2026-09-05, from the code at `756b2a6`)

These are the facts each item below leans on. Executors quote them, they do not re-derive them.

- `validateWorkerReport()` in `report.ts` rejects on: `version !== 1` (strict number),
  `changedFiles`/`risks`/`unresolved` not string arrays, `validation` not an array,
  `validation[].type` outside `test | build | lint | typecheck | manual | other`,
  `validation[].status` outside `passed | failed | not-run`, missing `validation[].summary`,
  missing `evidence` object or `evidence.taskId`, `evidence.taskId !== taskId`. There is no
  normalisation step before validation. The Root-facing rejection text (`orchestrate.ts`,
  "is not a valid WorkerReport … Delegate exactly one report-only correction") costs one Root turn
  and one worker run per strike; `MAX_REPORT_CORRECTIONS = 1`, so the second strike sends the Task
  to `blocked`.
- `beginDelegation()` in `orchestrate.ts` calls `captureEvidence()` and `store.setBaseEvidence()`
  unconditionally on every non-reviewer delegation, including corrections and re-binds. The
  PASS-boundary comparison (`compareWithRootSamples`, `evidence.ts`) attributes declared paths
  against the A-to-C delta from that base; a base sampled after the edits attributes nothing and
  yields `over-reported / unreliable declaration: <paths>`.
- Reviewer delegations are already invocations over an existing Task: `beginDelegation` records
  `{taskId, kind: "reviewer"}` and returns without creating, rebinding, transitioning, or sampling.
  Validator (`oracle`) and explorer delegations go through the worker path: an embedded TaskSpec
  creates a Task under its id; no TaskSpec goes through the RF-7 rebind rules or creates a
  placeholder Task; either way the Task transitions to `executing` and gets a fresh base sample.
- `rootVerdictRefusal()` treats `blocked` and `failed` as terminal
  (`TERMINAL_TASK_STATES = ["completed", "blocked", "failed"]`) and answers
  `Task X is already blocked; use /planner-only task reset to reopen.` The slash `task reset`
  is `store.abandon()` and transitions to `failed`; it does not reopen anything. `blocked` and
  `failed` are reopenable only by a new delegation (`blocked → executing`, `failed → executing`).
- `PLANNER_PROMPT` (`index.ts`) still contains one model-facing slash reference:
  `Use /planner-only task to inspect lifecycle state. /planner-only review is the operator's
  override; you record verdicts with planner_verdict.` The 0.3.0 close-out annotated it as
  "mandated"; it is not — Root cannot run it. The prompt byte bound from 0.3 (≤ 2500 chars) stands.
- Task ids: `createTaskId(now, sequence)` yields `T-YYYYMMDD-NNN` from `store.now()`.
  `store.create(spec)` uses `spec.taskId` verbatim when present. Root writes the id into the
  TaskSpec it embeds in the worker prompt, and the worker echoes that id in its WorkerReport, so
  the id in the prompt and the id in the store must stay linked (the identity check compares them).
- `ReviewResult.source` is `"reviewer" | "root" | "operator"`. A `TaskRecord` has `reports`
  (WorkerReports), `reviews`, `baseEvidence`, `lastComparison`, `reportCorrections`.
- Test runner: `npm test` (13 files, `node --experimental-strip-types`), `npm run typecheck`,
  `npm run test:e2e`. `naming.test.mjs` compares the `.ts` file list against the installed copy
  under `~/.pi/agent/git/github.com/bioShaun/pi-planner-only`, so it turns green only after
  push and `pi update`.

---

# 3. L-1 — Lenient WorkerReport normalisation

## Problem

Cheap workers (`glm-5-3-flash` in the baseline) produce structurally reasonable reports that miss
the exact schema. Each miss costs a Root turn, a worker run, and after the second miss the Task
is `blocked`. Every one of the observed misses was mechanically repairable.

## Contract

New pure function in `report.ts`:

```ts
export interface NormalisedReport {
	report: unknown;      // the repaired value, ready for validateWorkerReport()
	repairs: string[];    // one human-readable line per repair, empty when nothing changed
}
export function normalizeWorkerReport(value: unknown, context?: { expectedTaskId?: string }): NormalisedReport;
```

`extractWorkerReport()` (and therefore `handleWorkerResult`) calls `normalizeWorkerReport` on
every JSON candidate before `validateWorkerReport`. `ExtractedReport` gains `repairs: string[]`.
When a report is accepted with a non-empty `repairs` list, the Root-facing decision text carries
one line `Report normalised: <repairs joined by "; ">` and the stored WorkerReport is the repaired
one. Nothing is recorded in the Task for a report that still fails validation after repair.

## Behaviour — repairs (apply in this order, all idempotent)

| Field | Accepted input | Repair |
|---|---|---|
| `version` | `1`, `"1"`, `1.0`, `"1.0"`, missing | set to `1`; note `version "<raw>" → 1` when not already the number `1` (`version missing → 1` when absent) |
| `taskId` | missing or empty, `context.expectedTaskId` given | copy from `evidence.taskId` if present, else from `expectedTaskId`; note it |
| `status` | `done`, `success`, `succeeded`, `complete`, `ok` (case-insensitive, trimmed) | `completed` |
| `status` | `in_progress`, `in-progress`, `incomplete`, `partially_completed` | `partial` |
| `status` | `error`, `errored` | `failed`; every other unknown or missing value stays a rejection (the worker's status claim is not inferred) |
| `summary` | missing | `""` (validate already accepts an empty string) |
| `changedFiles`, `risks`, `unresolved`, `notes` | a single string | wrap in an array |
| same | array of objects | map each object to its first non-empty string among `path`, `file`, `filePath`, `name`, `text`, `summary`, `description`, `message`; objects with none of these stay and cause the existing rejection |
| same | missing | `[]` (`notes` stays absent) |
| `unresolvedItems`, `unresolved_items`, `changed_files`, `changedPaths` | present while the canonical key is missing | rename to the canonical key |
| `validation` | missing or `null` | `[]` |
| `validation` | a single object | wrap in an array |
| `validation[].type` | free text | map by case-insensitive substring, first match wins: `typecheck`/`tsc`/`type-check`/`types` → `typecheck`; `manual`/`inspect`/`review` → `manual`; `test`/`spec`/`jest`/`vitest`/`pytest`/`mocha` → `test`; `lint`/`eslint`/`prettier`/`biome` → `lint`; `build`/`compile`/`bundle` → `build`; anything else, including missing → `other`. *(Annotation 2026-09-05, R12: the `manual` group was moved ahead of `test` because `inspect` contains `spec`.)* |
| `validation[].status` | `pass`, `passed`, `ok`, `success`, `green`, `true` → `passed`; `fail`, `failed`, `error`, `red`, `false` → `failed`; `skipped`, `skip`, `not-run`, `not_run`, `not run`, `none`, `n/a` → `not-run` | canonical value |
| `validation[].status` | missing | `passed` when `exitCode === 0`, `failed` when `exitCode` is a non-zero integer, else `not-run` |
| `validation[].summary` | missing | `command` if present, else the raw `type` text, else `"(no summary)"` |
| `validation[].exitCode` | numeric string | parse to integer |
| `evidence` | missing | `{ taskId: <taskId> }` |
| `evidence.taskId` | missing | copy from `taskId` |
| `evidence.taskId` | present and `!== taskId` | **no repair** (unrepairable: two different claims of identity); existing rejection stands |

Not repaired, by design: missing `taskId` with no `expectedTaskId`, unknown `status`, a
`validation` entry that is not an object, `evidence` present but not an object. These stay
rejections with the existing text.

`compactWorkerReport` and rendering are unchanged; they receive the repaired report.

## Tests (`report.test.mjs`, `orchestrate.test.mjs`)

- Each row of the table above has one test that feeds the raw shape and asserts the repaired
  value plus the `repairs` note; plus one test asserting the three "not repaired" cases still fail
  `validateWorkerReport` with the existing messages.
- A fixture reproducing the baseline T1 first report (`version: "1"`, `changedFiles` as
  `{path, change}` objects, `unresolvedItems`, `validation[].type: "npm test"`, no
  `evidence.taskId`) is accepted in one pass by `handleWorkerResult`, the Task reaches
  `reviewing`, and the decision text contains `Report normalised:`.
- A report with `evidence.taskId` mismatching `taskId` is still rejected and still counts one
  report correction.
- `repairs` is `[]` for an already-valid report and the decision text has no `Report normalised`
  line.

---

# 4. L-2 — The base evidence sample belongs to the Task, not the delegation

## Problem

`beginDelegation` re-samples `baseEvidence` on every delegation. After the worker has edited files,
the correction delegation (report-only, no edits) sets a base that already contains the edits, so
the PASS-boundary A-to-C delta is empty and every declared path is reported as
`over-reported / unreliable declaration`. In the baseline this turned three correct diffs into
`revalidate` decisions, validator rounds, and `blocked` endings.

## Contract

- `TaskStore.setBaseEvidence(taskId, ref)` becomes write-once: it sets `baseEvidence` only when
  the record has none, and otherwise returns without change. New `TaskStore.clearBaseEvidence(taskId)`
  exists for the reopen path below.
- `beginDelegation` samples and sets the base only when `task.baseEvidence` is undefined, i.e.
  on the first writer delegation of a review round. Corrections, RF-7 re-binds, re-delegations
  after `failed`, and re-delegations after `blocked` keep the original sample as long as no
  WorkerReport has been recorded against it. Reviewer, validator (L-3), and explorer delegations
  never sample.
- *(Annotation 2026-09-05, R13 review.)* The base belongs to a **review round**, not to the Task's
  whole life. `setBaseEvidence` records `baseReportCount = reports.length`; when a later delegation
  finds `reports.length > baseReportCount` (a report was recorded and judged against this base),
  `beginDelegation` clears the base and re-samples. Otherwise a genuine second worker round after
  `changes_requested` would see the first round's paths as `in-scope paths changed after the
  report` and go stale. Report-only corrections never record a report, so the T3 case still keeps
  its A.
- The base is also cleared when the operator abandons the Task (`store.abandon`). A new Task
  always starts without a base.
- `describeComparison` output for a comparison whose base is older than the latest report gains no
  new wording; the existing `fresh`/`stale` labels apply as before. The decision block's evidence
  line shows the base's `finalGitRef` short SHA once (`base <sha7>`), so Root and the operator can
  see which A the comparison used.

## Tests (`orchestrate.test.mjs`, `task.test.mjs`)

- Baseline T3 shape: worker delegation samples base A (fake git runner reports HEAD `a1`), worker
  edits two paths, the first report is rejected (L-1 not applying — use an unrepairable one),
  a correction delegation for the same Task is launched while the runner now reports the edited
  tree; the corrected report declaring the two paths is accepted with a comparison that attributes
  both paths and no `over-reported` reason.
- `setBaseEvidence` twice on the same Task keeps the first ref; `clearBaseEvidence` then
  `setBaseEvidence` takes the new one.
- Second worker round: report recorded (base A1), `request_changes`, new worker delegation with
  the tree now at A2 → the new base is A2 and the round-2 report declaring only its own paths is
  attributed without an `in-scope paths changed` reason. *(Added at R13 review.)*
- `abandon` clears `baseEvidence`; a re-bind after `failed` (RF-6 path) does not.
- The evidence line in the decision text contains `base <sha7>`.

---

# 5. L-3 — Validator delegations are invocations over the Task under review

## Problem

A validator (`oracle`) delegation embedding a fresh TaskSpec creates a second Task. Root's verdict
then lands on the validator's Task, the implementation Task stays `blocked`, usage is split across
two ids, and the accounting reports a completed validator and a blocked implementation (T2).

## Contract

Resolution for `role === "validator"` in `beginDelegation`, mirroring the reviewer branch:

1. Determine the Task under review, first match wins: `ReviewRequest.taskId`; an embedded
   TaskSpec whose `taskId` (or L-5 alias) is an existing Task; exactly one distinct known Task id
   named anywhere in the prompt; `store.active()` when it is non-terminal, in the delegation cwd,
   and has at least one recorded WorkerReport.
2. Bound: record `{taskId, kind: "validator"}` in `delegations`, return `{task, warnings?}`.
   No `create`, no `bindSpec`, no `transition`, no base sample. If the embedded TaskSpec's id is
   not that Task's id, append the warning
   `Planner-only: validator TaskSpec id <X> ignored; validating task <Y>`.
3. Not bound: return only the warning
   `Planner-only: validator delegation names no Task under review; delegate the worker first, then re-delegate validation naming its taskId.`
   Nothing is created and nothing is recorded when the result arrives (same as the reviewer's
   unknown-task path).

Result handling: new `handleValidatorResult(task, text)`. It runs the same extract/normalise
(L-1) as the worker path with `expectedTaskId = task.taskId`. On a valid WorkerReport it appends
to a new `TaskRecord.validatorReports: WorkerReport[]` (not to `reports`; the identity check uses
the reviewed Task's id), leaves `state` unchanged, and returns
`[PLANNER-ONLY] Validator result for task <id> recorded: <n> validation entries, <p> passed, <f> failed, <r> not-run.`
followed by the rendered validation list and the usual verdict guidance. On invalid output it
returns the raw text (bounded by `RAW_OUTPUT_FALLBACK_CHARS`) with
`[PLANNER-ONLY] Validator output for task <id> is not a WorkerReport; judge it directly.` and does
not count a report correction. Usage for the run attaches to the reviewed Task's id (the ledger
already keys on the delegation's `taskId`).

`rootVerdictRefusal` "worker/reviewer run still pending" already covers validator delegations
through `hasPendingDelegation`; the text becomes `has a child run still pending`.

## Tests (`orchestrate.test.mjs`, `roles.test.mjs`)

- Validator delegation with a fresh TaskSpec id while Task `T-…-001` (with a report) is active in
  the cwd: no new Task in `store.list()`, delegation bound to `T-…-001`, warning about the ignored
  id, Task state unchanged, `baseEvidence` unchanged.
- Validator result with a valid WorkerReport: `validatorReports.length === 1`, `reports.length`
  unchanged, decision text starts with `[PLANNER-ONLY] Validator result for task`.
- Validator delegation with no resolvable Task: warning only, `store.list()` unchanged; its later
  result yields the "no longer in the Task store"/nothing-recorded path without throwing.
- `planner_verdict(pass)` after the validator run: refused while pending, accepted after the
  result arrives, and `completed` lands on `T-…-001`.

---

# 6. L-4 — Root can always close a reviewed Task; refusals never name a slash command

## Problem

T1: Root reviewed the diff correctly, the Task was `blocked` after exhausted corrections, and
`planner_verdict` refused with a slash-command hint. Root has no slash commands, and the hinted
command would have failed the Task rather than reopened it.

## Contract

- `TERMINAL_TASK_STATES` becomes `["completed"]` for verdict purposes. Rename the current constant
  to `FINAL_TASK_STATES` only if other callers need the three-state set (`store.active()`,
  `abandon`, stale-lock display); keep their behaviour. `isTerminalTaskState` is used by the
  verdict path only for `completed`.
- Transitions gain `blocked → reviewing` and `failed → reviewing`; `recordRootVerdict` moves a
  `blocked`/`failed` Task through `reviewing` before applying the verdict, so
  `pass → completed`, `request_changes → changes_requested`, `blocked → blocked`.
- `rootVerdictRefusal` rules, in order:
  1. `completed` → `Task <id> is already completed; verdicts are final. Start a new Task with a new TaskSpec for further work.`
  2. `pass`/`request_changes` with no recorded WorkerReport → existing text, unchanged.
  3. child run pending → `Task <id> has a child run still pending; wait for its result before recording a verdict.`
  4. fresh-mode rule → existing text, unchanged.
  A `pass` on a `blocked` or `failed` Task with a report is allowed and goes through the existing
  PASS-boundary resample; a stale comparison yields the existing `revalidate` decision, not
  `completed`.
- The exhausted-corrections text that sends a Task to `blocked` ends with
  `Root may still judge the last recorded report and evidence with git_audit and record planner_verdict, or re-delegate with the same TaskSpec.`
- `PLANNER_PROMPT` line `Use /planner-only task to inspect lifecycle state. /planner-only review is
  the operator's override; you record verdicts with planner_verdict.` is replaced by
  `Lifecycle state arrives in delegation results; the operator may override a verdict, you record yours with planner_verdict.`
  Length stays ≤ 2500 chars.
- Mechanical check: `grep -n "/planner-only" orchestrate.ts` → no hits.
  `grep -n "/planner-only" index.ts` → hits only inside the slash handler, its `Usage:` strings,
  and the `notify()` messages for the operator. No hit inside `PLANNER_PROMPT`, tool descriptions,
  or any string returned as a tool result.

## Tests (`orchestrate.test.mjs`, `index.test.mjs`, `task.test.mjs`)

- Task `blocked` with one report and fresh evidence: `planner_verdict(pass)` → `completed`, one
  usage line with `completed`.
- Same but stale evidence: decision is `revalidate`, state is not `completed` (the existing `revalidate` decision lands in `changes_requested`; annotated 2026-09-05, R12).
- Task `blocked` with no report: `pass` refused with the "no recorded WorkerReport" text;
  `blocked` verdict accepted.
- `completed` Task: refused with the new text; assertion that no refusal string returned by
  `rootVerdictRefusal` for any state/verdict pair contains `/planner-only`.
- `PLANNER_PROMPT` contains no `/planner-only` and is ≤ 2500 chars (extend the existing bound test).
- Operator override path (`/planner-only review`) still bypasses rules 2–4 and not rule 1.

---

# 7. L-5 — The Task id is issued by the store, never trusted from the model's date

## Problem

Root wrote `T-20260220-001` on 2026-09-05 twice. The id is cosmetic in the store but it is the key
for usage lines, RF-7 re-binding, and the report identity check, and a model-chosen date collides
across days and sessions.

## Contract

- `TaskRecord` gains `aliases: string[]` (default `[]`). `TaskStore.get(id)` and `require(id)`
  resolve aliases; `list()` and `active()` are unchanged. `TaskStore.create(spec)` accepts an
  optional `alias`.
- In `beginDelegation`, when an embedded TaskSpec's `taskId` is not an existing Task or alias and
  either (a) does not match `/^T-\d{8}-\d{3}$/` or (b) its `YYYYMMDD` part differs from
  `store.now()` in local time, the Task is created under `store.nextTaskId()` with the spec's id as
  an alias, the spec stored on the Task carries the generated id, and the warning
  `Planner-only: TaskSpec id <X> replaced by <Y> (generated); <X> is kept as an alias` is emitted.
  An existing Task keeps its id whatever its date (a Task started yesterday continues today).
- `validateWorkerReportIdentity` accepts `report.taskId` and `report.evidence.taskId` equal to the
  Task id or any alias; on acceptance the stored report is rewritten to the canonical id and
  L-1's `repairs` gains `taskId <alias> → <canonical>`.
- RF-7 named-id scanning (`resolveDelegationTarget`, `namedTaskIds`) resolves aliases through
  `lookup`, so a correction prompt naming the alias re-binds to the canonical Task.
- Usage ledger lines and `/planner-only usage` key on the canonical id; the Task's status line
  shows `aliases: <X>` when non-empty.
- `PLANNER_PROMPT` template line `"taskId":"T-YYYYMMDD-NNN"` is unchanged (Root still writes an
  id so the worker can echo it); the sentence after the template gains
  `The extension may replace the id; use the id from the delegation result afterwards.` within the
  2500-char bound.

## Tests (`task.test.mjs`, `orchestrate.test.mjs`, `roles.test.mjs`, `report.test.mjs`)

- Store with `now()` fixed to 2026-09-05: a TaskSpec with `T-20260220-001` creates
  `T-20260905-001` with alias `T-20260220-001`; `get("T-20260220-001")` returns it; the warning
  text matches.
- A TaskSpec with today's date and a well-formed id is created verbatim, no alias, no warning.
- A WorkerReport echoing the alias passes the identity check and is stored with the canonical id;
  a report naming an unrelated id still fails.
- A correction prompt naming the alias re-binds to the canonical Task (RF-7 rule 1).
- `usage.jsonl` line for that Task uses the canonical id.

---

# 8. Execution plan (rounds)

Executor roster and habits follow the pairing memory: cursor (`w2E:pA`) for complex rounds,
agy (`w2E:pB`) for the simple one; all in tab `w2E:t2`; Planner pane `w2E:p7`. One fenced
handoff per round under `.handoff/R12-…` onward, one report file each, strictly serial. Before any
round the Planner runs `slot audit` / `slot status` per the global rules (the suite is light; no
heavy jobs are expected). After each accepted round: commit, push,
`pi update git:git@github.com:bioShaun/pi-planner-only`, then `npm test` (naming test included).

| Round | Executor | Items | Files | Acceptance |
|---|---|---|---|---|
| R12 | cursor | L-1, L-4 | `report.ts`, `orchestrate.ts` (verdict + rejection text), `task.ts` (transitions), `types.ts`, `index.ts` (prompt line), tests | `npm test` green; `npm run typecheck` clean; grep rules in §6; prompt ≤ 2500 chars; T1 fixture accepted in one pass |
| R13 | cursor | L-2, L-3, L-5 | `orchestrate.ts` (`beginDelegation`, validator result), `task.ts` (store), `roles.ts`, `types.ts`, `report.ts` (identity), `index.ts` (status line, usage key), tests | `npm test` green; `typecheck` clean; T3 fixture attributes both paths; validator run creates no Task; alias round-trip |
| R14 | agy | README, README.zh-CN, CONTEXT, CHANGELOG `0.3.1`, `package.json` version | docs and manifest only | `npm test` green; README examples use placeholder rates only (no value from `~/.pi/agent/planner-only/pricing.json`) |
| R15 | Planner with the user | §9 re-measurement | `.handoff/baseline/` | two real Tasks measured; Root turns and closed-by-Root recorded |

R12 and R13 both touch `orchestrate.ts`, `task.ts`, `types.ts`, `index.ts`; they run
sequentially (R12 first). R14 depends on both.

Each executor handoff must state: the exact item text from this spec, the files it may edit and
create, the test commands, the byte bound on `PLANNER_PROMPT`, the rule that `usage.ts` imports
nothing from Pi (unchanged from 0.3), and the rule that `report.ts` stays a pure module.

---

# 9. Re-measurement and the 0.3.2 gate

After R14 is installed, run two real Tasks under the U-6 setup (same Root and worker models, one
Task per session, `slot cpu`). Collect per Task from `usage.jsonl` and the session log:

| Metric | 0.3.0 baseline | Target | Decides |
|---|---|---|---|
| Root turns per Task | 11–18 | ≤ 9 | whether L-1 covered the observed report shapes; new shapes go into the L-1 table |
| Tasks closed by Root on the implementation id | 1 of 3 | 2 of 2 | L-3 / L-4 |
| `over-reported` reasons on correct diffs | 3 of 3 | 0 | L-2 |
| Root share of cost | 60–78 % | measured only | fresh reviewer default (0.3.2), still not decided by opinion |
| Injected KB × remaining Root turns | 4–14 KB × 11–18 | measured only | injection compression (0.3.2) |

Append the numbers to `.handoff/baseline/README.md` under a `0.3.1` heading.

---

# 10. Decisions (resolved 2026-09-05)

1. **Fresh reviewer default: not now.** Review-phase turns were 1–5 of 11–18 Root turns; the
   lever is fewer mechanical turns (L-1 … L-4). Revisit at §9 with Root share re-measured.
2. **Injection compression: not now.** 4–14 KB per Task id is secondary to turn count; revisit
   at §9.
3. **No JSON-schema block in the worker prompt.** The parser tolerates the shapes cheap models
   actually emit; growing the worker prompt spends worker input tokens on every run to save a
   correction that L-1 already removes.
4. **Unknown `status` and conflicting `evidence.taskId` stay rejections.** The worker's completion
   claim and its identity claim are not inferred by the extension.
5. **Explorer delegations keep today's behaviour.** They were not in the baseline; a placeholder
   Task for an explorer is cheap and does not reach the verdict path. Logged as a 0.3.2 candidate.
6. **Model-chosen ids are aliased, not rejected.** The worker echoes whatever id was in its
   prompt; the extension cannot rewrite the prompt, so the alias is what keeps the identity check
   honest.
7. **README rates stay placeholders.** No example may carry a real value from the user's
   `pricing.json`.
