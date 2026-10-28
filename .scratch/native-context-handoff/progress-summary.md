# Native 上下文提醒与 handoff：当前进度

更新于 2026-10-28。Root 最终验收已通过；交付分支为 `feat/native-context-handoff`，尚未部署。

历史实验工件仅保留在本机源工作区 `/home/tcuni-claw/.herdr/worktrees/pi-planner-only/worktree-lucky-cloud-348c/.scratch/native-context-handoff/`，未复制到本分支。本分支基于 `main` 的 `8168e12` 单独移植，未引入源工作区的其他十个历史提交。测试先行红灯见 [red-output.txt](red-output.txt)（Native handoff 工具缺失，exit 1；仅去除行尾空格，原始 `red.log` 本机保留），Native 39/39 绿灯见 [green.log](green.log)，完整回归见 [release.log](release.log)（exit 0）；这三份测试输出随分支保存。

## 现状

范围已重定，产品代码已实现。方案只改本插件，用 pi-subagents 的公开 `status` RPC 尽力检查子任务；检查与切换之间不具备原子保证。见 [spec](spec.md) 和 [实施票 01](issues/01-share-context-handoff.md)。

| 步骤 | 状态 |
| --- | --- |
| 0. 实测切换会话时 async 任务和 workflow 的行为、`status` RPC 的返回 | 完成，Root 已核对；真实通知送达新会话，修正了原 spec 假设 |
| 1. 先写失败测试 | 完成：`experiment-worker-20261028/` 中 `native-red.log`、`guard-red.log`、`mode-red.log`、`race-red.log` 和 `schedule-race-red.log` |
| 2. 实现 | 完成，Root 已核对 |
| 3. `npm run test:release` | 本交付分支完整通过，contract 未跳过，Native 39/39；见 [release.log](release.log) |
| 4. 更新 CONTEXT.md、README、CHANGELOG | 完成 |

第 0 步详细运行 ID、通知归属和第一次 runtime 错误见 [实施票 01](issues/01-share-context-handoff.md) Comments。原始 RPC 事件和 status 文件在 `experiment-worker-20261028/retry-1/`。新会话的通知并非隔离保证；检查到切换期间仍有竞态。

默认安装路径直接跑 release 因 pi-subagents 的 `@earendil-works/pi-ai` peer 未被 Node 解析而失败，见 `experiment-worker-20261028/release.log`。完整回归使用 `NODE_COMPILE_CACHE=/project/tmp/native-handoff-compile TMPDIR=/project/tmp PI_SUBAGENTS_DIR=/project/tmp/native-handoff-release-20261028/node_modules/pi-subagents npm run test:release`；副本一致性和版本见 `experiment-worker-20261028/release-source-compare.log`，无上游源码修改。

## 为什么重定范围

原方案要求证明当前会话的全部子活动都已终止，并在子任务准入与会话切换之间提供原子屏障。宿主没有这种能力，于是转去修改 Pi 和 pi-subagents 的隔离 fork。做了大量工作后，成功路径仍然没有跑通（participant 始终返回 unknown），fork 也无法部署到用户的真实安装。每一轮审查都会找到新的未覆盖来源，目标始终达不到。

Lite 的 handoff 依赖进程内计数，并且在 Root 回合结束之后才派发，所以实现起来很快。Native 的新方案沿用同样的思路：派发时前台任务不可能还在运行，async、workflow 和 detached 前台 child 由 `status` RPC 覆盖。

## 上游存档

隔离 Pi 和 pi-subagents 的改动、`compact-checkpoint.md`、`upstream-contract.md`、`host-contract.md`、`source-baseline.md`、`issues/02-host-handoff-contract.md`（本机归档），以及本目录下的 diff、patch、log 工件都是历史记录。原样保留，不再继续开发。具体位置见 [spec 的上游存档一节](spec.md#上游存档)。
