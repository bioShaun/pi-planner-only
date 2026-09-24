[轮次] round_id=PENDING

# 工单 14A 第三轮：reviewer 豁免 + 补真正在测东西的断言

回信地址：planner pane **w2E:pD**。做完把报告发到那里。
工作目录：`/home/tcuni-claw/pi/pi-planner-only`（分支 `planner-only-cost-control`）。
前两轮的改动**都在工作区里、未提交**，本轮在它们之上继续，不要推倒重来。

## 0. 环境硬规则

- 超过 1 分钟的命令一律 `slot cpu -- <命令>`；开跑前先 `slot audit` 和 `slot status`，
  输出写进 `.scratch/planner-only-cost-control/p15-r071-slot-preflight.log`。
- `slot audit` 报出绕过 slot 的进程**不要终止**，照抄进报告。
- 中间文件只放 `.scratch/planner-only-cost-control/` 下，**禁止写 `/tmp`**。
- 不要读/打印/提交 `.agent-dir/models.json` 与 `.agent-dir/auth.json`。
- 不要 `git commit`，不要勾工单 checkbox。

## 1. 上一轮验收结论：泄漏修复通过，测试有两处没在测东西

我在 planner pane 全部复跑过：typecheck=0；15 个套件 PASS，只有 naming 按修正版验收失败；
e2e=0；`git diff --check`=0；`r069-leak.mjs` 打出 `B3 no leak`。**泄漏确实修好了，V13 写得很扎实。**
V1–V4（含 reviewer 那条无 floor 的 else 分支）、V7/V8（逐字文案）、V12 也都对。

但我逐条实跑复核断言本身时，发现两处问题。

### 缺陷 1（必须修）：reviewer 在余额耗尽时会被拒——而 V10 声称它不会

V10 断言 reviewer 不因累计预算被拒，测试是绿的。但**真实行为恰恰相反**。我的探针
`.scratch/planner-only-cost-control/p15-probe/r070-audit.mjs` 里，把一个 Task 的用量烧到
远超上限（上限 tokens=1，实耗 5000），再发一个正常绑定该 Task 的 reviewer 委派：

```
V10 reviewer outcome keys: [ 'block' ] block: Planner-only guard: task T-... cumulative budget exhausted (tokens).
V10 reservation held after reviewer: {"tokens":0,"costUsd":0}
```

reviewer **被拒了**，而且它连预留都没占（0/0）——因为 `reserve()` 里
`available <= 0` 的判断在看 `desired` 之前就返回了，reviewer 没有地板、没有 desired，
却照样撞在这道闸上。

V10 之所以是绿的，是因为它用 `{ agent: "reviewer", task: task.taskId }`（光一个裸 id 当正文），
那条路径根本没绑上 Task，`budgetTask` 是 undefined，整段预算逻辑被跳过。
**断言写了，但没有测到任何东西。**

为什么这必须修：reviewer 是 Task 收尾的唯一途径。预算一旦耗尽就连 review 都发不出去，
这个 Task 就永远停在 executing/reviewing，既不能通过也不能失败——正是本工单想避免的死局。
工单 16「预算停止后的收尾能力」也建立在「收尾动作不被预算闸门挡住」之上。

**修法**：在 `orchestrate.ts` 那段累计预算检查的入口条件里排除 reviewer。
第 650 行附近已有 `const role = target?.role ?? "worker";`，直接用它：

```ts
		if (role !== "reviewer" && budgetTask?.usage && cumulativeBudget && typeof cumulativeBudget === "object") {
```

不要改 `reservations.ts` 的算法来实现豁免（那会让 `available <= 0` 的语义变得依赖角色，
以后很难看懂）。豁免发生在调用点，理由写成一行注释：reviewer 不占预留、也不受余额闸门，
否则耗尽预算的 Task 无法收尾。

### 缺陷 2（必须修）：可能把空的 `usageBudget: {}` 写进载荷

`orchestrate.ts:723-726` 现在是：

```ts
			const usageBudget: Record<string, { hard: number }> = {};
			if (floorLimits.tokens) usageBudget.tokens = { hard: floorLimits.tokens.value };
			if (floorLimits.costUsd) usageBudget.costUsd = { hard: floorLimits.costUsd.value };
			inputRecord.usageBudget = usageBudget;
```

