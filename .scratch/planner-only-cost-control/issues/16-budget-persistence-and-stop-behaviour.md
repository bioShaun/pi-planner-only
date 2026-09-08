# 16: 持久化恢复与预算停止后的收尾能力

**What to build:** 扩展 reload 或会话恢复后，Task 的累计消耗与在途预留身份从现有 Usage 持久化与重放机制恢复，不会得到一份新预算；关键数据无法恢复时状态明确拒绝声称余额可信。预算不足停止新的付费委派后，status 查询、合法的非通过 Verdict、已完成结果的结算仍然可用，不为预算停止绕过现有生命周期规则。

**Blocked by:** 15。

**Status:** ready-for-agent

- [ ] reload 后 status 显示的已用与预留与 reload 前一致。
- [ ] Usage 文件损坏：status 显示余额不可信，新的付费委派被拒绝。
- [ ] 预算停止后：status 可查；Root 可记录非通过 Verdict；此前已启动的子进程返回后仍被结算与记录。
- [ ] 预算停止不改变写锁与 Task 状态机的现有规则。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 37–38，阶段 D 决策第 5 条）。

## 分期落地：16-a 账本快照（只写不回放）—— p16-r075，已由 planner 逐条复核

**本轮不勾任何 checkbox。** 上面四条全部依赖回放/损坏判定，属于 16-b / 16-c；16-a 只建立写入侧。

### 交付物

- 新增 `ledger-store.ts`：`LedgerSnapshotStore`，构造参数为目录（不读模块级 env）。
- 路径 `<dir>/planner-only/ledger/<taskId>.json`，`/^[A-Za-z0-9_.-]+$/` 校验，不合法直接 throw。
- 原子写：同目录临时文件 `.tmp-<pid>-<seq>` + `renameSync`；失败时 unlink 临时文件并抛出。
- 信封 `{version:1, writtenAt, task}`，整条 `TaskRecord` 落盘（16-b 的闸门要读 `task.spec.cumulativeBudget`）。
- 写失败不炸委派路径：`write()` 吞异常、记 `lastWriteError`、每实例只 warn 一次。
- 两个挂载点：`TaskStoreOptions.onPersist`（`create()` + `touch()`）与 `index.ts` 里 `task.usage = usage` 之后的 `store.persist(task)`。
- `OrchestratorDeps.ledgerDir` 仅在「设了 ledgerDir 且没注入 store」时构造 sink。
- 不碰 `usage.jsonl`；本轮不读回。

### Planner 独立核验（不采信执行者报告）

- **空转审计 48/48**：A1–A33、T1–T6、C1–C9 逐条施加针对性变异，逐条定位到目标断言行才算数。
  驱动脚本 `p16-probe/r075-vacuity-audit.py`，日志 `p16-r075-planner-vacuity.log`。
  其中 A19 首次判 VACUOUS 是**我的变异写错了**：把 `writeFileSync` 换成 `appendFileSync`，
  而 node 的 `fs.appendFileSync` 会经由导出的 `fs.writeFileSync` 派发，被测试的 spy 照样记到，
  行为上完全等价。改成「删掉临时写调用」后 A19 CAUGHT。
- **验收四条**（`slot cpu` 串行，日志 `p16-r075-planner-acceptance.log`）：
  typecheck=0；`npm test` 16 个 suite 全 PASS，仅 `naming.test.mjs` 因
  `extension install is missing ledger-store.ts` 失败（分支未上 main 的既有闸门，非本轮引入）；
  `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 test:e2e`=0；`git diff --check`=0。
- **落盘副作用**：仓库根出现过空的 `planner-only/` 与一批 `.planner-only-ledger-*`，
  经查是**我自己变异跑**（`m_orch_cwd` 把 sink 指向 `process.cwd()`）留下的残渣，已清除。
  干净跑一遍 ledger-store / task / architecture / index 四个 suite，不新增任何遗留目录，
  cwd 下也搜不到任何 ledger 快照。`.planner-only-test-*` 最早可追到 2026-09-05，非本轮引入。

### 对执行者提出的 8 条的裁决

