# 05: Policy 切换 —— Root 只走 `planner_delegate`，旧拦截链不可达

Status: A 段 verified（10eeb20，A′ 10d8509）；B 段 in progress，06 待验收
Blocked by: 04（A 段）；06（仅 B 段宿主验证，见「依赖修正」与 2026-09-15 备注）
Type: task

**What to build：** 把 Root 的委派面从 `subagent` 切到 `planner_delegate`。分两段、两个 commit：

- **A 段（放行，纯增量）**：`planner_delegate` 进 Root 允许集（live 与 Idle 都放行）；validator 分支补 `auxiliary: true`（04 承接项）；`PLANNER_PROMPT` 改为指向 `planner_delegate`；`planner_delegate` 的调用进 Root 回合归因集合。A 段落地后，guard 开着的宿主第一次能用新工具。
- **B 段（拒绝，切换）**：`decidePolicy` 对 Root 的 `subagent` / `bg_wait` 一律拒绝，不看输入、不分 live/Idle；Idle-for-gather 允许集改为 `planner_delegate` / `planner_verdict` / `git_audit`（外加 `question` / `questionnaire`）；`decidePolicy` 的新路径不再把任何委派输入交给 `buildTaskSpecRepair`；宿主验证旧拦截链不可达。

设计与去向表见 [spec.md 轮 3](../spec.md)。ADR：[0001](../../../docs/adr/0001-typed-delegation-contract.md)。

## 现状（三条事实，写票时核过）

1. **`planner_delegate` 今天在 guard 开着时会被自己的策略拒掉。** 它不在 `READ_ONLY_TOOLS` / `ORCHESTRATION_TOOLS` / `ROOT_TOOLS` 任何一个集合里（`policy.ts:6-27`，`index.ts:81` 只 add 了 `git_commit`），也不在 `PLANNER_SAFE_TOOLS`（`index.ts:71-77`）。live 时落到 `blockedReason`，Idle 时落到 `idleBlockReason`。票 03 的宿主运行是 `PI_PLANNER_ONLY=0` 跑的，票 04 明确「不做宿主运行」，所以这个事实到现在没有暴露。A 段第一件事就是修它。
2. **Root 的 `subagent` 放行点只有一处**：`decidePolicy` 里 `subagentDelegatesToChildren` 为真则 `block: false`（`policy.ts:127-129`），随后 `index.ts:1420-1449` 的 hook 分支进 `prepareRoleDelegation` → `beginDelegation`。`decidePolicy` 拒了，这条分支就是死代码——这就是「旧链不可达」的机制，不需要动 `orchestrate.ts` 一行。
3. **`decidePolicy` 读 prompt 的位置**：每条拒绝理由都经 `appendTaskSpecRepair(…, buildTaskSpecRepair({ toolName, input, cwd }))`（`policy.ts:154/169/174`）。对 `subagent` 调用，`input.task` 就是 prompt 文本，`buildTaskSpecRepair` 会从里面抠 TaskSpec 候选（`task.ts:953-965`）。对 `read` / `bash` 这类工具，`input` 是路径或命令，不是 prose——这部分不算读 prompt，保留。

## 依赖修正（写票时发现，需要规划方确认）

spec.md 把 05/06/07 列为并行。但 **04 的 `planner_delegate` 只有 worker / explorer / validator 三个 role，reviewer 仍只能经旧链的 `subagent` + `extractReviewResult` 走**（06 才把 reviewer 搬到结构化返回）。若 B 段先于 06 落地，宿主上 review loop 会断：worker 交回后 Root 没有任何合法方式派 reviewer，每个 Task 都停在 reviewing。

因此本票拆成 A/B 两段：A 段只依赖 04，现在就能执行；**B 段的 Blocked by 加 06**。08 的依赖（05+06）不变。若规划方不接受此修正而坚持 B 段与 06 并行，替代方案是 B 段对 `input.agent === "reviewer"` 的 `subagent` 调用暂时放行（读的是结构化字段 `agent`，不是 prompt）——但这样「旧链不可达」的验收只能打七折，且 06 落地时还要回来删这个例外。不推荐。

## 范围

改：`policy.ts`、`index.ts`、`delegate.ts`、`policy.test.mjs`、`index.test.mjs`、`delegate.test.mjs`、`package.json`（`test` 脚本加一个文件）、`README.md` 与 `CONTEXT.md` 各一段、`.gitignore` 一行。
新建：`policy-cutover.test.mjs`。
**不改**：`orchestrate.ts`、`task.ts`、`report.ts`、`roles.ts`、`review.ts`（止损规则）。注意 `task.ts:1121` 的 repair 文案「Embed this in the subagent task prompt」在本票后会过时——**不改**，记入 08 的删除清单（`buildTaskSpecRepair` 整个 subagent 分支都是 08 的）。
**不删**：`index.ts` 的 `subagent` hook 分支、`tool_result` 的 `bg_wait` / `subagent` 分支、`planner_recover`、`policy.ts` 的旧判定逻辑——它们在 B 段后只在迁移旗标下可达（见「迁移旗标」），08 整块删。

