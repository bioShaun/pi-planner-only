# 04: Worker 与 Validator 默认 fresh，状态里显示实际 model:thinking

**What to build:** Root 委派 Worker 或 Validator 时，插件默认把上下文设为 fresh，并传入有界执行包：TaskSpec、适用仓库规则与领域约束、必要文件线索、验收要求、可定位 Evidence。不复制 Root 历史。settings 里为这些角色配置的 thinking 因此真正生效。显式请求复用同一 Task 的修正上下文仍然允许，但受 Task 身份与范围限制；跨 Task、身份失效或误请求 Root 历史时回到 fresh 并解释原因。`/planner-only status` 与 Usage 记录显示每次委派宿主实际使用的 model 与 thinking。Reviewer 已有的 fresh 隔离保持不变。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] Root 历史中放入与 Task 无关的标记后委派 Worker：Worker 收到的执行包含 TaskSpec 与仓库约束，不含该标记；Validator 同理。
- [x] settings 为 worker 配置 thinking high、oracle 配置 medium：宿主 meta 中实际值与之一致（通过真实 pi-subagents 公开入口或受控本地提供方验证，不以插件写入字段为证）。
- [x] 同 Task 显式复用修正上下文：保留上一轮执行的必要上下文；跨 Task 或身份失效时回到 fresh 并在结果中说明。
- [x] status 输出每次委派的角色、实际 model 与 thinking；Usage 记录保留同样字段。
- [x] Reviewer 行为与改动前一致。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（问题 6，User Stories 8、18–20，阶段 A 决策第 5 条）。证据：analysis P6（fork 上下文 6/6 落到 off，fresh 2/2 拿到 override）。

2026-09-08（planner claude-pD）：逐条核对既有实现与测试后勾 1、3、4、5，**第 2 条留空**。证据：

- 第 1 条 —— `roles.test.mjs:586-612`：往 Root 任务文本里塞 `UNRELATED_ROOT_CONVERSATION_HISTORY_MARKER_xyz987`，`prepareRoleDelegation` 后 worker 与 oracle 两个 payload 的 `context` 都被强制成 `fresh`，标记被剥掉，`[PLANNER-ONLY WORKER CONTRACT]` / `[PLANNER-ONLY ORACLE]` 与 TaskSpec 的 `taskId` 都在包里。
- 第 3 条 —— `roles.test.mjs:615-681` 四个分支：同 Task 复用注入 `[PLANNER-ONLY REUSED TASK CONTEXT]` 且带上一轮 `changedFiles`；跨 Task 拒绝，reason `does not match canonical task`；请求 Root 历史拒绝，reason `Root history cannot be reused`；无法验证前一轮执行时拒绝，reason `cannot verify previous execution context`。四种拒绝后 `context` 均回落 `fresh`。「在结果中说明」由 `orchestrate.test.mjs:4459-4477` 覆盖：worker 结果文本含 `Note: context reuse fell back to fresh`，且 `reuseTaskId`/`__reuseOutcome`/`__contextOverridden` 在交给宿主前全部剥离。
- 第 4 条 —— status 侧 `orchestrate.test.mjs:4438-4456` 与 `index.test.mjs:2979-3022`（后者走真实 `tool_call`/`tool_result` 事件链，从 details 里的 `model: "kimi-for-coding:high"` / `thinking: "high"` 一路渲染出 `worker: kimi-for-coding:high (thinking: high)`；未上报时渲染 `unknown (thinking: unknown)`，不编默认值）。Usage 侧用真实产物核对：`phase-a-08-run4/artifacts/usage.jsonl` 的 children 实际带 `(kind, model, thinking)` = `(reviewer, kimi-coding/kimi-for-coding:high, high)`、`(validator, …:medium, medium)`、`(worker, …:high, high)`。**注意**其中一条 `(worker, kimi-coding/kimi-for-coding, None)`：宿主那次没报 thinking、model 也没带后缀，字段就缺席而不是补个假值 —— 与 status 侧 `unknown` 的处理一致，属预期。
- 第 5 条 —— `roles.test.mjs:684-700`：reviewer payload 的 `agent` 不变、`context` 仍是 `fresh`、仍走 `[PLANNER-ONLY FRESH REVIEW]`，与改动前一致。

第 2 条不勾的原因与工单 05 的 1–2 条相同：它明写「通过真实 pi-subagents 公开入口或受控本地提供方验证，**不以插件写入字段为证**」。`e2e.pi-subagents.test.mjs` 的相关分节因 `~/.pi/agent/npm/node_modules/` 里没有 `@earendil-works/pi-tui` 而 skip，宿主实际收到的 thinking 值目前无法验证。这是宿主环境缺口，不是实现缺口，另开工单跟踪。

2026-09-08（planner claude-pD）：**第 2 条勾上，本票五条齐。** 阻塞它的从来不是实现，是宿主 `@earendil-works/pi-tui` 缺失导致 `e2e.pi-subagents.test.mjs` 的 §E 段落一直跳过（详见工单 25）。把 pi-tui 0.85.1 装进 `~/.pi/agent/npm/node_modules/@earendil-works/` 后，§E 用**真实 pi-subagents 公开入口** `resolveSubagentLaunchContract` 跑了两个契约：worker 传 `thinking: "high"`、oracle 传 `thinking: "medium"`，断言 `contract.ok === true`、`contract.model` 匹配、`contract.thinking` 与传入值**逐一相等**（`e2e.pi-subagents.test.mjs:258-286`）。这正是本条要的「不以插件写入字段为证」。复测 `npm run test:e2e` 输出里 §E 的「未验证」行已消失，只剩 §F。

round_id=claude-pD-2026-09-08-close-04-2
