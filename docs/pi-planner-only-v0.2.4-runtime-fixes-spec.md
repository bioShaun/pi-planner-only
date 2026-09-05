# pi-planner-only v0.2.4 Runtime Fixes Spec

> Scope: `bioShaun/pi-planner-only` after commit `a692369` (v0.2.3). Target host: Pi 0.85.x with
> pi-subagents 0.65.x. Companion assessment: `.handoff/assessment-2026-09-05.md` (untracked).

## Status

Draft, 2026-09-05. Authored by the Planner seat; each RF item is implemented as one fenced round.
The RF numbering is the acceptance ledger; do not renumber.

## 1. Summary

The purpose of this extension is cost: an expensive Root model (planning, arbitration) delegates
execution and bounded review to cheap child models. v0.2.3 has three defects that defeat that
purpose on the installed host, plus a small hygiene list:

- **RF-1** Evidence attribution ignores committed work and mis-attributes edits to files that were
  already dirty at delegation time.
- **RF-2** With pi-subagents' default `async: true`, the WorkerReport never reaches Orchestration:
  the result is delivered as a `subagent-notify` custom message, not as a `subagent` tool result.
- **RF-3** The E2E contract test imports a subpath pi-subagents 0.65 removed; role-downgrade
  coverage is currently unverified.
- **RF-4** The guard can be disabled per machine but not force-enabled per session.
- **RF-5** Small correctness and documentation items found in review.

Non-goals (unchanged from v0.2 §2.2): no persistence engine, no queue, no background watcher, no
telemetry. Usage accounting is a separate spec.

---

# 2. RF-1 — Evidence attribution: committed delta and content-changed baseline

## Problem

`compareEvidence()` in `evidence.ts` derives `truthPaths` as the set difference
`current.changedPaths − base.changedPaths`, both sampled from `git status --porcelain=v2`. Two
common worker behaviours break this:

1. The worker commits. `current.changedPaths` is empty, every declared path becomes
   `extraDeclaredPaths` and `missingPaths`, and `evidenceAction()` returns `revalidate`. Reproduced
   in `.handoff/R2-scripts/01-commit-scenario.mjs` (commit group: `fresh=false`,
   `unexplained=true`; identical edits without commit: `fresh (attributed 2 paths)`).
2. The worker edits a file that was already dirty at A. The path is in both samples, so it is
   excluded from `truthPaths` and reported as `over-reported / unreliable declaration`
   (`evidence.test.mjs` case 11 encodes this as intended behaviour; EA-4 only says pre-existing dirt
   must not be *attributed*, it does not say a worker edit on top of it must be *rejected*).

`captureEvidence()` already records `baseGitRef`, but no consumer diffs the two refs.

## Required invariant

`truthPaths` is the union of three sets, each derived from Root samples only:

```text
T1 = current.changedPaths − base.changedPaths                      (existing)
T2 = paths changed between base.finalGitRef and current.finalGitRef (git diff --name-only A C),
     present only when both refs exist and differ
T3 = { p ∈ base.changedPaths ∩ current.changedPaths : blobHash_A(p) ≠ blobHash_C(p) }
```

- `missingPaths` must not include any path in `T2` or `T3`.
- `extraDeclaredPaths` is `declared − (T1 ∪ T2 ∪ T3)`.
- `headChanged` keeps its current meaning (reported head vs current head); a head change that
  equals the worker-reported head is not a freshness failure.
- Blob hashes for `T3` come from one `git hash-object -- <paths…>` call per sample (no `-w`).
  Cap the hashed path list at `MAX_BASELINE_HASH_PATHS = 200`; above the cap, `T3` is empty and
  `EvidenceComparison.reasons` carries `baseline hash skipped (N dirty paths)` so the omission is
  visible. Deleted or unreadable paths hash to `null` and count as changed when the other sample
  has a hash.
- Non-Git workspaces stay `verifiable: false` (EA-5 unchanged).

## Data model

`EvidenceRef` gains two optional fields, both Root-owned:

```ts
/** Working-tree blob hashes for paths dirty at sample time (every sample; ≤ MAX_BASELINE_HASH_PATHS). */
dirtyPathHashes?: Record<string, string | null>;
/** Paths changed between baseGitRef and finalGitRef (C only; empty when refs are equal). */
committedPaths?: string[];
```

`GIT_READ_ARGV` in `git-audit.ts` gains `diffNamesBetween: ["diff", "--name-only", "--no-ext-diff",
"--no-textconv"]` (refs appended as two trailing argv elements, validated against
`/^[0-9a-f]{7,40}$/`) and `hashObject: ["hash-object", "--"]`. Neither is reachable through the
`git_audit` tool; they are Evidence probe rows only. `FORBIDDEN_GIT_OPERATIONS` is unchanged.

## Acceptance (mechanical)

- A1. `evidence.test.mjs` gains a case where A and C differ only by a commit touching `a.txt` and
  `b.txt`, the worker declares both, and the result is `fresh: true`, `truthPaths` = both,
  `missingPaths: []`, `extraDeclaredPaths: []`.
