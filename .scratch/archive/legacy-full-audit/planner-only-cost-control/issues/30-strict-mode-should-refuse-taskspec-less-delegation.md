# 30: 严格模式下无 TaskSpec 的委派应被拒绝，而不是造占位 Task

**What to build:** 工单 03 有意允许「委派文本没有任何 TaskSpec 特征字段 → 创建占位 Task 并在结果首行告知」，那是宽松模式下的合理兜底。但 08 条款 7 要求一次合格运行里 `Placeholder task` 计数为 **0**，两者的落点不同：03 管插件遇到空委派怎么办，08 管 Root 不该发空委派。run5 里 Root 从头到尾没嵌过 TaskSpec，第一个 worker 拿到的是没有 objective／scope／acceptanceCriteria 的空壳，整条评审链挂在一个「无目标」的 Task 上跑了 50 分钟。要求：`PI_PLANNER_ONLY_REQUIRE_REVIEW=1` 时，没有任何 TaskSpec 特征字段的委派**直接拒绝**并说明缺什么，不创建占位 Task；不设该变量时，03 的占位行为逐字不变。

**Blocked by:** None（源码在 `0fe04df`；与 03 的关系见下）。

**Status:** done

- [x] **严格模式（`PI_PLANNER_ONLY_REQUIRE_REVIEW=1`）下，无 TaskSpec 的 worker 委派被拒**：
      `beginDelegation` 返回 `{ block: { reason } }`，**store 里没有新建任何 Task**
      （断言 `store.list().length` 相对调用前不变，且没有 `isPlaceholder` 的记录），
      并且要有一条走**真实 `tool_call` 处理器**的 `index.test.mjs` 用例，断言它返回
      `{ block: true }`、子进程未启动。仅在 `orchestrate.test.mjs` 里断言不够 ——
      「未启动子进程」这一条只有宿主路径能证。
- [x] **拒绝文案自洽**：文案指名真正生效的开关（严格模式），并列出需要嵌入的字段
      （至少 `objective`／`scope`／`acceptanceCriteria` —— run5 的 worker 原话就是这三个全空）。
      现文案那句 `Set PI_PLANNER_ONLY_STRUCTURED_DELEGATION=warn to allow unstructured worker
      delegations.` **在严格模式下是错的**（照做也解不开），严格模式触发时不得原样输出这句。
      `PI_PLANNER_ONLY_STRUCTURED_DELEGATION=strict` 单独触发时的既有文案逐字不变。
- [x] 严格模式下，TaskSpec 合法的 worker 委派行为逐字不变（不 block，Task 照常创建/绑定）。
- [x] **不设**严格模式时，工单 03 的占位路径逐字不变：占位 Task 仍创建，
      6 个发射点（`1569/1596/2015/2061/2104/2142`）的首行告知逐字不变，03 的既有测试一行不改即全绿。
- [x] **oracle／reviewer／explorer／scout 四个非 worker 角色在严格模式下行为逐字不变** ——
      它们本来就不建占位 Task，不得被这次改动顺带 block。
      测试按 `input.agent` 传角色名（`oracle`/`reviewer`/`explorer`/`scout`），不是 `input.role`。
- [x] 特征字段判定仍以 `task.ts:186` 的 `TASKSPEC_CHARACTERISTIC_FIELDS` 为准，不另立一套；
      `DEFAULT_STRUCTURED_DELEGATION_MODE` 保持 `"warn"` 不动。
- [x] `orchestrate.test.mjs:380-388` 现有的两条 `structuredDelegationMode` 断言
      （env=strict 时为 `strict`、默认为 `warn`）一行不改仍然全绿。
- [x] 修复前新增用例必须失败，回执贴出失败输出原文。
- [x] 不勾 03/08 checkbox、不改它们的 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。

来源：08 第五次重跑 `phase-a-08-run5`（2026-09-08）。该轮 `grep -c 'Placeholder task'` 为 **16**（08 条款 7 要求 0）。第一个 worker 的原话：

