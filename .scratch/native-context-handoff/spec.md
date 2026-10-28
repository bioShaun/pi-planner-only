# Native 上下文提醒与 Root handoff

状态：范围于 2026-10-28 重定，实施与 Root 验收已完成。实施票为 [01](issues/01-share-context-handoff.md)（resolved）；交付分支为 `feat/native-context-handoff`，尚未部署。

历史 fork、日志和会话工件仅保留在本机源工作区 `/home/tcuni-claw/.herdr/worktrees/pi-planner-only/worktree-lucky-cloud-348c/.scratch/native-context-handoff/`，未复制到本分支。下文历史工件路径均相对于该源目录。

## 范围调整

原方案要求宿主证明当前会话的全部子活动都已终止，并在子任务准入与会话切换之间提供原子屏障。现有 Pi 1.4.0 和 pi-subagents 0.83.0 都没有这种能力。为此在两个隔离 fork 里实现了 runtime 协调、准入登记和来源追踪，但成功路径一直没有跑通，而且这些 fork 不在用户的真实安装里，无法交付。

新目标：Native 的 handoff 与 Lite 同等可靠。只改本插件，只依赖 pi-subagents 现有的公开 RPC。检查是尽力而为，没有把握时拒绝切换并保留简报，不追求原子保证。剩余的竞态窗口写进文档，作为已知限制。

