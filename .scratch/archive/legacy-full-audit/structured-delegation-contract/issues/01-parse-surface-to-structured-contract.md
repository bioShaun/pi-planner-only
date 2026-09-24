# 01: WorkerReport / ReviewResult 解析面有多少能迁到 structured delegation contract

Status: needs-triage

日期：2026-09-12。基线：commit `5b76f0d` 附近的工作树。本文只记录现状与迁移潜力，不做决策。

## 背景

当前 Root/child 接缝全程是文本：向下的 TaskPacket 以 JSON 内嵌在 delegation prompt 里；向上的 WorkerReport / ReviewResult 由 child 最终消息的**自由文本**中刮取恢复。若 delegation contract 未来以数据（而非内嵌文本）承载、且宿主对 child 回复提供结构化约束（JSON schema / 提交工具调用），现有解析面各层的去留不同。

注意：`docs/pi-planner-only-v0.3.2-spec.md` §5 曾把 "Worker JSON schema on every launch" 列为显式 non-goal——本问题属于**重开一个已关闭的决策**，需先回答"当时关闭、现在为什么值得重开"（宿主能力是否出现、修复表维护成本、prompt 侧三份格式副本的漂移风险）。

## 现状盘点（解析面分六层）

1. **候选刮取**（纯通道问题）：`report.ts` 的 `jsonCandidates`（裸文本/围栏/配平花括号扫描）、`looksLikeReport` / `isCanonicalReportShape` 启发式、`extractWorkerReport` 的 best-candidate 择优；`review.ts` 的 `extractReviewResult`（verdict+findings 键控）与 `extractReviewRequest`；`task.ts` 的 `extractTaskSpecDetails` / `topLevelJsonCandidates`（Root 重新解析自己内嵌的 TaskSpec，含 title 别名、对 ReviewRequest/WorkerReport 形状的排除）。**存在原因只有一个：通道是文本。**
2. **格式修复**：`normalizeWorkerReport` 修复表——version 宽容、status 同义词、别名改名（unresolvedItems→unresolved 等）、string→array 包裹、validation 单对象包裹、type/status 子串映射（`TYPE_SUBSTRING_MAP`、`VALIDATION_STATUS_*`）、exitCode 字符串转整数、evidence array/string→object。**存在原因：便宜模型输出脏 JSON。**
3. **语义加固与身份**：`hardenEvidence`（丢弃 worker 自报的 `gitStatusHash`/`dirtyPathHashes`、按 Root 侧 stamp `workerRunId`）、`validateWorkerReportIdentity`、`validateReviewResultIdentity`。**这是信任边界，不是格式问题。**
4. **校验与纠偏指引**：`validateWorkerReport`、`validateReviewResult`（手写校验器，兼作 report-only correction 的错误文案来源）；prompt 侧格式副本三份手工维护——`workerReportShapeReminder`、REVIEWER_PROMPT 内嵌 JSON、两个校验器（注释自认"枚举写进 prose 以便该 JSON 能过校验"）。
5. **绑定语义**：FR-03/D09 的 `validateReviewResultBinding`（reportRevision/workspaceDigest）、`bindReviewResultFromRequest`（从 packet 填充，ticket 27/32）、`acknowledgeDrift`/supersession 归属。**schema 能要求"是个整数"，不能要求"等于 packet 里的那个整数"。**
6. **向下侧重解析**：`extractTaskSpecDetails`（从 prompt 文本找回 Root 自己嵌入的 TaskPacket，record-time binding 依赖它）、`extractReviewRequest`（roles.ts:496、orchestrate.ts:2650/3114——Root 解析自己写的 ReviewRequest）。**只因 packet 以文本过缝而存在。**

规模量级：report.ts 751 行中约 2/3 是刮取+修复+校验；review.ts 约 200 行；task.ts 提取约 180 行；orchestrate.ts 消费点约 12 处（4053/4342/4368/4477/4541/4677/4706/4984/5084 及 identity/binding 调用）。

## 迁移潜力分层结论

