# P2 交接检查点

状态：第 5 次运行错误且费用未知，已停止付费；第 6 至 12 次未运行，未经放行不得继续。不要重试第 5 次或抹掉 STOP。不改变生产提示词，不提交。Root 决定证据不足；恢复需可核验费用或用户明确修订未知费用停止约束。

## 样本与账本

| 顺序 | 运行 | eval pass | 原 harness verdict | 重分析 verdict | 费用 USD |
|---:|---|---|---|---|---:|
| 旧批次 | pilot + 6 次正式 | 不用于分析 | 环境失效 | 不纳入 | 0.2527056 |
| 新 pilot | G1 luna rep=1 | true | invalid，exit 4 | 历史 Root 验收 valid；最终版未通过 | 0.03278488 |
| 1 | G1 treat rep=1 | true | invalid，exit 4 | Root 验收 valid | 0.0588796 |
| 2 | G1 base rep=1 | true | valid，exit 0 | 最终解析版 valid | 0.082592 |
| 3 | T3 treat rep=1 | true | invalid，exit 4 | Root 验收 valid | 0.306635 |
| 4 | T3 base rep=1 | true | valid，exit 0 | 最终解析版 valid | 0.4173528 |
| 5 | T2b treat rep=1 | true | evidence collection failed，exit 4 | 不可判有效 | 未知；已报告 usage 下界 1.5704718 |

前四正式及两批 pilot 已报告费用累计 $1.15094988，第 5 次 Root $1.055255、两个 child $0.4267626 和 $0.0884542；累计下界 $2.72142168，不能作为累计实费。Root 与 child 各一次 502 错误无 usage 报告，无法确认收费；收集器报 `child assistant error`，原 STOP 保留。不得凭 status.complete 或零字段推定费用。逐请求取证见 `/project/tmp/ppo-p2/seq5-offline-audit/seq5-requests.jsonl` 和 `seq5-audit.md`。

## 顺序与证据

正式 campaign `/project/tmp/ppo-bench/results/p2-restart-terra-01/campaign.json`，顺序完整输出 `/project/tmp/ppo-p2/restart-formal-order.log`。下一原定是第 6 次 T2b base rep=1；第 7 至 12 次尚未放行。第 5 次任何后续处理必须先由 Root 确认真实费用完整性和实验有效性，若费用仍未知继续暂停，禁止擅自增加付费样本或重试。

原始 runs `/project/tmp/ppo-bench/results/p2-restart-terra-01/runs/`；第 5 次原始 run、STOP、两个 child 的 status、session、artifacts 和 archive 已冻结 `/project/tmp/ppo-p2/restart-formal-05-recovery/`，`SHA256SUMS` 验证通过。runIds `fb11078d-a98b-4abf-8282-00f657807b68` 和 `bcdd4495-d275-4029-9048-5ff492927c98`；后者 child transcript 存在 502。最新实际汇总 `/project/tmp/ppo-p2/restart-formal-summary-05.json`；第 1、3 次重分析证据分别 `/project/tmp/ppo-p2/restart-formal-01-reanalysis.json` 与 `restart-formal-03-reanalysis.json`。因历史 invalid 原路径不自动追认，整目录汇总显示 INCOMPLETE；上述账本显式加入 Root 已验收的独立重分析结果，未双计。

前两次逐次预算核对及第 3 次报告见日志；原历史 invalid 与 reanalysis valid 保持并列。当前同版解析正式 seq1-4 均通过，原始结果及解析 SHA 见 `/project/tmp/ppo-p2/seq5-offline-audit/recompute.json`；pilot 旧重分析 bundle 在最终版因缺 status 被拒，尝试用冻结 status 重建又因引用冲突被拒，历史 Root 验收不等于最终版通过。T3 base rep1 测试变动已从 transcript 重建、核验契约，未发现删除或弱化既有断言；全文、diff 与范围限制见 `/project/tmp/ppo-p2/seq5-offline-audit/review.md`。

## 代码与验证

保留全部已有未提交改动；native 异步 `bg_wait`、结构化通知、绑定的 status/list 管理观察兼容已按 TDD 实现，Root 已验收。最近完整回归 `/project/tmp/ppo-p2/status-identity-suite.log`：41 native + 3 guidance 通过，相关红绿和中间失败输出见日志。实验专用 settings `/project/tmp/ppo-p2/agent/settings.json` 与 `.scratch/subagent-split-check/p2-settings.json` SHA-256 `166e4afe5012a97cffc4424ba734d779ab663226771b48b0d63418b642824b5a`；全局 settings SHA-256 `335a650100ae9178fe4c3ae021eadcb0d419c5f72b90a4a2acdd70004708d5b7`。所有运行显式传 agent/temp，健康检查跳过且单次尝试。完整 slot audit/status 保留在日志。
