COMPLETED

Implementation is awaiting Root review and acceptance, not a business acceptance. `captureBase` and `summarizeWork` probe the four specified Git refs before and after delegation using safe Git calls. A valid detected marker yields a leading attribution note, including when the operation completed during delegation; failures do not invent a marker. Non-work-trees get no extra probes. Existing dirty-path classification and summary limit remain in place.

Changed: `git.ts`, `git.test.mjs`, ticket 02, and this evidence directory.

Red, exit 1, original excerpt (`red.log` contains the full output):
```
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Note:.*merge.*diff.*not only the child/i. Input:

'New commits:\n' +
  'bff30f5 resolve merge\n' +
  '547bf25 incoming\n' +
  'Diff since 2e3f218e:\n' +
  ' conflict.txt | 2 +-\n' +
  ' 1 file changed, 1 insertion(+), 1 deletion(-)\n' +
  'Note: 1 path(s) were already uncommitted before this delegation and changed again; their diff includes the earlier edits: conflict.txt'
```

Green, exit 0 (`green.log`):
```
git.test: ok
```

Checks (TMPDIR was `/project/tmp/pi-1000/git-operation-summary-20261027`):
- `node --experimental-strip-types git.test.mjs` red exit 1, green exit 0, and after boundary additions exit 0.
- `slot audit` and `slot status` exit 0, raw output in `resource-preflight.log`; audit found no bypassing heavy process.
- `slot cpu -b -- npm run test:release:isolated` submission exit 0, job 3618 finished exit 0; full output `release.log`, including actual `test:release` and all suites.
- `git diff --check` exit 0.
- `git diff --cached --name-only` exit 0, empty; no files staged.

Risk: probes observe only the four specified refs at the two snapshots, so an operation that both starts and ends between snapshots is not detected. Probe errors deliberately leave the operation unknown. Very small summary limits can truncate even the leading note.
