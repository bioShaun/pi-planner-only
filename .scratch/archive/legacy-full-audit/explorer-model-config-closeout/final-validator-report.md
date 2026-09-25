# Final validator report

Result: FAIL

Validation ran 2026-09-18T09:52:22Z to 2026-09-18T09:52:26Z (3.710 seconds).

Exact whole-suite command:

```sh
timeout --signal=TERM --kill-after=5s 55s env TMPDIR="$PWD/.scratch/explorer-model-config-closeout/validation-tmp" TMP="$PWD/.scratch/explorer-model-config-closeout/validation-tmp" TEMP="$PWD/.scratch/explorer-model-config-closeout/validation-tmp" npm_config_cache="$PWD/.scratch/explorer-model-config-closeout/validation-tmp/npm-cache" NODE_OPTIONS="--max-old-space-size=768" npm run test:release
```

Exit: `1`. Combined stdout/stderr: `release-final.log`. Timing: `release-final-run.txt`.

Observed failure: `task.test.mjs:287`, assertion `independent processes receive distinct ids`; actual and expected were both empty strings. The run stopped before later suite tests. Prior failed attempts remain in the scoped logs (`red-r1-r3.log`, `rs01.log`, and others); no retries or fixes were performed.

Ancillary checks:

- `git diff --check`: exit 0.
- `bash -n .scratch/explorer-model-config/acceptance/run-acceptance.sh`: exit 0.
- Credential/secret runtime-copy search under `.scratch/explorer-model-config`: no matches.
- `git check-ignore -v .scratch/explorer-model-config/acceptance/run-acceptance.sh`: exit 1 (not ignored).
- `git check-ignore -v .scratch/explorer-model-config/acceptance/runs/representative.json`: exit 0; ignored by `.gitignore:36`.

Scoped source and fixture hashes after validation match `validation-before.json`:

```text
explorer-model.ts 2709f1b07633be4bedf52ac8483fb73a8c9d6fdac113e876e0a2a85926f9ea48
explorer-model-config.test.mjs 7848c5218e3db75b369559e58e152b48a69521136dff6dcbc20a9945e1f1576c
delegate.ts ea86aa44a266b53b8719104efd1202631e7ed9040a77955cdf2fe4bb9448615a
index.ts 5b378e9fef53c9f38f82d285459079cb2b100321a8a131d5c1f748d7027c17f2
package.json 16e6b3033a8a0d56415f18a136e16fe75d0473b261b4422f28d77c044611c2b2
.gitignore ade7803736f2831f4158828ab3eeed02f75750290ab19e2ddb2c0216291fbd93
rs01.test.mjs 5fd786c41396f366105124d057256933810ae3ea0a54280972ef9c0880fb5079
.scratch/explorer-model-config/acceptance/run-acceptance.sh 2c06be673c40ede397fa695395a64952281fd09695ff31e7575d01856aca743c
```

Generated directories observed under the closeout scope: `tmp/node-compile-cache`, `validation-tmp/node-compile-cache`, and `validation-tmp/npm-cache`.

This deterministic local suite does not establish real Pi E2E behavior.

## Minimal subprocess probes

Direct `node -e 'console.log("direct-child-output-probe")'` exited 0 and emitted the expected text. The requested parent `spawn(process.execPath,["-e","console.log(\"child-output-probe\")"], pipes)` smoke exited 0, but captured `stdout:""` and `stderr:""`; raw JSON is in `validation-tmp/child-output-probe.log`.

The isolated allocator probe used the exact test child pattern from `task.test.mjs:274-286` with two concurrent children and a unique project-local root. Both children exited 0 and reported empty captured stdout/stderr, while the filesystem contains distinct durable claims `T-20260911-001.json` and `T-20260911-002.json`. Raw command output and the exact generated `childCode` are in `validation-tmp/allocator-probe-0954.log`. This reproduces a subprocess stdout capture issue; the allocator did execute and generated distinct IDs. `git diff -- task.ts task.test.mjs` was empty; neither file changed from baseline.

Further bounded capture diagnosis is in `validation-tmp/capture-diagnosis-0956.log`. Async Node `console.log` through a pipe captured empty output with no data events; `fs.writeSync(1, ...)` and `/bin/echo` captured correctly; redirecting Node stdout to a regular project-local file wrote `file-child`. `spawnSync` returned status 0 with empty stdout/stderr and `EPERM` on the Node executable. The initial diagnosis command failed with `ERR_AMBIGUOUS_MODULE_SYNTAX` due to mixed `require` and top-level await; the corrected run is preserved. This is environmental subprocess console/pipe behavior, not an allocator claim collision.
