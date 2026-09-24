# 配置纠正独立复核

Reviewer: /root/correction_review，fresh astra_reviewer（无历史），2026-09-18。
Verdict: **PASS，仅限 pi-subagents 0.68 已支持的配置子集**。

两个前次 P1 已关闭：

- explorer-model.ts:109 校验已知 override 类型，tools="bash" 被拒绝；合法值仅为 inherit、字符串数组或 false。
- explorer-model.ts:233 校验 scout 元数据，advertise:maybe 被拒绝；合法布尔值及 broad capability 定义可接受且不会转移能力。
- explorer-model.ts:246 对不支持的复杂宿主形式明确拒绝，避免静默误投影。
- explorer-model-config.test.mjs:586 注册工具回归覆盖两项拒绝与合法 broad definition。

Reviewer 核对当前源码哈希匹配 after-config-correction2.json，读取冻结验证证据，未重复运行测试。已支持子集内未发现新的 P1/P2。

限制：原规格的完整宿主兼容性仍不满足；有效复杂配置及部分发现设置被拒绝。本复核仅行为约束只读，不是 strict gate，独立 launcher 所需 slot home/socket 权限仍不可用。完整 release 的子进程输出故障与真实宿主 runId 阻塞均未关闭。
