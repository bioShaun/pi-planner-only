# 决策记录：工单 15（未知负债）与工单 16（持久化恢复）

2026-09-08，planner `claude-pD`。用户 2026-09-08 指示：「需要决策的复杂任务你来处理，剩下的让 cursor 去规划处理」——
本文件是我作为 planner 就这两票做出的设计决定，含**与工单原文的偏离**及其理由。实现分轮进行，不在本文件里写代码。

所有事实结论都在本轮实跑/读码核实过，file:line 均为核实当时的位置（HEAD `4afaa54`）。

---

## A. 先纠正一条我自己说过的话

我先前对用户说过「全仓零落盘」。**这是错的。** `index.ts:412-445` 的 `writeUsageLog` 会把每个 Task 的 usage 追加到
`<AGENT_DIR>/planner-only/usage.jsonl`（`index.ts:315-320`，可用 `PI_PLANNER_ONLY_USAGE_LOG` 覆盖，设 `0` 关闭）。

真正的事实是更精确的一句：**盘上有，但没有任何地方把它读回来。** 全仓 `.ts` 里唯一的 `readFileSync`
在 `usage.ts:278`，读的是 pricing 表；`index.ts` 的 `readdir` 用于 session artifact 目录。
`usage.jsonl` 是只追加的审计日志，**没有回放路径**。

---

## B. 工单 15：未知负债

### B.1 已核实的缺口

1. `usage.ts:643` 注释原文：「Unknown components do not reduce remaining: treating them as debt is
   reserved for a later budget policy.」`summarizeTaskBudget` 把 `pending || source === "unavailable"`
   的子调用只计进 `unknownParts`，**不计进 `known`**。
2. `orchestrate.ts:548-552` 的 `endDelegation` 在委派结束时把预留**整份释放**。
3. 两者叠加：一个拿不到费率（或 usage 永不解析）的子进程，**真金白银花掉的部分在账本上等于 0**，
   预留也放掉了，14A 的闸门于是永远算出「还有余额」。

实跑证据（`.scratch/planner-only-cost-control/p15-probe/r072-status.mjs` case B）：worker 实际烧掉 39000 tokens、
无费率，status 打出的费用行是 `已用 $0.0100 / 上限 $0.5000，剩余 $0.4900（不含 1 个未知项）`——
**那 39000 tokens 对应的钱，在费用维度上完全不存在。**

### B.2 决定

**未知费用按「预留价」转成负债结算，不按 0 结算，也不靠一直持有预留。**

具体：

1. 子进程结束、`costUsd === undefined` 时，`endDelegation` **不把预留整份丢弃**，而是把「本次授予的费用额度」
   转成一笔**未知负债**记进 Task，进入 `known` 一侧参与闸门计算。
2. 真实费用后到时，用真实值**替换**该笔负债（而不是叠加）——这同时满足工单 15 第 1 条的幂等要求：
   按 `runId`/`toolCallId` 定位那笔负债，替换是幂等的，重复通知不会重复扣。
3. token 维度按工单 15 第 5 条办：**token 已知就按真实值正常结算**，只有费用维度记未知。
   Usage 完全缺失（`pending` 永不解析）时，token 也按授予额度记负债。
4. 负债是**有限的**（等于授予额度），所以不会重现我在 p15-r069 修掉的那个「预留永久占住、Task 永久卡死」的形态。

为什么不选另外两条路：

- **一直持有预留不释放**：等价于把 14A 的泄漏 bug 作为策略重新引入。一个永不回来的 async run 会把 Task 永久锁死，
  且没有任何上界。否决。
- **维持记 0**：这就是现在的行为，闸门可被「看不见的花销」无声绕过。这是本票存在的原因。否决。

### B.3 **与工单原文的偏离（需要留痕，不是静默改写）**

工单 15 第 4 条原文：「子进程 Usage 缺失：记为未知负债，**配置了费用上限时下一次启动被拒绝**并说明。」

字面读法是：只要存在未结算负债，且配了费用上限，就拒绝下一次启动，**与剩余额度无关**。
按这个读法，一个永不回来的子进程会让一个还剩 99% 预算的 Task 完全无法继续——
这不是成本控制，是把可用性烧掉换一个并不存在的安全感。

**我的决定：改为「负债计入 `known` 后由既有的 14A 闸门判断是否拒绝」**，即
`known + 负债` 把某个已配置维度耗尽时才拒绝；**无论拒不拒绝，负债都必须在 status 和拒绝文案里显式披露。**

理由：这样负债「不等于零」的语义完整保留（工单原文「未知价格不等于零」的实质要求），
「不能仅凭可见小计放行」也满足（可见小计已被负债抬高），同时不引入一个与额度无关的硬停机。

