# Committed range implementation attempt

Status: BLOCKED pending independent review and missing required fault-injection coverage. No commit, push, or staging was performed.

Baseline: cd5362490251aabdb1214b8041e70542cd5ff54a. Worktree: /home/tcuni-claw/pi/worktrees/reviewer-range-20261027.

## Commands and results

- `TMPDIR=/project/tmp/pi-1000/reviewer-range-implementation-20261027 node --experimental-strip-types delegate.test.mjs` before implementation: exit 1; `red.log` shows the assertion expecting `-before\n+after` failed because the request contained no patch.
- Same command after the first implementation: exit 0, `green.log` contains `delegate.test: ok`.
- Same command after adding rejection and stale checks: exit 0, `delegate.test: ok`.
- `TMPDIR=/project/tmp/pi-1000/reviewer-range-implementation-20261027 npm run typecheck`: exit 0.
- `slot audit` and `slot status` saved to resource-preflight and resource-status logs before each release; audit reported no unallocated heavy process.
- `slot cpu -b -- env TMPDIR=/project/tmp/pi-1000/reviewer-range-implementation-20261027 npm run test:release:isolated`: jobs 3623 and 3624 exited 0; `release.log` is job 3624 output. The isolated wrapper runs the actual release command.
- `git diff --check`: exit 0 before final evidence edits; rechecked separately at closeout.

## Design and limits

Uses bounded `execFile` directly for range Git commands, so pi.exec's transport cannot silently clip the patch. Installed pi `dist/core/extensions/loader.js:331` calls `dist/core/exec.js:10`: its `execCommand` accumulates stdout/stderr with no truncation flag or output bound; the existing adapter retains stdout, stderr and code only. Child requests still carry only the existing task string. Range SHA metadata and a live-source caveat appear in task and outcome. The existing no-base path remains intact.

Actual old Git was not tested. SHA-256 repositories, unrelated or criss-cross histories, ambiguous ref configurations, binary forced-text attributes, submodules, bounded execution overflow, pre-dispatch HEAD movement, failed probes, cancellation during a running probe and 1 MiB task boundary need focused tests. In particular no-merge-base currently produces a generic Git execution error rather than the requested explicit no-merge-base diagnostic. Guard fault-injection coverage is incomplete. The reviewer must check the full diff and correctness before accepting this implementation. No paid model session was run.

## Follow-up

The preceding status and limitations describe the first attempt and are retained as history. Follow-up implements separate no/multiple merge-base errors and bounded error reporting, forces submodule visibility for all three diff operations, fixes named-ref resolution under locale and warning configuration, and repairs the README tables. Named refs are resolved to canonical refs before commit resolution. Range commands use `LC_ALL=C` and explicitly enable ambiguous-ref warnings. Non-UTF-8 output and NUL-containing patches are refused.

`followup-red.log` contains actual failures: an unrelated history was misdiagnosed; a clean gitlink plus text under `diff.ignoreSubmodules=all` reached a completed child instead of being rejected; and `core.warnAmbiguousRefs=false` hid an ambiguous ref. The gitlink fault was reintroduced temporarily for its red run and restored immediately afterward. `followup-green.log` records the focused suite passing after fixes.

Real Git fixtures cover divergent base branches and tags, criss-cross and unrelated histories, full SHA-1 and SHA-256 IDs, ambiguous and non-commit refs, clean gitlinks, forced-text binary, exact 32 KiB and one-byte-over diffs, output over the 1 MiB execution bound, 1 MiB task refusal, dirty/HEAD change and status failures before dispatch, post-terminal HEAD change and failed status, and cancellation during preparation. System-boundary Git wrappers inject status failure; no child request is emitted for preflight failures. Actual old Git remains untested; the live checkout checks cannot rule out a change-and-revert race. Root owns independent review and final acceptance. No paid model session was run.

Final focused command `TMPDIR=/project/tmp/pi-1000/reviewer-range-implementation-20261027 node --experimental-strip-types delegate.test.mjs` exited 0. Final release `slot cpu -b -- env TMPDIR=/project/tmp/pi-1000/reviewer-range-implementation-20261027 npm run test:release:isolated` job 3628 exited 0; complete output is `release-final.log`. The final source and evidence hashes are in `sha256-final.txt`.

## Review R1 Follow-up

`review-r1-red.log` records three real Git fixture assertion failures, each exit 1: trailing spaces missing from request patch, a forced-text file with NUL outside patch context reaching a child, and a custom ref namespace reaching a child. The fix adds a patch end marker and checks both frozen blob IDs from the NUL-delimited raw diff with strict UTF-8 decoding and a 1 MiB per-command bound; gitlinks are rejected first. Named refs are limited to heads, remotes and tags. Both README tables were repaired and the ticket progress moved to Comments with the inline decision.

`TMPDIR=/project/tmp/pi-1000/reviewer-range-implementation-20261027 node --experimental-strip-types delegate.test.mjs` exited 0, recorded in `review-r1-green.log`. Real Git tests cover byte-exact trailing whitespace and context, added/deleted/unchanged-region binary, invalid UTF-8 and oversized blobs. A Git system-boundary wrapper launches an actual nonterminating child for `cat-file`; the production 30-second timeout rejected with zero requests and reported 30054 ms in the focused run, without conflating timeout and output overflow. The final release repeated this guard at 30044 ms.

Before final release, slot audit found an unrelated unslotted rsync; after waiting and rechecking, the single serial release was submitted at reduced nice priority without altering or terminating that task. `slot cpu -b -- nice -n 10 env TMPDIR=/project/tmp/pi-1000/reviewer-range-implementation-20261027 npm run test:release:isolated` job 3630 exited 0; output is `release-r2.log`. `git diff --check` exited 0. `sha256-r2.txt` binds this iteration. Old Git remains untested and live-checkout transient changes remain unobservable; no paid session was used.
