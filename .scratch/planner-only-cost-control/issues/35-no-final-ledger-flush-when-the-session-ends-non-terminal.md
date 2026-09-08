# 35: 会话在 Task 非终态下结束时没有兜底落账，最后一段子代理全丢

**What to build:** 这是原工单 29 的 (b) 半张，拆出来单独派活（(a) 半张走 round p12-r058）。

08 第五次重跑：账本最后一条写于 `01:09:36Z`，进程跑到 `01:30:33Z`。
这 21 分钟里又跑了 7 个子代理（**$0.02227**），一条都没进账本。

**机制已定位。** `flushIfTerminal`（`index.ts:436`）开头就是
`if (!after || !isFinalTaskState(after.state)) return;` —— Task 不在终态直接返回。
它的五个调用点（`index.ts:743 / 869 / 922 / 1048 / 1113`）全在事件处理路径上。
于是只要 Task 一直没走到终态，账本就再也不写了，进程退出时也没有任何兜底。

**关键的未知项，planner 已经查清并钉死（原工单让执行者自己查，现在不必了）：**

`index.ts:782-786` 已有一个 `session_shutdown` 钩子，函数体只有 `restoreSuppressedTools()`，
注释写的是「A reload tears down this instance...」—— 只考虑了 reload。
但在**当前安装的宿主版本 `@earendil-works/pi-coding-agent` 0.84.4** 上，
这个事件的覆盖面远不止 reload：

- `dist/core/extensions/types.d.ts:477-483` —— 事件带 `reason`，取值
  `"quit" | "reload" | "new" | "resume" | "fork"`，注释「Fired before an extension runtime is
  torn down due to quit, reload, or session replacement」。**`quit` 就是正常退出。**
- `dist/core/extensions/runner.d.ts:65` —— `emitSessionShutdownEvent(...): Promise<boolean>`，
  返回 Promise，**handler 是被 await 的**，所以在里面做异步落账能跑完。
- CHANGELOG 佐证：`:2317` print/JSON 模式退出前也会 emit；`:1996` 与 `:1239`
  SIGHUP／SIGTERM 在 interactive／print／RPC 模式下都会 emit；`:1748` `/quit` 在进程退出前 emit。

**所以兜底落账挂在这个已有钩子里是可行的**，且能按 `reason` 区分 quit 与 session 替换。
现有 handler 目前不接收事件参数（`async () => {...}`），需要改成接收。

**Blocked by:** None。建议排在原工单 29(a)（round p12-r058）之后，两者都动账本路径，
但改的不是同一段代码；若 (a) 已落地，先 rebase 到它上面。

**Status:** done

- [x] 会话在 Task **非终态**下结束时，仍写出一条最终账本记录，且带明确的非终态标记
      （不要伪装成终态）。
- [x] 该记录的 children 覆盖本次会话产生的全部 `*_meta.json` runId。
- [x] 不变量测试：`usage.jsonl` 末条 children 的 runId 集合 ⊇ 该会话 `<SA>` 目录中
      `*_meta.json` 的 runId 集合。**修复前该用例必须失败**，回执贴出失败输出原文。
- [x] 不重复计数：同一 runId 只出现一次。既有的 exactly-once 用例
      （`index.test.mjs:3462-3517`，注释标 `p11-r052`）一行不改仍然全绿。
- [x] `reason` 的处理要说明理由：哪些 reason 该落账、哪些不该
      （例如 `reload`/`new` 是会话替换，替换后的实例可能会接着写，重复落账的风险要自己论证）。
- [x] Task 已经在终态、`flushIfTerminal` 已经落过账的情形，不得因为兜底再写一条重复记录。
- [x] **（从工单 29 移交）幽灵 taskId 的费用不得永远落不了盘。**
      未绑定 validator 在「同 cwd 没有任何活动 Task」时，挂账键是合成的
      `unbound-validator-<toolCallId>`。planner 实测（`p12-verify-r058/ghost-cost.mjs`）：
      费用**在内存账本里是在的**（该 ghost id 下 `children: 1`、`costUsd 0.058`），
      但 `flushIfTerminal`（`index.ts:436-449`）第 443-444 行
      `const after = orchestrator.store.get(taskId); if (!after || !isFinalTaskState(after.state)) return;`
      对 store 里不存在的 id 直接早退，于是它永远进不了 `usage.jsonl`。
      本票有权改 `index.ts`/`usage.ts`（工单 29(a) 的 fence 排除了它们，这是那一轮没能收口的原因）。
      要求：这笔钱要么落盘成一条带明确「未归属」标记的记录，要么有其它可检查的去处；
      **不接受静默消失**。
- [x] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。
原始出处：工单 29 的 (b) 半张，来源是 08 第五次重跑 `phase-a-08-run5`（2026-09-08）。

