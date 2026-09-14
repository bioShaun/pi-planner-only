# 51: 确定 workspace 绑定契约（工单 46 §3 的承接票）

**这一票的第一步是「决定契约」，不是写代码。** 契约未定之前不得迁移 fixture。

**What to build:** 先把「一个委派可以绑定到哪个 workspace 的 Task」写成契约，再据契约实现并迁移套件 fixture 约定。

1. **先回答契约问题（逐条给出结论与理由）：**
   - 判据用**路径相等**（`normalizeWorkspaceIdentity`，与 `continueTask()` 一致）还是**仓库根相等**（同 repo 的子目录算同 workspace，跨 repo 才算跨）？
   - 约束哪些角色？只约束会真的在 cwd 里跑 shell / 取证的**写入类**（worker / validator），还是所有角色？
   - 与 `continueTask()` 的 `TASK_WORKSPACE_MISMATCH` 是否共用同一判据？两处语义必须一致，否则又是一套判据分叉。
   - `additionalWorktreeRoots` 与多 worktree 场景怎么算？（工单 45/47 的 host probe 都是在会话 cwd 内，未触及这条。）
   - `cwd === ""` 的记录（无 workspace 的历史快照）如何处置？
   - 「点名解析到别的 workspace」与「不点名时的 active 兜底」是否同一规则？
2. **契约落地后**：委派路径按契约校验（不只是账本采纳进来的记录 —— 这正是 46 留下的缺口）；拒绝要结构化且可行动，文案主诉 workspace（与工单 50 的措辞一致）。
3. **迁移套件 fixture 约定**并补验证。迁移前先重新枚举一次爆散面（把拒绝临时改为打印、跑完整套件），不要凭旧数据动手。

**Background / 证据：**

- **46 的已知缺口**：46 只完成「歧义拒绝 + alias 碰撞拒绝 + 账本感知预检」，委派的 workspace 校验沿用工单 47 的**按需采纳边界**（只对从账本采纳进来的记录校验）。**in-memory 已加载 Task 的跨 workspace 绑定依然存在**，46 不得被描述为完成了全面的 workspace 隔离。见 [工单 46](46-no-workspace-isolation-in-task-lookup-and-alias-registration.md) §3 的修订段。
- **成本实测（枚举法）**：把 46 的严格相等拒绝临时改成 `console.error` 后跑完整套件，得到约 100 条 distinct 命中，形态为 `taskCwd=/fixture/<id>` × `delegCwd=/repo`（orchestrate.test.mjs，约 70+）与 × `delegCwd=/public/pi/pi-planner-only`（index.test.mjs，约 22），另有 4 处临时目录 cwd、2 处 `/repo/v-acct-*`。这是套件的**基础 fixture 约定**（Task 建在 `/fixture/<id>`、委派从 Root 的 workspace 发出）。
- **这份数据只能证明成本**：它推翻了「只有两处 fixture 需调整」的估算，**并不能证明** in-memory 跨 workspace 绑定是正确语义。契约必须先独立确定。
- 关联：工单 46（查找与 alias 隔离）、工单 47（按需采纳边界）、工单 50（拒绝文案）。

**Acceptance:**

- 上面 6 个契约问题**逐条有成文结论**（写在本票 Comments，或落进 `CONTEXT.md` / `docs/adr/`，并在此链接）。
- 实现与本票契约一致；与 `continueTask()` 无判据分叉。
- 套件 fixture 约定按契约迁移完毕，`npm run typecheck` 与 `npm test` 绿；迁移后**重新枚举**并记录剩余的「允许」与「拒绝」两侧用例。
- 验证覆盖**两侧**：跨 workspace 被拒，且**同契约内允许的绑定仍然放行**（只测拒绝一侧不算完成）。
- 工单 50 对措辞的要求在本票覆盖的路径上同样满足。
- **不得**把「alias 路径已有 workspace 文案」当作其他委派路径已满足的证据 —— 那是既有覆盖，不能外推。

**Blocked by:** 无。**优先级**：不阻塞 48 / 49 / 50 的实施；排在它们之后。

**Status:** needs-triage（第一步需要维护者定契约，不是可直接派活的实现任务）

## Comments

2026-09-14 立案（operator 决定：46 的 A 方案不并入本票，单独承接；46 提交不受影响）。立案时已知的事实边界：严格相等等价于重写套件的基础 fixture 约定；in-memory 跨 workspace 绑定是 46 明确留下的缺口。
