## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels, used as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Native Codex delegation

When running implementation, verification, or independent review in native Codex, follow `.codex/codex-subagent-config-astra-planner.md` and use the seven project `astra_*` roles. Root owns scope, scheduling, and final acceptance; route complex evidence validation to `astra_validator_complex`, keep one writer per cwd, freeze neutral evidence, and use the separate read-only launcher for a strict review gate. Role/config changes require a new main session. Pi hosts continue to use the structured contracts in `CONTEXT.md` and `docs/adr/`.

### Testing

Run `npm run test:release` and any test that spawns a child process (`index.test.mjs`, `policy-cutover.test.mjs`, `task.test.mjs`) from a normal terminal or CI, not from a sandboxed agent executor. One such executor returned `spawnSync` `status: 0` with `result.error.code === 'EPERM'` and empty stdout; the probes now assert `result.error` and `signal` first, so that environment fails loudly with EPERM rather than with "PASS string missing". Treat that as an environment fault, not a repo regression — see `.scratch/subprocess-capture-diagnosis-20260918/issues/01-sandbox-executor-stdio-eperm.md`. Do not weaken or reroute the probes to accommodate it.
