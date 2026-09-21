# 00: 推送 9d9a5e3、pi update、本机验证 Explorer 模型

**What to build:** 已完成的 completionGuard 注册回退在工作树 commit `9d9a5e3`，宿主加载的是 git 安装副本。推送到 `bioShaun/pi-planner-only`，`pi update`，新开会话跑一次 `planner_delegate role=explorer`，账本 `executions[0].rawTerminal.model` 应为 `qwen-local/qwen3.8-27b:low`，`planner-report-only` 跟 `subagents.defaultModel`。顺带核对 `~/.pi/agent/git/github.com/bioShaun/pi-planner-only` 为什么带未提交改动。

**Blocked by:** None

**Status:** resolved

**Parent:** [spec](../spec.md)

## Comments

- 2026-09-21：完成。`9d9a5e3` 已推到 origin/main；`pi update --extensions` 因 GitHub https 不可达失败，改为在安装副本 `git fetch <工作树> main && git merge --ff-only FETCH_HEAD`，安装副本现为 `9d9a5e3`、工作树干净。副本原有的未提交改动是工作树 WIP 的旧快照（concurrency/index 逐行一致，orchestrate 为更早版本），已备份到本目录 `installed-copy-dirty-backup-*.patch` 后丢弃；谁在往安装目录同步工作树仍待查。本机真实配置验证：`T-20260921-016` role=explorer completed，`planner-scout` 实际模型 `qwen-local/qwen3.8-27b:low`（来自 `agentOverrides.planner-scout`），reports=1；证据 `hostcheck3-stdout.jsonl`。


## Comments

- 2026-09-21：本轮按用户确认的范围处理；00 发布步骤见 `../RELEASE-STEPS.md`，05 提案见 `../UPSTREAM-PROPOSAL.md`，01–04 的实现与验证统一记录于 `../REPORT.md`。未更新本机安装或提交上游 PR。
