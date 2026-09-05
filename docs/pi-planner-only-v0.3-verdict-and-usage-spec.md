# pi-planner-only v0.3 Spec — Root Verdict Tool and Usage Accounting

> Scope: `bioShaun/pi-planner-only` after commit `0c4c096` (v0.2.4). Target host: Pi 0.85.x with
> pi-subagents 0.65.x (declared range `>=0.65 <0.70`). Companion assessment:
> `.handoff/assessment-2026-09-05.md` §4.2 and Appendix B (untracked).

## Status

Draft, 2026-09-05. Authored by the Planner seat. Each V/U item is one acceptance-ledger entry; do
not renumber. Rounds in §7 are the execution plan and may be re-cut.

## 1. Summary

The extension exists to move cost off the expensive Root model. v0.2.4 made the lifecycle
mechanically sound (async results, committed evidence, force-on). Two gaps remain that block the
purpose itself:

- **Root cannot close the loop.** `completed` is reachable only through a human slash command
  (`/planner-only review pass`) or a fresh reviewer's `pass`. The guidance that Orchestration
  injects tells the model to "record the verdict with `/planner-only review …`", which a model
  cannot execute. Every task therefore ends with an operator keystroke or hangs in `reviewing`.
- **Nothing is measured.** There is no record of what Root spent versus what children spent, so
  "saves tokens" cannot be confirmed, and the decision whether to make the fresh reviewer the
  default (assessment §4.2 item 2) has no data behind it.

v0.3 ships both:

| Item | Title |
|---|---|
| **V-1** | `planner_verdict` tool: Root records pass / request_changes / blocked itself |
| **V-2** | Guidance, prompt, and operator-override semantics rewired to the tool |
| **U-0** | Runtime probe of usage fields on the installed providers (time-boxed) |
| **U-1** | `usage.ts`: ledger types, attribution rules, cost resolution, rendering |
| **U-2** | Root usage capture on `message_end`, phase bucketing, review-leakage bytes |
| **U-3** | Child usage capture: sync `subagent` details, `bg_wait` completions, async `_meta.json` |
| **U-4** | Persistence: session custom entries (rehydrate on reload) plus append-only `usage.jsonl` |
| **U-5** | Reporting: `/planner-only usage [taskId]`, one usage line in the decision block, pricing table |
| **U-6** | Baseline: 3–5 real tasks measured; decides the 0.3.1 follow-ups |

Non-goals for 0.3.0: fresh reviewer as default, per-round injection compression, Task store
persistence, prefix write locks, worktree lanes. Each is deferred to 0.3.1 and gated on U-6
numbers, not on opinion. Still no queue, no background watcher, no network telemetry: the only
new files are one JSON pricing table the user edits and one local append-only log.

---

# 2. Verified facts about the data sources

All of the following were read from the installed source on 2026-09-05. They supersede the
"unverified" marks in assessment Appendix B.1.

## 2.1 Root side (Pi core)

| Fact | Where |
|---|---|
| `message_end` fires with `event.message`; assistant messages carry `usage`, `model`, `provider` | `pi-coding-agent/dist/core/extensions/types.d.ts` `MessageEndEvent`; pi-ai `AssistantMessage` |
| `Usage` = `{ input, output, cacheRead, cacheWrite, cacheWrite1h?, reasoning?, totalTokens, cost: { input, output, cacheRead, cacheWrite, total } }` | pi-ai `types.d.ts` line 265 |
| `ctx.model.cost` is `ModelCost` (per-million rates `input/output/cacheRead/cacheWrite`, optional `tiers`) | pi-ai `types.d.ts` line 691 |
| `pi.appendEntry(customType, data)` persists a `CustomEntry { type: "custom", customType, data }` in the session file, not sent to the LLM | `ExtensionAPI.appendEntry`; `session-manager.d.ts` line 69 |
| `ctx.sessionManager.getEntries()` / `getBranch()` / `getSessionFile()` are available read-only | `ReadonlySessionManager` |
| `tool_result` handler receives `toolName`, `toolCallId`, `content`, `details`; it may return replaced `content`/`details` | `ToolResultEvent`, already used by `handleSubagentResult` |

## 2.2 Child side (pi-subagents 0.65.1)

