# p22-r101 Evidence Variant C execution report

- round_id: `p22-r101-worktree-c`
- branch: `cloud-backlog-2-worktree-2026-09-09`
- base: `planner-only-cost-control` @ `faa5378`
- worktree: `/workspace/pi-planner-only-wt-c`
- scope: Evidence Variant C only (declared additional worktree roots)
- out of scope: tickets 40, 41, 42; no B1–B10 changes

## Problem

Evidence sampling only covered the Task `cwd` (main repo). Linked worktree edits
were invisible to Root's A/C samples, so Worker declarations of those paths
always surfaced as `reported changes no longer present` / `over-reported`.

## Change

1. **TaskSpec.additionalWorktreeRoots** — optional absolute roots, resolved at
   `createTaskSpec` time; duplicates and the primary `cwd` are dropped. Documented
   path policy: only declared roots are probed (never `git worktree list` /
   sibling scan); additional-root dirty paths are recorded absolute; relative
   Worker declarations remapped onto a declared root when the primary resolution
   is absent from the sample.
2. **captureEvidence** — probes each declared root and merges changed /
   untracked / committed / dirty-hash sets (absolute under that root) plus a
   combined status hash.
3. **compareEvidence** — treats paths under declared roots as in-workspace
   (not Variant B exempt) and remaps relative declarations via
   `resolveDeclaredPath`.
4. **orchestrate.ts** — every evidence capture/compare passes
   `task.spec.additionalWorktreeRoots` when present.
5. **Tests** — blind spot vs declared-roots fix (unit + mock runner + real
   `git worktree add`); TaskSpec validate/create/extract; Variant A/B asserts
   untouched.

## Validation

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 — log `typecheck.log` |
| `npm test` | exit 0; `planner-only architecture: PASS`; naming note OK in this env (`planner-only naming: PASS`) — log `npm-test.log` |
| `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` | exit 1 — pi-subagents not installed; **e2e 待本机终验** — log `e2e.log` |
| `git diff --check` | exit 0 — log `diff-check.log` |
| Deleted asserts audit | `git diff -- evidence.test.mjs task.test.mjs \| grep '^-.*assert'` → empty |

## Changed files

- `types.ts` — TaskSpec field + path-policy JSDoc
- `task.ts` / `task.test.mjs` — create / validate / extract
- `evidence.ts` / `evidence.test.mjs` — sampling, compare, Variant C tests
- `orchestrate.ts` — wire roots into capture/compare
- `.scratch/planner-only-cost-control/p22-r101-worktree-c/*` — this report + logs
