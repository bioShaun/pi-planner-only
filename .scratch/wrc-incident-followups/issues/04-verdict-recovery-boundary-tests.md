# 04: 把 verdict/recovery 边界的事故序列 harness 固化进 `index.test.mjs`

Status: done（2026-09-17 落地，见 Comments）
Type: test
Blocked by: —
来源：../spec.md §4；R2 §最小复现与测试、§建议.4

**What to build：** 把 R2 的临时 harness `/tmp/opencode/planner-verdict-recovery-repro.mjs` 移植为 `index.test.mjs` 的正式用例，锁住**当前**行为作为基线，让票 02/03 有红→绿可对照。零生产代码改动。

## 现状（写票时核过）

1. 现有覆盖：`index.test.mjs:1212–1379`（blocked+abort 成功、missing recovery 拒绝、retry_same_plan 恢复）；`delegate.test.mjs:1860–1999`（错误 executionId、路由、action、去重、consume）。**没有**用例断言 `a recovery decision on planner_verdict requires verdict=blocked`。
2. R2 的关键教训：在**全新** runaway Task 上直接发 non-blocked verdict 到不了 `index.ts:1094–1099`——会先被 `orchestrate.ts:1925–1980` `rootVerdictRefusal` 的「无报告」门挡住（R2 首次尝试失败，按 `orchestrate.ts:1953–1957` 修 fixture 后才通过）。所以 fixture 必须复刻事故序列。
3. R2 harness 复用 `index.test.mjs:1–132` 的隔离宿主 fixture + `1218–1265` 的 token breach，调用真实注册工具 `execute`，state/ledger 隔离在临时目录；恢复 fixture 通过真实 `session_start` 加载。最终输出见 R2 §最小复现（两次精确拒绝 + Repeat notice + blocked+abort 消费 + 已消费后 blocked+recovery 落 `only admissible` + 无 recovery 的 blocked 成功）。
4. `/tmp/opencode/` 是临时目录，随时可能消失；本票是唯一把它变成仓库资产的机会。

## 设计

### fixture：事故序列

1. 派 worker，envelope 低线，fake UPDATE 越 tokens → `worker_runaway` → blocked + `recovery.required`（复用 1218–1265）。
2. `planner_redelegate` + `retry_same_plan`（executionId 匹配）→ requirement 消费，新 execution 返回带 WorkerReport 的正常终态。
3. 让 Task 进入 `changes_requested`（reviewer 或 fresh-review 路径，对齐 `orchestrate.ts:1953–1957` 的前置门）。

此时 Task：有报告、requirement 已消费、非 blocked。这是 S:116 的状态。

### 断言（当前行为基线；标注 02/03 落地后的预期变化）

| # | 调用 | 现在 | 02/03 后 |
|---|---|---|---|
| a | `request_changes` + 多余 `recovery{... reason:"not applicable"}` | 拒 `requires verdict=blocked`；无 verdict 落地；requirement 状态不变；ledger `verdictRefusals` **为空**（现状盲区，记录为已知） | 02：verdict 落地 + `warnings` 披露；拒绝记账 |
| b | 同 a 参数 byte-identical 重发 | 拒 + `Repeat notice`（breaker） | 02：不再拒 → 用例改到 `planner_abort` 上验 breaker |
| c | 同 a 但 `verdict:"blocked"` | 拒 `only admissible while ... recovery.required` | 02：`planner_verdict` 无 recovery 键 → 用例迁移到 `planner_abort` 无 requirement 拒绝 |
| d | `blocked`，不带 recovery | 成功，state=blocked | 不变 |
| e | 步骤 3 之前、requirement 仍 live 时 `blocked + abort`（executionId 匹配） | 成功，`required=false`、`nextAction="abort"` | 02：迁移到 `planner_abort` |
| f | 步骤 3 状态下 `planner_redelegate` 普通纠正 + `recovery{executionId:<child runId>}`（复刻 S:119） | **静默启动**新 execution（fake launcher 被调用一次） | 03：拒绝或 warning，未 launch |

每条断言旁用注释标 `// ticket 02/03 inverts this`，避免票 02/03 的实施者误以为是回归。

### 工程约束

- 沿用 `index.test.mjs` 现有 fixture 工具与命名，不引入新测试框架；不复制拒绝逻辑，只调真实 `execute`。
- 不触碰真实 `~/.pi` ledger；所有路径走临时目录。
- 用例 Task ID 由 allocator 自生成（harness 得到 `T-20260917-001`），断言不要硬编码生产 `...002`。

## 验收

1. `node --experimental-strip-types index.test.mjs` exit 0；`npm test` 全绿；`git diff --check` 空。
2. diff 仅含测试文件（及必要的 fixture helper）；`git diff --stat` 里无 `index.ts`/`delegate.ts`/`orchestrate.ts`。
3. a–f 六条断言齐全，b/c/e/f 带 02/03 翻转注释。
4. `/tmp/opencode/planner-verdict-recovery-repro.mjs` 若仍存在，移植后在本票 Comments 记录其 md5，供对照；不入库。

## Comments

- 2026-09-17 开票。R2 §最小复现原话：「不应把现有全绿当作错误组合已被测试」。本票先于 02/03 落地，使两票有可对照的红绿。
- 2026-09-17 落地。`index.test.mjs` 末尾新增 ticket-04 块（约 1693–1930 行）：单一事故 Task 走 runaway → `planner_redelegate`+`retry_same_plan` 真实消费 → 报告落账 → `request_changes` 进入 `changes_requested`（S:116 状态），断言 a–f 齐全；f 排在 d 前（d 会把 Task 打成 blocked，f 需要非 final 态）；e 用第二个 runaway Task（事故 Task 的 requirement 已被 retry 消费）。被翻转的断言均带 `ticket 02/03 inverts this` 注释。验收：`node --experimental-strip-types index.test.mjs` exit 0、`npm test` 全绿、`git diff --check` 空、diff 仅含测试文件。源 harness `/tmp/opencode/planner-verdict-recovery-repro.mjs` md5=`896fdd20adfd531155bec4086840c32d`（不入库）。与 harness 的差异：不直接改 ledger 再 `plannerOnly(pi)` 重载，全程走真实工具路径进入 `changes_requested`。
