[轮次] round_id=PENDING

# 工单 14B + 17：预算「强制 vs 事后观测」的披露

**回信地址：把完成报告发回 planner pane `w2E:pD`（claude）。** 你的报告不会自动回到我这里，必须显式发。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`，当前 HEAD `4afaa54`。

---

## 0. 环境铁律（本机全局规则，不可放宽）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时目录、缓存、构建产物。任务内的中间文件放当前工作目录下一个明确命名的可丢弃子目录；需要放到工作目录之外时用 `/project/tmp`。原因：`/tmp` 是 62G tmpfs，直接吃物理内存。
- 预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，**一律用 `slot` 提交**（本轮用 `slot cpu -- <命令>`）。
- **每次启动重任务前必须先跑 `slot audit` 和 `slot status`，并把输出写进项目日志**（写到 `.scratch/planner-only-cost-control/p15-rNNN-slot-audit.log` 和 `-slot-status.log`）。禁止先跑后补。
- `slot audit` 若报告有绕过 slot 的重进程，**不得擅自终止**；等待、降低并发或在报告里说明资源冲突即可。
- 不要用 `slot slots` 调大槽位给自己插队。
- **绝对不要读取、打印或提交 `.agent-dir/models.json`、`.agent-dir/auth.json`** —— 里面是 provider API key。

---

## 1. 背景（这些是我已经实跑核实过的事实，不是转述）

累计预算闸门（工单 13/14A）已经落地并提交：`reservations.ts` 做启动前原子预留，`orchestrate.ts` 的 `beginDelegation` 是唯一拒绝点。

但 status 现在**把一个未经证实的硬上限，显示得像是硬上限**。三条已核实的缺口：

1. **宿主是否真在 `hard` 处停下子进程，从来没有被证明过。** 工单 05 文末原文：「**仍未证明（不要读成已闭合）**：子进程运行时是否真的在 `hard` 处被宿主停下来 …… 本票这两条按『宿主接受该参数形状』计，不按『运行时强制执行已验证』计。」也就是说：目前只证明了宿主**接受** `usageBudget` 这个参数形状。
2. **Root 没有预调用控制。** Root 不是被委派的子代理，宿主不提供「Root 下一次模型调用前」的可执行控制点，Root 的消耗只能事后计入。而 Root 往往是整个 Task 里最大的消耗方。
3. 现在的 status 输出（我今天实跑 `renderTaskStatus` 打出来的原文）里，**没有任何一个字**提到上面两点：

```
Budget (累计):
  tokens: 已用 35000 / 上限 100000，剩余 65000，未知项 0 项
  费用: 已用 $0.1600 / 上限 $0.5000，剩余 $0.3400，未知项 0 项
Budget by role:
  - root: 3 turns, tokens=25000, 费用 $0.1200
  - worker: 1 calls, tokens=10000, 费用 $0.0400
