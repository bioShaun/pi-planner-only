# Run identity is Root-stamped, never child-declared

Status: Superseded 2026-09-24 by the lite rewrite (`docs/pi-planner-only-subtraction-plan.md`); kept for history. Code: tag `legacy-full-audit`.

A child's WorkerReport does not declare `evidence.workerRunId` (the child-facing schema omits this property entirely); Root stamps the launcher terminal's `response.runId` (defaulting to `executionId`) at the admission boundary before saving the report into the Task ledger. Any child-supplied passthrough values are stripped and disclosed in `warnings` rather than causing rejection.

## Why

1. **Information asymmetry**: A child subagent structurally cannot know the `runId` generated via `randomUUID()` inside the launcher process prior to completion. The 0.5–0.7 contract demanded an unsatisfiable field, forcing child subagents to guess sentinel values (`planner-scout`, `T-20260918-004`, `not-provided-in-launch-packet`) that represented an honest "I cannot know this".
2. **Root already owns execution identity**: The report is extracted from the specific terminal response filtered by the `requestId`/`ownerRunId`/`nodeId` triple. Attribution is already proven by Root's subscription; having the child repeat Root's own tracking metadata adds zero cryptographic or operational evidence.
3. **Compatibility with ADR-0001**: ADR-0001 prohibits Root from altering a child's assertions ("identity checked, never rewritten"). Under this decision, run identity is no longer an assertion made by the child; Root is recording its own factual execution metadata. The child's `taskId` assertion remains strictly checked under ADR-0001, and mismatches continue to produce unaccepted reports.

## Considered options

- **Launcher-provided identity delivery (`LAUNCHER_CAPABILITY_UNSUPPORTED`, `childRunIdentity`, `delegation-capability-probe`)**: Rejected. Offloading the plugin's contract contradiction to an unreleased launcher protocol blocked all child execution on installed `pi-subagents@0.68.0`. Even if upstream implemented runId injection, it would merely have the child echo back a value Root already possessed.
- **Make `workerRunId` optional in child schema but compare if present**: Rejected. Optional fields act as invitations to fill ("please populate", per ADR-0002 §Why experience), which encourages models to continue guessing.
- **Rename the field in ledger and EvidenceRef**: Rejected. The cost of updating 127+ test assertions and maintaining ledger migration complexity is unnecessary; changing semantic ownership at the admission boundary fully resolves the issue while preserving the stable storage shape.
