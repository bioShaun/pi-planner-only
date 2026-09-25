# 07：validator 称不能运行命令；子 agent 在 /tmp 建 worktree（先调查）

Status: done
Type: research

## Problem

- 250 次 validator 委派里有 7 次报告"不能运行命令"。oracle 带有 bash 工具，但它的系统提示是给决策顾问用的。
- validator 在 `/tmp` 下用 `git worktree add` 建临时目录，子任务文本没有规定临时文件放哪里。

## 要回答

- 找出那 7 次的原文，判断原因：是 oracle 的系统提示，还是 Root 在任务里写了"不要执行"之类的话。
- 判断插件是否应该在 validator 的结尾说明里写明"你有 bash，必须实际运行命令"，是否应该规定临时文件放在工作目录内。

## Answer

- **validator 称不能运行命令（修）：** 找到的 11 次（包括 glm 组）全部是 oracle 只跑了 1 轮、调用 0 次工具，就回答"没有执行工具"。例如 artifact `27b37400…_oracle_0_meta.json` 记录的是 toolCount=0、1 turn。frontmatter 里 oracle 带有 bash，同样的配置在其他 97% 的 run 里都正常执行了，所以原因是模型行为，不是缺少工具。oracle 的系统提示写着"You are not the primary executor"和"Use bash only for inspection"，低 thinking 档的模型有时会据此直接拒绝。修法：validator 的结尾说明改为"You have a `bash` tool: run the requested checks yourself (never answer without running them)…"，并加了测试断言（delegate.test.mjs）。故障注入：改回旧文本后断言失败。`npm run test:release` 全绿。效果看 09 里 validator 报告"不能运行"的比例。
- **/tmp（插件侧不做）：** 在 67 次委派里，是 Root 自己在任务文本中写了 `/tmp/...` 路径，子 agent 照着执行。临时目录放哪里是本机的运维规则，不是插件的语义。如果在子任务文本里要求"放在工作目录内"，未跟踪的临时文件会进入 git 摘要和 `git_commit` 的 add -A，副作用更大。应该由运维者的 AGENTS.md 或 bench 的环境来约束。
