# 03 宿主停止能力

Status: ready-for-human
Blocked by: none for the three scoped TUI scenarios

真实 TUI（有 TTY）及 queued/scheduled continuation 分场景验证关闭后的模型/tool/REQUEST 数量、CANCEL、terminal 和 settled。修复可由本插件控制的入口；宿主缺口保持明确的 admission-only 结论，不能以 replica 代替真实 TUI，也不绕过 sandbox 的测试禁令。

Completion: completed — Gemini Root / Luna child、low 下，真实 TUI queued、scheduled、combined 三种场景全部通过；不外推为所有宿主模式的完整停止。

request-control.ts 在封锁后的新 agent_start 再次 abort 新的宿主 signal。logs/review-r3-support-checks.json 中 r3-sdk exit 0，request-host-run-vrbghN/results.json 记录 extraModelCallsAfterClose=0、queuedProviderEntered=false；下一独立可信用户输入仍可启动一个 child。历史 P0 额外一次的证据保留。

真实 TUI 已在用户调整权限后的普通宿主环境实跑：study-run-g9NOIF/optimized-stop-pty.json 为 PASS，关闭后 model/tool/REQUEST 均为 0，静默 3 秒后正常退出，无强制清理。命令与独立验证在 continuation-20260920-0502/。普通终端步骤见 terminal-validation.md；受限 sandbox executor 仍不能代跑。已测 SDK/TUI 场景不外推为所有宿主模式的完整停止。

## Comments

2026-09-20 最终矩阵：queued `study-run-vsHbSx`、scheduled `study-run-TupxIs`、combined `study-run-2VtAyF`。三者均为真实 PTY/TUI，保留关闭前排队输入或关闭并 settled 后的 timer→extension input→新 agent cycle；匹配 REQUEST/CANCEL/cancelled terminal，按时间顺序计算关闭后 provider/tool/REQUEST 均为 0，最终 settled，工作区无变化，无 done.txt，自然退出 0、forcedCleanup=false。独立 astra_validator_complex 逐项核验 PASS，见 execution-20260920/host-validation.md。

失败尝试完整保留：MPl9z4 因 editor 恢复排队文本而未自然退出；nXFeoe 因 Kimi 配额 403 在 REQUEST 前失败；n8HtMM 因 DeepSeek 上游错误在 REQUEST 前失败并按用户换模型指令中断。它们不计为 PASS。驱动只在全部停止证明和三秒静默之后清空 editor 并正常退出，不以强制清理代替停止证明。

2026-09-20最终验收：完整release GJqscr、代码修正ed0kfI及收尾dihsWK通过；各自范围与原始证据见 ../execution-20260920/closeout.md。
