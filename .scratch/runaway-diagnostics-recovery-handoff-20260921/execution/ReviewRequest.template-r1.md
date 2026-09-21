# Independent final review — TEMPLATE, prerequisites incomplete

review_kind: final
scope_id: runaway-diagnostics-recovery-01-04-20260921
snapshot_id: 89e4a4cbae991e01b163e11e8e0add6d6291f6222662b3e85c9679f58ba1a018
isolation_requirement: strict

Goal: independently assess issues 01–04 and documentation-only delivery of 00/05 in /home/tcuni-claw/pi/pi-planner-only/.scratch/runaway-diagnostics-recovery-handoff-20260921. Read spec.md including the dated execution scope; user explicitly chose preserving installed packages and preparing release steps/upstream proposal, with no publishing or installation.

Scope and baseline: execution/product-r3.patch is the delta from the pre-task dirty working tree; execution/baseline holds pre-task source copies, baseline-status.txt/baseline.patch identify pre-existing work. Review current files against this delta and requirements. execution/source-manifest-r3.json freezes all root TS/tests/README/package inputs; verify hashes without writes. Other pre-existing dirty concurrency and orchestration changes are not this task's implementation, though integration remains relevant.

Implementation report: worker added bounded UPDATE trace/diagnostic summary; cancellation usage snapshots and replay/replacement; opt-in worker preparation bounds; structured priorExecution packet; retry budget floor; regression tests and README. Root subsequently adjusted existing test budgets for the new floor, fixed the no-usage cancellation branch, preserved preparation reason on a completed-after-cancel result, and corrected recovery tail selection. Writer has stopped. Previous findings and corrections are recorded in execution/code-review-r2.md and ../REPORT.md; require current fresh code-review evidence.

Acceptance:
1. Bounded 64-frame persistent trace and honest summaries. Cancellation lower-bound usage is not fabricated into classified tokens/cost, survives ledger reload, and late complete usage does not double count.
2. Valid opt-in preparation bounds default off and exclude explorer/validator; repeated frames do not count as tools. Cancellation, quiescence, writer holds and recovery controls remain intact. Evidence limits under missing/coalesced progress are explicit.
3. retry_same_plan/fix_environment packet contains prior identity, reason, observed/limit, labelled pre/terminal diffstat, recent tools/args and available output tail, plus recovery reason. TaskSpec remains immutable; caller instructions are distinct. Unknown evidence stays unknown.
4. Smaller same-plan token retry budget is refused before launch/consumption; equality passes; wall milliseconds are never compared as token usage. Refusal counting and registered-tool diagnostics work.
5. Current release checks and actual host child cancellation/recovery evidence substantiate these changes. 00/05 deliverables match the user's documentation-only scope.

Evidence status: BELOW ARE HISTORICAL R1 REFERENCES ONLY. Before launching, replace them with passing current release and host runs and verify their source hashes match snapshot_id. Do not launch this template while prerequisites remain incomplete.

Historical evidence:
- execution/release-Pq0WE7/{command.txt,exit-code.txt,stdout.log,stderr.log,source-before.sha256,source-after.sha256}: npm run test:release, exit 0. Existing npm-path contract parity test skipped because installation is Git-based. Do not treat that skip as parity validation; real installed transport execution is provided separately.
- execution/host-6i2Tco/: real host command/log/exit and source hashes; exit 1 at an artifact-search assertion. execution/host-run-RXGj2l/{versions.json,events.jsonl,task.json,root-tools.jsonl,artifact-*,result.json} retain original raw evidence. Production source hashes match release and host before/after.
- execution/verify-host-evidence.mjs and host-run-RXGj2l/{verification.json,recovery-child-message.json}: corrected pure evidence parser checks both cancelled child executions, real model identity, stop confirmation, absence of holds, immutable spec, diagnostic summary and exact priorExecution packet in first task-bearing child user message. Original failure is preserved. Root is scripted; child provider/tools/launcher are actual. Installed 0.70 host evidence does not broaden declared supported range.
- ../REPORT.md, ../RELEASE-STEPS.md, ../UPSTREAM-PROPOSAL.md.

You may run lightweight read-only checks and independently parse the frozen evidence. Do not rerun child-process tests or paid host runs in this strict sandbox; project AGENTS requires their normal-terminal execution, already recorded. No file edits, test artifact writes, temp files or /tmp usage. Do not read credentials, unrelated logs or global agent protocol. Do not delegate. Commands >1min/>2GB/heavy /data_0 require slot audit/status logging and scheduling; avoid them here.

Strict permission evidence: attempt one actual O_CREAT|O_EXCL write to a unique filename directly under this repository using inline python3 -c (no heredoc, no temp directory). Record actual exception errno; a behavioral refusal or role config is insufficient. If write succeeds, close/remove only that newly created probe, report isolation failure. Parent independently performs its own probe per launcher. Never attempt to overwrite a real file.

Budget advisory 300 seconds for child coverage; external launcher cap 600 seconds. Return covered scope and missing evidence if unable to complete. First line must be exactly PASS (final), REQUEST_CHANGES (final), or BLOCKED (final). Findings require location, impact, executable/source evidence and minimal correction. Include permission-probe evidence and limitations. Do not write a report file; return result via tools/final response for the external launcher to record.