上游 fork 停止开发，原样存档，见 [上游存档](#上游存档)。

## 切换会话时子任务会怎样

依据 pi-subagents 0.83.0 的文档、源码及第 0 步隔离 RPC 实测（证据见 issue 01）：

| 子任务类型 | 运行位置 | 父会话切换时 | 对 handoff 的影响 |
| --- | --- | --- | --- |
| 前台 child（`async: false`） | 父进程内 | `session_shutdown` 会 dispose 进程内 child session，任务被中断 | 派发发生在 Root 回合结束（`agent_settled`）之后，这时前台调用已返回，不会冲突 |
| 已 detach 去问 supervisor 的前台 child | 父进程内 | 运行时替换时被停止 | 要靠活动检查拒绝 |
| async 单任务、parallel、chain | 独立的 detached runner 进程（`proc.unref()`） | 单任务实测切换后继续运行并写盘，完成通知出现在新会话；parallel、chain 未单独实测 | 要靠活动检查拒绝，避免任务结果或通知跨会话错投 |
| async workflow | 编排脚本在父进程内，child 在 runner 里 | 编排停止，`workflow.stopCause: "runtime-replaced"`；已 await 的 async child 继续跑；可以在新会话用 `reuseFrom` 接续 | 要靠活动检查拒绝 |

结论：在 settled 之后派发，前台风险天然排除。需要检查的是 async、workflow 和 detached 前台 child。pi-subagents 的公开 `status` RPC 已经覆盖这些。

## 活动检查

通过 `pi.events` 发送 `subagents:rpc:v1:request`，参数为 `{ version: 1, requestId, method: "status" }`，不带 target。监听 `subagents:rpc:v1:reply:<requestId>`。实现位于 `handoff.ts`，使用宿主事件总线；源工作区的 Native cost 用量统计由本分支后续提交单独引入，不属于本 PR。

判定结果分三种：

- **busy**：`data.fleet.totalActive > 0`，或 `data.asyncSnapshot.runs` 中有未结束的 run。`fleet` 统计当前会话的前台活动 child 和 async owner 的 run，见 pi-subagents `src/extension/rpc.ts` 的 `buildFleetStatus`。哪些 state 算未结束，实施时以 `asyncSnapshot` 的源码为准。
- **unknown**：超时（建议 3 秒）、`success !== true`、`version !== 1`、缺少 `fleet` 字段、没有安装 pi-subagents。
- **idle**：其余情况。

busy 和 unknown 都拒绝切换，提示原因，保留简报，用户可以用 `/planner-only handoff` 重试，或用 `handoff drop` 丢弃。不取消任何子任务，不自动轮询。

Lite 的检查（`locks`、`delegationsInFlight`）保持不变。

## 检查时机

1. `handoff` 工具被调用时（`schedule`）检查一次，busy 或 unknown 直接拒绝，告诉模型原因。
2. 派发时，在 Git facts 收集完成后、调用 `ctx.newSession` 之前，再检查一次。不通过就走现有的 `#defer` 路径。

不在 `session_before_switch` 中拦截用户自己发起的 `/new` 等操作，Native 原有的会话行为不变。

已知限制（写进 README）：

- 第二次检查与 `newSession` 之间有极小的窗口。这时 Root 是 idle 的，不会主动发起子任务，只有 schedule 定时任务恰好在这个窗口内触发时才会漏掉。
- `/reload` 之后，如果 pi-subagents 的内存状态还没恢复，`fleet` 可能偏少。一次运行中任务的实测在 reload 前后均计入，但不能证明所有恢复时序均如此。

## 共享能力与偏好

| 模式 | 上下文提醒 | handoff | 委派工具 |
| --- | --- | --- | --- |
| Off | 不启用 | 不启用 | 保持既有 Off 契约 |
| Native | 复用现有阈值和提醒去重 | 手动入口，以及偏好允许时的阈值触发 | 保持原生工具，额外只开放 `handoff` |
| Lite | 保持现状 | 保持现状 | 保持现状 |

- handoff 偏好的优先级不变：非空环境变量，然后是持久偏好，最后默认 off。off 时模型不能自行发起，但用户可以手动请求；confirm 把简报放进新会话的编辑框；auto 自动提交。
- Native 不启用 Lite 的 `delegate`、`git_audit`、`git_commit` 和 strict 约束。
- 新会话要保持源会话的模式（Native 或 Lite）、模型和已知的 thinking 档位，不能因为重新读取全局模式偏好而切到另一模式。模式没有恢复成功时不发送简报，走 `#defer`。
- `handoffPrompt` 现在写着“Continue as Root under planner-only”，这是按 Lite 写的。Native 需要一句中性的说法。

## 代码入口

- `index.ts`
  - `syncTools` 和 `before_agent_start` 两处工具筛选：Native 下保留 `handoff`，仍然去掉 `delegate`、`git_audit`、`git_commit`。两处必须同步修改。
  - `onMessageEnd`：上下文提醒从只限 Lite 改为 Lite 和 Native。确认 `sendContextWarning` 的文案在 Native 下也成立。
  - `bindMode`：handoff 新会话（`reason === "new"`）要用源模式，而不是 `initialMode()`。可以沿用 `handoff.ts` 中 `activeHandoff` 的模块级做法，传递一个一次性的“下一个新会话模式”，在 `bindMode` 中消费。
- `handoff.ts`
  - `schedule`、`command`、`settled` 中的 `mode() !== "lite"` 改为允许 Lite 和 Native。
  - `HandoffRuntime.activity` 增加 Native 的异步活动查询。`#refusal` 目前是同步的，Native 检查可以放在它之外单独 await。
  - `PendingHandoff` 记录源模式。`#dispatch` 在 `newSession` 前再检查一次活动。
- `host.ts`：如有需要，在 `HostAdapter` 中增加 status 查询，方便测试替换。
- 文档：`CONTEXT.md` 中 Native 与 Root handoff 的条目，中英文 README 中“Native 没有 handoff”的描述，`CHANGELOG.md`。

## 实施步骤

0. **实测（本次已由子代理执行）。** 在真实 Pi 中进入 Native 模式，用最便宜的模型：
   - 启动一个 async 单任务（例如让它 `sleep 60` 后写一个文件），然后 `/new`。确认 runner 继续运行、文件照常生成，观察完成通知归属（本次实测新会话收到）。
   - 启动一个 async workflow，然后 `/new`。确认 `status.json` 中有 `stopCause: "runtime-replaced"`。
   - async 任务运行时，从另一个扩展或临时脚本发 `status` RPC，记录 `fleet.totalActive` 和 `asyncSnapshot.runs[].state`；`/reload` 后再发一次，确认 run 仍然被计入。
   - 把结果记在 [01](issues/01-share-context-handoff.md) 的 Comments 中。结果与上表不符时，先更新本 spec，再实施。
1. **先写测试。** 在 `handoff.test.mjs` 和 `index.test.mjs` 中补充用例，运行并保留失败输出（语法或导入错误不算红灯）：
   - Native 下 `handoff` 工具可见，`delegate`、`git_audit`、`git_commit` 不可见；Off 下都不可见；Lite 不变。
   - Native 达到阈值时发出一次上下文提醒。
   - status 回复为 idle 时创建新会话；busy、超时、`success: false`、缺少 `fleet` 时不调用 `newSession`，简报保留，可以重试和 drop。
   - schedule 时 idle、派发前变成 busy：不调用 `newSession`。
   - 新会话保持 Native 模式、模型和 thinking；模式恢复失败时不发送简报。
   - 现有 Lite handoff 测试全部保持通过，不删除、不放宽断言。
2. **实现**，让上述测试通过。
3. **回归**：`TMPDIR=/project/tmp npm run test:release`。
4. **更新文档**：CONTEXT.md、两份 README、CHANGELOG。

验收：以上测试红绿输出齐全，`test:release` 通过，第 0 步实测结果已记录。不需要真实 Pi 加 pi-subagents 的集成测试套件，也不需要多轮独立审查。

## 不做的事

- 不修改 Pi 或 pi-subagents，不依赖任何 fork。
- 不为 handoff 取消子任务，不自动轮询，不实现完成后自动重试。
- 不自建子任务账本，不实现原子准入屏障。
- 不改变 Native 下用户自己执行 `/new`、`/resume`、`/tree` 的行为。

## 上游存档

以下工作停止，原样保留，以后如有需要可整理成上游 issue 或提案。不要删除，也不要再继续：

- 隔离 Pi：`/home/tcuni-claw/pi/native-context-handoff-sources/pi`（基线 1.4.0，`4a08025`），未提交改动约 +3860/-278，外加新文件。
- 隔离 pi-subagents：`/home/tcuni-claw/pi/native-context-handoff-sources/pi-subagents`（基线 0.83.0，`3a63e0a`），17 个文件有修改，另有 10 个新文件。
- 过程记录：`compact-checkpoint.md`、`upstream-contract.md`、`host-contract.md`、`source-baseline.md`、`issues/02-host-handoff-contract.md`（本机归档），以及本目录下的 `*.diff`、`*.patch`、`*.log` 工件。
