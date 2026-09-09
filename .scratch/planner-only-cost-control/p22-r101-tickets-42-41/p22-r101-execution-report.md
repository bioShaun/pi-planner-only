# p22-r101 tickets 42+41 execution report

- round_id: `p22-r101-tickets-42-41`
- taskId: `p22-r101-tickets-42-41`
- branch: `cloud-backlog-2-2026-09-09`
- start HEAD: `faa5378`
- end HEAD: `d41a667e9b59d3f15ca4c33eea0353ce3f37daec`
- PR: https://github.com/bioShaun/pi-planner-only/pull/4
- base for PR: `planner-only-cost-control`
- date: 2026-09-09 (Asia/Shanghai)

## Change summary

### Ticket 42 — machine-generated report-only correction

1. **Explicit `reportOnly` field** on `TaskSpec` / subagent `input.reportOnly` / `DelegationRecord.reportOnly` (already present). Evidence compare continues to consume `DelegationRecord.reportOnly` (Variant A).
2. **`isReportOnlyPrompt` moved to `roles.ts` as a labeled shim** — only used to *detect* Root-authored correction prose so the extension can machine-stamp the explicit field. Stamp site no longer sniffs.
3. **Machine generation** in `prepareRoleDelegation` / `beginDelegation`:
   - `stampReportOnlyCorrectionInput` sets `input.reportOnly = true` and ensures `agent: "worker"`.
   - Resolves the live Task (named id or active `changes_requested`/`reviewing`/`executing` fallback).
   - Embeds the original TaskSpec (with `reportOnly: true`) ahead of a report-only lead-in, so correction rounds no longer warn `without an embedded TaskSpec` / `no single live Task matched`.

### Ticket 41 — blocked lifecycle (Option 3 + receipt parking)

1. **`abandon`**: special-case allows `blocked → failed`; `failed`/`completed` still refuse. `TASK_TRANSITIONS.blocked` gains `"failed"`.
2. **`sealedAt`**: set when entering `blocked`, cleared when leaving. Late child receipts on `blocked` are **parked into history** (`parkBlockedReceipt`) — no `advanceReview`, no state advance. Wired in `handleSubagentResult`, `handleAsyncNotify`, and `reconcileDelegation`.
3. **`planner_verdict` / `recordRootVerdict`**: unchanged escape hatch on blocked.
4. **`renderTaskStatus`**: discloses verdict-still-accepted, late-receipt parking, abandon→failed, and `Sealed at:`.

### Authorized assert rewrite (RF-7)

- File: `orchestrate.test.mjs` ~L955
- Old: required warn-mode notice `without an embedded TaskSpec` + `attached to task … named in the prompt` for a report-only correction prompt.
- Why red under ticket 42: acceptance explicitly requires those warnings **not** to appear; machine-embedding removes them.
- New: asserts bind + no missing-TaskSpec warning + `DelegationRecord.reportOnly === true`; finishes the prior worker first so the correction can take the write lock.
- Self-check: `git diff -- '*.test.mjs' | grep '^-.*assert'` shows only that superseded `assert.ok(` line.
- **B1–B10 budget-stop asserts untouched.**

## Validation gates

1. `npm run typecheck`: exit 0. Log: `typecheck.log`.
2. `npm test`: exit 0, fully green including `naming.test.mjs` and `planner-only architecture: PASS`. Log: `npm-test.log`.
3. `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e`: exit 1 — `pi-subagents is not installed`. Marked **「e2e 待本机终验」**. Log: `e2e.log`.
4. `git diff --check`: exit 0.
5. Unauthorized assert deletions: only the RF-7 rewrite above (ticket-42 authorized).

## Not done / assumptions

- Ticket 40 and worktree Variant C untouched.
- Did not push `planner-only-cost-control` or `main`.
- e2e contract gate needs a machine with `pi-subagents` installed.