## A 段

### A1. 允许集

`policy.ts`：
- `ROOT_TOOLS` 加 `"planner_delegate"`（在 `policy.ts` 里定义，不要学 `index.ts:81` 那样在适配层 add）。
- Idle 分支的显式放行列表（`policy.ts:161`）加 `planner_delegate`。

`index.ts`：
- `PLANNER_SAFE_TOOLS` 加 `"planner_delegate"`（A 段先不删 `subagent`，B 段删）。
- `tool_call` hook 的归因名单 `["subagent", "bg_wait", "planner_verdict", "git_audit"]`（`index.ts:1394`）加 `planner_delegate`：toolCallId 进 `rootTurnToolCallIds`；`input.taskId` 是字符串时 `canonicalTaskId` 进 `rootTurnTaskIds`（与 `planner_verdict` 同款）。
- `planner_delegate` 的 execute 在 `runDelegation` 返回后 `rootTurnTaskIds.add(outcome.task.taskId)`（新铸的 Task 只有这里知道 id；对齐旧链 `index.ts:1442`）。若 04 已经做了，交回时指出行号即可。

### A2. validator `auxiliary`（04 承接项）

`delegate.ts:297` 的 `beginExecution` 调用加一行：

```ts
...(role === "validator" ? { auxiliary: true } : {}),
```

`TaskExecutionRecord` 已有该字段（`orchestrate.ts:1959/1967` 就是这么写的），不需要改 `task.ts`。**只标 validator**：旧链的 explorer 是否 auxiliary 取决于它挂在哪个 Task 上（`orchestrate.ts:3113-3232` 的 ownership 推断），04 的 explorer 一律是独立 Task（`params.taskId` 给了才绑既有 Task），先不碰；若 10 的宿主验收发现 explorer 也被旧 helper 误认，再开小票。

### A3. `PLANNER_PROMPT`

`index.ts:194-211`。改动原则：只改与委派工具有关的句子，其余合同句（WorkerReport 字段、verdict 三态、review 轮数、oracle 规则）逐字保留。上限 1800 UTF-8 字节（`index.test.mjs:1690`）；现值 1792，下面四句按写票时的措辞替换后为 1785，余量 15 字节——措辞只能再短，不能再长，改完 `node -e` 量一下。

要改的句子：
- 「Gather: … Exact-id bg_wait and planner_verdict stay allowed; live Tasks allow inspect/Git-read.」→ 「Gather: no live Task starts one planner_delegate; TaskSpec names Worker skills. planner_verdict and git_audit stay allowed; live Tasks allow inspect/Git-read.」
- 「One bounded TaskSpec embedded in one direct {agent, task} subagent call; one ticket per TaskSpec.」→ 「One bounded TaskSpec per planner_delegate call (role, objective, scope, constraints, acceptanceCriteria, validation); one ticket per TaskSpec.」
- 「Embed the TaskSpec JSON so the worker can echo taskId; the extension may replace the id; use the canonical id returned by the extension afterwards.」→ 「The tool returns the canonical taskId in details; pass it as taskId on every later call for that Task.」（保留 `canonical` 一词以便断言改写最小）
- 「Roles: explorer/reviewer → builtin reviewer (…); validator → oracle (…), worker keeps its agent; never pre-compose worker→reviewer as a workflowScript, tasks array, or chain; call the reviewer only after the worker returns, in a separate direct call.」→ 「Roles: explorer → scout, reviewer → builtin reviewer (read/grep/find/ls; context=fresh; bounded packet), validator → oracle (bash, no edits), worker keeps its agent; never pre-compose worker→reviewer as a workflowScript or chain; delegate the reviewer only after the worker returns, in a separate call.」

`index.test.mjs:1693-1710` 的片段断言随之改：`/One bounded TaskSpec embedded in one direct \{agent, task\}/` → `/One bounded TaskSpec per planner_delegate call/`；`/canonical id returned by the extension/` → `/canonical taskId in details/`；其余断言应原样通过。B 段落地前 prompt 里不要写「subagent is refused」——A 段宿主上 `subagent` 仍可用。

### A 段验收