两个维度都没解析出来时，这会把 `usageBudget` 从「本来不存在」变成 `{}` 写进真正发出去的载荷。
宿主 schema 对这两层都禁额外键、`hard` 必填，凭空多一个空对象没有任何好处。
改成只在至少解析出一个维度时才赋值。

## 2. 本轮要写的断言

修正 `orchestrate.test.mjs` 里已有的两条，并新增两条。措辞和数值照抄。

- **V10（重写，不要保留原来那版）**：用**真正能绑上 Task** 的 reviewer 委派形式
  （`{ agent: "reviewer", task: \`Review ${taskId}\` }` 这种带正文的，不是裸 id），
  Task 用量远超 `cumulativeBudget`。断言三件事：
  1. `outcome.block === undefined`（reviewer 没被拒）；
  2. reviewer 委派后该 Task 的在途预留仍为 `{tokens: 0, costUsd: 0}`（reviewer 不占预留）；
  3. **阳性对照**：同一个 store、同一个耗尽状态下，一个 worker 受控启动**确实**被拒且理由匹配
     `/cumulative budget exhausted/`。没有这条对照，V10 又会变回「因为根本没走到闸门所以绿」。
- **V6（补强）**：现在只断言了 `blocked.block` 为真。加上
  `assert.match(blocked.block.reason, /cumulative budget exhausted \(tokens\)/)`。
  写锁冲突走的是 `{ task, conflict }` 而不是 `block`，但别人以后改了返回形状，这条断言能挡住误判。
- **V14（新增）**：受控启动结束后，`input.usageBudget` 要么没有这个键、要么至少含一个维度；
  **绝不能是 `{}`**。断言 `input.usageBudget === undefined || Object.keys(input.usageBudget).length > 0`。
- **V11（补强）**：现在 `const input = { ...before, task: ... }` 让 `input.usageBudget` 和
  `before.usageBudget` 是**同一个对象**，只能挡住整体替换、挡不住原地改写。
  把 `before` 改成结构化的期望副本（例如 `JSON.parse(JSON.stringify(...))` 另存一份再比），
  这样原地改写也会被抓到。

## 3. 围栏

**只允许改这 2 个文件**：`orchestrate.ts`、`orchestrate.test.mjs`。

`reservations.ts`、`floors.ts`、`floors.test.mjs`、`architecture.test.mjs`、`package.json`
本轮**都不要动**（前两轮已经改好）。
`usage.ts` / `types.ts` / `task.ts` / `index.ts` / `roles.ts` **只读**。
仓库外的安装副本 `~/.pi/agent/git/github.com/bioShaun/pi-planner-only` 不要碰。

## 4. 验收

1. `slot audit` + `slot status` → `p15-r071-slot-preflight.log`。
2. `slot cpu -- npm run typecheck` 退出 0。
3. `slot cpu -- npm test`：允许且**仅允许** `naming.test.mjs` 失败，且失败信息正好是
   `extension install is missing reservations.ts`；前 15 个套件全部 PASS。
4. `slot cpu -- npm run test:e2e` 退出 0。
5. `git diff --check` 退出 0。
6. `node --experimental-strip-types .scratch/planner-only-cost-control/p15-probe/r069-leak.mjs`
   仍打出 `B3 no leak: ...`（不要让本轮改动把上一轮的修复弄回去）。
7. `node --experimental-strip-types .scratch/planner-only-cost-control/p15-probe/r070-audit.mjs`
   的 V10 那行变成 `V10 reviewer outcome keys: [ ... ]` 且**不含 block**；V6 那行不变。

## 5. 报告里必须有的东西

- `git diff --stat` 原文。
- 上面 7 条的退出码/输出原文，第 3 条附 15 个 PASS 行。
- **失败证明这次要逐条给，不要再合并成一组**。上一轮 V5–V11 只做了一次改数字的证明，
  那只证明了 V5，V6/V9/V10/V11 实际上都没被证明过——V10 就是这么混过去的。
  本轮 **V6、V10（三个断言各一次）、V11、V14** 每一条都要单独把被测代码改坏一处、
  贴逐字红色输出、再改回来。V10 的阳性对照那条尤其重要：把 reviewer 豁免删掉，
  阳性对照应当仍然绿，而第 1 条断言应当变红——请把这两个结果都贴出来。
  **哪一条确实没做出来就如实写「未做」并说明原因**，照实说永远比编红色输出好。
- `slot audit` 里绕过 slot 的进程原样抄进来。
- 工单本身你觉得说不通的地方，直接写。
