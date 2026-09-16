# 02: P0-B — minimal WRC + RecoveryDecision + 恢复门 + floors 死码裁定

Status: ready-for-agent（2026-09-16；来源：../spec.md Revision 3 §4、§5、§8；12-PLAN §4）
Blocked by: 01-execution-termination（done，066685b + dd1713d）
Type: feature

**What to build：** P0-B 最小闭环——观测（UPDATE tokens + 墙钟）→ 越线 CANCEL → 12-A 停止确认链 → blocked + `task.recovery` → 结构化 RecoveryDecision → 同 Task 新 bounded execution。检测只发取消、不判定根因；恢复决策显式、可验证、不可重复消费。

## 现状（写票时核过）

1. `delegate.ts` `hooks.onUpdate` 现只做展示（`renderDelegationProgress`），UPDATE 的 `tokens`（快照）/`durationMs` 无人消费；无任何 abort 触发点除了调用方 signal。
2. `subagent-delegation-contract.ts:66-77` UPDATE 带 `tokens?`/`durationMs?`/`currentTool` 等——`tokens` 为宿主累计 input+output 快照（spec §4 口径），不求和，回退/缺失不重置已观测值。
3. `types.ts` `TaskRecord` 现有 `recoveryAttempts`（ticket-41 自动恢复计数，另一机制）与本票 `task.recovery` 不同义；P0-B 不复用该字段做决策门。
4. `index.ts` `planner_delegate` 无 `envelope`/`recovery` 参数；`planner_verdict` 无 `recovery` 参数。
5. `floors.ts`：session-root budget（evaluateSessionRootBudget 等）与 hostEnforcement 为活代码；delegation floor 机械（`DEFAULT_FLOORS`/`FLOOR_ENV_VARS`/`FloorConfig`/`loadFloorConfig`/`resolveEffectiveLimits`/`formatFloorLimitsSummary`）与 exploration-probe 机械（`ExplorationBudget*`/`createExplorationProbeFixture`/`explorationProbeDelta`/`ExplorationBudgetLedger`/`recordExplorationToolCall`/`isExplorationToolCall`/`emptyExplorationBudget`）在生产路径无执行——`resolveEffectiveLimits` 仅测试引用，`loadFloorConfig` 仅喂 session budget base。README:272「Per-delegation usageBudget floors … stay on」为不实陈述。
6. `task.ts:494-499` `TASKSPEC_FORBIDDEN_EXECUTION_CONTROLS` 已禁 `model`/`thinking`/`timeoutMs`/`toolBudget`/`usageBudget` 上 TaskSpec——envelope/recovery 走工具参数，不进 spec。

## 设计

### B1 envelope（显式配置，无默认线）

`planner_delegate` 新增可选参数 `envelope?: { maxTokens?: number; maxWallMs?: number }`。launch 前校验：至少一项、各项正有限数、整数化。来源记 `envelopeSource: "delegation-param"`。未配置 → 只观测不取消（UPDATE 仍累计展示）。

`TaskExecutionRecord` 增 `envelope?: { maxTokens?: number; maxWallMs?: number; source: "delegation-param" }` 与 `runawayObservation?: { signal: "tokens" | "wall"; observed: number; limit: number }`。

### B2 monitor（delegate.ts 内部）

- 建内部 AbortController 链接外部 `options.signal`（外部 abort 同样生效）；launcher 收内部 signal——monitor 越线即 `controller.abort()`，走既有 CANCEL→宽限→静滞链。
- UPDATE `tokens` 取 max（快照不回退）；`maxWallMs` 用独立 `setTimeout`（不依赖 UPDATE 心跳）。越线一次即触发（幂等），记 `runawayObservation`。
- runaway 触发的取消 `endedReason = "worker_runaway"`（覆盖 cancelled→operator_cancel 映射）；`stateReason` 写明观测/阈值。`DelegationTermination` 增 `anomaly?` 字段透出观测值/阈值/来源。

### B3 task.recovery

```ts
recovery?: {
	required: boolean;
	reason: string;
	executionId: string;      // 触发恢复的异常 execution
	nextAction?: string;      // abort 决策落地后写 "abort"
	consumedBy?: string;      // 消费该恢复的 executionId
}
```

- worker_runaway 收尾 → `required: true`, reason=观测事实, executionId=本轮。
- stop_unconfirmed → `required: true`, reason 明确「等待确认或人工处置」；hold 解除由 12-A 路径负责。
- `recoveryHistory?: RecoveryDecision[]` 存已消费决策（同 Task 多次异常的重复依据判重）。

