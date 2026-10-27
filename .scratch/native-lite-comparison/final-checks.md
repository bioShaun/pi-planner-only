# Final documentation checks

Rechecks on 2026-10-27, cwd `/home/tcuni-claw/pi/pi-planner-only`, with `TMPDIR=/project/tmp/pi-native-lite-20261027`. These are not product tests. Main was already fast-forwarded by Root before these checks.

## Links

At `2026-10-27T10:15:57Z`, `node /project/tmp/pi-native-lite-20261027/check-links.cjs` exited 1. The checker treats historical review absolute `:line` references as filesystem paths without validating line numbers; those and other machine-local supplementary references are not portable. The 11 relocated archive links are retained as original historical bytes and are not a green link result. stdout:

```text
MISSING .scratch/native-lite-comparison/archive/diagnosis-supervisor-declaration.md -> ../.scratch/supervisor-declaration/live-tools.jsonl
MISSING .scratch/native-lite-comparison/archive/diagnosis-supervisor-declaration.md -> ../.scratch/supervisor-declaration/slim-tools.before.ts
MISSING .scratch/native-lite-comparison/archive/diagnosis-supervisor-declaration.md -> ../.scratch/supervisor-declaration/slim-red.log
MISSING .scratch/native-lite-comparison/archive/diagnosis-supervisor-declaration.md -> ../.scratch/supervisor-declaration/slim-green.log
MISSING .scratch/native-lite-comparison/archive/diagnosis-supervisor-declaration.md -> ../.scratch/supervisor-declaration/slim-integration-green.log
MISSING .scratch/native-lite-comparison/archive/diagnosis-supervisor-declaration.md -> ../.scratch/supervisor-declaration/check.log
MISSING .scratch/native-lite-comparison/archive/diagnosis-supervisor-declaration.md -> ../.scratch/supervisor-declaration/probe-red.log
MISSING .scratch/native-lite-comparison/archive/diagnosis-supervisor-declaration.md -> ../.scratch/supervisor-declaration/probe-green.log
MISSING .scratch/native-lite-comparison/archive/native-lite-execution-plan-2026-10-27.md -> ../.scratch/reviewer-range-integration-20261027/acceptance.md
MISSING .scratch/native-lite-comparison/archive/native-lite-execution-plan-2026-10-27.md -> planner-optimization-plan-2026-10-26.md
MISSING .scratch/native-lite-comparison/archive/native-lite-execution-plan-2026-10-27.md -> planner-offline-baseline-2026-10-26.md
checked=71 missing=11
```

## Staged whitespace

At `2026-10-27T10:15:29Z`, `git diff --cached --check` exited 2. Output identified only historical evidence whitespace: `.scratch/native-lite-comparison/review-initial.md` lines 7, 10, 13, 16 and 21, each trailing whitespace. This review is preserved byte-for-byte.

At `2026-10-27T10:15:37Z`, `git diff --cached --check -- . ':(exclude).scratch/native-lite-comparison/review-initial.md'` exited 0 with no output. The later unstaged change to `link-check.md` and this new file are outside that staged check.

At `2026-10-27T10:15:57Z`, `git diff --check -- .scratch/native-lite-comparison/link-check.md` exited 0 with no output. `git diff --no-index --check /dev/null .scratch/native-lite-comparison/final-checks.md` exited 1 with no whitespace diagnostics; the new file differs from `/dev/null`. The subsequent addition of this output to the document is not covered by that command.

## Git and fingerprint

At `2026-10-27T10:15:30Z`:

```text
$ git rev-parse HEAD
f818cc91c98d6129a152fb28161e00d2f601e494
exit=0
$ git status --porcelain=v1 --untracked-files=no
A  .scratch/native-lite-comparison/archive/diagnosis-supervisor-declaration.md
A  .scratch/native-lite-comparison/archive/native-lite-execution-plan-2026-10-27.md
A  .scratch/native-lite-comparison/archive/native-status-acceptance.md
A  .scratch/native-lite-comparison/archive/research-native-workflow-concurrency-2026-10-27.md
A  .scratch/native-lite-comparison/archive/research-pi-subagents-supervisor-upstream.md
A  .scratch/native-lite-comparison/archive/research-pi-subagents-supervisor.md
A  .scratch/native-lite-comparison/evidence-index.md
A  .scratch/native-lite-comparison/link-check.md
A  .scratch/native-lite-comparison/native-runtime.md
A  .scratch/native-lite-comparison/observations.md
A  .scratch/native-lite-comparison/protocol.md
A  .scratch/native-lite-comparison/recommendation.md
A  .scratch/native-lite-comparison/review-initial.md
A  .scratch/native-lite-comparison/root-brief.md
A  .scratch/native-lite-comparison/sync.md
exit=0
$ git -C /project/tmp/pi-native-lite-20261027/worktree rev-parse HEAD
f818cc91c98d6129a152fb28161e00d2f601e494
exit=0
$ sha256sum .scratch/native-lite-comparison/checks.log
30977f7bf39b513d6d5c00188f2c17722aaca22df36c1c9f9f7b64d9800c9f4d  .scratch/native-lite-comparison/checks.log
exit=0
$ git diff --name-status 3db1846aedb23a6b5552f69ffb70b552cdb94c7a HEAD
M	CHANGELOG.md
exit=0
```