```sh
npm run typecheck && npm test                                   # exit 0
grep -n 'planner_delegate' policy.ts                            # ROOT_TOOLS 一处 + Idle 放行一处
grep -n 'auxiliary' delegate.ts                                 # 新增 validator 一行 + 既有 :350 的过滤一行
node --input-type=module -e 'const {PLANNER_PROMPT}=await import("./index.ts");console.log(Buffer.byteLength(PLANNER_PROMPT,"utf8"))'   # ≤ 1800
git diff --stat                                                 # 只有 policy.ts index.ts delegate.ts policy.test.mjs index.test.mjs delegate.test.mjs
```

A 段单测（写在既有文件里）：
- `policy.test.mjs`：`planner_delegate` live 放行、Idle 放行（`liveTask: false`）、子进程（`isChild: true`）放行。
- `delegate.test.mjs`：validator 用例（`:343-355`）加断言 `outcome.task.executions.at(-1).auxiliary === true`；worker 与 explorer 正例各加 `auxiliary === undefined`。
- `index.test.mjs`：`planner_delegate` 的 `tool_call` 经 hook 后 `message_end` 落账的 `toolCallIds` 含该 toolCallId（照 nx10 的既有写法）。

A 段单独一个 commit：`feat(policy): admit planner_delegate to the Root allowlist; validator executions are auxiliary; PLANNER_PROMPT points at planner_delegate (typed-delegation ticket 05 A)`。

## B 段

### B1. `decidePolicy` 新路径

把现有 `decidePolicy` 函数体**原样**改名为 `legacyDecidePolicy(policy)`（不导出，一行不改），新的 `decidePolicy` 写在它上面：

```ts
export interface PolicyInput {
	toolName: string;
	input?: unknown;
	isChild: boolean;
	disabled: boolean;
	cwd?: string;
	liveTask?: boolean;
	authorizedWaitId?: string;      // 仅 legacy 路径读；08 删
	/** Migration flag (ticket 05 → 08): keep the pre-cutover subagent/bg_wait rules. Tests only. */
	legacyDelegation?: boolean;
}

export function decidePolicy(policy: PolicyInput): PolicyDecision {
	if (policy.isChild || policy.disabled) return { block: false };
	if (policy.legacyDelegation) return legacyDecidePolicy(policy);

	const toolName = policy.toolName;
	if (toolName === "subagent" || toolName === "bg_wait") {
		return { block: true, reason: delegationCutoverReason(toolName) };   // 静态文本；不读 input
	}
	const liveTask = policy.liveTask ?? true;
	if (liveTask) {
		if (READ_ONLY_TOOLS.has(toolName) || QUESTION_TOOLS.has(toolName) || ROOT_TOOLS.has(toolName)) return { block: false };
		if (toolName === "bash" && isSafeAuditCommand(getCommand(policy.input))) return { block: false };
		return { block: true, reason: appendTaskSpecRepair(blockedReason(toolName), buildTaskSpecRepair({ toolName, input: policy.input, cwd: policy.cwd })) };
	}
	if (IDLE_TOOLS.has(toolName) || QUESTION_TOOLS.has(toolName)) return { block: false };
	return { block: true, reason: appendTaskSpecRepair(idleBlockReason(toolName), buildTaskSpecRepair({ toolName, input: policy.input, cwd: policy.cwd })) };
}
```

集合定义：
- `QUESTION_TOOLS = new Set(["question", "questionnaire"])`（新）。
- `ORCHESTRATION_TOOLS` **保留导出但缩为**只含 `question` / `questionnaire`（等价于 `QUESTION_TOOLS`，可以直接 `export const ORCHESTRATION_TOOLS = QUESTION_TOOLS`）。`bg_wait` / `subagent_wait` / `subagent_supervisor` / `contact_supervisor` 移出——它们全是异步收据机制的工具，B 段后 Root 调用一律落到拒绝。`index.ts:73` 展开的 `PLANNER_SAFE_TOOLS` 随之自动缩小。
- `IDLE_TOOLS = new Set(["planner_delegate", "planner_verdict", "git_audit"])`（新）。`planner_recover` 从 Idle 放行列表去掉（它只服务旧链；live 时仍在 `ROOT_TOOLS` 里放行，08 连工具一起删）。
- `ROOT_TOOLS` 内容不变（`git_audit` / `planner_verdict` / `planner_recover` / `planner_delegate`，`index.ts` 再 add `git_commit`）。

`delegationCutoverReason(toolName)` 文案（静态，三句）：
```
Planner-only guard: the parent process may not call '<toolName>'.
Delegation goes through planner_delegate (role, objective, scope, constraints, acceptanceCriteria, validation); its result carries the WorkerReport in details.
There is no asynchronous wait: planner_delegate returns when the child finishes.
```
不附 TaskSpec repair——repair 的输入就是 prompt 文本，这正是本票要断的读法。