### B4 恢复入口与门

`planner_delegate.recovery?: { executionId, action, reason, evidenceRefs?, worktreeDecision: "keep"|"manual" }`；`planner_verdict` 加同名可选参数（verdict `blocked` 时携带 action `abort`）。

- 门：`task.recovery.required` 时无 recovery 字段 → 拒绝；`executionId` 不匹配 → 拒绝；该 execution 已有 `consumedBy` → 拒绝；action ∉ P0 集（delegate: `retry_same_plan`/`fix_environment`；verdict: `abort`）→ 拒绝并说明缺 P1 能力（narrow_task/add_information/repair_protocol 依赖 ExecutionContract，change_model/change_tool_strategy 依赖 ExecutionControls）。
- 重复依据门：`{action, reason, evidenceRefs}` 与 recoveryHistory 中已消费决策全等 → 拒绝（原样措辞不同不算新依据按结构化字段比）。
- retry_same_plan：要求 reason 非空（具体依据由 Root 文本承载，P0 不做语义判）。
- 消费：delegate 路径 `recovery.consumedBy = 新 executionId`、`required=false`；verdict abort 路径 `nextAction="abort"`、`required=false`，Task 保持 blocked 交人工。
- admission 顺序：终态 TASK_CLOSED 检查前先查 `recovery.required`——blocked + required + 有效 recovery → 放行 transition executing；blocked + required + 无/无效 recovery → 拒绝（非 TASK_CLOSED 文案，说明需 recovery）。

### B5 floors.ts 裁定：删死码

删 delegation-floor 与 exploration-probe 死码（上文 §现状.5 清单）；`loadSessionRootBudgetConfig` 的 worker-initial base 改为就地读 `PI_PLANNER_ONLY_WORKER_TOKENS_HARD`/`_COST_USD_HARD` + 常量，语义不变。保留 session-root budget、hostEnforcement、index/orchestrate 的活引用。README:272 不实句改为指向 envelope；`floors.test.mjs` 删死码用例、`nx04-06.test.mjs` 删 C10 块（C15 read-ceiling 保留）。package.json files 保留 floors.ts（活代码仍在）。

### B6 nx-followups triage

- `02`（宿主探测 exploration budget）→ `wontfix`：探测机械随 B5 删除，议题对象消失。
- `03`（宿主验证矩阵回填）→ `wontfix`：其验收依赖的 acceptance.ts 已被 typed cutover 删除，矩阵框架不复存在。
- `01`/`05`：与 B5 无涉，保持 `ready-for-human` 原状。

## 测试

- 健康完成不触发 monitor；tokens 越线 / wall 越线各一（假 UPDATE/时钟）；越线一次后重复 UPDATE 不重复触发；未配置 envelope 不取消；非法 envelope launch 前拒。
- runaway → cancelled 终态 + 静滞确认 → `worker_runaway` + `recovery.required`；`details.termination.anomaly` 透出。
- recovery 门四种拒绝 + 有效 retry 产生新 execution 同 Task 累计 + `consumedBy` 落账 + verdict-abort 落 `nextAction="abort"`。
- 同 executionId 二次恢复拒、全等决策拒、P1 动作拒。
- floors 死码删除后 typecheck/test 全绿（session budget 用例保留）。

## 宿主轮（`../host-02/`）

probe 从 host-10/probe-template cp。极低 envelope（`maxTokens` 几千）派正常 P1 类 worker → 观测 UPDATE tokens 越线 → CANCEL → 确认 → blocked + recovery.required → 同 Task `planner_delegate` 带 recovery（retry_same_plan，放宽 envelope）→ completed → reviewer → git_commit。采集账本序列、toolcalls、usage 行数（每 execution 恰一行）。

## 验收

1. `npm run typecheck && npm test` exit 0；`git diff --check` 空。
2. parse-grep 规则同票 01（diff 新增行无 JSON.parse/.match/new RegExp/.split 例外项——`.match`/`split` 在既有工具函数复用除外，如实记录）。
3. 宿主证据落 `host-02/`：跑飞→WRC 取消→确认→恢复→完成全链；未配置 envelope 的对照轮只观测不取消。
4. nx-followups 02/03 标 wontfix；floors 死码删除且 session budget 行为不变。
