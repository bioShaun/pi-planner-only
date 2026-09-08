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
