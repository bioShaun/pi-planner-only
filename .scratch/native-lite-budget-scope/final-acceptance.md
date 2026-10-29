# Root 最终验收：预算口径修正与测试续跑收尾

状态：控制worker已complete，process terminal observed，active async capacity 0。compare-a2、compare-b3、compare-c5均stopped；每批只启动一次S1-native，余臂取消。0个通过协议验收的样本、0个完整pair，不能给出Native/Lite优劣结论。没有运行中的实验，也没有当前ledger lock。未提交、推送或安装。

## 最终费用

预算累计上限USD30仅测试运行，交互准备/审查Root排除；保守计入控制/修复worker及实验Root/child。请求停止线26，4美元安全余量。

Root在worker完成后重读唯一session，按assistant entry id去重339条，reported USD1.12088280，无重复或cost缺失；session SHA256 `6ea96dbc0b0b72c3fc9b9ad78de516806f37030cc70d1c5be457dfdc35b4f618`。会话路径 `/project/tmp/pi-native-lite-budget-scope/control-session/218c7347-e6bb-4471-a93e-9929dbefb145/run-0/session.jsonl`。worker报告中的333条/1.08673486是较早检查点，由此完整终态值替代，不叠加。

| 项目 | reported USD |
| --- | ---: |
| 历史纳入控制/修复 | 5.40165224 |
| 历史实验 | 0.06735550 |
| 本轮控制worker最终 | 1.12088280 |
| compare-b3实验Root+child | 0.03692242 |
| compare-c5实验Root+child | 0.04598992 |
| 已知报告费用合计 | **6.67280288** |

本轮新增已知reported合计1.20379514。上述是模型报告费用，不是发票；compare-a2首请求在本地锁处失败、无usage，未用空日志宣称provider账单为0。原主会话费用事实仍在旧审计，只不纳入测试限额。

ledger最终59事件、reserved16.204782395，SHA256 `e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d`，lock路径不存在，距26停止线9.795217605。保守预留与reported不相加；停止不是实际费用超限。

## 修复与测试验收

- 预算scope记录已修正，历史ledger不退款/不重建。
- harness两处完成通知兼容已登记native-async run的缺省source，保留错误身份/显式错误source/stale/duplicate/failed拒绝。真实通知回放红灯2个行为失败，最终通知聚焦22/22。
- 新预算guard仅16→26常量及诊断，保留16源码基线。预算边界/并发/拒绝测试5/5；controller+Lite host最终23/23；隔离npm run test:release通过。
- 锁预检只读拒绝已有路径及非ENOENT错误，7/7通过；两个历史锁经独立维护rename保留，账本字节不变。持锁进程终止遗留锁的隔离复现只证明可能机制，未加入自动回收。
- Root已检查实际tracked diff及新增untracked脚本/测试/fixture，git diff --check通过。产品源码与安装未改。已有recommendation.md两行改动来自本轮开始前，未纳入新增实现。

主要改动：`.scratch/native-lite-lifecycle/{budget-guard-core.mjs,run-rpc-arm.mjs,stage-a-lifecycle.ts,stage-a.test.mjs,process-controller.test.mjs,budget-guard-26.test.mjs,evidence/}`；准备、验证、维护及验收记录在`.scratch/native-lite-budget-scope/`。全部仍是本地工作区改动，无新commit。

## 实验结论与后续边界

compare-c5已到达真实报告审查，实验Root输出完整accepted:false/rejected JSON，不是缺少JSON。worker只读候选仓库并将外部pi-subagents聚合实现标unknown，实验Root却以未研究该外部实现拒绝；这与brief输入边界及允许unknown的规定存在冲突。原始拒绝保持，不得追认为通过，也不能将其当模式质量差异证据。详情见compare-c5-closeout.md。

后续建议先明确“仅候选仓库内源码”的验收表，允许显式标注外部依赖内部实现未知；若研究目标必须覆盖依赖内部聚合，则另给两臂相同的固定版本源码快照并明确扩大输入范围。当前不自动选择新协议或启动新付费批次，正常失败不通过换批次反复重跑。

worker最终报告 `/project/tmp/pi-native-lite-budget-scope/worker-report.md` SHA256 `9f62c45b7258398188b08a5eccd7c91c4f5d85fb1f83e3f653f187b58c203849`。其中“未处理新lock”为通用边界表述；Root最终实际确认当前lock不存在。阶段性报告时间点与本文件冲突时，以本文件的独立终态核对为准。
