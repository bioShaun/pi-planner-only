# P1-A implementation checks

All commands ran from `/home/tcuni-claw/pi/pi-planner-only`. `TMPDIR`, `TMP`,
and `TEMP` pointed at `.scratch/stability-next-20260920/p1-a-implementation/tmp`
for commands that execute project code. Each command's exact stdout, stderr,
and exit code are stored under `logs/` with the corresponding basename.

## Final commands

```sh
TMPDIR="$PWD/.scratch/stability-next-20260920/p1-a-implementation/tmp" TMP="$PWD/.scratch/stability-next-20260920/p1-a-implementation/tmp" TEMP="$PWD/.scratch/stability-next-20260920/p1-a-implementation/tmp" npm run typecheck
TMPDIR="$PWD/.scratch/stability-next-20260920/p1-a-implementation/tmp" TMP="$PWD/.scratch/stability-next-20260920/p1-a-implementation/tmp" TEMP="$PWD/.scratch/stability-next-20260920/p1-a-implementation/tmp" npm run test:p1
node --check delegate.test.mjs
git diff --check -- CONTEXT.md README.md README.zh-CN.md delegate.test.mjs delegate.ts execution-defaults.ts index.ts ledger-store.ts package.json p1-delegation.test.mjs types.ts
```

The full release suite and `delegate.test.mjs` were not executed because they
spawn subprocesses and project instructions require a normal terminal or CI.
`node --check delegate.test.mjs` performs syntax parsing only.
