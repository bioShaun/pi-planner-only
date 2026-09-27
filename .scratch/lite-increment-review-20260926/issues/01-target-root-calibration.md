# 01：目标 Root 三臂行为校准

Status: needs-triage
Type: task
Execution: 三次范围已执行；任务质量与计费 PASS，执行规程 FAIL。票 02 已修复验收；旧规程 FAIL 保留，新样本仍需新的冻结与预算。

## Scope

严格执行 [spec.md](../spec.md)：T3 × direct/native/lite 各一次，Root 为 tcuni-claude/claude-opus-5-5，
保持 child、插件、中性前缀、strict=0、handoff=off 不变。按 order.json 串行，无额外健康请求、无重试或补样本。
旧六次范围及剩余额度不沿用；本轮目标是行为校准，不是收益比例证明。

## Acceptance

- 启动前记录明确的新预算授权，冻结最终输入，并核对当前环境及模型配置。
- 最多三次，逐次检查质量、完整费用和停止条件；任何失败保留证据，不补跑。
- 报告同时给出实际模型价、Root/child 成本、首次委派时点、质量、耗时及角色调用。
- 按 spec 的预先约定分支决定停止投入或另拟固定样本，不自动扩量。

## Preparation

三份 bench/arms/*-opus-calibration.json 与目标 actual 计价条目已写入工作树；
已有其他价格、插件源码和旧原始 runs 不变。配置纯离线核对及当前 14 项回归通过，完整发布检查见 ../release.log。

## Result

三次均目标 30 passed，完整费用共 $3.73554521；native 首次实际委派第 10 轮，lite 第 6 轮。
所有 arm 发生 /tmp 写入；已核查归属并归档/清理七个残留文件，两处目录也确认不存在。
整体不置通过，不自动重试。本票保留三次结果并转待评估，运行约束修复由 [02](02-runtime-temp-boundary.md) 承载。
见 [报告](../calibration-report.md) 与 [独立核验](../execution-20260926/independent-validation.txt)。

- 运行约束修复已独立验收（票 02 done）。原三次结果不追认为合规；没有自动补跑或追加模型请求。下一轮须重新确定预算并冻结共同入口及资源说明。
