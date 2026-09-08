[轮次] round_id=PENDING

# 工单 16-a：账本快照落盘（只写，不回放）

回信地址：**w2E:pD**（planner，claude）。做完把报告发回这个 pane，不要只写在你自己的 pane 里。
工作目录：`/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`，HEAD `ce99c07`。

---

## 0. 环境规则（逐字遵守，不得放宽）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时文件、临时目录、缓存、构建暂存或任务产物。
  任务局部的中间文件放当前工作目录（用一个名字清楚的一次性子目录）；
  需要放在工作目录之外时用 `/project/tmp`。这条同样适用于你起的脚本、子进程和委派出去的子代理。
- 预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，**一律用 `slot` 提交**
  （`slot cpu -- <命令>`）。
- **每次启动重任务前必须先运行 `slot audit` 和 `slot status`，并把输出写入项目日志**
  （`.scratch/planner-only-cost-control/p16-r075-slot-audit.log` 与 `-slot-status.log`）。
- `slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；应等待、降低本任务并发或报告资源冲突。
  **禁止先启动重活、事后再补查。**
- **不要用 `slot slots` 调大槽位数给自己插队。**
- `.agent-dir/models.json` 和 `.agent-dir/auth.json` 里有厂商 API key：
  **不许读、不许写进报告、不许提交。**

---

## 1. 要修的问题

`TaskStore` 就是一个进程内 `Map`（`task.ts:437`），全局只在 `orchestrate.ts:554` 构造一次。
扩展 reload 或换会话之后，Task 记录整个消失。后果不是「统计不准」，是**闸门变哑**：

14A 的检查—预留读的是 `task.spec.cumulativeBudget`（`orchestrate.ts:727-733`）。
记录没了 → spec 没了 → 那段 `if` 根本进不去 → 等于重新发一份全额预算。
所以持久化面必须覆盖**整个 `TaskRecord`**（`task.ts:396-428`），不是只存 `TaskUsage`。

我已经实跑核过两件事，你不用重做，但可以复跑：

- `TaskRecord` 走 `JSON.stringify`/`parse` **无损**，`spec.cumulativeBudget` 原样存活：
  `node --experimental-strip-types .scratch/planner-only-cost-control/p16-probe/r076-taskrecord-json-roundtrip.mjs`
  → `lossy keys: (none)`，`PASS`，exit 0。
- 写入的汇聚点只有两个：`TaskStore` 的 `private touch()`（`task.ts:520`，所有 mutator 都从它返回）
  加 `create()`；以及 `index.ts:411` 的 `syncUsage()`，第 415 行 `task.usage = usage` 是唯一直写 usage 的地方。

**本轮只做「写」，不做回放。** 回放、损坏失信、status 披露是 16-b，在途预留身份恢复是 16-c。

---

## 2. 已经定死的设计（不要自己改，拿不准就停下来问 w2E:pD）

- **D1 新模块 `ledger-store.ts`**，导出 `class LedgerSnapshotStore`。
  **构造参数是目录字符串**，不在模块作用域读 env——`index.ts:39` 的 `AGENT_DIR` 就是模块作用域捕获，
  那正是它没法测的原因，不要复制这个毛病。
- **D2 路径 `<dir>/planner-only/ledger/<taskId>.json`**。taskId 是模型给的字符串，
  **必须先用 `/^[A-Za-z0-9_.-]+$/` 校验**，不匹配就抛错，不许拼进路径。
  （`T-2026../../etc/x` 这种要在写之前就死掉，不是靠 `resolve` 事后兜。）
- **D3 原子替换**：先写同目录下的临时文件（名字带 pid + 自增序号），`renameSync` 到最终名。
  最终名下**任何时刻都不许出现半份内容**。
- **D4 内容 `{ version: 1, writtenAt: <ISO>, task: <TaskRecord> }`**。
  `version` 是给 16-b 用的：将来遇到不认识的版本要拒绝，而不是猜。
- **D5 写失败不许炸委派路径**：`try/catch` 兜住，实例上记 `lastWriteError`（暴露一个 getter），
  同一个会话最多告警一次。理由：丢一份快照只是退回今天的行为，把整个会话炸掉损失大得多。
  但**不许永远静默**——16-b 的 status 披露要读这个标志。
- **D6 挂载点正好两个**：
  1. `TaskStoreOptions` 加 `onPersist?: (record: TaskRecord) => void`，
     在 `create()` 末尾和 `touch()` 里调用；
  2. `index.ts` 的 `syncUsage()`，在 `task.usage = usage` 之后调用。
  `OrchestratorDeps` 加 `ledgerDir?: string`：**只有在给了 `ledgerDir` 且没有注入 `deps.store` 时**
  才构造带 sink 的 `TaskStore`。`index.ts:174` 传 `ledgerDir: AGENT_DIR`。
  **这条的目的是：现有测试一个字都不用改，也绝不会因此开始往磁盘写文件。**
  如果你发现有既有测试因为本轮改动开始落盘了，那是 bug，停下来报告。
- **D7 本轮运行时不许读回任何快照。** 测试里读没问题。
- **D8 不许动 `usage.jsonl`。** 它是只追加的审计日志，语义不同，不许拿来兼做状态恢复。

---

## 3. 允许改的文件（其余一律只读）

`ledger-store.ts`（新）、`ledger-store.test.mjs`（新）、`task.ts`、`orchestrate.ts`、`index.ts`、
`package.json`（只动 `files` 数组和 `test` 脚本）、`task.test.mjs`、`architecture.test.mjs`，
以及 `.scratch/planner-only-cost-control/p16-r075-*.log`。

**只读**：`usage.ts`、`reservations.ts`、`types.ts`、`review.ts`、`roles.ts`、`evidence.ts`、
`spec.md`、`issues/` 下的一切、`p16-probe/` 下已有的探针。
**不许 commit，不许 push，不许勾任何 checkbox。**

---

## 4. 验收（每条都要有日志，逐条贴到报告里）

1. `slot cpu -- npm run typecheck` → exit 0
2. `slot cpu -- npm test` → **exit 1 是预期的**。
   `naming.test.mjs` 比对的是仓外那份跟着 `main` 走的安装副本，
   现在缺 `reservations.ts`，加了 `ledger-store.ts` 之后会缺两个。
   **除 `naming.test.mjs` 外的每一个套件都必须打印 `: PASS`**，包括你新加的 `ledger-store` 套件。
   报告里写清楚 `naming.test.mjs` 的失败原文。
3. `slot cpu -- env PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` → exit 0
4. `git diff --check` → exit 0
5. **原子性要实测，不许只靠代码审查**：写一个用例证明最终文件不会出现半份内容
   （例如让序列化中途抛错，或在写入过程中读最终路径），并证明失败之后旧快照仍然完整可读。
6. **路径校验要实测**：`taskId` 含 `/`、`..`、空字符串时抛错，且**目标目录之外没有产生任何文件**。

---

## 5. 逐条失败证明（硬要求）

你新加的**每一条**断言，都要单独证明它不是空转：
给出一个针对性的变异（或把实现退回改前的状态），单独让这一条断言失败，贴出**逐字**的失败输出，
包含文件名和行号。若有别的断言先失败，把先失败的那条临时置空再跑，直到失败归因到目标行。

**合并成一组只证明了一条——不接受「这几条一起证」。**
否定断言（断言某个东西**不**发生）用去功能证明不了，必须改用针对它的反向变异。

参考做法在 `.scratch/planner-only-cost-control/p16-probe/r074-vacuity-audit.py`，
那是我上一轮用的驱动脚本，可以直接改 `CASES` 复用。

---

## 6. 报告写什么

写进 `.scratch/planner-only-cost-control/p16-r075-report.log`，并把全文发回 **w2E:pD**：

- 改了哪些文件，各自一句话
- 4 条验收 + 第 5、6 条实测的原文输出
- 每条新断言的失败证明（变异 + 逐字失败输出 + 行号）
- slot audit / status 的结论（有没有绕过 slot 的进程，你怎么处理的）
- 工单本身的问题：哪里写错了、哪里做不到、哪里你觉得设计不对——**照直说，不要替我圆场**
