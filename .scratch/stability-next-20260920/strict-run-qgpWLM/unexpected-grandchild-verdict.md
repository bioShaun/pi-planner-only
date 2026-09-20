REQUEST_CHANGES

High: the normal reviewer path cannot accept a report-only correction. In [delegate.ts](/home/tcuni-claw/pi/pi-planner-only/delegate.ts:2062), `runReviewInvocation` searches only non-report-only executions whose `reportIndex` equals the latest report revision. A malformed origin has no admitted report index, while the corrected revision belongs to the report-only execution excluded by this filter. A reviewer `PASS` therefore reaches `REVIEW_NO_EXECUTION_EVIDENCE` at [delegate.ts](/home/tcuni-claw/pi/pi-planner-only/delegate.ts:2080). The successful P1-B regression uses `planner_verdict`, so it does not exercise this path. Resolve the latest report-producing execution, follow its immutable `previousExecutionId` when it is report-only, and apply the same report-only/read-only/prior-truth comparison semantics used by orchestration. Add a malformed-origin → successful correction → `role:"reviewer"` PASS regression.

Verified independently:

- Runtime isolation: `/` is `ext4 ro`; `openSync(index.ts, O_WRONLY)` failed with `EROFS`, flags `1`; SHA-256 remained `ec728b0d…471c454` before and after.
- Current manifests match disk: 66/66 source entries and 24/24 harness entries. Baseline freeze accounts for 75 committed files plus the two historical ignored prototype snapshots.
- Final normal-terminal release evidence is current: `release-run-GurHBj`, `npm run test:release`, exit `0`, identical before/after source hashes and repository status.
- Registration refusal, durable correction grant, concurrency consumption, structured-only budget, raw terminal persistence, separate failure family, origin linkage, declaration hardening, and zero report-only Truth paths are implemented and covered.
- Actual capability probe registered `planner-report-only`, exposed exactly `structured_output`, made one successful call, matched identity, exited naturally, and left the workspace unchanged.
- Queued, scheduled, and combined TUI evidence has matched REQUEST/CANCEL/cancelled terminal identities, confirmed settlement, chronological post-close counts of `0/0/0`, natural exit `0`, and no forced cleanup. The combined trace records queued input before closure and the scheduled input 249 ms after timer arming.
- P3 contains the predefined 27 rows, 9 per arm and task, repetitions 1–3. All exits, quality, identity, and usage-completeness checks pass; totals independently recompute to `54,524 / 815,498 / 846,506`; all `monetaryCost` values are `null`.
- P3 and TUI evidence predate declaration hardening and do not exercise that repaired path. Their retained provenance reflects that boundary; the later release covers current executable sources.

No project tests were executed, as prohibited by the ReviewRequest. Review scope was the specified diff and named evidence. Runtime: `gpt-5.6-sol`, high effort; elapsed approximately 250 seconds.
