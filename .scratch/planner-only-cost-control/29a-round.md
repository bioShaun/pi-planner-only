[轮次] round_id=PLACEHOLDER

**先做一件事：丢掉你上下文里关于本项目的一切既有印象。** 这一轮**没有**自动清空你的上下文
（pairctl 对 cursor 没有可靠的清空命令），所以请你自己做到：忽略你记得的一切先前轮次，
只按下面这份工单办事。它是自足的，你需要的信息全在这里。
你上次在这个仓库里做的是另一张工单（worker 合同示例），**与本轮无关，不要沿用那次的结论**；
期间已经有三次提交落地，你记忆里的行号和文件内容很可能已经过期 —— 一切以当前工作区为准。

## 你是谁、报给谁

你是本轮的**执行者**（Executor），pane `w2E:pE`（cursor）。
Planner 的 pane 是 **`w2E:pD`** —— 这是回执地址，做完必须用
`herdr agent prompt w2E:pD --message '<回执>'` 把报告送回来。
你自己的 pane 里写报告没人看得到。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`（git 仓库，分支 `planner-only-cost-control`，
当前 HEAD `76689a3`）。

## 环境规则（逐字遵守，你的全局规则文件可能没被加载）

- **禁止在 `/tmp` 或其子目录下创建任何中间文件、临时文件、临时目录、缓存、构建暂存输出或任务产物。**
  任务级中间文件放当前工作目录下一个名字清楚的可丢弃子目录；需要放在工作目录之外时用 `/project/tmp`。
  这条规则同样适用于你调用的 shell 命令、脚本、子进程和你委派出去的子代理。
  （原因：`/tmp` 是 62G 的 tmpfs，写进去直接占物理内存。）
- **预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交**，
  例如 `slot cpu -- npm test`。本轮的验收命令必须走 `slot cpu`。
- **每次启动重任务前必须先运行 `slot audit` 和 `slot status`，并把输出写入项目日志。**
  日志放 `.scratch/planner-only-cost-control/`，命名 `p12-r058-slot-audit.log` / `p12-r058-slot-status.log`。
  **禁止先启动重活、事后再补查。**
- **`slot audit` 若发现绕过 slot 的其他重进程，不得擅自终止**；应等待、降低本任务并发，
  或在回执里报告资源冲突。把发现的进程写进回执。
- 不要用 `slot slots` 调大槽位数来给自己插队。

## 凭据禁令

`.agent-dir/models.json` 与 `.agent-dir/auth.json` 存有 provider API key。
**不得读取、不得回显到回执里、不得提交。** 本轮任何工作都不需要它们。

## 背景：这个插件是干什么的

`pi-planner-only` 是一个让主模型只做规划、把执行下放给便宜子代理的插件，专题目标是**省 token**。
省下来多少必须能量出来，所以子代理的花销要如实记进账本 `usage.jsonl`。

## 本轮要修的缺陷（工单 29 的 (a) 部分）

**oracle／validator 子代理一次都没进过账本。** 第五次 08 重跑的产物
`.scratch/planner-only-cost-control/phase-a-08-run5/artifacts/usage.jsonl` 里，
5 条记录的 children `(kind, agent)` 分布是 `{('worker','worker'): 22, ('reviewer','reviewer'): 3}`
—— oracle 一次都没出现。6 次 oracle 委派花掉 **$0.25224**，账本认为它们不存在。
（以上数字 planner 已在自己 pane 里重跑核对过，不是抄的。）

**根因已定位到具体行，你可以直接去看：**

`orchestrate.ts:751-780` 是「未绑定 validator」分支。它给委派记的 `taskId` 在 `:757-759`：

```ts
const placeholder = specId
    ?? (named.length === 1 ? named[0] : undefined)
    ?? `unbound-validator-${event.toolCallId}`;
