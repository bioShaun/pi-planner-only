[轮次] round_id=PENDING

# 工单 16-b：重载后恢复 Task 账本；损坏时拒绝声称余额可信

你是执行者。规划者是 Claude，pane `w2E:pD`。**报告发回 `w2E:pD`。**
工作目录 `/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`，`HEAD=6f628a3`。

---

## 0. 环境规则（逐字照做，不得放宽）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时目录、缓存、构建暂存或任务产物。
  任务本地的中间文件放在当前工作目录下一个清楚命名的可丢弃子目录；
  需要放在工作目录之外时用 `/project/tmp`。这条同样适用于你派出的任何子进程。
- **预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交。**
  `npm test`、`npm run test:e2e`、以及你的空转审计驱动都属于这一类：`slot cpu -- <命令>`。
- **每次启动重任务前必须先运行 `slot audit` 和 `slot status`，并把输出写进本轮日志。**
  禁止先跑重活、事后补查。
- `slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；应等待、降低本任务并发，
  或在报告里写明资源冲突。（当前已知有一个绕过 slot 的 `postsort`，PID 459084，RSS 11.9G——
  **不要动它**，只需把自己的命令串行化。）
- **不要用 `slot slots` 调大槽位数给自己插队。**
- `.agent-dir/models.json` 与 `.agent-dir/auth.json` 含 provider API key：
  **不要读、不要打印到报告里、不要提交。**

## 1. 本轮改什么

一次扩展重载会把 Task 的累计消耗清零，于是同一个 Task 拿到**第二份完整预算**。
这是我实跑证实的，探针 `.scratch/planner-only-cost-control/p16-probe/r077-reload-loses-the-ledger.mjs`：

```
=========== session A status ===========
  费用: 已用 $0.0400 / 上限 $0.0500，剩余 $0.0100

=========== what is on disk ===========
 T-20260908-950.json: state=changes_requested usage.root.costUsd=undefined children=1 budget={"tokens":200000,"costUsd":0.05}

=========== session B status (after reload) ===========
（整个 Task 不见了，只剩 Session usage: tokens=0）

after reload, delegating the SAME Task again:
  blocked? no
  usageBudget handed to the child: {"tokens":{"hard":100000},"costUsd":{"hard":0.05}}
