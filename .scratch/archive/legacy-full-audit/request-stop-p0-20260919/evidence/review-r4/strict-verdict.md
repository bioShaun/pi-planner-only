# Strict gate r4 — reviewer verdict (verbatim)

Provenance: child thread `01a0bc77-45a5-7330-bc0f-3b111386a9af` (astra_reviewer, fork_turns none), spawned by read-only parent `01a0bc75-8e43-7360-a5c1-be1c5ac06f81` from `codex exec --sandbox read-only` via `/home/tcuni-claw/.codex/review-readonly.sh`; raw record `rollout-2026-09-20T09-38-48-01a0bc77-45a5-7330-bc0f-3b111386a9af.jsonl` under `~/.codex/sessions/2026/09/20/`. Parent proof of enforcement is in `../../strict-run-5j4u9K/events.jsonl` (write-open on index.ts denied EROFS, hash unchanged, read-only covering mount). The launcher exited 124: the child finished and the parent verified the source was unchanged, but the parent's final relay message did not complete before the 240-second watchdog. Verdict below is copied from the child's final message, unedited.

---

PASS

No actionable findings in the r4 delta.

Verified:

- Runtime filesystem enforcement: `python3 -B -c` independently reported:
  - `hash_before=1f9b4de540bb2d704e256a3b18be2042bcc40c68b603df7819d105fa1a8159d1`
  - `write_open=DENIED errno=30 name=EROFS strerror=Read-only file system`
  - `hash_after=1f9b4de540bb2d704e256a3b18be2042bcc40c68b603df7819d105fa1a8159d1`
  - covering mount: `16881 56 259:2 / / ro,nosuid,nodev,relatime master:1 - ext4 /dev/nvme0n1p2 rw`
- Freeze integrity: `sha256sum -c --quiet evidence/review-r4/source.sha256` exited `0`; all 63 entries match. `git rev-parse HEAD` and `head.txt` both equal baseline `3991c5c762584cbbc235576359734259f69931ce`.
- Comparing r3/r4 manifests shows exactly five changed files: `index.ts`, `index.test.mjs`, `policy-cutover.test.mjs`, `request-stop.test.mjs`, and `docs/adr/0005-durable-request-admission.md`.
- [index.ts](/home/tcuni-claw/pi/pi-planner-only/index.ts:520) derives both the controller key and persisted entry data from the same normalized `(sessionId, workspace)` values. The new predicate at line 536 accepts only an entry whose stored namespace exactly matches that controller. The entry is produced at line 547 from those same values.
- Same-namespace lost-record protection remains intact: [request-control.ts](/home/tcuni-claw/pi/pi-planner-only/request-control.ts:213) faults when storage is missing and `previouslyManaged` is true. The new sibling-workspace regression test at [request-stop.test.mjs](/home/tcuni-claw/pi/pi-planner-only/request-stop.test.mjs:307) proves a sibling entry does not trigger that fault, while deletion and reload of the namespace’s own directory still does.
- Workspace transitions retain the admission boundary at [index.ts](/home/tcuni-claw/pi/pi-planner-only/index.ts:549). Reopening requires settled, idle, interactive input under [request-control.ts](/home/tcuni-claw/pi/pi-planner-only/request-control.ts:403). The adjusted fixtures exercise that sequence; `git diff -- '*.test.mjs' | rg '^-[^-].*assert'` found no removed assertions.
- Normal-terminal release evidence is coherent: `release-run-Xg0XFH/exit-code.txt` is `0`; before/after source manifests are byte-identical; the log records `tsc --noEmit` followed by all 33 named test files, including the subprocess suites and the three new request tests, with their PASS output. The temp root is under `/project/tmp`, and slot preflight evidence is present.
- Raw CLI evidence is consistent with the report. Both `exit.json` files record status `0`. The deadline `request-state.json` records `closedReason: "active-time-limit"`, `rootStop: "confirmed"`, a correlated emitted/terminal claim, and settled state. Its raw summary records one CANCEL, zero model calls, tool calls, and REQUESTs after closure. The natural summary records default limits, an open settled request, two correlated terminals, and a completed task.

Limitations: I did not rerun project tests, as required by the review contract and sandbox constraint. Interactive TUI behavior remains unverified because no TTY evidence exists. Review was limited to the five-file r4 delta, its direct controller behavior, and the specified raw release/CLI evidence. The project-local `.codex/codex-subagent-config-astra-planner.md` is absent; the supplied global protocol and self-contained ReviewRequest were used.
