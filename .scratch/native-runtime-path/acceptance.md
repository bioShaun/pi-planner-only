# 本机 Pi 运行目录：Root 验收

结论：配置及启动入口改动通过验收；2026-10-27 重启后的真实 Native 新任务落盘检查也已通过，运行目录切换完成。

## 已核对

- 启动器仅新增 exec 前加载配置及失败退出的钩子，原有版本选择、符号链接解析和 argv 转发保留。
- `/home/tcuni-claw/.config/pi/runtime-env.sh` 固定 `PI_SUBAGENTS_TEMP_ROOT=/home/tcuni-claw/.pi/agent/runtime/pi-subagents`，并设置 `TMPDIR`、`TMP`、`TEMP` 为 `/project/tmp/pi-1000`。
- 托管状态不再配置到会被外部定时清理的 `/project/tmp`；普通临时文件保持在该目录。状态目录是用户明确授权的本机规则例外，已在全局 AGENTS 留下维护指针。
- 红灯记录是既有启动器未导出目标环境、缺配置仍启动下游引起的行为失败，不是语法或导入错误；最终10项测试通过。
- 读取完整测试源码，确认覆盖参数/退出码、配置和目录故障、真实入口执行权限及符号链接入口。
- 新 Node 进程的真实 pi-subagents 导入探针确认 TEMP_ROOT_DIR、ASYNC_DIR、RESULTS_DIR 与 os.tmpdir 的目标值；实际探针创建/清理成功。真实 `pi --version` 输出1.4.0。
- Root实际核对启动器为755、三个运行目录为UID1000/700，sha256清单全部通过，`git diff --check`通过。
- 上一轮隔离release改动及证据的hash清单也全部通过，未被本轮修改。未重复运行无关release检查。

## 重启后验收（2026-10-27）

- 本轮父会话和 Native worker 均继承 `PI_SUBAGENTS_TEMP_ROOT=/home/tcuni-claw/.pi/agent/runtime/pi-subagents` 及 `TMPDIR/TMP/TEMP=/project/tmp/pi-1000`。
- 真实 Native 任务 `b0dcffb6-4d8d-402b-a0a8-7c291f4ff380` 已完成。Root 直接读取新托管目录下该任务的 `status.json`，确认 `runId` 一致、`state=complete`；`process-terminal.json` 为 `state=observed`。
- Root 核对该任务的 `events.jsonl`、`output-0.log` 和 `recovery-descriptor.json` 均实际存在且非空；事件和输出文件均含本次任务文本及唯一临时探针名，与自动完成通知中的路径一致。
- worker 用 Node 默认 `os.tmpdir()` 在 `/project/tmp/pi-1000/native-restart-probe-6r2Xa0` 实际创建目录，检查 UID 1000、权限 700，随后删除自己的探针，原始输出记录 `removed=true`。
- Root 复核 `~/.pi/agent/runtime`、托管根目录和普通临时根目录均为 UID 1000、权限 700、非符号链接。`async-subagent-runs` 及本次任务子目录为 775；现有启动配置只要求上述三个根目录为 700，并未约定递归 700。700 的父目录阻止其他普通用户通过该路径访问内部目录，因此子目录的 775 不阻塞本次验收，未修改权限。
- worker 的 `git diff --check` 退出码为 0。Root 已检查当前 tracked diff：仍为上一轮 README、README.zh-CN 和 package.json 的隔离 release 改动；本次 worker 仅新增验收证据。未重复运行已通过的 10 项启动器回归或完整 release 套件。

重启后原始证据：[restart-check/child-evidence.md](restart-check/child-evidence.md)。

## 限制和交接

- 重启后的新 Native 任务路径已确认；后续更改启动环境仍须退出并重新启动 Pi，仅 `/new` 无效。
- 未迁移或删除旧/tmp任务状态；不要把新路径配置等同于历史任务已迁移。
- Pi自更新可能覆盖启动器钩子，升级后按 `/home/tcuni-claw/.config/agents/pi-runtime.md` 复核；备份和回滚步骤已保留。
- 中间曾因编辑工具丢失755权限而出现126，已修复并新增权限回归测试。
- 配置修改阶段的旧主会话缺少subagent_supervisor回复工具，Root通过interrupt确认暂停后再resume传达权限修复决策；未切换执行方式。该工具暴露问题与本轮路径配置独立，本次未重新验证。该工具暴露问题与本轮路径配置独立。

证据：[execution.md](execution.md)、[green.log](green.log)、[probe.log](probe.log)、[sha256.txt](sha256.txt)。
