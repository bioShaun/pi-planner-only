# typed-delegation：把 Root/子进程合同从 prompt 文本改为类型化数据

决定见 [ADR-0001](../../docs/adr/0001-typed-delegation-contract.md)。诊断见 2026-09-15 会话结论：45→53 这一串票是同一个设计缺陷（合同寄生在 `subagent` 工具的 `task` 字串上，靠启发式解码、原地改写、再解码）的不同切面，逐票修补不收敛。

## 角色

- **规划 / 审核**：Devin。写票、定验收口径、审每一轮的产物；不改 `orchestrate.ts` / `task.ts` / `report.ts`。
- **执行**：operator（本人，或由 operator 派给任一执行 agent）。每轮只做票面范围，产物落盘，把票里「交回」一节列出的东西原样交回。

## 冻结（立即生效）

1. `.scratch/planner-only-cost-control/` 不再开新票、不再往 `beginDelegationInner` 加门。既有 verified 票不动。
2. 宿主上继续用现版本（`fix/ticket-52-refusal-attribution`）跑日常任务没问题；遇到新故障**只记录不修**，记到本目录 `deferred.md`，等 spike 判定后统一处理。

## 轮次

| 轮 | 票 | 目的 | 判定人 |
|---|---|---|---|
| 0 | [01](issues/01-test-tempdir-hygiene.md) | 测试临时目录卫生；顺手确认执行/交回流程跑得通 | Devin |
| 1 | [02](issues/02-spike-planner-delegate-tool.md) | 写 spike 扩展：`planner_delegate` 类型化工具 + 结构化委派 API，零 prompt 解析 | Devin |
| 2 | [03](issues/03-spike-host-run.md) | 在真实 pi 宿主上跑 spike，正例 + 反例，回答 ADR 的三个未知 | Devin |
| 3 | （spike 通过后再开） | 迁移计划：拆 `orchestrate.ts` 拦截链、接 ledger / evidence / review loop 到新工具 | Devin 写票 |

每轮的验收命令写在票里，执行方交回前**自己先跑一遍**；审核方按同一命令复核，不接受「本机全绿」以外没有命令输出的口头结论。

## spike 要回答的三个未知（票 03 的产出）

1. 从 `registerTool().execute` 里 emit `SUBAGENT_DELEGATION_REQUEST_EVENT` 能否拿到终态响应？（文档只排除了「在 `tool_call` hook 里递归调 `subagent` 工具」，未提 execute。若返回 `unavailable_context`，回退方案是 RPC `spawn` async + `events.asyncComplete`，另开票。）
2. 结构化返回是否真的由 launcher 做 schema 校验：故意让子进程只回 prose，状态是否为 `structured_output_failed`、`result` 是否为空。
3. 前台委派阻塞 Root 一个工具回合，对一个 1–3 分钟的 worker 任务是否可接受（UI 是否有进度、能否取消、超时）。

## 轮 3：迁移（2026-09-16 定，spike 三个未知已答，ADR-0001 accepted）

**策略：绞杀（strangler），不重构。** 新模块 `delegate.ts` 在旧拦截链旁边长出来，接 `planner_delegate` 工具；Policy 把 Root 的 `subagent` / `bg_wait` 直接拒掉，旧链变成不可达；最后整块删。不改 `beginDelegationInner` 一行——它只会被删。

### 模块去向表

