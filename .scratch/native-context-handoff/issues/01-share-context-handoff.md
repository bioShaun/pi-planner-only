# 01：Native 共享上下文提醒和 handoff，并保护运行中的子任务

Status: resolved
Type: task
Source: ../spec.md

历史实验日志和会话仅保留在本机源工作区 `/home/tcuni-claw/.herdr/worktrees/pi-planner-only/worktree-lucky-cloud-348c/.scratch/native-context-handoff/`；以下历史工件相对路径指向该目录，不在本分支。

## 请求

把上下文提醒和 Root handoff 从 Lite 专属能力中拆出来，让 Native 也能使用。交接前通过 pi-subagents 的公开 `status` RPC 检查当前会话的子任务；有活动任务或查询不确定时拒绝切换，不中断正在运行的任务。目标是与 Lite 同等可靠，只改本插件。详细方案见 [spec](../spec.md)。

## 预期行为

- Native 达到上下文阈值时有提醒，可以按有效 handoff 偏好准备交接，也可以手动交接。
- 默认 handoff off；confirm 等用户提交；auto 自动提交。配置来源优先级不变。
- Native 下只额外开放 `handoff` 工具，不开放 `delegate`、`git_audit`、`git_commit`，也不启用 strict。
- handoff 工具调用时和创建新会话前各检查一次子任务活动。busy 或 unknown 时不切换，说明原因，保留简报供 `/planner-only handoff` 重试或 `handoff drop` 丢弃。
- 新会话保持源模式（Native 或 Lite）、源模型和已知 thinking 档位；恢复失败时不发送简报。
- Lite 行为完全不变。

## 实施步骤

按 [spec 的实施步骤](../spec.md#实施步骤) 执行：第 0 步实测，然后先写测试、实现、跑 `test:release`、更新文档。

## 验收

- 新行为先有失败测试，再实现，保留红绿原始输出。
- 覆盖：Native/Lite/Off 的工具可见性；Native 阈值提醒；status 为 idle/busy/超时/失败/缺字段；schedule 后到派发前变成 busy；Native 模式、模型和 thinking 的恢复以及恢复失败。
- 现有 Lite handoff 与模型/thinking/简报回归全部通过，不删除、不放宽断言。
- `TMPDIR=/project/tmp npm run test:release` 通过。
- 第 0 步实测结果记录在本票 Comments 中。
- CONTEXT.md、中英文 README、CHANGELOG 已更新，README 写明已知限制。

## Comments

- 2026-10-28 之前的历史：初版要求宿主提供完整活动证明和原子切换屏障，因此本票被本机归档票 `issues/02-host-handoff-contract.md` 阻塞。宿主契约核对见本机归档 `host-contract.md`。
- 2026-10-28：用户同意重定范围。不再依赖 02 和上游 fork，改为基于公开 `status` RPC 尽力检查，与 Lite 同等可靠。spec 已重写，本票改为 ready-for-agent。
- 阶段 A 预检：确认工作区 HEAD 为 `8e7b8fb86ec2a80a14cf694ea3994bcbd46cfb6f`、安装的 Pi 为 1.4.0、pi-subagents 为 0.83.0；托管运行目录和普通临时目录属主与权限符合本机配置。slot 预检记录在 `../experiment-worker-20261028/slot-audit.log` 和 `../experiment-worker-20261028/slot-status.log`。尚未启动真实隔离会话，async、workflow、reload 和完成通知行为均未实测；不应视为通过。
- 隔离 Pi RPC 实验（证据 `../experiment-worker-20261028/`）：单任务 `650334f2-e75f-475c-88c0-af2bdbc593ae` 经 new_session 后写出 marker 并以 complete、exit 0 结束。reload 前后 status 的 fleet.totalActive 均为 1，snapshot state 分别为 queued、running；新会话 get_messages 为空，但采样早于 runner 终态，不能证明终态后无通知。workflow `1013ae28-47c6-44e8-9881-67f9e48c4fa7` 的状态为 stopped、stopCause runtime-replaced，但切换前仅观察到 queued、children 为空，不证明已启动的 workflow child 行为。实验结束事件流出现 `extension_error: turn_end could not resolve the persisted assistant entry ID`；遵照指令停止，不继续实验或行为改动。new_session 和 ctx.reload 为真实 Pi RPC/扩展入口，不是人工 TUI 输入。
- Root 核对并允许按同一入口重试一次：`../experiment-worker-20261028/retry-1/` 保存三个串行独立 Pi 进程的原始命令、事件、status 和会话。单任务 `31da5f5c-59f8-4fa1-aa56-939e45851bc1` 切换前 running 且 bash 已开始，切换后写文件、complete、runner exit 0；完成通知出现在新会话 RPC 事件和 get_messages，且新会话 JSONL 记录该通知，故原 spec 的“新 Root 收不到”不成立。workflow `7ad6240f-f08d-4602-883f-b85e53e23b86` 切换前 running、child `2b5835b9-cd5c-4895-abd8-f2fbc3b4ffdd` running，切换后 stopped、stopCause runtime-replaced，child 继续写出 marker。reload 实验 `6ada8f24-76cc-47af-b550-404af7acdcd2` 前后 status 均为 fleet.totalActive 1、snapshot run state running。单次实测不证明其他时序；parallel、chain 未实测。slot cpu 作业 3839 exit 0；首次实验的 boundary 错误保留原始证据。
- 实施与验证：`../experiment-worker-20261028/` 保留 Native 入口、status guard、模式恢复及异步失效测试的红灯日志（`native-red.log`、`guard-red.log`、`mode-red.log`、`race-red.log`、`schedule-race-red.log`）；完整 release 命令和结果见 `release-final3.log` 与 `release-final3.exit`。默认安装布局缺少 Node 可解析的 Pi peer，原始失败见 `release.log`；使用未修改的 pi-subagents 0.83.0 副本和 Pi 1.4.0 peer 布局执行，来源比较见 `release-source-compare.log`。Root 验收记录见下一条。
- 2026-10-28：Root 已完成 diff、红绿测试及完整 release 证据验收，验收通过。尚未部署；release 的依赖布局限制和检查至切换间竞态仍然存在。
- PR 交付：从 `main` 的 `8168e12` 独立移植到 `feat/native-context-handoff`，仅包含 handoff、上下文提醒和所需 Pi 1.4.0 依赖声明，不包含源分支的其他十个历史提交。移植后的有效红灯见 [red-output.txt](../red-output.txt)（仅去除行尾空格，原始日志本机保留），完整 release 通过且 Native 39/39，见 [release.log](../release.log)。Root 已核对目标分支 diff 和测试证据。