- A2. `evidence.test.mjs` gains a case where `legacy.ts` is dirty at A, its hash differs at C, the
  worker declares it, and the result is `fresh: true` with `legacy.ts ∈ truthPaths`.
- A3. `evidence.test.mjs` case 11 is rewritten so the hash is *equal* at A and C; the existing
  over-reported expectation then still holds.
- A4. A case with 201 dirty paths at A yields `reasons` containing `baseline hash skipped`.
- A5. `git-audit.test.mjs` asserts the two new argv rows contain no shell metacharacters and that
  `resolveGitAudit` still rejects `hash-object` and `diff --name-only` as tool operations.
- A6. `npm test` and `npm run typecheck` exit 0.

## Annotations

- 2026-09-05 (R4 review): the Data model comment originally read "A only"; the invariant needs the
  hash at both endpoints (`T3` compares A and C). Corrected above; the implementation hashes every
  sample. The C-side list is capped by the same constant without a `reasons` entry.
- 2026-09-05 (R4 review): the `baseline hash skipped` reason makes `fresh: false` because `fresh`
  is defined as "no reasons". `unexplained` stays false, so `evidenceAction()` still returns
  `review`; the label reads `stale (out-of-scope only)`. Accepted as conservative; revisit if a
  cleaner "attributed with gaps" state is ever added.

---

# 3. RF-2 — Async delegation results reach Orchestration

## Problem

pi-subagents 0.65 defaults to `async: true`. The `subagent` tool result is then only a launch receipt
(`Async: <agent> [<runId>]`, `details.runId`, `details.asyncDir`). The child's output is delivered
later by pi-subagents as `pi.sendMessage({ customType: "subagent-notify", content, display })`
(`src/runs/background/notify.ts`, `sendCompletion`). `index.ts` only handles
`tool_result` with `toolName === "subagent"`, so the WorkerReport is never parsed, the task stays
`executing`, and the writer lock is held until `EXECUTING_STALE_MS`. Reproduced in
`.handoff/R2-scripts/02-async-path.mjs`.

Facts the fix relies on (verified against installed sources on 2026-09-05):

- The launch receipt's `details` carries `runId` (equal to `asyncId`) and `asyncDir`.
- The completion message content is produced by `formatSingleCompletion()` /
  `formatGroupedCompletion()`. A single completion starts with
  `Background task <status>: **<agent>**` and contains a `Child runs: <runId>[…]` line; the child's
  final output is the `resultPreview` block. Workflow child previews are capped at 4 KiB with the
  marker `...[preview truncated]`; the single-run summary cap is not established here and must be
  treated as potentially truncated.
- The full child output is written under `<artifactsDir>/outputs/<runId>/` (async-execution.ts,
  `resolveSingleOutputPath`); the receipt's `asyncDir` is the sibling anchor.
- Custom messages reach extensions through the `message_end` event when the message is appended by
  a prompt turn; the deferred `_pendingCustomMessages` path emits to session listeners only. The
  `context` event exposes the message array before every provider call and its result may replace
  it.

## Required invariant

1. A delegation is keyed by **runId** once a launch receipt supplies one; `toolCallId` remains the
   key only for synchronous results. `DelegationRecord` gains `runId?: string` and the receipt
   handler records it instead of returning early. The record is deleted when its result is handled,
   in both paths.
2. Orchestration consumes a `subagent-notify` custom message exactly once per runId. Detection is
   idempotent: a processed runId is remembered for the session, so seeing the same message on both
   `message_end` and `context` does not double-process.
3. The WorkerReport text is taken, in order, from: the saved output file for the runId when it
   exists and is ≤ 1 MiB; else the `resultPreview` block. If the chosen text contains
   `...[preview truncated]` and no file was readable, the outcome is the existing
   report-only-correction path with reason `async preview truncated`.
4. The message the model finally sees is the extension's rendering (`renderDecisionBlock` +
   `renderWorkerReport`), not the raw pi-subagents notice: on `message_end` the handler returns
   `{ message }` with the content replaced; on the `context` path it replaces the entry in the
   returned messages array. `display` is preserved.
5. Foreground (`async: false`) behaviour is unchanged and covered by the existing tests.
6. `handleSubagentResult` no longer treats `asyncRequested` as a permanent receipt: a second event
   for the same toolCallId with a parseable WorkerReport is handled as a result.

## Parser contract

`parseSubagentNotify(content: string): { runIds: string[]; status: string; agent: string;
preview: string; truncated: boolean } | undefined` lives in a new `notify.ts`. It must parse the
exact strings produced by `formatSingleCompletion` and `formatGroupedCompletion` in pi-subagents
0.65.1; fixtures are copied verbatim into `notify.test.mjs`. Anything unparseable returns
`undefined` and is left untouched (never rewritten, never consumed).

## Acceptance (mechanical)

- B1. `orchestrate.test.mjs`: receipt with `details.runId`, then a `subagent-notify` message whose
  preview holds a valid WorkerReport → `reports.length === 1`, state leaves `executing`, delegation
  map is empty.
