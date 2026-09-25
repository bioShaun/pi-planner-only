# Child TaskSpec: Issue 07 step two strict review

review_kind: final
scope_id: issue07-step2-request-envelope
snapshot_id: issue07-step2-e8c5354112692ec21a45ffa991c4cd1e2d6d8276e0cfe30626d2ff48e1afff14
isolation_requirement: strict

Project: /home/tcuni-claw/pi/pi-planner-only. Evidence: .scratch/stability-next-20260920/issue07-step2. Baseline commit a96559b is the reviewed and committed step-one observation implementation.

You are the terminal astra_reviewer inside an independent read-only parent. Review directly; do not spawn/delegate, edit files, run tests/providers, access credentials, or terminate processes. No /tmp. The outer wrapper owns slot cpu and logged preflight audit/status. Advisory child budget 420 seconds; external whole-run watchdog 600 seconds. If coverage cannot be finished, return BLOCKED with the exact gap.

First prove actual runtime read-only isolation on index.ts: inline Python/Node O_WRONLY open, with no create/truncate/write flags; record errno, covering mount and unchanged SHA256. No here-documents or temporary files. Role TOML or a behavioral refusal is not runtime proof.

Requirements: accepted docs/adr/0010-request-remaining-execution-envelope.md is the final policy. User requested clamping with a recorded original envelope and Root warning, provisional60-second reserve, refusal without child when remaining is insufficient, no refreshed Request deadline, quota, repair or Writer-hold relaxation; behavior change requires strict gate. Ordinary workers/explorers/validators and report-only correction are capped; Reviewer is Request-bounded and can use the reserve. Explicit token-only input receives a Request wall cap but does not inherit a token default. Admission is after pre-launch Git sampling and before execution/grant/recovery/dispatch consumption; the reserve is best effort, not a new allowance or guaranteed completion window.

Implementation report: eight product files implement the admission check, Task-level launchRefusals, effective execution.envelope plus originalEnvelope/envelopeClamped/requestBudget, diagnostics/details/warnings, persistence validation and budget failure classification. The executing transition occurs only after time admission. Four test files cover policy branches, Request stop, ledger compatibility, correction/recovery preservation, original vs effective bounds and Reviewer reserve access. Three existing docs plus the new ADR describe the policy. No step-two changes are committed yet.

Inspect implementation.patch relative to a96559b and the new ADR (untracked so read its file directly). source-manifest.json freezes all16 review paths; verify each. Supporting unchanged callers may be read as needed. Do not audit unrelated issue05/06 changes, old .scratch trees, or rerun their historical gates.

Executable evidence: ../release-run-PotBZh/test-release.log and exit-code.txt record full ordinary-terminal npm run test:release exit0. The wrapper executes slot cpu after saved slot-audit.txt and slot-status.txt. Verify before/after source hashes and current executable files. Outer command/log are ../execution-20260920/release-run-20260920T142600Z.*. Worker focused logs are typecheck.log, p1-delegation.log, request-stop.log, ledger-store.log and delegate-syntax.log; each captures command/exit. orchestrate-sandbox-failure.log retains a failed sandbox spawnSync git EPERM attempt; the full normal-terminal suite subsequently passed. Do not rerun subprocess tests in this read-only sandbox.

Inspect assertion-audit.json: one explicit token-only envelope assertion is moved to originalEnvelope because the effective wall now comes from the Request cap; new assertions verify tokens, source, cap and details. Existing Request hard-stop assertions remain, with fixtures advancing the Request wall clock only after a real REQUEST instead of relying on sub-reserve activeMs. P1/Request-stop run the actual plugin/tools/event transport/ledger with fixture Git/child; they are not paid-model or new TUI evidence.

Return first line exactly PASS (final) / REQUEST_CHANGES (final) / BLOCKED (final), independent checked facts, runtime permission evidence, limitations and prioritized findings with precise location, impact, evidence and minimum fix. No proposed verdict is supplied. Strict completion requires your verdict, executable evidence, matching hashes and actual read-only parent/child permission proof.

Project constraints note: the AGENTS-referenced .codex/codex-subagent-config-astra-planner.md is absent. This self-contained TaskSpec supplies the applicable project/resource/testing requirements. The child should not read the Root-only global delegation protocol. The read-only parent independently owns its runtime probe; its results are not launch prerequisites for the child.
