# 02: say when the child diff summary includes an in-progress merge

Status: needs-triage
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