1. **D2 正则放行 `..` / `.` / `foo..bar`，与我验收第 6 条冲突** —— 采纳执行者，D2 胜出。
   真正要守的不变量是「不含路径分隔符」：`..` 不带分隔符时只能生成 `...json` 这类同目录文件名，
   逃不出 ledger 目录。A9/A10/A11 已证明带分隔符的一律 throw。我的验收第 6 条措辞过严，作废。
2. **D6「既有测试不会开始落盘」被违反（`index.test.mjs`）** —— 是**我的工单写错了**，不是 bug。
   该测试本来就用真工厂 + 真 `PI_CODING_AGENT_DIR` 跑，落盘正是本轮要实现的行为。
   我已核实：`isolatedAgentDir = mkdtempSync(join(process.cwd(), ".planner-only-test-"))`，
   在仓库内、不在 `/tmp`，已被 gitignore，且测试结束 `rmSync` 清干净（实测前后目录数不变）。
   D6 真正要守的「既有测试一个字都不用改」成立：`index.test.mjs` 本轮未被修改。
3. **`naming.test.mjs` 只报一个缺失文件** —— 属实，循环首个失败即中止。既有闸门，分支上 main 前不可能过。
4. **用 `createRequire` 取 `fs`** —— 接受。ESM 命名空间在 Node v24 冻结，不这样 A18–A24 的原子性断言无从下手。
   代价是生产模块的 import 写法被测试需求绑架，记在下面的遗留项里。
5. **`lastWriteError` 是粘的（成功后不清零）** —— 真问题，但属于 16-b。见遗留项。
6. **临时文件名 `.tmp-<pid>-<seq>` 没断言 seq 递增** —— 低价值，记入遗留。
7. **`TaskStore.persist()` 吞异常，而非法 taskId 仍从 `write()` 抛出** —— 属实，即生产路径上那个 throw 不可观测。
   无害，保留（对直接调用方仍然响亮失败）。

### 本轮引入的遗留项（16-b 之前必须决策）

- **`lastWriteError` 粘性**：一次瞬时写失败会让 16-b 的「余额不可信」永久拉响。
  16-b 要么在成功写入时清零，要么改记「最后一次成功写入时间」。
- **`warn()` 的一次性配额被非法 taskId 抢占**：`write()` 两条失败路径共用 `this.warned`，
  先来一个非法 taskId（无害）就会让之后真正的磁盘故障静默。16-b 落地「余额不可信」提示前要拆开。
- **每次 `touch()` 都同步全量写盘**：`TaskRecord` 含全部 reports/reviews/snapshots，
  而 `touch()` 在每次 transition/report/review 上触发，`syncUsage` 更是每个工具调用都可能走。
  长 Task 上这是委派热路径上的同步 I/O，需要脏标记或节流。
- `createRequire("fs")` 的测试耦合（见上第 4 条）。

## 分期落地：16-b 回放与损坏判定 —— p16-r077 派工前的定稿（planner 实跑得出）

**先做第 1、2 条；第 3、4 条留给 16-c。**

### 缺口已实测坐实（探针 `p16-probe/r077-reload-loses-the-ledger.mjs`）

同一个 `PI_CODING_AGENT_DIR` 上建两个扩展实例，session A 花掉 $0.0400 / $0.05：

```
session A: 费用 已用 $0.0400 / 上限 $0.0500，剩余 $0.0100
盘上快照:  state=changes_requested  usage.children=1  budget={"tokens":200000,"costUsd":0.05}
session B: 整个 Task 不见了（status 只剩 Session usage: tokens=0）
           重新委派同一个 Task → blocked? no
           usageBudget 下传 {"tokens":{"hard":100000},"costUsd":{"hard":0.05}}   ← 又是一整份预算
```

写入侧（16-a）什么都不缺，缺的只有读回来这一半。工单 37 把第一次委派也纳入闸门之后，
**「重载一次换一份满预算」成了绕开累计上限最省事的路径**，所以这条排在 16-c 前面。

### 定稿改法

