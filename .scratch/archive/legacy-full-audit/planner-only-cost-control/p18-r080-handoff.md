[轮次] round_id=PENDING

# 工单 18：费用对照记录规范与汇总逻辑（pi-planner-only）

**回信地址：herdr pane `w2E:pD`（planner，claude）。做完把报告发回这个 pane，不要只写在你自己窗口里。**
**工作目录：`/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`，基线 HEAD `7e77f6c`。**

这份工单自足。你不继承我的上下文，也不要去读 `spec.md`。要读的只有
`.scratch/planner-only-cost-control/issues/18-cost-comparison-protocol.md`（含我 2026-09-09 的原型核验记录）。

---

## 0. 环境硬规则（逐字遵守，跟本任务同等重要）

- **`/tmp` 及其任何子目录，一律禁止放中间文件、临时目录、缓存、构建产物、任务产物。**
  任务内的中间文件放当前工作目录下明确命名的可丢弃子目录；需要放到 cwd 之外时用 `/project/tmp`。
- 预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，**一律用 `slot` 提交**
  （`slot cpu -- <命令>`）。本仓的 `npm test` 实测 4 秒，可以直接跑。
- **起重任务前必须先跑 `slot audit` 和 `slot status`，并把输出写进
  `.scratch/planner-only-cost-control/p18-r080-slot-{audit,status}.log`。**
  `slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；应等待、降低并发或报告冲突。
  禁止先启动重活、事后补查。不要用 `slot slots` 调大槽位给自己插队。
- `.agent-dir/models.json` 和 `.agent-dir/auth.json` 含 provider API key：**永远不读、不回显进报告、不提交**。
- **本工作目录有四个 agent 同时在跑。** 不要批量删除 `.planner-only-test-*` 之类的散落目录——
  那可能是别的 agent 正在跑的测试沙箱。要清理就 `mv` 到 `.scratch/planner-only-cost-control/quarantine/`。
- **不要 `git commit`**，不要动 `spec.md`，不要勾任何 checkbox，不要改 `.scratch/**` 下除日志外的文件。

## 1. 你要做什么

给 pi-planner-only 加「费用对照运行记录」：一次运行结束后能落一份含全部规定字段的记录文件，
以及一段能把多份记录汇总成通过率 / 成功完成成本 / 总支出 / 平均返工 / 平均耗时的纯逻辑。

**参考实现在 `.scratch/planner-only-cost-control/p18-probe/r080-prototype.patch`。**
那是我实跑验证过的原型，**不是成品**：它没有任何断言、没有文档、`summary` 只打印裸 JSON，
而且有一处已知缺陷（见 §3 第 3 条）。你可以照抄它的结构和命名，但必须补齐下面每一条。

## 2. fence（只许改这些文件）

```
usage.ts
types.ts                      （只在确实需要新类型时改）
index.ts
usage.test.mjs
index.test.mjs
architecture.test.mjs
docs/pi-planner-only-cost-comparison-protocol.md   （新建）
.scratch/planner-only-cost-control/p18-r080-*.log  （你的日志）
```

其余一切只读，**包括 `.scratch/planner-only-cost-control/p18-probe/` 下的原型补丁和探针**（不许改）。
不要动 `package.json`（本轮不新增 `.ts` 文件，`files` 列表无需变更）。

## 3. 四条验收条款 → 具体要求

### 条款 1：一次运行结束后可生成含全部规定字段的记录文件

新增子命令 `/planner-only usage record [<taskId>] [--arm <name>]`，把记录写成 JSON 落到
`AGENT_DIR/planner-only/runs/<runId>.json`（实测在 `PI_CODING_AGENT_DIR` 隔离夹具下会正确改道）。

记录必须含**全部**这些字段，取值来源已核验可得：

| 规定字段 | 来源 |
|---|---|
| 同一初始仓库状态 | `TaskRecord.baseEvidence.{baseGitRef, finalGitRef, gitStatusHash}` |
| Task 目标 | `TaskRecord.spec.objective` |
| 验收要求 | `TaskRecord.spec.acceptanceCriteria` |
| 模型与配置 | `TaskUsage.rootModel` + `children[].{kind, agent, model, thinking}` |
| 定价来源和时间 | `pricingPath()` + `PricingTable.version/currency` + 读取时刻 |
| 缓存条件 | `cacheRead` / `cacheWrite` 计数（**度量值，不是声明值**） |
| 所有调用费用 | `root.costUsd` + `children[].costUsd`，另计 `costDebtUsd` |
| 完成状态 | `TaskRecord.state` |
| 返工次数 | `TaskRecord.reviewRound` |
| 耗时 | `updatedAt − createdAt` |

**架构约束（`architecture.test.mjs:72-75` 已钉死，别踩）：**
`usage.ts` 不得 import `index.ts` 或 `@earendil-works`；**另外它也不得 import `task.ts`**——
`task.ts:33` 已经 import 了 `usage.ts`，反向边是循环。所以 `buildRunRecord` 收结构化入参
（原型里的 `RunRecordTaskFacts`），不收 `TaskRecord`；**写文件的动作留在 `index.ts`**，
`usage.ts` 只做纯计算。请在 `architecture.test.mjs` 里补一条断言钉住「usage.ts 不 import task.ts」。

**必须修掉的原型缺陷：** 原型里 Task 没有 `baseEvidence` 时，`baseGitRef` 直接缺席，
而 `comparable` 仍是 `true`——一条认不出起始仓库状态的记录被当成可比样本。
规则：**缺基线 git ref ⇒ 该记录不可比**，并在 `incomparableReasons` 里给出理由。

### 条款 2：给定一组确定性记录（含失败与返工），汇总输出五个量

纯函数 `summarizeRuns(records)`，输出 `passRate` / `costPerSuccessUsd` / `totalSpendUsd` /
`avgReviewRounds` / `avgDurationMs`，外加 `runs` / `comparable` / `incomparable` / `completed`。

- **`passRate` 在全部记录上算**（不可比的失败照样是失败）。
- **`totalSpendUsd` 含失败运行的费用**——这是本工单的要点，不许剔除失败样本。
- **`costPerSuccessUsd = totalSpendUsd ÷ 可比且完成的运行数**。没有可比成功样本时是 `undefined`，
  JSON 里整个键缺席。**缺席 ≠ 0**：渲染必须显式说「无可比成功样本」，**不许打印 `$0.00`**。
- 再加子命令 `/planner-only usage summary [<dir>]` 渲染它（不是裸 JSON.stringify，要人能读）。

### 条款 3：缺少费率或用量的记录标记为不可比，不按零计入

`comparable: boolean` + `incomparableReasons: string[]`。至少覆盖：费率缺失、
root turn 报零 token、费用里含 ticket-15 估算债（`costDebtUsd`）、耗时不可导出、缺基线 git ref。
**不可比记录一律排除在 `totalSpendUsd` / `costPerSuccessUsd` 之外，并在 `incomparableReasons` 里按理由计数。**
绝不能把缺失当 0 加进总支出。

### 条款 4：记录规范写入 docs

新建 `docs/pi-planner-only-cost-comparison-protocol.md`：逐字段说明记录格式（字段名、类型、来源、
缺失时的表现），说明**隔离基线**与**模型分工方案**两个 arm 各自怎么跑、`--arm` 怎么填，
并写明汇总的口径（失败计入、不可比排除、成功完成成本的分母是什么）。
**不许出现任何未经测量的节省百分比或预期收益。**

## 4. 已知的坑（都是我实跑撞到的，别再撞一次）

1. **浮点噪声真实存在**：实测 `totalUsd = 0.16999999999999998`、`0.12000000000000001`。
   断言一律用容差，**禁止 `assert.equal(x, 0.17)`**。
2. `costPerSuccessUsd` 为 `undefined` 时 `JSON.stringify` 会把键整个丢掉，
   往返读写后不要断言 `"costPerSuccessUsd" in obj`。
3. 记录文件目录要 `mkdirSync(..., {recursive:true})`，隔离夹具下父目录不一定存在。

## 5. 断言质量要求（这一轮的重点，比实现更重要）

**每一条新断言单独做失败证明**：改坏被测代码的一处 → 跑属主套件 → 贴**逐字**失败输出（含文件:行号）
→ 改回来。不接受「一组断言做一次证明」。否定断言（「X 不发生」）额外要**反向变异**。

以下三种失效形态是 2026-09-09 在本仓现场抓到的，不是理论风险，你的断言不许犯：

1. **空转**：断言声称守护某段实现，但把那段实现整个删掉，断言仍然通过。
   判定方法：删掉断言所声称守护的代码，断言**必须**变红。空转断言比没有断言更糟。
2. **测错层**：断言放在缺陷观测不到的那一层（例如在 orchestrator 层测一个只在 reservations 层
   可见的泄漏），于是恒真。断言要放在缺陷可观测的那一层。
3. **合并**：多个命题塞进一条 `assert`，逐条失败证明无法成立。**一条断言一个命题。**

另有一条给你自己的：**判定「这条断言没用」之前，先怀疑自己的变异**。变异必须和断言的语义一样窄；
过宽的变异会先打红一堆无关断言，你会得出错误结论。若首个失败不是目标行，
把更早那条 `assert.xxx(` 换成一个「照常求值参数、吞掉结果」的代理再跑，**不要注释掉**
（注释会连带删掉写在断言参数里的副作用调用）。

## 6. 绝对禁令：不许删除或改写既有断言

**既有断言一律不许删除或改写。** 确有必要时，停下来向 planner 报告：写清哪一条、在第几行、
为什么当前实现让它变红。**擅自删除既有断言视为回归，该轮不予接收。**

交付前自查，把输出贴进报告：

```bash
git diff -- usage.test.mjs index.test.mjs architecture.test.mjs | grep '^-.*assert'
```

**这条命令必须没有输出。** 上一轮的执行者把两条既有断言藏在 diffstat 的 `-3` 里删掉且只字未提，
复原后整套照常通过——删除没有任何技术理由。

## 7. 验收（四条，逐条把逐字输出贴进报告）

1. `npm run typecheck` 退出码 0。
2. `npm test`：输出里**必须出现 `planner-only architecture: PASS`**，且**唯一**的 `AssertionError`
   是 `naming.test.mjs` 的 `extension install is missing ledger-store.ts`（该套件对着仓外一份跟踪
   `main` 的安装副本跑，本分支必红；它走 stderr，`npm test` 整体 exit=1 是**预期**）。
   **注意：不要用「各套件都打印了 `: PASS`」当验收依据**——`orchestrate.test.mjs` 的 PASS 横幅印在
   第 3717 行而文件有 5957 行，横幅之后还有 2240 行断言。真正兜底的是 `&&` 链能不能走到 `architecture`。
3. `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` 退出码 0。
4. `git diff --check` 退出码 0。

日志一律存 `.scratch/planner-only-cost-control/p18-r080-*.log`。

## 8. 报告里必须有

- 四条验收命令的逐字输出（或日志路径 + 关键行）。
- 每条新断言的失败证明：变异了什么（文件:行号 + 改法）、逐字失败输出、已改回。
- §6 那条 `grep '^-.*assert'` 的输出（应为空）。
- `git diff --stat`。
- 你做过但工单没要求的任何改动，逐条列出来。
- 做不到的条款：**照直说做不到，并说清卡在哪**。不要用「大概通过了」收尾。
