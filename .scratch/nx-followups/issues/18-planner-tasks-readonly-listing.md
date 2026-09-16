# 18: 只读 `planner_tasks`（live-only v1）—— 给 Root 一条"查"而不是"猜" taskId 的路

Status: done（2026-09-16；live-only v1：orchestrate.listLiveTasks 内存∪账本双源 + index.ts planner_tasks 注册；TASK_UNKNOWN/TASK_FOREIGN_WORKSPACE 指引改指 planner_tasks）
Blocked by: 17

## 问题

票 13 §改进方向 2 指出：Root 工具面没有任何列出现存 Task 的入口。taskId 一旦丢失或记错，Root 无自查手段，只剩造一个幻觉 ID。票 17 把创建路径上的幻觉 ID 变成无害，但修正轮 / 评审 / 恢复（`planner_redelegate`）仍要求 Root 手里有正确的 canonical id；对话被压缩或 session 恢复后这个 id 可能不在上下文里。

## 决策（维护者，2026-09-16）

采纳**工具方案**，v1 只做 **live-only**：

- 不采纳"把 live 清单塞进 `TASK_UNKNOWN` 拒绝 `details`"——依赖"先失败才能发现正确 ID"的交互，且 throw 路径上 `details` 能否透传给模型未核实。
- 暂缓 `state: "all"` 与历史检索：超出"找回仍需操作的 Task"这一核心需求。
- 工具面加一个入口，但查询契约清楚。

## 关键前提：restore cap 会漏 live Task

`restoreFromLedger`（`orchestrate.ts:484-513`）的规则是：`needsWriterIsolation` 的记录全部恢复，其余按 `updatedAt` 倒序取最新 `MAX_LEDGER_RESTORE_PER_SESSION = 64` 条（`types.ts:58`），**不按状态筛选**。一个 `blocked` / `changes_requested` / `planning` 的 Task 只要后面有 64 条更新的终态记录，就不在 `store.list()` 里。因此 **v1 的数据源不能只是内存 store**（见 R2）。

## 要求

### R1. 工具注册（`index.ts`）

- 名称 `planner_tasks`，参数 `Type.Object({})`（v1 无参数；预留对象形状便于将来加 `state`）。
- 只读：不铸造 Task、不调用 launcher、不写 store、不写 ledger。
- description：`List live (non-final) Tasks of the current workspace with their canonical taskId. Call this whenever you need a taskId for planner_redelegate or planner_verdict and do not have it verbatim from a prior result. Never construct a taskId.`

### R2. 数据源：内存 ∪ 账本非终态记录，按 workspace 过滤

- 内存：`orchestrator.store.list()` 过滤 `!isFinalTaskState(state)` 且 `normalizeWorkspaceIdentity(task.cwd) === normalizeWorkspaceIdentity(ctx.cwd)`。
- 账本：`snapshots.readAll()`（或抽一个 `orchestrator.listLiveTasks(cwd)` 方法封装，避免 `index.ts` 直接碰 snapshots）过滤同样条件；**必须**过 workspace 校验——票 47 的规则：按需读取的记录绝不成为跨 workspace 入口（`orchestrate.ts:533-535` 注释）。`cwd` 为空的记录不列。
- 合并：同 `taskId` 以内存记录为准（内存更新）。`quarantine` / untrusted placeholder（`orchestrate.ts:516-519`）不列，或单独标 `untrusted`——实现者定并锁定。
- 不把账本记录 `restore` 进 store：列出只是列出，绑定时由票 47 的 `restoreTaskOnDemand` 按 id 捞回，两条路径语义一致。

### R3. 返回形状

`details.tasks: Array<{ taskId, state, role, objective, updatedAt, recoveryRequired, source }>`

- `objective`：`spec.objective` 首行截断 120 字。
- `recoveryRequired`：`state === "blocked" && recovery?.required === true`。Root 据此决定是普通 `planner_redelegate` 还是必须携 `recovery` 决策，避免撞 recovery gate 再来一轮拒绝。
- `source`：`"memory" | "ledger"`，让人类能看出 restore cap 漏了什么。
- 按 `updatedAt` 倒序。
- 文本部分渲染紧凑表，每行 `T-… | state | role | recovery? | objective`；空列表时明确写 `No live Tasks in <cwd>. planner_delegate mints a new one.`

### R4. 策略与 hook

- `policy.ts`：`IDLE_TOOLS`（`:26`）与 `ROOT_TOOLS`（`:33`）加入 `planner_tasks`——Idle 与 live 相位都允许。
- `tool_call` hook（`index.ts:1050` 附近）：加入 Root 工具名列表以便 toolCallId 归因；无 `taskId` 参数，不进 `rootTurnTaskIds`。
- 不进 `REVIEW_LEAK_TOOLS`（读的是 store，不是仓库内容）。

