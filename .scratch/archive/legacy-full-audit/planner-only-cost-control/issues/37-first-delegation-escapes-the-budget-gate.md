# 37: 一个 Task 的第一次委派完全绕过累计预算闸门

**What to build:** 创建 Task 的那次委派必须和后续委派一样，先过 14A 的检查—预留，
再把余额并进该子进程的 per-call `usageBudget.hard`。

**Blocked by:** 14、15（已 done）。

**Status:** done（p16-r076 落地，planner 独立复核通过；行号勘误见 §E.5）

- [x] 第一次委派会预留额度，status 的 `在途预留` 行看得见它。
- [x] 第一次委派拿到的 `usageBudget.hard` 受累计余额约束，不会超过 Task 的整份预算。
- [x] 第一次委派拿到 grant，因此它的 Usage 缺失时按工单 15 记有界负债。
- [x] 已存在的 Task（`task start` 建的、或将来回放恢复的）行为不变。

## Comments

2026-09-08（planner claude-pD，实跑发现，探针 `p16-probe/r075-first-delegation-ungated.mjs`）：

`beginDelegationInner` 里那段检查—预留的入口条件是 `budgetTask = target?.task`
（`orchestrate.ts:727-733`）。但**创建 Task 的那次委派，走到这一行时 store 里还没有这条记录**——
记录要到 `orchestrate.ts:1000/1005` 的 `store.create()` 才出现。于是整段被跳过：
不检查、不预留、不盖 grant，`resolveEffectiveLimits` 也拿不到 `balanceTokens/balanceCostUsd`。

实测（`cumulativeBudget: { tokens: 200000, costUsd: 0.05 }`）：

```
usageBudget handed to call-first:  {"tokens":{"hard":100000},"costUsd":{"hard":0.5}}
first delegation blocked? no
在途预留 present after 1st? false
usageBudget handed to call-second: {"tokens":{"hard":100000},"costUsd":{"hard":0.5}}
second delegation blocked? YES: Planner-only guard: task T-20260908-902 cumulative budget exhausted (costUsd).
```

**第一个子进程拿到的单次硬上限是 $0.50，而整个 Task 的累计预算是 $0.05——十倍。**
闸门要到第二次委派才开始工作。对**只委派一次**的 Task（最常见的形态），
`cumulativeBudget` 等于完全没生效。

另有两个次生后果：

- 第一个子进程没有 grant，Usage 缺失时 `grantedDebt` 返回 `{}`，工单 15 的有界负债对它是空的
  （实测：错误形状的 usage 被记成「费用未知 1 项」，金额 0）。
- D4 的 `在途预留` 行对它不显示，用户看不到这笔在途。

**改法已定稿**：方案 B′，写在 `design-15-16-decisions.md` §E。要点：

- 预留点不动，补上 `target?.task` 为空时用 `targetSpec.cumulativeBudget` + 空 usage 现算 budget 的分支；
- 加 `BudgetReservations.rekey(from, to, toolCallId)`，在 `shouldReplaceTaskId` 分支
  `store.create(storedSpec, spec.taskId)` 之后改键——否则预留会挂到别名上永久泄漏，
  且 `inFlight(真 taskId)` 看不见它，比不预留更糟。

**工单初稿里的方案 C 描述是错的，已在 §E.2 更正**：`beginDelegation` 就是 `tool_call` 钩子，
建完 Task 再预留仍然是启动前。但 C 有另一个真问题——`orchestrate.ts` 的 828、886、936
是**成功启动**的早退路径，走不到 `ensureCwd`，整段往后挪会把它们现有的预留弄丢。

派工前欠的那次实跑核验已做，见 §E.4：形状一致，且顺带坐实第一次 reserve 的 grant 被夹到整份 Task 预算、
第二次 reserve 直接 refused。**闸门已解除。**

---

## 落地记录：p16-r076（执行者 cursor `w2E:pE`，planner claude-pD 独立复核）

**改了什么**（`HEAD=90e3b23` 之上，diff 共 6 文件 / +257 −10）：

- `reservations.ts` +21：新增 `rekey(fromTaskId, toTaskId, toolCallId)`。
  `from === to`、源 Task 无预留、该 `toolCallId` 不在源里，三种情况都是 no-op；
  搬走后源 map 空了就把 Task 键一起删掉。
- `orchestrate.ts` +19：`budgetTask` 为空且 `spec.cumulativeBudget` 是对象时，
  用 `emptyTaskUsage()` + 该预算合成一个 `firstDelegationTask`（`orchestrate.ts:741-744`），
  闸门改读 `gateTask = budgetTask ?? firstDelegationTask`；
  `role !== "reviewer"` 的豁免原样保留；
  `store.create(storedSpec, spec.taskId)` 之后立刻 `rekey`（`orchestrate.ts:1016-1017`）。
- `orchestrate.test.mjs` +192（R1–R6b、Z1、Z3–Z15），`architecture.test.mjs` +7（C37-1..6）。

**planner 侧独立复核**（不采信执行者报告，全部自己重跑）：