`blockedReason` 的第三句「Delegate execution to a worker with the subagent tool…」改为「Delegate execution with planner_delegate…」；`idleBlockReason` 第三句去掉「or recover one known pending run with an exact-id bg_wait」，改为「Record a Verdict with planner_verdict, inspect Git with git_audit, or ask a question.」。这两个函数被 legacy 路径共用，改了文案会让 `policy.test.mjs` 里按文案断言的 legacy 用例跟着变——按新文案改断言即可，不要为 legacy 复制一份旧文案。

### B2. 适配层（`index.ts`）

- `PLANNER_SAFE_TOOLS` 删 `"subagent"`。
- `tool_call` hook 传 `decidePolicy` 时加 `legacyDelegation: process.env.PI_PLANNER_ONLY_LEGACY_SUBAGENT === "1"`。**这是环境变量在 `index.ts` 里唯一的出现处**；不加命令、不加 marker、不进 `/planner-only status`。
- `authorizedWaitId` 的计算保留（legacy 路径要用），不动。
- hook 里 `decision.block` 为假之后的 `subagent` 分支不动（旗标下可达）。
- 拒绝时的 UI toast 保持 `Blocked parent tool: <name>`（既有）。

### B3. 迁移旗标（为什么需要、怎么限制）

`index.test.mjs` 是一个顺序脚本，经 `tool_call` hook 驱动 `subagent` 187 次、`bg_wait` 6 次，覆盖的是 usage / ledger / 归因 / 收据这些在 08 才删的行为。B 段一刀切会让这个文件从第 120 行开始全红，而在 05 里重写它既越界（那是 08 的删除清单）又浪费。所以：

- `index.test.mjs` 顶部（`process.env.PI_CODING_AGENT_DIR = …` 旁边）加一行 `process.env.PI_PLANNER_ONLY_LEGACY_SUBAGENT = "1";`，并加注释 `// ticket 05 → 08: this file drives the pre-cutover subagent chain through the hook; deleted with it.`
- `policy.test.mjs` 现有的 `blocked()` 助手与所有直接调 `decidePolicy` 的地方加 `legacyDelegation: true`，现有用例保持语义（文案断言按 B1 末段改）。新路径的用例写在同一文件顶部一个新段里，用不带旗标的助手 `cutover(toolName, input, liveTask)`。
- 其他任何 `.ts` / `.mjs` 文件不得引用该环境变量。宿主上默认不设，`/planner-only status` 不显示它，README 不写它。
- 08 删除：`legacyDecidePolicy`、`PolicyInput.legacyDelegation` / `authorizedWaitId`、`index.ts` 那一行、`index.test.mjs` 整个文件。

### B4. 新测试 `policy-cutover.test.mjs`（适配层，不设旗标）

按 `index.test.mjs:1-120` 的假宿主搭法（handlers map、隔离 `PI_CODING_AGENT_DIR`、`tmpdir()` 工作目录并 `finally` 清理——票 01 规矩），至少：

1. Root `tool_call` `subagent`（`input.task` 是一份合法 TaskSpec JSON——故意给合法的，证明拒绝不看内容）→ 返回 `{ block: true }`，reason 含 `planner_delegate`、不含 "```json"；`orchestrator.getDelegation(toolCallId)` 为 undefined；`store` 里 Task 数为 0；toast 为 `Blocked parent tool: subagent`。
2. 同上，`input` 带 `gate` / `workflow`（旧路径的「复合调用」形态）→ 同样拒绝，reason 相同（不再是 `compositeWorkflowBlockReason` 的文案）。
3. Root `tool_call` `bg_wait`，`input.id` 等于一个真实注册过的 run id（先经旗标路径或直接 `orchestrator` 方法注册一条 pending delegation）→ 拒绝；证明「exact-id 恢复」这条 Idle 例外已不存在。
4. `liveTask` 为假时 `git_audit` `{ operation: "status" }` → hook 返回 undefined（放行）；`planner_recover` → 拒绝；`read` → 拒绝且 reason 带 "```json"（repair 对非委派工具仍在）。
5. `planner_delegate` 在 live 与 Idle 下 hook 都返回 undefined（不跑 `runDelegation`——只测 hook 决策；hook 不会调 execute）。
6. 子进程（`PI_SUBAGENT_CHILD=1` 的实例）调 `subagent` → 放行（`isChild` 短路在旗标判断之前）。
7. `/planner-only off` 后 `subagent` → 放行（`disabled` 短路），再 `on` → 拒绝。

