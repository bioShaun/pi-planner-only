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
