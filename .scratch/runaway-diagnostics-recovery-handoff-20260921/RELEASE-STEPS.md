# 发布与本机更新步骤（已于 2026-09-21 执行）

> 执行记录见 [deploy-20260921/REPORT.md](deploy-20260921/REPORT.md)：用户自行推送 main（远端 `9b96580`），安装副本经 `slot cpu -- pi update` 更新到 `9b96580`，第 6/7 步真实宿主验收均通过。下文为执行前整理的步骤原文。

2026-09-21（执行前）：用户选择保留本机安装，仅整理本步骤和上游提案。本轮不推送、不提交、不运行安装更新、不重启活动会话。

## 已核实的安装状态

- 本仓库 HEAD 为 `9d9a5e3`；本轮开始时已有多项未提交修改，基线保存在 `execution/baseline/`、`execution/baseline.patch` 和 `execution/baseline-status.txt`。
- 安装副本 `~/.pi/agent/git/github.com/bioShaun/pi-planner-only` 的 HEAD 为 `fd40580`，`concurrency.ts`、`index.ts`、`orchestrate.ts` 和 `package-lock.json` 有未提交修改。前两项中仅 concurrency 与本轮初始工作区完全一致；orchestrate 也一致，index 不一致。不能把安装副本直接当作可覆盖缓存。
- 实际宿主为 Pi `0.86.1`，安装的 pi-subagents 为 `0.70.0`，Git HEAD 为 `bbb30096`；历史修复报告里的 pinned commit 不是本轮实际版本。
- 当前 scout 配置为 `tcuni-luna/gpt-5.6-luna:low`，子代理默认模型为 `tcuni-agy/gemini-3.8-flash-high`。工单 00 的 qwen 预期已过时；部署验收应以当时生效配置为准。
- 插件声明的 pi-subagents 兼容范围仍为 `>=0.65 <0.70`；本机集成探针不能替代整个版本范围的兼容验收。

## 后续操作顺序

1. 确认本轮 `REPORT.md` 的发布检查与独立审查通过，并复核本轮增量与原有未提交工作。仅提交选定改动；不要用 `git add -A` 收入凭据、运行证据或无关工作。
2. 对安装副本保存 HEAD、`git status --short`、`git diff --binary` 和未跟踪文件清单；单独备份需要保留的文件。由维护者决定这些修改应合并回源码还是恢复为干净安装，不能自动丢弃。
3. 推送经审查的分支或合并后的修订。核验远端提交 ID，不能仅凭本地 remote-tracking 分支判断已发布。
4. 根据当前 Pi CLI 的本地帮助，更新单个插件可使用 `pi update git:github.com/bioShaun/pi-planner-only`。**Pi 0.86.1 的裸 `pi update` 更新的是 Pi 自身**，不是本工单要更新的插件。长命令先记录 `slot audit`、`slot status`，再经 `slot cpu` 执行；临时目录使用 `/project/tmp`。
5. 核对安装 HEAD 和工作区状态；新建 Pi 会话加载插件。不要在未确认操作者意图时重启现有会话。
6. 按实际 scout/defaultModel 配置分别检查 Explorer 和 report-only 子会话的真实 model/thinking、注册工具集合和结构化终态；不能用请求参数或代理自述代替真实身份。
7. 重跑准备阶段取消与恢复交接场景，检查 `preparation_runaway`、停止确认、无 writer hold 残留，以及恢复子会话首条 user 消息中的 `priorExecution`。

更新失败时保留失败日志和安装副本，按已备份修订制定回退操作；不要对脏安装目录执行强制 reset/clean。
