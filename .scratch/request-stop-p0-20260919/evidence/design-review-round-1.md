# 设计草案独立审阅，第 1 轮

Reviewer：fresh astra_reviewer，无实现对话继承，只读行为约束。此轮是文档设计审阅，不是生产变更 strict gate。

Verdict：REQUEST_CHANGES。

1. High：spec 的进展定义允许结构合法的 failed/blocked 或仍有同类质量缺陷的 completed report 清除连续失败状态；要求显式结果状态表和回归场景。
2. Medium：请求级 child claim 未明确持久化与 REQUEST 发出之间的顺序和崩溃窗口；要求所有 child 使用 dispatch-keyed 的持久预留及故障/重载测试。

Root 修订：增加结果表，只有通过既有完整验收进入 completed 才清 streak；结构修复不清 streak。增加全角色 dispatch claim 的提交顺序、未知发送窗口保守保留、禁止自动重发及三个故障注入点。同步修订 01/02；clarify revalidation 提交前拒绝与提交后未知的计数差别。补上新版六场景的独立验证链接。

修订前文档哈希：doc-review-before.sha256。修订后交新 Reviewer 核对，不能把这一轮 REQUEST_CHANGES 当作已通过。