| Fact | Where |
|---|---|
| pi-subagents `Usage` = `{ input, output, cacheRead, cacheWrite, cost, turns }` (`cost` is a plain number) | `src/shared/types.ts` line 241 |
| Sync `subagent` tool result: `details.results[]` is `SingleResult` with `usage: Usage`, `model?`, `agent`, `sessionFile?` | `src/shared/types.ts` line 1215 |
| `bg_wait` tool result: `details.completions[]` is `WaitCompletion { runId, agent?, results?: WaitCompletionChild[] }`; each child has `usage?`, `model?`, `runId?` | `src/shared/types.ts` lines 1319–1352 |
| **The `subagent-notify` custom message carries no usage.** Its text is agent, status, result preview, correlation lines, session line | `src/runs/background/notify.ts` `formatSingleCompletion`, `SubagentNotifyDetails` |
| Every child run (foreground and background) writes `<artifactsDir>/<runId>_<agent>[_<index>]_meta.json` containing `runId`, `agent`, `usage`, `model`, `modelAttempts`, `durationMs`, `error` | `src/runs/foreground/execution.ts` line 153; `src/runs/background/subagent-runner.ts` `persistStepArtifacts` |
| `artifactsDir` is, by preference: `dirname(sessionFile)/subagent-artifacts` (default `session`), `DIRS.artifacts` (`temp`), or `<cwd>/.pi/subagents/artifacts` (`project`) | `src/shared/artifacts.ts` `getArtifactsDir`, `getProjectArtifactsDir` |
| pi-subagents' own `/subagent-cost` resolves async child usage exactly this way: scan session branch for `subagent`/`bg_wait` tool results, then fall back to `_meta.json` by `(runId, agent)` | `src/slash/slash-commands.ts` `buildSubagentCostReport`, `metadataUsage` |
| `usageBudget: { tokens?: {soft?, hard}, costUsd?: {soft?, hard} }` is an accepted `subagent` parameter; hard limits block future child launches, running children are not stopped | `src/extension/schemas.ts` line 134 |

## 2.3 Local pricing state (resolves Appendix B.1 unknown (a))

`~/.pi/agent/models.json` on this machine declares **no `cost`** for any model the user actually
runs: `volcengine/glm-5-3`, `tcuni/gpt-5.6-*`, `tcuni-claude/claude-opus-5`,
`tcuni-claude/claude-fable-5-1`, `tcuni-agy/gemini-3.8-flash-high`. Only the two local/free
models declare a zero cost. Consequently Pi computes `usage.cost.total = 0` for every Root turn,
and pi-subagents reports `cost = 0` for every child.

Design consequence: cost must be resolvable from a plugin-side pricing table (U-1), and the
report must say "cost unknown" rather than "$0.00" when neither Pi nor the table has a rate.
Token counts remain the primary metric; dollars are derived.

What U-0 still has to confirm at runtime: that the OpenAI-compatible endpoints behind
`volcengine`/`tcuni`/`tcuni-agy` return non-zero token counts in streaming responses (Pi sends
`stream_options.include_usage`; some proxies drop it). If a provider returns zeros, the ledger
marks the turn `tokensUnknown` and the report shows a count of such turns.

---

# 3. V-1 — `planner_verdict` tool

## Problem

`recordRootVerdict()` in `orchestrate.ts` is the only path that lets Root's own judgment reach
the Task, and it is called solely from the `/planner-only review` slash handler in `index.ts`.
`decideReview()` (`review.ts` line 417) instructs the model: `Record the verdict with:
/planner-only review pass|request_changes|blocked <summary>`. Models cannot run slash commands.
The `PLANNER_PROMPT` step 5 says "PASS or REQUEST_CHANGES" with no mechanism.

## Contract

Register one tool in `index.ts`, next to `git_audit`:

```text
name:  planner_verdict
label: Planner Verdict
parameters:
  verdict:  "pass" | "request_changes" | "blocked"                (required)
  summary:  string, 1..2000 chars                                  (required)
  taskId?:  string  — defaults to the active Task
  findings?: ReviewFinding[]  ≤ 20 entries, each
             { severity: blocker|major|minor|info,
               category: correctness|scope|test|safety|regression|maintainability|other,
               description: string ≤ 500,
               requestedChange?: string ≤ 500 }
```

