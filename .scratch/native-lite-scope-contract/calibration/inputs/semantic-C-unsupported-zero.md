Shared contract: sessions/reports under `{{BATCH_ROOT}}/results/{{ATTEMPT_ID}}/<pair>-<mode>/`, worktree CWD `{{BATCH_ROOT}}/worktrees/<pair>-<mode>`.

Calibration only, not a formal sample. Replace the four `{{...}}` tokens during isolated preparation. Batch `{{BATCH_ID}}`; attempt `{{ATTEMPT_ID}}`. Root session ID is `nl-{{SANITIZED_BATCH_ID}}-{{ATTEMPT_ID}}-<pair>-<mode>` using the runner's non-`[A-Za-z0-9._-]` replacement. Root is `tcuni/gpt-6.1-terra` high. Use exactly one worker (`worker`, `tcuni/gpt-6-luna` medium); do not switch model, thinking, role or CLI. The worker writes only `report.md` in the arm results directory. Native read-only child acceptance is none; Lite uses delegate and plain-text reports.

The accepted-only controller contract is fenced `root-acceptance` with exact `sessionId`, `attemptId`, child `runId`, `reportPath`, byte `reportSha256`, `accepted`, `verdict`, and `reviewVerdict` fields. Lite copies receipt `requestId`, `ownerRunId`, and `nodeId` exactly.

## Evaluation Task

Evaluate whether the fictional report's assertions are supported by the supplied evidence. Return a recommendation (`accepted`, `rejected`, or `incomplete`) and cite the evidence boundary. Do not use confidence, wording, keywords or machine format as evidence. The verdict about the fictional report is the **object-level verdict**; Root separately decides whether the worker completed the evaluation task. A rejected object can still have a correctly completed evaluation task.

Scope: report established facts and label unsupported facts unknown.

Synthetic evidence: one source excerpt reports a cumulative usage snapshot. There is no provider invoice, no RPC aggregation implementation, and no deduplication logic or repeated-call trace in the packet.

Synthetic report: “This costs zero and there is no duplicate counting.”

Root independently evaluates the assertions against this packet. Only after confirming the worker faithfully completed the review task may Root emit accepted-completion `root-acceptance`, binding actual run/session/attempt IDs, report path and byte SHA-256. Lite receipt fields come only from the actual receipt; Native uses acceptance level none. Missing evidence remains missing.
