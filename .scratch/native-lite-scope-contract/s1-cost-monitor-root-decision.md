# Root 决定：补齐 S1 校准费用停止机制，暂不放行 provider

准备批次 `/project/tmp/pi-native-lite-20261028T161800+0800-s1link`、attempt `link1` 的两臂预检已报告通过，但未启动。Root 实读执行报告、runner、budget guard、request fingerprint、child extension wrapper，确认 `ARM_COST_STOP_USD` 目前仅记录，runner 的 `/subagent-cost` 在完成验收后才查询，故未满足逐臂 reported USD1.25 停止要求。

不放宽既定停止线，也不把共享账本 reserve 当作 reported cost。用户已授权推进校准，Root 在该范围内批准必要的最小离线修复；无需再次请求用户批准。此为新行为变更，必须严格先有效红灯后实现，不适用 checksum 时序例外。

授权同一执行 worker 补齐 Root+child 运行期间的原始费用观察、去重与停止链路，并保留既有终态费用审计。优先独立监测模块/扩展及最小 runner 集成；只可修改本项目实验辅助脚本、相应测试及新冻结材料，不可修改候选、产品源码、全局安装、guard 预留算法/上限或真实共享账本。先核对真实事件、child extension 传播及 session 持久化契约；若无法在此范围可靠实现，提交具体设计冲突给 Root，不能猜测数据来源或用完成后检查替代实时监测。

语义：USD1.25 是已报告费用的观察停止阈值，非 provider 发票硬上限；请求未返回时费用尚未知，停止延迟和在途请求可能导致超出，必须如实记录。阈值达到或已结束响应费用缺失/无效/矛盾即 fail closed，终止本臂且不启动后续臂。尚在途的响应不能误算零，也不能一开始即视作缺失。每条费用必须关联本批 arm、Root/child session/message/request；副本与累计快照不得重复计费。关闭/监测错误、child覆盖缺口或未能确认进程停止均不可通过。

预算沿用 USD30 累计授权、reported USD26 停止点、共享请求预留严格 <26、控制子代理 USD1.50 检查点。修复期间无 provider 实验启动。实施前写测试并运行，保留证明旧链路缺少相应行为的红灯；实现后保留聚焦、真实 runner 本地 mock 集成及相关故障注入绿灯、适用 release 检查。所有重任务先 slot audit/status 归档并走 slot，TMPDIR 必须仓库外且不在 /tmp。

实现完成后冻结改动、原始测试证据及费用，由 Root 核对实际 diff 与红绿时序。旧准备批冻结材料保留；runtime/启动输入变更须新批或可审计版本重新冻结，不覆盖已冻结历史。新单臂 launch gate 仍未签发。后续只先 S1-native，证据验收通过后再考虑 S1-lite。
