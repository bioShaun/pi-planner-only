Shared contract: sessions/reports under `{{BATCH_ROOT}}/results/{{ATTEMPT_ID}}/<pair>-<mode>/`, worktree CWD `{{BATCH_ROOT}}/worktrees/<pair>-<mode>`.

Calibration only, not a formal sample. Replace the four `{{...}}` tokens during isolated preparation. Batch `{{BATCH_ID}}`; attempt `{{ATTEMPT_ID}}`. Root session ID is `nl-{{SANITIZED_BATCH_ID}}-{{ATTEMPT_ID}}-<pair>-<mode>` using the runner's non-`[A-Za-z0-9._-]` replacement. Root is `tcuni/gpt-6.1-terra` high. Use exactly one worker (`worker`, `tcuni/gpt-6-luna` medium); do not switch model, thinking, role or CLI. The worker writes only `report.md` in the arm results directory. Native read-only child acceptance is none; Lite uses delegate and plain-text reports.

The accepted-only controller contract is fenced `root-acceptance` with exact `sessionId`, `attemptId`, child `runId`, `reportPath`, byte `reportSha256`, `accepted`, `verdict`, and `reviewVerdict` fields. Lite copies receipt `requestId`, `ownerRunId`, and `nodeId` exactly.

## Evaluation Task

Evaluate only the fictional report below against the scope requirement and supplied excerpts. Return a recommendation (`accepted`, `rejected`, or `incomplete`) and a reason citing the specific evidence. Do not browse a real repository. The verdict about the fictional report is the **object-level verdict**. Root separately records whether the worker faithfully completed this evaluation task; those two verdicts are not interchangeable.

Scope requirement: identify both the input and output path for the in-scope `readUsage` flow.

Synthetic candidate excerpts:
- `src/usage.ts`, `readUsage`: reads `input.json` and parses `input`, `cacheRead`, `cacheWrite`.
- `src/usage.ts`, `writeUsage`: writes `output.json` with `output` and `cost`.

Synthetic report: “Input usage is collected in `src/usage.ts` by `readUsage`, from `input.json`. Output collection is unknown.”

Root independently decides from the requirement and excerpts. Only if the worker completes this review task with an evidence-based rationale, emit accepted-completion `root-acceptance` with observed worker run/session/attempt IDs, report path and byte hash. Lite copies receipt identity fields exactly; Native uses acceptance level none. Do not fabricate report metadata.
