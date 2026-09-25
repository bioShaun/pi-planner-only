# 03: `planner_redelegate` 对不适用的 `recovery` 一致校验，不再静默放行

Status: done（2026-09-17 落地，选定拒绝语义，见 Comments）
Type: bug
Blocked by: 02（可与 02 并行开发，但落地文案须引用 02 定下的 abort 入口名）
来源：../spec.md §3；R2 §实际约束与校验次序.5、§时间线 S:119/121、§建议.5

**What to build：** `planner_redelegate` 收到 `recovery` 但 Task 不处于 `blocked + recovery.required` 时，不能像现在一样什么都不说就启动新 execution。要么拒绝并给可操作文案，要么剥离并在 `warnings` 披露；两条路径的选择要和 `planner_verdict`（票 02）的处理一致，使「同一个错误模板在一条路径被拒、在另一条成功」不再发生。

## 现状（写票时核过）

1. `delegate.ts:586–601`：只在 `isFinalTaskState(task.state)` 时看 recovery；`blocked && recovery.required` → `validateRecoveryDecision`，其他 final → `TASK_CLOSED`。**非 final Task**（executing/reviewing/changes_requested）上 `params.recovery` 完全不读，`recoveryDecision` 保持 undefined。
2. 真实事故 S:119/121：Root 在 changes_requested 的普通纠正 redelegate 上携带 `recovery{executionId: <child runId>, action:"abort"...}`，新 execution 正常启动。R2 判定这「不能用于证明 recovery 参数正确」，并且是模型持续在后续 verdict 上填 recovery 的强化因素之一。
3. `PLANNER_REDELEGATE_PARAMETERS`（`index.ts:953`）把 recovery 作为可选键——ADR-0002 §Why 的「optional key is an invitation」在这里同样成立，但 redelegate 上 recovery 是**有意义**的键（合法恢复入口），不能像 mint 路径那样直接删键，只能校验。
4. `validateRecoveryDecision` 在 `!required?.required && decision !== undefined` 时已有现成文案 `recovery is only admissible while the Task flags recovery.required`（`delegate.ts:154–158`），但 redelegate 的非 final 分支根本没调用它。

## 设计

### 推荐：拒绝（与 verdict 路径一致）

- 在 `delegate.ts:586` 之前/之内加：`params.recovery !== undefined && !(task.state === "blocked" && task.recovery?.required === true)` → `DelegationRefused("RECOVERY_NOT_APPLICABLE", ...)`，走既有 refusal 记账与 `withRefusalBreaker`。
- 文案可操作，回显 received：
  `planner_redelegate refused: Task T-x is <state> and does not flag recovery.required (received recovery.executionId=<v>, action=<v>). Omit recovery for a correction/review round. recovery is only for a blocked Task flagged recovery.required; executionId is details.executionId of the abnormal execution, not the child runId.`
- 理由：与票 02 之后的 verdict 语义对称（verdict 上没这个键；redelegate 上有键但错用即拒），refusal breaker 兜住重复。

### 备选：剥离 + warning（ADR-0002 mint 路径同款）

- 不拒绝，`warnings` 追加披露，execution 照常启动。优点不阻断纠正进度；缺点正是现状.2 的强化效应只是从「静默」变「带提示」，R2/ADR-0002 的证据表明模型对 warning 文字不敏感。若 triage 选此路，须在 Comments 写明接受该风险。

### 两条路径共同项

- executionId 与 runId 的区分写进 redelegate 的 `promptGuidelines`（`index.ts:948–952`）和该拒绝/warning 文案。
- 不改 final 分支（`590–600`）的现有语义与 `TASK_CLOSED` 文案。

## 测试

