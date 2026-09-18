# Explorer 委派遵循子代理模型配置

Status: ready-for-agent
Type: spec
Date: 2026-09-18
Source: T-20260918-004 的模型继承排查

## Problem Statement

操作者为子代理配置了模型和 thinking，却发现 `planner_delegate` 的 Explorer 使用了 Root 模型。配置不能预测实际运行行为，导致成本、速度和任务能力与预期不符。

已核对的事件发生在工作目录 `/public/scripts/tc-skills`：Task `T-20260918-004` 的 Root 使用 `kimi-coding/k3-256k`，Explorer 的实际 assistant 消息也记录为同一 provider/model。用户配置的 `scout` 则是 `qwen-local/qwen3.8-27b`、thinking 为 `low`；子代理全局默认模型为 `tcuni-ds/deepseek/deepseek-v4.1-flash`。这些模型名称是事件证据，不是产品默认值。

当前 Explorer 为证明 `restricted-reader` 能力，启动的是插件注册的运行时代理 `planner-scout`。注册定义未提供 model/thinking，Delegation 请求也未提供这两个字段。当前安装的宿主依赖在普通代理发现和配置合并后才追加运行时代理，因此 `planner-scout` 没有获得 `scout` 配置，也没有获得子代理默认模型，最终走到 Root 模型继承分支。

现有宿主工具测试验证了 Explorer 绑定和只读工具列表，但没有覆盖“操作者的模型配置 → 实际启动选择”这一链条。

## Solution

Explorer 保持使用受信任的只读运行时代理，同时接入现有子代理 model/thinking 配置。操作者已有的 `scout` 配置应对 Explorer 生效，无须复制代理定义、修改任务提示词或重新填写每个 Task 的模型。

模型选择在每次 Delegation 启动前完成，并通过结构化宿主契约交给启动器。只有配置明确要求继承，或没有适用的模型配置时，才按宿主现有语义继承当前 Root。配置读取失败、配置非法或指定模型不可用，不得伪装成“没有配置”而静默使用 Root。

本规格同时覆盖创建 Task 的 `planner_delegate` 和重新绑定 Task 的 `planner_redelegate` 中的 Explorer 执行。实际运行记录继续依据宿主返回的 model/thinking，不能用配置期望值冒充实际值。

## User Stories

1. As an operator, I want Explorer to use my configured scout model, so that delegated reconnaissance has the cost and capabilities I selected.
2. As an operator, I want Explorer to use my configured scout thinking level, so that its reasoning effort matches my configuration.
3. As an operator, I want existing scout settings to work without migration, so that upgrading the planner does not require duplicate configuration.
4. As an operator, I want an explicitly configured planner-scout model to take precedence over the scout model, so that I can customize the restricted Explorer independently when needed.
5. As an operator, I want the subagent default model to apply when neither Explorer nor scout specifies a model, so that my general subagent policy remains effective.
6. As an operator, I want project and user settings to follow the host's established precedence, so that Explorer behaves consistently with other agents in the same workspace.
7. As an operator, I want model and thinking to resolve independently, so that a partial override does not discard other applicable settings.
8. As an operator, I want an explicit inherit setting to use the current Root model, so that deliberate inheritance remains possible.
9. As an operator, I want unconfigured Explorer runs to preserve the host's normal fallback behavior, so that this fix does not require mandatory model configuration.
10. As an operator, I want unavailable configured models to produce a clear launch failure, so that I do not unknowingly run a different model.
11. As an operator, I want malformed or unreadable configuration to be reported distinctly from missing optional configuration, so that I can correct the actual problem.
12. As an operator, I want Explorer to remain unable to edit files or run shell commands, so that changing its model does not weaken its read-only capability.
13. As an operator, I want model settings to be the only configuration transferred into the restricted reader, so that ordinary scout tool permissions cannot leak into Explorer.
14. As an operator, I want redelegated Explorer executions to use the same selection rules as initial executions, so that correction and recovery rounds remain predictable.
15. As an operator, I want new launches to use configuration visible under the host's normal reload rules, so that a cached runtime-agent registration does not permanently freeze an old model.
16. As an operator, I want active executions to retain their launch selection, so that later configuration changes do not rewrite execution history.
17. As an operator, I want run records to report the model actually observed by the host, so that I can audit the result of configuration changes.
18. As an operator, I want Root and other delegation roles to keep their current model behavior, so that an Explorer fix does not change unrelated work.
19. As a maintainer, I want a regression test through the registered planner tools, so that a disconnected configuration helper cannot falsely demonstrate that the bug is fixed.
20. As a maintainer, I want a real Pi run with different Root and Explorer models, so that acceptance verifies the host integration as well as request construction.

## Implementation Decisions

