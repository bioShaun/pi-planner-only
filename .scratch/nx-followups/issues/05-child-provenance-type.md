# 05: 提取 ChildProvenance 类型并清理重复/坏味道残留

Status: ready-for-human

## 背景

本轮审查（标准轴）遗留的结构性坏味道，均为判断性项、无行为影响：

1. **Data Clumps**：`{sourceSessionId, sessionId, ownerRootSessionId, taskId, executionId, transcriptPath, sessionHint, unknownReason}` 八个溯源字段结伴穿越 notify.ts（ChildRunMeta）、types.ts（ChildUsage）、usage.ts（ChildUsageIds）、index.ts（childFromMeta 选项对象）——一个 `ChildProvenance` 类型呼之欲出。
2. **归因推导重复**：index.ts 消息处理器的 attribution 推导与 usage.ts `applyRootTurn` 的回退推导（`candidates.length === 1 ? "tasked" : ...`）形状相同，可共享一个推导函数。
3. **小型项**：floors.ts `record()` 的位置参数堆；index.ts `applyRootReadCeiling(input, 200, true)` 魔法 200 与唯一调用点的恒真旗标（Speculative Generality）；notify.ts "aggregate artifact directory" 注释措辞与 CONTEXT.md §Evidence 的 _Avoid: artifact_ 词汇表冲突（目录名为既有命名，可加注说明而非改名）。

## 验收

1. 提取 `ChildProvenance` 并让四处共享。
2. 归因推导单点化；`applyRootReadCeiling` 的 enabled 旗标移除或由策略注入。
3. `npm run typecheck`、`npm test`、`git diff --check` 全绿。

## Comments

- 2026-09-12（agent）：已完成。`types.ts` 新增 `ChildProvenance`（八字段，observedInSessionId 按规范刻意排除在外并注明原因），`ChildUsage`/`ChildRunMeta`（notify.ts）/`ChildUsageIds` 改为继承该类型；`childFromMeta`/`sourceSessionFromMeta` 上移为 notify.ts 导出（纯函数、可离线重放），index.ts 复用。`sourceTranscriptPath` 统一为 `transcriptPath`（写入侧改名，无读取方依赖旧名，persisted 形状与 host meta 命名一致；repairT004 本就按 `transcriptPath` 读取）。归因推导单点化为 usage.ts `deriveRootTurnAttribution(candidates, taskedAllowed)`，applyRootTurn（保留 phase 门：state 未知不算 tasked）与 index.ts message_end 共用；`RootTurnAttribution` 别名统一四处标注。floors.ts `record` 改选项对象（ExplorationRecordOptions），orchestrate 与 nx04-06 调用点同步。`applyRootReadCeiling` 移除 enabled 旗标，魔法 200 提为 `ROOT_READ_CEILING_LINES`（apply/notice/调用点/测试共用）。notify.ts artifact 注释加"目录名非 Evidence 样本"说明。typecheck、全量测试、git diff --check 全绿。