| 层 | 结构化通道下 | 条件 |
|---|---|---|
| 1 候选刮取 | **整体消亡** | 宿主对 child 回复提供结构化输出或提交工具；依赖 Pi adapter 能力，现状不支持 |
| 2 格式修复 | 消亡，但作为 fallback adapter 保留 | 只要存在非结构化宿主/模型路径 |
| 3 语义加固/身份 | **永不迁移** | worker 永远不能为 Root 侧字段背书，与通道无关 |
| 4 校验/文案 | 保留，但可由单一 schema 源生成 | 消除三份手工格式副本的漂移 |
| 5 绑定语义 | **永不迁移** | 这是"合同"而非"格式"的部分，schema 表达不了等值约束 |
| 6 向下侧重解析 | 消亡（仅当 delegation 以数据过缝）；容错路径（operator 手打 delegation、canRebindNamedTask 重绑）保留 | 同上 |

## 迁移的可行路径（候选，未决策）

1. 先做**单一 schema 源**：WorkerReport/ReviewResult/ReviewRequest/TaskPacket 一处定义，生成 shape reminder、REVIEWER_PROMPT JSON、校验器与错误文案。此步不依赖宿主能力，立即可做，收益是消漂移。
2. 在 Orchestration↔Pi adapter 缝上定义 `delegation.replySchema`（或 submit 工具）契约；宿主支持时 child 回复为对象，Root 直接走 validate→identity→binding；不支持时 fallback 到现有刮取路径。刮取层降级为 adapter fallback，而非核心。
3. `WORKER_REPORT_VERSION` 常量已为 wire 迁移预留；StructuredDelegationMode（warn 默认）是向下侧已有的先例，可参照其 warn→strict 渐进模式。

## 开放问题

- 重开 v0.3.2 non-goal 的理由是否成立（宿主结构化输出能力是否已出现/可预期）？
- 单一 schema 源是否值得作为独立第一步先行（与宿主解耦）？
- report-only correction 循环在结构化通道下的形态：schema 拒绝即纠正信号，还是保留现有 prose 指引？
- 便宜模型/非结构化路径要作为一等公民保留多久？

## Comments

### 2026-09-12 — 该 non-goal 的原始决策记录已找到（v0.3.1 §10，D3，2026-09-05 裁定）

`docs/pi-planner-only-v0.3.1-spec.md` §10 Decision 3：

> **No JSON-schema block in the worker prompt.** The parser tolerates the shapes cheap models actually emit; growing the worker prompt spends worker input tokens on every run to save a correction that L-1 already removes.

依据两条实测事实（v0.3.1 §1 基线表）：

1. **L-1**：每个 Task 损失 2–3 个 Root turn 和 1–2 个 worker run，全部死于"解析器本可修复"的 WorkerReport schema 拒绝（`version: "1"`、`changedFiles` 为对象数组、`unresolvedItems`、自由文本 validation type、缺 `evidence.taskId`），约占 Root turn 的 40%。当时选择的修复是宽容归一化（`normalizeWorkerReport`，CHANGELOG L-1），即 schema block 想省的那笔成本已被解析器省掉。
2. **成本不对称**：schema block 长在 worker prompt 里，每一次运行都要付这份 input token（v0.3.2 §3 的重放预算即按 prompt 暴露字节计：9 turn ≤16,200 B）；解析修复在 token 账上接近免费。

后续演化（非重申，是收紧了剩余缺口）：v0.3.2 I-2 把剩余失败模式（T5 的纯 prose 输出、归一化无从下手）改为**反应式**处理——只在第一次 prose strike 的 report-correction 里追加一行 `JSON only: {...}`（`workerReportShapeReminder`），并在 §5 重申两个 non-goal（every-launch schema、重开 v0.3.1 已关闭的 schema 决策）。注意 D3 没有像 D1/D2 那样写 revisit 触发条件，此后的 session/audit 文档也没有再评估过它。

**对本议题的关键区分**：D3 关闭的是"prompt 侧 schema block"这个变体（每个 run 付 prompt 字节）。本 issue 讨论的宿主结构化输出/提交工具合同是另一个杠杆——合同由宿主在回复侧强制，不按上面那条成本曲线计价。2026-09-05 的决策从未评估过这个变体，所以"重开"的正确表述是：**D3 不覆盖宿主侧合同；prompt 侧 every-launch block 维持关闭**。"开放问题"第一条应据此改写。
