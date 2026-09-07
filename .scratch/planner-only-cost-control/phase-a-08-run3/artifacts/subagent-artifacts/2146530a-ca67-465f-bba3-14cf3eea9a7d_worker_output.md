Implemented. `/planner-only status` now prints `Oracle suite: bounded` / `Oracle suite: full` sourced from the same `oracleSuiteMode()` helper that wraps Validator prompts.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "index.ts status action adds exactly one line, `Oracle suite: ${oracleSuiteMode()}`; no changes to oracle behavior, Worker contracts, Reviewer packets, or usage accounting; README untouched per ticket preference."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "New probe block in index.test.mjs asserts the line for default env (bounded) and PI_PLANNER_ONLY_ORACLE=full (full); full npm test suite (14 suites) and tsc --noEmit pass; committed as 794a8bc on branch phase-a-08-rerun-3, not pushed, working tree clean."
    }
  ],
  "changedFiles": [
    "index.ts",
    "index.test.mjs"
  ],
  "testsAddedOrUpdated": [
    "index.test.mjs (oracle suite status probe: bounded default + full env)"
  ],
  "commandsRun": [
    {
      "command": "npm ci --no-audit --no-fund",
      "result": "passed",
      "summary": "lockfile-readonly install (node_modules was absent); package-lock.json unmodified"
    },
    {
      "command": "node --experimental-strip-types index.test.mjs",
      "result": "passed",
      "summary": "planner-only extension: PASS (includes new oracle status probe)"
    },
    {
      "command": "npm test",
      "result": "passed",
      "summary": "all 14 test suites PASS"
    },
    {
      "command": "npm run typecheck",
      "result": "passed",
      "summary": "tsc --noEmit clean"
    },
    {
      "command": "git commit index.ts index.test.mjs",
      "result": "passed",
      "summary": "commit 794a8bc on phase-a-08-rerun-3, not pushed"
    }
  ],
  "validationOutput": [
    "npm test: 14/14 suites PASS (policy, roles, task, report, review, notify, usage, orchestrate, evidence, git_audit, extension/index, workspace-snapshot, architecture, naming)",
    "tsc --noEmit: no errors",
    "New probe asserts /Oracle suite: bounded/ with env unset and /Oracle suite: full/ with PI_PLANNER_ONLY_ORACLE=full"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "index.ts: import oracleSuiteMode from roles.ts, append one status line; index.test.mjs: +64 lines, new spawnSync probe covering bounded default and full env",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "node_modules was absent so npm ci (lockfile-readonly) was required to run tests; package-lock.json not modified. .scratch/ and .agent-dir/ left untracked as instructed."
}
```

{"version":1,"taskId":"T-20241218-001","status":"completed","summary":"/planner-only status now prints 'Oracle suite: bounded|full' via oracleSuiteMode() from roles.ts; covered by a new probe in index.test.mjs for default (bounded) and PI_PLANNER_ONLY_ORACLE=full; full test suite and typecheck pass; committed 794a8bc on phase-a-08-rerun-3 (not pushed), .scratch left untracked","changedFiles":["index.ts","index.test.mjs"],"validation":[{"command":"npm test","type":"test","status":"passed","summary":"14/14 suites PASS"},{"command":"npm run typecheck","type":"typecheck","status":"passed","summary":"tsc --noEmit clean"},{"command":"node --experimental-strip-types index.test.mjs","type":"test","status":"passed","summary":"planner-only extension PASS incl. new oracle status probe"}],"evidence":{"taskId":"T-20241218-001","commit":"794a8bc","branch":"phase-a-08-rerun-3","pushed":false},"risks":[],"unresolved":[]}