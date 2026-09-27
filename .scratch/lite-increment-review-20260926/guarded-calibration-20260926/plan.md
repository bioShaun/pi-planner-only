# 受保护条件下的目标 Root 校准

Status: done
Date: 2026-09-26
Execution: 用户明确授权后完成三次受保护校准；有效及质量 3/3，累计 $3.80569241，独立证据核对通过。结果与限制见 report.md。

本轮由用户在保护修复完成后要求“下一步”触发。采用之前已确认的每臂一次、最多三次、$10 actual 运行间检查点作为新的独立范围。
旧三次仍为执行规程 FAIL，不覆盖、不复用剩余次数或预算；旧六次也不混入本轮统计。

## 固定条件

- campaign：target-root-t3-opus-guarded-20260926。
- T3、Root tcuni-claude/claude-opus-5-5、high thinking、child Luna 配置、插件 ad51067... 均延用已核对值。
- strict=0、handoff=off；native/lite 同一中性前缀。
- 三臂共享已验收的 Landlock 入口和公共临时目录说明。每条使用独立的仓库外临时子目录。
- 顺序：lite → native → direct。按新 campaign 名确定性生成一次，seed 与全清单在 plan.json。
- 最多三次尝试，串行、无自动重试、无 resume、无额外付费健康请求。
- 所有本轮尝试的 actual 费用累计达到 $10 后不再启动下一条；单次仍为 3600 秒上限，$10 不是实时硬限额。

## 已完成与尚未执行

当前代码哈希与保护修复最终验收一致，可复用 29 项回归、完整发布测试和三臂真实 dry-run 的通过证据。
Root 配置、child 配置和计价条目已复核；历史 72 个原始文件哈希未变。
freeze/ 保存基线提交、完整 bench patch、全部新增文件、源码哈希、Root/child 配置、价格和保护验收。

外部目录与 slot 预检已完成；受保护 goldcheck、答案隔离及当前模型 dry-run 通过，证据见 preflight-complete.json。
第一次外部申请被 never 策略拒绝；用户明确允许此次限定范围执行后，重新提交的同一申请通过，没有改用其他入口规避。

## 恢复入口

在允许此次受限沙箱外执行的环境中：

1. 核对 plan.json、冻结源码/模型配置及实际目录布局；运行 preflight.sh gold，检查审计日志。
2. 执行 validate-gold.sh，经 slot cpu、指定仓库外 TMPDIR 调用 guarded-gold.py。它先安装同一保护，再在新隔离克隆核对 gold 和答案不可达性，完成后清理该克隆；不调用模型。
3. 复核模型列表、金标准/隔离结果及配置，将真实通过证据记入 preflight-complete.json（ready=true）。不能仅为解锁脚本而写该字段。
4. 逐条执行 preflight.sh attempt-N，检查资源后再运行 run-one.sh N。每条结束核验质量、计费、所有 child 终态、资源保护元数据与原始修改，再决定下一条。
5. 第 N+1 条需要 Root 的 after-attempt-N.json 明确 continue=true、完整 actual_total<10；一次失败或任何费用、模型、终态、证据、资源约束缺口均停止。

run-one.sh 在缺少真实预检完成记录时会提前 BLOCKED。不得调用内部 run-body.sh 绕过保护。
仅使用本轮 runs 目录做费用汇总；历史数据另列。保留每次失败，三个样本仍不用于发布节省比例。

原保护验收见 freeze/guard-acceptance.json；此前校准结果见 [报告](../calibration-report.md)。
