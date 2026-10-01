# Handoff 保留当前 Root 的模型与推理档位

Status: done
Created: 2026-09-28
Execution order: 等用户当前正在处理的问题完成后，再实施本 spec；本次仅登记，不启动修复。
Prerequisite: 当前问题的完成状态需在领取本 spec 时核实；对话没有给出对应票号，不猜测关联工单。

## Problem Statement

用户在 Lite 下执行 handoff 后，看到 `planner-only: handoff from previous session`，随后新 Root 使用了默认模型，而不是交接前当前 Root 使用的模型。用户原本只想缩短上下文、延续工作，不希望模型选择随之改变。

已定位的路径是：handoff 创建全新 Pi 会话，仅传递来源会话标识与交接内容，没有传递当前 Root 的模型。来源会话标识只记录关联，不意味着继承运行设置。Pi 创建新运行实例时重新解析模型配置，新 Root 随即开始处理交接内容。

当前模型与默认模型相同时，这个缺陷不易被发现；两者不同时，新 Root 的能力、成本与响应行为可能发生用户没有要求的变化。现有 handoff 测试验证了交接内容、来源、取消和重试，但没有验证第一条消息实际使用的模型。

## Solution

Handoff 延续交接前当前 Root 实际使用的 provider、model 和有效推理档位。模型与档位应在新 Root 处理任何交接消息之前生效，无须用户先手动切回。

如果无法保留当前模型或已知推理档位，明确告知用户并停止自动继续，保留可恢复的交接内容，不静默使用默认模型处理工作。全局默认模型及 Worker、Explorer、Validator 的模型配置不因 handoff 改变。

## User Stories

1. As a Root operator, I want a handoff to retain my active model, so that the next Root continues with the capability I selected.
2. As a Root operator, I want the provider retained together with the model ID, so that identical model names across providers do not redirect my work.
3. As a Root operator, I want the current effective thinking level retained, so that handing off does not change reasoning behavior.
4. As a Root operator, I want the first message in the replacement session to use the retained settings, so that no work starts on the wrong model.
5. As a Root operator, I want manual handoff to retain the model I am using, so that my saved default does not override this session's choice.
6. As a Root operator, I want an allowed automatic handoff to retain the same settings, so that crossing the context threshold does not change model selection.
7. As a Root operator, I want confirm mode to prepare the new session with the retained settings without sending the brief, so that I can review it before submitting.
8. As a Root operator, I want to remain free to change models after the handoff is ready, so that an explicit later choice takes effect normally.
9. As a Root operator, I want cancellation to leave my existing session usable, so that declining a handoff does not change its model or lose my brief.
10. As a Root operator, I want a failed handoff to preserve its intended model and brief for manual recovery, so that retrying does not accidentally adopt the replacement session's default.
11. As a Root operator, I want a clear explanation when the intended model is unavailable or cannot be restored, so that I can resolve the problem before continuing.
12. As a Root operator, I want handoff to leave saved defaults unchanged, so that unrelated future sessions retain their configured behavior.
13. As a Root operator, I want child role model configuration to remain independent, so that preserving Root settings does not alter Delegation behavior.
14. As a Root operator, I want dropping a pending handoff to remove its retained settings, so that a later handoff cannot reuse stale state.
15. As a maintainer, I want tests to reproduce a current-model/default-model mismatch, so that a passing suite detects this specific regression.
16. As a maintainer, I want evidence from Pi's real session replacement lifecycle, so that fixture success does not hide a failure caused by extension reload or stale context.

## Implementation Decisions

