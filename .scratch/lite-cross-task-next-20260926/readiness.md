# 跨任务离线准备结果

Status: done — 离线验证及独立核对通过
Date: 2026-09-26
新增付费模型调用：0

采用 T1 和新建 T2b，拟做 native/lite 各一次，共四次；新 $10 actual 运行间检查点，顺序 T2b native → T2b lite → T1 lite → T1 native。完整定义见 [spec](spec.md) 和 [清单](plan.json)，尚未启动或授权这四次付费尝试。

| 检查 | T1 | T2b |
|---|---|---|
| parent + 固定目标测试 | collection RED：未实现 ExternalToolTimeoutError | collection RED：缺少新 stage 模块 |
| parent masked suite | 13 failed、1110 passed，与冻结失败 ID 一致 | 2652 passed、0 failed |
| gold 目标测试 | 30 passed | 10 passed |
| gold masked suite | 12 failed、1111 passed；零新增失败 | 2652 passed、0 failed |
| 答案隔离 | target 与额外 testRefs 提交长短 SHA 均不可达；无 refs/remotes | target 长短 SHA 不可达；无 refs/remotes |
| 资源 | 共同 Landlock ABI 7，独立 /project/tmp 目录，经 slot | 同左 |

T1 减少的既有失败是 `test_run_command_timeout_raises_alignment_error`，正由标准答案修复。第一版临时检查脚本误要求 gold 失败集合与 parent 完全一致，末尾断言退出 1；原脚本、退出码和全部日志保留。随后只读复核已执行的日志、测试来源、隔离及完整 gold patch，确认符合仓库原有“无新增失败”的评测规则，未改测试/基线，也未重跑。纠正依据见 [T1-result.json](T1-result.json) 和 reconcile-t1.py。

T2 原提示词将 stage 的插入顺序写反。新 T2b 只改“之前”为“之后”，保留原 T2 与全部测试；独立静态分析与标准答案均支持修正后的顺序。现有十项 contract 不充分覆盖 CLI/config/主流水线，因此 spec 中的附加链路审查是两个臂的共同门槛；仍不宣称已验证真实 BLAST 端到端链路。

新增任务后的完整 `npm run test:release` 已通过（typecheck、contract/git/delegate/host/index），运行使用仓库外 TMPDIR 和共同内核保护。29 项守卫回归未重复运行，因为守卫实现未修改。

冻结包含基线、完整 bench patch、11 个未跟踪新增文件、源码/配置/历史哈希与模型配置。独立目录重建的 70 个 bench 文件逐字节一致；78 个执行源码文件已计哈希。历史三轮共 96 个原始文件哈希不变。没有修改原始源仓库，离线检查克隆已清理。

本轮新增仓库文件为 bench/tasks/T2b.json 与 T2b.md；其余为离线证据和计划。执行前仍需重新核对动态模型列表、目录布局、源码哈希和 slot 状态；当前离线通过不等于新付费运行已经开始。

证据：[T1 结果](T1-result.json)、[T2b 结果](T2b-result.json)、[发布测试](release.log)、[复现检查](freeze-check.json)、[T2 文案差异](T2-to-T2b.prompt.patch)、[完整冻结输入](freeze/execution-source.sha256.json)。

[独立验证](independent-validation.txt)确认原始测试记录、文案修正、复现及历史哈希一致；未发现阻塞离线准备的问题。仅离线准备完成，四次付费执行仍待新授权。

## 后续执行状态（2026-09-27）

用户已授权本提案并启动第1条；遇 native intercom 终态计费缺口后按规则停止。完整状态见 [停止报告](execution/report.md)。上文“待授权”是离线准备时点，不代表当前状态；三条剩余尝试仍未启动。
