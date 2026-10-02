# Worker 耗时分析与并发方案（待决策）

日期：2026-09-29。状态：建议稿，已经过一轮审阅修订，尚未实施。

依据：本仓库 `1275050`；已安装的 pi-subagents（`~/.pi/agent/npm/node_modules/pi-subagents`）的文档与源码；第 10 节使用的子 agent 运行记录。

## 1. 问题

Root 已能把任务派出去，但 worker 模型慢。目标是缩短从提需求到验收完成的总耗时，同时保持仓库简单、维护量小。

结论先行：**先减少单个 worker 的轮数（第 10 节），再试并发（第 5–7 节）。** 并发只省墙钟时间，不会让单个 worker 变快，而且需要额外承担拆分、合并和整体验收的成本。

## 2. 现状

- **pi 本身支持并行工具调用。** 同一条 assistant 消息里的多个 tool call 会同时执行（pi `docs/extensions.md`）。
- **Lite 的锁。** worker、validator 按仓库根独占，第二个直接 refused；explorer 之间共享（2026-10-01 起，f2fe050，此前为独占，`delegate.ts` 的 `createCwdLocks`）；reviewer 不加锁；不同仓库之间可以并行。
- **explorer 的工具不由本插件声明。** `delegate.ts` 的 `ROLE_AGENTS.explorer` 只设置 `agent: "scout"`、`lock: "shared"`，以及结尾指令：不要修改项目文件；运行时点名的报告/输出文件可以写。工具名单在已安装的 pi-subagents `agents/scout.md` 的 `tools:` 行，由 `contract.test.mjs` 读取。该测试的注释写明：explorer 靠提示约束、不靠工具表变成只读；scout 保留 `bash` 和 `write`（报告写到每次 run 的 artifact 目录）。断言本身是：非 reviewer 的工具里要有 `bash`、`edit`、`write` 之一，共享锁不能有 `edit`。`apply_patch` 不在 `ROLE_AGENTS` 里，本仓库也没有提交去掉它。2026-09-29 的记录把 operator 的 `~/.pi/agent/settings.json`（`subagents.agentOverrides.scout`）写成带 `bash`、`write`、`apply_patch`；若后来 operator/settings 去掉了 `apply_patch`，那是本仓库之外的配置，不是 `f2fe050`。
- **Lite 隐藏了 pi-subagents 的 `subagent` 工具。** `index.ts:36` 的 `HIDDEN_HOST_TOOLS` 包含 `subagent`，`index.ts:658-661` 在 Lite 下拦截对它的调用。Lite 只保留 `delegate` 一个派发入口，由它统一负责锁、token 上限、时限和 git 摘要验收。
- **`delegate` 的通道不支持 worktree。** `delegate` 走 pi-subagents 的结构化委派请求（`delegate.ts` 的 `buildRequest`，只有 `cwd`）。pi-subagents 这一侧，请求里带 `tasks` 或 `worktree` 字段会被判为无效（`src/slash/delegation-adapters.js:6`）。
- **模式切换只对下一次新会话生效。** `/planner-only native` 或 `lite` 只保存“下一次新会话”的偏好，不切换当前会话（`README.md:115`）。
- **理想并发收益。** root-decomp 试验中子 agent 占总耗时 55–75%（`.scratch/root-decomp-trial-20260928/round1-report.md`）。按 65% 估算：子 agent 工作若有七成能拆成 3 路并行，总耗时约降到 70%；全部能并行，约降到 57%。这只是理想估算，没有计入拆分、合并、合并后整体验收和返工的时间，Root 的审核也是串行的。
- **历史。** 早期版本有 `concurrency.ts`（每个 cwd 一个 writer、全局 N 个并发），并有一份并行策略规格（`docs/archive/default-safe-concurrency-2026-09-11-spec.md`）。Lite 重写（`e8ad415`）时为精简而删除。

## 3. 外部做法（仅作参考）

以下内容凭记忆整理，未核对，不作为决策依据：Claude Code、Cursor、Codex cloud，以及 claude-squad、Conductor、vibe-kanban 等工具，都提供了为写任务分配独立 worktree 或容器的方式。

本项目选择复用 worktree 的理由不依赖行业判断，只有一条：**已安装的上游 pi-subagents 已经实现了 worktree 隔离，本仓库直接复用，维护成本最低。**

