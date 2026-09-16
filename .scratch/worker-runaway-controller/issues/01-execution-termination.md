# 01: P0-A — execution termination correctness（停止确认、迟到 terminal、受控释放、结构化异常返回、finalizeExecution）

Status: done（2026-09-16；实现 066685b + dd1713d；宿主证据 ../host-01/；spec Further Notes 已记实测结论）
Blocked by: typed-delegation 11（done）；12-A 是 12-B 的前置
Type: bug / correctness

**What to build：** 修好「执行终止」这一层，WRC（票 02）才有地方挂。四件事：(a) `TaskExecutionRecord` 补全生命周期状态与结束原因；(b) spec §3 的 P0 停止确认谓词（terminal + quiescenceWaitMs + 两次一致工作树采样）；(c) 宽限到期不退订——按 requestId 保留迟到 terminal 接收器，到达后走 finalization 补记 usage／C_terminal 并解除 stop_unconfirmed；(d) writer 释放改为受终止与证据条件约束，非 completed 路径不再 `throw DelegationRefused` 而返回结构化 `termination` details。

## 现状（写票时核过的行号）

1. `delegate.ts:443-475`：`response.status !== "completed"` 时 transition 到 blocked/failed、记 stateReason、有 usage 就落账，然后 `throw new DelegationRefused(status.toUpperCase(), …)`——Root 只拿到一段文本，无结构化 details。
2. `delegate.ts:594-597`：`finally { if (reservation) deps.concurrency.release(reservation.id); }`——无条件释放 writer reservation，无论停止是否确认、C 采样是否成功。
3. `delegate.ts:955-975`：abort 路径 `onAbort` 发 CANCEL 后 `cancelGraceMs` 宽限到期即 `settled=true; cleanup(); reject(DelegationAborted)`——cleanup 退订 RESPONSE/UPDATE，迟到 terminal 从此无人接收。
4. `types.ts:209-267`：`TaskExecutionRecord` 现有 executionId/taskId/kind/runId/aRun/cReport/truthPaths/… 等归因字段，**没有** status／endedReason／cancelRequestedAt／endedAt／terminationConfirmed／confirmationBasis／cTerminal／usageComplete。
5. `task.ts:1588` `beginExecution`、:1595 `completeExecution`——`completeExecution` 携带成功假设（reportIndex/truthPaths 等），不适合非成功路径。
6. `orchestrate.ts:367` `store.restore(record)` 直接采用账本 JSON——新增可选字段缺失时读者必须容忍 `undefined`，旧账本不得升格为已停止。
7. `evidence.ts:553` `captureEvidence(deps.gitRunner, sampleOptions)` 已存在，C_terminal 复用同一采样器，samples 带 `statusProbeFailed` 标记位（核 evidence.ts EvidenceRef 形状后如实记录）。
8. `orchestrate.ts:864-865` `renderTaskStatus` 已渲染 `Refused verdicts:` 行——execution 停止状态行加在同一渲染函数的合适段。
9. `CONTEXT.md:3` 仍写「Execution happens in child processes」；`docs/adr/0001` :40-47 取消说明写的是 child-process 时代事实——按 spec §8 更新为 in-process 运行时事实，决策保留。
10. 宿主取消事实（票 07 宿主证据）：Esc → CANCEL 发出 → cancelled terminal 实测 ~0.12 s 到达；`forced-settlement` 标记在 terminal 中不存在（subagent-delegation-contract.ts 契约副本 :107-118）。`quiescenceWaitMs` 默认 10 s 的依据（forced-settlement 3–4 s + 会话关闭 5 s）见 spec §3，本票宿主轮要实测 CANCEL→terminal 最长间隔写入 spec Further Notes。

## 范围

**改**：`types.ts`、`task.ts`、`delegate.ts`、`concurrency.ts`、`orchestrate.ts`（restore 兼容 + `renderTaskStatus` 停止状态行）、`evidence.ts`（C_terminal 采样复用 captureEvidence，需要的话加最小封装）、对应 `*.test.mjs`、`README.md`、`README.zh-CN.md`、`CONTEXT.md`、`docs/adr/0001-typed-delegation-contract.md`。
**不改**：`policy.ts` 工具集、`review.ts`、`floors.ts`（留给票 02 裁定）、`subagent-delegation-contract.ts`（宿主契约副本，只读）、`index.ts` 的工具注册面（结构化 details 渲染除外，见 A6）。
**新建**：`.scratch/worker-runaway-controller/host-01/`（宿主证据）、探针目录从 `typed-delegation/host-10/probe-template` cp。