- executing / reviewing / changes_requested 三种非 final 状态 + 任意 `recovery` → 拒绝（或 warning），**未 launch**（fake launcher 计数为 0）、无新 execution 记录、Task 状态不变。
- changes_requested + `recovery.executionId` 用 child runId（复刻 S:119）→ 文案含「not the child runId」。
- blocked + required + 有效 recovery → 照常（现有 `delegate.test.mjs:1860–1999` 路由/去重/consume 保持绿）。
- blocked + required + 无 recovery → 现有 `RECOVERY_REQUIRED` 文案不变。
- breaker：byte-identical 重发 → Repeat notice。

## 验收

1. `npm run typecheck && npm test` exit 0；`git diff --check` 空。
2. 事故序列 fixture（票 04）里 S:119 那一步的调用形态在新代码下得到拒绝/warning，而不是静默启动。
3. 若选拒绝：refusal code 加入既有 code 列表/文档；README 双语同步。

## Comments

- 2026-09-17 定 triage：**拒绝**。理由即票内推荐论据——ADR-0002 的 taskId 剥离并未阻止模型重放错误模板，stray recovery 恰恰暴露调用方误判「有待决恢复」，静默剥离会让它以为恢复被消费；且剥离无法对称——verdict 侧剥离是因为 verdict 本身合法，redelegate 侧 recovery 存在即说明调用基于错误前提。拒绝走 `DelegationRefused` 家族即被 ticket-16 breaker 计数，不需额外记账面。
- 2026-09-17 落地。`delegate.ts`：绑定后、final 门后新增 `else if (params.recovery !== undefined)` → `RECOVERY_NOT_APPLICABLE`，回显 received executionId/action、Task 当前 state、「executionId 是 details.executionId 不是 child runId」、下一步（纠正/评审轮省略 recovery；放弃走 planner_abort）；终态 TASK_CLOSED 与 blocked+required 的 RECOVERY_REQUIRED 语义不变。测试：`delegate.test.mjs` 新块覆盖 executing/reviewing/changes_requested 三态（launcher 未跑、executions 未增、状态不变、runId 回显）；`index.test.mjs` 票 04 fixture (f) 翻转为拒绝+无 REQUEST+Repeat notice。文案：redelegate guidelines 增 executionId vs runId 行（`index.ts`）。验收 `npm run typecheck && npm test` 全绿。
- 2026-09-17 复审修复：README 双语补 `RECOVERY_NOT_APPLICABLE` 语义说明（验收 3 的「code 列表」在文档面不存在，code 仅活于代码与拒绝文案）；CONTEXT.md RecoveryDecision 词条顺带区分 evidence revalidation。
- 2026-09-17 审计跟进：发现 reviewer 的早返回先于非终态 stray-recovery 门，导致 reviewer 可绕过票 03。门已前移到角色分派之前，worker / explorer / validator / reviewer 在 `executing`、`reviewing`、`changes_requested` 上统一拒绝，并验证拒绝不 launch、不增加 execution、不改变 Task；省略 recovery 的 reviewer 仍按原路径运行。终态语义未扩大：reviewer 保留 `REVIEW_TERMINAL`，非 reviewer 保留 `TASK_CLOSED` 与 `blocked + recovery.required` 例外。本条是实现者跟进记录，独立 Validator/Reviewer 结论另记。
- 2026-09-17 最终实现验收 **PASS**：fresh Reviewer 未发现缺陷，相关代码/测试/文档 findings 已关闭；独立 typecheck、完整 `delegate.test.mjs`、diff check 均 exit 0，新增 index 最终块在 `/tmp/planner-index-followup-harness.mjs` 以原样代码和既有 fixture 定向运行 exit 0。完整 npm/index suite 的既有 nested spawn 空输出/`EPERM` 限制不属于本票修复；严格 readonly launcher 初始化失败，Reviewer 为行为只读 fallback。此结论只接受票 03 的有界代码实现，不替代票 02 仍 pending 的自然模型宿主验收。详见 `../evidence/final-review.md`。

- 2026-09-17 开票。R2 §建议.5 原话：「研究普通非 final Task 携多余 recovery 应拒绝还是明确 warning，避免『错误参数在某条路径成功』强化错误模板」。本票给出推荐但把决策留给 triage。
