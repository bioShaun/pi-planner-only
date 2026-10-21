# Cursor CLI 会话内多 worker 并行（一次实录）

日期：2026-10-10。目的：把一次 Cursor CLI 主会话的派发记录收成可对照的经验，供 Lite 的并行写决策使用。这是一份记录，不改 `CONTEXT.md` 的锁和验收约定。

## 1. 结论

这次的墙钟来自两件事叠在一起：

1. 主会话在**一条助手消息**里发出多次 `Task`。运行时把这条消息里的工具调用一起执行，主会话等整波回报到齐再发下一波。
2. 同一 git 仓库上**没有写锁**。四个写手共用一个 checkout，分工只写在简报的允许路径里。

Pi 已经会并行执行同一条消息里的多个工具调用。Lite 的 `delegate` 对每个 git 仓库加独占锁（`delegate.ts` 的 `ROLE_AGENTS.worker.lock` 与 `runDelegation`），同一仓库上的第二个 worker 会立刻被拒绝。所以同样的分波写法，在 Lite 里同一仓库仍然只会跑一路。

可以直接写进 Root 做法、不必改锁的，是分波和简报。要得到同样的墙钟，需要改锁和 git 摘要的范围。

## 2. 材料

主会话标题 Agent Worker Check，编号 `8d5e681d-24a3-4fcd-a89d-3bc95db6d16b`。可读记录：

`/home/glx/.cursor/projects/app-project-glx-app-deliver-workspace/agent-transcripts/8d5e681d-24a3-4fcd-a89d-3bc95db6d16b/8d5e681d-24a3-4fcd-a89d-3bc95db6d16b.jsonl`

该文件 82 行、约 0.09 MB。下面的行号是这份 jsonl 的行号（从 0 计）。同目录下其他编号是 worker 的 transcript，每份开头是主会话写给它的简报。主会话没有另一份编排日志。

任务是 RNA 展示接线：主会话先读设计和已有函数，再按文件把改动派给 worker。改文件和跑命令都在 worker 里。

Lite 侧的对照来自本仓库：`CONTEXT.md` 的 Delegation 与独占锁决定，`delegate.ts` 的 `resolveLockKey` / `tryAcquire`，以及 `docs/worker-concurrency-options-2026-09-29.md` 第 5 节方案 B。

## 3. 运行时在做什么

`Task` 经 `CallDynamicTool` 调 `cursor/Task`，参数是 `description`、`subagent_type: "worker"`、`prompt`。实录里没有 `run_in_background`。

分波就是跨回合：

| jsonl 行 | 这一条消息里的 `Task` | 内容 |
|---|---|---|
| 2 | 1 | 空任务，确认 worker 能拉起 |
| 5–25 | 0 | 主会话自己读设计、进度、函数签名和页面接线 |
| 26 | 5 | 菜单、样本色与质控表、图表页、交集方向、自助分析入口 |
| 34 | 2 | 基因查询抽屉、`VariantPage.vue` 的 comparison 类型 |
| 37 | 2 | 中文标签、后端 pytest |
| 49 | 1 | 改过时的交集断言，再跑 vitest 和浏览器验收 |
| 57 | 1 | 按 3 个失败场景修 |
| 63 | 1 | 比较组写入 URL 后不要整页重挂，再跑验收 |

第 27 行的文字是「五路 worker 都回报通过」：主会话等到第 26 行那五个调用都返回，才开始核对并派第 34 行。后面每一波同样等上一波结束。

第 26 行的五个 worker 里，四个的 cwd 都是 `project-deliver-web/worktrees/rnaseq-display-batch-a`。第五个写 `project-deliver-web/worktrees/pr-rnaseq-online`，因为入口归位在那棵树上，不是为了隔离。第 37 行的 pytest 在 `deliver-backend/worktrees/rnaseq-display-remaining`，且简报写明不改文件。

这和 `docs/research-orchestration-tools-2026-10-01.md` 第 2.3 节记的 Agents Window worktree 是两条路径。那一节来自 Cursor 的 worktree 文档：每个 agent 一块工作区，人审 diff。这次 CLI 会话没有为每个写手建树，也没有合并步骤。

## 4. 简报里写死了什么

第 26 行五份简报大约 2.7–5.0 KB。每份都自包含，worker 不需要再读设计文档。固定有这几块：

- 目标，以及已经存在的函数名和签名。
- `ALLOWED FILES`：只许改这些路径。
- 验收命令：各自一份互不重叠的 `pnpm exec vitest run <spec...>`，回报里要有改了哪些文件、退出码、失败输出。
- 不要提交、不要推送、不要碰指定端口和其他工作树。

返工简报更短。第 57 行约 2.0 KB，只写三个浏览器失败的原因、允许改的文件，以及验收输出必须换一个新目录。第 63 行约 1.6 KB，只写 `AppView` 用 `route.fullPath` 当 key、比较组一进 URL 就整页重挂，以及要改的 `routeViewKey`。整份设计没有交回去重做。

文件重叠决定波次，重叠与否由主会话在派发前看过代码后写进简报：

