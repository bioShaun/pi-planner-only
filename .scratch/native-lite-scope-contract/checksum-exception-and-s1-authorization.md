# 用户决定：checksum 测试时序一次性例外与 S1 链路校准

用户在 Root 建议后明确回复：『按照你的推荐处理』。本决定仅覆盖本次既有 checksum/event-sum 检查的测试时序缺口。

接受当前实现的功能验收，依据 root-review-final.md 已核对的回归、故障注入与原始证据；保留错误 fixture、修正后旧实现失败输出、全部时间顺序以及 R1 非 TDD 历史。不将事后旧实现失败追认为先红后绿，不重演开发过程制造合规记录。本例外不适用于后续行为变更，后续仍须实现前有效行为红灯及实现后绿灯。

允许在既定预算内推进 S1 最小真实链路校准，顺序 S1-native → S1-lite，各一次、每臂 300000ms、reported-cost 停止线 USD1.25。控制子代理 USD1.50 检查点继续适用。累计授权 USD30，reported USD26 停止线及请求预留严格 <26 均保留；费用范围排除交互 Root，包含实验 Root/child 和控制准备子代理。历史已知 reported USD8.01491262 是前轮结算，不与 reserved 相加。

Root 先核对新批实际冻结 brief、候选、runtime/config、账本、费用、锁、slot 和逐臂预检，再给具体单臂 launch gate。首臂全部原始证据验收后方可放行第二臂。子代理执行准备、测试和运行，Root 检查实际 diff 与原始证据。任何失败、超时、预算/锁/漂移/费用缺失/终态异常即停，不自动重试、不人工改账本或清锁、不改变 controller/guard、不安装或切换 CLI。

仅 S1 链路校准获得阶段授权。语义 A–D、S2 拓扑和正式四臂比较尚未放行；校准不计正式样本。release 已通过的结论仅适用于已复用的隔离依赖，默认全局缺依赖问题保留。

本决定解除 root-review-final.md、preflight.md 与 progress-report.md 中“checksum 时序例外待用户决定”的当前阻塞；这些文档历史描述与原始证据保持。真实链路是否通过仍由新运行证据决定。