- `LedgerSnapshotStore.readAll(): { records, corrupt }`。**文件名 stem 是 taskId 的权威来源**
  （损坏文件里读不出 id）；stem 非法、解析失败、`version!==1`、缺 `task`、`task.taskId!==stem`
  一律进 `corrupt`。目录不存在是正常首启，返回空、不 warn。`readAll()` 不修复也不删除。
- `TaskStore.restore(record)`：装进内部 map，**不 touch 不 persist**（装载不是变更），
  已存在同 id 不覆盖。必须是真方法——`tasks` 是 `private readonly`（`task.ts:438`），
  原型里能 `store.tasks.set` 只是因为 strip-types 不做运行时封装。
- `session_start` 装载一次（`index.ts:903` 的 `loadSessionUsage` 之后）。
- **在途预留一律不恢复**：上一轮会话的子进程已随进程消失，恢复预留等于凭空占住余额。
- 损坏 → `untrustedBalances: Map<taskId, reason>`，**按 taskId 生效不是全局**；
  该 Task 的受控付费委派被拒，理由必须与 `cumulativeBudgetRefusal` 明确区分
  （用户要能分清「花超了」和「账不可信」）；reviewer 依旧豁免（同工单 37 的理由）；
  status 里该 Task 不再把「剩余」当可信数字展示。

### 遗留项的处置（上面四条，本轮一次性了结）

1. **`lastWriteError` 粘性** —— 改成按 taskId 记写健康度（该 taskId 写成功即清），
   `lastWriteError` 降级为纯诊断字段。16-b 做。
2. **`warn()` 配额被非法 taskId 抢占** —— 拆成两个配额。非法 taskId 那条本来就 `throw`，
   已经足够响亮，不该消耗 I/O 那一次 warn。16-b 做。
3. **每次 `touch()` 同步全量写盘** —— **不做节流，此项就此关闭**。实测
   （`p16-probe/r077-touch-write-cost.mjs`，本机 NVMe，每档 200 次取均值）：

   | reports | 快照大小 | 每次 persist |
   |---|---|---|
   | 0 | 1026 B | 0.097 ms |
   | 3 | 5162 B | 0.086 ms |
   | 10 | 14837 B | 0.102 ms |
   | 30 | 42497 B | 0.156 ms |

   委派本身是秒级的，0.1 ms 可忽略；而脏标记/节流的失败模式是**丢写**，对账本更糟。
4. **`createRequire("fs")` 测试耦合** —— 保留，记为既有负债，不在 16-b 处理。

### 验收上的一个坑

恢复后闸门夹出来的余额是 `0.010000000000000002`（$0.05 − $0.04 的浮点残差，
`p16-probe/r077-restore-shape.mjs` 实测）。**断言必须用容差，不许写 `=== 0.01`，也不许 round 掉。**

---

## 落地记录：16-b p16-r077（执行者 cursor `w2E:pE`，planner claude-pD 独立复核）

**改了什么**（`HEAD=ca091c4` 之上，9 文件未提交时复核）：`ledger-store.ts` 导出 `SAFE_TASK_ID`、
新增 `readAll()`（返回 `{records, corrupt}`，六类损坏各带 reason，一律不修不删）、
把黏性 `lastWriteError` 换成按 taskId 的 `writeErrors` + `writeErrorFor()`；
`task.ts` 新增 `restore()`（装快照不 `touch()`、内存记录优先）；
`index.ts` 在 `session_start` 里 `loadSessionUsage(ctx)` 之后调 `restoreFromLedger()`；
`orchestrate.ts` 新增 `restoreFromLedger()` / `untrustedBalances` / 占位记录 / untrusted 闸门 /
status 的「余额不可信」分支。

**planner 侧独立复核（全部自己重跑，不采信报告）：**

1. `slot audit` / `slot status` 见 `p16-r077-planner-slot.log`。审计发现绕过 slot 的
   `htvc`（PID 544117，RSS 19.0→19.6G），**未终止**，按规则只把自己的命令串行走 `slot cpu --`。
2. 四条验收全部复现（`p16-r077-planner-acceptance.log`）：typecheck=0；`npm test` 16 个套件 PASS，
   只剩 `naming.test.mjs` 卡在「install 缺 ledger-store.ts」（分支未并 main 的既有闸门）；
   `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 test:e2e`=0；`git diff --check`=0。
