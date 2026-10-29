Shared contract: sessions/reports under `{{BATCH_ROOT}}/results/{{ATTEMPT_ID}}/<pair>-<mode>/`, worktree CWD `{{BATCH_ROOT}}/worktrees/<pair>-<mode>`.

Calibration only, not a formal sample. Replace template tokens during isolated preparation. Batch `{{BATCH_ID}}`; attempt `{{ATTEMPT_ID}}`. Root session ID is `nl-{{SANITIZED_BATCH_ID}}-{{ATTEMPT_ID}}-<pair>-<mode>` using the runner's non-`[A-Za-z0-9._-]` replacement. Root is `tcuni/gpt-6.1-terra` high. Use exactly one logical validator (`oracle`) and one independent no-shell `reviewer`, both `tcuni/gpt-6-luna` medium. Do not switch model, thinking, roles or CLI. Native read-only children set `options.acceptance: { level: "none", reason: "read-only report; Root performs evidence acceptance" }`; Lite uses `delegate`, and children return plain-text reports.

Validator writes only `validator-report.md`; reviewer writes only `reviewer-report.md` in this arm's external results. The reviewer reads only this immutable, precomputed diff artifact: `{{BATCH_ROOT}}/common/S2-candidate.diff`.

## Task

Validator executes exactly `git rev-parse HEAD` in the current worktree and reports the literal command, cwd, exit code and observed commit. Reviewer inspects only the fixed diff, reports changed file paths, and does not run commands. Do not ask reviewer for validator output. Root independently verifies role/agent, terminals, report bytes/hashes and both task criteria. The object being reviewed and whether each child faithfully completed its role are separate verdicts.

Only after Root checks both reports may it emit the accepted-completion fenced `root-acceptance` JSON. It must include the actual sessionId and attemptId; actual child runId, logical role/agent (`validator`/`oracle`, `reviewer`/`reviewer`), exact reportPath and reportSha256, accepted/verdict/reviewVerdict fields, and accepted=true. Lite copies requestId/ownerRunId/nodeId from each actual receipt; Native has none. Missing reports/hashes retain raw terminal failure and are never fabricated. This calibrates process/role wiring only, not formal merge-review correctness.
