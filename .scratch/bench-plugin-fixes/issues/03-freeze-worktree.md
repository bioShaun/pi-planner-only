# 03：campaign 把 WORKTREE 冻结成提交号

Status: ready-for-agent
Type: task

## Problem

arm 写 `pluginRef: WORKTREE` 时，每条 run 在启动时各自取 HEAD。control-gemini-strict 的 base arm 因此跨了 5 个插件版本。

## Changes

- `bench/campaign.sh` 创建 campaign 时：插件源文件（`index.ts`、`delegate.ts`、`git.ts`、`format.ts`、`config.ts`、`host.ts`、`subagent-artifacts.ts`、`subagent-delegation-contract.ts`）有未提交改动就拒绝启动；否则把 HEAD 写进 `campaign.json` 的 `worktreeSha`，之后每条 run 都用 `BENCH_PLUGIN_REF=<sha>` 执行 WORKTREE arm。`--resume` 沿用已记录的 sha。
- run.sh 里判断 dirty 用的文件列表也改成上面这份完整列表。
- `summarize.py`：如果同一个 arm 的 run 在 meta.json 里的 `pluginSha` 不止一个，打印 `MIXED pluginSha` 警告。

## Acceptance

- `--dry-run` 显示的命令里带着冻结后的 sha。
- 工作树有脏改动时启动 campaign 会被拒绝，拒绝原因写进日志。
- 对 `/project/tmp/ppo-bench/results/control-gemini-strict/runs` 跑 summarize，会打印 MIXED 警告。
