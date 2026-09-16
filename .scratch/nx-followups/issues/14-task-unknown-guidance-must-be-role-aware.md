# 14: `TASK_UNKNOWN` 恢复指引必须区分 Reviewer，不能统一建议省略 `taskId`

Status: ready-for-agent

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