3. 实测 A / 实测 B 原样重跑，逐字复现：重载后 Task 回来了，已用 $0.0400 / 剩余 $0.0100，
   clamp `0.010000000000000002`；损坏的 `T-20260908-961` 判「余额不可信」且受控委派被拒
   （理由不是 cumulative budget exhausted），完好的 `T-20260908-962` 不受影响。
4. **逐条空转审计 66/66 CAUGHT**，驱动是我自己写的 `p16-probe/r077-vacuity-audit.py`
   （与执行者的 `r077-executor-vacuity.py` 相互独立），逐字输出见
   `p16-r077-planner-vacuity-final.log`。审计前后 `md5sum -c p16-r077-planner-freeze.md5` 全部 OK。

**但复核中我实跑发现了本轮引入的一个更大的洞（阻塞项，见 §落地记录：16-b′）**，
所以 16 的两个 checkbox **本轮不勾**，改动先留在工作区/分支上，等 p16-r078 补丁落地后一起结。

### 16-b′：损坏快照被占位记录洗白（planner 实跑，探针 `p16-probe/r077-planner-corrupt-laundering.mjs`）

链条：账本文件损坏 → `restoreFromLedger()` 装一条 `untrustedPlaceholder()` 活记录 →
reviewer（按设计豁免 untrusted 闸门，合理）动它一下 → `touch()` → `persist()` →
**把损坏字节覆盖成一份格式合法、usage 归零、`spec` 缺失的占位快照** → 下一次会话它「不损坏」了，
`untrustedBalances` 为空，Task 重新变可信；又因为占位记录没有 `spec.cumulativeBudget`，
整段闸门被跳过。实测逐字：

```
  still corrupt (non-JSON)? false
  C: worker delegation blocked? no
  C: usageBudget handed to the child: {"tokens":{"hard":100000},"costUsd":{"hard":0.5}}
```

**$0.5 是这个 Task 整份预算 $0.05 的十倍**，正是工单 37 刚修掉的量级；
而且损坏的原始字节被覆盖，人事后也救不回来。修法（隔离名单，写入侧硬拦，只在内存里、不落盘）
写在 `p16-r078-handoff.md` D1–D3。

### 审计方法上踩到的坑（我自己的驱动，记下来免得下次再犯）

- **中和「先变红的那条断言」不能靠注释掉它**：按行注释会跨过 `try {` 把文件写坏（读出来像 UNATTRIB）；
  更隐蔽的是 `assert.deepEqual(orch.restoreFromLedger(), …)` 把**被测调用写在断言参数里**，
  一注释连副作用一起没了，后面依赖它的断言反被判成空转。改成把 `assert.xxx(…)`
  换成「照常求值参数、吞掉结果」的代理后，两个坑同时消失。
- **失败行不能取输出里第一个 `file:line`**：断言的 `actual` 是 Error 对象时，
  node 会把那个对象的 stack 也打进 diff，第一个匹配到的是错误**构造**处（B21/B22 被误判到注入的
  `throw new Error("disk full")` 桩上）。要先锚定错误头，跳过 `+`/`-` 的 diff 渲染，再取第一帧。
- **变异要跟断言的语义一样窄**：`if (true || …)` 把每个 Task 都标成不可信（L9d 中和 30 次也到不了目标）；
  「每次 I/O 失败都重抛」会先把 A14/A18 那个块打爆，而那块的失败点是桩里的裸 `throw`，无断言可中和——
  换成「只有黏性错误来自非法 id 时才重抛」，B18 立刻 CAUGHT。
- **同毫秒重写是等价变异**：`writtenAt`/`updatedAt` 只有毫秒精度，
  「原样 persist 一遍」写出的字节可能一模一样（L12/L12a 都栽在这上面）。变异要写入一个**不同**的值。
- **`str.replace` 不加断言就是静默失效**：我给 `neutralise()` 补 `return True` 的那次 patch 没匹配上，
  函数返回 `None`，于是所有需要中和的用例统一报「无法中和」（58/66）。补上断言后重跑才是 66/66。