`findings` reuse the existing `ReviewFinding` shape so `summarizeFindings()` can turn a
`request_changes` verdict into the correction guidance the model already receives for reviewer
findings. `evidence` strings are not accepted from Root; Root's evidence is the A-to-C sample.

## Behaviour

1. Resolve the Task: `taskId` if given, else `store.active()`. Unknown or absent → return an
   error result (`isError: true`) naming the usage; nothing is recorded.
2. Refuse, with a text reason and no state change, when:
   - the Task is terminal (`completed | blocked | failed`) — "already <state>; use
     /planner-only task reset to reopen";
   - `verdict !== "blocked"` and the Task has no recorded WorkerReport — a pass or a change
     request needs a report to judge;
   - a delegation for this Task is still pending in `delegations` (sync running, or async
     launched and not yet consumed) — "worker/reviewer run still pending; wait for its result";
   - `verdict === "pass"` and `task.reviewMode === "fresh"` and no `ReviewResult` from a reviewer
     exists yet — in fresh mode Root arbitrates, it does not pre-empt. (`request_changes` and
     `blocked` are allowed at any time; they never widen acceptance.)
3. Otherwise call `orchestrator.recordRootVerdict(task, verdict, summary, { findings, source: "root" })`.
   `recordRootVerdict` keeps its PASS-boundary re-sample; it gains an options argument carrying
   `findings` (stored on the `ReviewResult`) and `source`.
4. Return `renderDecisionBlock(task, decision, evidence)` as the tool text, plus
   `details: { taskId, verdict, action: decision.action, state, round }`.

A `pass` that fails the boundary re-sample is not a pass: `advanceReview` already turns stale
evidence into `revalidate`/`blocked`; the tool returns that decision text unchanged. The tool
never throws for lifecycle reasons; `TaskStore.transition` errors are caught and returned as
`isError` text so the model sees the reason.

## Policy and tool visibility

- `policy.ts`: `AUDIT_TOOLS` becomes `ROOT_TOOLS = new Set(["git_audit", "planner_verdict"])`
  (keep `AUDIT_TOOLS` as an alias export for one release; `architecture.test.mjs` line 47 keeps
  matching `isSafeAuditCommand`).
- `index.ts` `PLANNER_SAFE_TOOLS` picks it up through `ROOT_TOOLS`, so
  `restrictActiveTools()` keeps it active and the child guard (`PI_SUBAGENT_CHILD=1` → factory
  returns early) means no child ever sees it.
- Reviewer children keep launching with context=fresh and a bounded packet; nothing changes on
  the child seam.

## ReviewResult provenance

`types.ts` `ReviewResult` gains `source?: "reviewer" | "root" | "operator"`. `handleReviewerResult`
sets `reviewer`; the tool sets `root`; the slash command sets `operator`. `renderTaskStatus` shows
`Reviews: pass (reviewer), request_changes (root)`. Missing `source` reads as `reviewer` for
records created before 0.3.

## Tests (`index.test.mjs`, `orchestrate.test.mjs`)

- Tool is registered and stays in the active tool set after `session_start`; the policy never
  blocks it, whether the guard is on or off.
- pass with fresh evidence → `completed`, `source: "root"`, decision `accept`.
- pass over stale evidence (mutate the tree between worker result and verdict in the fake git
  runner) → not `completed`; decision text mentions stale.
- request_changes with two findings → `changes_requested`, round incremented, guidance lists the
  findings.
- blocked with no report → `blocked` (allowed).
- pass with no report → refused, state unchanged.
- pass while an async delegation is pending → refused.
- pass in fresh mode with no reviewer result → refused; after a reviewer `request_changes`, Root
  `pass` → override recorded with `reviewerVerdict: request_changes, rootVerdict: pass`.
- unknown taskId → `isError`.

---

# 4. V-2 — Guidance, prompt, and operator override

## Changes

1. `review.ts` line 417 block: replace the slash instruction with
   `Record the verdict with the planner_verdict tool: {verdict, summary, findings?}.`
   Keep the fresh-mode line, reworded: "A fresh reviewer is expected: delegate the review first;
   call planner_verdict only to arbitrate its result."
