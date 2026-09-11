# Runtime Reliability Progress Handoff

Date: 2026-09-11
Task: T-pending
Source: `/public/pi/pi-planner-only`
Installed clone: `/home/tcuni/.pi/agent/git/github.com/bioShaun/pi-planner-only`

## Implementation Status

The current source tree contains the runtime-reliability implementation currently under development and its focused fixtures. The installed plugin clone has been synchronized from the source tree, excluding `.git` and `node_modules`. No commit or push was performed, and `settings.json` was not changed.

The synchronized implementation includes the completion receipt and output resolver path, notification/orchestration reliability changes, TaskPacket/report-contract updates, and runtime reliability tests. This handoff covers the local clone refresh and validation gate; it does not claim that the entire runtime-reliability specification has passed live host replay or the M2 data-task requirements.

## Blocked-Task Explanation

The original reload was blocked by a stale installed clone and stale jiti-transpiled module cache. The installed clone was missing dependencies as well, so validation could not run there until its lockfile-defined dependencies were restored. Those blockers are cleared for this handoff: the clone now matches source, dependencies were installed with `npm ci`, and all required local checks pass.

The broader rollout remains gated on real host-protocol replay and acceptance of the remaining specification work. In particular, local fixtures do not prove host-native notification behavior, delayed artifact publication across a session reload, resume lifecycle registration, model-registry preflight, or the M2 non-Git/shared-path/large-file evidence contract. A passing local suite must not be interpreted as formal task acceptance.

## Diagnosis and Root Cause

The audit identified a reliability failure across asynchronous completion ingestion rather than a worker-only report failure:

- Host completions carried `outputPath` and/or `archivePath`, while the old resolver searched a different legacy directory and could report no output even when the report existed.
- Completion processing marked runs consumed and released delegation state before output was successfully read and persisted. Delayed artifacts therefore became difficult to recover, and infrastructure read failures were misclassified as report-contract failures.
- Notifications with an explicit task identity could fall back to agent-name matching, allowing a late receipt from one task to affect another task using the same agent.
- Worker launch packets reconstructed only the embedded TaskSpec and dropped the surrounding delegation instructions, known facts, and artifact references.
- Resume can create a new host run without entering the normal execution, usage, ingestion, and report association path.

These failures explain the observed empty report ledgers and repeated verdict/recovery attempts. They are not evidence that the underlying worker output was necessarily absent; the audit found several parseable reports on disk.

## Validation

Commands were run inside the installed clone after `npm ci`:

| Command | Exit code | Result |
|---|---:|---|
| `npm ci` | 0 | Dependencies restored from `package-lock.json`. |
| `npm run typecheck` | 0 | TypeScript check passed. |
| `npm test` | 0 | Full configured suite passed, including runtime reliability fixtures. |

Stale cache cleanup:

- Deleted `/tmp/jiti/pi-planner-only-*.mjs` entries.
- A post-cleanup count found zero matching entries.
- The pi session was not restarted.

## Next Steps

1. Reload the plugin/session so the next module load compiles the synchronized source afresh; this handoff deliberately did not restart the active pi session.
2. Replay the captured host completion envelopes through the installed clone and verify that the registered output paths load the existing reports without increasing `reportCorrections`.
3. Exercise delayed artifact publication, duplicate sync/bg-wait/notify delivery, explicit foreign task/run identities, and resume with a newly assigned run ID across reload.
4. Verify host model-registry preflight and native-notification capability detection against the installed pi versions.
5. Track M2 separately: non-Git workspaces, shared symlinks/external environments, large-file evidence, and session-level export.
6. Keep formal task verdicts tied to evidence, scope, review, and acceptance criteria; process completion alone is not acceptance.
