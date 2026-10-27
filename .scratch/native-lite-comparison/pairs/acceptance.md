# P6 批次收尾与 Root 验收

状态：**本批停止，0 对有效样本；不能比较 Native/Lite 的质量、速度或费用。** 用户确定的 US$20 上限、Root `tcuni/gpt-6.1-terra` 与 worker `tcuni/gpt-6-luna` 已生效于实验配置，不再是待授权事项。

## 实际执行与责任

首臂 S1 Native 有两次启动尝试，均未发出实验模型请求：

1. 2026-10-27 21:48:08 +08:00，执行控制命令没有先切换 worktree，runner 的 CWD 检查 exit 1，Pi 未启动。
2. Root 依据协议批准唯一一次同协议重试。21:59:23.771 +08:00，Pi 启动，但新写 RPC runner 漏发初始 `get_state`，没有提交任务 brief。收到工具运行240秒告警后，Root 检查实际日志及源码，验证实验 Pi PID、parent 和 cwd，向该 Pi 发 SIGTERM。22:04:39.094 +08:00 退出143，实际进程跨度 **315.323 秒**；240秒是告警阈值，不是实际结束耗时。没有实验 child。

S1 Lite、S2 Lite、S2 Native 均未启动。失败记录及唯一重试决定见 [execution](execution.md)、[failure](S1-native-run-failure.md)、[retry decision](retry-decision.md)。失败来自本轮执行控制，不是模式自身表现。Root 审查也漏掉了 RPC 缺少初始发送，不能将责任归给被比较模式。

## 离线修复验收

Root 读取了实际源码与测试输出，接受以下范围：

- 四个 detached worktree 均为冻结基线 `f818cc91c98d6129a152fb28161e00d2f601e494`；真实 Pi 离线 loader/RPC 验证版本、模式和 Terra/Luna 角色覆盖，未改 dirty 全局安装。
- 实验预算保护采用共享原子账本、请求前保守预留、失败不退款、文本/模型限制和16384输出上限。hook 身份由当前 ctx 提供，外层环境缺失/污染的真实 localhost 回归先失败后通过。源码传播路径和注册测试支持 child 注入，**没有正式 Native/Lite child 请求的完整链路验证**。
- RPC runner 已补初始 `get_state`、模型/session 匹配后才提交 brief、默认15秒握手超时；错误身份与无响应均不提交任务。实际缺陷行为红灯与修复后的假 Pi 进程回归均已核对，详见 [controller report](pairs-execution-report.md)。这不等于真实整臂成功。
- 最终受影响测试命令：`TMPDIR=/project/tmp/pi-native-lite-pairs/tmp TMP=/project/tmp/pi-native-lite-pairs/tmp TEMP=/project/tmp/pi-native-lite-pairs/tmp env -u PI_SUBAGENT_CHILD node --test .scratch/native-lite-comparison/preflight/budget-guard.test.mjs .scratch/native-lite-comparison/preflight/budget-guard-provider.test.mjs`。cwd 为主仓库；2026-10-27 22:30:51–22:30:56 +08:00，exit 0，**10 tests / 10 pass / 0 fail**。包含预算拒绝、正常请求、身份污染、多模态拒绝、跨进程预留、失败不退款和RPC握手。
- 最终 runner SHA-256 `9565082c601a90ff2bdf576a73ddd1b1498eae8c682b6c8d3bb1748083beb945`；provider/runner测试 `a3b0ad255fcd09a3bd01ec6f2a4cca0a0e7bb5fa5456d8086de1330bbd3441bc`。预算guard/core仍是协议v2冻结值。

最终测试原始输出及exit分别在 `/project/tmp/pi-native-lite-pairs/preflight/p6-guard-final.stdout`、`p6-guard-final.exit`；原有红灯、中间失败未改写。测试调试曾误启动真实Pi进程，但缺少测试账本触发预算保护exit73，未到provider；不能隐藏该调试失败，也不计为正式臂。没有产品源码改动。修复阶段仅重跑受影响检查；此前隔离release通过属于较早验证，见 [guard报告](../preflight/budget-guard.md)。

## 费用口径

以下是父端 status.json 中 `totalCost.costUsd`，均为 Luna 准备/执行控制的报告值，**不是实验臂用量，也不是最终账单**：

| Run | 工作 | 报告美元 |
| --- | --- | ---: |
| 36c7a7ce-6cd2-4930-9102-00fdec37667d | 离线环境预检 | 0.12735892 |
| 2c1f5e95-87e9-4be2-bfb6-cb2eb366d4a5 | 预算保护实现 | 0.22839210 |
| 166de069-e311-4af8-a1dc-ab8a222de64d | 保护身份修复 | 0.14862112 |
| 19c20f4d-0c74-4b45-8f96-50931bb4956d | 首次控制启动 | 0.30405332 |
| b009a42b-f6e5-4094-ac0e-558974b6e69b | 重试控制及握手修复 | 0.31282158 |
| 合计 | 准备/控制 | **1.12124704** |

共享实验账本仍为初始 US$1、1个准备事件，0个正式请求事件。准备报告费比seed多 US$0.12124704，计入预先留出的US$4余量，不篡改历史账本，也不将seed当作真实已花费用。主会话费用、实际provider发票及完整缓存逐项对账未完成，仍unknown，不能声称整轮总费用就是US$1.1212。

## 后续边界

本批允许的启动重试已用尽，按协议停止；修好的runner没有再次运行正式臂。未来重开必须作为新批次保留旧失败、新session/output路径、原有费用覆盖、重新冻结runner及manifest；不能覆盖当前结果或把失败从统计中剔除。US$20和模型授权仍有效，无需重新询问金额。P7没有可补测的比较结果；P4仍只累计独立真实任务，不把预检/重试拆成成功样本。
