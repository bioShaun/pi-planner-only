# 主流编码 agent 编排工具调研

日期：2026-10-01。目的：为 pi-planner-only 后续优化（并行、隔离、验收、长任务）找参照。只引用一手资料（官方文档、官方仓库）；第三方对比文章只用来确定该看哪些工具，不作依据。版本号、默认值以检索当日文档为准，可能变化。

## 1. 工具分两类

| 类别 | 谁在编排 | 代表 |
|---|---|---|
| **A. 会话内委派**：主 agent 在一次对话里派子 agent，结果回到主 agent 上下文 | 模型（逐轮决定） | Claude Code subagents / agent teams、Codex subagents、pi-subagents（本插件依赖） |
| **A′. 脚本编排**：模型写一段脚本，运行时执行，中间结果在脚本变量里 | 脚本 | Claude Code dynamic workflows、pi-subagents `workflowScript` |
| **B. 会话级并行管理器**：每个任务一个独立会话 + 独立工作区，人在中间审 diff、合并 | 人 | Claude Code agent view、Codex app worktrees、Cursor Agents Window、Conductor、Claude Squad、Vibe Kanban、GitHub Copilot app / Agent HQ |

本插件属于 A 类（Root 委派 child，Root 验收），B 类的经验主要用于“并行写”。

## 2. 各工具要点

### 2.1 Claude Code