| 模块 | 去向 | 说明 |
|---|---|---|
| `types.ts` | 留 | 合同类型不变 |
| `task.ts` TaskStore / TaskIdAllocator / `createTaskSpec` / workspace identity | 留 | 删 `extractTaskSpec*`、`topLevelJsonCandidates`、`inferTaskRoleFromAgent` 及其测试 |
| `ledger-store.ts`、`workspace-snapshot.ts` | 留 | |
| `evidence.ts`（`captureEvidence` / `compareExecutionTruth` / `compareFreshness` / `captureReviewEvidencePacket`） | 留 | Root 自己的 Git 采样，是本插件真正的价值 |
| `review.ts` `decideReview` / `applyReviewDecision` / `advanceReview` / `buildReviewRequest` | 留 | 删 `extractReviewRequest` / `extractReviewResult`（文本解析）；ReviewResult 走结构化返回 |
| `usage.ts`、`role-models.ts`、`floors.ts`、`git-audit.ts`、`concurrency.ts` | 留 | usage 的 child 记账改从 `SubagentDelegationUsage` 直接取 |
| `policy.ts` | 改 | Root 允许集 = `planner_delegate` / `planner_verdict` / `git_audit` / `git_commit` / 只读工具；`subagent`、`bg_wait` 一律拒；不再读 prompt |
| `roles.ts` | 缩 | 留 `ROLE_AGENTS`（explorer→`scout`）、`buildTaskPacket` 单向渲染；删 `TASK_ID_RE` / `promptTaskIds` / `resolveDelegationTarget` / `isReportOnlyPrompt` / `extractTaskPacket` / `stampCanonicalTaskId` / `stripDelegationKeys` |
| `report.ts` | 缩 | 留 `validateWorkerReport` / `validateWorkerReportIdentity` / `stableStringify`；删 `jsonCandidates` / `scanBalancedObjects` / `extractFinalAssistantText` / `repair*` / `normalizeWorkerReport` 的修复分支 |
| `orchestrate.ts` | 删大半 | `beginDelegation*`、`prepareRoleDelegation`、`handleSubagentResult`、`handleAsyncNotify`、`registerCompletionReceipt`、`recoverPendingRun`、`reingestOriginalReport`、`reconcilePendingDelegations`、`authorizedWaitId`、`resolveValidatorReviewedTask` 及 18 个拒绝码里的 `RUN_*` / `OUTPUT_*` / `REPORT_TARGET_UNBOUND` / `VALIDATOR_*` / `FOREIGN_RECEIPT`；留 verdict、status 渲染、ledger restore、预算、并发状态 |
| `notify.ts`、`completion.ts`、`reservations.ts`、`acceptance-claims.ts` | 删 | 全是异步收据机制的产物 |
| `index.ts` | 改 | 删 `tool_call` 里的 `subagent` 拦截分支、`tool_result` 的 subagent 分支、`message_end` 的 notify 解析、`planner_recover` 工具；加 `planner_delegate`；所有工具 `isError: true` 改 throw |
| `spike/` | 删 | 内容并入 `delegate.ts` 与 `subagent-delegation-contract.ts`（后者移到根目录） |

### 新 seam：`delegate.ts`

一个纯编排函数 + 一个薄的工具注册：

```ts
export interface DelegationDeps {
  store: TaskStore; gitRunner: GitRunner; concurrency: ConcurrencyController;
  launch: (req: SubagentDelegationRequest, signal?: AbortSignal) => Promise<SubagentDelegationResponse>;
  now?: () => Date;
}
export async function runDelegation(deps: DelegationDeps, params: PlannerDelegateParams, cwd: string): Promise<DelegationOutcome>;
```

`launch` 注入：单测传假 launcher（直接返回构造好的 Response），`index.ts` 传真 launcher（spike 的 `waitForDelegation`）。**测试与宿主调用同一个 `runDelegation`，没有 prepare/begin 两步、没有原地 mutation**——这是对 25/26/36/48 那类「本机绿宿主红」的结构性回答。`DelegationOutcome` 是判定块（Task id、state、evidence 比对、下一步建议），工具把它渲染成文本；非 completed 的 launcher 状态 → **throw**。

### 票

| 票 | 内容 | 依赖 |
|---|---|---|
| [04](issues/04-delegate-core.md) | `delegate.ts` 核心 + `planner_delegate` 注册（worker / explorer→scout / validator→oracle），ledger、A_run/C_report、usage 落账，假 launcher 单测 | 03 |
| [05](issues/05-policy-cutover.md) | Policy 切换：Root 的 `subagent` / `bg_wait` 拒绝；Idle 规则改；宿主验证旧链不可达 | 04 |
| [06](issues/06-reviewer-structured.md) | Reviewer 走结构化返回（ReviewResult schema），review loop 接 `DelegationOutcome` | 04 |
| [07](issues/07-progress-and-cancel.md) | UPDATE 事件 → `onUpdate` 进度；abort → CANCEL；TUI Esc 宿主验证；孤儿子进程处置 | 04 |
| [08](issues/08-delete-legacy-path.md) | 按去向表删代码与测试；`architecture.test.mjs` 更新；LOC 前后对比 | 05, 06 |
| [09](issues/09-iserror-dead-field.md) | 4 个既有工具 16 处 `isError: true` 改 throw | 无（可并行） |
| [10](issues/10-host-acceptance.md) | 宿主端到端：一个真实 Task 从 delegate → review → verdict → git_commit；README / CONTEXT 更新 | 07, 08 |

04 先做，05/06/07/09 可并行，08 收尾，10 验收。每票验收里都带「`grep` 证明没有新的文本解析」这一条。

## 止损

- 任一轮执行方需要改 `orchestrate.ts` / `task.ts` / `report.ts` 才能推进 → 停下交回，不改。
- 票 03 两次宿主运行都拿不到终态响应 → 停，Devin 改走 RPC 方案再开票。
- spike 不允许 import `task.ts` / `report.ts` / `orchestrate.ts` / `roles.ts`；只允许 `import type` 自 `types.ts`。审核时用 grep 验。
