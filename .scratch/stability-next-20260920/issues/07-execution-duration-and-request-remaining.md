# 07 执行时长与 Request 剩余时间

Status: ready-for-agent
Completion: not started; separate follow-up, no timing semantics changed in this handoff

现有十分钟 execution 默认值不能代表一次晚启动委派实际还有十分钟：Request 截止自首个活动起算，验证与评审也需要时间。当前 TaskExecutionRecord 没有可校准的启动时间与统一耗时口径，Root 只能估算余量。P3 小任务组不区分五分钟和十分钟的策略效果。

范围：先明确并持久化插件自身的 execution 开始/结束时间和耗时口径，明确是否从 REQUEST 出站或 launcher STARTED 起算，排除前置 Git 采样；向 Root 返回权威 Request 剩余时间及其观测时点。未知时间必须明确 unknown，不能补猜。不得刷新 Request 截止、增加额度、改变一次修复或 Writer hold 规则。

验收：普通执行、等待启动、取消、晚到终态、恢复账本和跨 Request 场景都保留一致时间来源；时长不受墙钟回拨误导；同一 Request 内重入不能重新获得完整时限。若进一步自动截断 execution envelope 或强制预留评审时间，先另作 ADR 决定该行为，不能混入纯观测改动。

后续代表性校准需要同时比较 default-breach rate、Root 恢复 token 和完整 Request 完成率，并覆盖可能超过五分钟的工作；本轮三种小任务不能外推。沿用显式模型配置、全部失败样本、普通终端验收与 slot audit/status 规则。
