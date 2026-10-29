# Evidence: reviewer range preflight

Baseline: `git rev-parse HEAD` exit 0, `cd5362490251aabdb1214b8041e70542cd5ff54a`. Initial `git status --short` showed pre-existing modified `index.test.mjs` and many untracked files; preserved. `git diff --cached --name-only` exit 0, empty. No release tests or paid sessions run.

## Source evidence

- `CONTEXT.md:13`, `CONTEXT.md:16`, `CONTEXT.md:42`: Native is host-owned; Lite has plain-text child reports. `delegate.ts:202`, `delegate.ts:494`, `delegate.ts:538` and `index.ts:522`: Lite request/public parameters, preflight/dispatch location. `delegate.ts:64`, `delegate.ts:515`, `delegate.ts:593`, `delegate.ts:643`: reviewer no lock/summary, unconfirmed-stop lifetime.
- `subagent-delegation-contract.ts:21`; installed `~/.pi/agent/npm/node_modules/pi-subagents/src/api/delegation.d.ts:20`, `src/slash/delegation-request.js:4`, `:23`, `:54`, `:93`, `:106`: task string max 1 MiB, no input diff/artifact field, `artifacts` boolean, unknown fields refused. Version from installed `package.json` is 0.83.0.
- Installed `agents/reviewer.md:4`, `:21`, `:25`: reviewer has read/grep/find/ls/watchdog_diff, no shell, committed ranges require artifact. Installed `src/watchdog/diff-tool.js:62`, `:69`, `:79`, `:83` confirms launch-HEAD working tree delta and refusal on moved HEAD, not a commit range.
- Local installed `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/read.js:10`, `:29`, `:46`, `:73`, `:109`, `:133`: default read uses filesystem access/readFile on resolved path, supports absolute path and line offset. `dist/core/tools/path-utils.js:38`, `:72` and `dist/utils/paths.js:83`: absolute and parent-relative resolution, no repository containment check in this implementation. `read.js:136` and `dist/core/tools/truncate.js:10`: 2,000 lines/50 KiB per result; a single oversized line suggests bash, unavailable to reviewer. This is source evidence only: effective reviewer tool binding, sandbox/extension wrappers, permissions and actual outside-repo read were not runtime-tested.
- `git.ts:19`, `:27`, `:46`, `:71`, `:97`, `:182` and `git.test.mjs:8`, `:65`: version-gated no-optional-locks, fsmonitor disable, safe diff flags, 7-40 hex/HEAD-only audit regex and clipped output; summary probes are best effort. `index.ts:508`: runner uses `pi.exec`; complete large output/transport behavior not established.
- `subagent-artifacts.ts:1`, `:81`, `:88`, `:107`, `contract.test.mjs:58`: output/transcript locator including repo-local project preference, not input creator or lifecycle. `host.ts:14` only provides bus/session/message capabilities.
- Installed `src/runs/shared/worktree.js:221`, `:225`, `:316`: Native baseRef resolves worktree starting point, disallows 40/64 full IDs and revision expressions; it is not reviewer diff. `contract.test.mjs:42` checks current emitted request against installed parser. Existing delegate tests use fake bus at `delegate.test.mjs:18`, `:24`, `:51`.

## Short Git probe

All probe files remain under `/project/tmp/pi-1000/reviewer-range-preflight-olZoGY`; no `/tmp` files intentionally created. `git --version` exit 0: `git version 2.51.0`. The probe used `mktemp -d`, `git init -q`, `git config` for local identity, `printf | git hash-object -w --stdin`, `git update-index --cacheinfo`, `git write-tree`, `git commit-tree`, `git update-ref`, `git symbolic-ref`, and `git checkout-index -a` to construct two commits and a clean worktree; setup was one shell invocation with final exit 0 (individual setup exits not separately recorded).

At that directory:

- `git status --porcelain` exit 0, empty; `git -c core.fsmonitor=false diff --no-ext-diff --no-textconv 'HEAD~1...HEAD' --` exit 0, showed `-one` / `+two`. Clean worktree does not imply empty committed range.
- `git rev-parse --verify 'main^{commit}'` exit 0, `b4fd919f0f41a76afd00f56b04795c2a462fc57f` (head).
- `git rev-parse --verify --end-of-options 'HEAD~1^{commit}'` exit 0, `4e77b3a5ba66c4633828d47b6bb549ccc0ec02b9` (base); option-looking `--help^{commit}` with the same flag exited 128, `fatal: Needed a single revision`.
- `git merge-base <base SHA> <head SHA>` exit 0, base SHA above. This verifies only installed Git 2.51, not Git 1.8, SHA-256 repos, ambiguous refs, concurrent changes, host tool binding or production transport.

Other inspection: `node -p "require.resolve('@earendil-works/pi-coding-agent')"` exited 1 (`ERR_PACKAGE_PATH_NOT_EXPORTED`); direct installed source inspection was used instead. One broad read search emitted a tool-managed output log under `/project/tmp/pi-1000`; no behavioral test script was generated.