```

「剩余 65000」读起来像是还有 65000 的硬额度可用。实际上：这个数只是事后记账的差值。

这一轮要关掉的是**工单 14 第 6 条**和**工单 17 第 1、3、4 条**。

---

## 2. 要做什么

### 2.1 实现（我已在 `/project/tmp/pi-planner-verify/p15-r072-proto` 原型跑通，下面是冻结基线，照抄，不要换措辞）

完整 diff 在 `.scratch/planner-only-cost-control/p15-r072-proto.diff`，**先读它**。要点：

**(a) `floors.ts` 新增宿主强制能力声明**（放在 `loadFloorConfig` 之前）：

- `export interface HostEnforcement { readonly tokens: boolean; readonly costUsd: boolean; }`
- `export const HOST_ENFORCEMENT_ENV_VARS = { TOKENS: "PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS", COST_USD: "PI_PLANNER_ONLY_HOST_ENFORCES_COST_USD" } as const;`
- `export const DEFAULT_HOST_ENFORCEMENT: HostEnforcement = Object.freeze({ tokens: false, costUsd: false });`
- `export function loadHostEnforcement(env: NodeJS.ProcessEnv = process.env): HostEnforcement`

**默认两个维度都是 `false`（= 仅事后观测），这是本工单的核心决定，不许改成 true，也不许「检测」出来。** 理由写在代码注释里：运行时强制从未被证明，声明只能是操作者显式给出的，绝不能靠推断。

取值只接受 `"1"` / `"0"`（trim 后）。设了但为空 → 抛错；其他任何值 → 抛错。措辞与 `floors.ts` 现有的 fail-closed 风格一致：

```
Host enforcement configuration error: PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS is set but empty; must be 1 or 0.
Host enforcement configuration error: PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS="yes" is invalid; must be 1 or 0.
```

**(b) `orchestrate.ts` 的 status 渲染（`renderTaskStatus` 里 `summarizeTaskBudget` 那一段，当前在 1242 行附近）：**

- 从 `./floors.ts` 引入 `loadHostEnforcement`（合并进现有那行 import）。
- 每个**已配置**的维度行末追加：
  - 未声明强制：`；宿主未强制该维度，仅事后观测`
  - 已声明强制：`；宿主在上限处强制停止`
  - **未配置上限的维度行不加任何后缀**（没有上限就无所谓强不强制）。
- 在两条维度行之后追加一条 Root 行：

```
  Root: 无预调用控制，Root 自身消耗只能事后计入（已计入 tokens=<root tokens>、费用 <$x.xxxx>）
