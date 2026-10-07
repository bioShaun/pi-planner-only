你之前调研了编排工具，给出了若干改进建议，其中第 1 项是：「explorer 和 reviewer 之间改成可并行，和 worker 仍互斥；scout 去掉 `write`、`apply_patch`」，依据是「explorer 占 bench 总耗时 22%，改动小」。用户回复：「可以」，请做第 1 项。

仓库在 {RUN_DIR}（请在该目录内工作）。请遵守仓库的 AGENTS.md（会自动加载）。运行测试时 TMPDIR 使用 {TMPDIR}，不得写 /tmp。

运行约束（实验环境要求）：
- 用户此次不在线，不能回答问题。需要决定的事请自行决定，并在最终汇报中说明。
- 不得修改 ~/.pi 下任何配置或已安装的包（包括 settings.json 和 pi-subagents）。
- 不得读取 /home/tcuni-claw/pi/pi-planner-only 及 /project/tmp/root-model-compare 下除 {RUN_DIR}、{TMPDIR} 以外的任何路径（{RUN_DIR}/node_modules 是符号链接，可正常使用）。
- 可以在本地 git commit，不要 push。

完成标准：交出可提交的状态，最后给用户一段汇报：改了什么、测试结果、未做或保留的事项及理由。