来源：[Run agents in parallel](https://code.claude.com/docs/en/agents)、[Subagents](https://code.claude.com/docs/en/sub-agents)、[Agent teams](https://code.claude.com/docs/en/agent-teams)、[Dynamic workflows](https://code.claude.com/docs/en/workflows)、[Worktrees](https://code.claude.com/docs/en/worktrees)、[Agent view](https://code.claude.com/docs/en/agent-view)。

- **五种并行方式**：subagents、agent view、agent teams（实验，默认关）、dynamic workflows、projects（云端）。选择依据写得很直接：谁协调、worker 之间要不要通信、是否改同一批文件。
- **Subagents**
  - 独立上下文，只把摘要返回主对话；“Use one when a side task would flood your main conversation”。
  - 每个 subagent 可配 `tools` / `disallowedTools`、`model`、`effort`、`permissionMode`、`maxTurns`、`isolation: worktree`。内置 Explore/Plan 是**工具层只读**（“Write and Edit are denied”），并跳过 CLAUDE.md 以求快。
  - 并发上限：同时运行 20 个，超过时 spawn 直接失败并提示不要重试（`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`）。
  - `maxTurns` 到限时“returns its output marked as partial, and Claude can resume it”；**resume 保留完整历史**（之前的工具调用、结果、推理），而不是从头开新的。
  - `isolation: worktree`：每个 subagent 一个临时 worktree，无改动时自动删除，有改动的留到定期清理；默认从默认分支（`fresh`）建，可设 `worktree.baseRef: "head"`。隔离是**强制**的：命令工作目录落到主 checkout 会被拒，把 git 重定向到主 checkout 的命令也会被拦。
  - `.worktreeinclude`：按 .gitignore 语法把被忽略的文件（如 `.env`）拷进新 worktree。
- **Agent view（后台会话）**：所有后台会话从当前目录启动，**读同一个 checkout，第一次改文件前才搬进自己的 worktree**（“parallel sessions can read the same checkout but each writes to its own”）。状态分 Needs input / Working / Ready for review / Completed，需要人时发通知。
- **Agent teams**：lead + 若干 teammate，共享任务列表（带依赖、文件锁防重复认领）和邮箱互发消息。**不做 worktree 隔离**，要求按文件划分归属（“Two teammates editing the same file leads to overwrites”）。建议 3–5 人；“Start with research and review”，并行实现最后再上。有 `TaskCompleted`、`TeammateIdle` hook，退出码 2 可打回任务（质量闸门）。官方明确 token 成本线性增长。
- **Dynamic workflows**：模型写 JS 脚本（`agent()`、`parallel()`、`pipeline()`），运行时在后台执行，“Claude’s context holds only the final answer”。默认 16 并发，单次最多 1000 个 agent；`agent()` 可带 JSON `schema` 要求结构化输出；同前缀的 agent 错开最多 5 秒启动以共享 prompt cache；同一会话内可断点续跑（已完成的 agent 直接返回缓存结果）。官方用途：全库审计、500 文件迁移、交叉核对的研究。

### 2.2 OpenAI Codex

来源：[Subagents](https://developers.openai.com/codex/subagents)、[Worktrees](https://developers.openai.com/codex/app/worktrees)。

- 默认开启 subagent；只在用户直接要求或 AGENTS.md/skill 指示时派。内置 `default`、`worker`、`explorer` 三个角色（与本插件命名几乎一致）。
- 官方建议：“use parallel agents for read-heavy tasks such as exploration, tests, triage, and summarization. Be more careful with parallel write-heavy workflows”。
- 自定义 agent 是 TOML：`model`、`model_reasoning_effort`、`sandbox_mode`（示例中 explorer/reviewer 都设 `read-only`）、`developer_instructions`。全局 `agents.max_concurrent_threads_per_session` 限并发。示例给出的分工：轻量快模型做扫描，高推理档位做 reviewer。
- 典型用法是**按审查维度并行 reviewer**（安全 / 测试缺口 / 可维护性），等全部返回后汇总。
- Worktree（app 内）：放在 `$CODEX_HOME/worktrees`，**detached HEAD**，起点可选分支，若起点有未提交改动会一并带过去；用 Handoff 在本地与 worktree 之间搬对话和代码；默认保留最近 15 个。
- 社区 issue 显示 `spawn_agent` 不能指定 cwd，子 agent 进 worktree 只能靠提示词，偶发跑错目录（[#18969](https://github.com/openai/codex/issues/18969)、[#33144](https://github.com/openai/codex/issues/33144)）。说明“靠指令约束目录”不可靠，需要工具层保证。

### 2.3 Cursor

来源：[Worktrees](https://cursor.com/docs/configuration/worktrees)。

- Agents Window 里每个 agent 可放进独立 worktree，完成后在窗口内审 diff、提交或带回主 checkout。
- `.cursor/worktrees.json` 定义 worktree 建好后的 setup 命令（装依赖、迁移数据库等）。
- `/best-of-n`：同一任务给多个模型各开一个 worktree，人挑最好的；**不自动合并**。
- 默认每台机器最多保留 25 个 worktree，超了自动清理旧的。

### 2.4 会话级管理器（人做编排）

- **Conductor**（[Parallel agents](https://www.conductor.build/docs/concepts/parallel-agents)）：单位是 workspace = 分支 + worktree + setup + 终端 + diff + PR。给了一张很实用的决策表：**能各自独立合入的任务用多个 workspace；实现 + 审查 + 修测试这种必须基于同一份最新代码的协作，放同一个 workspace**（接受可能改同一文件的代价）。
- **Claude Squad**（[README](https://github.com/smtg-ai/claude-squad)）：终端 TUI，tmux 管多个 Claude Code/Codex/Gemini/Aider 会话，每个任务独立 git worktree，可后台跑、合入前审改动。
- **Vibe Kanban**（[README](https://github.com/BloopAI/vibe-kanban)）：看板 issue → workspace（分支 + 终端 + dev server）→ 行内评论反馈给 agent → PR。仓库首页已标“**Vibe Kanban is sunsetting**”，不宜依赖。
- **GitHub Copilot app / Agent HQ mission control**：跨仓库派任务、看实时日志、中途暂停/改指令，可选 Claude、Codex 等第三方 agent（来源为 GitHub 官方博客与 docs，细节未逐项核对）。

### 2.5 pi-subagents（本插件依赖，已安装版本）

来源：`~/.pi/agent/npm/node_modules/pi-subagents/docs/tool-reference.md`、`workflows.md`。

- 已有：`workflowScript` + `runs.all` 并行、`worktree: true`、`globalConcurrencyLimit`（默认 20）、`worktreeSetupHook`。
- **`resume`**：可从保存的会话文件复活 paused/completed/failed 的 child，保留其 agent、模型和工具约定（stopped 不可复活）。
- **`gate`**：由宿主执行的一条验证命令（`acceptance: { level: "verified", verify: [...] }` 的简写），不需要额外 LLM。
- Lite 目前只走 `delegate` 的结构化请求，没有用到 `resume`、`gate`、worktree（见 `docs/worker-concurrency-options-2026-09-29.md` 第 2 节）。

## 3. 共识

1. **并行先读后写。** Codex 文档、Claude agent teams 文档都明确：先用于探索、审查、测试分析，并行写最后做。
2. **并行写 = 每个写者一个 worktree**，几乎所有工具一致。配套三件事：setup 钩子（依赖）、被忽略文件的拷贝规则（`.worktreeinclude` / `worktrees.json`）、数量上限与自动清理（Cursor 25、Codex 15）。
3. **惰性隔离**：Claude agent view 让会话先读主 checkout，第一次写之前才进 worktree，省掉纯读任务的建树成本。
4. **只读要在工具层保证**：Claude Explore/Plan 禁 Write/Edit，Codex 示例给 explorer/reviewer 设 `sandbox_mode = "read-only"`。Codex 的 cwd issue 也说明光靠提示词不可靠。
5. **按角色配模型和推理档位**：快模型做扫描，高档位做审查；主 agent 的档位单独设置。
6. **未完成的 child 可续跑而不是重派**：Claude `maxTurns` → partial + resume；pi-subagents `resume`。
7. **把编排挪进脚本可以减轻主 agent 上下文和轮数**：dynamic workflows 的中间结果不进主上下文，并可断点续跑。
8. **成本**：所有官方文档都提示并行/团队会显著增加 token；agent teams 建议 3–5 个。
9. **人的审查仍是瓶颈**：B 类工具的核心卖点都是更快地审 diff、合并、开 PR，而不是让 agent 更快。

## 4. 对本插件的启发（建议，未实施）

结合本仓库测量（T2 bench：Root 自身 33%、explorer 22%、validator 20%、worker 19%；见 `.scratch/worker-time-20260929/`）：

| # | 做法 | 参照 | 预期作用 | 改动量 |
|---|---|---|---|---|
| 1 | explorer/reviewer 之间并行（读写锁，与 worker 仍互斥），scout 去掉 `write`、`apply_patch` | Codex “read-heavy 先并行”；Claude Explore 只读 | explorer 占 22%，可直接缩短 | 小：`delegate.ts` 锁 + 配置 |
| 2 | reviewer 按维度并行（正确性 / 测试缺口 / 规范） | Codex PR review 示例、agent teams 并行审查 | 审查更全面；用时取最慢的一路 | 依赖 #1 |
| 3 | 机械性检查用宿主 `gate` 跑，不派 validator | pi-subagents `gate` | validator 占 20%，其中纯“跑命令报退出码”的部分可去掉 LLM | 需先确认 `delegate` 走的结构化请求能否带 `gate` |
| 4 | 超时的 child 用 `resume` 续跑，而不是新派一次 | Claude `maxTurns` partial + resume；pi-subagents `resume` | 减少超时后的重新探索 | 需确认 `delegate` 通道能否拿到 runId 并复活 |
| 5 | 并行写走 worktree：Native + `workflowScript` + `worktree: true` 先试；需要时再考虑惰性隔离 | 所有工具 | 墙钟时间；成本上升 | 已有方案 D（`worker-concurrency-options` 第 5 节） |
| 6 | Root 与 child 的推理档位分开调（Root high → medium/low 对照） | Codex/Claude 都允许分角色设 effort | Root 33% 的主要来源 | 只改配置 + bench |
| 7 | 大批量同质任务（全库审计、迁移）用脚本编排 | Claude dynamic workflows | 减少 Root 轮数和上下文 | 已有 pi-subagents `workflowScript`，Lite 未开放 |

不建议照搬的：agent teams 式的 teammate 互发消息和共享任务列表（本仓库 `CONTEXT.md` 已决定 child 不能中途与 Root 通信，且无持久任务账本）；会话级看板 UI（超出插件范围）。

## 5. 局限

- 只读了各工具的官方文档，没有实测；默认值随版本变化。
- GitHub Copilot / Agent HQ 只看了官方博客摘要。
- 未覆盖通用 agent 框架（LangGraph、OpenAI Agents SDK、CrewAI 等）：它们面向自建应用，不直接解决编码 agent 的隔离与验收问题。
- 第 4 节 #3、#4 依赖 pi-subagents 结构化委派通道是否支持 `gate`、`resume`，尚未核实。
