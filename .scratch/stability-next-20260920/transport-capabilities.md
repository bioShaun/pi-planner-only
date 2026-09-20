# 固定版本能力与 owner

本机 pi-subagents 0.69.0；`src/api/delegation.ts` SHA256 `1bb80a917190f7eae35bd52ce8b1cb18a4282386c18162e4acc2623106843266`。2026-09-20 只读核对：本地 contract 的五个事件名与 Request 字段集合和安装版一致。静态核对不等同新功能真实运行验收。

| 能力 | 当前事实 | 最终 owner / 后续 |
|---|---|---|
| Request 工具/启动总额、失败链、绝对截止 | 已由 P0 controller 实施 | 插件 Request controller |
| 单次 token/墙钟 envelope | UPDATE 快照 + 本地单调计时器；P1 提供有限默认 | 插件执行 monitor；不同时发送重复 timeout 给 launcher |
| REQUEST/terminal/CANCEL/usage | 85bdd2a 的真实 print 验收已证明 | launcher 执行 CANCEL；插件保留持久 claim/Writer hold |
| `model` / `thinking` | 公共 Request 支持；adapter 直接映射到执行参数 | operator 配置决定意图，launcher 决定实际模型，terminal 对照才验证生效 |
| `toolBudget.soft/hard` | soft 是停止探索的提示；hard 可拦指定工具，非独立的 partial-grace 控制 | launcher；本轮不默认启用未经对照校准的工具预算 |
| session spawn budget | 可配置；session 计数跨 compaction，operator grant 独立 | launcher；范围大于插件 Request，不同步或替换 Request 计数 |
| run spawn budget | 默认 64、claim 不返还，retained resume 复用原 claim | launcher run tree；不能覆盖 Root 发起的多个独立委派 |
| 预算触发前的 partial grace | 没有公开 steer/grace 控制事件或字段 | unsupported；需要上游协议扩展 |
| 原始格式错误报告 | adapter 只在 `status=completed` 投影 result；`structured_output_failed` 不返回原文 | unsupported；不能从 transcript/UPDATE 猜测 typed 报告 |
| report-only correction | 现有一次 correction 计数/指导并不等于强制只读修复派发 | 仍需专门的 grant→只读执行→报告来源/累计证据绑定实现；不能用普通 worker 指令冒称强制 |

源码依据（均为安装版，不引用浮动 main）：`src/slash/delegation-adapters.ts` 的 `toSubagentDelegationExecutionParams` / `toSubagentDelegationResponse`；`src/runs/shared/tool-budget.ts`；`spawn-budget.ts`；`run-fanout-budget.ts`；`model-resolution.ts`。

## P1-B 必需的上游契约

要实现完整预算前收尾，先增加可探测的版本能力，并提供按 requestId/ownerRunId/nodeId 关联的一次 finish 请求、剩余时间/额度、明确 ACK、以及最终 terminal。收尾没有新 Request 或新 claim，也不得延长原截止；超时继续走 CANCEL/Writer hold。原始格式错误结果若返回，必须有独立 diagnostic 字段和大小上限，与 typed `result` 分离；修复最多一次且同样计入总额度。旧 launcher 必须显式报告不支持，不做文本降级。

P1-B 保持未完成；本轮对现有 0.69.0 不虚构能力，也不修改系统安装包。P2 的新增接线只有单进程证据时同样保持真实模型验证待办。