```

  当任一已配置维度 `remaining < 0` 时，在这行末尾追加 `；当前` + 顿号连接的超额项，格式：`tokens 超额 <n>`、`费用超额 <$x.xxxx>`。

- `Budget: 未设累计上限（…）` 那条分支**一个字都不要动**。

### 2.2 工单批注（改 issues 下的 md，**不要勾 checkbox**）

- `.scratch/planner-only-cost-control/issues/14-pre-launch-reservation.md`：第 6 条的证据批注。
- `.scratch/planner-only-cost-control/issues/17-root-cost-limit-disclosure.md`：第 1、3、4 条的证据批注。
- **第 17 票第 2 条（「宿主有预调用控制：status 显示 Root 纳入硬阻断，Root 超额时下一次模型调用被阻断」）必须留空并写明原因**：pi-subagents 0.66.0 不提供 Root 预调用控制入口，这条在当前宿主下不可验证。**不许因为写了 if 分支就勾上。** 这和工单 05 第 1、2 条曾经的处境是同一类问题，批注里要点名。
- 每条批注结尾写 `round_id=<本轮 round_id>`。

---

## 3. 测试（本轮的主要工作量）

三个文件各自补，**每条断言都要能单独失败**：

**`floors.test.mjs`**（现有 13 组，往后追加，保持文件末尾的 PASS 行在最后）：
- W1：默认 `loadHostEnforcement({})` 两个维度都是 `false`。
- W2：`{ PI_PLANNER_ONLY_HOST_ENFORCES_TOKENS: "1" }` → tokens true、costUsd 仍 false（**只翻一个维度**）。
- W3：`"0"` 显式关闭 → false。
- W4：设为空串 → 抛错，且错误文本逐字匹配上面 (a) 里的第一条。
- W5：设为 `"yes"` → 抛错，逐字匹配第二条。
- W6：`DEFAULT_HOST_ENFORCEMENT` 是 frozen 且两项均 false（防止有人日后偷偷改默认）。

**`orchestrate.test.mjs`**（在现有 `statusWithBudget` 那一组附近）：
- W7：两维度都配置、未声明强制 → 两行都带 `；宿主未强制该维度，仅事后观测`。
- W8：声明 tokens 强制、费用不强制 → tokens 行带 `；宿主在上限处强制停止`，费用行仍带「仅事后观测」（**一条断言只查一个维度，不要合并**）。
- W9：只配置了费用上限（tokens 无上限）→ tokens 那行**不带**任何强制后缀；用 `assert.doesNotMatch` 或 `includes === false` 断言。
- W10：Root 行出现，且 `已计入 tokens=` 与 `费用 $` 的数值等于该 Task root 的实际用量。
- W11：tokens 超支 → Root 行末尾出现 `；当前tokens 超额 5000`（照抄，注意原型里 `当前` 和 `tokens` 之间**没有空格**；你要么保持一致，要么两处一起改并在报告里说明）。
- W12：两个维度同时超支 → 两项都出现且用 `、` 连接。
- W13：`Budget: 未设累计上限（…）` 分支的输出与本轮改动前**逐字一致**（回归保护）。
- W14：已有的 `Budget (累计):` 老断言全部仍然通过（不要删改任何现有断言）。

**`architecture.test.mjs`**：
- W15：`floors.ts` 里 `DEFAULT_HOST_ENFORCEMENT` 的两个值都是 `false` —— 用源码正则断言，防止默认值被悄悄翻成 true。
- W16：`floors.ts` 不从 `./index.ts` 或 `@earendil-works` 引入任何东西（沿用现有同类断言的写法）。

### 3.1 失败证明：**逐条，一条一个**

这是本轮的硬性要求，不是形式主义。上一轮（p15-r070）就是因为把 V5–V11 合并成一次改坏来证明，结果只证明了第一条，其中一条断言实际是空转的、而且底层行为和它声称的相反，一直混到我复核才抓出来。

所以：**W1–W16 每一条，单独改坏一处、单独跑、单独贴逐字红色输出、单独恢复。** 一次改坏证明多条不接受，报告里出现「W5–W11：把 X 改成 Y，全部变红」这种写法本轮直接打回。

---

## 4. 围栏（只许动这些文件）

```
floors.ts
orchestrate.ts
floors.test.mjs
orchestrate.test.mjs
architecture.test.mjs
.scratch/planner-only-cost-control/issues/14-pre-launch-reservation.md
.scratch/planner-only-cost-control/issues/17-root-cost-limit-disclosure.md
.scratch/planner-only-cost-control/p15-r*.log
```

**只读、绝对不许改**：`spec.md`、`reservations.ts`、`usage.ts`、`types.ts`、`task.ts`、`index.ts`、`roles.ts`、`package.json`、`naming.test.mjs`、`e2e.pi-subagents.test.mjs`、任何其他 issues md。

**不要 `git commit`，不要 `git add`，不要勾任何 checkbox，不要改任何工单的 `Status:` 行。** 提交由 planner 复核后自己做。

---

## 5. 验收

```bash
slot cpu -- npm run typecheck                                     # 必须 exit 0
slot cpu -- npm test                                              # 见下面的唯一例外
slot cpu -- env PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e   # 必须 exit 0
git diff --check                                                  # 必须 exit 0
```

**`npm test` 允许且仅允许一个失败**，就是链条最后的 `naming.test.mjs`，逐字如下：

```
AssertionError [ERR_ASSERTION]: extension install is missing reservations.ts
```

原因：`naming.test.mjs` 断言仓库里每个 `.ts` 都存在于仓库外的安装副本 `~/.pi/agent/git/github.com/bioShaun/pi-planner-only`，那个副本是跟 `main` 的 git clone（现在停在 `9027d8f`），而 `reservations.ts` 是 14A 新加的、还没进 main。**这个失败在本轮之前就存在，与你的改动无关，也不要试图去修它**（那个路径在围栏外）。在它之前的 **15 个 suite 必须全部 PASS**——我今天在原型里实测就是 15 PASS + naming 这一个失败，typecheck 0，e2e 0。

---

## 6. 报告里必须包含

1. 改了哪些文件（逐个列出），以及 `git status --porcelain` 原文。
2. 四条验收命令的退出码和关键输出原文。
3. **W1–W16 的逐条失败证明**（每条：改了什么、逐字红色输出、已恢复）。
4. `slot audit` / `slot status` 的日志路径，以及 audit 是否发现绕过 slot 的进程（有就照实说，不要动它们）。
5. 工单 17 第 2 条你写的批注原文。
6. **你认为这份工单里有逻辑不通、自相矛盾、或者做不到的地方，直接说。** 我自己写的工单已经错过好几次（成因写反、漏必填字段、引用不存在的函数、验收要求不可能满足）。指出来比硬做出来有价值。