2. `PLANNER_PROMPT` in `index.ts`:
   - step 5 → `5. record PASS, REQUEST_CHANGES, or BLOCKED with planner_verdict`;
   - closing paragraph → "Use /planner-only task to inspect lifecycle state. /planner-only
     review is the operator's override; you record verdicts with planner_verdict."
   - Net size must not grow by more than 120 bytes (the prompt is re-read every turn; V-2 is
     not the place to add prose). Measure in `index.test.mjs`: `PLANNER_PROMPT.length ≤ 2500`.
3. `/planner-only review pass|request_changes|blocked` keeps working and records
   `source: "operator"`. It bypasses the refusals in §3 step 2 except the terminal-state one
   (an operator may force a verdict on a task with a pending run; that is what an override is
   for), and it prints a warning line naming which refusal it bypassed.
4. `renderWorkerReport` footer and `reviewerPrompt` text: any remaining mention of
   `/planner-only review` as the model's action is replaced by `planner_verdict`.
   `grep -n "planner-only review" *.ts` after the round must only hit the slash handler, the
   status help line, and README.

## Tests

- `review.test.mjs`: guidance for `review_pending` contains `planner_verdict` and not
  `/planner-only review`.
- `index.test.mjs`: prompt length bound; slash `review pass` on a task with a pending delegation
  succeeds and emits the bypass warning.

---

# 5. U-0 — Runtime probe (time-boxed, half a day at most)

A throwaway extension `.handoff/probe/usage-probe.ts` (untracked directory already excluded)
that appends raw JSON lines to `.handoff/probe/usage-probe.jsonl` in the project directory:

- every `message_end` where `message.role === "assistant"`: `{ t, model, provider, usage }`;
- every `tool_result` for `subagent` or `bg_wait`: `{ t, toolName, details }` with `results[].messages`
  stripped;
- every `subagent-notify` custom message: `{ t, content }`.

Run one real worker task with `PI_PLANNER_ONLY=1 pi -e .handoff/probe/usage-probe.ts` on the
provider combination the user actually uses (Root on `tcuni-claude`, worker on `volcengine` or
`tcuni-agy`). Record in `.handoff/probe/README.md`:

| Question | Answer to record |
|---|---|
| Does Root's `usage.input/output` come back non-zero? | yes/no per provider |
| Is `usage.cost.total` zero? (expected yes, §2.3) | |
| Does the sync `subagent` result carry `details.results[0].usage` and `.model`? | |
| After an async run, does `<sessionDir>/subagent-artifacts/<runId>_<agent>_meta.json` exist with `usage` and `model`? | path + whether `usage.turns` is set |
| Does `bg_wait` (if the model calls it) return `completions[].results[].usage`? | |

The probe is not shipped and not committed. Its answers set the `tokensUnknown` handling in U-1
and the artifact-directory search order in U-3.

---

# 6. U-1 … U-5 — Usage accounting

## 6.1 U-1 — `usage.ts` (pure module, no Pi imports)

New file `usage.ts`, added to `package.json` `files` and to `naming.test.mjs` expectations.
Architecture rule (append to `architecture.test.mjs`): `usage.ts` imports nothing from
`index.ts` or `@earendil-works/*`; `index.ts` may import `usage.ts`; `orchestrate.ts` may
import types only.

### Types (`types.ts`)

```ts
export interface TokenCounts {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning?: number;
}

export type UsagePhase = "planning" | "executing" | "reviewing";

export interface RootUsage extends TokenCounts {
	turns: number;
	/** Turns whose provider returned all-zero token counts. */
	tokensUnknownTurns: number;
	costUsd?: number;          // undefined when no rate was resolvable for ≥1 turn
	byPhase: Record<UsagePhase, TokenCounts & { turns: number }>;
	/** Bytes of read/grep/find/ls/git_audit tool results Root consumed while the Task was reviewing. */
	reviewLeakBytes: number;
	/** Bytes Orchestration injected into Root (decision blocks, rendered reports, reviewer template). */
	injectedBytes: number;
}

export interface ChildUsage extends TokenCounts {
	runId?: string;            // async runs; sync runs use toolCallId
	toolCallId?: string;
	kind: DelegationKind;      // worker | reviewer | explorer | validator
	agent?: string;
	model?: string;
	turns?: number;
	costUsd?: number;
	/** Usage not yet resolvable (async run, metadata file absent at consume time). */
	pending: boolean;
	source: "sync-details" | "bg-wait" | "meta-file" | "unavailable";
}

export interface TaskUsage {
	root: RootUsage;
	children: ChildUsage[];
	rootModel?: string;        // last Root model seen while this Task was active
	costUnknown: boolean;      // any component lacked a rate
}
```