**优先级：阻塞第六次 08 重跑。** 08 条款 14 是硬条件；run5 实测漏记
$0.27450360，占实际总支出 $0.78197 的 **35.1%**，其中 (a) 占缺口 92%、本票占其余部分。
对一个以「省 token」为核心目标的专题，账本不全就等于省下来的钱量不出来。

拆票理由（planner，2026-09-08）：原工单 29 两个缺陷互相独立 —— (a) 是挂账目标写错（改动小、
边界清楚），(b) 是落账时机缺兜底（要动生命周期钩子、要论证重复落账）。
合成一轮会产出一份读不完的 diff，且 (b) 的论证会被 (a) 的琐碎挤掉。

宿主事件语义是 planner 在 `node_modules` 里实读 0.84.4 的 `.d.ts` 与 CHANGELOG 核实的，
不是从文档或记忆里抄的。若将来升级宿主版本，这段结论要重新核。

round_id=p12-r058（拆票并钉死宿主事件语义）

---

2026-09-08 planner 派活前核验（round_id=p13，派活在 p13-r059 之后）。在 `25e632b` 上重跑一遍行号：

- `flushIfTerminal` 定义 `index.ts:436`，早退在 **`:444`**（`if (!after || !isFinalTaskState(after.state)) return;`）——
  原文记 443-444，实际是单行 `:444`，前一行 `:443` 是 `const after = orchestrator.store.get(taskId);`。
- 五个调用点仍是 `index.ts:743 / 869 / 922 / 1048 / 1113`，未位移。
- `session_shutdown` 钩子仍在 `index.ts:782-786`，函数体仍只有 `restoreSuppressedTools()`，
  签名仍是 `async () => {}`（不接事件参数）。
- **`p11-r052` 的 exactly-once 用例已位移到 `index.test.mjs:3441-3496`**（工单 29(a) 在它前面
  插了 69 行）。票里原记的 3372-3427 已改正。它紧邻的上一块 `3400-3439` 是 29(a) 新增的
  未绑定 validator 落盘用例，本票同样不得改动。
- 宿主版本实测仍为 **0.84.4**（`node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version"`），
  票里那段事件语义结论继续有效。

round_id=p13（派活前核验，行号重钉）

2026-09-08 二次重钉（工单 30 落地 `88a4eb6` 之后，派活 round_id=p13-r060 前）：
`index.ts` 的全部行号未动（`flushIfTerminal` 定义 `:436`、早退 `:444`、
调用点 `743/869/922/1048/1113`、`session_shutdown` `:782-786`），
但 **`p11-r052` 的 exactly-once 用例又下移了 21 行 → `index.test.mjs:3462-3517`**
（工单 30 在 `:3004` 之后插了 21 行）。29(a) 的未绑定 validator 落盘用例现在在 `3421-3460`，
同样不得改动。**执行者动手前请自己 `grep -n "p11-r052" index.test.mjs` 复核。**

round_id=p13-r060（派活前核验）

2026-09-08 planner 验收（round_id=p13-r060，执行者 w2E:pE / cursor）：**接受并提交。**

执行者的路线：`session_shutdown` 改成 `(event, ctx)`，按 `reason` 决定是否落账
（新增 `usage.ts:759 shouldFlushUsageOnShutdown`）；落账走新的
`flushOpenUsageOnShutdown`（`index.ts:509`），先 `harvestOrphanMetas` 把账本没见过的
`*_meta.json` 收进来，再对「账本里有、store 里没有」的挂账键写 `unattributed:true`，
最后对每个非终态 Task 写 `incomplete:true`。去重用 `terminalUsageLogged`/`openUsageLogged`
两个 Set（`index.ts:181-182`），在 `writeUsageLog` 开头拦截重复快照。
改动量：`index.ts` +97/-10、`usage.ts` +12/-0、`index.test.mjs` +146/-1（那一处删除只是 import
行加上 `readdirSync`）、`usage.test.mjs` +11/-0。

planner 在自己 pane 里逐条复现（不是采信回执）：

- **fence 完好。** `orchestrate.ts` / `task.ts` / `types.ts` 与冻结快照
  `p13-r060-35-freeze-md5.txt` 逐字节一致（`623f4354…` / `875ba9d0…` / `6a8cf4dc…`）。
- **既有用例未被动过。** `index.test.mjs` 新代码全部追加在 `:3616` 之后，
  `p11-r052` 的 exactly-once 块（`:3462`）与 29(a) 块（`3421-3460`）一行未改。
- **RED 独立复现，且与交付的测试一致**（工单 30 那轮回执贴的是过时 RED，这轮特意加了要求）：
  只回滚 `index.ts` + `usage.ts`，`index.test.mjs:3668` 报
  `usage.jsonl last children runIds [] does not cover meta runIds ["r060-inv-meta"]`，exit 1；
  逐字节还原后 md5 与交付态一致（`index.ts c8f3d490…`、`usage.ts 8b856300…`）。
