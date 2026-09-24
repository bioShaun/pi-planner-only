# 当前验收记录（2026-09-20）

执行清单的授权范围已完成，最终验收PASS。原P1-A/stop/P2已先提交 `83a0ad4351300e4537435ce637a995207e221ed0`；原77项冻结说明与两份历史忽略原型见 [baseline-freeze.json](execution-20260920/baseline-freeze.json)。

| 项目 | 结果 | 证据 |
|---|---|---|
| P1-B | 仅报告提交能力；一次修复、不可变来源、声明和连续性校验，无新增Truth | ADR-0009及入口回归 |
| 实际launcher | structured_output为唯一工具，一次成功提交，工作区不变 | report-only-run-3zZ7ry |
| 真实TUI | queued/scheduled/combined全部通过，关闭后调用0/0/0、settled、自然退出 | vsHbSx/TupxIs/2VtAyF各run |
| P3 | Gemini Root/Luna child/low，27/27质量通过，仅token/完成率/延迟 | [study-summary](study-run-yL4RzS/study-summary.md) |
| 最终release | npm run test:release exit0，60文件哈希前后及当前一致 | release-run-GJqscr |
| 独立代码 | 完整审查后剩余修正获fresh PASS；其余63项源码未变 | strict-run-2FEEMJ与strict-run-ed0kfI |
| 独立证据/收尾 | 完整证据child PASS；最终收尾门禁PASS且外层exit0 | strict-run-Bg1P0s与strict-run-dihsWK |
| 最终冻结 | source66+harness25零漂移 | execution-20260920/final-freeze-check.json |

三组direct/baseline/optimized总token为54,524/815,498/846,506，均9/9完成，延迟中位数7.560/35.585/34.879秒。优化组未显示总token下降，未作费用节省结论。P3保留的是其所测版本；之后的修复由当前release和代码门禁覆盖，版本边界详见 [完整收尾记录](execution-20260920/closeout.md)。

partial grace和原始畸形报告诊断仍unsupported。十分钟为操作默认值，未证明统计最优；长任务校准和Request剩余时间见工单07。Root读取政策未放宽。旧失败/超时均保留，Bg1P0s外层124没有改写；dihsWK独立核验后正常退出0。所有soft预算超时如实记录，不声称软预算为强制限制。

最终实现提交：`9dd61755a2748e3f432e6b5f362945963906637d`。未推送或发布。
