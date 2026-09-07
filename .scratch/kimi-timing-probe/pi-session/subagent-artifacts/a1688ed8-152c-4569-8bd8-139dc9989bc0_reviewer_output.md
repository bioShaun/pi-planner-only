## Review

- Correct: The status-line change is verified in `index.ts` (~line 920): `Oracle suite: ${oracleSuiteMode()}` is appended to the status lines, and `oracleSuiteMode` is imported from `./roles.ts` and confirmed to exist there (roles.ts:51-53), returning `"bounded"` / `"full"` from `PI_PLANNER_ONLY_ORACLE`. Tests in `index.test.mjs` (~lines 600, 610-614) assert both the default `bounded` output and the `full` env override, and cleanup deletes the env var. The feature itself is correct and covered.
- Finding (major, scope/test): `package-lock.json` was modified but is not listed in `workerReport.changedFiles`. The packet shows it dirty (uncommitted) at the reported `finalGitRef` (`1 .M ... package-lock.json`), with a real semantic change: version `0.3.2 → 0.3.3` and peerDependency `@earendil-works/pi-coding-agent: "*" → ">=0.84 <1"`. The peer-dep narrowing affects consumers, and the dirty uncommitted lockfile at the reported head means the validation evidence (`npm test` passing at commit `1b103f6`) does not reflect the actual final workspace state — the evidence packet itself flags this as "stale (revalidate)". The worker report should have declared this file (it was auto-attributed as `undeclaredFiles`), and it should be committed or reverted before merge.
- Finding (info): The lockfile edits are at least internally coherent — they sync the lockfile to values already declared in `package.json` (version `0.3.3`, peerDep `>=0.84 <1`), so this looks like an `npm install` side effect rather than an intentional feature change. Untracked `.scratch/oracle-status-line/` is permitted scratch space and not a defect.
- Note: `taskSpec.objective` and `acceptanceCriteria` are unspecified, so review is against the worker's own stated claims, which the lockfile omission contradicts.

```json
{
  "taskId": "T-20260907-001",
  "verdict": "request_changes",
  "summary": "Status-line feature in index.ts is correct and tested (oracleSuiteMode import verified in roles.ts; tests cover default 'bounded' and PI_PLANNER_ONLY_ORACLE=full). However, package-lock.json was modified (version 0.3.2->0.3.3, peerDependency narrowed '*' -> '>=0.84 <1') without being declared in workerReport.changedFiles, and it remains uncommitted/dirty at the reported finalGitRef, making the validation evidence stale relative to the actual workspace. The lockfile change itself is coherent with package.json (likely an npm-install side effect) but must be declared and committed or reverted before merge.",
  "evidenceFresh": false,
  "findings": [
    {
      "severity": "major",
      "category": "scope",
      "description": "package-lock.json was changed (version bump 0.3.2->0.3.3 and peerDependency @earendil-works/pi-coding-agent narrowed from '*' to '>=0.84 <1') but is not listed in workerReport.changedFiles (only index.ts and index.test.mjs are). Evidence packet shows it as dirty/uncommitted at finalGitRef 1b103f6, so the reported npm test pass does not cover the actual final workspace state; the peer-dep narrowing is also a consumer-facing change that went undeclared.",
      "requestedChange": "Declare package-lock.json in the worker report (or revert it if unintended), and either commit it or re-run validation on the clean tree so the reported head matches the reviewed state."
    },
    {
      "severity": "info",
      "category": "maintainability",
      "description": "The lockfile edits merely sync it to values already present in package.json (version 0.3.3, peerDep '>=0.84 <1'), indicating an npm-install/test side effect rather than a deliberate scope decision; no code-level issue results from the lockfile content itself.",
      "requestedChange": "No action beyond declaring/committing or reverting the lockfile as noted above."
    }
  ]
}
```