`TaskRecord` (`task.ts`) gains `usage: TaskUsage` initialised empty in `TaskStore.create()`.
The session-level bucket for turns with no active Task lives in the ledger, not in a Task.

### Ledger

```ts
export class UsageLedger {
	constructor(opts: { pricing: PricingTable; now?: () => Date });
	/** Root assistant turn. `taskId` undefined → session `untasked` bucket. */
	recordRootTurn(input: { taskId?: string; state?: TaskState; model?: string; provider?: string; usage: PiUsageLike }): RootTurnRecord;
	recordInjected(taskId: string, bytes: number): void;
	recordReviewLeak(taskId: string, bytes: number): void;
	recordChild(taskId: string, child: ChildUsage): void;
	/** Re-resolve `pending` children through the supplied reader; returns how many resolved. */
	resolvePending(taskId: string, read: (child: ChildUsage) => ChildUsage | undefined): number;
	taskUsage(taskId: string): TaskUsage | undefined;
	sessionUsage(): { untasked: RootUsage; tasks: string[] };
	/** Rehydrate from persisted records (U-4). Idempotent by record id. */
	load(records: UsageEntry[]): void;
	/** Records appended since the last drain, for persistence. */
	drain(): UsageEntry[];
}
```

### Attribution rules

- **Phase bucket** from the Task state at the moment `message_end` fires:
  `planning → planning`; `executing → executing`; `reviewing | changes_requested → reviewing`;
  terminal states and no active Task → session `untasked`. A Task is "active" for a Root turn
  when `store.active()` returns it (existing semantics: newest non-terminal Task).
- **Injected bytes**: every text `handleWorkerResult` / `handleReviewerResult` /
  `handleAsyncNotify` / the verdict tool returns is measured (`Buffer.byteLength`) and added to
  the Task. This is the "fixed injection per round" number from assessment §3, now measured
  rather than estimated.
- **Review leak bytes**: in `tool_result`, when `toolName ∈ {read, grep, find, ls, git_audit}`
  and the active Task is in `reviewing` or `changes_requested`, add the byte length of the text
  content. This quantifies P1-1 ("is Root reading the diff itself").
- **Cost resolution**, in order, per component:
  1. Pi-reported `usage.cost.total > 0` → use it (Root) / pi-subagents `usage.cost > 0` (child);
  2. `PricingTable` entry for `provider/model` or `model` → rates × tokens
     (`input`, `output`, `cacheRead`, `cacheWrite` per million, same semantics as `ModelCost`);
  3. otherwise the component's `costUsd` is `undefined` and the Task's `costUnknown` is true.
  Never print `$0.00` for an unresolved rate.

### Pricing table

`~/.pi/agent/planner-only/pricing.json` (path overridable with `PI_PLANNER_ONLY_PRICING`):

```json
{
	"version": 1,
	"currency": "USD",
	"rates": {
		"tcuni-claude/claude-fable-5-1": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
		"volcengine/glm-5-3":            { "input": null, "output": null, "cacheRead": null, "cacheWrite": null }
	}
}
```

Keys are `provider/model`, with a bare `model` key accepted as a fallback. Values are price per
million tokens in `currency` (`USD` or `CNY`, one currency for the whole table; the renderer
prints `$` or `¥` accordingly and never mixes). A `null` rate means unknown and yields `cost
unknown` for that model; `0` means free. Keys beginning with `_` are ignored (comments). The file
is read once per session start and on `/planner-only usage reload`. A missing file is not an
error. The template with the user's current models lives at
`~/.pi/agent/planner-only/pricing.json` (created 2026-09-05). The README documents the preferred alternative: put `cost` into
`~/.pi/agent/models.json`, which makes Pi and pi-subagents' own `/subagent-cost` price things
natively; the plugin table exists for models whose `models.json` entry the user does not want to
touch.

