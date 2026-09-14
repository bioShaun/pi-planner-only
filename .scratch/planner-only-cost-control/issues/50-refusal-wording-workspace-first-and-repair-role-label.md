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

**实现记录（2026-09-14，本机）：**

- **跨 workspace 主诉（第 1 条）**：`restoreTaskOnDemand()` 的 note 改写为独立可拼句 —— `belongs to workspace <X>, while this delegation runs in <Y>; cross-workspace binding is refused`（去掉原「its ledger record」开头，否则拼上 `Task <id> ${note}` 后读不顺）。`resolveValidatorReviewedTask()` 的单 id 未命中分支改为：**有 note 就以 `Task <id> <note>` 为主诉**，否则才用 `names unknown Task`。读取失败的 note 同步改为 `could not be read from the ledger`。
- **修复包角色标签（第 2 条）**：`TaskSpecExampleInput` 新增 `roleOrigin`；`validatorValidationRefusal` 在 **storedTaskId 存在**（即「submitted」其实是被点名 Task 自己的 spec）时传 `"reviewed-task"`，修复包角色行显示 `kept the reviewed Task's role "worker"`，不再被读成「请重报 worker spec」。
- **歧义 note 首字母大写**（`Resolves to …`），使 `planner_verdict: unknown task X. ${note}` 的组合可读 —— 属 49 引入的 note 顺手修正。

**测试**：既有断言全部保持 —— 46 的跨 workspace alias 用例仍断言 `/belongs to workspace/`；45 的 stored-task 用例新增 `/kept the reviewed Task's role "worker"/`。**未新增**「validator 引用别 workspace 的 in-memory Task 应被拒」的用例：那是工单 51 明确留白的 in-memory 缺口，不得在 51 定契约前把现状写成预期（operator 亦明示不得外推）。

**门禁**：`npm run typecheck` exit 0；`npm test` exit 0（35 个测试文件无失败）。日志 `.scratch/planner-only-cost-control/p50-impl/`。

**Status:** done（2026-09-14 本机落地、门禁绿。纯文案：判定、状态码与拒绝时机逐字不变。**未做宿主复跑** —— 与 46/48/49 同在 `fix/tickets-46-48-49-50` 分支上。）

## Comments

2026-09-14 立案（operator 复核意见合并：47 的跨 workspace 文案 lead 顺序 + 45 的修复包角色标签 nit）。纯文案，安排在 45/47 验证记录落定之后，以免证据与构建脱钩。