> No TaskSpec was embedded in this task — the objective, scope, constraints, and acceptance criteria are all empty. Per the planner-only worker contract, I made no code edits.

reviewer 也在 summary 里点出「TaskSpec embedded no explicit objective/scope/acceptanceCriteria, so review is limited to verifying the reported end state」。

**这不是工单 03 的回归。** 03 的第四条验收明写占位路径是有意设计且已实现。本票是把 08 条款 7 的要求落到代码上：门槛级运行不接受空委派。写票时确认过两者不冲突 —— 03 管兜底，本票管严格模式下不兜底。

r4 也踩到过（2 次），当时归因到 `reviewMode` 默认 root，属误判：22 落地后计数不降反升，说明是独立的一条。

round_id=claude-pD-2026-09-08-open-30

2026-09-08 派活前 planner 定位（读源码 + 对 run5 产物核实，不是推测）：

- **占位 Task 的唯一创建点是 `orchestrate.ts:940-944`** —— `this.store.create(createTaskSpec({objective: "(unspecified — parent did not embed a TaskSpec)", cwd}))` 紧跟 `task.isPlaceholder = true`。严格模式的拒绝就加在这里，是本票唯一需要动的判断点。
- 回执文案 `[PLANNER-ONLY] Placeholder task … created (parent did not embed a TaskSpec; canonical id: …)` 在 `orchestrate.ts` 有 **6 个**发射点（1558/1585/2000/2046/2089/2127），全部读 `task.isPlaceholder`。严格模式下若改为拒绝，这 6 处的非严格路径必须逐字不变 —— 工单 03 的占位回退是有意设计。
- **本票与工单 29 是同一条因果链的两端。** r5 里 6 次 oracle 全部走了 `orchestrate.ts:757` 的「未绑定 validator」分支，正是因为 Root 从没嵌入 TaskSpec、委派里没有 Task 可绑；那条分支不设 `accountingTaskId`，于是 oracle 的 $0.25224 全部记到幽灵 Task 上（工单 29(a)）。**30 修好之后 29(a) 的触发频率会大幅下降，但 29(a) 本身仍必须修** —— 未绑定委派在合法场景下依然会发生，不能靠「上游不再产生」来掩盖一个记账洞。两票都要做，顺序 29 在 30 之前不重要，但不得只做 30 就宣称账本修好了。
- 同样地，r5 里 `52e07540` 与 `bf04bce7` 两个 worker 返回散文而非 WorkerReport（`worker output did not contain a WorkerReport object`），两份输出都明说「TaskSpec 里 objective/scope/acceptanceCriteria 全空」。那是本票的下游症状，不是工单 28 的范围。

round_id=p11-r053（补根因）


---

2026-09-08 planner 派活前核验（round_id=p13-r059）。**上面 p11-r053 与 p12-r058 两段的行号全部作废**
（27/28/33/34/29a 落地后位移），且 p12-r058 那段当时误存进了一个重名新文件
`30-strict-mode-refuses-taskspec-less-delegation.md`，已合并进本票并删除。以本段为准。

**行号在 `25e632b` 上重钉：**

- 占位 Task 唯一创建点 `orchestrate.ts:949-959`：`} else {` → `this.store.create(createTaskSpec({
  objective: "(unspecified — parent did not embed a TaskSpec)", cwd }))`，紧跟 `:955` 的
  `task.isPlaceholder = true`。`grep -n "isPlaceholder = true" orchestrate.ts` 全仓只有这一处。
- `[PLANNER-ONLY] Placeholder task …` 的 6 个发射点：`1569 / 1596 / 2015 / 2061 / 2104 / 2142`。
- `TASKSPEC_CHARACTERISTIC_FIELDS` 在 `task.ts:186`，唯一消费点 `task.ts:272`（`matchingFields`，
  判据是 `matchingFields.length >= 2 || (length === 1 && [0] !== "taskId")`）。