- **Separate configuration identity from capability identity.** Explorer continues to launch as `planner-scout` and retain `restricted-reader` capability. `scout` is a configuration compatibility source, not an alternative launch target. Do not remap Explorer to builtin scout, which may expose mutation-capable tools.
- **Resolve within the host adapter, forward through Delegation.** The Pi host adapter obtains the effective model/thinking selection and supplies it to Orchestration through a narrow dependency. Orchestration forwards the selection via the existing structured Delegation request fields. Prefer per-launch values over embedding a configuration snapshot only in one-time runtime-agent registration.
- **Use the existing host configuration semantics.** Prefer a supported host configuration/discovery interface. If the supported dependency version lacks an accessible interface, confine compatibility loading to one adapter and test it against the supported host behavior. Do not spread settings parsing across the task store, packet renderer and launcher. Do not assume an upstream API exists without verifying it.
- **Define the Explorer-specific precedence explicitly.** For each of model and thinking independently, use an explicit `planner-scout` override when present; otherwise use the effective ordinary scout setting, including its applicable definition/overrides and subagent defaults under host semantics. If that leaves the field unspecified, retain the host's established fallback. Preserve the host's project/user/provider-specific precedence within each source. Do not invent a new setting family.
- **Preserve explicit inheritance.** A supported explicit `inherit` model setting is intentional and must not be treated as an empty value that causes a lower-priority model to win. Inheritance uses this session's current Root model, not a global default last changed by another session.
- **Handle partial settings without coupling fields.** A model-only override must not erase an applicable thinking level; a thinking-only override must not erase an applicable model. An explicit supported thinking value such as `off` is not missing. Validate and normalize through supported host semantics before crossing the typed Delegation boundary.
- **Preserve model identifiers.** Keep provider-qualified identifiers intact, including model IDs containing additional slashes. Use the host's resolver for canonicalization and availability checks; do not introduce a second fuzzy model matcher for this repair.
- **Keep the restricted definition authoritative.** Only transfer model/thinking selection. The declared tools remain exactly `read`, `grep`, `find`, and `ls`; no shell, edit, write, nested delegation, replacement prompt, skills or extensions may enter through scout configuration. Keep the existing completion-guard setting and trusted registration gate.
- **Use one path for initial and subsequent execution.** Both planner tool surfaces resolve Explorer selection through the same adapter and Orchestration boundary. Preserve canonical Task identity, immutable acceptance mode and existing RecoveryDecision requirements. A configuration refresh alone cannot bypass the recovery gate.
- **Respect host configuration lifecycle.** Resolve from configuration visible to the host at launch time. Do not promise new hot-reload behavior. When the host has reloaded settings, the next launch must not reuse an obsolete model merely because the runtime reader was already registered; an in-flight execution retains its original selection.
- **Fail visibly instead of silently changing model.** Missing optional configuration is allowed. Invalid/unreadable applicable configuration and an unavailable explicit model must surface through the existing failure/result conventions; no successful Explorer execution may be launched on Root as an undocumented substitute. Preserve supported, explicitly configured host fallback behavior if applicable, rather than inventing fallback candidates.
- **Maintain observation truth.** Existing progress, terminal results and usage attribution continue to use host-reported actual model/thinking. If actual values are absent, keep them unknown. Requested values may inform an existing diagnostic, but must never overwrite actual identity or rewrite earlier execution records.
- **Preserve the typed contracts.** Respect the ADRs governing structured Delegation and separate creation/rebinding. Do not parse model settings from prompts or WorkerReport prose, do not add model authority to TaskSpec, and do not directly import the dependency's raw TypeScript graph in violation of the established package boundary.
- **Keep scope confined to Explorer.** Worker, Reviewer, Validator and Root model routing remain unchanged. Existing role-model-policy helpers and status output do not establish that policy is wired into this execution path; reactivating or redesigning that policy is a separate change.

## Testing Decisions

