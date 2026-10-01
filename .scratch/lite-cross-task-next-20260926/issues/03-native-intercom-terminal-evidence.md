# 03：native intercom 路径缺少可结算的终态回执

Status: done — 由 bench-plugin-fixes 票 05（a3d26d7）与票 12（32c4a86）覆盖
Type: bug
Execution: 已定位并保留真实证据；尚未修改冻结计费代码。

四次试跑已获授权，但第一条 T2b native 在结束后触发既定停止条件。Pi 退出 0，目标 10 项通过、masked suite 2654 项通过；runner 因 runcheck 无效退出 4 并写 STOP，剩余三条未启动。

## 可复现证据

原始运行：`/project/tmp/ppo-bench/results/opus-cross-task-t1-t2b-20260926/runs/T2b-native-opus-calibration-1.jsonl`。
归档材料在 [execution](../execution/)，包括 intercom-receipts.json、runcheck.json、attempt-1-children.json、child-evidence/ 及 all-raw.sha256.json。

1. 首个 worker 正常返回 exitCode=0、完整用量。
2. 第二个 worker `0669d2da-e632-4d48-9554-d35145bfd1da` 通过 intercom 请求 Root 决策，subagent 工具提前返回 exitCode=-2、detached=true、partial usage。
3. Root 回复后执行 bg_wait。它返回 `details={mode:management,results:[]}`；随后 custom subagent-notify 只有文字报告及 session 路径，无结构化最终用量。
4. 最终 child metadata 和完整 child transcript 记录 exitCode=0 和完整累计用量，与中间 partial usage 不同。
5. 冻结 native_results.py 对中间回执先登记 child 并写 failed/nonterminal problems；主 JSONL 又没有可用的完整终态结果。runcheck.valid=false，summarize total=null。

独立产物辅助核算为 Root $1.80496475 + 两个 child $0.08401762 = $1.88898237；该数不覆盖原始 eval.valid=false、STOP 或冻结汇总器的未知总额，也不授权续跑。

## 修复边界与验收要求

- 先明确可靠终态的采集入口。不能仅忽略 detached、把中间用量当完整用量，或相信完成文字。当前 bg_wait 本身未给终态，单纯“后一个覆盖前一个”不能解决此真实形状。
- 若使用子产物，必须将命中的 runId/index、模型、完整用量、终态及来源文件冻结到可复现证据包；不得从未绑定/缺失/变动的外部路径静默补账。
- 归并按同一实际 run 身份完成，中间累计快照和最终累计快照不能相加；不同 run 即使恢复同 session 仍分别计费。真实的相互冲突终态仍应拒绝。
- 增加真实 detached → supervisor → bg_wait 空管理结果 → 终态产物路径的故障注入；覆盖缺产物、runId 不匹配、最终失败、未知模型、错误用量、未结束、重复终态、嵌套委派。现有断言不删不弱化。
- 完成适当离线回归、外部 TMPDIR 的 test:release、独立审查；旧 runs 和 STOP 只读不变。修复后只读重算另写结果，不回写旧 eval。
- 此票不包含追加付费试跑。票 02 停止状态与剩余三条如何重订需另行决定。

## Comments

- 2026-09-30: 状态改为 done，按下列证据收尾（未重跑付费试跑）。bench-plugin-fixes 票 12（32c4a86）把本用例的 detached → bg_wait 空管理结果 → 终态产物回放固件入库（`bench/fixtures/native-detached-replay/`），断言总额 $1.88898237，与本票辅助核算一致；票 05（a3d26d7）让子代理启动时关闭 intercom bridge，不再产生该中间回执。旧 runs 与 STOP 保持只读不变。