## 4. pi-subagents 已有的能力

见 pi-subagents `docs/workflows.md`（Worktree isolation）、`docs/tool-reference.md` 和 `docs/configuration.md`：

- **并行写的推荐方式**：在一次 `subagent` 调用里使用 `workflowScript`，用 `runs.all([...])` 并行启动，每个写任务设 `worktree: true`（或在外层设 `worktree: true` 作为默认）。旧式顶层 `tasks`、`parallel`、`chain` 输入已不支持。
- **并发上限**：工作流内同时运行的子 agent 数由 **`globalConcurrencyLimit`** 控制，默认 20；单次工作流调用可以设置自己的 `globalConcurrencyLimit`。不能靠 `parallel.concurrency` 来限制工作流。
- **worktree 行为**：从干净的 HEAD（或 `baseRef`）建分支，结束后导出补丁和交接清单（handoff manifest），自动清理干净的 worktree。**源仓库必须是干净的。**
- `worktreeBaseDir`：worktree 的存放位置，不能在仓库内部，也不能在 Pi 扩展目录里。
- `worktreeSetupHook`：每个 worktree 建好后运行一次，可用来准备依赖或软链数据目录。

## 5. 候选路线

### A. 本仓库自己实现 worktree 隔离（不推荐）

`delegate` 增加 `isolation: "worktree"`，自己负责建 worktree、提交、合并、清理、依赖准备，另加排队和全局并发上限。等于重写上游已有功能，并且要长期维护，与“保持仓库简单”冲突。

### B. 同一个 checkout 里按路径划分范围并发（不推荐）

- 并发的 worker 跑测试时会看到彼此写了一半的代码。
- lockfile、构建产物是共用的。
- 每次委派的 git 摘要会混进其他任务的改动，破坏“Root 按 git 摘要验收”这条约定（`CONTEXT.md`）；越界修改只能事后发现。

### C. Lite 里放开受限的 `subagent`（暂缓）

只允许每个子任务都设了 `worktree: true` 的调用。改动不大，但 Lite 会有两个派发入口：`delegate` 的锁、token 上限、git 摘要、strict 模式和成本统计都覆盖不到 `subagent` 启动的子 agent。实施前需要写 ADR 并更新 `CONTEXT.md`。

### D. 需要并行写时用 Native 新会话（推荐作为试验路线）

1. 在需要并行写之前，用 `/planner-only native` 或 `PI_PLANNER_ONLY_MODE=native`，**开一个新会话**。
2. Root 先把工作区提交干净，然后发一次 `subagent` 调用：`workflowScript` 里用 `runs.all` 并行启动写任务，每个设 `worktree: true`，并设 `globalConcurrencyLimit: 3`。
3. 各分支完成后，Root 查看补丁，合回主工作树。
4. **合回后在主工作树做一次整体验证。** 各分支的测试通过，不代表合并后的结果正确。

本仓库零代码；worktree、补丁、清理都由上游维护。

## 6. 推荐方案

- 第 10 节的低成本优化（O1–O4）已实施，但 O2 的对照没有看到收益（见 10.5），其余项也没有单独验证；不能再说它们“对每个 worker 都有效”。下一步先用已有记录找出整条委派流程的主要耗时来源（explorer、validator、reviewer 的重复读取、重复检查、交接不清导致的反复委派），再决定优化对象。
- D 作为并发试验路线，在低成本优化之后做一次完整试验，再决定是否常用。
- **explorer 解锁不与上述优化捆绑，单独评估。**（锁已在 f2fe050 落地：explorer 之间共享，与 worker/validator 互斥。本插件没有改 scout 的工具；`apply_patch` 不在本仓库的工具表里，若 operator/settings 去掉了它，也不要记成插件删的。以下为当时的评估记录。）原因见第 2 节：explorer 实际带有写能力（提示约束，不是本插件的工具白名单）。简单地把 `exclusive` 改成 `false`，不仅允许 explorer 之间并行，也会允许 explorer 与 worker 同时运行，读到修改中的代码，并在 git 摘要里混入别人的改动。评估时需先回答：
  - 是只允许 explorer 之间并行，还是也允许与 writer 并行？（建议：仍与 writer 互斥，即读写锁。）
  - explorer 写的报告或草稿文件放在哪里，如何避免互相覆盖、避免混进 git 摘要？
  - 是否需要从 scout 的配置里去掉 `write`、`apply_patch`，从工具层面把它变成只读？

