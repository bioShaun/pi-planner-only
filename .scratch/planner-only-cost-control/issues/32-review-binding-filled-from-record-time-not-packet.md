# 32: 绑定补齐取的是记录时的值，不是 reviewer 拿到的那份 ReviewRequest

**What to build:** 工单 27 的方案二在记录前给缺失的 `reportRevision` / `workspaceDigest` 补值，
但 `orchestrate.ts:1787-1791` 构造的 `expectedBinding` 用的是**记录时**的
`task.reports.length` 与 `task.snapshot.digest`，而不是 reviewer 当初收到的那份 ReviewRequest 里的值
（`roles.ts:523-525` 在委派时写入）。`review.ts:217-220` 的注释却写着
「fill omitted FR-03/D09 bindings **from the ReviewRequest the reviewer was shown**」——
注释描述的语义与代码实际做的事不是一回事。

**今天不是漏洞，但只靠一层隐式耦合撑着。** planner 实测（`p12-r054-probe.log`）：
同一个 Task 一旦开始新的委派，未结的 reviewer 委派会被从 `delegations` 里丢掉，
其后送达的 reviewer 结果被 `handleSubagentResult` 的 `if (!delegation) return;` 直接丢弃
（探针输出：新 worker 委派前 `true`、之后 `false`，`reviews.length` 为 0、状态仍 `reviewing`）。
所以「包里的 revision」与「记录时的 revision」今天必然相等。
一旦这条一 Task 一委派的锁被放松（并发委派、reviewer 与 worker 并行、跨 alias 的报告落账），
补齐就会把一份 reviewed revision N 的 PASS 盖章成 revision N+1 —— 正是 FR-03/D09
（以及 `orchestrate.test.mjs` 里 T-20260905-996 那条「stale PASS 不得完成 Task」）要堵的洞，
而且**不会有任何测试变红**：996 那条走的是 reviewer 显式写了 revision 的路径。

**Blocked by:** None（源码在 `p12-r054` 收口后的工作区 / 重提交后的 HEAD）。

**Status:** ready-for-agent

- [ ] 补齐的取值来源改为 reviewer 实际收到的那份 ReviewRequest（委派记录里已有 `request`，
      见 `roles.ts:350-351`）；取不到包时**不得**退回用记录时的值静默补齐，
      要么按现有 pass 缺失校验拒收，要么在回执里说明为什么退回是安全的。
- [ ] 新增用例：委派时 revision 为 N、记录时 Task 已有 revision N+1 的情况下，
      一份**不含绑定字段**的 pass 不得被记成 N+1。因为现有的一 Task 一委派锁挡住了这条路，
      用例要么直接调用补齐函数与校验（绕开委派锁），要么显式构造两条并存的委派；
      **不许为了让用例可达而放松锁本身**。
- [ ] `review.ts` 里 `bindReviewResultFromRequest` 的注释与实际取值来源一致。
- [ ] 工单 27 落地的行为逐字不变：合同字段 pass 仍能走到 `completed`
      （`index.test.mjs` 末尾那条端到端一行不改仍绿），两条 mismatch 分支仍拒收，
      `orchestrate.test.mjs` 里 T-20260905-996 / 997 一行不改仍绿。
- [ ] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。

来源：planner 验收工单 27 的方案二交付时发现（2026-09-08，round_id=p12-r054）。
planner 一开始判定这是阻塞级缺陷，写探针实跑之后才确认「今天不可达」——
先跑探针再下结论这一条，是工单 28 初版写反成因之后立的规矩，本票是它第二次生效。

优先级：低于 28/29/30，高于 26。属于「今天正确、但正确性来自别处的隐式约束」那一类，
留着不修不影响 08 重跑。

round_id=p12-r054（开票）

---

## 2026-09-08 planner 复核（派活前实跑核验，未改判）

指向修复点的那句括注不准确，派活前先在此更正，避免执行者按错的位置动手：

- `roles.ts:344-354` 的 `request?: ReviewRequest` 属于 **`DelegationTarget`**——
  `resolveDelegationTarget()` 每次解析委派输入时现算的临时结果，**不是**留在委派记录里的字段。
- 真正被持久化的是 `orchestrate.ts:236-262` 的 `DelegationRecord`，它今天**只**存了
  `packetTruncated?: boolean`（`orchestrate.ts:719-732`），没有存包里的
  `reportRevision` / `workspaceDigest`。