`package.json` 的 `test` 脚本在 `policy.test.mjs` 之后加 `node --experimental-strip-types policy-cutover.test.mjs`。

### B5. 文档两段

- `README.md:195-210`「Idle gather policy」：删 `bg_wait` 相关句（「or recover one registered pending run through an exact-id `bg_wait` (…refused)」），「start a Delegation」改「start a Delegation with `planner_delegate`」，加一句「`git_audit` is allowed while Idle.」；「Every Idle refusal carries a fenced TaskSpec JSON…」改为「Every Idle refusal of an inspect, shell, or mutation tool carries a fenced TaskSpec JSON…; `subagent` and `bg_wait` are refused outright.」
- `CONTEXT.md:54`「Policy」词条：同样去掉 `bg_wait` 分句，加 `planner_delegate` 与 `git_audit`。

其余 README 段（Delegation 词条、WorkerReport 回显）留给 10。

### B6. 宿主验证（旧链不可达）

**环境**：不用 `/tmp`（AGENTS.md）。探针仓库放 `.scratch/typed-delegation/host-05/probe-repo/`，`.gitignore` 加一行 `.scratch/typed-delegation/host-05/probe-repo/`。guard **开着**：环境里没有 `PI_PLANNER_ONLY=0`，没有 off marker，`/planner-only status` 报 on 且 fingerprint 与本地 `computeLoadedFingerprint()` 一致（票 52/53 宿主验证的同一套加载方式）。会话开头记三元组：`pi --version`、pi-subagents `version`（应 0.67.0）、`/planner-only status` 全文。

采集的基线：验证前 `md5sum` 账本文件（`$PI_CODING_AGENT_DIR/planner-only/` 下的 ledger 快照）、`ls -t ~/.pi/agent/sessions | head`、`ls /tmp/pi-subagents-uid-$(id -u)/ 2>/dev/null | wc -l`（只读，不写）。

**检查 1（反例，subagent）** 对 Root 说（逐字）：

> 请直接调用 `subagent` 工具（不要用 planner_delegate），agent=worker，task 写「在当前目录创建 hello.txt，内容为一行 hi」。把工具返回原样贴给我，不要重试。

判定：
- [ ] 会话 jsonl 里有 `name === "subagent"` 的 `tool_call`，紧随的 `toolResult` 文本以 `Planner-only guard` 开头且含 `planner_delegate`；`isError` 的持久化值原样记录（宿主对 hook block 的持久化形态以实际为准，不预设）。
- [ ] 没有新的子进程 session 目录；`pi-subagents-uid-*` 计数不变。
- [ ] 账本 md5 不变；`/planner-only status` 报 no live Task；`hello.txt` 不存在。
- [ ] Root 收到拒绝后的下一步：观察它是否自发改用 `planner_delegate`——记录，不判定（这是 prompt 质量，10 看）。

**检查 2（反例，bg_wait）** 对 Root 说：

> 请调用 `bg_wait` 工具，id 填 `run-does-not-exist`，timeout 1000。把返回原样贴给我。

判定：`toolResult` 文本以 `Planner-only guard` 开头；账本 md5 不变。

**检查 3（正例，guard 开着走新链）** 票 03 检查 1 的 hello.txt 任务，逐字，但**不关 guard**：

> 用 `planner_delegate` 工具派一个 role=worker 的任务：objective「在当前目录创建 hello.txt，内容为一行 `hi`」，scope.allowedPaths=["hello.txt"]，constraints=["只允许创建 hello.txt"]，acceptanceCriteria=["hello.txt 存在且内容为 hi"]，validation={"required":false}。派完把工具结果原样贴给我。

判定：
- [ ] `details.status === "completed"`，`details.report` 存在，`details.taskId` 有值。
- [ ] 账本里该 Task 有一条 execution（kind worker，无 `auxiliary`），usage 行的 `ownerRootSessionId` 记下来（10 的承接项要对账，本票只采集）。
- [ ] Root 会话中**没有** `subagent` 工具调用。

**检查 3b（正例，reviewer 走新链；06 承接项）** 对检查 3 的 Task 接着说（taskId 用检查 3 返回的 canonical id）：

> 对 taskId=<检查 3 的 taskId> 用 `planner_delegate` 派 role=reviewer，审它最新的 WorkerReport。把工具结果原样贴给我。

判定：
- [ ] `details.review.verdict` 存在且是合法枚举值；`details.review.source === "reviewer"`。
- [ ] 账本里该 Task 的 `reviews` 有一条 `source === "reviewer"` 的记录；reviewer 不铸新 Task、不加 execution 记录。
- [ ] Root 会话中这一步**没有** `subagent` 工具调用。

**检查 4（正例，validator auxiliary）** 接着说：

