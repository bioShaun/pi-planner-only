# 03：受保护条件下重新取得目标 Root 三臂样本

Status: done
Type: task
Execution: 三次已完成；有效及质量 3/3，累计 $3.80569241；独立证据核对通过，停止新增调用。

用户在票 02 完成后要求“下一步”。本轮独立沿用此前确认的每臂一次、最多三次、$10 actual 运行间检查点标准。
详见 [新计划](../guarded-calibration-20260926/plan.md) 及 [冻结清单](../guarded-calibration-20260926/plan.json)。

- 同一 T3，Opus Root、Luna child、strict=0、handoff=off；共享已验收的 Landlock 入口和公共资源说明。
- 顺序 lite → native → direct，串行、无重试、无健康生成请求。
- 旧三次保留规程 FAIL，旧支出不进入本轮预算，不覆盖或复用旧 campaign。
- 源码、完整补丁和新增文件已冻结；本地复现验证通过。现有 29 项回归与发布检查证据可复用到未漂移源码。
- 外部预检、受保护 goldcheck、运行前模型/环境复核已通过，见 preflight-complete.json。
- 用户明确授权后，原入口的外部执行申请获准；保持逐条资源预检和验收。

完成定义：最多三次真实尝试或按条件停止，保留完整质量、费用、child 终态和资源约束证据；不发布单样本节省比例。

## 完成记录

详见 [受保护校准报告](../guarded-calibration-20260926/report.md)。lite $0.80976564、native $1.10541327、direct $1.89051350；每条目标测试 30 passed，masked suite 仅既定 14 个失败。历史 72 个文件与冻结源码未变。

资源入口与命令证据通过；direct 缺完整最终测试 diff、benchmark 实际 skipped 的证据限制已披露。旧轮 FAIL 不追认，不发布节省比例。下一步先离线设计跨任务对照；不自动追加付费尝试，handoff 继续延后。
