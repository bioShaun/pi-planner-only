[轮次] round_id=PLACEHOLDER

你是本轮的**执行者**。Planner 在 herdr pane `w2E:pD`，**做完请把报告发回 `w2E:pD`** ——
你的上下文里没有别的地方记着我是谁，报告发到自己 pane 里我永远收不到。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`（git 仓库，分支 `planner-only-cost-control`，
HEAD 应为 `25e632b`）。**你的上下文是空的，本文件自带全部信息，不要假设你记得上一轮。**

---

## 0. 环境硬规则（必须逐条遵守，你的全局规则文件可能没被加载）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时目录、缓存、构建暂存或任务产物。
  任务内的中间文件放当前工作目录下一个清楚命名的可丢弃子目录；
  需要放到工作目录之外时用 `/project/tmp`。这条同样适用于你起的脚本、子进程和被你委派的子代理。
- **预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交。**
  本轮的验收命令属于这一类，必须走 `slot cpu -- …`。
- **每次启动重任务前必须先运行 `slot audit` 和 `slot status`，并把输出写入项目日志**
  （写到 `.scratch/planner-only-cost-control/` 下，文件名带 round_id）。
  **禁止先启动重活、事后再补查。**
- `slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；应等待、降低本任务并发或报告资源冲突。
- **不要用 `slot slots` 调大槽位数给自己插队。**
- **`.agent-dir/models.json` 与 `.agent-dir/auth.json` 含 provider API key：
  不许读、不许写进报告、不许提交。**

## 1. 本轮范围（工单 30）

票在 `.scratch/planner-only-cost-control/issues/30-strict-mode-should-refuse-taskspec-less-delegation.md`，
**先完整读一遍**，尤其是末尾 `round_id=p13-r059` 那段 planner 的实跑核验 —— 行号和成因都在那里。

**一句话：`PI_PLANNER_ONLY_REQUIRE_REVIEW=1`（严格模式）下，没有嵌入 TaskSpec 的 worker 委派
必须被拒绝，而不是建一个「无目标」的占位 Task 让整条评审链挂在上面跑。**

背景（08 第五次重跑 run5 的实测）：Root 从头到尾没嵌过 TaskSpec，第一个 worker 拿到的是
objective／scope／acceptanceCriteria 全空的空壳，跑了 50 分钟；`grep -c 'Placeholder task'` = **16**，
而 08 条款 7 要求 **0**。

## 2. Planner 已经替你查清的事实（实跑得出，不是推测，可直接用）

1. **拒绝机制已经存在，缺的只是触发条件。** `orchestrate.ts:854-869` 已有
   `if (!spec)` 守卫，其中 `role === "worker" && this.structuredDelegationMode === "strict"`
   时 `return { block: { reason: … } }`；`index.ts:810-813` 把它变成 `{ block: true, reason }`
   并 notify `"Blocked unstructured delegation"`。**所以「子进程未启动」不需要你造新机制。**