> 对刚才那个 taskId 用 `planner_delegate` 派 role=validator：objective「验证 hello.txt 存在且内容为 hi」，validation={"required":true,"commands":["cat hello.txt"]}。把结果原样贴给我。

判定：
- [ ] 账本里该 Task 的第二条 execution `kind === "validator"` 且 `auxiliary === true`。
- [ ] `/planner-only status` 渲染的「最近 execution」仍指向 worker 那条（这就是 04 承接项要防的误认；`status` 走的是 `orchestrate.ts:1683/1818` 的 `!auxiliary` 过滤）。

**检查 5（Idle 下 git_audit）** 先 `planner_verdict` 把 Task 收掉（PASS 或 BLOCKED 都行，只要进终态），再说：

> 调用 `git_audit`，operation=status。

判定：放行，返回 git 状态文本；对照检查 1 的拒绝证明 Idle 允许集确实是「三工具」而不是「什么都拒」。

### B 段验收

```sh
npm run typecheck && npm test                                                   # exit 0
grep -c 'PI_PLANNER_ONLY_LEGACY_SUBAGENT' index.ts                             # 1
grep -l 'PI_PLANNER_ONLY_LEGACY_SUBAGENT' *.ts *.mjs *.md 2>/dev/null           # 只有 index.ts index.test.mjs policy.test.mjs（本票文件不算）
grep -n 'subagentDelegatesToChildren\|idleWaitRefusal\|authorizedWaitId' policy.ts   # 每个命中都在 legacyDecidePolicy 或其两个 helper 内，新 decidePolicy 里 0 处
grep -n '"subagent"' index.ts                                                   # PLANNER_SAFE_TOOLS 里 0 处；剩下的都在 hook 分支与 tool_result 分支（08 删）
git diff -- '*.ts' | grep -E '^\+.*(JSON\.parse|\.match\(|new RegExp|\.split\()' # 0 行——固定条：本票没有新增任何对 prompt / 子进程输出文本的解析
git diff --stat                                                                 # policy.ts index.ts policy.test.mjs index.test.mjs package.json README.md CONTEXT.md .gitignore + 新文件 policy-cutover.test.mjs
```

B 段一个 commit：`feat(policy): Root's subagent and bg_wait are refused; Idle admits planner_delegate, planner_verdict, git_audit; legacy rules survive only under PI_PLANNER_ONLY_LEGACY_SUBAGENT for index.test.mjs (typed-delegation ticket 05 B)`。宿主验证的采集物放 `.scratch/typed-delegation/host-05/`（jsonl 摘录、账本 md5 前后、status 输出），作为 docs commit 一起交回。

## 交回

A 段：验收四条命令原样输出；`policy.ts` / `delegate.ts` / `index.ts` 的 diff；`PLANNER_PROMPT` 改后全文与字节数。
B 段：验收七条命令原样输出；`policy.ts` 全文（新 `decidePolicy` + `legacyDecidePolicy`）；`policy-cutover.test.mjs` 用例清单；宿主检查 1–5 的采集物与判定框逐条勾选；以及三点说明：(1) 宿主对 hook block 的 `toolResult` 实际持久化成什么样（`isError` 值、文本）；(2) Root 在检查 1 被拒后的自发行为；(3) 检查 4 的 `status` 渲染截图或文本。

## 不做

- 不删旧链代码、不改 `orchestrate.ts` / `task.ts` / `report.ts` / `roles.ts` / `review.ts`。需要它们提供新能力时停下交回。
- 不做 reviewer（06）、不做进度/取消（07）。
- 不改 `tool_result` 的 `bg_wait` 分支（`recordBgWaitChildren` / `recoverPendingRun`）——B 段后 Root 的 `bg_wait` 到不了 `tool_result`，分支自然死，08 删。
- 不给宿主加任何开关：`PI_PLANNER_ONLY_LEGACY_SUBAGENT` 只为测试文件存在，README 不写。

## 承接项（本票复核时看）

- 10 的宿主验收要对账检查 3 采到的 `ownerRootSessionId`（04 承接项）。
- `planner_recover` 拒绝→throw 仍无测试覆盖（09 保留意见 2）：B4 的第 4 条会覆盖它在 Idle 被策略拒绝的路径，但工具自身 `throw` 的路径仍缺一条 `assert.rejects`——若执行方顺手在 `policy-cutover.test.mjs` 里加，交回时说明；否则留给 08 在删工具时一并注销。

## Comments

