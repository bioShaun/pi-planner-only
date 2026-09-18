# 01: 子代理面 schema 删除 `evidence.workerRunId`，Root 在接纳边界盖章

Status: resolved
Type: feature（契约变更）
Blocked by: —
来源：../spec.md §Solution 1-4、§Implementation Decisions 1-3、5

**What to build：** 子代理不再被要求（也不再被允许）填写 `evidence.workerRunId`；`runDelegation` 在取出结构化报告后用 `response.runId ?? executionId` 盖章。合规报告因此必然绑定到产生它的 execution；taskId 身份校验和 `unacceptedReport` 机制原样保留。

## 现状（写票时核过，HEAD 33a5c2c）

1. `delegate.ts:437-445` `WORKER_REPORT_SCHEMA.evidence`：`workerRunId: Type.String()` 必填，`additionalProperties: false`。
2. `delegate.ts:1502`：`const report = response.result?.kind === "structured" ? (response.result.value as WorkerReport) : undefined;` —— 这是唯一取值点，也是盖章点。
3. `delegate.ts:1619-1633`：`validateWorkerReportIdentity(report, { taskId, aliases, workerRunId: runId })` → 有错则 `admittedReport = undefined`，报告落 `unacceptedReport`（1691），`reports` 不追加。
4. `delegate.ts:1054-1057` `sampleOptions(workerRunId)`：C_report 采样用 `runId ?? executionId`。
5. `report.ts:99-140` `validateWorkerReportIdentity`：taskId / evidence.taskId / workerRunId 三项比对。`validateWorkerReport`（68-95）不检查 `evidence.workerRunId`，无需改。
6. `orchestrate.ts:2327-2351` `reportIdentityRefusal`：verdict 时对最新 revision 重新推导绑定，接受 `producer.runId` 或 `producer.executionId`。
7. `task.ts:1994-2005` `recordReport` / `recordValidatorReport`：按 `evidence.workerRunId` 去重。
8. `ledger-store.ts:118`：`unacceptedReport.evidence.workerRunId` 必须是字符串。
9. `types.ts:205-209` `EvidenceRef.workerRunId: string`：Root 的采样和 child 报告共用此类型；**不改**。
10. `task.ts:760` packet 文案只给 taskId，对 runId 无说明；**不改**。

## 设计

### schema

`WORKER_REPORT_SCHEMA.evidence` 变为：

```ts
evidence: Type.Object({
  cwd: Type.String(),
  taskId: Type.String(),
  baseGitRef: Type.Optional(Type.String()),
  finalGitRef: Type.Optional(Type.String()),
  gitStatusHash: Type.Optional(Type.String()),
  changedPaths: Type.Optional(Type.Array(Type.String())),
}),
```

`additionalProperties: false` 保留在外层对象上（现状）。**evidence 子对象不加 `additionalProperties: false`，这是已定决定，不是待确认项：**

- launcher（`pi-subagents@0.68.0` `src/runs/shared/structured-output.ts:154`）用 `typebox/compile` 的 `Compile(schema).Check(value)` 校验结构化输出，标准 JSON Schema 语义。
- 当前 evidence 序列化后没有 `additionalProperties` 键。2026-09-18 实测（typebox 1.3.7）：不加 → child 多发 `evidence.workerRunId: "planner-scout"` 通过校验，值到达 Root；加 → launcher 整份拒收 `/evidence must not have additional properties`，报告丢失。
- 一个习惯性多填 `workerRunId` 的 child 不能因为 Root 不需要的字段丢掉整份报告——那正是本 spec 要消除的故障形状。透传值由下面的剥离 + `warnings` 兜底（ADR-0002/0003 同款）。
- 因此 schema 快照测试（下文第 8 条）要断言 `evidence.additionalProperties === undefined`，防止日后"顺手收紧"。

### 盖章（`delegate.ts:1502` 附近）

```ts
const stampedRunId = runId ?? executionId;
const rawReport = response.result?.kind === "structured" ? (response.result.value as WorkerReport) : undefined;
let report: WorkerReport | undefined;
if (rawReport) {
  const { workerRunId: childSupplied, ...childEvidence } = rawReport.evidence ?? {};
  if (childSupplied !== undefined) {
    warnings.push(`evidence.workerRunId is stamped by Root from the launcher terminal; the child-supplied value ${JSON.stringify(childSupplied)} was ignored`);
  }
  report = { ...rawReport, evidence: { ...childEvidence, workerRunId: stampedRunId } as EvidenceRef };
}
```

- `warnings` 是现有数组（1707 处已在用）；若声明位置在 1502 之后，把声明提前。
- 从此处往下的所有路径（identity、`recordReport`、`unacceptedReport`、`compareEvidence`、`advanceReview`、late report、stop_unconfirmed 分支 1544）都只看 `report`，不再接触 `rawReport`。
- `sampleOptions` 的入参保持 `runId ?? executionId`，与 `stampedRunId` 同源；可直接复用同一个常量。

### 身份校验

- `delegate.ts:1619-1624` 调用保持传入 `workerRunId: runId`。盖章后恒等，不会触发；在调用处加一行注释说明"runId 分支是 verdict 时恢复账本的守卫（orchestrate.ts reportIdentityRefusal），接纳路径由盖章保证通过"。
- `report.ts:114` docstring 改为："`evidence.workerRunId` is Root-stamped at admission; the check here guards restored ledgers at the verdict boundary."
- `delegate.ts:1691` `unacceptedReportReason` 文案：`report identity does not match this Task: ${reportError}`（去掉 "or execution"）。

