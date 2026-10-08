用户提出了一个问题，请你处理：

「我用 /planner-only 把 handoff 设成 auto 后，重启会话又回到了 off。」
原因：handoff 模式目前只读环境变量 PI_PLANNER_ONLY_HANDOFF，没有持久化。另外，/planner-only handoff auto 现在会被当成「以 auto 为目标发起一次交接」，用户可能误以为已经设置成功。

请实现 handoff 模式的持久化，要求如下：
1. 新增子命令 /planner-only handoff-mode off|confirm|auto：保存设置，之后新开的会话也沿用它。
   设置保存在用户 agent 目录下，也就是 planner-only.mode 所在的目录，需遵循 PI_CODING_AGENT_DIR。文件名和格式自定。
2. 不带参数的 /planner-only handoff-mode：显示当前生效的模式和来源。来源用这三个词之一：env、persisted、default。
3. 优先级：PI_PLANNER_ONLY_HANDOFF 非空时以它为准，包括它的值是 off 的情况；无法识别的值按 off 处理，与现在一致。其次是保存的设置，最后是默认值 off。
4. 保存的设置在所有行为上，都要与「设置同值的 PI_PLANNER_ONLY_HANDOFF」等效。
5. 参数无效时显示用法，不改变任何设置。保存的文件缺失、不可读或内容无效时，视为没有设置，不能报错或中断会话。
6. /planner-only status 显示生效的 handoff 模式和来源。
7. /planner-only handoff [目标] 的现有行为不变；handoff-mode 子命令在任何情况下都不发起交接。
8. README.md 和 README.zh-CN.md 都要写明新子命令和优先级。
9. 为新行为补充测试。默认值仍是 off，不删除环境变量。

仓库在 {RUN_DIR}（请在该目录内工作）。请遵守仓库的 AGENTS.md（会自动加载）。运行测试时 TMPDIR 使用 {TMPDIR}，不得写 /tmp。

运行约束（实验环境要求）：
- 用户此次不在线，不能回答问题。需要决定的事请自行决定，并在最终汇报中说明。
- 不得修改 ~/.pi 下任何配置或已安装的包（包括 settings.json 和 pi-subagents）；测试也不得写入真实的 ~/.pi。
- 不得读取 /home/tcuni-claw/pi/pi-planner-only 及 /project/tmp/root-model-compare 下除 {RUN_DIR}、{TMPDIR} 以外的任何路径（{RUN_DIR}/node_modules 是符号链接，可正常使用）。
- 可以在本地 git commit，不要 push。

完成标准：交出可提交的状态，最后给用户一段汇报：改了什么、测试结果、未做或保留的事项及理由。