- B2. Same, but the preview is truncated and a fixture output file exists under a temp
  `outputs/<runId>/` → report parsed from the file.
- B3. Same, truncated and no file → report-only correction with reason containing
  `async preview truncated`.
- B4. Processing the same runId twice changes nothing on the second pass.
- B5. `notify.test.mjs`: both pi-subagents fixture formats parse; a foreign custom message returns
  `undefined`.
- B6. `index.test.mjs`: `message_end` with a `subagent-notify` custom message returns a replaced
  message whose text starts with `[PLANNER-ONLY REVIEW STATE]`; a non-matching custom message is
  returned untouched.
- B7. `npm test` and `npm run typecheck` exit 0.

---

# 4. RF-3 — E2E contract against pi-subagents 0.65

## Problem

`e2e.pi-subagents.test.mjs` imports `src/runs/shared/pi-args.ts`, renamed to `child-tool-plan.ts`
in 0.65 with `buildPiArgs` removed. It crashes with `ERR_MODULE_NOT_FOUND` instead of the
documented loud skip. README and code comments describe a `--no-extensions` CLI launch that 0.65
replaced with in-process `AgentSession`s (foreground) and a detached runner (background).

## Required invariant

- The test imports only the public subpath `pi-subagents/child-tool-plan` and asserts the
  role→agent→tools mapping through `resolvePiLaunchToolPlan` for `reviewer` and `oracle`.
- A missing package, or a package whose `package.json` version is outside the declared range, prints
  `planner-only pi-subagents E2E: SKIP — …` and exits 0. Any other import failure is a test failure.
- `package.json` declares the supported range in a new `"pi-planner-only": { "piSubagents": ">=0.65 <0.70" }`
  block (read by the test; not an npm dependency).
- README and the comments in `roles.ts` / `index.ts` state the actual isolation mechanism:
  foreground children do not load ambient extensions; background children may, and this extension
  no-ops when `PI_SUBAGENT_CHILD=1`.

## Acceptance (mechanical)

- C1. `npm run test:e2e` exits 0 on this host.
- C2. With `PI_CODING_AGENT_DIR` pointing at an empty directory, `npm run test:e2e` prints the SKIP
  line and exits 0.
- C3. `grep -n -- '--no-extensions' README.md README.zh-CN.md roles.ts index.ts` returns no lines.

---

# 5. RF-4 — Per-session force-on

## Problem

`~/.pi/agent/planner-only.off` is intentionally present on hosts that run Pi as an executor. That
makes it impossible to run a planner session on the same host without deleting the marker.

## Required invariant

`PI_PLANNER_ONLY=1` (also `true`, `on`) forces the guard on for that process regardless of the
marker. `0`/`false`/`off` keep their current meaning. `/planner-only status` reports which source
decided (`env`, `marker`, `default`).

## Acceptance (mechanical)

- D1. `index.test.mjs`: marker present + `PI_PLANNER_ONLY=1` → tools restricted.
- D2. `index.test.mjs`: marker present + env unset → tools unrestricted (existing behaviour).
- D3. README Commands section documents both env values.

---

# 6. RF-5 — Small items

Each is one line of intent; the acceptance is the test named beside it.

- E1. `policy.ts`: remove the `workflow === "review"` special case (dead since
  `compositeWorkflowBlockReason`). Test: `policy.test.mjs` asserts `workflow: "review"` is blocked.
- E2. `filterPlannerTools` keeps only tools that were active; it does not re-enable safe tools the
  user disabled. Test: `index.test.mjs` with `grep` absent from `activeTools` stays absent.
- E3. `git_audit` diff-* argv gains `--no-ext-diff --no-textconv`. Test: `git-audit.test.mjs`.
- E4. `git_audit` rejects a `cwd` that resolves outside `baseCwd` with
  `git_audit cwd must stay inside the working directory`. Test: `git-audit.test.mjs`.
- E5. README Commands list adds `task abandon|reset <taskId>`.
- E6. `PLANNER_PROMPT` example `expectedEvidence` drops `diffStat`. Test: `index.test.mjs` snapshot
  of the prompt does not contain `diffStat`.

---

# 7. Rollout

Rounds are sequential, one writer per round, spec read-only for the executor:

| Round | Item | Fence (edit) | Fence (create) |
|---|---|---|---|
| R4 | RF-1 | `evidence.ts`, `git-audit.ts`, `types.ts`, `evidence.test.mjs`, `git-audit.test.mjs` | none |
| R5 | RF-2 | `orchestrate.ts`, `index.ts`, `orchestrate.test.mjs`, `index.test.mjs`, `package.json` (test script only) | `notify.ts`, `notify.test.mjs` |
| R6 | RF-3 | `e2e.pi-subagents.test.mjs`, `package.json`, `README.md`, `README.zh-CN.md`, `roles.ts`, `index.ts` (comments) | none |
| R7 | RF-4 + RF-5 | `index.ts`, `policy.ts`, `git-audit.ts`, `README.md`, `README.zh-CN.md`, their tests | none |

Version bump to 0.2.4 and CHANGELOG entry land with R7. No commits by executors; the Planner
commits each round after verification.
