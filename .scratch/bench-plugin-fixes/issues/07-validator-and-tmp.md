# 07：validator 称不能运行命令；子 agent 在 /tmp 建 worktree（先调查）

Status: needs-triage
Type: research

## Problem

- 250 次 validator 委派里有 7 次报告"不能运行命令"。oracle 带有 bash 工具，但它的系统提示是给决策顾问用的。
- validator 在 `/tmp` 下用 `git worktree add` 建临时目录，子任务文本没有规定临时文件放哪里。

## 要回答

- 找出那 7 次的原文，判断原因：是 oracle 的系统提示，还是 Root 在任务里写了"不要执行"之类的话。
- 判断插件是否应该在 validator 的结尾说明里写明"你有 bash，必须实际运行命令"，是否应该规定临时文件放在工作目录内。
