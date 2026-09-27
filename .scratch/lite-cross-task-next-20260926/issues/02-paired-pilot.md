# 02：跨任务 native/lite 四次探测

Status: stopped
Type: task
Authorization: 用户明确要求按照已推荐的四次/$10方案推进
Execution: 第1条 T2b native 测试与链路检查通过，但计费有效性失败；STOP 已保留，其余三条未启动。

按 [spec](../spec.md) 和 [固定顺序](../plan.json) 执行：T2b native → T2b lite → T1 lite → T1 native，最多四次、串行、无重试，独立 $10 actual 运行间检查点。

上一轮三次授权已完成。本轮必须先取得这份新范围的付费确认，再复核动态模型/环境，逐条验收。T2b 链路审查、最终完整 diff 和原测试断言核对属于两臂共同门槛。

## 停止记录（2026-09-27）

见 [报告](../execution/report.md)。冻结总额未知；完整子产物辅助核算 $1.88898237，独立核对一致，不覆盖原始 valid=false 或 STOP。后续先处理 [终态证据](03-native-intercom-terminal-evidence.md) 与 [任务边界](04-t2-no-alt-contract-wording.md)，不直接续跑。
