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

**Status:** done（2026-09-12 p23 / PR #6 `4a01320`。）

## Comments

2026-09-12: Intake for cloud-backlog taskspec-exec split on branch `cloud-backlog-2-taskspec-exec-2026-09-12`.

2026-09-12 executor：cloud PR #6 在 `cloud-backlog-2-taskspec-exec-2026-09-12`。validateTaskSpec 拒执行控制字段；preflight 去掉 task-spec 有效来源；ignored 仅审计；e2e 标「待本机终验」。

2026-09-14 事后代码评审（补记）：本票合并时无评审在案 —— `0548350` 的提交信息自述 "merged without a review on record"，而本票已标 `done` 且引用的是另一个哈希 `4a01320`，两者对不上，故补一次评审落档。

- **范围**：`0548350` 中 `task.ts`、`role-models.ts`、`orchestrate.ts` 的全部 diff。
- **核对点**：`validateTaskSpec` 确实对五个执行控制字段（`model`、`thinking`、`timeoutMs`、`toolBudget`、`usageBudget`）报错而非告警，且业务字段 `budget` / `cumulativeBudget` 仍照常校验；preflight 的有效来源链中已无 task-spec，仅余 role-policy > explicit > host-default；被忽略的字段只留审计、不写回 launch input。
- **结论**：未发现语义问题。

遗留（非本票缺陷，供后续参考）：本票引用哈希与实际合并哈希不一致，工单与代码的对应关系需要人工核对才能确定；本票 `done` 状态因此缺少可追溯的评审锚点，本条即为补锚。