- `PI_PLANNER_ONLY_REQUIRE_REVIEW === "1"` 三处读取：`index.ts:1085`、`task.ts:446`、
  **`orchestrate.ts:1183`（调用期读 `process.env`，本票照抄这个写法即可）**。

**本票的实现面比原文小得多 —— 拒绝机制已经存在，缺的只是触发条件。** 实跑核实：

1. `orchestrate.ts:854-869` 已有一条 `if (!spec)` 的守卫，其中
   `role === "worker" && this.structuredDelegationMode === "strict"` 时
   `return { block: { reason: … } }`；`index.ts:810-813` 把它变成 `{ block: true, reason }`
   并 notify `"Blocked unstructured delegation"`。**子进程因此根本不会启动**，
   条款 1 的「未启动子进程」不需要新机制。
2. 该守卫没生效，是因为它读的是**另一个**开关：`structuredDelegationMode` 来自
   `PI_PLANNER_ONLY_STRUCTURED_DELEGATION`（`orchestrate.ts:2154-2158`），
   而 `DEFAULT_STRUCTURED_DELEGATION_MODE` 是 **`"warn"`**（`types.ts:256`）。
   run5 只带了 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1`（见 08 第 43 行的运行记录），
   没带 `PI_PLANNER_ONLY_STRUCTURED_DELEGATION=strict` → 走 warn → 建占位。
   **这就是 16 次 `Placeholder task` 的全部成因。**
3. **只有 worker 会走到占位分支。** planner 实跑探针
   （`.scratch/planner-only-cost-control/p13-probe/roles-reaching-placeholder.mjs`，
   直接调 `beginDelegation`，五种 agent × warn/strict）：

   | agent | warn | strict |
   |---|---|---|
   | worker | 建占位 `T-…-001`，`isPlaceholder=true` | **block** |
   | oracle | 不建 Task，警告 `validator delegation names no Task under review` | 同左（不 block） |
   | reviewer | 不建 Task，警告 `reviewer delegation has no taskId` | 同左 |
   | explorer / scout | 不建 Task，警告 `explorer delegation is not attached to any Task` | 同左 |

   oracle 走 `:757` 未绑定 validator 分支、reviewer 走 `:691` 分支、explorer 走 `:924` 分支，
   三者都在占位分支之前 `return`。**所以在这里加拒绝不会打断评审链** ——
   这是本票最大的一条风险，已用实跑排除，执行者不必再赌。
   注意角色来自 `input.agent`（`roles.ts:47` `inferRoleFromAgent`，`oracle→validator`、
   `scout→explorer`），**不是 `input.role`**；写测试时传 `role:` 会静默退化成 worker。

**因此本票要改的是触发条件，不是拒绝路径。** 两条路线都可接受，执行者自选并说明理由：
(a) 让 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1` 把 `structuredDelegationMode` 解析成 `strict`；
(b) 在 `:856` 的条件上并联一个调用期读的严格模式判断。
**不接受**把 `DEFAULT_STRUCTURED_DELEGATION_MODE` 改成 `strict` —— 那会连非严格模式一起改掉，
直接违反条款 3。

round_id=p13-r059（派活前核验，行号重钉 + 成因收窄）

---

2026-09-08 planner 验收（round_id=p13-r059，执行者 w2E:pG / pi）：**接受并提交（planner 补了一处缺陷，见下）。**

执行者选路线 (b)：在 `:856` 的 worker 守卫上并联调用期
`process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW === "1"`，`structuredDelegationMode` 字段本身不动。
路线是它自己换的 —— 它先按 (a) 写，发现 index 侧的 RED 失败原因不对
（测试在模块初始化之后才设环境变量，而 (a) 只在构造 orchestrator 时读），
据此判定调用期读取才符合宿主路径，与本票指出的 `orchestrate.ts:1183` 先例一致。**这个判断是对的。**

planner 在自己 pane 逐条复现（不是采信回执）：

