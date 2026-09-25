# Worker 熔断的可诊断性与恢复交接

Status: ready-for-agent
Type: spec
Date: 2026-09-21
Source: T-20260921-014 / T-20260921-015 两次连续 `worker_runaway`（tc-probe-design-v2 FR-01），操作者复盘结论；`.scratch/worker-token-limit-research.md` 建议 2/3/5、`.scratch/planner-envelope-incident-research-20260917.md` 建议段（均未实施）
Baseline: 9d9a5e3（含 completionGuard 注册回退）

## Problem Statement

插件对失控执行只有一种动作：累计 `tokens`（非缓存 input+output 的快照最大值，`delegate.ts:1561`）或墙钟越限即硬取消。这次事故暴露四个缺口，每个都能在插件里机械化，且不依赖 Root 的自觉：

1. **熔断后没有可诊断的轨迹。** 账本里被取消执行的 `usage` 为 null，只有 `runawayObservation{observed,limit}`；每轮的 tokens / toolCount / currentTool 序列不落盘，操作者要读 session.jsonl 才知道 T-015 的 21 次调用全是读取、131k→166k 是一步跨过去的。宿主 UPDATE 已经带 `toolCount`、`currentTool`、`recentTools`、`recentOutputLines`、`durationMs`（contract:66-77），插件只转发不记录。被取消的执行也没有进入 usage.jsonl。
2. **"只读不写"的准备阶段没有边界。** T-015 在 70 秒内 21 次 read/grep/ls 后被硬停，插件知道每次调用的工具名（`READ_ONLY_TOOLS` 已在 policy.ts），却没有任何"连续 N 次只读且未写入"的信号或上限。研究文档建议 3（软阈值→检查点）和 5（只读阶段用工具预算）都指向这里。
3. **恢复重跑没有交接。** `retry_same_plan` 重发同一 TaskSpec，被取消执行留下的 diffstat、最近工具、最后输出行、已观测消耗都不进子包；T-015 只能重读一遍。插件已有 `buildReportOnlyRepairInstructions` 为 report-only 修复拼装上下文的先例（delegate.ts:1369），恢复路径没有对应物。
4. **重派可以把预算减到低于上次实测消耗。** T-015 用 160k 重跑一个上次 320k 都没跑完的计划。同一计划、更小预算，结果是确定的，插件却放行。

不做的：TaskSpec 语义（allowedPaths 与目标错位、必读清单）无法机械判定，留给 Root 纪律（见 tc-probe-design-v2 FR-01 工单 Comments 2026-09-21）。

## Solution

按顺序四张插件工单加一张上游工单：

- **01 执行轨迹入账本。** 每个执行保留最近 N=64 条 UPDATE 快照（tokens、toolCount、currentTool、recentTools 尾部、durationMs、时间戳），随执行记录持久化；被取消时把最后快照写成 `usage{input?:null,…,snapshot:true}` 并进入 usage.jsonl，`usageComplete:false`。`planner_tasks` 诊断输出增加"轨迹摘要"：首次非只读工具出现的序号、最大单轮 tokens 增量、只读调用占比。
- **02 准备阶段守卫。** envelope 新增可选 `maxReadOnlyTools`（连续只读调用上限，默认关闭）与 `preparationTokensShare`（首次写入前允许消耗的 maxTokens 比例，默认关闭）；触发时取消并以新的 `endedReason: preparation_runaway` 记录，`runawayObservation.signal` 增加 `preparation`，诊断列出触发前的工具与参数清单。只读角色（explorer/validator）不适用写入判定，沿用现有 tokens/wall。
- **03 恢复交接。** `retry_same_plan` / `fix_environment` 的子包自动附带 `priorExecution` 段：上次 executionId、endedReason、observed/limit、pre-dispatch 与取消时的 diffstat 差异（已有 aRun 证据）、最近 8 条工具与参数、最后 20 行 recentOutput、Root 的 recovery.reason。结构化段，不是散文；Root 的 `instructions` 仍单独追加。
- **04 重派预算守卫。** `retry_same_plan` 且 `envelope.maxTokens` 低于上次 `runawayObservation.observed` 时拒绝，代码 `RECOVERY_ENVELOPE_BELOW_OBSERVED`，拒绝文案给出上次实测值；Root 想缩小必须改计划（走 correction 或新 Task），不能只改数字。
- **05 上游：UPDATE 携带用量分类。** 向 pi-subagents 提议结构化 UPDATE 增加 `usage{input,output,cacheRead,cacheWrite,turns}`（宿主原生进度已经算了 input+cacheRead 窗口，只是没投影）。落地后插件熔断口径可配：`uncached`（现状）或 `total`。这是 T-015 "131k 一步跨到 166k" 那类波动能被解释的前提。

## Implementation Decisions

- 全部走已有的结构化通道（UPDATE、执行记录、子包结构化段），不解析 Worker 散文。
- 01 是其余三张的观测基础，先做；04 最小，其次；03 再次；02 有策略含义，默认关闭、opt-in。
- 保持 P0 语义：硬取消、停止确认、RecoveryDecision 门禁不变；新 endedReason 只是细分。
- 上游 05 独立推进，不阻塞 01–04。

## Testing Decisions

- fake launcher（delegate.test.mjs）覆盖：快照环形缓冲上限、取消时快照落盘、准备守卫触发/不触发、恢复交接段内容、预算守卫拒绝与放行。
- index.test.mjs 宿主集成：planner_tasks 诊断展示轨迹摘要；planner_redelegate 拒绝码。
- 真实 Pi：用一个刻意只读循环的 worker 任务复现 preparation_runaway，并验证 retry 子包里出现 priorExecution 段（沿用 `.scratch/worker-runaway-controller/issues/03-soak.md` 的方式）。
- 每张工单 release gate 全绿再合并；TMPDIR 放仓库外。


## 2026-09-21 本轮执行边界

- 用户明确选择：01–04 本地实现与验收；00/05 仅整理发布步骤和上游提案，保留本机安装，不推送或提交上游 PR。故 00 的部署动作不是本轮 01 的源码实现前置条件。
- 准备阶段依据实际观测到的工具名分类，非只读工具不等于已证实写入。重复 UPDATE 不增加工具计数；合并/缺失工具事件会标明覆盖不足，不凭空补齐调用。
- 取消后缺少终态用量时保存明确的 usageSnapshot：分类为 null、已观测 uncached tokens 为下界，usageComplete=false；完整用量到达后替代下界。
- 恢复包分别提供 aRun 与终止/临时 diffstat，不将整个现有工作区 diff 冒称为本次新增变更；不可用值明确为 null。
- 验证范围含现有 release suite、fake launcher、注册工具入口以及实际 Pi SDK/launcher/子模型；真实宿主使用脚本化 Root，原始失败尝试与修正后的证据复核均保留。
