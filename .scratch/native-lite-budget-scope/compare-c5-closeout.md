# Root compare-c5 终态验收与范围冲突

状态：compare-c5停止，其余三臂取消，0个通过协议验收的样本、0个完整pair。本轮未超用户30美元测试授权，停止原因为实验Root明确拒绝验收及范围冲突；不重试该正常终态、不重建同样批次追求通过。

## 真实终态与原任务

Root直接读取实际S1 brief、worker报告、raw session第1462行及control。子任务completed/exit0，报告实际hash `ff465b8e90b151d033b1261e6c560dd74e1506feaba8ccc074e1b1e5c38b8e43`。实验Root最终输出了完整root-acceptance JSON，其中accepted=false、verdict/reviewVerdict=rejected。**不是没有验收JSON，而是没有通过验收。** runner因此exit1，Pi exit0，耗时89秒。完成通知修复已让流程到达实际报告评审；controller没有再次报source身份错误，真实lock路径不存在。

冻结brief要求：
- `Use only this arm's worktree/input and its external results directory.`
- `Inspect product source and relevant tests only`；报告未知项。
- `Record unknowns rather than infer runtime or billing behavior from source.`

报告调查候选插件内Root/Lite usage累加、Native cost RPC快照替换与缺失值处理，并明确将外部pi-subagents cost RPC内部聚合/去重列为未知。

实验Root拒绝理由：未调查Native cost RPC上游如何收集/汇总child usage，核心计数/去重边界不完整。该要求涉及候选外安装包实现，与只读本臂worktree的输入边界冲突。现有协议允许报告未知项，却未明确定义“外部RPC内部实现缺省”能否单独导致失败，因此不能把此次拒绝当作worker能力失败或模式优劣证据。也不能由父Root在事后伪造accepted=true来改写本臂结果。

后续如继续比较，应先冻结明确一致的可读输入与验收表：要么只评估候选仓库内语义、允许上游内部实现作为已标注未知；要么为两臂同字节提供经过版本/hash固定的pi-subagents源码快照，并把它明确加入调查范围。两者对应不同研究范围，不能在已运行批次中偷偷切换。本轮只收尾，不新增付费批次。

## 费用和证据

Root独立检查15条fingerprint与ledger第45–59条事件按(sessionId,payloadHash)多重集合完全一致。
- 实验Root 8条reported USD0.03682460；session hash `6f77914da005ab9921574f403b8826f3dac0bb82374b2257dca1a566865c2113`。
- 实验child 7条reported USD0.00916532；session hash `ee65bc1d5c36b02db36946b7797c3b6c9535fecd5bf2fe96c54958f65043ffd2`。
- 本臂reported合计USD0.04598992；不是invoice。
- 控制worker目前332条unique assistant，USD1.08112840，无缺项；session hash `8c119496a3831a2f07143462fa558c2742662ee98ed5620123c51bf0e065f21d`。
- 历史纳入reported5.46900774 + compare-b3实验0.03692242 + compare-c5实验0.04598992 + 当前worker1.08112840 = **USD6.63304848**，收尾增量后续按同session重新算，不重复叠快照。排除交互准备/审查Root，保守包含控制/修复worker。compare-a2未报告usage，不用空日志伪造invoice0。
- ledger59事件/reserved16.204782395，SHA256 `e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d`；26停止线余9.795217605。预留不是实际报告费用，不与reported相加。
- raw session hash `535e48c7597e2c7aff502108ec61129736c9bcc0359d52c792b98007ab595d45`；control `7a1999c57bafe7743b67da5e89ac0d9eed42d17c1e792c38d9f761bfb365fd85`。

## 收尾范围

只要求worker保留本批不可变证据、修正“缺少Root acceptance”为“Root明确rejected”，在最终报告说明范围冲突、无新锁、无后续臂，并给出最终控制session路径/hash/计量检查点及准确changed files。不要改报告正文、manifest、协议历史、候选、guard或controller，不跑新测试、不启动任何provider实验、不新建批次。Root最后核对实际git diff/费用与终态后交付；不自动提交/推送/安装。