### Rendering

`renderUsage(taskUsage, opts)` returns the block for `/planner-only usage`:

```text
Usage for T-20260905-003 (completed, 2 rounds)
Root   tcuni-claude/claude-fable-5-1   12 turns   in 184.2k (cache 151.0k)  out 6.1k   $1.23
       planning 3 turns · executing 4 · reviewing 5
       review leak 18.4 KB · injected 27.9 KB
Child  worker    volcengine/glm-5-3     in 96.3k  out 14.8k  $0.09   (run a1b2c3)
Child  reviewer  tcuni-agy/gemini-3.8   in 21.0k  out 2.2k   $0.02   (run d4e5f6)
Root share of cost: 93%   (cost unknown for 0 components)
Estimated Root-only cost of the child work: $4.10 (children tokens × Root rates; upper bound)
```

Rules: tokens in `k`/`M` with one decimal; dollars to two decimals under $10, four under $0.10;
`cost unknown` replaces the share line when any component is unpriced; the estimate line is
omitted when the Root rate is unknown. Session view (`/planner-only usage` with no Task and no
active Task) lists one line per Task plus the `untasked` bucket.

`renderUsageLine(taskUsage)` returns the single line for the decision block (U-5):
`usage: root 184k/$1.23 (12 turns) · children 132k/$0.11 · root share 93%` or
`usage: root 184k (12 turns) · children 132k · cost unknown`. Hard cap 160 bytes.

### Tests (`usage.test.mjs`)

Phase bucketing per state; `untasked` when no Task; injected/leak accumulation; child pending →
resolved through `resolvePending`; cost resolution order with Pi cost present, table present,
neither; `costUnknown` propagation; rendering fixtures (byte cap on the line; no `$0.00` for
unknown); `load()` idempotency on duplicate record ids; `drain()` returns each record once.

## 6.2 U-2 — Root capture (`index.ts`)

- `pi.on("message_end")`: the existing handler only reacts to `subagent-notify`. Add, before
  that check: if `event.message.role === "assistant"` and not disabled, call
  `ledger.recordRootTurn({ taskId: store.active()?.taskId, state, model: message.model,
  provider: message.provider, usage: message.usage })`. Replacement of the message content for
  notify messages is unaffected.
- `pi.on("tool_result")`: extend the guard from `toolName !== "subagent"` to a switch:
  `subagent` → existing path plus U-3 child capture; `bg_wait` → U-3 completions; read-only
  tools → review-leak bytes when the active Task is reviewing. Return values unchanged for the
  read-only branch (never rewrite the content).
- Every place that returns injected text (the three orchestrator handlers and the verdict tool)
  reports its byte length to the ledger from `index.ts`, so `orchestrate.ts` stays free of
  ledger calls except the type import.
- `model_select` is not needed: the model id rides on each assistant message.

## 6.3 U-3 — Child capture

Three sources, one normaliser `childUsageFromValue(value, kind, ids)` in `usage.ts` that accepts
both pi-subagents `Usage` (`cost` number, `turns`) and pi-ai `Usage` (`cost.total`,
`totalTokens`) and returns `ChildUsage` or `undefined`.

1. **Sync `subagent` result**: in `handleSubagentResult`'s caller, read
   `details.results[]`; each entry → `recordChild(taskId, { toolCallId, kind: delegation.kind,
   agent, model, ...usage, source: "sync-details", pending: false })`.
2. **`bg_wait` result**: `details.completions[].results[]` keyed by `completion.runId`; match to
   a delegation by runId (the same map `handleAsyncNotify` uses). Record with `source: "bg-wait"`.
   The existing RF-2 rule stands: the WorkerReport itself still comes from the notify path; this
   branch only records usage and must not call `handleWorkerResult`.
