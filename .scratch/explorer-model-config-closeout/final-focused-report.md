# Final focused validation

Result: PASS for the requested focused checks. The prior whole-suite FAIL remains recorded in `final-validator-report.md`; it was not rerun.

All commands used project-local `TMPDIR`, `TMP`, `TEMP`, npm cache, and `NODE_OPTIONS=--max-old-space-size=768`, each bounded by `timeout --signal=TERM --kill-after=5s 55s`.

| Command | Exit | Wall |
|---|---:|---:|
| `node explorer-model-config.test.mjs` | 0 | 1.608s |
| `npm run typecheck` (`tsc --noEmit`) | 0 | 3.109s |
| `node rs01.test.mjs` | 0 | 0.208s |
| `node delegate.test.mjs` | 0 | 4.309s |

Logs: `focused-explorer.log`, `focused-typecheck.log`, `focused-rs01.log`, and `focused-delegate.log` in this directory. `git diff --check` exited 0.

Hashes match `.scratch/explorer-model-config-closeout/after-config-correction2.json` for all scoped source and fixture files, including `explorer-model.ts` (`bf8c861e...ebb2c`), `explorer-model-config.test.mjs` (`60ae2215...0a824`), and the remaining listed files.

The existing subprocess diagnosis remains accurate: allocator children executed and wrote distinct durable claims, while async Node `console.log` output through pipes disappeared. This focused validation does not establish real Pi E2E behavior.
