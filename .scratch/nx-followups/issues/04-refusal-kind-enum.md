# 04: 拒绝原因改为类型化枚举，移除散文正则分类

Status: ready-for-human

## 背景

`orchestrate.ts` 的 `recordRootVerdictRefusal` 用 `/child run still pending/i` 等正则匹配人类可读的拒绝字符串来分类拒绝类别；审计与决策依赖散文是脆弱控制流（审查判定的 Primitive Obsession）。仓库其余契约均为类型化联合（ReviewVerdict、TaskState、ReviewDecision.action）。

## 验收

1. `rootVerdictRefusal` 返回结构化结果（reason + refusalKind 枚举），散文 reason 仅供展示。
2. `recordRootVerdictRefusal` 与审计导出记录 refusalKind；移除对 reason 文本的正则分类。
3. 既有套件（orchestrate/index/rs02）全绿；`npm run typecheck` 干净。

## Comments

- 2026-09-12（agent）：已完成。`types.ts` 新增 `RootVerdictRefusalKind`（terminal-state / no-report / child-pending / fresh-review-pending / strict-zero-paths）与 `RootVerdictRefusal { kind, reason }`；`rootVerdictRefusal` 返回结构化结果，`recordRootVerdictRefusal` 按 `kind === "child-pending"` 判定不入账，review 记录新增 `refusalKind` 字段；正则分类已删除。审计导出（exportSessionEvidence）新增 `statuses.refusalKind` 计数。index.ts 两个调用点改用 `refusal.reason` / `refusal.kind`（operator override 的 terminal 判定改用 kind，不再调 isTerminalTaskState）。orchestrate.test.mjs 全部断言适配并在 L-4/pending/fresh 场景补 kind 断言；新增"child-pending 不入账、fresh-review-pending 入账"块。typecheck、全量测试、git diff --check 全绿。
