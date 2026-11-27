# Explorer read-only is enforced by task text, not by tools or the lock

Status: Accepted 2026-11-16（用户采纳 issue #28 方案①）

Explorers may run in parallel under a shared cwd lock. Their read-only posture is the closing sentence in the task, not a tool filter and not the lock. This ADR keeps that. It does not change tools or lock code.

## Facts

- Explorer uses `lock: "shared"` and agent `scout`. The closing sentence says not to modify project files, and allows the runtime-named report file (`delegate.ts:52-57`). The comment above `ROLE_AGENTS` says explorers share a repository because each report is written under the artifact dir (`delegate.ts:40-44`).
- `createCwdLocks` only counts holders. An exclusive hold admits nobody else. A shared hold admits any number of shared holders and refuses an exclusive one (`delegate.ts:80-84`, `delegate.ts:117-129`). The lock does not look at tool names.
- Issue #28 says the shared lock "only refuses `edit`". That does not match the lock. `contract.test.mjs:30-43` fails if the shared-lock agent's declared tools include `edit`, and it still requires `bash` or `write` (`canChange`). That check reads the agent manifest. It is not a refusal inside `createCwdLocks`.
- Installed scout tools, read 2026-11-16 from `~/.pi/agent/npm/node_modules/pi-subagents/agents/scout.md` line 4 (outside this repo): `tools: read, grep, find, ls, bash, write, contact_supervisor`. There is no `edit`. `bash` and `write` remain.

## Options

1. **Accept prompt enforcement (chosen).** No tool or lock change. Risk: a scout that ignores the closing sentence can still `bash` or `write` project files while other explorers share the repository. Revisit option 2 when a real incident shows an explorer modifying project files.
2. **Ship a repo explorer agent that drops `bash`.** Keep `write` so the runtime-named report file can still be written. Not chosen: it forks the builtin scout tool list, and `write` can still touch the work tree if the model ignores the output path.

## Consequences

- The ledger row for this lock is `保留-仅工程`. Its final disposition is `保留（用户 2026-11-16）`.
- `CONTEXT.md` points here. `delegate.ts` and the lock tests are unchanged.
