# Cleanup Worker Report

Status: COMPLETED

The acceptance harness now creates each run under `acceptance/runs/$RUN_ID`, derives the `tcuni-luna` and `qwen-local` provider definitions from the operator's existing `models.json`, writes an explicit provider/model metadata allowlist, and removes only that fresh runtime root on exit. Historical acceptance agent/workspace files remain untouched. Each run also initializes a local Git workspace containing the tracked observation target.

The harness captures slot audit/status, host and pi-subagents versions, source hashes, host stdout/stderr, host exit status, raw child artifacts and session transcripts, and validation status. It exits nonzero when the host exits nonzero or when the captured ledger lacks a completed task with an admitted report or contains an identity mismatch against the execution `runId`. The live host was not run per instruction.

Checks: `bash -n .scratch/explorer-model-config/acceptance/run-acceptance.sh` passed (exit 0). No live acceptance execution was performed.

Files changed: `.scratch/explorer-model-config/acceptance/run-acceptance.sh`, `.scratch/explorer-model-config-closeout/cleanup-worker-report.md`.

Risks/blockers: live slot/identity validation remains pending because the host run was intentionally not started.
