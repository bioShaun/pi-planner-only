# 50: 两处拒绝文案措辞（跨 workspace 主诉不清、修复包角色标签误导）

**What to build:** 两处纯文案调整，不改任何判定、状态码或取值顺序。

1. **跨 workspace 拒绝应主诉 workspace 冲突，而不是「unknown Task」。** 现在 47 的拒绝以 `names unknown Task T-…` 起头、workspace 原因放在括号里（`orchestrate.ts` 的 `resolveValidatorReviewedTask` 组装 `referenceIds` 文案处，note 由 `restoreTaskOnDemand` 提供）。Task **是存在的**，只是不属于本 workspace —— 措辞应以此为主诉，例如 `validator target T-… belongs to workspace /public/scripts/tc-probe-design-v2; this delegation runs in /public/pi/pi-planner-only, and cross-workspace binding is refused`。`unknown Task` 只适用于**确实查不到**的 id。
2. **修复包对被点名 Task 的角色标签应说明来源。** 对**已入库** Task 的 validator 拒绝，修复包显示 `role: kept the submitted role "worker"`（因为这里的「submitted」就是被点名 Task 自己那份 worker spec）。读者容易误以为该重报一份 worker spec。应改为说明来源（如 `kept the reviewed Task's role "worker"`）或在被点名场景下省略 role 行。

**Background / 证据：**

- 现场逐字（2026-09-14，工单 47 宿主复跑，构建 `59d9ee3`）：
  - 跨 workspace：`Planner-only guard: validator delegation names unknown Task T-20260911-001 (its ledger record belongs to workspace /public/scripts/tc-probe-design-v2 and this delegation runs in /public/pi/pi-planner-only; cross-workspace binding is refused); no Validator run is started against a substitute Task.`
  - 修复包：`- role: kept the submitted role "worker"`（该次委派目标是 oracle）。
- 两处均由 operator 在复核中标出（47 的 cosmetic 点 + 45 的修复包 nit），并共同决定合并为一张文案票。
- **须在 45/47 翻 `verified` 之后再做**（现已满足）：改文案会让已记录的探针证据与加载构建脱钩，必须先完成验证记录。

**Acceptance:**

- 跨 workspace 的拒绝文案以 workspace 归属为主诉；确实查不到的 id 才用 `unknown Task`。
- 对被点名 Task 的修复包不再显示会被误读为「请重报 worker spec」的角色行。
- 同步更新受影响的断言：`orchestrate.test.mjs` 的跨 workspace 用例（现断言 `/belongs to workspace/`）、45 的 stored-task 用例（现断言修复包片段）。
- 判定、状态码、拒绝时机（仍在写锁之前、零副作用）逐字不变。
- `npm run typecheck` 与 `npm test` 绿。

**Blocked by:** 无（45/47 均已 `verified`）。**优先级**：不阻塞任何票。

**Status:** ready-for-agent

## Comments

2026-09-14 立案（operator 复核意见合并：47 的跨 workspace 文案 lead 顺序 + 45 的修复包角色标签 nit）。纯文案，安排在 45/47 验证记录落定之后，以免证据与构建脱钩。
