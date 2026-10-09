# 短路径修复完成，续跑等待数据发送授权

Status: offline-complete / execution-blocked，2026-09-27。

已完成诊断、修复、离线复验和独立验收。剩余3条仍未调用模型，新增任务费用为0；此前T1 native的$1.29824603继续计入原4次／$10运行间检查点。原运行、eval、STOP、克隆和历史证据保留，不追认质量PASS。

## 已完成的工作

实际Manager探针在任务Python3.12的83字节物理TMPDIR下重现AF_UNIX路径过长，在相同Landlock下22字节路径成功。完整2×2对照确认18个环境失败仅由路径因素触发：

| 源码 / 路径 | masked suite |
|---|---|
| 未改源码 / 长 | 31 failed、1092 passed |
| 未改源码 / 短 | 13项既有failed、1110 passed |
| 本次产物 / 长 | 30 failed、1093 passed |
| 本次产物 / 短 | 12项既有failed、1111 passed |

本次产物的目标测试在长短路径下均30项通过。短路径评测是离线反事实证据，不覆盖原付费运行结果。[诊断记录](summary.md)、[矩阵证据](matrix/)。首次沙箱错误日志曾被实现者覆盖，已明确记录并从工具输出恢复，见 recovered-first-sandbox-attempt.txt；没有伪装成连续无失败。

`bench/temp_guard.py` 增加模型启动前的真实socket预检。它使用任务配置的Python，而非只使用入口系统Python（本机3.13与任务3.12路径生成规则不同），在新子进程中绑定并关闭AF_UNIX listener。长路径在进入run-body/Pi前以退出3和STOP拒绝，不触发RETRY；短路径通过且/tmp写入仍被Landlock拒绝。原35项断言保留，新36项回归和完整release均通过。

剩余原序号2–4已映射到27字节物理目录 `/project/tmp/ps-3d74eb12/r2`、`r3`、`r4`，metadata和归档器按冻结[映射](execution/paths.json)关联完整runId。只允许T1 lite、T2c lite、T2c native；禁止重跑第1条，后续累计费用包含旧支出，原STOP不解除。

[独立预检](execution/independent-preflight.json)确认3条dry-run、真实入口故障检查和禁止序号1均通过；[独立审查](reviewer-result.txt)及[验收状态](acceptance.json)为PASS。新82份源码、11份执行入口、161份历史证据哈希无漂移。第2条的实际资源预检也通过。

## 目前唯一阻碍

自动审批拒绝执行 `bash .scratch/lite-short-temp-20260927/execution/run-one.sh 2`，要求明确授权发送的上下文及外部接收端，且禁止间接执行或绕过。命令未执行，无started标记、新campaign或新增模型费用。

配置接收端为 `http://<tcuni-claude-proxy>`，对应Opus Root、Luna子模型以及冻结角色配置中的DeepSeek。可能发送的任务上下文包括任务提示词、执行期间读取的仓库源码/测试内容和工具输出（含路径、日志）。未读取或展示密钥。

需要用户明确允许上述数据发往该接收端，才能按原四次／$10累计检查点继续剩余三条；不需要扩大预算或更改任务。详情见[自动审批阻塞记录](execution/approval-block.json)。获准后还须刷新资源/冻结输入核对，再启动第2条，不重跑第1条。