**这条偏离要写进工单 15 的批注，并且第 4 条按新措辞验收，不按原措辞打勾。**

---

### B.4 确认未启动的委派不记负债（2026-09-08 追加，p16-r074 之前定）

15-a 落地后我实跑撞出一个它自己引进的洞，**决定记在这里**。

**已核实的行为**（探针 `p16-probe/r074-clause2-failed-launch-debt.mjs`，直接 `node` 跑）：
Task 上限 $0.50，第一个 worker 正常结算花掉 $0.05；第二个委派宿主确认**根本没启动**
（`isError`、无 `runId`、无 `results`）。`handleSubagentResult` 走
「confirmed start failure」分支，`endDelegation` 释放了写锁和预留（拒绝文案里
`在途预留: tokens=0, 费用 $0.0000` 为证），但 `index.ts` 的 `recordSyncChildren`
照样按全额授予额度记了一行 pendingChild 负债。结果：

```
已知消耗: tokens=101500, 费用 $0.5000
```

$0.45 的负债来自一个从未存在的子进程，上限当场吃穿。而插件给 Root 的提示原话是
"Fix the delegation input and re-delegate with the same TaskSpec"，工单 14 第 5 条
又规定重发不重置累计值 —— **它自己推荐的恢复路径必然被自己拒绝**，Task 永久报废。

**决定：**

1. 宿主确认未启动时，那一行 pendingChild **根本不记**，而不是记了再删。
   一个从未启动的子进程消耗为零，既不该有负债，也不该计进 `未知项`。
   `UsageLedger` 不加删除接口 —— 加了就等于承认账本可以回退，那是另一类风险。
2. **分类器只准有一个。** 判断「确认未启动」必须复用 `handleSubagentResult` 里
   已有的那一处（它同时决定释放写锁），由 orchestrator 记下 toolCallId 供 index.ts 查询。
   **这个 bug 的成因就是两处各自判断**，再抄一份只会再错一次。
3. **`isBudgetStop` 不豁免。** 预算触顶而停的子进程真的跑过、真的花了钱，负债必须留着。
   现有代码里 `isBudgetStop` 与「没有 runId」本来就是两个独立条件，不要合并。
4. **承认的残余风险**：宿主报错但其实已经启动了子进程时，本决定会少记一笔负债。
   接受这个风险的理由是——同一个分类器**已经**在拿它决定「释放写锁」，
   那是比记账严重得多的决定；记账跟着写锁走，至少两者不会互相矛盾。
   要收紧的话该收紧的是那个分类器本身，不是在它下游再加一套判断。

## C. 工单 16：持久化恢复

### C.1 已核实的缺口

1. `TaskStore` 就是一个进程内 `Map`（`task.ts:437`），全局只在 `orchestrate.ts:541` 构造一次。
2. `usage.jsonl` 只追加、无回放（见 §A）。
3. 因此扩展 reload / 换会话之后：Task 记录没了 → `task.spec.cumulativeBudget` 没了 →
   **14A 的闸门根本不会触发**，等于重新发一份全额预算。

**这里有一个我一开始想漏了的点，必须写下来**：16 第 1 条常被读成「把 usage 恢复出来就行」。
不对。闸门读的是 `task.spec?.cumulativeBudget`（`orchestrate.ts:1243` 与守卫处同源），
**光恢复 usage 而不恢复 TaskSpec，闸门依然是哑的**。所以持久化面必须覆盖 `TaskRecord`（`task.ts:396-428`），
不只是 `TaskUsage`。好消息是 `TaskRecord` 的字段全是纯数据，可直接 JSON 序列化。

### C.2 决定

1. **不动 `usage.jsonl`。** 它是审计日志，语义是「只追加、事后可查」，重新利用它做状态恢复会把两种语义搅在一起。
2. **新增一份账本快照**：`<AGENT_DIR>/planner-only/ledger/<taskId>.json`，内容 = `TaskRecord` + 在途预留身份。
   写入用「临时文件 + rename」保证原子性，在每次 usage 同步、每次委派开始/结束时写。
3. **启动时同步回放**：与 `loadFloorConfig()` 在 `index.ts:159` 的位置一致，用 `readFileSync` 同步读回，
   与 `usage.ts` 读 pricing 表的既有风格一致，避免把扩展入口改成异步。
4. **损坏即失信**：任何一个快照 JSON 解析失败或 schema 不符，该 Task 标记为「余额不可信」，
   status 显式显示，**并拒绝新的付费委派**（工单 16 第 2 条）。不许「尽力恢复能读的部分」——
   半份账本比没有账本更危险。