**2026-09-15 A 段验收（Claude，审核方）。判定：通过。** 四条验收命令在审核方本机独立复跑：`npm run typecheck` exit 0；`npm test` exit 0（fail 0 ×4 段，37 文件）；`grep -n planner_delegate policy.ts` 命中 `ROOT_TOOLS`（:27）与 Idle 放行（:161）两处；`grep -n auxiliary delegate.ts` 命中新增 validator 行（:304）与既有过滤（:351）；`PLANNER_PROMPT` 实测 1785 字节。`git show --stat 10eeb20` 恰好六个文件。

逐点核对：
- `ROOT_TOOLS` 在 `policy.ts` 定义处加，没有在适配层 add；Idle 放行列表加在既有 `if` 上，legacy 结构未动，B 段改名 `legacyDecidePolicy` 时不会有冲突。
- `auxiliary` 一行与票面逐字一致；`delegate.test.mjs` 三处断言（worker / standalone explorer 为 undefined、validator 为 true）覆盖了 04 承接项的正反两面。
- 归因：hook 名单加 `planner_delegate`，`input.taskId` 经 `canonicalTaskId` 进 `rootTurnTaskIds`；execute 返回前 `rootTurnTaskIds.add(outcome.task.taskId)` 补在 `index.ts:1154`，确认 04 确实没做。新用例放文件末尾（:4662 起），`sessionEntries` 先清空再断言 `toolCallIds` / `taskIds`，不扰动前面的顺序断言——处理得当。
- 两处偏离（`:254-257` 的 `before_agent_start` 段断言、末尾新用例）均按票面意图收敛，接受。
- `PLANNER_PROMPT` 四句替换与票面一致；1785 字节，余量 15。

不阻塞的保留意见（一条，**建议在 B 段之前先落一个三行的 A′ commit**）：
1. **prompt 与策略在 A 段窗口内不一致。** 新 Gather 句写「planner_verdict and git_audit stay allowed」，但 `git_audit` 在 Idle 下仍被拒（`policy.test.mjs` 的 Idle 拒绝循环里它还在名单里；审核方实测 `decidePolicy({toolName:"git_audit", liveTask:false})` → block=true）。Idle 放行 `git_audit` 本来是 B 段的事，但 B 段等 06，宿主在这个窗口里会按 prompt 去调 `git_audit` 然后吃到带 repair 的拒绝。这是票面自己的顺序问题，不是执行方的错。修法：`policy.ts:161` 的 Idle 放行加 `git_audit`；`policy.test.mjs` Idle 循环把 `git_audit` 从拒绝名单挪到放行断言；README「Idle gather policy」段加一句「`git_audit` is allowed while Idle.」。三行，单独 commit，B 段的 `IDLE_TOOLS` 定义时自然吸收。

**2026-09-15 B 段开工（规划方决定）。** B 段实现不等 06 验收：B 段改面（`policy.ts` / `policy-cutover.test.mjs` / `index.ts` 旗标一行）与 06 的 `delegate.ts` 无交集；06 验收不通过的最坏结果是宿主验证推迟而非返工；本地七条验收命令不依赖 06。宿主验证（B6 检查 1–5 + 3b）推迟到 06 验收通过后执行，采集物进 `.scratch/typed-delegation/host-05/`。检查 3b 按 06 承接项补入 B6。

**2026-09-15 B 段实现回执（Devin，执行方）。** feat commit `90a1975`（docs 开工 commit `e89200d` 在前）。**宿主检查 1–5 + 3b 待 06 验收后执行**，采集物届时进 `.scratch/typed-delegation/host-05/`；交回要求的三点说明（toolResult 持久化形态、Root 被拒后的自发行为、检查 4 status 渲染）同属宿主观察项，一并推迟。

七条验收命令原样输出：

```text
$ npm run typecheck && npm test
# typecheck exit 0；npm test exit 0（38 文件，29 段 PASS；日志 .scratch/typed-delegation/05b-npm-test.log）

$ grep -c 'PI_PLANNER_ONLY_LEGACY_SUBAGENT' index.ts
1

$ grep -l 'PI_PLANNER_ONLY_LEGACY_SUBAGENT' *.ts *.mjs *.md
index.ts
index.test.mjs
policy-cutover.test.mjs

$ grep -n 'subagentDelegatesToChildren\|idleWaitRefusal\|authorizedWaitId' policy.ts
71:	authorizedWaitId?: string;                     # PolicyInput 字段（票面自带，注释标 legacy）
87/110/114:                                       # 两个 legacy helper（定义与内部引用）
189/227:                                          # legacyDecidePolicy 体内两处；新 decidePolicy 0 处

$ grep -n '"subagent"' index.ts
1397 / 1426 / 1515                               # 归因名单、hook 分支、tool_result 分支；PLANNER_SAFE_TOOLS 0 处（均为 08 删除面）

$ git diff -- '*.ts' | grep -cE '^\+.*(JSON\.parse|\.match\(|new RegExp|\.split\()'
0

$ git show --stat 90a1975
9 files: policy.ts index.ts index.test.mjs policy.test.mjs package.json README.md CONTEXT.md .gitignore + 新文件 policy-cutover.test.mjs
```

