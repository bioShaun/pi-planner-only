## Review

**Packet completeness:** `patchReturnedFiles: 2 == patchTotalFiles: 2`, `patchTruncated` not set, `patchOmittedPaths` empty — complete packet for both changed files.

**Correctness verified:**
- `roles.ts:51-53` — `oracleSuiteMode()` exists, returns `"bounded" | "full"` based on `PI_PLANNER_ONLY_ORACLE`, trimming and lowercasing. Matches the worker's claim and the task objective ("Print oracle suite on /planner-only status").
- `index.ts:13` — import added: `import { oracleSuiteMode } from "./roles.ts";` — correct named import, file exists.
- `index.ts:920` — `lines.push(\`Oracle suite: ${oracleSuiteMode()}\`)` inserted inside the `action === "status"` branch, right after `Usage log:`, before `notify(ctx, lines.join("\n"))`. The line renders in both UI and headless paths since it feeds the shared `notify` helper. Placement is correct.
- `oracleSuiteMode()` is already an existing consumer contract in `roles.ts:284` (`options.oracleMode ?? oracleSuiteMode()`), so reusing it for status display is consistent, not a new invented API.

**Test coverage:** New probe in `index.test.mjs` spawns an isolated child process, covers both default (bounded) and `PI_PLANNER_ONLY_ORACLE=full`, and asserts the status notice regex. Env mutation happens in the child process only, so no cross-test contamination. Assertion of `oracleProbe.status === 0` with stderr/stdout on failure is sound.

**Scope/hygiene:** Only the two attributed files changed. Untracked `.scratch/*` and `.agent-dir/` are allowed scratch memory per workspace rules; not flagged. Commit `794a8bc` reported, not pushed (acceptable unless pushing is required — the spec lists no constraints or acceptance criteria demanding push).

**Minor (info only):** The spec's `acceptanceCriteria` and `constraints` are empty, so verification is purely against the stated objective, which is fully met. No validation was required (`validation.required: false`), but the worker ran full tests + typecheck anyway, all reported passing.

No issues found.

```json
{"taskId":"T-20260907-001","verdict":"pass","summary":"Change is minimal and correct: index.ts imports the pre-existing oracleSuiteMode() from roles.ts and appends 'Oracle suite: bounded|full' to the /planner-only status notice (index.ts:920), placed inside the status branch so it reaches both UI and headless notify paths. roles.ts:51-53 confirms oracleSuiteMode returns 'bounded' unless PI_PLANNER_ONLY_ORACLE='full' (trimmed, lowercased). New probe in index.test.mjs covers default bounded and full modes in an isolated child process. Packet complete (2/2 files), tests and typecheck reported passing, scope limited to attributed files; untracked .scratch scratch dirs are permitted.","evidenceFresh":true,"findings":[{"severity":"info","category":"other","description":"TaskSpec acceptanceCriteria/constraints are empty and validation not required; review verified against the stated objective only. Worker ran npm test, typecheck, and the extension probe anyway, all passing.","requestedChange":"None."}]}
```