# 事件分析：pending delegation 导致 verdict 永久阻塞

**日期**: 2026-09-06
**现象**: `planner_verdict` 拒绝记录任何 verdict（包括 `blocked`）：
`Task T-20260906-001 has a child run still pending; wait for its result before recording a verdict.`
任务实际工作早已完成并通过独立验证，但生命周期永远无法闭环。

## 1. 时间线

对 Task `T-20260906-001`（agent-skills 脚手架写入）共发起 5 次 worker 委托 + 2 次 oracle 验证：

| # | 调用形态 | 结果 | 对 delegations map 的影响 |
|---|---------|------|--------------------------|
| 1 | 默认 async | 启动失败（环境不支持后台子进程） | isError 且无可抽取报告 → 记录被删除 |
| 2 | `async:false` | 返回 async 启动回执（"has started"），运行实际完成（run `d62e7238`，exit 0） | **记录残留**（等待永不到来的通知） |
| 3 | `async:false`（幂等验证版） | 内联返回，但 mission 判定"未做编辑"失败 → isError + 无 JSON 报告 → 记录被删除，任务被标记 failed | 已删除 |
| 4 | `async:false` | 再次返回 async 启动回执，运行实际完成（run `3bafa36d`，exit 0） | **记录残留** |
| 5 | `async:false` + `context:"fresh"` + `outputMode:"inline"` | 内联同步返回完整结果，JSON WorkerReport 被抽取记录（evidence 判 stale → changes_requested） | 已删除（该 toolCallId） |

之后补充的 oracle 验证（validator 角色）内联返回并被正常记录（5/5 通过）。
但第 2、4 次委托留下的两条 delegation 记录永远处于 pending，`hasPendingDelegation` 从此拒绝一切 verdict。

## 2. 直接原因：环境层

- 本机 pi 为 standalone 安装，首次启动即报错：后台子进程需要 npm 包形态的 `@earendil-works/pi-coding-agent`（缺少 `pi-server` / `pi-client/unix`）。
- 尽管如此，后续部分 `async:false` 委托仍被宿主以"后台运行"方式启动并返回启动回执（receipt，含 `details.runId` / `asyncDir`）。
- 这些运行实际都成功完成（subagent-artifacts 下 `<runId>_worker_0_meta.json` 有 `exitCode: 0`），宿主将其记为 "remembered foreground"。
- 关键缺口：**完成通知（`subagent-notify` 自定义消息）从未送达本会话**。`bg_wait` 与 fleet 视图均看不到这些运行，通知通道整体失效。

## 3. 根因：插件层（pi-planner-only）

### 3.1 delegation 记录只有两条删除路径

`orchestrate.ts`：

1. `handleSubagentResult`（tool_result 事件，`orchestrate.ts` 约 L761）——只对**同一个 toolCallId** 的真实结果生效；启动回执路径（`isAsyncLaunchReceipt`）不删除记录，只补记 `runId`。
2. `handleAsyncNotify`（message_end 中的 `subagent-notify`，约 L830）——依赖通知送达。

通知一旦丢失，记录成为**僵尸**：无超时、无对账、无任何工具面删除路径。

### 3.2 通知匹配规则使恢复在数学上不可能

`matchAsyncDelegations`（约 L857）按顺序匹配 pending 记录：

1. **byRunId**：只解析通知文本里的 `Child runs: ` 行——而 pi-subagents 仅对 workflow 子运行输出该行；单运行完成通知不携带 runId。
2. **byTask**（taskIdHint 取自预览中 `"taskId": "..."`）：要求恰好 1 个候选；本事件有 2 条僵尸记录 → 歧义 → 不匹配。
3. **byAgent**：同样要求恰好 1 个候选；2 条僵尸都是 worker → 歧义 → 不匹配。

也就是说：**重复再委托不仅制造了第二条僵尸，还让任何后续通知都无法命中任何一条**（byTask/byAgent 全部歧义）。插件自身的防猜测设计（"Ambiguity yields no match"）在多僵尸场景下变成了永久死锁。

### 3.3 阻塞面过宽

`rootVerdictRefusal`（约 L671）中 `hasPendingDelegation` 对**所有** verdict 生效，包括 `blocked`。即便 Root 已明确判定"这是基础设施死锁、任务应作 blocked 收尾"，也无法通过 `planner_verdict` 表达——逃生舱本身被锁死。唯一出口是操作员的 `/planner-only review <taskId> <verdict> [summary]` 斜杠命令（bypass 非 terminal 拒绝）或 `/planner-only task abandon`。