`policy-cutover.test.mjs` 用例清单（假宿主照 `index.test.mjs:1-120` 搭法，`PI_CODING_AGENT_DIR` 隔离 + tmpdir，`finally` 语义由文件末尾 `rmSync` 承担）：(1) `subagent` 带合法 TaskSpec JSON 的 `input.task` → `{block:true}`，reason 以 `Planner-only guard` 开头、含 `planner_delegate`、不含 fenced JSON，toast 为 `Blocked parent tool: subagent`，账本 0 Task，迟到的 tool_result 原样穿透（`handleSubagentResult` 无绑定返回 undefined，即 `getDelegation` 为空的可观测代理）；(2) `{gate, workflow}` 复合形态 → 同一 cutover 文案，无 `composite` 字样；(3) 旗标下注册真 pending run（`run-05b-pending`），同 id `bg_wait` 旗标内放行、撤旗标后拒绝且 reason 含 `no asynchronous wait`；(4) Idle：`git_audit` 放行、`planner_recover` 拒绝（reason 含 `idle for gather`）、`read` 拒绝且带 fenced TaskSpec repair；(5) `planner_delegate` 在 live（检查 3 铸的 executing Task）与 Idle 下 hook 均返回 undefined；(6) `PI_SUBAGENT_CHILD=1` 子进程实例整个 no-op（不注册任何 handler，子进程内 subagent 天然不被拦），`isChild` 短路本身由 `policy.test.mjs` 顶部 cutover 段覆盖；(7) `/planner-only off` 后 `subagent` 放行、账本无新增，`on` 后重新拒绝。

与票面的偏差（按意图收敛，逐条）：

1. **`LEGACY_ORCHESTRATION_TOOLS`（私有集合，新增）。** 票面让 `ORCHESTRATION_TOOLS` 缩为 `QUESTION_TOOLS` 且 legacy 函数体「一行不改」——二者不能同时成立：legacy 的 live 放行用 `ORCHESTRATION_TOOLS.has(...)`，缩集会让旗标下的 live `bg_wait` / `contact_supervisor` 变拒绝（`policy.test.mjs` live 段与 `index.test.mjs` 全红）。收敛：导出的 `ORCHESTRATION_TOOLS = QUESTION_TOOLS`（`PLANNER_SAFE_TOOLS` 随之缩小，符合票面），`legacyDecidePolicy` 内改用一个私有 `LEGACY_ORCHESTRATION_TOOLS`（旧六工具）——函数体内仅此一个标识符的替换。
2. **验收命令 3 的文件清单。** 票面预期 `index.ts index.test.mjs policy.test.mjs`；实际 `index.ts index.test.mjs policy-cutover.test.mjs`。`policy.test.mjs` 走 `PolicyInput.legacyDelegation` 字段、不碰环境变量；`policy-cutover.test.mjs` 引用该变量恰为 B4 检查 3 许可的「经旗标路径注册 pending delegation」——只开关两次（铸 run + 对照放行），随即 `delete`，断言全在无旗标路径上。
3. **`index.test.mjs:220` 文案断言。** `blockedReason` 是新旧路径共用函数，票面已预告 `policy.test.mjs` 的文案断言要改；`index.test.mjs` 同句断言一并改为 `/Delegate execution with planner_delegate/`（旗标内语义未动）。
4. **检查 6 的实现形态。** 票面写「`PI_SUBAGENT_CHILD=1` 的实例调 `subagent` → 放行」；实测该实例的 `plannerOnly()` 整体 no-op（`index.ts:347` 提前 return，连 `tool_call` handler 都不注册），适配层无可断言之物——用 spawn 探针断言「子进程实例注册 0 个 handler」（即 subagent 必不被拦），`isChild` 短路顺序另在 `policy.test.mjs` 用 `decidePolicy` 直测覆盖。
5. **检查 1 的 `getDelegation` 断言。** orchestrator 在扩展闭包内不可达，用两个可观测代理代替：同 toolCallId 的迟到 `tool_result` 穿透为 undefined、`ledger/*.json` 计数为 0。

未做的承接项：`planner_recover` 拒绝→throw 的 `assert.rejects` 覆盖（承接项说「顺手可加」）未加，留 08 注销工具时一并处理。`PLANNER_PROMPT` 未再改（A 段措辞对 B 段仍成立；06 票面同注）。
