# 01: 冻结 M/N 代表事件 fixture 并回填验收矩阵（C01/C02/C17/C18）

Status: ready-for-human

## 背景

NX-01～NX-06 的离线套件（nx01/nx02-03/nx04-06）目前使用合成 fixture：nx01.test.mjs 自造 133 行历史 meta，而非规范 Batch 0 要求的"冻结 M/N 代表事件（去敏 fixture）"（spec L155）。acceptance.ts 矩阵机制已支持 `notDoneReason`（C17 的"明确未完成原因"），但 C01～C18/B01～B24 尚无任何真实 handler/宿主证据回填，全部默认 unproven。

规范：docs/runtime-session-013147-2026-09-12-optimization-spec.md L79/C01、L80/C02、L148/C17、L149/C18、L155 批次 0。

## 验收

1. 从 evidence.md 的 M（01:31:47 场）与 N（08:11:28 场）快照导出去敏代表事件 fixture，冻结入库，nx01 重放改用真实样本（133 历史 meta、120 外场 run、双原生 run 保留集）。
2. 断言重启后重扫（跨进程 restore → rescan）无重复记账，不只进程内去重。
3. 每个矩阵条目挂上真实 handler 证据或 `notDoneReason`；helper PASS 不得作为 handler-verified 证据来源。

## Comments

- 2026-09-12（agent）：第 1、2 条已完成；第 3 条已完成（宿主级条目统一 `notDoneReason: host-run-pending`，等宿主会话）。
  - 冻结 fixture：`tests/fixtures/nx-followups/session-013147-mn.json`，由 `scripts/freeze-mn-fixtures.mjs` 从 M/N 快照只读导出（内含 M/N 的 SHA-256，与 evidence.md §2.1 一致；快照后磁盘新增的 7 个 meta 已按 N 场 133 runIds 集合排除）。保留 runId/taskId/executionId/model/用量数字，剔除 prompt/acceptance/extension 清单，home 前缀替换为 `<home>`，无 transcript 文本。内容：133 历史 meta、13 场内 run 绑定、38 场内 child 事件（三来源）、121 条 T-023 回填、5 条 untasked root-turn（M:L765/768、N:L6/9/14）、9 条 verdict 请求、T-004 保留集全 UUID。
  - nx01 重放改走真实 handler 原语：临时目录写入冻结 meta 文件 → readdir → `readChildMeta` → `childFromMeta`（notify.ts 导出，与生产 harvestOrphanMetas 同一函数）→ `recordChild`。断言：N 本场 child 用量 0、owner 不被制造、sessionHint 永不等于 N stem、去证伪 meta 保持 unknown 且带原因；进程内直接重录去重；跨进程 spawn 子进程 `ledger.load(entries)` → 重扫同一目录，仍 133 unique。
  - C02 用真实 121 runIds：120 外场 + f032477d（唯一场内错绑）；T-004 两原生 run 按全 UUID 保留集留在原 Task（修复函数默认保留集是 8 字符前缀，重放显式传全 UUID——修复脚本同口径）；中断-续跑与一次成功一致；幂等。
  - C03 用真实事件走 `exportSessionEvidence`：38→13 三来源去重、5 条真实 untasked、N 观察 meta 归 foreign、去证伪 meta 归 unknown、桶互斥与 token/已知费用守恒。
  - C08：nx02-03 新增 9 请求/8 落账/1 拒绝重算（拒绝经真实 `rootVerdictRefusal` 分类为 child-pending，不入账）。
  - 矩阵回填：新增 `acceptance-claims.ts`（C01–C18、B01–B24 全量映射），接线进 `orchestrate.exportEvidence`（即公开 usage export 入口），并加入指纹文件清单与 package.json files。C01/C02/C03/C07/C08/C09/C17 标 handler-verified（引用上述套件与 fixture）；C04–C06 handler-verified + host-run-pending；C10–C16、C18 implemented + host-run-pending；B 项按审计文档 §Acceptance matrix 并修正 NX 批次已关闭项（B08 恢复计数已改为真实派发时 +1）。helper PASS 不作为升级依据由 acceptance.ts 门禁强制。
  - 宿主级证据（C04–C06、C10–C16、C18 宿主列）待 followup-split §5 宿主会话。
