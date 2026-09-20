PASS

Verified:

- Runtime isolation: `index.ts` `O_WRONLY` open failed with errno 30 (`EROFS`) on `/dev/nvme0n1p2 ext4 ro,nosuid,nodev,relatime`; SHA-256 remained `ec728b0d6a9fbc0979f552d2678efd9931cf1ab5f8b66de5778698e0a471c454`.
- Current manifests match disk: 66/66 source entries and 25/25 harness entries.
- `report-only-run-3zZ7ry`: public registration declares production `tools: []`; the observed child active-tool set is exactly `["structured_output"]`; one successful call/result occurred; REQUEST/terminal identity matches; Luna/low terminal completed with exit 0; workspace status stayed empty; host exited naturally with status 0. The harness imports no private launcher internals and writes only its private runtime/evidence. `report-only-run-xMGYAr` remains rejected: `NOT_PROVEN`, `structured_output_failed`, outer wrapper exit 1.
- Real TUI raw chronology matches proofs:
  - queued: follow-up input at event 10 before cancellation;
  - scheduled: settlement at 18, timer fired 251 ms after arming, extension input at 21;
  - combined: queued input at 10, settlement at 19, timer fired after 249 ms, scheduled input at 22.
  - All three have matching REQUEST/CANCEL/cancelled RESPONSE tuples, real `hasUI:true` / `mode:tui`, chronological post-cancel provider/tool/REQUEST counts 0/0/0, final settlement, unchanged Request identity, three-second quiet periods, `forcedCleanup:false`, and natural exit 0.
- P3 independently recalculated from 27 raw trials: predefined schedule preserved; all statuses 0 and quality true; all identities verified; all `monetaryCost` values null.
- Raw usage contains 128 Root records and 20 matched, unique completed child terminals. Including input/output/cache-read/cache-write, totals are direct `54,524`, baseline `815,498`, optimized `846,506`.
- Independently sorted process durations reproduce totals `78,182 / 404,733 / 400,493ms`, medians `7,560 / 35,585 / 34,879ms`, and maxima `16,773 / 94,617 / 64,503ms`. `run-study.mjs` starts timing immediately before `spawnSync("slot", ...)`, so the documented basis is slot submission through host exit.
- All 27 retained private workspaces match `quality-audit.json` bodies, SHA-256 values, and Git statuses. Read trials are clean; edit trials contain only `M value.json` with `{"enabled":true}\n`; all required answer suffixes match.
- All nine baseline model-control records pin Luna/low. Each public runtime-registration observation changes only `model` and `thinking`; the private builtin overrides do the same. All 26 copied baseline source files exactly match commit `85bdd2a`, with no extras; the model pin does not alter tools.
- The 18 delegated P3 ledgers contain 20 executions, no report-only execution, no task/review findings, and no nonempty undeclared/out-of-scope/extra-declared/external path arrays.
- Kimi and DeepSeek attempts remain separate failed runs with zero launcher REQUESTs; they are absent from the 27-row study.
- Each accepted host/P3 wrapper records source and harness before/after equality and exit 0. Measured hashes are explicitly pre-hardening: current `delegate.ts`, `evidence.ts`, and `orchestrate.ts` differ, while `pre-truth-hardening-source.json` matches the measured hashes. No old hash is presented as current.
- `release-run-GJqscr` records exit 0, identical before/after status and source hashes, and all 60 retained hashes match current files.
- ADR-0008 accurately keeps ten minutes as an operational default without claiming an empirical optimum; all 20 measured children completed below five minutes, so this study cannot distinguish five from ten minutes and does not expand Root read policy.
- `strict-run-ONdoZZ` is correctly retained as exit 124 with no verdict. Since `strict-run-ed0kfI`, source manifests are identical. Harness manifests differ only in `ReviewEvidenceRequest.md` and `run-execution-terminal.sh`; reconstructing the latter with evidence timeout `420` reproduces the prior hash exactly, proving the sole script change is evidence timeout `420 -> 600`.

No findings. I did not execute project tests or providers. This review covers the named actual-host/P3 evidence and its provenance boundary, not final implementation correctness or universal behavior across other host modes.
