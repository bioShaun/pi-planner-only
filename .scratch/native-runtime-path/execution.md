# 本机 Pi 运行目录修复记录

- 基线 HEAD `69e521c`；已有仓库 release 相关改动未修改，未暂存、提交或推送。
- 原启动器和全局指令备份分别为本目录 `pi.original`、`AGENTS.original`；原始与最终最小差异见 `launcher.diff`、`agents.diff`。新增配置及维护文档见 hash 清单。
- 先写测试运行：`red.log` 为 0/4 通过。关键失败：预期托管目录为隔离目录，实际为空；TMPDIR/TMP/TEMP 仍为传入值；缺失配置和故障配置仍执行下游并返回 37。随后实现钩子及配置，扩展测试后 `green.log` 为 10/10 通过，包含参数、退出码、符号链接入口、权限、错误所有权、目录创建失败与配置失败。
- 编辑工具将启动器意外改为 664，首次真实 `pi --version` 以 126 Permission denied 失败。Root 经恢复会话明确授权后已恢复原 755，补充模式回归断言，真实命令成功输出 `1.4.0`。原协调请求因主会话没有可用 subagent_supervisor 而取消，由 Root 通过 resume 传达决定。
- `sh -n` 对启动器和配置均通过。真实安装的 pi-subagents 在新 Node 进程中导入及探针见 `probe.log`；临时探针已清理。当前 Pi 父宿主没有重启，不能据此声称现有任务目录已迁移；`/new` 不足，须重启 Pi。
- 实际启动器模式 755，`~/.pi/agent/runtime`、其 `pi-subagents` 子目录及 `/project/tmp/pi-1000` 均由 UID 1000 所有且模式 700。未迁移或删除旧 `/tmp` 状态。
- 回滚步骤、升级后恢复钩子及重启说明见 `~/.config/agents/pi-runtime.md`。Pi 自更新可能覆盖钩子；目录检查不提供抵御同 UID 并发替换路径的原子保证。
- 工作为轻量测试与本地小文件读写，未启动达到 slot 阈值的重活；没有启动其他代理或付费模型。所有主动测试临时文件位于 `/project/tmp/native-runtime-path-test` 或本目录。
