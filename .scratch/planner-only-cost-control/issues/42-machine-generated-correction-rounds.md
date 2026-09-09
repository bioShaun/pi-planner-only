# 42: 机器生成 report-only 纠正轮

**What to build:** report-only 纠正轮必须由扩展机器生成，而不是让 Root 手写一段无法绑定 Task 的文本：

1. 扩展派发纠正轮时，自动携带原 Task 的完整 TaskSpec。这样纠正轮不会再触发 `Planner-only: role worker delegated without an embedded TaskSpec` 或 `Planner-only: prompt names task ... but no single live Task matched` 两条 warning；实测纠正轮每次都会弹这两条警告，根源是强制纠正文本没有嵌入 spec，而 prose 点名永远不会完成绑定。
2. 用显式字段（例如 `DelegationRecord` 或 `TaskSpec` 上的 `reportOnly: true`）替代 `isReportOnlyPrompt` 的 prompt 文本嗅探。reviewer 已指出当前宽松文本匹配存在误判面。
3. 接通 evidence 归因已有的 `reportOnly` 选项：从显式字段传递 report-only 语义，不再依赖 prompt 文本识别。

**Background:** 2026-09-09 的 r099/r102/r103 三轮实战中，纠正轮 100% 触发上述两条 warning。工单 28 变体 A 已预留 `reportOnly` 通道，本票将触发方式改为显式字段，并让机器生成的纠正 prompt 自带完整 TaskSpec。

**Acceptance:** 纠正轮不再产生上述两条 warning；`isReportOnlyPrompt` 删除，或降级为明确标注的兼容 shim；新增测试覆盖“机器生成的纠正 prompt 嵌入 TaskSpec 且标记 `reportOnly`”，并验证 evidence 比对收到该显式标记。

**Blocked by:** 无。

**Status:** ready-for-agent
