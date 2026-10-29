Shared contract: sessions/reports under `{{BATCH_ROOT}}/results/{{ATTEMPT_ID}}/<pair>-<mode>/`, worktree CWD `{{BATCH_ROOT}}/worktrees/<pair>-<mode>`.

Calibration only, not a formal sample. Replace the four `{{...}}` tokens during isolated preparation. Batch `{{BATCH_ID}}`; attempt `{{ATTEMPT_ID}}`. Root session ID is `nl-{{SANITIZED_BATCH_ID}}-{{ATTEMPT_ID}}-<pair>-<mode>` using the runner's non-`[A-Za-z0-9._-]` replacement. Root is `tcuni/gpt-6.1-terra` high. Use exactly one worker (`worker`, `tcuni/gpt-6-luna` medium); do not switch model, thinking, role or CLI. The worker writes only `report.md` in the arm results directory. Native read-only child acceptance is none; Lite uses delegate and plain-text reports.

The accepted-only controller contract is fenced `root-acceptance` with exact `sessionId`, `attemptId`, child `runId`, `reportPath`, byte `reportSha256`, `accepted`, `verdict`, and `reviewVerdict` fields. Lite copies receipt `requestId`, `ownerRunId`, and `nodeId` exactly.

## Evaluation Task

Evaluate only the fictional report below against the supplied scope. Return a recommendation (`accepted`, `rejected`, or `incomplete`) and a concise reason tied to the evidence. Do not research a real provider or infer facts outside this packet. The verdict about the fictional report is the **object-level verdict**. Root separately records whether the worker faithfully completed this evaluation task; an accepted review task does not mean the fictional report itself is accepted.

Scope: the reviewer may assess only candidate source excerpts. Candidate source does not include the external RPC provider's internal aggregation or a provider invoice.

Synthetic report: “The candidate sources in the packet do not establish external RPC aggregation or actual provider billing. I mark both unknown. This does not mean zero cost, and I have no evidence to claim that repeated usage is or is not double-counted.”

Root independently judges the object-level verdict from the scope and report. Only if the worker completed the evaluation task with evidence-based reasoning, emit accepted-completion `root-acceptance` with actual runId/sessionId/attemptId, worker role/agent, report path and byte SHA-256. Lite copies receipt requestId/ownerRunId/nodeId exactly; Native uses acceptance level none. Missing report/hash preserves raw failure without invention.
