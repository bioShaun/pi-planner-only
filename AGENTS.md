## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`. The active queue is a feature directory directly under `.scratch/`. `.scratch/archive/` is the historical pre-lite campaign and is not a work queue.

### Triage labels

The five canonical triage labels, used as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Mechanism review (§0)

When reviewing new `main` commits, see `docs/agents/mechanism-review.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Native Codex delegation

Pi hosts use the lite contract in `CONTEXT.md`. In Codex, follow the gitignored machine-local `.codex/codex-subagent-config-astra-planner.md` when it is present.

### Testing

Run `npm run test:release` (typecheck plus the suites in the `test` script: `isolated-release`, `contract`, `git`, `reviewer-git`, `reviewer-git-runtime`, `delegate` including `reviewer-range`, `host`, `host-runtime`, `handoff`, `status-color`, `index`, `native-handoff`, `env-isolation`) with `TMPDIR` outside the repository. `contract.test.mjs` reads the installed pi-subagents under `~/.pi/agent/npm/node_modules/pi-subagents` (override with `PI_SUBAGENTS_DIR`). When it fails with `Cannot find package '@earendil-works/pi-ai'` (the installed pi-subagents gets that package from the pi host), run `TMPDIR=<outside the repo> npm run test:release:isolated` as the gate instead and say so in the report; it installs the locked fixture versions and needs registry access. Do not delete or weaken existing assertions; add a fault-injection check when adding a guard.
