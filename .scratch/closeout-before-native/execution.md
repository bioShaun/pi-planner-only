# Closeout before Native: execution evidence

Scope: retain existing steps 0-2 changes; restore only `and output` in the acceptance instruction. No commit, check v1, or model session was run. `index.test.mjs` and all prior evidence remain unchanged by this closeout. Existing changes include host 1.4.0 alignment, offline baseline and research, and step 2 prompt and tests. `host-runtime.test.mjs` is an untracked new file and is included in the review manifest; `final.diff` only contains the tracked paths explicitly requested.

Environment: Node v24.14.0, npm 11.9.0, project and operator pi-coding-agent 1.4.0, global pi-subagents 0.83.0. All commands ran from the repository root with `TMPDIR=/project/tmp/pi-planner-closeout-before-native`. Resource preflights and outputs are in `resource-preflight.log`; no bypassing heavy process was found. No global or repository dependency was changed.

## Commands and results

- `node --test .scratch/closeout-before-native/regression.test.mjs` before fix: exit 1, two assertion failures `acceptance must check both diffs and output`; `regression-red.log` preserves complete output. Both prompts contained `Check diffs before accepting`.
- Same command after fix: exit 0, 2 passed, 0 failed; `regression-green.log` records non-strict length 1498 and strict length 1489, both under 1500.
- `slot cpu -- npm run test:release` with the default global pi-subagents: exit 1, typecheck passed but contract import failed with `ERR_MODULE_NOT_FOUND` for `@earendil-works/pi-ai`. Full output: `release-global-failed.log`.
- After slot audit/status, `slot cpu -- npm install --prefix /project/tmp/pi-planner-closeout-before-native --install-links --no-audit --no-fund /home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents @earendil-works/pi-ai@1.4.0`: exit 0, `install.log`. The installed copy is 0.83.0; recursive comparisons of its `src` and `agents` against the global package both exit 0 (`package-comparison.log`). The old 0.81.0 fixture was not used.
- After another slot audit/status, `PI_SUBAGENTS_DIR=/project/tmp/pi-planner-closeout-before-native/node_modules/pi-subagents slot cpu -- npm run test:release`: exit 0, `release.log`. Typecheck and contract, git, delegate, host, host-runtime, handoff, status-color and index suites passed; host-runtime reports 5 passed, 0 failed.
- `node --test .scratch/offline-baseline/analyze.test.mjs`: exit 0, 4 passed, 0 failed; `analysis-tests.log`.
- `git diff --check`: exit 0, `diff-check.log`; `git status --short` saved in `git-status.log`; no staged paths. `git diff HEAD -- README.md README.zh-CN.md package.json package-lock.json index.ts index.test.mjs` saved to `final.diff`.

## Boundaries

The current static tests and isolated contract source checks do not rerun the historical paid-model sessions or establish that their behavior used this corrected prompt. Historical step 2 lengths 1487/1478 and its session evidence apply to the earlier prompt, not the current 1498/1489 source. Host-runtime exercises the real host with controlled provider and delegation fixtures, not a complete pi-subagents child. The global package still lacks the source test's optional peer, so a default release invocation remains unable to pass in that environment. Steps 3-5 are deferred until after the next Native trial. Root retains final review and acceptance.
