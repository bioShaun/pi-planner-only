# p23 ExtractedReport discriminated union — execution report

- round_id: `p23-extracted-report-union`
- taskId: `p23-extracted-report-union`
- branch: `cloud-backlog-2-2026-09-12`
- start HEAD: `5b76f0df8d93775e3b09794f341bd9ab36f52369`
- end HEAD: `25912bce7acdac3f1eed455d5f950215019fa37d` (product landing; docs tip is branch HEAD at PR open)
- base for PR: `main` (cost-control branch gone; PR target is main)

## Change summary

Behavior-preserving type tightening of WorkerReport parse results, matching the honesty bar of host `SubagentDelegationInvalidResponse` / `invalid_request`: error states must not pretend success fields exist.

### `report.ts`

- Replaced optional-field `ExtractedReport` interface with a discriminated union:
  - `ok: true` → required `report`, `repairs`, `level: "schema-valid" | "repairable"`
  - `ok: false` → required `error`, `repairs`; optional `level?: "irreparable"` and diagnostic-only `seenKeys?`
- Added `ExtractedOk` / `ExtractedErr` aliases and `isExtractedOk()` type guard.
- `extractWorkerReport` success / failure returns set `ok` accordingly; irreparable-with-candidate paths set `seenKeys` to the best failed candidate key list (same string already embedded in the error message).
- Error strings and level omission rules unchanged (empty / prose-only omit `level`; irreparable paths keep `level: "irreparable"`).

### Call sites

- `orchestrate.ts`: prefer `extracted.ok` narrowing (stop/403/budget gates, journal gate, `handleWorkerResult`, standalone explorer, validator). Irreparable retention checks updated to `extracted.ok === false && extracted.level === "irreparable"` (same boolean outcomes as `!extracted.report && extracted.level === "irreparable"`).
- `forceReportError` synthetic failure now `{ ok: false, error, repairs: [] }` (still no `level`).
- Tests updated: `report.test.mjs`, `task.test.mjs`, `roles.test.mjs`, `review.test.mjs`, `rt03.test.mjs`. Added focused discriminant asserts (`ok: true` has report / no error; `ok: false` has error / no report property; prose/empty omit level; irreparable carries `seenKeys`).

### Out of scope (unchanged)

- Ticket 40/41/42 / worktree C
- `validateWorkerReport` schema
- `MAX_REPORT_CORRECTIONS` / correction prompts
- No product outcome changes; no unauthorized assert deletions (only rewrite of ExtractedReport-shaped expectations)

## Validation gates

1. `npm run typecheck`: exit 0. Log: `typecheck.log`.
2. `npm test`: exit 0. Includes `planner-only architecture: PASS` and `planner-only naming: PASS`. Log: `npm-test.log`.
3. `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e`: exit 1 — `pi-subagents is not installed`. Marked **「e2e 待本机终验」**. Log: `e2e.log`.
4. `git diff --check`: exit 0. Log: `diff-check.log`.
5. Assert audit: only ExtractedReport-related expects rewritten; no unrelated assert lines removed.

## Not done / assumptions

- e2e contract gate needs a machine with `pi-subagents` installed.
- Did not push `main` tip; work stays on `cloud-backlog-2-2026-09-12`.
- `seenKeys` is diagnostic only — never treated as a WorkerReport or recorded on failure.
