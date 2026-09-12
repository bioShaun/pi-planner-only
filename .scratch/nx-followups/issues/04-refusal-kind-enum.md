# 04: 拒绝原因改为类型化枚举，移除散文正则分类

Status: ready-for-agent

## 背景

`orchestrate.ts` 的 `recordRootVerdictRefusal` 用 `/child run still pending/i` 等正则匹配人类可读的拒绝字符串来分类拒绝类别；审计与决策依赖散文是脆弱控制流（审查判定的 Primitive Obsession）。仓库其余契约均为类型化联合（ReviewVerdict、TaskState、ReviewDecision.action）。

## 验收

1. `rootVerdictRefusal` 返回结构化结果（reason + refusalKind 枚举），散文 reason 仅供展示。
2. `recordRootVerdictRefusal` 与审计导出记录 refusalKind；移除对 reason 文本的正则分类。
3. 既有套件（orchestrate/index/rs02）全绿；`npm run typecheck` 干净。

## Comments