- Extend the existing Lite handoff lifecycle and its pending handoff state. Keep the handoff tool's user-facing brief and cwd inputs; do not add model-selection parameters for the LLM to invent.
- Capture provider, model ID and effective thinking level from the live Root at the start of the first dispatch attempt, before asynchronous preparation or session replacement. This is the handoff source of truth, not the brief, saved defaults, or an older assistant message. A user model change made before dispatch is therefore respected.
- Bind the captured selection to that pending handoff. A retry keeps the original intended selection; dropping the handoff clears it. A fresh handoff captures a fresh selection.
- Resolve the same provider/model in the replacement runtime and apply the selection before sending the brief. Apply thinking after model selection, then check the effective settings before proceeding. Do not treat a success notification or a setter invocation as proof of the active model.
- Use supported Pi lifecycle/API facilities. Session replacement invalidates captured extension contexts; do not call setters through the old extension API after replacement. The exact supported mechanism must be verified during implementation rather than assumed from a similarly named API.
- A `parentSession` relationship is provenance only. Adding model text to the brief, or appending metadata that the live runtime never applies, does not satisfy inheritance.
- Preserve settings at session scope without changing saved global/project defaults. Check the actual setter behavior because host model setters may also persist defaults. Do not temporarily rewrite shared settings files as a workaround.
- Keep Off/Native behavior, handoff admission rules, context thresholds, active-child restrictions and the existing after-turn dispatch timing unchanged. This feature applies only to planner-only handoff in Lite.
- In confirm mode, restore and verify the settings before placing the brief in the editor; do not send it automatically. An explicit user model change after this preparation is allowed and is not overwritten on submission.
- If the source model cannot be identified, refuse the transition with a clear reason. If the target cannot resolve or activate that same provider/model, or an explicitly known thinking level cannot be retained, do not send the brief on a fallback model.
- If the host cannot report an effective thinking level, do not invent one or claim it was preserved. Report that limitation; exact thinking inheritance is required when the source host exposes the level. Keep model inheritance independent of this optional reporting capability.
- Keep cancellation and manual retry/drop behavior. If failure occurs after the replacement session is created, ensure the brief and captured selection are recoverable from the active session; retaining them only in an invalidated extension instance is insufficient. Never automatically loop failed dispatches or duplicate an already submitted brief.
- Keep the change scoped to Root handoff. The Lite domain contract continues to assign child model choices to operator configuration; the superseded delegation-model ADR does not introduce a new child routing requirement here.
- Validate the supported host contract before choosing an API. The investigated local development dependency was Pi 0.84.4, while the installed CLI was 0.87.1. Do not silently require a newer host API while advertising support for older hosts; if the existing public contract cannot support the behavior, record the compatibility decision before implementation continues.

## Testing Decisions

- **Primary seam:** extend the existing extension-level handoff tests, entering through the registered command/tool and observing the replacement session. Prefer this single public behavior boundary over exporting private helpers or adding tests that only inspect pending state fields.
- A good test asserts which provider/model/thinking is active when the first brief is submitted, whether a message was sent, and whether settings or retry behavior changed. It does not merely assert that a model setter was called.
- The host fixture must actually reset the model to a different configured default during session creation. If the fixture simply copies the old model, it cannot catch the reported defect. Make the regression fail on the current implementation before applying the fix.
- The existing handoff cases for command dispatch, automatic scheduling, confirm mode, cancellation, exceptions, retry, drop, mode changes and active Delegation refusal are the prior art. Preserve their assertions and add coverage at the same seam where practical.
- Required behavioral cases:
  1. Current model A, default model B: the replacement's first brief uses A with its original provider and effective thinking level.
  2. Same model ID under two providers: preserve the source provider as well as the ID.
  3. Current model equals the default: successful handoff still works without an extra message or settings mutation.
  4. Manual and allowed automatic dispatch both inherit settings; confirm mode restores settings but sends no message before submission.
  5. A user model change before first dispatch is captured; a deliberate model change after confirm preparation remains effective.
  6. A cancelled transition does not modify the old session's model; manual retry succeeds once and drop discards the captured selection.
  7. Failure after session replacement leaves recoverable handoff state in the active session and does not retry automatically.
  8. Source model absent, target model unavailable, activation refused, activation throws, or observed model differs from the intended one: no brief is submitted using the wrong model and a clear failure is shown.
  9. Known thinking level cannot be restored: no silent downgrade; unknown source thinking is explicitly handled without inventing a level.
  10. Consecutive handoffs do not reuse stale settings; saved defaults and child role model settings remain unchanged.
