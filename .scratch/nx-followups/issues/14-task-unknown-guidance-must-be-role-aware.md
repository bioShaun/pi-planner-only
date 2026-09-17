# 14: `TASK_UNKNOWN` 恢复指引必须区分 Reviewer，不能统一建议省略 `taskId`

Status: done

## 现象

票 13 建议把 `TASK_UNKNOWN` 文案统一改为：

```
unknown Task T-…; omit taskId to create a new Task, or pass an existing Task id
```

当前本地实现也已采用这一统一文案，并只用默认 `role=worker` 的用例断言。但 `TASK_UNKNOWN` 同样会由 `role=reviewer` 触发；对 Reviewer 而言，“省略 `taskId` 创建新 Task”不是合法恢复路径。

## 机制与证据

- `runDelegation` 先检查 `role === "reviewer" && !params.taskId`，缺少 ID 时直接拒绝 `TASK_REQUIRED`（`delegate.ts:491-494`）。
- Reviewer 只能评审已有 Task 的最新 WorkerReport，不能铸造新 Task；工具参数说明也明确写着 `taskId is required`（`delegate.ts` 的 `PLANNER_DELEGATE_PARAMETERS.role` 描述）。
- Reviewer 提供不存在的 ID 时会进入与其他角色共用的 `TASK_UNKNOWN` 分支（`delegate.ts:501-505`）。
- 因此若 Reviewer 按统一指引省略 `taskId` 重试，只会从 `TASK_UNKNOWN` 转成 `TASK_REQUIRED`，仍无法完成操作。拒绝文案表面“可操作”，实际推荐了契约禁止的动作。
- 当前 `delegate.test.mjs` 的 `TASK_UNKNOWN` 用例使用 `makeParams()` 默认的 `role=worker`，没有 Reviewer 反例，无法发现该问题。

## 要求

1. `TASK_UNKNOWN` 的恢复文案按角色区分：
   - `worker` / `explorer` / `validator`：可以提示省略 `taskId` 创建新 Task，或传入既有 Task ID。
   - `reviewer`：不得提示省略 `taskId`；应说明 Reviewer 只能绑定已有 Task，并要求使用前序 Worker 委派结果 `details.taskId` 中的 canonical ID。
2. `TASK_FOREIGN_WORKSPACE` 若包含“省略 `taskId` 创建新 Task”的建议，也必须应用同一角色区分；Reviewer 应改为从原 Task 所属 workspace 发起评审，或使用当前 workspace 中已有且可评审的 Task ID。
3. 新增独立测试覆盖：
   - 普通角色的 `TASK_UNKNOWN` 保留“可省略 ID 新建”恢复路径。
   - Reviewer 的 `TASK_UNKNOWN` 不包含该建议，且指向已有 canonical ID。
   - Reviewer 的 `TASK_FOREIGN_WORKSPACE` 不包含“省略 ID 新建”的建议。
   - 以上拒绝均不调用 launcher、不铸造 Task。

## 验收标准

- 每条拒绝文案只推荐该角色实际允许的下一步。
- Reviewer 按文案操作不会立即撞上 `TASK_REQUIRED`。
- `node --experimental-strip-types delegate.test.mjs` 通过。

## 关联

- 补充票 13：票 13 的根因与普通角色修复方向成立，本票只收紧 Reviewer 边界。

## Comments

- 2026-09-16（审核发现）：票 13 审核时核对 `runDelegation` 的 Reviewer 前置门与当前本地实现后确认。
- 2026-09-17（验收通过）：
  - HEAD: `de2cdbd0466070f6f8b6ea9350bf523b4696cdfd`
  - 验证命令及结果：
    - `node --experimental-strip-types delegate.test.mjs`（通过，所有用例通过）
    - `npm run typecheck`（通过，tsc --noEmit 无报错）
    - `git diff --check`（通过，无空白异常）
  - 核心实现与覆盖核验：
    - 拒绝逻辑实现（`delegate.ts:550-569`）：`TASK_UNKNOWN` 与 `TASK_FOREIGN_WORKSPACE` 均根据 `role === "reviewer"` 严格区分恢复指引。Reviewer 拒绝文案仅引导通过 `planner_tasks` 查询 canonical taskId 或在所属 workspace/当前 workspace 寻找既有可评审 Task，绝不向 Reviewer 推荐省略 taskId 或铸造新 Task，避免触发 `TASK_REQUIRED`。
    - 独立测试覆盖（`delegate.test.mjs`）：
      - 行 272-286：worker/explorer/validator 触发 `TASK_UNKNOWN` 保留新建路径，且 launches=0、未铸造 Task。
      - 行 288-308：普通角色 `TASK_FOREIGN_WORKSPACE` 反例。
      - 行 728-745：Reviewer `TASK_UNKNOWN` 反例，严格断言不包含 `omit taskId` 并明确指引 `planner_tasks` 查询 canonical taskId，launches=0、未铸造 Task。
      - 行 747-768：Reviewer `TASK_FOREIGN_WORKSPACE` 反例，严格断言不包含 `omit taskId` 并指引原 workspace cwd 或当前 workspace 已有可评审 Task，launches=0、未铸造 Task。
  - 结论：票 14 要求在当前架构下完整实现并具备独立测试覆盖，满足验收标准，关闭此票。
