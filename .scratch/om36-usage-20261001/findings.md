# om36 插件使用日志复核（2026-09-29 至 2026-10-01）

样本：om36 `~/.pi/agent/sessions` 里 9-29 以后的 22 个会话和子任务产物（原始数据在 `snapshot/`，已加入 gitignore 不提交）。汇总脚本：`summarize.py`。
om36 插件 HEAD 为 `4f816e7`（9-30 15:56 更新）；pi-subagents 版本 0.73.1。

- 共 23 次 `delegate`：17 次 completed（16–260s，无超时）、5 次 failed、1 次 refused。
- 5 次 failed：om36 `settings.json` 里 `subagentOnlyExtensions` 的 apply_patch 路径照抄了本机的 `/home/tcuni-claw/...`，子任务启动即报 `apply_patch unavailable`。9-30 12:03 改成 `/home/glx/...` 后没有再出现。属于 operator 配置问题。
- 1 次 refused：k3 Root 在同一轮里给 `deliver-backend`、`project-deliver-web` 各派一个 explorer，但没传 `cwd`，两个都落在外层 `deliver-workspace` 仓库的锁上。修复：拒绝提示里加上让 Root 传嵌套仓库 `cwd` 的说明。
- `git_commit` 失败 4 次，原因是 git 身份未配置（`Author identity unknown`）；`git add` 暂存的改动在失败后仍处于暂存状态。修复：失败文本里写明“改动仍处于暂存状态”。om36 上需要配置 git 的 user.name 和 user.email。
- 在空会话里执行 `/planner-only handoff auto` 时，`auto` 会被当成目标字面传入；属于小问题，未修改。
