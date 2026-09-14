# 被 stopped 的子运行：其已产出的合规 WorkerReport 被丢弃，任务被置 failed 且无法收口

Status: verified

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

## Comments

### 2026-09-14 — 裁定与修复（待宿主验证后由 Root 翻 verified）

**设计裁定**（对应「设计问题」1/2/3）：采用「产物优先于通知文本」。stop 通知文本只是控制面信号；子运行在被 stop 前已完整写出的合规报告**可验收**——它不绕过任何下游闸门（`extractWorkerReport` 身份绑定、C_report 证据采样、`no-report` 裁定闸门全部照旧）。产物缺失、多义（同一 runId 多于一个候选）或不合规时**维持 fail-closed**，任务照旧置 failed。

**修复**（本地 typecheck + 全部 33 个测试套件 exit 0）：

1. `orchestrate.ts` `handleAsyncNotify` stopped 分支：preview 抽取失败时，回退读取该 run 的确定性保存产物 `<runId>_<agent>_output.md|json`（`delegationArtifactDirs`，即 session `subagent-artifacts/` 等）。读到且合规则以产物文本走正常 kind 分发（worker/validator/explorer/reviewer），任务进入 `reviewing` 而非 `failed`。
2. 守卫改为 kind 感知：reviewer 的合规载荷是 ReviewResult（`extractReviewResult`），其余kind 仍是 WorkerReport。此前 stopped reviewer 即使 preview 里带完整 ReviewResult 也必死。
3. `planner_recover`（`reingestOriginalReport`）的产物扫描从「kind 默认 agent 名」改为**按 runId 匹配**（`findRunOutputArtifacts`）——本票事故中产物名为 `*_reviewer_output.md` 而 execution.kind 的默认 agent 不是 reviewer，这正是两次 recover 均无功的原因。
4. 新 helper（`notify.ts`）：`findRunOutputArtifacts`（按 runId 前缀 + `_output.md|json` 后缀，大小上限、不随符号链接、多候选即歧义）与 `readRunOutputArtifact`。

**测试**（`orchestrate.test.mjs`，ticket 12-a..d）：stopped+合规产物→recording；stopped+不合规产物→failed（fail-closed）；stopped+双 agent 产物→歧义 fail-closed；recover 按 runId 命中非默认 agent 产物。

**残留风险**：salvage 仅覆盖 async-notify 路径；sync 前台路径的 `text` 本来就是子运行真实输出，不存在同一缺陷。`hasExplicitReference && resolution pending` 分支（显式 outputRef 读取失败）不在本票范围。

### 2026-09-14 — 宿主验证通过，翻 verified

宿主 session `01a09e5d-853a-742c-99b6-f963c4665186`（session 文件 `2026-09-14T05-22-04-219Z_…`），worker run `596c94a5-c211-4e58-b952-6a5afda4c31c`（verification-only，changedFiles=[]）：HEAD 确认为 `f6e9786`，`npm run typecheck`、`notify.test.mjs`、`orchestrate.test.mjs`（含 12-a..d）、`completion.test.mjs` 全部 exit 0。Root 独立复跑三件套 + `git status` 核对：树在验证前后 byte-identical（仅既有未跟踪 `.scratch/` 目录），结论与 WorkerReport 一致。

注：本 session 的 planner-only 未接管 subagent 委派（worker 以纯 pi-subagents 运行，无 Task 落账），故本次验证未走 Task 生命周期/裁定闸门，证据为宿主实跑 + Root 独立复跑。运行中的扩展副本（`~/.pi/agent/git/…` @ `09071ab`）尚未包含本修复，推送与 `pi update` 待 operator 执行。
