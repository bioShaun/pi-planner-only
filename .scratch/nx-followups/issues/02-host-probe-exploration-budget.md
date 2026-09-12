# 02: 宿主探测探索预算接线，消除探测 fixture 循环自证（C10/C11/C12）

Status: ready-for-human

## 背景

floors.ts 的 `createExplorationProbeFixture` 中 `interceptedCalls = max(0, eligible - hard)` 由同一公式反推，`explorationProbeDelta` 的差异恒为 0 —— 没有真实宿主探测数据，配置值与实际拦截的差异（spec C10）不可证。探索计数（NX-04）已在插件侧按 execution/run 计量并通过 tool_result 接线，但"宿主是否能看到子工具事件、软/硬阈值在真机上是否一致"需要真实宿主会话验证（spec L121：若 Root handler 看不到子事件，需通过子侧适配实现，不能仅调用 Root 内存 helper）。

## 验收

1. 在已确认新指纹的宿主里产生五类工具（read/grep/find/ls/bash 只读）及批量调用的原始调用/结果样本，保存为可重放 fixture。
2. 用真实样本替换公式反推的 `interceptedCalls`，`explorationProbeDelta` 反映配置与实际的差异。
3. soft 一次、hard 后 partial 摄取在真实宿主可见（C12 的 T-016/T-022 收尾重放）。

说明：需要真实宿主会话与模型运行，人工启动后可交 agent 分析 fixture。