- Include fault injection for every added guard. In particular, exercise a host setter that reports success while the observed model remains the default, and verify that the first message is blocked.
- **Host lifecycle validation:** reuse the reproduction approach with real Pi session replacement and model resolution, and verify extension reload plus fresh-context settings application. Record the source selection, new-session selection and first request's selection. An isolated host with a local fixture provider may avoid paid inference; pure fixture success must not be presented as real-host proof.
- Record the tested host versions and any unverified compatibility range. The previous offline reproduction uses real replacement/resolver code but a fixture session shell; it does not establish end-to-end UI behavior or a working restoration API.
- Run `TMPDIR=/project/tmp npm run test:release` after implementation, covering typecheck and the contract, git, delegate, host and index suites. Do not delete or weaken existing assertions. If runtime or resource use meets the project's heavy-task threshold, record `slot audit` and `slot status` first and run through the appropriate slot pool. All intermediates stay out of `/tmp`.

## Implementation Notes (verified 2026-09-29, host 0.87.1 + dev-dep 0.84.4)

Host lifecycle facts, verified by source reading of both versions plus two runtime probes and real session evidence:

- **Extension factories re-run on every session replacement.** `main.js` `createRuntime` (0.87.1:576+, 0.84.4:581+) calls `createAgentSessionServices` per replacement → fresh `ResourceLoader` → `loadExtensionsCached` re-invokes each factory (`initializeExtension`) with a **fresh** shared runtime facade. So `plannerOnly(pi)` runs again inside `ctx.newSession`, before `withSession` is called (`finishSessionReplacement`: `rebindSession` → `bindExtensions` emits `session_start` → then `withSession`). Module-level state in `index.ts` survives (jiti caches the module; only the factory re-runs). Empirical confirmation: the 2026-09-28 real handoff session contains a post-replacement `planner-only-mode` entry and a successful `git_commit` — both require a live post-replacement `pi`.
- **The OLD instance's captured `pi` is dead after replacement** (`dispose()` → runner/runtime `invalidate`; probe `/project/tmp/probe-stale2.mjs`: `pi.setModel` throws the stale error even after rebind). Never call the captured `pi` from `withSession`.
- **`rctx` (withSession arg) has no model/thinking setters**, only live getters (`model`, `thinkingLevel`, `modelRegistry`) plus `sendUserMessage`/`setEditorText`/`ui`. Verified identical in both versions' typings and runtime (`createReplacedSessionContext`).
- Therefore the seam is a **module-level bridge**: each factory run stores `{ pi, session }` in a module-level box; `withSession` uses the NEW instance's live `pi.setModel`/`pi.setThinkingLevel` (session-scoped — the loader wrapper never passes `persist`), resolves the model fresh via `rctx.modelRegistry.getModel(provider, id)`, then verifies via `rctx.model`/`rctx.thinkingLevel` read-back before sending. If the bridge was not refreshed (host stopped re-running factories), `pi` is the stale one, `setModel` throws, and the failure path triggers — fail-closed by construction.
- `pi.setModel` returns `false` when the provider lacks configured auth; `setThinkingLevel` clamps to model capabilities — the read-back catches both.
- `findInitialModel` (model-resolver.js:473+) picks CLI > scoped > saved default > first available for new sessions; it never looks at the source session. Hence capture/restore, not resolver tweaks; saved defaults are never touched.

Concrete design (binding decisions for the implementer):

1. `PendingHandoff` gains `selection?: { provider: string; id: string; thinkingLevel?: string }`.
2. Module-level `hostBridge: { pi?: ExtensionAPI; session?: PlannerSession }`, refreshed at the top of `plannerOnly()`.
3. `dispatchHandoff` captures `ctx.model` (`provider`/`id`) and `ctx.thinkingLevel` at the start of the **first** dispatch attempt and stores it on the pending handoff; retries reuse it; drop clears it with the handoff. If `ctx.model` is absent, refuse the transition with a clear reason and keep the handoff pending (manualOnly).
4. `withSession`: notify as today; restore via bridge (resolve model in `rctx.modelRegistry`, `pi.setModel`, optional `pi.setThinkingLevel`); read back `rctx.model` and (when the source level was known) `rctx.thinkingLevel`. On any failure/mismatch: do NOT send or populate the editor; adopt the brief into the live session via `hostBridge.session.deferHandoff(...)` (manualOnly) and `rctx.ui.notify` the reason + retry instructions. Only on full verification: confirm mode → `setEditorText` + notify; otherwise `sendUserMessage`.
5. `withSession` must never throw (all restore logic wrapped), so `ctx.newSession` resolves normally and the old instance's post-call path stays inert.
6. Unknown source thinking level (`ctx.thinkingLevel` undefined): skip thinking restore and say so in the handoff notification; model inheritance still applies.