## 7. 实施顺序

1. **O2**（第 10.3 节）：一段 worker 指令。O1 已完成。（已实施，见 10.5）
2. **O3、O4**：写进 Root 的 prompt 和做法；O4 需要先定下后台作业怎么提交、结果怎么取回、最终由谁验收。（已实施最小版本，见 10.5）
3. **固定任务对照实验**：用同一组 bench 任务，分别测 O2 前后、O5（worker 用 luna low）前后的轮数、总耗时和质量。
4. **Native 并发试验**：选一个能拆成 3 个独立部分的真实需求，按第 5 节 D 执行。计时从 Root 开始拆任务，一直到合并后整体验收完成，包括启动、合并和返工。与串行做一次对比。
5. **explorer 解锁**：按第 6 节列出的问题单独评估。（锁已在 f2fe050 落地，见第 6 节；去掉 `write` 或 `apply_patch` 没有落在本仓库。）

## 8. 风险与注意

- **Root 能力。** 写对 `workflowScript`、正确设 worktree、合回补丁，都依赖 Root 自己；较弱的模型可能做不到。第 7 节第 4 步就是验证这一点。
- **worktree 里没有被 gitignore 的文件。** 依赖和数据要靠 `worktreeSetupHook` 准备。**用软链接入依赖或数据目录，会重新引入共享写入**：几个 worker 同时往同一个数据目录写结果，隔离就失效了。只读数据可以软链，要写的输出必须在 worktree 内部。
- **不是 git 仓库的目录**无法用 worktree。
- **网关限流。** 多个 worker 共用网关，可能互相拖慢或触发 429。
- **机器资源。** 多个 worker 各自跑测试或构建，任务里仍要带上 slot 规则（重活走 `slot`，临时文件不放 `/tmp`）。
- **花费不会减少。** 合并冲突和返工可能让 token 花费略有增加。

## 9. 待用户决定

- 是否按第 7 节的顺序推进。
- O1 已完成（worker 当前即 `tcuni/gpt-6-luna` medium），不换模型；是否降到 low 由 O5 对照实验决定。
- Native 并发试验时的 `globalConcurrencyLimit`（建议 3）和 `worktreeBaseDir`（建议 `/project/tmp/pi-subagents-worktrees`）。

## 10. Worker 耗时分析

### 10.1 数据与方法

- **样本**：pi-subagents 保存在 `~/.pi/agent/sessions/*/subagent-artifacts/` 下的子 agent transcript 和 meta，2026-09-24 至 09-29，来自日常真实使用（panel 设计、个性化分析、本仓库 bench 维护等），不是 bench 试验。共 79 个：worker 51 个（48 个 gpt-6-luna medium，3 个 mimo-v2.6-flash），scout 12、reviewer 14、oracle 2。
- **样本固定**：清单在 `.scratch/worker-time-20260929/sample-manifest.tsv`（文件名、sha256 前 16 位、原路径）。原文件可能被 pi-subagents 清理，副本放在 `/project/tmp/worker-time-20260929/samples/`，脚本默认只读这个副本。
- **脚本**：`.scratch/worker-time-20260929/worker_time.py`（模型时间与工具时间拆分、慢命令、单轮延迟）；`worker_phases.py`（只统计 luna worker：首次改文件前的轮数、单轮工具调用数、reasoning 占比）。
- **拆分口径**：一轮的**模型时间** = 从上一次输入（任务 prompt 或上一批工具结果）到 assistant 消息结束；**工具时间** = 从 assistant 消息结束到这一批工具结果全部返回。模型时间里混着网关排队、首 token 等待和生成，现有数据无法再细分。“短输出轮次”统一指输出少于 200 token 的轮次。

### 10.2 观察