### R5. 拒绝文案与 Prompt 联动

- `planner_redelegate` 的 `TASK_UNKNOWN` 指引（票 13/14 落地版，`delegate.ts:506-508`）改为指向工具，**不**内嵌清单：
  - 普通角色：`unknown Task T-…; call planner_tasks to list live Tasks, or use planner_delegate to create a new one`
  - reviewer：`unknown Task T-…; role=reviewer can only bind an existing Task — call planner_tasks to find its canonical taskId`
  - `TASK_FOREIGN_WORKSPACE` 同理加 `call planner_tasks from that workspace's cwd`。
  - `delegate.test.mjs:248-286`、`660-710` 的逐字断言同步更新。
- `PLANNER_PROMPT`（票 17 改写后的段落）追加：`If you need a taskId and do not have it verbatim, call planner_tasks. Never construct one.`
- README ×2、CONTEXT.md 的 Root 工具清单加入 `planner_tasks`。

## 验收标准

- `index.test.mjs`（或可触达 registered tool 的 harness）：
  - 内存 2 个 live + 1 个 completed → 只列 2 个，`source: "memory"`。
  - 账本中一条 `blocked` + `recovery.required: true`、`updatedAt` 早于 64 条终态记录、未被 `restoreFromLedger` 恢复 → 仍被列出，`source: "ledger"`，`recoveryRequired: true`；调用后 `store.get(该 id)` 仍为 `undefined`（未副作用恢复）。
  - 另一 workspace 的 live Task 不列。
  - 空结果文案含 `No live Tasks`。
  - 调用前后 launcher 0 次、`store.list().length` 不变、ledger 目录 mtime 不变。
- `policy.test.mjs`：`planner_tasks` 在 Idle 与 live 相位均不被 block；`ROOT_TOOLS.has("planner_tasks")`。
- `delegate.test.mjs`：`TASK_UNKNOWN` / `TASK_FOREIGN_WORKSPACE` 新文案逐字断言，reviewer 版不含 `planner_delegate`。
- 全部 `*.test.mjs` 与 `npx tsc --noEmit` 绿。

## 非目标

- 不做 `state: "all"`、不做历史检索、不做按 id 查单条（那是 `planner_redelegate` 的事）。
- 不改 `restoreFromLedger` 的 cap 规则（见后续候选）。
- 不列其他 workspace 的 Task。

## 后续候选（不在本票）

- **改 `restoreFromLedger`：非终态记录与 isolated 记录一样无条件恢复。** 更根本，但会改变 `activeForCwd` / gather 相位判定的输入，需单独开票评估。若落地，R2 的账本读取可退化为纯内存。

## 关联

- 票 13 方向 2 的正式立项。
- 依赖票 17：`planner_redelegate` 命名与 `TASK_UNKNOWN` 文案归属。
- 票 47（`planner-only-cost-control`）：workspace 校验规则与 `restoreTaskOnDemand` 是 R2 的对偶。
- 票 16：本工具无 refusal 路径，熔断不涉及。

## Comments

- 2026-09-16（开票）：从票 13 §方向 2 拆出独立立项；相对票 16/17 为可选项。
- 2026-09-16（裁定）：维护者裁定采纳工具方案、live-only v1，Status 改为 ready-for-agent。核对 `orchestrate.ts:484-513` 确认 restore cap 不按状态筛选，live Task 可能不在内存，故 R2 要求内存 ∪ 账本双源；`recoveryRequired` 字段为裁定后补充。
- 2026-09-16（落地）：两处实现者裁量。
  1. "live" 语义收窄为**可操作**：`blocked` 属终态（FINAL_TASK_STATES），但验收用例要求 blocked+recovery.required 的记录被列出——这类 Task 仍可经 `planner_redelegate`+recovery 重进。实现把"live"定为 `!isFinalTaskState || (blocked && recovery.required)`；裸 blocked（无 pending recovery）不列，与 TASK_CLOSED 的死态语义一致。
  2. quarantine/untrusted 占位（`untrustedPlaceholder`，cwd 为空）按 R2 "cwd 为空不列" 自然排除，不另标 `untrusted`。
  - 其余按票执行：`details.tasks` 含 `source` 区分 restore-cap 漏项；文本空结果为 `No live Tasks in <cwd>. planner_delegate mints a new one.`；`planner_tasks` 进 `tool_call` 归因列表但不进 `rootTurnTaskIds`（无 taskId）；不进 breaker（无 refusal 路径）；PLANNER_PROMPT 并入 taskId 行保持 ≤1800B（实测 1789）。