- **围栏**：`index.ts` / `types.ts` / `task.ts` / `roles.ts` 的 md5 与派活前冻结快照逐字节一致
  （`p13-r059-30-freeze-md5.txt` ↔ `p13-verify-r059/post-md5.txt`）。
- **RED 独立复现**：只回滚 `orchestrate.ts`（其余文件不动）后，
  `orchestrate.test.mjs:405` 在 `assert.ok(blocked.block)` 失败（actual `undefined`），
  `index.test.mjs:3018` 在 `assert.equal(strictCall?.block, true)` 失败（`undefined !== true`）。
  逐字节还原后 md5 一致。日志：`p13-verify-r059/red-orchestrate.log`、`red-index.log`。
- **回执里的 RED 有一条是旧的。** 它贴的第一条是 `orchestrate.test.mjs:399` 的
  `'warn' !== 'strict'` —— 那是它按路线 (a) 写的草稿版断言，换成 (b) 后该行已改成
  `assert.equal(orch.structuredDelegationMode, "warn")`，在旧代码下**会通过**。
  真实的失败点是 `:405`。结论仍成立（新用例在旧代码下确实失败），
  但**贴出来的证据与最终交付的用例对不上**，属于回执缺陷，已当面记档。
- 四条验收命令 `slot cpu -- npm run typecheck / npm test / npm run test:e2e` 与 `git diff --check`
  全部 exit 0，16 个测试文件 + e2e 全 PASS。两个测试文件的删除行数均为 **0**，
  所以 `orchestrate.test.mjs:378-388` 的两条既有断言与 03 的既有用例确实一行未改。
  slot 预检 `p13-verify-r059-slot-audit.log` / `-slot-status.log`：绕过 slot 的 `htvc`
  （PID 3821263，RSS 19.6G），按规则未终止。

**planner 实测发现并自行修掉的一处条款 2 缺陷：**
执行者的文案分支是「`REQUIRE_REVIEW=1` **且** `STRUCTURED_DELEGATION` 不为 strict」才换新文案。
于是**两个开关同时打开**时，输出的仍是旧那句
`Set PI_PLANNER_ONLY_STRUCTURED_DELEGATION=warn to allow unstructured worker delegations.` ——
而此时照做**并不能解开阻断**（`REQUIRE_REVIEW=1` 仍然拦），且 Root 拿不到
objective/scope/acceptanceCriteria 这句真正可执行的提示。这正是条款 2 要防的那种假提示。
探针 `p13-verify-r059/msg-matrix.mjs` 四种开关组合实测（`msg-matrix.log` 修前 / `msg-matrix-after.log` 修后）：

| 开关 | 修前末行 | 修后末行 |
|---|---|---|
| 都不设 | 不 block，建占位（03 路径保持） | 同左 |
| 只 REQUIRE_REVIEW | 严格模式新文案 | 同左 |
| 只 STRUCTURED=strict | 旧文案逐字 | 旧文案逐字（未变） |
| **两个都设** | **旧文案（错的）** | **严格模式新文案** |

修法：去掉第二个合取项，让严格模式**压过** structured 开关，并加注释说明理由；
同时在 `orchestrate.test.mjs` 里补一条「两个都设」的断言钉住它。
改动由 planner 在自己 pane 完成（+3 行源码 / +12 行测试），全套验收命令重跑通过。

最终 `git diff --numstat`：`orchestrate.ts` 11/2、`orchestrate.test.mjs` 48/0、`index.test.mjs` 21/0。

**留档：** 本票的实现面比原始票面小得多 —— 拒绝路径、宿主阻断映射、
甚至 worker-only 的作用域全都是现成的，真正缺的只有「哪个开关触发它」。
派活前那轮实跑（五种 agent × warn/strict 直接调 `beginDelegation`）把
「加拒绝会不会打断评审链」这个最大风险从猜测变成了事实：
oracle/reviewer/explorer/scout 在占位分支之前就 return，压根不建占位 Task。
如果没先跑那一轮，这一票很可能被写成一个大得多、且会误伤评审链的改动。

round_id=p13-r059
