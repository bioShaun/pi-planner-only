## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels, used as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Native Codex delegation

When running implementation, verification, or independent review in native Codex, follow `.codex/codex-subagent-config-astra-planner.md` and use the seven project `astra_*` roles. Root owns scope, scheduling, and final acceptance; route complex evidence validation to `astra_validator_complex`, keep one writer per cwd, freeze neutral evidence, and use the separate read-only launcher for a strict review gate. Role/config changes require a new main session. Pi hosts use the lite contract described in `CONTEXT.md`.

### Testing

Run `npm run test:release` (typecheck plus `contract`, `git`, `delegate`, `index` suites) with `TMPDIR` outside the repository. `contract.test.mjs` reads the installed pi-subagents under `~/.pi/agent/npm/node_modules/pi-subagents` (override with `PI_SUBAGENTS_DIR`). Do not delete or weaken existing assertions; add a fault-injection check when adding a guard.
