# 02：将禁止 /tmp 的规则落实到实验内 Root 与 child

Status: done
Type: bug
Execution: 共同入口修复已通过 29 项离线回归、三臂真实 dry-run、完整发布测试及独立最终审查。本票不授权新增模型尝试。

## Problem

三次 Opus 校准在任务质量和计费上通过，但所有 arm 内部都发生了硬编码 /tmp 写入。
外层只设置 TMPDIR=/project/tmp/...，不能约束模型生成的绝对路径。Native 的第二个 worker 创建了
/tmp/stab15-baseline；lite oracle 创建了 /tmp/stab15_base 和日志；direct Root 写入脚本和比较结果。
目录已由任务删除；七个残留文件已验证归属、归档并清理。原始证据见 ../execution-20260926/tmp-path-scan.json。

## Scope

修复 benchmark 执行入口的共同资源约束，适用于 direct/native/lite 的 Root、child 及 shell 子进程。
不把它实现为 lite 专属产品功能，否则会改变对照；不修改任务质量标准、模型、角色或原始日志。
先确定当前 Linux 环境可用的进程级路径约束，再实现最小入口。已发现 /usr/bin/bwrap 存在，但未验证其运行条件或内部临时文件行为；不能把安装存在当作可用隔离证明。

## Acceptance

- 外层、模型 Root、child 均使用经验证的仓库外项目临时目录；所有臂获得相同约束。
- 用离线故障注入验证硬编码 /tmp 写入会被拒绝，正常 /project/tmp 写入仍可用，child 继承同样限制。验证本身不得在 /tmp 创建文件。
- 启动前确认实际生效边界；不可用时在付费模型调用前 BLOCKED，不静默退化成只设 TMPDIR。
- 向 Root 与 child 明确可用路径和禁止规则；说明提示词属于行为要求，不能代替运行时保护。
- 记录真实调用命令、进程退出、错误和文件系统证据；不要以配置文件或模型承诺代替实际检查。
- 保留当前 14 项离线断言，新增 guard 的独立故障用例；仓库外 TMPDIR 下完整 test:release 通过。
- 不自动重跑已用完的三次；新公共资源约束属于新冻结条件，未来付费样本及预算另定。

## Constraints

遵守 AGENTS.md：不创建任何 /tmp 文件；中间产物放当前项目或 /project/tmp；重任务先记录 slot audit/status，再经 slot；
不终止其他进程，不改共享槽位，不绕过宿主权限。临时目录清理由明确归属和哈希证明保护，不泛化删除共享临时文件。
保持单 cwd 单写入者，并按本机 Native Codex 协议做有边界的实现、验证和独立审查。

## 完成记录（2026-09-26）

采用 Landlock 共同入口，在任意 Pi 调用前安装并验证本地进程树的 /tmp 写入限制。
统一禁用文件系统集合覆盖 /tmp 子挂载、目录选择、root grants、输出位置和 STOP 安全记录；不可证明安全即 BLOCKED。
原 14 项断言保留，当前 29 项通过；三臂真实 dry-run 与 test:release 全绿，独立最终审查 PASS。
旧 72 个原始文件哈希未变，无新增付费试跑；旧 Opus 规程 FAIL 不追认。
[修复报告](../temp-guard-fix-20260926/report.md)与[最终验收](../temp-guard-fix-20260926/acceptance.json)。
验收时票面已保存为 accepted-issue02.md；当前修改仅更新状态和完成记录。
