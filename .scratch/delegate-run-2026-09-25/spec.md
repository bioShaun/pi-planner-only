# delegate: findings from the 2026-09-25 PR-merge session

Source: Root session `01a0d621-c89f-727f-b0e6-431becc662a3` (review and merge of PRs #12–#23), its session jsonl and 9 child artifacts (7 reviewer, 2 worker, all completed, $0.077 total; Root $3.80 over 58 turns).

| Finding | Where it went |
|---|---|
| Reviewer has no shell and guessed `/root`, `/home/heyu`, `/home/zero` for `~/...` paths (9 failed calls; the #23 review could not check upstream pi-subagents) | Fixed: `buildTaskText` states the home directory (CHANGELOG 0.9.0-lite.0) |
| Reviewer only sees uncommitted changes, so a committed PR range needed hand-written `PR-N.diff` files | `issues/01-reviewer-base-diff.md` |
| During an in-progress merge the child diff summary counts the incoming merge changes as the child's | `issues/02-merge-in-progress-diff-note.md` |

Not plugin defects, recorded for the prompt: Root ran 45 small `bash` calls itself (merge conflict resolution, git probes) at ~120k context, so Root was 98% of cost; several 9–16 KB tool outputs (PR bodies, conflict hunks) went straight into Root's context. Workers failed 7 `edit` calls (overlapping or non-matching `oldText`) and tried a missing `apply_patch`.
