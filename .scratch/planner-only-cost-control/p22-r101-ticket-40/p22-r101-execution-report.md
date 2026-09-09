# p22-r101 ticket 40 execution report

- round_id: `p22-r101-ticket-40`
- ticket: `40-root-turns-escape-budget-enforcement`
- branch: `cloud-backlog-2-root-budget-2026-09-09`
- worktree: `/workspace/pi-planner-only-root40` (ONLY)
- start HEAD: `faa5378591642fd9bd07e2c000a71b67e55a05d1`
- PR base: `planner-only-cost-control`
- NEVER pushed: `planner-only-cost-control`, `main`

## Change summary

Session-level root cumulative budget (ticket 40):

1. **Config (`floors.ts`)** — soft = workerInitial floor ×3, hard = ×5 (approved 2026-09-09). Env overrides: `PI_PLANNER_ONLY_SESSION_ROOT_SOFT_MULTIPLIER` / `_HARD_MULTIPLIER`. Default soft cost `$1.50`, hard `$2.50`; soft tokens `300000`, hard `500000`.
2. **Accounting (`usage.ts`)** — `UsageLedger.sessionRootSpend()` sums untasked + all Task roots (children excluded; those stay on Task cumulativeBudget).
3. **Gate (`orchestrate.ts` beginDelegation)** — soft pushes a warning (does not block); hard refuses new paid delegations, strips `usageBudget`/`__floorLimits` (E2), holds no reservation, does not change Task state / kill session / kill current root turn. Reviewer exempt so Tasks can still close.
4. **Disclosure (E1/E2)** — `/planner-only status` always shows session root budget lines; soft/hard stop lines when tripped; hard refusal text names the gate; `message_end` notifies once per soft/hard crossing.
5. **Adapter (`index.ts`)** — supplies `getSessionRootUsage: () => ledger.sessionRootSpend()` so orchestrate never imports the ledger (architecture).

B1–B10 Task budget-stop semantics untouched.

Out of scope left alone: tickets 41, 42, worktree C.

## Validation gates

1. `npm run typecheck` / `npx tsc --noEmit`: exit 0. Log: `typecheck.log`.
2. `npm test`: exit 0; includes `planner-only architecture: PASS` and `planner-only naming: PASS`. Log: `npm-test.log`.
3. `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e`: exit 1 — `pi-subagents is not installed`. Marked **「e2e 待本机终验」**. Log: `e2e.log`.
4. `git diff --check`: exit 0. Log: `diff-check.log`.
5. `git diff -- orchestrate.test.mjs floors.test.mjs usage.test.mjs | grep '^-.*assert'`: no removed assertion lines (`NO_REMOVED_ASSERTS`).

## Tests added

- `floors.test.mjs`: multipliers, env overrides, soft/hard evaluation, disclosure strings.
- `usage.test.mjs`: sessionRootSpend aggregates roots, excludes children, costUnknown propagation.
- `orchestrate.test.mjs`: 40-a…40-o soft warn / hard refuse / reviewer exempt / status disclose / strip usageBudget / no reservation leak / absent supplier inactive.

## Not done / assumptions

- e2e contract gate needs a machine with `pi-subagents` installed.
- Issue checkbox Status left for planner intake (not flipped to done here).
- package-lock.json aligned to package.json `0.3.3` / peer range (install drift fix, intentional).
