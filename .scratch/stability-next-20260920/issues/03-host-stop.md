# 03 宿主停止能力

Status: ready-for-agent
Blocked by: remaining scheduled-continuation coverage

真实 TUI（有 TTY）及 queued/scheduled continuation 分场景验证关闭后的模型/tool/REQUEST 数量、CANCEL、terminal 和 settled。修复可由本插件控制的入口；宿主缺口保持明确的 admission-only 结论，不能以 replica 代替真实 TUI，也不绕过 sandbox 的测试禁令。

Completion: partial — queued agent_start 修复、真实 SDK/假模型及单个真实 TUI 到期停止场景通过；完整定时输入组合仍未验收。

request-control.ts 在封锁后的新 agent_start 再次 abort 新的宿主 signal。logs/review-r3-support-checks.json 中 r3-sdk exit 0，request-host-run-vrbghN/results.json 记录 extraModelCallsAfterClose=0、queuedProviderEntered=false；下一独立可信用户输入仍可启动一个 child。历史 P0 额外一次的证据保留。

真实 TUI 已在用户调整权限后的普通宿主环境实跑：study-run-g9NOIF/optimized-stop-pty.json 为 PASS，关闭后 model/tool/REQUEST 均为 0，静默 3 秒后正常退出，无强制清理。命令与独立验证在 continuation-20260920-0502/。普通终端步骤见 terminal-validation.md；受限 sandbox executor 仍不能代跑。已测 SDK/TUI 场景不外推为所有宿主模式的完整停止。