1. `slot audit` / `slot status` 见 `p16-r076-planner-slot.log`。
   审计发现一个绕过 slot 的 `postsort`（PID 459084，RSS 11.9G），**未终止**，
   按规则只降低自身并发：本轮全部命令串行走 `slot cpu --`，未动 `slot slots`。
2. **逐条空转审计 27/27 CAUGHT**，驱动是我自己写的
   `p16-probe/r076-vacuity-audit.py`（与执行者的 `r076-executor-vacuity.py` 相互独立，
   变异各写各的），逐字输出见 `p16-r076-planner-vacuity.log`。
   审计前后 `md5sum -c p16-r076-planner-freeze.md5` 四个文件全部 OK，变异已全部还原。
3. 四条验收全部自己重跑（`p16-r076-planner-acceptance.log`）：
   typecheck=0；`npm test` 16 个套件全 PASS，只剩 `naming.test.mjs` 卡在
   「install 缺 ledger-store.ts」（分支未并 main 的既有闸门，与本轮无关），exit=1；
   `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 test:e2e`=0；`git diff --check`=0。
4. 基线探针 `p16-probe/r075-first-delegation-ungated.mjs` 我自己重跑，逐字复现：
   `usageBudget handed to call-first: {"tokens":{"hard":100000},"costUsd":{"hard":0.05}}`
   （修复前是 `0.5`，十倍），`在途预留: tokens=100000, 费用 $0.0500（1 个子进程未回执）`，
   `first delegation blocked? no`，`在途预留 present after 1st? true`。四条验收项逐条对上。
5. 我自己另写了一条探针 `p16-probe/r076-planner-block-after-reserve.mjs`，
   查「预留之后、delegation 记录之前」的 block 路径会不会漏预留——
   结论是不会，`beginDelegation` 的 `finally`（`orchestrate.ts:656-669`）兜底，详见 §E.5。

**审计里两条值得记的观察：**

- **Z8 的 `neutralised=[]`**：把 `role !== "reviewer"` 豁免拿掉（反向变异）之后，
  整个 `orchestrate.test.mjs` 里**第一条**红的就是 Z8。也就是说这条豁免此前
  **没有任何断言覆盖**——V10 空转事故正好发生在同一处语义上。Z8 补上了这个洞。
- **R5 的证明只对得住不变量，对不住那行 `if`**：把 `if (fromTaskId === toTaskId) return;`
  直接删掉是**等价变异**（源 map 即目标 map，delete 之后 size 为 0 会连键一起删，
  接着又原样 set 回去，净效果相同），suite 照样全绿。R5 是被
  「同 id 时把预留丢掉」这个变异抓住的。结论：R5 钉的是「同 id 不丢预留」这条不变量，
  不是那行早退语句本身——那行在当前实现里确实是冗余的防御。

**我自己在审计驱动里犯的三个错（与执行者的断言无关，记下来免得下次再犯）：**

1. C37-4 首轮报 VACUOUS：我的变异写成
   `import { emptyTaskUsage as blankUsage }`，`emptyTaskUsage` 这个字面量**还留在 import 行上**，
   而断言是 `assert.match(orchestrate, /emptyTaskUsage/)` 的纯文本匹配，当然照过。
   改成在 `usage.ts` 里另起别名、让 `orchestrate.ts` 里完全不出现该字面量后立刻 CAUGHT。
2. Z15 报 UNATTRIB（`SyntaxError`）：中和是按行加 `//` 前缀的，
   碰上跨行的 `assert.equal(...)`（如 2060-2067）只注释掉首行就把文件写坏了。
   改成整条语句一起注释。
3. 改完第 2 条又把 C37-5 弄成 VACUOUS：括号配平没有排除正则里的转义括号
   （`/this\.reservations\.rekey\(/g`），一路把后面的断言也吞掉了。排除 `\(` `\)` 后修好。

**同时被这轮证伪、已在 §E.5 更正的、我自己工单里的错**：
`orchestrate.ts` 三处 `store.create` 的行号（727-733 / 1000 / 1005 / 1067 / 564 / 828 / 886 / 936
全部漂移）；「1067 处入库 id 就是 `spec.taskId`」（实为 `createTaskSpec` + `nextTaskId`）；
「新 Task 检查那一半必然通过」（只对真正全新的 Task 成立）。
另外 `p16-probe/r075-first-delegation-ungated.mjs` 的文件头原本把自己写成
「Ticket 15-b clause 2」，是我起名时的笔误，本轮已改（只动注释，不动探针逻辑）。

**新增 backlog（本轮不做）：**

- 被闸门拒绝的那次委派，`input.usageBudget` 上仍留着上游盖的未夹紧值。该 tool_call 被 block、
  不会启动，只是残留字段，但对读 hook 输入做排障的人是个误导。
- `rekey` 只搬 `held`，没有对应的「别名 → 正式 id」的可观测记录；
  将来做回放（16-b/16-c）时若要复原在途预留，需要另一份来源。
