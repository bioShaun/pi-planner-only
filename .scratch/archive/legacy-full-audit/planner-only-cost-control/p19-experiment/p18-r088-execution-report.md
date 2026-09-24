# p18-r088 Execution Report

- round_id: `p18-r088`
- scope: `SPLIT-39` only (luna root + qwen-local worker)
- CAP_USD: unset; no cap override was made.
- start main HEAD: `54cc814479befa190fcc3af6921b183fd6e275de`
- end main HEAD: `54cc814479befa190fcc3af6921b183fd6e275de`
- start worktree HEAD: `45d9493e25f47c58911edc01757c6133caeaa39d`
- end worktree HEAD: `45d9493e25f47c58911edc01757c6133caeaa39d`
- `SPLIT-39` exit: `0`

## spend.py output

```text
0.009766
0.047220
```

The first line is `spend.py --require .../runs/session-SPLIT-39`; the second is `spend.py .../runs`.

## Acceptance checks

- Main repository `git diff --stat -- index.ts orchestrate.ts orchestrate.test.mjs`: empty.
- `runs/session-SPLIT-39`: present.
- No new `session-ISO-38` or `session-SPLIT-38` observed.
- Worktree sample `git diff --stat`:

```text
orchestrate.test.mjs | 4 ++--
 1 file changed, 2 insertions(+), 2 deletions(-)
```

- Slot preflight logs: `p18-r088-slot-audit.log` and `p18-r088-slot-status.log`.
- Existing worktree untracked entries `.agent-dir-ISO-39/` and `.agent-dir-SMOKE/` were not modified. Existing `session-ISO-39` and `session-SMOKE` were not opened or changed.

## Assumptions / deviations

- The specified worktree was clean of tracked changes in `orchestrate.test.mjs`, but its detached HEAD (`45d9493...`) did not equal the main repository HEAD (`54cc814...`) at start. No checkout, restore, reset, or deletion was performed because the worktree was supplied as-is and changing its commit would exceed the fence.
- The driver itself modified the worktree sample during the permitted run; the sample was not checked back into the main repository.
- No second experiment group was started.
