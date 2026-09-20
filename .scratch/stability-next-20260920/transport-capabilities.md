# 固定版本能力与 owner

本机 pi-subagents 0.69.0；`src/api/delegation.ts` SHA256 `1bb80a917190f7eae35bd52ce8b1cb18a4282386c18162e4acc2623106843266`。2026-09-20 只读核对：本地 contract 的五个事件名与 Request 字段集合和安装版一致。静态核对不等同新功能真实运行验收。

| 能力 | 当前事实 | 最终 owner / 后续 |
|---|---|---|
| Request 工具/启动总额、失败链、绝对截止 | 已由 P0 controller 实施 | 插件 Request controller |
| 单次 token/墙钟 envelope | UPDATE 快照 + 本地单调计时器；P1 提供有限默认 | 插件执行 monitor；不同时发送重复 timeout 给 launcher |
| REQUEST/terminal/CANCEL/usage | 85bdd2a 的真实 print 验收已证明 | launcher 执行 CANCEL；插件保留持久 claim/Writer hold |
| `model` / `thinking` | 公共 Request 支持；adapter 直接映射到执行参数 | operator 配置决定意图，launcher 决定实际模型，terminal 对照才验证生效 |
| `toolBudget.soft/hard` | `hard:0, block:"*"` 的真实探针同时拦截 structured output，不能用于修复；最终修复绑定 `tools:[]` agent 并发送 `hard:1, block:"*"` | launcher 只追加一次 structured result；插件持久化预算、注册证明、agent 与原始终态 |
| session spawn budget | 可配置；session 计数跨 compaction，operator grant 独立 | launcher；范围大于插件 Request，不同步或替换 Request 计数 |
| run spawn budget | 默认 64、claim 不返还，retained resume 复用原 claim | launcher run tree；不能覆盖 Root 发起的多个独立委派 |
| 预算触发前的 partial grace | 没有公开 steer/grace 控制事件或字段 | unsupported；需要上游协议扩展 |
| 原始格式错误报告 | adapter 只在 `status=completed` 投影 result；`structured_output_failed` 不返回原文 | unsupported；不能从 transcript/UPDATE 猜测 typed 报告 |
| report-only correction | 一次 grant→不可变执行标记→封闭报告提交 capability→来源证据绑定；该轮不增加 Truth paths | 注册失败先拒绝；validator/reviewer 不能绕过；第二次畸形报告 block |

源码依据（均为安装版，不引用浮动 main）：`src/slash/delegation-adapters.ts` 的 `toSubagentDelegationExecutionParams` / `toSubagentDelegationResponse`；`src/runs/shared/tool-budget.ts`；`spawn-budget.ts`；`run-fanout-budget.ts`；`model-resolution.ts`。

## P1-B 必需的上游契约

要实现完整预算前收尾，先增加可探测的版本能力，并提供按 requestId/ownerRunId/nodeId 关联的一次 finish 请求、剩余时间/额度、明确 ACK、以及最终 terminal。收尾没有新 Request 或新 claim，也不得延长原截止；超时继续走 CANCEL/Writer hold。原始格式错误结果若返回，必须有独立 diagnostic 字段和大小上限，与 typed `result` 分离；修复最多一次且同样计入总额度。旧 launcher 必须显式报告不支持，不做文本降级。

P1-B 在 0.69.0 能支持的范围内只完成 report-only 报告提交修复。失败设计及原始证据保留在 `report-only-run-xMGYAr`；预算前 partial grace 与原始格式错误诊断仍明确 unsupported。本轮不虚构能力、不从文本降级，也不修改系统安装包或导入其 raw TypeScript。
