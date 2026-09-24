## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`. The active queue is a feature directory directly under `.scratch/`. `.scratch/archive/` is the historical pre-lite campaign and is not a work queue.

### Triage labels

The five canonical triage labels, used as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Native Codex delegation

Pi hosts use the lite contract described in `CONTEXT.md`. Native Codex delegation uses the machine-local file `.codex/codex-subagent-config-astra-planner.md` only when that file is present. It is gitignored local config and is not part of this repo. When it is present, follow it: the seven `astra_*` roles, Root owning scope, scheduling, and final acceptance, complex evidence validation on `astra_validator_complex`, one writer per cwd, frozen neutral evidence, and the separate read-only launcher for a strict review gate. Role or config changes require a new main session.

### Testing

Run `npm run test:release` (typecheck plus `contract`, `git`, `delegate`, `index` suites) with `TMPDIR` outside the repository. `contract.test.mjs` reads the installed pi-subagents under `~/.pi/agent/npm/node_modules/pi-subagents` (override with `PI_SUBAGENTS_DIR`). Do not delete or weaken existing assertions; add a fault-injection check when adding a guard.
