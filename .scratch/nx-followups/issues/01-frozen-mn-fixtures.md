# 01: 冻结 M/N 代表事件 fixture 并回填验收矩阵（C01/C02/C17/C18）

Status: ready-for-agent

## 背景

NX-01～NX-06 的离线套件（nx01/nx02-03/nx04-06）目前使用合成 fixture：nx01.test.mjs 自造 133 行历史 meta，而非规范 Batch 0 要求的"冻结 M/N 代表事件（去敏 fixture）"（spec L155）。acceptance.ts 矩阵机制已支持 `notDoneReason`（C17 的"明确未完成原因"），但 C01～C18/B01～B24 尚无任何真实 handler/宿主证据回填，全部默认 unproven。

规范：docs/runtime-session-013147-2026-09-12-optimization-spec.md L79/C01、L80/C02、L148/C17、L149/C18、L155 批次 0。

## 验收

1. 从 evidence.md 的 M（01:31:47 场）与 N（08:11:28 场）快照导出去敏代表事件 fixture，冻结入库，nx01 重放改用真实样本（133 历史 meta、120 外场 run、双原生 run 保留集）。
2. 断言重启后重扫（跨进程 restore → rescan）无重复记账，不只进程内去重。
3. 每个矩阵条目挂上真实 handler 证据或 `notDoneReason`；helper PASS 不得作为 handler-verified 证据来源。

## Comments