1. **时间主要花在模型回复上。** luna worker 单次运行中位数 210 秒、16.5 轮、26 次工具调用。按单次运行看，工具时间占比的中位数是 3%；48 次里有 9 次超过 20%，都是跑数据处理、等 `slot` 排队或 bench 校验这类长命令。汇总口径下，`tcuni/gpt-6-luna` 的模型时间占 78%，`tcuni-luna` 路由占 97%。
2. **短输出轮次的中位延迟约 6 秒。** 输出少于 200 token 的轮次中位 6.2 秒（全部 worker）；luna worker 里，不带 reasoning 的 5.1 秒，带 reasoning 的 6.8 秒。200–1000 token 为 10.9 秒，1000–4000 token 为 31.7 秒。全部 worker 轮次中位 8.4 秒，p90 22 秒。这 6 秒里有多少是排队、首 token 等待或生成，目前分不开，不能都当作可消除的成本。但它说明：**每少一轮，大约能省 5–10 秒**。
3. **本样本未观察到上下文长度与延迟有明显关系。** 2 万以下 8.0 秒，2–5 万 8.7 秒，5–10 万 8.7 秒。缓存、输出长度、模型路由和任务差异都没有控制，所以只能说暂不优先优化上下文。reasoning token 占输出 token 的 11%；这是 token 占比，不等于耗时占比。
4. **73% 的轮次只发了一个工具调用。** 其中有一部分本可以和相邻的调用合在一轮，但不是全部：很多调用依赖上一步的结果，只能串行。
5. **动手修改之前的摸索。** 48 个 luna worker 中有 46 个调用过改文件的工具。这 46 个里，第一次改文件前的轮数中位 3 轮（占本次运行轮数的 19%），但占运行时间的 31%，因为这几轮读得多、输出长。第一次改文件之后，还有中位 5.5 轮在跑 bash（验证、修正）。worker 用 bash heredoc 写文件的情况没被识别为“改文件”，所以这部分数字可能略偏高。
6. **超时。** 51 个 worker 里有 6 个撞到 10 分钟上限：3 个发生在 mimo 模型上（每轮约 60 秒，luna 约 11 秒）；2 个是 worker 自己跑了长命令（一条数据处理命令 480 秒；另一次工具时间累计 533 秒）；1 个轮数很多（46 轮）。
7. **模型和思考档位。** 每轮平均耗时：scout（luna low）8.1 秒，worker（luna medium）11.1 秒，reviewer（luna high）14.5 秒，worker（mimo）60.8 秒。角色和任务都不同，不能把差异直接归因于思考档位，只能作为 O5 对照实验的动机。

### 10.3 优化建议（按投入产出排序）

| # | 做法 | 依据与预期 | 改动 |
|---|---|---|---|
| O1 | worker 不再使用每轮很慢的模型（如 mimo）；换模型前先测短输出轮次的延迟 | 历史 6 次超时中 3 次发生在 mimo 上。**已完成**：3 次 mimo 运行都在 09-24，此后 worker 一直是 `tcuni/gpt-6-luna` medium（当前配置亦然）；48 次 luna 运行中没有因模型慢导致的超时，暂不换模型 | 无需改动 |
| O2 | 在 worker 的结尾指令里加：互不依赖的读取、搜索、查看命令放在同一轮一起发，每轮最多 4 个；小文件一次读全，大文件一次读够相关范围，不要分段反复读；多处修改尽量合成一次 `apply_patch` | 减少可合并的单调用轮次；实际能省几轮需要对照实验 | `delegate.ts` 的 `ROLE_AGENTS.worker.closing` 一段文字 |
| O3 | Root 派任务时写清：要改的文件、函数或符号名、接口约束、验证命令；行号只作辅助 | 缩短动手前的摸索（约占三成时间）。Root 准备这些信息本身也要时间，评估时要一起计入 | 只改 Root 的 prompt 和做法；与 `docs/research-root-task-decomposition-2026-09-28.md` 一致 |
| O4 | 长命令（数据处理、完整测试、需要 `slot` 排队的任务）不放进 worker，worker 只跑快的检查 | 避免“工具时间”类超时。转给 validator 不会让长命令变快，validator 同样受 10 分钟时限约束 | 需要先定方案：后台作业怎么提交（如 `slot -b`），结果怎么取回（`slot tail` 或日志文件），最终由谁验收 |
| O5 | 对照试验：worker 用 luna low 与 medium 对比 | 看每轮延迟是否下降、质量是否不变 | 只改配置，需要 bench 对照 |
| O6 | 并发（第 5–7 节） | 省墙钟时间，不省单个 worker 的耗时；先验证拆分和合并能力，再判断收益 | 见前文 |

### 10.4 局限

