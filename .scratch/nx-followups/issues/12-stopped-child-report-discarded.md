# 被 stopped 的子运行：其已产出的合规 WorkerReport 被丢弃，任务被置 failed 且无法收口

Status: needs-triage

## 现象

一个子运行已经写出**完全合规的 WorkerReport**（`taskId` 正确、`status: "completed"`），但随后被 stopped。任务被置为 `failed`，`reports` 恒为 0，此后 `planner_verdict pass` 必然撞上 `no-report` 拒绝（`orchestrate.ts:3457`，`task.reports.length === 0` 时只接受 `blocked`）。该任务因此**永远无法收口**，`planner_recover` 两次也未改善。

即：不是「报告丢失」，而是**报告存在但从未进入任务**。

## 复现证据

真实 session `2026-09-14T04-34-15-559Z_01a09e31-bf87-763f-a358-91330d4786e1`，Task **T-20260914-006**（PR #9 的独立评审任务，`spec.role = "explorer"`）：

- ledger `~/.pi/agent/planner-only/ledger/T-20260914-006.json`：
  - `state: "failed"`，`stateReason: "subagent stopped (stopped): Subagent stopped by user."`
  - `reports: 0`，`rawReport: false`
  - `reviews: 4 × pass(root)` —— 4 次 pass 均被记录，但无法完成
  - `executions[0]`：`aRun` 存在、**`cReport: false`**、`auxiliary: null`、`reportOnly: null`
- 子运行产物**存在于磁盘且合规**（两份，与「两次发出合规报告」吻合）：
  - `~/.pi/agent/sessions/--public-pi-pi-planner-only--/subagent-artifacts/9d15ebb9-323c-43d2-99eb-def582186170_reviewer_output.md`
  - `.../827c94b2-2607-4c55-98aa-698ce77e3f17_reviewer_output.md`
  - 内容均以
    `{"version":1,"taskId":"T-20260914-006","status":"completed","summary":"Fresh review of PR #9 found ..."`
    开头
- 置 failed 的确切代码路径：`orchestrate.ts:4634-4646`

```ts
if (isBudgetOrStopped && !extractWorkerReport(chosen, { expectedTaskId: found.record.taskId }).ok) {
    const task = this.store.get(found.record.taskId);
    if (task && !isFinalTaskState(task.state)) {
        this.store.transition(task.taskId, "failed");
        this.store.setStateReason(task.taskId, `subagent stopped (${parsed.status}): ${...}`);
    }
    ...
}
```

`chosen` 是主机发来的 **stop 通知文本**（本例即 `Subagent stopped by user.`），不是子运行的产出。对该文本做 `extractWorkerReport(...).ok` 必然为 false，于是走 failed 分支；而被 stopped 的子运行写出的输出产物**在这条路径上从未被读取**。守卫本意是「stopped 载荷里若含合规报告就不要判 failed」，但它只检查通知文本，拿不到产物。

## 设计问题

1. 这条判定是否应当退回到子运行的**输出产物**（`subagent-artifacts/*_output.md`）再决定？本例中产物合规且 taskId 正确，仅因「随后被 stop」就被丢弃。
2. 被 stopped 的子运行，其**在被 stop 之前已完整产出**的报告，是否应视为可验收证据？两种立场的取舍需要明确：
   - 视为不可验收（fail-closed）：那么本票不是缺陷，但应在停止早期就避免产生「产物明明完整」的误导，并且 `planner_recover` 不应反复提示可恢复；
   - 视为可验收：那这条路径需要一个「产物优先于通知文本」的 fallback。
3. `planner_recover` 对「已产出产物但通知为 stopped」的子运行应做什么？现任判断是「未确认停止就不释放写锁」，与「产物已存在」的事实没有交叉。

## 非本票范围（已实测排除，避免误立）

「`spec.role: "explorer"` 的独立 TaskSpec 会生成永远无法 completed 的死形状」—— **不成立**，已用本地探针加 mock GitRunner 实测：

```
role=worker    agent=worker    state=changes_requested  reports=1
role=explorer  agent=explorer  state=reviewing          reports=1
role=explorer  agent=worker    state=reviewing          reports=1
```

explorer 角色的任务正常绑定 WorkerReport，也能进入可裁定状态。`validateTaskSpec`（`task.ts:521`）允许该角色是正确的。

## 关联

- **T-20260913-046**：同为「lifecycle 无法收口 + `reports` 与裁定不匹配」的观测点，但成因不同（那张票是 rebase 抹掉基线导致比较恒 stale），不可合并处理。
- `orchestrate.ts:3457` 的 `no-report` 拒绝是**正确的**闸门：无报告不应被 pass。本票问的是「报告为什么没进来」，不是要求放宽该闸门。
- 与 ticket 43/44 的 TaskSpec 契约收紧同属「入口/边界」类问题，但方向不同（那张是拒绝不该出现的东西，本票是没接住已经出现的东西）。
