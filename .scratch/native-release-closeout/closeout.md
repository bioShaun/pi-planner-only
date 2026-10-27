# 隔离 release 本地提交检查点

基线 `69e521cdbabdd5c198f083491088764a59b8f529`。子任务只整理已有验收证据，没有改源码、重跑测试、暂存、提交或推送。Root 已复核实际源码、tracked diff、最终 release 和故障注入输出，接受本地提交；提交路径见 [commit-paths.txt](commit-paths.txt)，子任务原始检查见 [checks.log](checks.log)。

交付为固定版本 fixture、隔离 release 入口、七项 CLI 故障注入测试及双语开发说明。原 [验收](../native-release-repro/acceptance.md) 和 [执行记录](../native-release-repro/execution.md) 保持原样；[最终哈希清单](../native-release-repro/final-sha256.txt) 全部 15 项通过。最终真实安装 94 包，typecheck、真实 contract（未跳过）、CLI 7/7、host-runtime 5/5 和其余 release suite 通过，退出 0。首次补测的四项失败是测试对 Node compile cache 的过严断言，修正后的故障注入日志为 7/7；原始日志均保留。

默认本机入口仍可能因全局缺少 `@earendil-works/pi-ai` peer 而失败，隔离入口需要根项目开发依赖和可访问 registry；中断信号时不保证清理。host-runtime 使用受控 fixture，不代表完整子进程运行时验证。

历史验收中的 Native `/tmp` 托管目录观察保持不变；之后独立本机配置已修复，重启后真实 Native 任务落盘通过 [最新本机验收](../native-runtime-path/acceptance.md)。该链接是本机参考，不属于本次提交清单；旧状态未迁移，Pi 更新后仍需复核启动钩子。

Root 最终清单包含 22 个文件：7 个交付文件、12 个 release 验收证据文件和 3 个本次检查点文件。历史资源预检日志 `../native-release-repro/resource-preflight.log` 含其他项目的作业名称和资源统计，保留本机，不纳入提交；历史执行记录对它的引用也仅在本机可用。该日志不在最终哈希清单中，排除它不影响清单 15 项证据的完整性。其余必要日志包含执行环境路径，已复核后保留原始字节。其他未跟踪文件、运行时备份、调查、原始会话和缓存均不纳入。`checks.log` 中的 23 项和体积是子任务初始候选清单的记录，以当前提交清单为准。

Root 暂存后检查发现：`git diff --cached --check` 仅在 `red.log` 和 `followup-tests.log` 的 Node 原始失败输出中报告行尾空白。这两份日志受历史 SHA-256 约束，保留原始字节；排除这两份原始日志后检查代码、测试、文档和其余证据，不放宽源码格式要求。

清单中的 `.log` 文件被 Git 忽略，Root 暂存这些指定文件时需要显式强制添加；不可扩大到其他忽略文件。本机参考链接不随此清单提交，在其他检出中不可用。