- 第 26 行五路的允许路径互不重叠，所以同一条消息一起派。
- 第 34 行的基因查询要改 `Expression.vue`、`EnrichOra.vue`、`DegOverlap.vue`、`DegCluster.vue`，这些在第 26 行已经分给别的 worker，所以等那一波结束。它和类型修正的允许路径不重叠，于是两条 `Task` 放在同一条消息里。
- 验收（第 49 行）单独成波。12 项里失败 3 项之后才派第 57 行；还剩失败、主会话对上整页重挂之后才派第 63 行。

允许路径只在提示词里。工具层没有按路径拒绝写入。

## 5. 和 Lite 的对应关系

| 这次实录 | Lite 现在 |
|---|---|
| 一条消息里多次 `Task`，运行时一起跑 | Pi 对一条消息里的多个工具调用同样一起跑 |
| 同一仓库多个写手 | worker / validator 按 git  toplevel 独占（`resolveLockKey` 用 `git rev-parse --show-toplevel`）。第二个 `delegate` 返回拒绝，文案是 another worker/validator child is still running |
| 主会话读完简报和检查输出再决定下一波 | 一次 Delegation 一个请求、一个结束。Root 按 git 摘要和检查输出验收，返工是带上一次报告的新 Delegation（`CONTEXT.md`） |
| 简报自包含 | child 中途不能问 Root，任务必须自包含（`CONTEXT.md`） |
| 不同工作树的写手和只读 pytest 与前端写手同时跑 | 锁按仓库。不同 toplevel 已经可以同时持有 |

因此第 26 行里写 `pr-rnaseq-online` 的那一路，以及第 37 行的后端 pytest，在 Lite 里可以和另一仓库上的 worker 同时跑。写 `rnaseq-display-batch-a` 的四路不行：锁在仓库上，不在文件上。第 34 行那两路文件不重叠，但 cwd 相同，第二路同样会被拒绝。

## 6. 可以写进 Root 做法的部分

这些不改锁，也缩短不了同一仓库里的墙钟。它们减少的是返工和简报来回：

1. Root 先读设计和已有函数，确认要调用的符号已经存在。这一步自己做，或交给可并行的 explorer（explorer 共享仓库，且不与 worker 同时持有）。简报里写上函数名、签名、只许改的路径、验收命令。
2. 同一批文件在同一波里只给一个 worker。下一波要改的文件若还在上一波的允许路径里，等上一波结束再派。
3. 返工是一次新的 Delegation，只带上次报告、失败原因和允许改的路径。
4. 整库验收单独成一波。失败后收窄再派，验收输出换新目录，避免和上一轮证据混在一起。

`delegate` 的 task 说明里已经要求写范围、已定决策和检查命令（`docs/worker-concurrency-options-2026-09-29.md` 第 10.5 节 O3）。上面四条是在此之上的分波规则。Root 系统提示词的测试上限是 1,500 字符，不适合把这套规则整段塞进 `plannerPrompt`。

## 7. 要拿到同样墙钟要改什么

这次四个写手共用一个 checkout，就是 `docs/worker-concurrency-options-2026-09-29.md` 第 5 节方案 B。那一节不推荐它，理由在这次记录里都还在：

- 各自的 vitest 跑在同一工作树，看得到对方写到一半的文件；`node_modules`、vitest 缓存、锁文件是共用的。这次 spec 文件互不重叠，所以没有在记录里变成失败。
- 每个 Delegation 的 git 摘要取的是整库相对派发前的差异（`runDelegation` 里的 `captureBase`）。五个人同时改，每份摘要都会带上别人的改动。Root 按摘要验收这条就会失真。越界写入只能在事后对允许路径。
- 这次能收口，是因为主会话后来单独跑了一轮整库 vitest 和浏览器验收，并用失败截图判断失败来自这次接线。那是整波之后的验收，不是每路 Delegation 自己的 git 摘要。

和这次记录对齐、又能留住验收的改法：Root 声明的路径互不重叠时，允许多个 worker 同时持有同一仓库；每路 git 摘要只覆盖它声明的路径；会抢缓存、锁文件或端口的检查仍然只留一路。按 writer 各建 worktree（同文档方案 D）也能并行，但这次没有建树，也没有合并。那条路的耗时要另计。

在改 `CONTEXT.md` 的独占锁和「按 git 摘要验收」之前，方案 B 仍是未采纳的。这份记录只说明：在文件边界清楚、验收放在整波之后时，它曾经跑通一次 UI 接线。

## 8. 局限

- 只有这一次会话。没有和串行 Lite 做同一任务的墙钟对照，不能把「快」写成倍数。
- jsonl 里没有每路 worker 的起止时间戳，并行是从「一条消息里五个 `Task`、下一句才说五路都回报」推出来的。
- 允许路径是否被越界改写，这份主会话 jsonl 没有逐文件核对。
- Cursor 的 `Task` 实现会随版本变。这里描述的是 2026-10-10 这次 CLI 会话的记录，不是 Cursor 的产品文档。