```

**盘上的快照是全的**（16-a 已经在写），缺的只有读回来这一半。
工单 37 刚把第一次委派也纳入闸门，于是「重载 → 又一份满预算」变成了绕开累计上限最省事的路径。

本轮做工单 16 的第 1、2 条（16-b），**第 3、4 条（预算停止后的收尾）不做，留给 16-c**。

## 2. 定稿改法

### D1 `ledger-store.ts`：加读回

```ts
readAll(): { records: TaskRecord[]; corrupt: { taskId: string; reason: string }[] }
```

- 目录不存在 → `{ records: [], corrupt: [] }`，不抛、不 warn（首次启动就是这个形态）。
- 只看 `<dir>/planner-only/ledger/*.json`，忽略 `.tmp-*` 残留。
- **文件名的 stem 是 taskId 的权威来源**，因为损坏的文件里读不出 id。
  stem 不满足 `SAFE_TASK_ID` → 进 `corrupt`。
- 解析失败、`version !== 1`、缺 `task`、或 `task.taskId !== stem` → 进 `corrupt`，`reason` 写清楚是哪一种。
- `readAll()` 自己**不修复也不删除**任何文件。

### D2 `task.ts`：`TaskStore.restore(record: TaskRecord): void`

- 直接把记录装进内部 map（`tasks` 是 private，探针里能绕过去只是因为
  strip-types 不做运行时封装——**必须加真方法，不要在外面写 `store.tasks.set`**）。
- **不调用 `touch()`、不调用 `persist()`**：装载不是变更，回写会把 `updatedAt` 冲掉。
- 已存在同 id 时不覆盖（活着的内存记录优先于盘上的旧快照）。

### D3 `orchestrate.ts` + `index.ts`：在 `session_start` 装载

- `PlannerOrchestrator` 加 `restoreFromLedger(): { restored: number; corrupt: {...}[] }`，
  仅当构造时给了 `ledgerDir` 且没注入 `deps.store` 时有事可做（与 16-a 的 sink 条件一致）。
- `index.ts` 的 `session_start`（约 900 行）在 `loadSessionUsage(ctx)` 之后调用一次。
- **在途预留一律不恢复。** 上一轮会话的子进程已经随进程消失，
  恢复预留只会凭空占住余额。`BudgetReservations` 保持空。

### D4 损坏 → 该 Task 余额不可信

- orchestrator 记一份 `untrustedBalances: Map<taskId, reason>`，来源就是 `readAll()` 的 `corrupt`。
- **作用域按 taskId**，不是全局：一个文件坏了不该冻住别的 Task。
- `beginDelegation`：该 Task 的**受控付费委派**被拒，理由**必须与
  `cumulativeBudgetRefusal` 是两条不同的信息**（用户要能分清「花超了」和「账不可信」）。
  文案开头用 `Planner-only guard: task <id> ledger snapshot unreadable`，
  正文说明「余额无法确认，拒绝新的受控启动」，并给出损坏原因。
- **reviewer 依旧豁免**（和 37 号同一条理由：账不可信也必须能把 Task 关掉）。
- `renderTaskStatus`：该 Task 的 Budget 块里加一行说明余额不可信，
  **不要**再把「剩余」当作可信数字展示。

### D5 顺手清掉 16-a 留下的两个卫生问题

- `lastWriteError` 是粘的：一次瞬时写失败会让 D4 的判断永久拉响。
  改成**按 taskId 记**（写成功即清该 taskId 的失败标记），`lastWriteError` 只留作诊断字段。
- `warn()` 的一次性配额被非法 taskId 抢占：`write()` 两条失败路径共用 `this.warned`，
  先来一个无害的非法 taskId 就会让之后真正的磁盘故障静默。**拆成两个配额**；
  非法 taskId 那条本来就 `throw`，已经足够响亮，不该消耗 I/O 的那一次 warn。

### D6 不要做节流（我已经量过）

「每次 `touch()` 同步全量写盘」这条遗留项**本轮不处理，也不要自作主张加脏标记或节流**。
实测（`p16-probe/r077-touch-write-cost.mjs`，本机 NVMe）：

```
reports= 0  snapshot=   1026 B  per touch()=0.097 ms
reports= 3  snapshot=   5162 B  per touch()=0.086 ms
reports=10  snapshot=  14837 B  per touch()=0.102 ms
reports=30  snapshot=  42497 B  per touch()=0.156 ms
```

委派本身是秒级的，0.1 ms 可以忽略；而脏标记方案的失败模式是**丢写**，对账本来说更糟。

## 3. 不许碰

- `.scratch/planner-only-cost-control/spec.md`、`issues/` 下任何文件（包括勾 checkbox）——那是规划者的。
- `p16-probe/` 下**任何现有探针**，尤其
  `r075-first-delegation-ungated.mjs`、`r077-reload-loses-the-ledger.mjs`、
  `r077-restore-shape.mjs`、`r077-touch-write-cost.mjs`：验收要按原样重跑它们。
- 不要 `git commit`，不要 `git push`。规划者复核后自己提交。
- `usage.jsonl` 的格式与写入路径不动。

**可改文件**：`ledger-store.ts`、`task.ts`、`orchestrate.ts`、`index.ts`、
`ledger-store.test.mjs`、`task.test.mjs`、`orchestrate.test.mjs`、`index.test.mjs`、
`architecture.test.mjs`，以及 `.scratch/planner-only-cost-control/p16-r077-*.log`。

## 4. 验收（四条命令 + 两条实测）

全部走 `slot cpu --`，逐条把退出码写进报告：

1. `npm run typecheck` → 0
2. `npm test` → 只允许 `naming.test.mjs` 一个套件失败（分支未并 main 的既有闸门），
   其余 16 个套件必须打印 `: PASS`
3. `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` → 0
4. `git diff --check` → 0

实测 A：**原样重跑** `p16-probe/r077-reload-loses-the-ledger.mjs`（一个字都不改），
session B 的 status 必须重新出现这个 Task，并显示 **已用 $0.0400 / 剩余 $0.0100**，
重载后再委派同一个 Task 时下传的 `costUsd.hard` 必须 **≤ $0.0100**，不再是 $0.05。

> 浮点注意：我的原型量到的是 `0.010000000000000002`。
> 断言一律用容差（`Math.abs(x - 0.01) < 1e-9`），**不要**写 `=== 0.01`，也不要为了好看去 round。

实测 B：新写一条损坏探针（放 `p16-probe/r077-corrupt-ledger.mjs`），
把某个 Task 的快照文件改成非 JSON，重载后：status 对该 Task 显示余额不可信、
新的受控付费委派被拒且理由**不是**「cumulative budget exhausted」、
而同一次会话里**另一个**快照完好的 Task 不受影响。

## 5. 失败证明（这条最重要）

你新加的**每一条**断言，都要单独证明它不是空转：把被测代码改坏一处、
贴逐字的失败输出（含断言名与行号）、再改回来。

- **合并成一组只证明了一条——不接受「这几条一起证」。**
- 对「X 不发生」这类否定断言（例如「reviewer 不被拦」「另一个 Task 不受影响」
  「装载不回写」），单纯把功能删掉是证不出来的，必须做**反向变异**
  （把豁免/隔离拿掉，看断言是否变红）。
- 变异要**真的改变可观测行为**。上一轮我自己的审计里有三条误判，全是变异写错：
  把 `fs.writeFileSync` 换成 `fs.appendFileSync`（node 内部仍经由前者派发，等价变异）；
  给一个纯文本匹配断言做了个「别名 import」变异，而字面量还留在 import 行上；
  中和多行 `assert` 时只注释首行，把文件写出语法错误。**判空转前先怀疑自己的变异。**
- 我会自己独立重跑一遍全套空转审计（上一轮 27 条我全跑了），
  所以请把每条的变异写清楚，方便我复核。

## 6. 报告格式

发回 `w2E:pD`，纯文本，含：

1. `round_id`、`ticket`、`HEAD`、`branch`
2. 改了哪些文件、每个文件干了什么（按 D1–D5 对应）
3. `slot audit` / `slot status` 的原始输出
4. 四条验收命令各自的退出码与关键输出
5. 实测 A、实测 B 的**完整 stdout**
6. 每条新断言的失败证明（变异描述 + 逐字失败输出）
7. 工单里你认为写错或自相矛盾的地方——**照直说**，前三轮你提的都被采纳了
8. 不要 commit，不要勾 checkbox
