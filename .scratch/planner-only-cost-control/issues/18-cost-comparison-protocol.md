# 18: 费用对照记录规范与汇总逻辑

**What to build:** 定义并实现可复现的费用对照记录：同一初始仓库状态、Task 目标、验收要求、模型与配置、定价来源和时间、缓存条件、所有调用费用、完成状态、返工次数与耗时。提供从 Usage 生成单次运行记录的命令，以及跨多次运行汇总通过率、成功完成成本、总支出、返工次数与耗时的逻辑，失败运行及其成本纳入统计。汇总逻辑用确定性数据验证；不预设节省百分比。

**Blocked by:** 10、13。

**Status:** ready-for-agent

- [ ] 一次运行结束后可生成含全部规定字段的记录文件。
- [ ] 给定一组确定性记录（含失败与返工），汇总输出通过率、成功完成成本、总支出、平均返工、平均耗时。
- [ ] 缺少费率或用量的记录在汇总中标记为不可比，不按零计入。
- [ ] 记录规范写入 docs，说明隔离基线与模型分工方案各自的运行方式。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 40–41，阶段 E 决策第 2 条）。2026-09-07 探测不是合格样本。

### Planner 原型核验（2026-09-09，p18-r080，派活前）

原型补丁存 `.scratch/planner-only-cost-control/p18-probe/r080-prototype.patch`（**参考实现，不是成品**：
它没有任何断言、没有 docs、`summary` 的渲染是裸 JSON）。实跑结论：

1. **四条 checkbox 的字段全部可从现有数据取到**，不需要新的采集：
   `objective` / `acceptanceCriteria` ← `TaskRecord.spec`；`state` / `reviewRound` ← `TaskRecord`；
   耗时 ← `updatedAt − createdAt`；模型与配置 ← `TaskUsage.rootModel` + `children[].{kind,agent,model,thinking}`；
   缓存条件 ← `cacheRead`/`cacheWrite` 计数（**度量值，不是声明值**）；
   定价来源 ← `pricingPath()` + `PricingTable.version/currency` + 读取时刻；
   初始仓库状态 ← `TaskRecord.baseEvidence.{baseGitRef,finalGitRef,gitStatusHash}`。
2. **`usage.ts` 不许 import `task.ts`**：`task.ts:33` 已经 import 了 `usage.ts`（`emptyTaskUsage`），
   反向边就是循环。所以 `buildRunRecord` 只收结构化入参（`RunRecordTaskFacts`），不收 `TaskRecord`。
   同理 `architecture.test.mjs:72-75` 钉死 usage.ts 不得 import `index.ts` / `@earendil-works`，
   **写文件的动作必须留在 `index.ts`**，usage.ts 只做纯计算。
3. **原型实跑暴露一个缺陷（必须在实现里修掉）**：夹具 Task 没有 `baseEvidence` 时，
   记录里 `baseGitRef` 直接缺席，而 `comparable` 仍为 `true`——一条认不出起始仓库状态的记录
   被当成可比样本。加上「缺基线 git ref ⇒ 不可比」后实测 `comparable:false`、
   汇总里 `totalSpendUsd` 从 0.17 掉到 0、该记录进 `incomparableReasons` 计数。
4. **`costPerSuccessUsd` 在没有可比成功样本时是 `undefined`，JSON 里整个键缺席**。
   缺席 ≠ 0，渲染必须显式说「无可比成功样本」，不许打印 $0.00。
5. **浮点噪声真实存在**：实测 `totalUsd = 0.16999999999999998`、`0.12000000000000001`。
   断言一律用容差，禁止 `=== 0.17`（p16-r077 同款坑）。
6. 全量套件对原型实跑：`npm test` 走到 `planner-only architecture: PASS`，唯一 AssertionError 是
   `naming.test.mjs`（预期）；`PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` = 0；
   `npm run typecheck` = 0；`git diff --check` = 0。**新增子命令与新增导出没有打红任何既有断言。**
7. 记录文件落在 `AGENT_DIR/planner-only/runs/`，实测在 `PI_CODING_AGENT_DIR` 隔离夹具下正确改道。