3. **Async completion (`subagent-notify`)**: after `handleAsyncNotify` consumes a run, try
   `readChildMeta(artifactDirs, runId, agent)` over, in order: `dirname(sessionFile)/subagent-artifacts`,
   `<tempRoot>/artifacts` (from `tempRootFromAsyncDir(asyncDir)`, already in `notify.ts`),
   `<cwd>/.pi/subagents/artifacts`. File name pattern is `${runId}_${agent.replace(/[^\w.-]/g,"_")}[_0]_meta.json`;
   size cap 2 MiB; the file must echo the same `runId` and `agent`. Found → `source: "meta-file"`.
   Not found → record `pending: true, source: "unavailable"`; `/planner-only usage` and the
   terminal-state flush call `resolvePending` once more before rendering/writing.
   `readChildMeta` lives in `notify.ts` beside `readLargestRunOutput` (same safety rules:
   `isUnsafeRunId`, no symlink following, regular files only).

`agent` for the file name comes from `DelegationRecord.agent` (already recorded in
`beginDelegation`). When it is missing, try the notify's parsed `agent`.

### Tests (`orchestrate.test.mjs`, `notify.test.mjs`, `index.test.mjs`)

Sync result with `details.results[0].usage` → one child, not pending. Async notify with a
fixture `_meta.json` under a temp session dir → resolved `meta-file`; without the file → pending,
then resolved on a second `resolvePending` after the fixture is written. `bg_wait` completion
for a known runId → `bg-wait` child without re-running the WorkerReport path (assert the Task
state does not change). Malformed or oversized meta → `unavailable`, no throw.

## 6.4 U-4 — Persistence

Two layers, both append-only, no watcher:

1. **Session custom entries** — `pi.appendEntry("planner-only-usage", entry)` for every
   `UsageEntry` the ledger drains, at the end of each `message_end` and `tool_result` handler
   that produced one. On `session_start`, `ledger.load()` from
   `ctx.sessionManager.getEntries().filter(e => e.type === "custom" && e.customType === "planner-only-usage")`.
   This survives `/reload` and session resume. It does not resurrect the in-memory `TaskStore`
   (still a non-goal); a rehydrated Task usage with no live Task is reported under its taskId
   with state `unknown (store not persisted)`.
   Entry shape: `{ id, kind: "root-turn" | "child" | "injected" | "leak", taskId?, at, ...payload }`;
   `id` is `${kind}:${messageId | toolCallId | runId}:${seq}` so `load()` can dedupe.
2. **Cross-session log** — when a Task reaches a terminal state (detected in `index.ts` by
   comparing the Task state before and after each orchestrator handler and the verdict tool,
   and in `/planner-only task abandon`), append one JSON line with the
   full `TaskUsage` plus `{ taskId, cwd, state, rounds, rootModel, finishedAt, sessionFile }` to
   `~/.pi/agent/planner-only/usage.jsonl`. Path overridable with `PI_PLANNER_ONLY_USAGE_LOG`;
   `PI_PLANNER_ONLY_USAGE_LOG=0` disables. `/planner-only status` prints the path and whether it
   is enabled. This file is the input for U-6.

Write failures are reported once per session through `ctx.ui.notify` and never break the
lifecycle.

## 6.5 U-5 — Reporting surface

- `/planner-only usage [taskId | session | reload]`: renders §6.1 blocks; `session` forces the
  session view; `reload` re-reads the pricing table.
- `renderDecisionBlock` gains one line, `usage: …`, from `renderUsageLine`, placed after
  `evidence:`; it is only emitted when the Task has at least one Root turn recorded (never on
  the first decision block of a Task, where it would be all zeros).
- Soft warning: when Root's share of resolved cost exceeds `PI_PLANNER_ONLY_ROOT_SHARE_WARN`
  (default `0.6`) **and** `reviewLeakBytes > 8192`, append
  `warning: Root is reading the diff itself; consider /planner-only review fresh` to the
  guidance list of the decision. One line, only in `review_pending` decisions, so it cannot
  loop.
- `TaskSpec.budget?: { tokens?: number; costUsd?: number }` (optional) is passed through in
  `applyRoleDelegation` as pi-subagents `usageBudget: { tokens: { hard }, costUsd: { hard } }`
  when the delegation input does not already set `usageBudget`. Validation: positive finite
  numbers. This is the only place 0.3 lets accounting influence execution, and it acts on the
  child, not on Root.

### Tests

`index.test.mjs`: `/planner-only usage` on a Task with fixture usage prints the expected block;
decision block has no usage line before the first Root turn and has one after; warning appears
only above both thresholds. `roles.test.mjs`: `budget` → `usageBudget` mapping, and explicit
`usageBudget` in the input wins.