- **四条验收命令**（`slot cpu -- npm run typecheck && npm test && npm run test:e2e && git diff --check`）
  一次跑通，exit 0，17 个测试文件全 PASS。日志 `p13-r060-verify-accept.log`；
  slot 预检 `p13-r060-verify-slot-audit.log` / `p13-r060-verify-slot-status.log`：
  发现绕过 slot 的 `pbbwa`（PID 3917509，RSS 47.2G，CPU 1844%），按规则未终止。

**宿主语义独立核对（不是采信回执，也不是抄文档）** —— 实读 0.84.4 的 `dist/core`：

| reason | 宿主实现 | 该不该落账 | 实测 |
|---|---|---|---|
| `quit` | `agent-session-runtime.js:288-294` `dispose()` emit 后即 `session.dispose()`，进程结束 | 该 | 落 1 条 |
| `new` / `fork` / `resume` | `teardownCurrent(reason, targetSessionFile)`（`:102`，调用点 `:136/:160/:206/:224`）带**新的** session 文件 | 该 | 各落 1 条 |
| `reload` | `agent-session.js:2213` emit `reason:"reload"`，**不带** `targetSessionFile`；同一 session 文件继续用 | 不该 | 落 0 条 |
| 缺 `reason` | 0.84.4 三个 emit 点都带 reason，无活路径 | 保守不落 | 落 0 条 |

`reload` 这条最容易搞错，planner 追到底了：`reload()` → `_resourceLoader.reload()` →
`clearExtensionCache()`（`extensions/loader.js:119`）把 generation 加一 → `loadExtensionModule`
用 jiti（`moduleCache:false`）重新 import → `initializeExtension` 重新调一次工厂函数，
**扩展实例是全新的，闭包里的 ledger / 两个 Set 全部清空**。所以执行者回执里
「reload 后 Set 清空、后继再 quit 会重复写」这句话，其结论对、给的理由不完整：
真正让 reload 不落账仍然安全的是 `_buildRuntime` 之后 emit 的
`session_start reason:"reload"`（`agent-session.js:2230`）会走本插件的 `loadSessionUsage`，
从**同一个 session 文件**里把已持久化的 `planner-only-usage` entry 重新 `ledger.load` 回来——
后继实例带着全部旧 children，自己 quit 时写的那条快照就已经覆盖了 reload 前的花费；
此时若 reload 也写一条，两条快照的 runId 会重叠，正好违反本票条款 4。
反过来 `new`/`fork`/`resume` 换了 session 文件，`loadSessionUsage` 读不到旧 entry，
不当场落账就是永久丢失——所以这张表的四行都成立。

**planner 自写探针**（`p13-verify-r060/shutdown-matrix.mjs`，自建 pi stub，不复用
`index.test.mjs`；每个场景独立进程，扩展状态互不污染）：

| 探针 | 输入 | 结果 |
|---|---|---|
| quit-open | 非终态 Task + 账本没见过的 `p01-orphan_oracle_meta.json`（cost 0.0432） | 落 1 条，`incomplete:true`、`state:"executing"`、children 含 `p01-orphan`，**`costUsd 0.0432` 真的在行里** |
| reasons | 同一场景分别送 quit/new/fork/resume/reload | 前四个各 append 1 条，reload append 0 条 |
| no-reason | `{}`（无 reason） | append 0；随后再送 quit → append 1（没有把钱吃掉，只是推迟到真正的 quit） |
| double-quit | 连送两次 quit | 仍只有 1 条，全部 runId 无重复 |
| terminal | Task 走到终态由 `flushIfTerminal` 落过账，再 quit | 该 taskId 仍只有 1 条，且 `incomplete` 为 false（条款 6） |
| ghost | 未绑定 oracle（cwd 无任何活动 Task），回执带 0.058 | shutdown 前账本 0 条；quit 后落 1 条 `taskId:"unbound-validator-call-p05-ghost"`、`unattributed:true`、`incomplete:true`，**children[0].costUsd 0.058 落盘** |

最后一行就是条款 7 从工单 29 移交过来的那笔钱：p12 那轮实测它「在内存里有、永远进不了
`usage.jsonl`」，这轮实测它到盘了，且带着明确的未归属标记。

**留档的三点：**
① `harvestOrphanMetas` 把账本没见过的 meta 挂到 `store.active()`（没有活动 Task 时挂到字面量
`"unattributed"`），所以孤儿 meta 可能被挂到「当时恰好活着的那个 Task」名下——金额不丢，
但归属可能不准；本票要的是「不静默消失」，这个取舍是对的，归属精度另说。
② `reload` 依赖的是**已持久化**的 entry：`persistSessionEntries()` 只在若干生命周期点调用，
reload 那一刻尚未 drain 的 entry 仍会丢。这不是本轮引入的（改前 reload 同样什么都不做），
不算回归，但将来要收口的话就在这里。
③ 本票只兜 `session_shutdown` 这一条路径；进程被 SIGKILL 之类打断时宿主根本不会 emit，
那种情况仍然没有兜底。

round_id=p13-r060