5. 在途预留身份随快照恢复；进程已经不在的委派在回放时按「Usage 缺失」处理，走 §B 的负债路径。

### C.3 分期

这是剩余工作里最大的一块，不是一轮能干完的：

- **16-a**：`TaskRecord` 快照的写入 + 原子替换 + 单测（不含回放）。
- **16-b**：启动回放 + 损坏失信 + status 披露。
- **16-c**：在途预留身份的恢复，依赖 §B 的负债路径先落地。

**顺序：先做工单 15（§B），再做 16-a/b/c。** 因为 16-c 直接建在负债语义之上，反过来做会返工。

---

## D. 与工单 36 F3 的关系

§B 和 §C 都是**插件侧**的账本正确性，它们成立与否不依赖「宿主是否真的在 `hard` 处停下子进程」。
但工单 05 文末那句仍然有效且没被本文件闭合：**运行时强制从未被证明。**
本轮 p15-r072（14B + 17）做的就是把这件事在 status 上说出来，默认按「仅事后观测」披露。
F3（真跑一次子进程去证明宿主到底停不停）要花模型钱，仍在用户手上，本文件不替它做决定。

---

## E. 工单 37：第一次委派绕过闸门——改法定稿

### E.1 现象与机制（已实跑坐实）

探针 `p16-probe/r075-first-delegation-ungated.mjs`，`cumulativeBudget = {tokens: 200000, costUsd: 0.05}`：

```
usageBudget handed to call-first:  {"tokens":{"hard":100000},"costUsd":{"hard":0.5}}
first delegation blocked? no
在途预留 present after 1st? false
second delegation blocked? YES: ... cumulative budget exhausted (costUsd).
```

**第一个子进程的单次硬上限是 $0.50，Task 的整份累计预算是 $0.05。**
机制：检查—预留那段的入口是 `budgetTask = target?.task`（`orchestrate.ts:727-733`），
而创建 Task 的那次委派走到这里时 store 里还没有记录——记录要到 `orchestrate.ts:1000/1005/1067`
的 `store.create()` 才出现。整段被跳过：不检查、不预留、不盖 grant，
`resolveEffectiveLimits` 也拿不到 `balanceTokens/balanceCostUsd`。

### E.2 我在工单里写错的一条，更正

37 号工单原文的「方案 C：委派成功记录之后补做一次预留……闸门仍然是事后的」**是错的**。
`beginDelegation` 就是 `tool_call` 钩子，`store.create()` 和它的返回在同一次调用里，
返回 `{block}` 就能阻止启动——建完 Task 再预留**仍然是启动前**。

但方案 C 有另一个真问题，也是我一开始没看到的：
`orchestrate.ts` 的 828、886、936 三处是 `delegations.set(...)` **紧跟 `return`**，
它们是**成功启动**的早退路径，不是拒绝路径，压根走不到 `ensureCwd`。
把预留整段挪到 `ensureCwd` 之后，会把这三条路径现有的预留**一起弄丢**。
所以「往后挪」不成立，要「就地补齐」。

### E.3 定稿（方案 B′）

1. 预留点不动。当 `target?.task` 为空而 `targetSpec?.cumulativeBudget` 存在时，
   用 `emptyTaskUsage()` + 该 `cumulativeBudget` 现算一份 budget，
   预留挂在 `targetSpec.taskId` 上。新 Task 余额是满的，检查这一半必然通过，
   **真正起作用的是另一半：把余额喂给 `resolveEffectiveLimits`，
   让第一个子进程的 `usageBudget.hard` 受累计预算约束**，并盖上 grant。
2. **键的风险必须处理**：`spec.taskId` 不一定就是入库的 id——
   `shouldReplaceTaskId` 分支会用 `store.nextTaskId()` 另生成一个，原 id 只留作别名
   （`orchestrate.ts:997-1000`）。而 `endDelegation` 是按 `record.taskId` 释放的
   （`orchestrate.ts:564`），键不对就会**永久泄漏**，且 `inFlight(realTaskId)` 看不见它——
   D4 不显示、闸门不计数，比不预留更糟。
   因此加 `BudgetReservations.rekey(fromTaskId, toTaskId, toolCallId)`，
   在 `store.create(storedSpec, spec.taskId)` 之后立刻改键。
3. 其余一切不动：grant 盖章、D4 披露、工单 15 的负债都是按 `toolCallId` 走的，改键之后自动正确。

**定稿前还欠一次实跑核验**（cursor 占着写者位，等 p16-r075 收工再做）：
`summarizeTaskBudget(emptyTaskUsage(), cumulativeBudget)` 产出的 `ReservationBudget`
形状与既有调用一致，`limit` 有值、`known` 为 0。没核之前不许派工。
