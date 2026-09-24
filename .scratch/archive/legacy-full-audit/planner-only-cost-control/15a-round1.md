# 轮次工单：工单 15-a（未知费用转有界负债）

[轮次] round_id=PENDING

你是执行者。你不继承我的上下文，也不一定读得到本仓库的 `AGENTS.md`。
**本工单自足**：需要知道的全部写在下面。planner pane = `w2E:pD`，做完把报告发回这个 pane。

---

## 0. 本机环境规则（逐字，不得放宽）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时目录、缓存、构建产物或任务产物。
  任务内的中间文件放当前工作目录（用一个明确命名的可丢弃子目录）；需要放到工作目录之外时用 `/project/tmp`。
  这条同样适用于你派出去的子任务。
- **预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交。**
  本轮的 `npm test` / `npm run test:e2e` 都要 `slot cpu -- …`。
- **每次启动重任务前必须先运行 `slot audit` 和 `slot status`，并把输出写入项目日志**
  （写到 `.scratch/planner-only-cost-control/p15-r0NN-slot-audit.log`）。
  `slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；等待、降低并发或在报告里写明资源冲突。
  禁止先启动重活、事后再补查。
- 不要用 `slot slots` 调大槽位数给自己插队。
- `.agent-dir/models.json`、`.agent-dir/auth.json` 是 provider 密钥，**不得读取、不得回显、不得提交**。

## 1. 背景：这轮在修什么

仓库 `/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`，起点 commit `e9a890d`。

Task 有累计预算（`spec.cumulativeBudget`），`summarizeTaskBudget`（`usage.ts`）把消耗汇总成
tokens / costUsd 两个维度，14A 的闸门（`orchestrate.ts` 的 `beginDelegation`）按剩余额度决定
是否放行下一次受控委派。

**今天的洞（我实跑过，不是推断）**：子进程的费用拿不到时，账本按 **0** 记。
`.scratch/planner-only-cost-control/p15-probe/r073-debt-baseline.mjs` 的输出逐字：

```
A children after two identical keyless pending records: 2
B children after two identical KEYED pending records: 1
B after resolve: children= 1 tokens.known= 39000 cost.known= 0 cost.unknownParts= 1
C cost.remaining as the gate sees it: 0.5 of limit 0.5
C => the money those 39000 tokens cost is worth 0 on the cost dimension
```

两件事：

1. 一个真烧掉 39000 tokens 的子进程，在费用维度上等于 **0**，闸门看到的余额是**满的**。
2. 没有 key（既无 `runId` 也无 `toolCallId`）的 pending child 会被**追加**而不是 upsert，
   同一个孩子记两次就变成两行。

## 2. 决定（planner 已定，不要重新设计）

完整决策记录在 `.scratch/planner-only-cost-control/design-15-16-decisions.md` §B，摘要：

- 费用未知时**按「启动时授予的额度」记一笔有界负债**，进入 `known` 一侧参与闸门，**不按 0 记**，
  也**不靠一直持有预留**（那等于把我在 p15-r069 修掉的预留泄漏当策略重新引入）。
- 真实值到达时**替换**负债，不是叠加 —— `usage.ts` 的 `upsertChild` 已经按 `runId`/`toolCallId`
  做 key 替换，幂等性就落在这里，所以**每个 pending child 必须带 key**。
- token 维度按工单 15 第 5 条：**token 已知就按真实值正常结算**，只有费用维度记负债；
  usage 完全没回来时 token 也按授予额度记负债。
- **与工单原文的偏离**：工单 15 第 4 条字面读法是「只要存在未结算负债 + 配了费用上限就拒绝下一次启动」。
  改为「负债计入 `known` 后由既有 14A 闸门按额度判断」，理由和留痕见 design 文档 §B.3。
  你不需要为这条偏离做任何事，但**不要**去实现「一有负债就拒绝」。

## 3. 冻结的实现基线

我已经把整套改动**实跑通过**（typecheck 0；15 个套件 PASS；e2e PASS；只有 `naming.test.mjs` 按预期失败）。
补丁在 `.scratch/planner-only-cost-control/p15-r073-proto.diff`（307 行，基于 `e9a890d`）。

**逐字落地这个补丁，不要改写措辞、不要重新命名、不要"优化"。**
里面每一句注释和每一段中文文案都是我实跑之后定的（其中三处就是实跑打脸改出来的：
负债注记原本挂在 `剩余` 后面读起来像剩余的一部分、`$-0.0300` 的负号在货币符号里面、
`Budget by role` 不含负债导致各角色加起来对不上 `已用`）。

应用方式随你（`git apply` 或手抄），但最终 `git diff` 必须与该补丁**逐字一致**。
补丁包含对 `orchestrate.test.mjs` 里**一条既有断言**的更新（`剩余 10（不含 1 个未知项）…`
→ `已用 10（不含 1 个未知项） / 上限 20，剩余 10，未知项 1 项`）——这是本轮有意的文案变更，
**不要把它改回去**。

## 4. 你要写的东西：验证点 X1–X12

补丁只带了实现和那一条既有断言的更新。**测试是你的活。**
每条都要能独立失败，且必须给出**逐条**的失败证明（见 §5）。

写在 `usage.test.mjs`（X1–X6）、`orchestrate.test.mjs`（X7–X10）、`architecture.test.mjs`（X11–X12）。
只许**追加**，不许删除或改写任何既有断言（补丁里那一条除外）。

我实跑出来的数字（`summarizeTaskBudget`，上限 `{ tokens: 200000, costUsd: 0.5 }`）：

| 场景 | tokens known/debt/remaining | cost known/debt/remaining/unknownParts |
|---|---|---|
| D1 只有一个 pending child（`tokensDebt: 40000, costDebtUsd: 0.12`） | 40000 / 40000 / 160000 | 0.1200 / 0.1200 / 0.3800 / 1 |
| D2 同一 child 带回 39000 tokens、无费率 | 39000 / 0 / 161000 | 0.1200 / 0.1200 / 0.3800 / 1 |
| D3 D2 的通知**重复一次** | 39000 / 0 / 161000 | 0.1200 / 0.1200 / 0.3800 / 1 |
| D4 真实费用 0.0731 到达 | 39000 / 0 / 161000 | 0.0731 / 0.0000 / 0.4269 / 0 |
| D5 四个各 `costDebtUsd: 0.13` 的 pending child | 40000 / 40000 / 160000 | 0.5200 / 0.5200 / **-0.0200** / 4 |

- **X1（工单 15 第 4 条）**：D1。未知子进程按授予额度计入 `known`，且 `debt` 等于该额度。
  断言 `costUsd.known === 0.12`、`costUsd.debt === 0.12`、`costUsd.remaining === 0.38`。
- **X2（工单 15 第 5 条）**：D2。token 按真实值结算（`tokens.known === 39000`、`tokens.debt === 0`），
  费用仍是负债（`costUsd.debt === 0.12`、`costUsd.unknownParts === 1`）。
- **X3（工单 15 第 1 条）**：D3。同一 `toolCallId` 的完成通知记两次，
  `taskUsage.children.length === 1`，且三个维度数字与 D2 逐一相等。
- **X4（替换不是叠加）**：D4。真实费用到达后 `costUsd.known === 0.0731`、`debt === 0`、
  `unknownParts === 0`。**必须显式断言 `known !== 0.12 + 0.0731`**，否则这条证明不了"替换"。
- **X5（负债能撑爆闸门 = 工单 15 第 4 条的实质）**：D5。`costUsd.remaining < 0`。
  这条是本轮的要害：改动前同样四个孩子的 `remaining` 是满的 0.5。
- **X6（陈旧负债字段惰性）**：构造一个 `pending: false`、`source: "sync-details"`、
  **同时带着** `tokensDebt` 和 `costDebtUsd`、且 `costUsd` 已知的 child，
  断言 `tokens.debt === 0` 且 `costUsd.debt === 0`——已解析的孩子身上残留的负债字段不得再被计入。
- **X7（status 披露 = 不许把估算当实测）**：渲染一个 D1 形状的 Task，断言费用行逐字包含
  `已用 $0.1300（其中 $0.1200 是 1 个未知项按授予额度估算，非实测） / 上限 $0.5000，剩余 $0.3700，未知项 1 项`。
- **X8（注记挂在「已用」上）**：断言该行**不**包含 `剩余 $0.3700（其中`。
- **X9（负数金额的写法）**：D5 形状，断言费用行包含 `剩余 -$0.0300`，且**不**包含 `$-0.0300`。
- **X10（Budget by role 含负债）**：D1 形状，断言 by-role 行逐字包含
  `- worker: 1 calls, tokens=40000, 费用 $0.1200，费用未知 1 项`。
- **X11（架构）**：`index.ts` 的 `pendingChild` 三个调用点**全部**带 key。
  用源码正则断言 `pendingChild(` 的每一处调用都出现在带 `toolCallId` 或 `runId` 的表达式里；
  更直接的写法：断言 `index.ts` 不再包含 `pendingChild(record.kind, { agent, toolCallId: undefined })`。
- **X12（架构）**：`orchestrate.ts` 仍然不含 `UsageLedger` / `recordChild` / `recordRootTurn`
  （既有断言已经守着，你要做的是确认它仍然通过，并在报告里点名——**不要**新增重复断言）。

## 5. 逐条失败证明（硬要求）

对 X1–X11 的**每一条 assert**，分别做一次"只破坏这一条"的改动，跑测试，把
**逐字的 `AssertionError` 首行**贴进报告。合并成一组只证明其中一条，这条规矩我已经被坑过三次。

破坏方式必须是**真的改实现**（改 `usage.ts` / `orchestrate.ts` / `index.ts`），
不许靠改测试自己来制造失败。证明完**必须还原**，最终工作区只留 §3 的补丁 + 你新增的测试。

一条 assert 如果在破坏实现后**仍然通过**，说明它是空转的，重写它，并在报告里说明。

## 6. 围栏

**可写**：`usage.test.mjs`、`orchestrate.test.mjs`、`architecture.test.mjs`、
以及 §3 补丁涉及的 `types.ts`、`usage.ts`、`reservations.ts`、`orchestrate.ts`、`index.ts`、
`.scratch/planner-only-cost-control/p15-r0NN-*.log`。

**只读**：其余一切。特别是
`task.ts`、`floors.ts`、`roles.ts`、`review.ts`、`evidence.ts`、`notify.ts`、`package.json`、
`.scratch/planner-only-cost-control/spec.md`、`issues/` 下的任何工单文件。

**不要 commit。不要勾任何 checkbox。不要动 spec.md。不要改 `.scratch` 下的工单 md。**
checkbox 和工单批注由 planner 收尾时写。

## 7. 验收

四条，全部 `slot cpu -- …`，把输出写进 `.scratch/planner-only-cost-control/p15-r0NN-*.log`：

1. `npm run typecheck` → 退出码 **0**
2. `npm test` → 退出码 **1**，且**前 15 个套件全 PASS**，
   唯一失败必须是 `naming.test.mjs` 的
   `AssertionError [ERR_ASSERTION]: extension install is missing reservations.ts`。
   这条失败是**预期内**的：`naming.test.mjs` 校验的是仓库外那份跟着 **main** 走的安装克隆，
   `reservations.ts` 还没进 main。出现**任何别的**失败都算不通过。
3. `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` → 退出码 **0**
4. `git diff --check` → 退出码 **0**

## 8. 报告要包含

- 改了哪些文件；`git status --porcelain` 原样。
- 四条验收的**原始输出片段**和退出码。
- X1–X11 **逐条**的失败证明（破坏方式一句话 + 逐字 AssertionError 首行）。
- `slot audit` / `slot status` 的输出，以及有没有发现绕过 slot 的重进程（发现了也**不要**去杀）。
- 你认为工单里有问题的地方——**照直说**。我的工单已经错过不止一次，
  发现自相矛盾、引用了不存在的函数、或者某条验证点根本无法失败，**停下来告诉我，不要自己找个说法圆过去**。
