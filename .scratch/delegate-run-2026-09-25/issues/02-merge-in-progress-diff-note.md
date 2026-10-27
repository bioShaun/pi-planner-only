# 02: say when the child diff summary includes an in-progress merge

Status: ready-for-agent
Resolution: implemented and accepted by Root on 2026-10-27
Type: task
Blocked by: none

Source: `../spec.md`.

## Problem

On 2026-09-25 Root delegated conflict resolution to a worker while `git merge` was in progress. The post-run summary said `Diff since 8f7eb0f4: index.ts | 553 +++…` and listed `index.ts` as already uncommitted and changed again. The 553 lines were mostly the incoming merge, not the worker's resolution. The summary was correct about which paths changed, but Root could read the size as the child's work.

## Proposal

When `MERGE_HEAD`, `REBASE_HEAD`, `CHERRY_PICK_HEAD`, or `REVERT_HEAD` exists in the child cwd before or after the run (`git rev-parse -q --verify <ref>`), add one line to the summary, for example: `Note: a merge was in progress; the diff stat includes the incoming changes, not only the child's.`

## Acceptance

- The note appears only while one of those operations is in progress.
- No extra git call when the cwd is not a work tree.
- `git.test.mjs` covers merge in progress and a normal run.

## 2026-10-27 execution

The agreed contract also covers operations present before delegation but finished by the child. The note says the operation was detected before or after delegation, without claiming it is still active. Only the four specified refs are probed; errors do not imply an operation. Root reviewed the actual diff, red/green output, complete release output and source/log hashes, and accepted the change.

Validation: real conflict regression failed before implementation and passed afterward; marker timing, absent markers, non-work-tree calls, and probe failures are covered. The isolated release suite passed. Evidence is in `.scratch/git-operation-summary-20261027/`.

Execution: completed; Root acceptance: [acceptance.md](../../git-operation-summary-20261027/acceptance.md).
