# 01: let a reviewer review a committed range

Status: needs-triage
Type: task
Blocked by: none

Source: `../spec.md`.

## Problem

The `reviewer` role has no shell and sees files plus uncommitted changes only (pi-subagents `watchdog_diff`). Reviewing a PR means reviewing commits: the PR-head worktree has no uncommitted changes, so the reviewer sees nothing to review. On 2026-09-25 Root wrote `PR-N.diff` (`git diff origin/main...origin/pr/N`) and `PR-N.md` into each review worktree by hand before delegating 8 reviews.

## Proposal

Optional `base` on `delegate` (commit sha, branch, or `HEAD~N`), valid for `reviewer` (maybe also `explorer`). The plugin runs `git diff <base>...HEAD` in the child cwd (same safe git flags as `git_audit`), writes it to a file the child can read, or appends a bounded diff to the task text, and names the path in the task text.

## Open questions

- File in the child cwd (shows up as untracked and in the post-run Git summary) versus a path outside the repo (reviewer may not be allowed to read it) versus inline (size limit, clipping).
- Whether the post-run summary should ignore that file.
- Size cap for a large diff; what to say when it is clipped.

## Acceptance

- `delegate({ role: "reviewer", cwd, base, task })` gives the reviewer the `base...HEAD` diff without Root writing files.
- An invalid `base` is refused before a child starts, with the git error.
- Tests in `delegate.test.mjs` for the happy path and the invalid-base refusal; no existing assertion weakened.