- 样本来自日常使用，任务类型混杂，没有对照组；上面的预期都是推测，需要用固定任务的对照实验验证。
- 模型时间无法拆成排队、首 token 等待和生成。要判断短输出轮次的 6 秒来自哪里，需要单独测：同一个模型走不同路由，发极短的请求，比较延迟。
- `worker_phases.py` 只识别 `edit`、`write`、`apply_patch`，没识别 bash 写文件。

### 10.5 实施状态

- **O1**：无需改动（见 10.3）。
- **O2**：已回退（2026-10-01）。理由：下方对照未观察到收益，文案变长；lite 以减法为准。有新证据可再加回。原实施内容：`ROLE_AGENTS.worker.closing` 开头加入：“Work in few turns: send independent reads, searches, and inspection commands together in one turn (at most 4); read a small file whole and a large file's relevant range once, not in repeated slices; combine nearby edits into one edit or patch call.”考虑到并非所有环境都配了 `apply_patch`，措辞用“edit or patch call”。
- **O3**：大部分已在 `3f58416` 中实施：`delegate` 的 `task` 参数说明已要求写明范围（文件、函数）、已定决策（公共接口等）、验收条件和确切的检查命令。没有再加文字。Root 系统提示词的测试上限是 1,500 字符（`index.test.mjs`：`plannerPrompt(strict).length < 1_500`；`635f4a92` 从 1,700 压回，issue #25）。同一函数自那次提交起未改；按源码里的字符串拼接复测（默认时限 10 分钟，与 `plannerPrompt(false|true).length` 相同）：非 strict 1,481，strict 1,496。与 CHANGELOG 0.9.0-lite.0 的记录一致。
- **O4**：已做最小版本。`task` 参数说明加入：“Ask only for checks that finish well within the child's time limit; keep long jobs (full pipelines, large data processing) out of the task and run them outside delegation (yourself, or hand them to the user).”子 agent 一侧原有的时限提示不变。后台作业怎么提交、怎么取回结果不写进插件：这属于机器规则（`slot -b`、`slot tail`，见全局 AGENTS.md）。strict 模式下 Root 不能跑 bash，只能交给用户。
- **O2 效果对照（T2，arm `lite-tds-strict-o2`，pluginRef `12f13e6`）**：计划 3 次，第 3 次因模型服务商返回 “insufficient credits”（400）在约 208 秒后中止，判为无效（`valid=false`），未重跑；有效样本 n=2，全部通过。对照组为 O2 之前的 `treat-3f58416`（n=3，全部有效通过）。

  | 指标 | 对照 n=3（9 次 worker 委派） | O2 n=2（8 次 worker 委派） |
  |---|---|---|
  | worker 每次委派 turns 中位 | 5 | 6 |
  | worker 每次委派 tool calls 中位 | 12 | 12 |
  | calls/turn（worker） | 1.87 | 1.91 |
  | 单次委派时长中位 | 57 秒 | 85 秒 |
  | 每个 run 的 worker 总轮数 | 26 / 19 / 16 | 35 / 23 |
  | wall | 1994 / 1155 / 1381 秒 | 1715 / 1455 秒 |

  结论：**现有样本未观察到 O2 的收益，但也不能说明它已被证明无效或无害。** 有效样本只有 2 次、只来自 T2 一个任务；测试都通过，只说明这些样本没有暴露质量问题。calls/turn 1.87 → 1.91 差异很小，现有样本无法判断方向。

  只看单次委派不够，还要看整个任务的成本：对照组平均每个 run 委派 worker 3 次，O2 是 4 次；每个 run 的 worker 总轮数均值从约 20.3 增至 29。不能把增加归因于 O2（n 太小、任务只有一个、网关负载不同），但说明“每次委派的 turns 和 calls/turn”不足以评价一项改动，还要同时看委派次数、返工和重复检查。“调用之间有依赖所以无法合并”是合理的假设，这组汇总数据没有证明它。

  端到端上限也有限：对照组 worker 合计 820 秒，wall 合计 4530 秒，约占 18%。即使这些时间全在串行关键路径上，worker 快一倍也只省约 9% 总时间。所以 O5（worker thinking low）降为次优先；措辞作为工程选择保留（已过测试），不计入预期收益，也不再围绕它投入 bench。
- **O5**：未做，降为次优先（见上）。bench 的 child 模型读全局 `~/.pi/agent/settings.json`，改它会影响所有会话，需用户决定。
