# 本机 Pi 运行目录修复结果

启动器在 exec 前加载 `/home/tcuni-claw/.config/pi/runtime-env.sh`，失败时停止；该配置将 pi-subagents 托管状态固定到 `/home/tcuni-claw/.pi/agent/runtime/pi-subagents`，将 TMPDIR、TMP、TEMP 固定到 `/project/tmp/pi-1000`。目录必须由当前用户所有、权限 700 且不是符号链接。全局 AGENTS 只在临时目录规则旁增加一行例外说明；维护文档为 `/home/tcuni-claw/.config/agents/pi-runtime.md`。

红灯 `red.log`：0/4 通过，实际托管路径为空、临时路径仍是传入值，且缺失配置仍启动下游。绿灯 `green.log`：10/10 通过，覆盖 argv、退出码、真实启动器模式、符号链接入口、配置失败、目录链接、错误权限及所有权、创建失败。真实 `pi --version` 输出 `1.4.0`；新 Node 进程导入真实 pi-subagents 后验证 TEMP_ROOT_DIR 为上述托管路径，ASYNC_DIR 和 RESULTS_DIR 分别为其 `async-subagent-runs` 和 `async-subagent-results`，os.tmpdir 为 `/project/tmp/pi-1000`，实际探针已清理。两份 shell 文件 `sh -n` 通过。

启动器曾因编辑工具改成 664，真实版本命令当时失败 126；Root 明确批准修复后已恢复原 755，补充回归测试并重新验证。运行目录和其父目录均为 UID 1000、700。原文件备份 `pi.original`、`AGENTS.original`，最小差异 `launcher.diff`、`agents.diff`，详细记录 `execution.md`，校验清单 `sha256.txt`，均在本目录；回滚时必须参照维护文档中的绝对备份路径并恢复启动器 755。

当前父 Pi 宿主未重启，现有 Native 任务目录没有迁移；必须重启 Pi，`/new` 不够。Pi 升级可能覆盖启动器钩子，需按维护文档复核并恢复。目录检查不是针对同 UID 并发路径替换的原子安全机制。未改仓库产品代码或既有 release 变更，未暂存、提交或推送。
