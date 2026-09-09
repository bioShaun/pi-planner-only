# p21-r100 cloud backlog execution report

- round_id: `p21-r100-cloud-backlog`
- taskId: `p21-r100-cloud-backlog`
- branch: `cloud-backlog-2026-09-09`
- start HEAD: `7de849add0e6cc9ea8e126e81aa18b086f4aca72`
- end HEAD: `2475429fcb8a0c6c947c8954dcb0cb15f49fafb0` (product landing; docs tip is branch HEAD at PR open)
- base for PR: `planner-only-cost-control`

## Change summary

Five F6 / ticket items, in order:

### ① Ticket 28 field variants (report-only attribution + out-of-repo)

- `evidence.ts`: `CompareEvidenceOptions.reportOnly` skips the unexplained mark for over-reported declarations (Variant A). `isOutsideWorkspacePath` exempts absolute out-of-repo declarations (e.g. `~/.pi/.../pricing.json`) from missing/extraDeclared attribution (Variant B).
- `orchestrate.ts`: detect report-only prompts (`Do not modify files` / `report-only correction`), stamp `DelegationRecord.reportOnly`, pass into `compareWithRootSamples`.
- Tests in `evidence.test.mjs` (28-A / 28-B) and an orchestrate wire check. Red proof: temporarily ignoring `reportOnly` fails `28-A: report-only over-report is not unexplained` (log `28-variants-red.log`).

### ② Ticket 39 — PASS banner

- Moved `console.log("planner-only orchestration: PASS")` from mid-file (~3734) to the end of `orchestrate.test.mjs` so the banner only prints after all assertions.

### ③ B10 narrow mutation proof

- Narrow mutation in `recordRootVerdict`: if `wouldRefuse` (already stopped), force verdict `request_changes`.
- B10 then fails (`changes_requested` vs `blocked`) — **non-vacuous**. Product code restored; proof log `b10-mutation-proof.log`. No assertion rewrite.

### ④ Ticket 38 — session sets + restore filter/cap

- Session Sets: documented **intentional unbounded** policy on `processedRunIds` / `confirmedNotLaunchedIds` (eviction would double-settle).
- `restoreFromLedger`: skip empty-cwd ghosts without TaskSpec; soft-cap restore at `MAX_LEDGER_RESTORE_PER_SESSION` (64), freshest first. Corrupt quarantine placeholders unchanged.
- Tests `38-a`…`38-f` in `orchestrate.test.mjs`.

### ⑤ Blocked lifecycle — design proposal only

- Doc: `.scratch/planner-only-cost-control/p21-r100-cloud-backlog/blocked-lifecycle-design-proposal.md`
- No product behavior change.

## Validation gates

1. `npm run typecheck`: exit 0. Log: `typecheck.log`.
2. `npm test`: exit 0 on this machine (fully green, including `naming.test.mjs`). Output includes `planner-only architecture: PASS`. **Note:** F1 baseline on other hosts expects exit 1 solely from `naming.test.mjs` (`extension install is missing ledger-store.ts`) when the stale install copy at `~/.pi/agent/git/...` is present (G5). Here that install path is absent / not red — recorded as OK per acceptance. Log: `npm-test.log`.
3. `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e`: exit 1 — `pi-subagents is not installed`. Without the require flag, e2e prints PASS (exit 0). Marked **「e2e 待本机终验」**. Log: `e2e.log`.
4. `git diff --check`: exit 0.
5. `git diff -- orchestrate.test.mjs evidence.test.mjs | grep '^-.*assert'`: no removed assertion lines.
6. B10 failure proof under narrow mutation: log `b10-mutation-proof.log`.
7. 28-variant red/green: `28-variants-red.log` / `28-variants-green.log`.

## Not done / assumptions

- Blocked lifecycle: proposal only; no SM change.
- Did not update issue checkbox files (38/39 Status) — leave for planner intake.
- Did not push `planner-only-cost-control` tip; work stays on `cloud-backlog-2026-09-09`.
- e2e contract gate needs a machine with `pi-subagents` installed.
- `package-lock.json` npm-install drift (0.3.2→0.3.3) was reverted and not committed.
