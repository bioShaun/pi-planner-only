REQUEST_CHANGES

High: report-only corrections for a read-only Explorer origin can fabricate file declarations and still pass. [delegate.ts](/home/tcuni-claw/pi/pi-planner-only/delegate.ts:1704), [delegate.ts](/home/tcuni-claw/pi/pi-planner-only/delegate.ts:2080), and [orchestrate.ts](/home/tcuni-claw/pi/pi-planner-only/orchestrate.ts:1897) propagate the origin’s `readOnly:true` into declaration checks. Both comparison functions then suppress `extraDeclaredPaths`, `missingPaths`, and declaration findings for read-only executions at [evidence.ts](/home/tcuni-claw/pi/pi-planner-only/evidence.ts:1497) and [evidence.ts](/home/tcuni-claw/pi/pi-planner-only/evidence.ts:1824).

Trigger: create a default worktree Explorer Task, receive a malformed report, then return a report-only correction declaring an unchanged or absent in-repo file. The correction adds no Truth paths, but Root and delegated-reviewer comparisons treat the declaration as reliable; a PASS can complete the Task. The Explorer positive regression at [p1-delegation.test.mjs](/home/tcuni-claw/pi/pi-planner-only/p1-delegation.test.mjs:463) uses an empty declaration and does not cover this case.

Minimum correction: separate read-only mutation attribution from report declaration validation. For a report-only correction whose immutable origin is read-only, either require empty change declarations or still classify declarations unsupported by origin/prior Truth as over-declared or missing. Add Root and delegated-reviewer regressions using a worktree Explorer origin and fabricated absent/pre-existing paths.

Verified:

- Both prior findings are otherwise closed: reviewer resolution follows the report-only revision to its immutable origin, and freshness now covers `origin.C_report -> repair.A_run -> repair.C_report -> current`; missing origin `C_report` fails closed.
- Registration acknowledgement/refusal, closed agent configuration, durable single-consumer grant, role bypass prevention, hard-one budget, raw terminal persistence, separate failure mapping, and zero repair Truth paths are present.
- `source-manifest.json` matches 66/66 files; `harness-manifest.json` matches 25/25.
- `release-run-piF9Rd` records exit `0`; its 60 before/after hashes are identical and all match current executable sources. Status snapshots are identical.
- The assertion audit’s two removed assertions exactly match the two strengthened replacements; no scoped assertion was silently removed.
- The strict wrapper selects one supplied request, records slot preflight, and the code/evidence child contracts prohibit nested delegation and bound their scopes.
- Runtime isolation: `open(index.ts, O_WRONLY)` failed with errno `-30` / `EROFS`; covering mount is `/dev/nvme0n1p2 ext4 ro,nosuid,nodev,relatime`; SHA-256 remained `ec728b0d6a9fbc0979f552d2678efd9931cf1ab5f8b66de5778698e0a471c454`.

No project tests were executed, as required. Actual-host, TUI, and P3 raw evidence were outside this review scope.
