# P0 后稳定性与委派演进

用户于 2026-09-20 授权按顺序处理剩余工作。实施基线 `85bdd2a93b994d3e4894e7534ab91cf6b16c9043`，初始工作区干净；Root 为唯一写入者。原计划见 ../../docs/pi-planner-only-stability-and-delegation-plan.md。

| 顺序 | 工单 | 当前状态 |
|---|---|---|
| 01 | [同步当前文档状态](issues/01-status.md) | 已实施 |
| 02 | [P1 普通委派和有界收尾](issues/02-delegation.md) | P1-A 已实现；P1-B 能力与实现缺口明确 |
| 03 | [宿主停止能力](issues/03-host-stop.md) | SDK 队列与真实 TUI 到期停止场景通过；完整定时输入矩阵待办 |
| 04 | [上游兼容与路由](issues/04-transport-routing.md) | 路由 fixture 与 Kimi Root / Luna child 真实 smoke 通过 |
| 05 | [固定版本对照与读取政策](issues/05-measurement.md) | 单个真实 smoke 已通过；完整对照、校准与政策待定 |
| 06 | [strict launcher 转述超时](issues/06-strict-launcher-relay-timeout.md) | 已关闭：归因为父 max effort + child 固有时长；全局入口改为父 low effort、420 秒；第 5 轮 exit 0、child PASS |

各轮独立记录源码、命令、原始结果与限制；不把 P0 旧证据外推到新版本。2026-09-20 用户调整权限后，普通宿主执行的 stdout/PTY、/project/tmp 与 slot 预检通过；真实模型与 TUI 已在解除沙箱限制的宿主中实跑。受限 sandbox executor 仍不能代跑这些验收。所有中间文件位于本任务目录或经验证的 /project/tmp；禁止 /tmp，不绕过 slot。

当前新增源码没有提交/发布。第五次 release、真实模型路由和 TUI 场景均通过；独立只读父进程下的严格代码审查及后续独立验收核验均返回 PASS。外层 launcher 前三次在 240 秒退出 124；按用户裁定修订全局入口后，第 5 轮（strict-run-Y59nSS）exit 0、父子各自 EROFS、child PASS，完整自动 strict gate 对 P1-A/stop/P2 为 PASS。当前结论见 [acceptance.md](acceptance.md) 和 [本轮证据汇总](continuation-20260920-0502/closeout.md)。P1-B 与完整 P3 保持未完成，详见能力矩阵和工单 05；本轮没有修改生产代码。
