# 43: TaskSpec ≠ runtime execution controls

**What to build:** Enforce a hard split between TaskSpec (business contract) and runtime execution controls:

1. `validateTaskSpec` must **error** (not warn) when TaskSpec carries execution-control fields: at least `model`, `thinking`, `timeoutMs`, `toolBudget`, `usageBudget`. Keep allowing business `budget` / `cumulativeBudget`.
2. Remove **task-spec** as an effective model/thinking source from the resolution chain. Priority becomes role-policy > explicit input > host-default. Nested TaskSpec model/thinking must not change the resolved model/thinking and must not write back into the launch input.
3. Provenance may still note that forbidden fields were seen and **ignored** (audit-only). Do not leave a path where task-spec wins when policy/explicit are absent.
4. Do not invent per-child `timeoutMs` in this plugin; leave timeout to host. Do not move skill/artifacts into execution controls.

**Background:** TaskSpec started accumulating runtime knobs (`model`/`thinking`) that compete with role-policy and host defaults. That blurs the contract: TaskSpec should describe *what* to do; the host/delegation input and role policy decide *how* to run it. Approved by user + planner for p23.

**Acceptance:**

- `validateTaskSpec` returns errors naming each forbidden execution-control key; `budget` / `cumulativeBudget` still validate.
- `preflightEffectiveModel` never reports `source` / `modelSource` / `thinkingSource` as `task-spec`; when only TaskSpec model/thinking are present, resolution falls through to host-default (or blocks if none).
- `beginDelegation` does not write TaskSpec model/thinking into the child launch input; optional audit warning when they are ignored.
- Existing role-policy and explicit-input paths still work.
- Tests cover the above without deleting unrelated asserts.

**Blocked by:** 无。

**Status:** ready

## Comments

2026-09-12: Intake for cloud-backlog taskspec-exec split on branch `cloud-backlog-2-taskspec-exec-2026-09-12`.