## 设计（对应 spec §2、§3）

### A1 `TaskExecutionRecord` 生命周期字段

加（全部可选，兼容旧账本）：

- `status?: "running" | "cancel_requested" | "stopping" | "stop_unconfirmed" | "stopped" | "completed" | "failed"`
- `endedReason?: "normal" | "worker_runaway" | "operator_cancel" | "timeout" | "tool_budget" | "provider_failure" | "tool_error" | "launch_failure"`
- `cancelRequestedAt?: string`、`endedAt?: string`
- `terminationConfirmed?: boolean`、`confirmationBasis?: string`（P0 唯一合法值 `"terminal+quiet-worktree"`）
- `cTerminal?: EvidenceRef`（停止确认后的残留采样，与 cReport 语义分离；未静止前的采样只能标 interim，不冒充最终窗口）
- `usageComplete?: boolean`（终态 usage 是否已落账；缺失时保留已知下界 + incomplete，不编造）

旧账本缺字段 → 一律按未知处理，**不得**升格为已停止。合法组合由统一转换入口约束（state 机一处，不散落 if）。

### A2 停止确认谓词（spec §3 原文实现）

`terminationConfirmed = true` iff：(a) 收到身份匹配的 terminal；(b) 自 terminal 到达起等待 ≥ `quiescenceWaitMs`（默认 10 s，可配置，配置来源记入 execution 记录）；(c) 之后连续两次 `captureEvidence` 采样一致（status hash + dirtyPathHashes）且两次均未 `statusProbeFailed`。任一不满足 → 保持 `stop_unconfirmed`；采样失败 → 记 `evidence-incomplete`（不释放、不自动恢复，直到补齐或人工处置）。谓词只证明观察窗口内工作树静止——该限制随 `confirmationBasis` 写入记录。

### A3 宽限到期不退订

`delegate.ts` abort 路径：宽限到期只 `reject` 给调用方，**不** `unsubscribeResponse`/cleanup 掉 RESPONSE 监听；按 `requestId` 保留迟到 terminal 接收器直到身份匹配 terminal 到达或 session 结束。收到迟到 terminal → 走 A5 finalization 补记一次 usage／C_terminal、解除 `stop_unconfirmed`；`settled` 语义保持幂等——不第二次释放 reservation、不重复记账、旧报告不越过 seal 被接受。

### A4 受控释放

`finally` 释放改为：仅 `terminationConfirmed === true && cTerminal` 就位时释放 reservation；否则 reservation 转为持久化的 `task.writerHold`（或等价持久字段，账本可恢复），重启 `restore` 时凭它继续拒绝新 writer——不能凭丢失的内存 reservation 判定可写。

### A5 `finalizeExecution` 与 `completeExecution` 分离

新增 `finalizeExecution`（无成功假设：记 endedReason、terminationConfirmed/basis、C_terminal 残留窗口、usageComplete）；`completeExecution` 只走成功路径。所有非 completed 终态、launch failure、abort 一律走 finalizeExecution。launch failure 单独记可证明事实，不伪造 child 终止证据。

### A6 结构化异常返回

非 completed 不再 `throw DelegationRefused`：`planner_delegate` 返回 `DelegationOutcome` 携带结构化 `termination` details（anomaly 类型、观测值与阈值来源、executionId、终止状态与依据、残留 Evidence 引用、task.recovery 占位——票 02 填实）。`index.ts` 渲染为文本摘要 + details。文本只为展示。

### A7 竞态裁决

完成先到 → 迟到取消不翻转已接受结果；取消先到 → 迟到成功报告只收集进证据，不推进验收、不二次记账。回调顺序与持久记录支持确定性裁决。

### A8 文档

`CONTEXT.md` 第 3 行「Execution happens in child processes」→ in-process AgentSession 运行时事实；ADR 0001 :40-47 取消说明加运行时事实注记（保留原决策记录）。