## Comments

- 2026-09-29: 已实施并通过验收。`dispatchHandoff` 在首次派发时捕获 provider/model/thinking（重试复用、drop 丢弃），`withSession` 内经模块级 `hostBridge` 用新实例的 live `pi` 恢复并在发送前读回验证；任何失败均不发送 brief，交接以 manualOnly 形态被新会话收养，可 `/planner-only handoff` 重试。外层 catch 在替换已发生时把 brief 转存到存活会话并对 stale ctx 的 notify 做了防护（review P1）。测试覆盖 spec 全部必需场景，含说谎 setter 的 fault injection；fixture 模拟了工厂重跑与旧实例 stale（review P2），并断言恢复只经过新实例（`oldModelCalls() === 0`）。生命周期证据：升级后的 `../handoff-model-diagnosis/repro.mjs` 使用真实 0.87.1 `AgentSessionRuntime.newSession` + `SessionManager` + `findInitialModel`，记录到 replacement 初始为 `configured-default`、恢复后首条消息使用 `current-root`（`fixed.log`），control 通过。测试宿主版本：0.87.1（安装版）与 0.84.4（开发依赖，typecheck/typings）。`slot cpu -- env TMPDIR=/project/tmp npm run test:release` 全绿。未做端到端真实 UI 验证（无付费推理）；fixture 成功不作为真实宿主的唯一证据——本条目所列真实生命周期代码路径已包含在 repro 中。

## Out of Scope

- Implementing the fix during this spec-writing turn, or interrupting the user's current issue to work on it.
- Changing Pi's general `/new`, `/fork`, `/resume` or non-planner-only session behavior.
- Reconfiguring global defaults, providers, credentials, child role models, or model availability policies.
- Adding automatic model fallback, model selection by the LLM, or a new generic model-routing system.
- Changing handoff prompts, thresholds, task-boundary policy, or Delegation architecture beyond what is needed to retain Root settings.
- Reintroducing legacy persistent Task/Request ledgers, or building a generic cross-process recovery system. Recovery here concerns the existing handoff lifecycle.
- Publishing a new release or updating the user's installed plugin as part of documenting this spec.

## Further Notes

- Requested sequencing: “生成 spec 文档，等当前问题处理完了修复它。” `ready-for-agent` records specification readiness; it does not override the execution prerequisite above. No claim is made that an automatic background scheduler will start the work.
- Testing seams are proposed from the existing code and prior diagnosis without a new interview; the user has not separately confirmed them. No new public testing seam is prescribed.
- Diagnosis artifacts: [reproduction script](../handoff-model-diagnosis/repro.mjs), [failing model-retention assertion](../handoff-model-diagnosis/repro.log), and [control with current model equal to default](../handoff-model-diagnosis/control.log).
- Reproduction command: `TMPDIR=/project/tmp node --experimental-strip-types .scratch/handoff-model-diagnosis/repro.mjs`. At diagnosis it exited 1 because `configured-default` was used instead of `current-root`. The control with `PROBE_DEFAULT_ROOT=1` exited 0. These are fixture model names, not the user's actual model IDs.
- The repository and installed plugin had identical handoff dispatch function bodies when compared. They were not asserted to be identical packages. The reproduction imports the repository extension and installed Pi 0.87.1 replacement/resolver code; it sends no real model request.
- Implementation entry points at diagnosis: [handoff lifecycle](../../index.ts), [existing extension tests](../../index.test.mjs), and [host adapter](../../host.ts). These links are navigation aids, not a requirement to split the implementation across all three modules.
- Final acceptance requires the first-message regression to pass, unchanged existing handoff behavior, complete release checks, and lifecycle evidence adequate to distinguish applied runtime settings from metadata alone. Keep any unresolved host limitation explicit rather than treating a passing mock as completion.
- 2026-09-30: 状态由 ready-for-agent 改为 done（实现提交 75ac9ce，验收记录见上条）。