---

# 7. U-6 — Baseline and the 0.3.1 gate

After 0.3.0 is installed (`pi update git:git@github.com:bioShaun/pi-planner-only`), run 3–5 real
Tasks in this repository or another active project with `PI_PLANNER_ONLY=1`, Root on the
expensive model and workers on the cheap one. Collect from `usage.jsonl`:

| Metric | Decides |
|---|---|
| Root share of cost, per Task, median | whether fresh reviewer becomes the default (0.3.1-A) |
| `reviewLeakBytes` per Task | same, and whether `git_audit`'s default cap drops to ~6k |
| `injectedBytes × remaining Root turns` | whether the WorkerReport rendering folds validation detail and drops the reviewer template in root mode (0.3.1-B) |
| Count of `pending` children at terminal state | whether the `_meta.json` search order needs the `project` preference first |
| `tokensUnknownTurns` | whether a provider needs `stream_options` work upstream |

Write the numbers into `.handoff/baseline-0.3.md`. 0.3.1 items are opened only with those
numbers attached.

---

# 8. Execution plan (rounds)

Executor roster and habits follow the pairing memory: cursor for the complex round, pi for the
key round, agy for the simple round; all in tab `w2E:t2`; each round is one fenced handoff with a
report file under `.handoff/`. Before any round, the Planner checks `slot audit` / `slot status`
per the global rules (the test suite is light; no heavy jobs are expected).

| Round | Executor | Items | Acceptance |
|---|---|---|---|
| R8 | Planner (me) with the user | U-0 probe | `.handoff/probe/README.md` answers filled |
| R9 | pi | V-1, V-2 | `npm test` green; `grep "planner-only review" *.ts` hits only the slash handler, help line; tool refusals covered by tests |
| R10 | cursor | U-1, U-2, U-3, U-4 | `usage.test.mjs` and extended `index.test.mjs` green; `typecheck` clean; no ledger import in `orchestrate.ts` beyond types |
| R11 | agy | U-5, README/README.zh-CN, CHANGELOG `0.3.0`, `package.json` version and `files`, `naming.test.mjs` | `npm test` green; `pi update` + naming test green after push |
| R12 | Planner with the user | U-6 | `.handoff/baseline-0.3.md` written; 0.3.1 scope decided |

R9 and R10 touch disjoint files except `index.ts` and `types.ts`; run them sequentially (R9
first) to avoid the concurrent-writer hazard. R11 depends on both.

Each executor handoff must state: the exact item text from this spec, the files it may touch,
the test commands, the byte bound on `PLANNER_PROMPT` (R9), and the rule that `usage.ts` imports
nothing from Pi (R10).

---

# 9. Documentation and release

- README (`## Commands`): add `/planner-only usage`; (`## What the parent may use`): add
  `planner_verdict`; new subsection `### Usage accounting` with the pricing-table format and the
  `models.json` alternative; note that dollars are derived and tokens are authoritative.
- README.zh-CN mirrors the same three edits.
- `CONTEXT.md` glossary: add **Verdict** ("Root's recorded judgment over a Task through
  `planner_verdict`; the operator's `/planner-only review` is an override, not a second
  verdict") and **Usage** ("token and derived-cost accounting attributed to a Task; Root turns
  by phase, children by run").
- `CHANGELOG.md`: `## 0.3.0 - <date>` with one bullet per V/U item, same style as 0.2.4.
- `package.json`: `0.3.0`; `files` gains `usage.ts`.

---

# 10. Decisions (resolved 2026-09-05)

1. **Rates.** The user fills `~/.pi/agent/planner-only/pricing.json` (template written with
   every model in `models.json`, `null` placeholders). Once filled, the Planner copies the
   numbers into `models.json` `cost` so Pi and pi-subagents price natively; the plugin table
   stays as the fallback and as the source for the `currency` symbol.
2. **Root-share warning threshold** stays `0.6` (env `PI_PLANNER_ONLY_ROOT_SHARE_WARN`);
   revisit after U-6.
3. **Cross-session log defaults on** (`usage.jsonl`, local, append-only; `PI_PLANNER_ONLY_USAGE_LOG=0`
   disables).