```

然后 `:764-779` 的 `this.delegations.set(...)` **整段没有 `accountingTaskId` 字段**。
全文 `grep -n accountingTaskId orchestrate.ts` 只有两处命中：类型声明 `:231`、explorer 分支 `:922`。

而 `index.ts:452-453`：

```ts
function accountingTaskId(record: DelegationRecord): string {
    return record.accountingTaskId ?? record.taskId;
}
```

这个函数在 `index.ts:459 / 511 / 534 / 848 / 858 / 903 / 911` 七处被调用，
是费用挂到哪个 Task 上的唯一决定点。于是未绑定 validator 的费用被记到一个
**store 里根本不存在的幽灵 Task** 上，永远写不进真实 Task 的 `usage.jsonl`。
实测佐证：run5 的 `usage.jsonl` 里 taskId 全是 `T-20260908-001`，
`grep -c unbound-validator` 为 **0** —— 钱既不在真 Task 里，也没单独落一条。

**同一个坑 explorer 已经填过了**，对照实现在 `orchestrate.ts:914-927`：

```ts
} else if (role === "explorer") {
    // An explorer binds to no Task: it is read-only and needs no
    // writer contract, so mirror the unbound-validator placeholder
    // instead of creating a placeholder Task for a read-only pass.
    const accountingTask = this.store.activeForCwd(cwd) ?? active;   // :918
    this.delegations.set(event.toolCallId, {
        taskId: `unbound-explorer-${event.toolCallId}`,
        kind: "explorer",
        ...(accountingTask ? { accountingTaskId: accountingTask.taskId } : {}),   // :922
        ...
```

`store.activeForCwd` 在 `task.ts:488`。

为什么 run5 六次 oracle 全走了未绑定分支：Root 从未嵌入 TaskSpec（那是另一张工单 30，
本轮不管），委派里没有 Task 可绑，`reviewed` 为空，直接落进 `if (!reviewed)`。

## ⚠️ 一个不能照抄的地方（这是本轮最容易做错的点）

**不要无条件照抄 explorer 那一行。** explorer 的 `taskId` 恒为合成串，怎么改都不会冲突；
validator 的占位串有**三种**来源，只有第三种是合成幽灵：

| 占位串来源 | 是什么 | 挂账应该怎么办 |
|---|---|---|
| `specId` | 委派自己声明的真实 Task id | **不得改挂** |
| `named[0]`（提示里恰好点名一个 Task） | 同上 | **不得改挂** |
| `unbound-validator-<toolCallId>` | 合成幽灵，store 里不存在 | 需要挂到真实活动 Task 上 |

如果无条件写 `accountingTaskId = store.activeForCwd(cwd) ?? active`，那么当占位串本来是
有效的 `specId`（比如 `T-002`）而当前 cwd 的活动 Task 是 `T-001` 时，
费用会被从 `T-002` **改挂到 `T-001`** —— 把一条今天正确的路径改错。
你必须处理这个区别，并在回执里说明你的判据（按占位串是否为合成串？按 store 里是否存在？
两者不等价，选哪个都行，但要给理由）。

## 本轮**不做**的部分

工单 29 还有一个 (b)：「最后一次落账之后跑的子代理全部丢失」（会话在 Task 非终态下结束时
没有兜底落账）。**(b) 明确不在本轮范围内**，会另开一轮。不要顺手去改
`index.ts:782-786` 的 `session_shutdown`，也不要动 `flushIfTerminal`。

## Fence（可改文件）

**可以改：** `orchestrate.ts`、`orchestrate.test.mjs`、`index.test.mjs`、`usage.test.mjs`。

**只读，不许改：** `index.ts`、`usage.ts`、`task.ts`、`types.ts`、`report.ts`、`roles.ts`、
`review.ts`、`report.test.mjs`、`roles.test.mjs`、`package.json`。
如果你认为其中某个非改不可，**停下来在回执里说明理由**，不要自己改了再解释。
（`report.ts`/`roles.ts`/`types.ts` 刚在上一轮落地了两个门槛修复，本轮碰它们风险很高。）

`.scratch/` 下的一切**只读**（可以读产物、写你自己的日志，但不许改任何工单文件、
不许勾 08 的 checkbox、不许改 08 的 Status、不许改 `spec.md`）。

**不要提交。** 不要 `git commit`、不要 `git add`、不要新建分支。Planner 在自己 pane 里提交。
**送出回执之后就不要再动工作区**（planner 会比对哈希，中途变动会导致打回）。

## 验收条款（逐条都要满足）

- [ ] 一次含 oracle／validator 委派、且该委派**未绑定任何 Task**（走合成占位串那条路）的运行结束后，
      该子代理的 runId 与 costUsd 出现在真实活动 Task 的 `usage.jsonl` 记录的 children 里。
- [ ] **占位串是 `specId` 或单个 `named[0]` 时，挂账目标不变**：测试要覆盖
      「占位串是一个 store 里存在的 specId，且它与当前 cwd 的活动 Task 不同」这一情形，
      断言费用仍记在 specId 上，不被改挂到 `activeForCwd` 上。
- [ ] 覆盖「同 cwd 没有任何活动 Task」的情形：此时**不得静默丢弃**费用，
      也**不得挂到别的 cwd 的 Task 上**。你选择的行为写进回执并说明理由。
- [ ] 已绑定 validator（`resolveValidatorReviewedTask` 返回了 Task）的既有行为**逐字不变**。
- [ ] 不重复计数：同一 runId 只出现一次。
      `index.test.mjs:3372-3427`（注释标 `p11-r052`：未绑定的 async explorer 其费用必须
      **恰好一次**记到真实 Task 上）**一行不改**仍然全绿 —— 那是本轮改动的近邻路径，
      它绿不绿是你有没有碰坏 explorer 挂账的直接信号。
- [ ] **修复前新增用例必须失败**，回执里贴出失败输出**原文**（文件名、行号、断言原文、actual/expected）。
- [ ] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## 验收命令（必须实跑，四条都要 exit 0）

```bash
slot cpu -- bash -c 'npm run typecheck && npm test && npm run test:e2e && git diff --check'
```

## 回执要包含

1. `[轮次] round_id=<本轮 id>`、你的 pane、当时的 HEAD。
2. 你对「占位串三种来源」那个判据的选择与理由。
3. 「同 cwd 无活动 Task」时你选择的行为与理由。
4. `git diff --numstat` 的完整输出。
5. RED 的失败输出**原文**。
6. 四条验收命令的实际退出码。
7. `slot audit` / `slot status` 预检结果，含发现的绕过 slot 的进程（未终止）。
8. 任何你想改但被 fence 挡住的文件，以及理由。

**不要在报告里复述你没有实际跑过的结果。** 我会在我的 pane 里逐条复现你贴的证据，
对不上的部分会打回重做。