- **Primary seam: registered Pi planner tool → structured host Delegation.** Extend the existing host integration harness that registers planner tools, handles runtime-agent registration and observes Delegation events. Call the real registered `planner_delegate` and `planner_redelegate` entry points with configuration fixtures. Exercise production configuration loading and selection; do not inject an already-resolved expected model as the only regression test.
- **Prefer observable behavior.** Assert the effective model/thinking passed to the actual launcher boundary, the selected restricted agent and its allowed tools, the presence or absence of launch on failures, and the actual model preserved in returned/persisted results. Avoid assertions about private helper order, source text or the number of internal configuration reads.
- **Prior art.** The current host integration suite already covers missing runtime-reader registration, successful Explorer binding, runtime definition tools, completion guard and structured terminal admission. The Delegation suite provides fake-launcher coverage for shared execution and capability behavior. Existing role-model unit tests provide examples of partial selection and identity handling, but passing those helpers alone is insufficient evidence for this bug.
- **Minimal red case.** Give Root model A, scout model B/thinking low and subagent default model C, with three distinct values. Invoke Explorer through the registered tool without model fields in its TaskSpec. The selected model must be B with low thinking, and the launch agent must still be `planner-scout`. The current implementation must fail this assertion before the repair.
- **Configuration matrix.** Cover explicit restricted-reader override; scout-only override; subagent-default-only selection with an otherwise unconfigured scout fixture; no model configuration; explicit inherit; model-only and thinking-only overrides; thinking off; project/user precedence; provider-specific settings supported by the host; and provider-qualified IDs whose model portion includes a slash. Expected results must reflect actual host semantics, not a duplicate resolver inside the test.
- **Failure matrix.** Cover malformed settings, a present but unreadable configuration source, unavailable selected model and missing trusted reader registration. Verify a visible failure and no successful fallback execution on Root. Retain the distinction between absent optional settings and broken configured settings.
- **Lifecycle matrix.** Test initial delegation and a valid redelegation using the same selection path. Exercise two launches with the host's normal reload between them; the second sees the changed configuration while the first record remains unchanged. Also exercise a changed Root model under explicit inheritance and ensure blocked recovery still requires its existing decision.
- **Capability regression.** Supply scout configuration with broader tools or other non-model fields, then verify the launched runtime reader still has only its four declared read tools and retains `restricted-reader` classification. Model resolution must not bypass the registration capability gate.
- **Identity regression.** Return a host-observed model different from the requested value and verify reporting preserves the observation instead of copying the request into actual fields. Preserve unknown values when the host does not supply them; do not add an unrelated mismatch arbitration system.
- **Unaffected roles.** Retain representative Worker, Reviewer and Validator launch expectations, and assert that Explorer selection never changes the host's Root model.
- **Real Pi acceptance.** After deterministic tests pass, run a bounded observation Task using the supported installed Pi and pi-subagents versions with Root and scout configured to different available models. Record runtime agent identity, launch selection, child session model and host-reported thinking where available. Verify the read-only capability independently of the child's prose. A mocked request alone cannot close this acceptance criterion. If the host cannot report actual thinking, explicitly distinguish requested thinking from unknown actual thinking.
- **Execution discipline.** Test fixtures and runtime artifacts must use an isolated disposable directory under the project, with subprocess temporary-directory settings redirected there; do not modify the user's global settings or the incident workspace. Before any command expected to exceed one minute, use the project-mandated slot audit/status logging and scheduling. Run focused regressions, type checking and the required release checks during implementation; this specification does not claim they have already run.

## Out of Scope

- Changing the work requested by the original tc-skills Task or implementing its tickets.
- Replacing the trusted reader with builtin scout or broadening Explorer capabilities.
- Redesigning model selection for all roles, adding routing UI, or choosing new default models/providers.
- Adding model/thinking fields to the Root-facing TaskSpec or allowing prompt text to control model routing.
- Restoring dormant role-model-policy enforcement or redesigning its diagnostics.
- Rewriting runtime-agent behavior for every pi-subagents consumer. A narrowly justified dependency compatibility change may support this fix, but a general upstream redesign is not required.
- Introducing new automatic retries, fallback model lists, budget rules or recovery actions.
- New live-reload semantics, historical record repair, or rewriting requested identity as actual identity.
- Editing live user configuration, deploying a new release, or restarting the user's active session as part of specification publication.

## Further Notes

- This is a specification for a confirmed integration gap; it does not claim a fix or regression test has been implemented.
- The observed task was still recorded as executing in the inspected ledger snapshot. Diagnosis relies on the child session's observed model and the installed launch path, not on an assumed successful terminal result.
- The selected design preserves the reason `planner-scout` exists: capability restrictions must remain trustworthy even when ordinary scout configuration permits writes.
- The original incident is in tc-skills, but the repair belongs to pi-planner-only's local issue tracker because its Explorer adapter creates this launch path.
- Merely adding a `planner-scout` settings entry does not fix the inspected implementation: runtime registration currently bypasses the relevant settings application. The implementation must connect configuration to launch.
- 用户已确认测试边界：复用注册工具入口的宿主集成测试，覆盖模型、thinking 和只读能力，并补一次真实 Pi 运行核验。

Evidence references retained for implementation (local to the diagnosed machine):

- [Incident Task ledger](/home/tcuni-claw/.pi/agent/planner-only/ledger/T-20260918-004.json)
- [Child transcript, first observed assistant model](/home/tcuni-claw/.pi/agent/sessions/--public-scripts-tc-skills--/subagent-artifacts/f01f7964-13de-4d05-b0aa-9a2bb75bcb48_planner-scout_0_transcript.jsonl:3)
- [User scout configuration](/home/tcuni-claw/.pi/agent/settings.json:37)
- [Installed runtime reader definition](/home/tcuni-claw/.pi/agent/git/github.com/bioShaun/pi-planner-only/delegate.ts:132)
- [Installed Delegation request construction](/home/tcuni-claw/.pi/agent/git/github.com/bioShaun/pi-planner-only/delegate.ts:960)
- [Runtime agents appended after configured discovery](/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/src/agents/runtime-agent-registry.ts:424)
- [Host fallback to parent model](/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/src/runs/shared/model-resolution.ts:305)