### 3.4 对账所需的材料其实已经存在

- `notify.ts` 已有 `readChildMeta()`：能从 subagent-artifacts 读取 `<runId>_<agent>_meta.json` 并校验 `runId`/`agent`；
- `readLargestRunOutput()` 能取回运行的完整输出文件；
- 僵尸记录持有 `runId`，meta 中有终态 `exitCode`。

即在 verdict 边界或任何 `handleSubagentResult` 时机，插件完全有能力发现"pending 的运行其实已终态"，却没有做。

## 4. 这是 bug 吗？——结论：是（插件健壮性缺陷），环境只是触发器

- **触发条件**是环境缺陷（standalone pi 无法送达后台完成通知），插件无法为此负责。
- 但插件宣称的设计目标是"有界生命周期、永不信任、永远对账"。在此事件中暴露出四个真实缺陷：
  1. **僵尸 delegation 无超时、无对账**——一条丢失的通知即可永久卡死任务生命周期；
  2. **盲目信任启动回执**——宿主实际按 "remembered foreground" 跟踪该运行，插件却按"等待后台通知"登记，两边状态从未校验；
  3. **重复再委托会放大死锁**——同任务多条 pending 使 byTask/byAgent 全部歧义，后续任何通知都无法解卡（自堵恢复路径）；
  4. **`blocked` 也被拒**——hasPendingDelegation 阻塞全部 verdict，违背"blocked 是逃生舱"的直觉。
- 判定依据：把"通知可能丢失"视为现实世界的常态输入，一个编排层插件必须在丢失场景下仍可收敛（超时、对账、或允许 blocked）。当前实现不可收敛，故为缺陷，而非单纯的宿主问题。

## 5. 复现条件

1. 宿主无法创建后台子会话/送达 `subagent-notify`（standalone 安装）；
2. 一次委托返回启动回执（记录进入 pending）；
3. 通知永不送达；
4. （加剧）对同一任务再委托一次，产生第二条 pending 记录。

满足 1–3 即可复现单僵尸阻塞；加 4 则进入"通知也无法解卡"的不可恢复态。

## 6. 修复建议

1. **对账路径**：在 `rootVerdictRefusal`（或每次 `handleSubagentResult`/`message_end`）时，对每条 pending delegation 用 `readChildMeta(runId, agent)` 检查：若 meta 存在且带终态 `exitCode`，则用 `readLargestRunOutput()` 取回输出，走 `handleWorkerResult` 消费并删除记录。
2. **放行 blocked**：`hasPendingDelegation` 至少不应阻塞 `blocked`——让 Root 能把死锁任务正式记为 blocked 收尾。
3. **同任务再委托应取代旧 pending**：新委托启动时清除同 taskId 的旧 pending 记录（或将其标记为 superseded），避免歧义累积。
4. **byTask 歧义可收敛**：当所有歧义候选同属一个 taskId 且 hint 与之相等时，全部消费（或按时间序消费最旧），而不是返回空。
5. **回执与宿主状态校验**：启动回执登记后，可探测 `bg_wait`/status 面是否真的存在该异步运行；不存在则不应进入 pending 等待。

## 7. 相关代码索引

| 位置 | 内容 |
|------|------|
| `orchestrate.ts` ~L671–L693 | `rootVerdictRefusal` / `hasPendingDelegation` |
| `orchestrate.ts` ~L761–L828 | `handleSubagentResult`（回执不删除记录；isError 无报告才删除） |
| `orchestrate.ts` ~L830–L859 | `handleAsyncNotify` / `matchAsyncDelegations`（唯一的通知清理路径） |
| `notify.ts` ~L106 | `parseSubagentNotify`（runId 仅来自 `Child runs:` 行） |
| `notify.ts` ~L213 | `readChildMeta`（已具备的对账能力，未被用于此场景） |
| `index.ts` ~L676 | tool_result 处理 |
| `index.ts` ~L710 / ~L770 | message_end 通知处理 / context 重建时重放通知 |
| `index.ts` ~L806 | `/planner-only review` 操作员覆盖（当前唯一出口） |