- 但包本身在同一处就在作用域里：`orchestrate.ts:719` 的 `const packet = extractReviewRequest(...)`。
  所以修法是在 `:722` 那次 `this.delegations.set(...)` 里把包里的绑定值（或整包）一并存下，
  再在 `handleReviewerResult(task, text, record)` 里取用——该函数三处调用点
  （`:1375`、`:1642`、`:1689`）都已经把 `DelegationRecord` 传进去了，取值链是通的。
- `packet` 可能为 `undefined`（reviewer 委派没带 ReviewRequest）；这种情况按正文第 1 条办：
  **不得**静默退回记录时的值。

其余事实复核无误：`orchestrate.ts:1810-1813` 的 `expectedBinding` 确实取记录时的
`task.reports.length` / `task.snapshot.digest`；`review.ts:216-217` 的注释确实写的是
"from the ReviewRequest the reviewer was shown"；`types.ts:240-243` 证明 ReviewRequest
本身带 `reportRevision` / `workspaceDigest`。结论不变：今天不可达，属低优先级。

round_id=p13（08 第六次重跑期间的只读复核；重跑未结束前不得派会改主树源码的轮次，
插件是从主树加载的，跑中改源码会污染这次验收）

---

## 2026-09-08 planner 派活前实跑探针（第二次复核，更正上一次的修复点并补决策）

上一次复核说「修法是在 `orchestrate.ts:722` 把 `:719` 的包存下来」。这次在
`/project/tmp/pplan-t32-probe`（HEAD `faf4a7c` 的 detached worktree）里加探针实跑 `npm test`
之后确认：**这个修复点是对的，但理由和上一次写的不一样，而且直接决定了「取不到包」该怎么办。**

**1. `:719` 的包确实就是 reviewer 看到的那一份。** `index.ts:895` 先调
`orchestrator.prepareRoleDelegation(event.input)`——它**原地改写** `event.input`，
把 Root 的原始 prompt 换成 `roles.ts:511-529` 用 `buildFreshReviewerTask` 生成的包；
随后才调 `beginDelegation(event, …)`，所以 `:719` 的 `extractReviewRequest(delegationPrompt(input))`
读到的是**改写后**的包。生产路径上这份包必然带 `reportRevision`
（`roles.ts:523` 无条件写 `target.task?.reports.length ?? 0`）。

**2. 实测分布（`npm test` 全量，探针记在 `.scratch/planner-only-cost-control/t32-packet-provenance-probe.txt`）：**
37 次 reviewer 委派里 **9 次有包、28 次无包**；25 次走到补齐点，其中 reviewer **省略** revision 的只有 2 次：

| 用例 | 包 | reviewer 省略 revision？ | 现状 |
|---|---|---|---|
| `index.test.mjs` T-20260908-027（工单 27 端到端） | 有（rev=2） | 是 | 走 `index.ts` 全链，包与记录时值相等 |
| `orchestrate.test.mjs` T-20260905-998（工单 27 单测） | **无** | 是 | **直接调 `beginDelegation`，跳过了改写** |
| `orchestrate.test.mjs` T-20260905-500 | 有但 rev=undefined | 否 | 不走补齐，不受影响 |

所以那 28 次「无包」**全部来自单测直调 `beginDelegation`（fixture 走位），不是生产路径**。

**3. 由此定下取不到包时的做法（本票正文第 1 条的二选一，选「拒收」那支）：**
记录里没有可用的包绑定（包缺失，或包里没有 `reportRevision`）时**一律不补齐**，
让现有的缺失校验按原样拒收，并在拒收回执里说明「这次委派没有可用的 ReviewRequest 绑定，
请重新委派 review」。**不得**退回记录时的 `task.reports.length` / `task.snapshot.digest`。

**4. 因此 `T-20260905-998` 这条 fixture 必须一起改，且只能往「更像生产」的方向改。**
它今天能绿，靠的正是本票要堵的那条退路；它自己的注释还写着
「bound by orchestration from the ReviewRequest the reviewer was shown」——注释是对的，代码不是。
探针已实跑证明改法可行：把委派输入提出来，先 `await orch.prepareRoleDelegation(input)` 再
`beginDelegation`，包立刻变成 `rev=1 dig=9ebdfcd9615208a5`，`orchestrate.test.mjs` 仍 **PASS**：

```js
const probeInput = { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) };
await orch.prepareRoleDelegation(probeInput);
await orch.beginDelegation({ toolCallId: "call-t8-4r", input: probeInput }, BASE);
```

**不许**为了让 998 继续绿而保留记录时退路，也**不许**把 998 删掉了事。

round_id=claude-pD-2026-09-08-verify-32