## 测试（spec Testing Decisions 对应行）

可控 launcher／事件总线／时钟／Git runner；沿用现有 delegate/concurrency/orchestrate 测试骨架，不新建旁路体系。至少覆盖：

- 谓词三分支：terminal 后 quiescenceWaitMs 内工作树仍变化 → stop_unconfirmed；两次采样一致 → confirmed + `confirmationBasis === "terminal+quiet-worktree"`；采样失败 → evidence-incomplete。
- 宽限到期后迟到 terminal：仍被接收、stop_unconfirmed 解除、usage/C_terminal 只补记一次、无第二次释放、旧报告不越 seal。
- forced-settlement 形态（身份匹配 cancelled/timed_out 但工作树仍在变）不提前释放 reservation。
- stop_unconfirmed / evidence-incomplete 下第二位 writer 不被放行（含 restore 后的 writerHold）。
- 每类非成功终态的 C_terminal + usage 完整性；不产生伪造 WorkerReport 或成功 review。
- 竞态两向（A7）。
- 旧账本（无新字段）restore 后渲染/导出不抛、不升格为已停止。
- `git grep -n 'concurrency.release' -- delegate.ts` 只在条件分支内；`git grep -n 'throw new DelegationRefused' -- delegate.ts` 不含非 completed 路径。

## 宿主轮（`.scratch/worker-runaway-controller/host-01/`）

Esc 取消一个正在写文件的 worker（配方同 typed-delegation host-10/11：`PI_PLANNER_ONLY=1 PI_PLANNER_ONLY_REQUIRE_REVIEW=1 pi -ne …`，探针从 host-10/probe-template cp）→ 观察 execution 进 `stop_unconfirmed` → 等 quiescenceWaitMs 后两次采样一致 → confirmed → C_terminal 归因落账。同时实测宿主从 CANCEL 发出到 terminal 到达的最长间隔，把实测值写进 spec Further Notes 作为 quiescenceWaitMs 下限依据。

## 验收

1. `npm run typecheck && npm test` exit 0。
2. `git grep -n 'concurrency.release' -- delegate.ts` 只在条件分支内（无 finally 无条件释放）。
3. `git grep -n 'throw new DelegationRefused' -- delegate.ts` 不含非 completed 路径残留。
4. parse-grep：`git diff -- '*.ts' | grep -cE '^\+.*(JSON\.parse|\.match\(|new RegExp|\.split\()'` 为 0。
5. `git diff --check` 空。
6. 宿主证据落 `host-01/`：stop_unconfirmed → confirmed 的账本序列、C_terminal 采样、CANCEL→terminal 实测间隔。
7. CONTEXT.md 与 ADR 0001 的运行时事实已更新（child processes → in-process）。

## 验收结果（2026-09-16）

1. `npm run typecheck && npm test` exit 0（提交 066685b / dd1713d 时全绿）。
2. `git grep 'concurrency.release' -- delegate.ts` 仅两处：`finally` 内 `releaseReservation` 守卫（:911）与 `settleLateTerminal` 确认分支（:596）——无条件 finally 释放已删。
3. `git grep 'throw new DelegationRefused' -- delegate.ts` 剩余全部为准入/参数拒（TASK_*/WRITER_*/REVIEW_*），无非 completed 终态路径。
4. parse-grep 0；`git diff --check` 空。
5. 宿主证据 `host-01/`：cancel→宽限内 cancelled→quiescence→confirmed→release（T-20260916-006）；SIGKILL mid-stop → restore 合成 writerHold → 第二 writer WORKSPACE_CONFLICT（T-20260916-008）；正常完成不受影响（T-20260916-007）。CANCEL→terminal 实测间隔 <5 s（in-process，票 07 的 0.12 s 量级一致）。
6. CONTEXT.md / ADR 0001 / README 双语已更新 in-process 运行时事实与停止确认语义。
7. 偏差记录：票面 §「宿主轮」写 host-01/ 目录名（实际即本目录）；谓词对 `gitAvailable:false` 样本同样记 evidence-incomplete（探针不可用≠静止）；restore 时对 `cancel_requested`/`stopping`/`stop_unconfirmed` 未确认执行合成 writerHold（修复宿主实测的 mid-stop 死亡空洞）。
