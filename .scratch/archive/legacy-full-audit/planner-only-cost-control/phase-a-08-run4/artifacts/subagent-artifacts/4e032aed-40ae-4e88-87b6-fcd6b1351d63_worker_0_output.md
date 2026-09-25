Implemented the `/planner-only status` oracle suite line, added tests, validated, and committed on `phase-a-08-rerun-4`.

**Changes:**
- `index.ts` — imported `oracleSuiteMode` from `./roles.ts` (the same helper that wraps Validator prompts) and added `Oracle suite: ${oracleSuiteMode()}` to the status output after the `Usage log:` line. Default env prints `bounded`; `PI_PLANNER_ONLY_ORACLE=full` prints `full`. No change to default oracle behavior, Worker contracts, Reviewer packets, or usage accounting.
- `index.test.mjs` — extended the U-5 status block: asserts `Oracle suite: bounded` by default and `Oracle suite: full` when `PI_PLANNER_ONLY_ORACLE=full` is set (env restored in a `finally`).
- README untouched (status line list already generic enough; no accuracy issue).
- Not pushed; `.scratch/` left untracked.

**Validation:** `npm test` — all 14 suites PASS; `npm run typecheck` — clean; manual smoke test of the status handler shows both `Oracle suite: bounded` and `Oracle suite: full` correctly.

**Note:** this worktree had no `node_modules`, so I added an untracked symlink `node_modules -> /home/tcuni-claw/pi/pi-planner-only/node_modules` to run tests (no install commands, lockfile untouched).