2. **它没生效，是因为读的是另一个开关。** `structuredDelegationMode` 来自
   `PI_PLANNER_ONLY_STRUCTURED_DELEGATION`（`orchestrate.ts:2153-2159`），
   而 `DEFAULT_STRUCTURED_DELEGATION_MODE` 是 `"warn"`（`types.ts:256`）。
   run5 只带了 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1`，没带 STRUCTURED_DELEGATION →
   走 warn → 建占位。**这就是 16 次的全部成因。**
3. **只有 worker 会走到占位分支。** Planner 实跑探针
   （`.scratch/planner-only-cost-control/p13-probe/roles-reaching-placeholder.mjs`，
   五种 agent × warn/strict 直接调 `beginDelegation`）：

   | agent | warn | strict |
   |---|---|---|
   | worker | 建占位 `T-…-001`，`isPlaceholder=true` | **block** |
   | oracle | 不建 Task，警告 `validator delegation names no Task under review` | 同左（不 block） |
   | reviewer | 不建 Task，警告 `reviewer delegation has no taskId` | 同左 |
   | explorer / scout | 不建 Task，警告 `explorer delegation is not attached to any Task` | 同左 |

   oracle 走 `:757`、reviewer 走 `:691`、explorer 走 `:924`，三者都在占位分支之前 `return`。
   **在这里加拒绝不会打断评审链** —— 这是本票最大的风险，已排除，你不用再赌，但**要用测试钉住**（条款 5）。
4. **角色来自 `input.agent`，不是 `input.role`**（`roles.ts:47` `inferRoleFromAgent`：
   `oracle→validator`、`scout→explorer`、`reviewer→reviewer`）。
   写测试时传 `role:` 会静默退化成 worker，我第一版探针就踩了这个，结果五个角色全打印成 worker。
5. 走到 `:854` 且 `!spec` 的 worker，基本等价于「没有任何 TaskSpec 特征字段」——
   「有特征字段但 TaskSpec 非法」的情况在 `:674` 已经先 block 掉了。
   **不要再加一层冗余的特征字段判断**，沿用 `!spec` 即可。

**行号已在 `25e632b` 上重钉（27/28/33/34/29a 落地后旧行号全部作废）：**
占位创建点 `orchestrate.ts:949-959`（`:955` 是全仓唯一的 `task.isPlaceholder = true`）；
6 个 `[PLANNER-ONLY] Placeholder task …` 发射点 `1569 / 1596 / 2015 / 2061 / 2104 / 2142`；
`TASKSPEC_CHARACTERISTIC_FIELDS` 在 `task.ts:186`（唯一消费点 `task.ts:272`）；
`PI_PLANNER_ONLY_REQUIRE_REVIEW === "1"` 三处读取 `index.ts:1085`、`task.ts:446`、
**`orchestrate.ts:1183`（调用期读 `process.env`，照抄这个写法即可）**。
**动手前请自己 `grep` 复核一遍这些行号**，如果对不上以你 grep 到的为准，并在报告里说明。

## 3. 两条实现路线，自选一条并说明理由

- (a) 让 `PI_PLANNER_ONLY_REQUIRE_REVIEW=1` 把 `structuredDelegationMode` 解析成 `strict`；
- (b) 在 `:856` 的条件上并联一个调用期读的严格模式判断。

**不接受**把 `DEFAULT_STRUCTURED_DELEGATION_MODE` 改成 `strict` —— 那会连非严格模式一起改掉，
直接违反条款 4。选 (a) 要特别注意 `orchestrate.test.mjs:378-388` 那两条断言仍须为真。

## 4. 验收条款（逐条都要有测试或实跑证据）

1. 严格模式下无 TaskSpec 的 worker 委派被拒：`beginDelegation` 返回 `{ block: { reason } }`，
   **store 里没有新建任何 Task**（断言调用前后 `store.list().length` 不变，且无 `isPlaceholder` 记录）；
   **并且要有一条走真实 `tool_call` 处理器的 `index.test.mjs` 用例**断言返回 `{ block: true }`、
   子进程未启动。只在 `orchestrate.test.mjs` 里断言不够 —— 「未启动子进程」只有宿主路径能证。
2. 拒绝文案自洽：指名真正生效的开关（严格模式），并列出需要嵌入的字段
   （至少 `objective`／`scope`／`acceptanceCriteria`）。
   现文案那句 `Set PI_PLANNER_ONLY_STRUCTURED_DELEGATION=warn to allow unstructured worker delegations.`
   **在严格模式下是错的**（照做也解不开），严格模式触发时不得原样输出这句；
   `PI_PLANNER_ONLY_STRUCTURED_DELEGATION=strict` 单独触发时的既有文案逐字不变。
3. 严格模式下 TaskSpec 合法的 worker 委派行为逐字不变（不 block，Task 照常创建/绑定）。
4. **不设**严格模式时，工单 03 的占位路径逐字不变：占位 Task 仍创建，
   6 个发射点的首行告知逐字不变，03 的既有测试一行不改即全绿。
5. oracle／reviewer／explorer／scout 四个角色在严格模式下行为逐字不变，不得被顺带 block（按 `input.agent` 传）。
6. 特征字段判定仍以 `task.ts:186` 的 `TASKSPEC_CHARACTERISTIC_FIELDS` 为准，不另立一套；
   `DEFAULT_STRUCTURED_DELEGATION_MODE` 保持 `"warn"`。
7. `orchestrate.test.mjs:378-388` 现有两条 `structuredDelegationMode` 断言一行不改仍然全绿。
8. **修复前新增用例必须失败（RED），回执贴出失败输出原文。**
9. 不勾 03/08 的 checkbox、不改它们的 Status、不改 `spec.md`。

## 5. 文件围栏（Fence）

**可改：** `orchestrate.ts`、`orchestrate.test.mjs`、`index.test.mjs`。
**只读：** `index.ts`、`types.ts`、`task.ts`、`roles.ts`、`report.ts`、`review.ts`、`usage.ts`、
`evidence.ts`、`notify.ts`，以及 `.scratch/` 下的一切（工单文件由 planner 维护，你不要改）。
**不要 `git commit`、不要 `git add`、不要动 `.gitignore`。** 提交由 planner 在自己 pane 做。

如果你认为某条条款在这个围栏下做不到，**停下来在报告里说清楚哪一条、为什么、需要放开哪个文件**，
不要自己扩大范围，也不要悄悄把条款做掉一半就说完成了。

## 6. 验收命令（必须实跑，贴原始输出与退出码）

```
slot cpu -- npm run typecheck
slot cpu -- npm test
slot cpu -- npm run test:e2e
git diff --check
```

四条都必须 exit 0。跑之前先 `slot audit` / `slot status` 并存日志（见 §0）。

## 7. 报告格式（发回 `w2E:pD`）

1. 选了哪条路线、为什么。
2. **RED 原文**：修复前新增用例的失败输出，逐字贴。
3. `git diff --numstat` 全部行。
4. 四条验收命令的退出码与关键输出。
5. slot 预检结果（含发现的绕过 slot 的进程，**未终止**）。
6. **「想改但没改」清单**：围栏挡住了什么、你觉得哪条条款有问题。
7. 条款 1-9 逐条自评，做到了就说做到了，没做到就明说没做到。

**不要在报告里复述你没有实际跑过的结果。** Planner 会在自己 pane 里逐条复现你的每一项证据，
包括独立回滚你的源码改动来验证 RED —— 报告与实跑对不上会直接打回。