### 不改的

`orchestrate.ts` 全部、`task.ts` 去重、`ledger-store.ts`、`types.ts`、reviewer 的 `review-${executionId}`（`delegate.ts:1919`）。

## 测试（先红后绿）

`delegate.test.mjs`（真实 `runDelegation` seam，fake launcher）：

1. **红**：fake launcher 返回不含 `evidence.workerRunId` 的报告 + `runId: "run-A"`。HEAD 上该报告会被 launcher schema 拒或被 identity 拒；修复后：`task.reports.length === 1`、`reports[0].evidence.workerRunId === "run-A"`、`executions[0].reportIndex === 0`、`executions[0].runId === "run-A"`、state reviewing。
2. terminal 不带 `runId`：盖章值 `=== executionId`。
3. 透传 `evidence.workerRunId: "planner-scout"`：接纳；`outcome.warnings` 含 `"planner-scout"`；账本值为 `runId`。
4. `taskId` 错配（`report.taskId = "T-99999999-999"`）：`reports.length === 0`、`executions[0].unacceptedReport.evidence.workerRunId === "run-A"`、`unacceptedReportReason` 匹配 `/does not match this Task/` 且不含 `execution`。
5. 纠正轮：第一次 `runId: "run-A"` → `request_changes`（通过 fake reviewer 或直接 store 状态）→ `planner_redelegate` 第二次 `runId: "run-B"`；`reports.map(r => r.evidence.workerRunId)` deepEqual `["run-A","run-B"]`。
6. validator 角色：`validatorReports[0].evidence.workerRunId === runId`。
7. 既有 stop_unconfirmed / late report 测试：断言 `unacceptedReport` / `lateReport` 的 `evidence.workerRunId` 为盖章值（补断言，不新建场景）。
8. schema 快照：`WORKER_REPORT_SCHEMA.properties.evidence.properties` 无 `workerRunId`，`.required` 不含 `workerRunId`，`.additionalProperties === undefined`；外层 `additionalProperties === false` 不变。
8b. launcher 边界镜像：用 `import { Compile } from "typebox/compile"`（与 pi-subagents 同一校验器，仓库已有 `typebox` 依赖）编译 `WORKER_REPORT_SCHEMA`，断言 (i) 不含 `evidence.workerRunId` 的合规报告 `Check === true`；(ii) 多带 `evidence.workerRunId: "planner-scout"` 的报告 `Check === true`（能到 Root，由剥离处理）；(iii) 顶层多一个未知键 `Check === false`（外层收紧未被放松）。放在 `delegate.test.mjs` 的 schema 段。

`index.test.mjs`（已注册工具入口）：

9. `planner_delegate` → 报告接纳 → `planner_verdict pass` 落地为 completed；用 `piEvents` 上的 fake launcher，报告不含 workerRunId。
10. 事故重放：三个事故值 `"planner-scout"`、`"T-20260918-004"`、`"not-provided-in-launch-packet"` 作为透传值各跑一次 → 全部接纳且 `warnings` 披露。

`orchestrate.test.mjs`：

11. 恢复一份 child 自填错值（如 `"planner-scout"`）且已在 `reports` 中的旧账本：`restoreFromLedger` 成功；`reportIdentityRefusal` 行为与 HEAD 一致（该 revision 仍会在 verdict 时被 `report-identity` 拒 —— 这是旧数据的真实状态，不迁移）。

现有 127 处 `workerRunId` 测试引用：凡是 fake launcher 报告里手写 `workerRunId` 的，改为不写（让盖章生效）或改断言为盖章值；不要为了少改测试而保留 child 自填路径。

## 验收

1. `npm run typecheck` exit 0；`node --experimental-strip-types delegate.test.mjs`、`index.test.mjs`、`report.test.mjs`、`orchestrate.test.mjs`、`task.test.mjs`、`ledger-store.test.mjs` 各 exit 0（从普通终端跑，见 AGENTS.md）。
2. `rg -n "workerRunId" delegate.ts` 中不再有把 child 值当输入做比对的路径；唯一写入点是盖章。
3. 上面 1、9 两条在改实现前确认为红。
4. `git diff --check` 空。

## Comments

- 2026-09-18 定案 evidence 的 `additionalProperties`：**不加**。实测命令（项目根，typebox 1.3.7）：用 `typebox/compile` 编译去掉 `workerRunId` 后的 `WORKER_REPORT_SCHEMA`，`Check` 多带 `evidence.workerRunId:"planner-scout"` 的报告 → `true`；给 evidence 加 `additionalProperties:false` 后同一报告 → `false`，错误 `/evidence must not have additional properties`。launcher 校验器同为 `typebox/compile`（`pi-subagents/src/runs/shared/structured-output.ts:154`，typebox 1.1.38），语义一致。
- 2026-09-18 开票。注意 02 未落地前，`index.test.mjs` 里所有走 `planner_delegate` 的用例仍需通过 `pi-subagents:delegation-capability-probe:v1` 监听器或 `deps.launcherCapabilities` 绕过门禁（现有 fixture 已这么做，`index.test.mjs:1140`、`delegate.test.mjs:83`）；02 删门禁时一并删这些绕过。
- 2026-09-18 实施完成。WORKER_REPORT_SCHEMA.evidence 删除 workerRunId；delegate.ts 中 stampWorkerReport 在接纳及 terminal 边界执行盖章；透传值剥离并在 warnings 中披露；身份校验保留 taskId/evidence.taskId，runId 守卫恢复账本；用例 1-6、8、8b、9、10、11 全部先红后绿通过。
