# Design proposal: `blocked` Task lifecycle (F6) — no behavior change this round

- round_id: `p21-r100-cloud-backlog`
- status: **proposal only** (product code untouched for this item)
- date: 2026-09-09 (Asia/Shanghai)

## Current behavior (verified in source)

| Surface | Behavior |
|---|---|
| `abandon(taskId)` | Throws `cannot abandon terminal task: blocked` because `isFinalTaskState` includes `blocked` (`types.ts` `FINAL_TASK_STATES`). |
| `planner_verdict` / `recordRootVerdict` | Still accepts verdicts on `blocked`: `recordRootVerdict` re-opens via `transition(taskId, "reviewing")` when `state === "blocked" \|\| "failed"`. `isTerminalTaskState` is only `completed`. |
| Late child receipt | `handleSubagentResult` / reconcile can still advance a non-`completed` Task. A late worker/validator receipt after `blocked` can move the Task through `executing`/`reviewing` into `changes_requested` (state machine allows `blocked → executing \| reviewing`). |
| Budget stop | Orthogonal: stop refuses new paid launches; it does not itself force `blocked`, and post-stop verdicts are intentionally unchanged (B10). |

So today **`blocked` is “final for abandon” but not “final for verdicts or late receipts.”** That split is load-bearing for the escape hatch (Root can still judge with `git_audit` + `planner_verdict` after report-correction exhaustion) and is also how a “settled” blocked Task can reopen.

## Problem statement

Operators (and Root) cannot abandon a `blocked` Task, yet:

1. A late child receipt can reopen it to `changes_requested`, undoing the “stop spending / stop looping” intent of blocking.
2. `planner_verdict` can still move it, which is useful for independent close, but undocumented relative to abandon.
3. After ticket-28-style report-only deadlocks, Tasks reach `blocked` with acceptance all-green; Root needs a clean close path without another paid correction round.

## Options

### Option 0 — Keep as-is (document only)

- **Pros:** Escape hatch stays open; no migration of in-flight Tasks; matches today’s B1–B10 “post-stop lifecycle still queryable / verdictable” spirit for the non-budget `blocked` state.
- **Cons:** “Blocked” reads as terminal to humans; abandon lying about terminality is confusing; late receipts silently reopen spend loops.

**Recommendation if token/risk budget is tight:** document in status text that `blocked` still accepts Root verdicts and late receipts, and point Root at `git_audit` + `planner_verdict` for independent close. No SM change.

### Option 1 — Split “operator-blocked” vs “system-blocked”

- Add a reason/flag (`stateReason` already exists) or a substate: `blocked_open` (verdicts + late receipts OK) vs `blocked_sealed` (no reopen except explicit `reopen` tool).
- `abandon` on `blocked_open` → `failed` or `blocked_sealed`.
- Late receipts on `blocked_sealed` are acknowledged but do not transition; content is attached as history only.
- **Pros:** Preserves escape hatch while making “sealed” mean sealed.
- **Cons:** New state or flag; every receipt/verdict path needs a seal check; tests across orchestrate/review.

### Option 2 — Make `blocked` truly final (like `completed`)

- Add `blocked` to `TERMINAL_TASK_STATES`; refuse `planner_verdict`; late receipts become no-op notices; allow `abandon` only from non-final states (already true) — so recovery requires a **new TaskSpec / new taskId**.
- **Pros:** Simple mental model.
- **Cons:** Removes the documented independent-close path after report-correction exhaustion unless a new `reopen_blocked` tool is added in the same change. **Not recommended** without that replacement hatch.

### Option 3 — Allow abandon from `blocked` → `failed`, keep verdict path

- Narrowest SM tweak: `abandon` treats `blocked` as abandonable → `failed` (or new `abandoned` if ever added). Late receipts / verdicts unchanged.
- **Pros:** Unblocks operators who want to drop a stuck Task without lying about “terminal.”
- **Cons:** Does not stop late-receipt reopen; two Tasks can still thrash if the child is alive.

## Suggested state-machine move (if changing)

Prefer **Option 1 (seal)** or the smaller **Option 3 (abandonable blocked)** plus soft documentation:

1. **Short term (docs + status):** `renderTaskStatus` discloses: `blocked` still accepts Root `planner_verdict` and may reopen on late child receipts; use abandon→failed only after Option 3.
2. **Medium term:** implement Option 3 (abandon from blocked) — one transition table / `isFinalTaskState` nuance: `blocked` stays final for *automatic* success paths but not for operator abandon. Concretely: keep `FINAL_TASK_STATES` for launch gates if needed, but special-case `abandon` to allow `blocked → failed`.
3. **If reopen-from-receipt must stop:** on `blocked`, park late receipts into history without `advanceReview` unless Root recorded an explicit `reopen` verdict. That is Option 1’s seal semantics without a new enum if keyed off `stateReason` / a `sealedAt` field.

## Independent close path (ties to ticket 28 variant A)

With report-only attribution fixed this round, fewer Tasks should hit `blocked` while green. Remaining need:

- Root: `git_audit` (read-only) + validator/oracle re-check + `planner_verdict: pass|blocked` on the last recorded report.
- Do **not** require another report-only worker round when evidence is independently fresh.

No product change in this proposal round beyond documenting that path.

## Decision asked of planner / user

- **Default proposal:** Option 0 now (document) + schedule Option 3 (abandon from `blocked`) as a small follow-up ticket; defer Option 1 seal until a real late-receipt incident is reproduced under budget stop.
- **Do not** take Option 2 without a replacement reopen hatch.
