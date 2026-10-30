# 委派任务粒度与防提前收尾：其他工具怎么做

日期：2026-10-30。只用一手来源：官方文档、官方仓库源码、官方工程博客。源码已固定到具体 commit，文档页按读取日期记录。本文由两份子调研合并而成：附录 A 覆盖编码 agent 产品，附录 B 覆盖规划工具和模型厂商的提示指南。合并时抽查了 11 句关键引用，都与原页面一致（Fable 5.1、GPT-5 指南、Claude 提示最佳实践、Claude Code agent teams 和 sub-agents、Devin、Codex `multi_agents_spec.rs`）。

前序调研：[Root 任务拆分](research-root-task-decomposition-2026-09-28.md)（Superpowers、GSD、Aider、Roo、CrewAI、LangGraph 的任务写法）、[编排工具](research-orchestration-tools-2026-10-01.md)（并行与 worktree）。本文不重复其中内容。

触发案例：内蒙古大学 SSR 项目中，Root 把三件可以分别测试的工作放进一个 worker 任务：来源复核 CLI、全参考搜索、风险分类。worker（gpt-6.1-terra，medium）4 分钟后自称“资源有限需要停下”，只交了一个辅助函数。实际上调用里没有任何预算限制，上下文也只用了约 64k。

## 结论

1. **没有一家用硬阈值拦截过大的任务。** 只有两处给了数字，而且都是经验值：Claude Code agent teams 建议“每个 teammate 5–6 个任务”，Devin 的标准是“人类三小时内能做完”。其余来源都只用定性词，如 well-scoped、self-contained、bounded、focused。
2. **粒度的共同判据是“可以单独验收的交付物”，不是时长，也不是上下文占比。** 各家说法：
   - Superpowers：“smallest unit that carries its own test cycle and is worth a fresh reviewer's gate”
   - Spec Kit：“independently testable increment”，且要求 LLM 不需要额外上下文就能完成
   - Codex：“concrete, well-defined, and self-contained”，加上 “disjoint write set”
   - Claude Code：“clear deliverable, such as a function, a test file, or a review”
   - Anthropic 长时 agent 博客：一个会话只做一个 feature
   - OpenAI GPT-5 指南：可以分开的任务各占一个回合

   没有找到任何官方的“上下文 X%”规则。
3. **派工前的判断写在委派方的提示词里，最系统的是 Codex。** Codex 的 `spawn_agent` 工具描述要求委派前先决定哪些工作自己做；任务“too difficult to delegate well”或耦合紧密时留在本地做；每个委派任务的写入范围不能重叠。Anthropic 也承认 “Agents struggle to judge appropriate effort”，所以把规模规则直接写进了提示词。Taskmaster 让模型给自己的任务打 1–10 分复杂度，再按阈值决定是否展开，这个信号很弱。
4. **子代理发现任务过大时，几乎没有出口机制。** Factory 只规定子代理“reports back”。Superpowers 的 implementer 有 `BLOCKED` 和 `NEEDS_CONTEXT` 状态，控制方收到后可以把任务拆小或换更强的模型。没有任何产品规定子代理要在开工前评估任务，并提出拆分建议。
5. **防提前收尾有两类做法。**
   - **提示层：明确说“不要因为预算停下”，并把允许停下的条件写窄。** Anthropic 的原话是 “Never artificially stop any task early regardless of the context remaining”。Fable 5.1 规定：某一部分被阻塞时，其余部分要全部做完，并说明漏了什么、为什么；把任务做小要由用户决定，不能由模型自己决定。GPT-5 指南要求列出所有子请求，逐项确认已完成。Codex 写的是 “Never invent an early stopping point”。
   - **运行时：由宿主打回，或由独立角色验收。** 例如 Claude Code 的 `SubagentStop`、`TaskCompleted` hook（退出码 2 打回），以及 Factory Missions 的独立 validation worker。
6. **不要人为制造预算压力。** GPT-5 指南附录的 Terminal-Bench 提示里有 “you have a time limit”，这是一个反例。Anthropic 建议 harness 不要在每次工具调用后插入 token 倒计时。提前收尾也和 effort 档位有关：Anthropic 报告 Haiku 5.5 从 low 调到 medium，提前停止大约减半，但输出 token 增加一倍多。
7. **“没做完”被当作正常状态，可以续跑。** Claude Code 的 `maxTurns` 到限后返回标记为 partial 的结果，父代理可以 resume 并保留完整历史。Factory、OpenHands、Codex 都有同类的 resume。没有一家用时间或 token 预算主动截断子代理。

## 对本插件的启示（推断，未验证）

| 做法 | 参照来源 | 落点 | 说明 |
| --- | --- | --- | --- |
| Root 按“可单独验收的单元数”拆分：一个委派只交付一个可验收成果；有 N 个可以分别测试的部分，就分 N 次委派 | Superpowers、Spec Kit、Codex、Claude teams | 插件 `NATIVE_PROMPT` 的一句话 | 由 Root 判断，不让 worker 自评；系统提示每轮注入，压缩或交接后不会丢 |
| 写入范围不重叠、阻塞下一步的工作不外包、难以讲清的任务不委派 | Codex `spawn_agent` | 同上，或交给上游 pi-subagents | 可以作为 Root 派工前的自检措辞 |
| worker 不得自设停止点；某部分被阻塞时其余部分照做，并逐项报告状态 | Fable 5.1、GPT-5、Codex persistent_mode | pi-subagents `worker.md`，或 Root 写的 brief | 本插件不拥有 worker 提示词，这条只能放在 brief 里或向上游提议 |
| brief 中不出现“尽快”“时间有限”这类词，除非确实有限制，并且写明具体数值和超限后怎么做 | GPT-5 附录反例、Anthropic | Root 写 brief 的习惯 | 不需要改代码 |
| 多部分任务附一份可逐项勾选的验收清单 | GPT-5、Anthropic 长时 agent 博客 | brief 模板 | 没做完的部分会明显露出来 |
| worker 交回部分结果时，先拆小、用同一个模型重派，再考虑换模型 | Superpowers 控制方三选一 | `NATIVE_PROMPT` | 避免像这次一样拆包和换模型同时发生，事后分不清原因 |
| 运行时打回（类似 SubagentStop hook） | Claude Code | 暂不做 | 插件拿不到“是否完成”的语义信号，需要上游接口；以后有证据再评估 |

以上都只是对其他工具做法的迁移推断，没有在本插件上验证效果。若要实施，契约测试只能证明提示文本已注入，效果仍要靠自然会话或对照实验确认。

## 未查到或证据薄弱

- Jules：本环境连不上官方站点，未核实。
- OpenHands：只读了 SDK 的 Task Tool Set 文档，旧的 delegation 源码没读。
- Claude Code：Task/Agent 工具本身的系统提示是闭源的，文档里没有。
- Kiro：官方文档里没有 tasks.md 的粒度规则。
- Cline 的 `new_task` 页面 404，Kilo Code 未查。
- Superpowers 当前版本（`2ce8aa15`）里没有“每步 2–5 分钟”的原文。
- gpt-6.1-terra：没有官方提示指南，OpenAI 部分的结论来自 GPT-4.1 和 GPT-5 时代的指南。
- Devin 和 Copilot 的运行时长上限未核对；Taskmaster 的 expand-all 是否按阈值过滤未核对。

---
## 附录 A：编码 agent 产品


读取日期：2026-10-30。仅用一手来源（官方文档、官方仓库源码）。"官方记载"= 原文可引；"推断"= 本人归纳。原始抓取文件在 `/project/tmp/task-sizing-research/raw/`。
已覆盖内容（Claude Code 并行方式、worktree、`maxTurns` partial/resume 的基本事实、Codex 角色与并发）不重复，只在需要时一笔带过。

机制编号：(1) 派工前判断够小；(2) 提示词里规定粒度；(3) 运行时限制；(4) 子代理发现过大时的出口；(5) 防提前停止/谎报完成。

---

### 1. Claude Code

来源：[sub-agents](https://code.claude.com/docs/en/sub-agents)、[agent-teams](https://code.claude.com/docs/en/agent-teams)、[hooks](https://code.claude.com/docs/en/hooks)（lastModified 2026-10-28 前后）。

- (1) 派工前判断：只有"何时用子代理"的定性准则，没有判断任务够不够小的机制。官方明确记载：
  - "Use **subagents** when: The work is self-contained and can return a summary"
  - 反向："Use the **main conversation** when ... You're making a quick, targeted change"
  - Explore 子代理调用时由 Claude 选 thoroughness："quick for targeted lookups, medium for balanced exploration, or very thorough for comprehensive analysis"（这是对"这次查多深"的显式分档，可视为粒度旋钮，仅限只读探索）。
- (2) 提示词粒度（原文措辞、阈值）：仅 agent teams 文档给了数字，subagent 文档没有。
  - "**Too small**: coordination overhead exceeds the benefit / **Too large**: teammates work too long without check-ins, increasing risk of wasted effort / **Just right**: self-contained units that produce a clear deliverable, such as a function, a test file, or a review"
  - "Having 5-6 tasks per teammate keeps everyone productive and lets the lead reassign work if someone gets stuck." 以及 "If it isn't creating enough tasks, ask it to split the work into smaller pieces."
  - Agent 工具本身的系统提示词（Task/Agent 工具描述）：未找到（闭源，文档不含）。
- (3) 运行时限制：
  - `maxTurns`："Maximum number of agentic turns before the subagent stops. When the subagent reaches the limit, Claude Code returns its output marked as partial, and Claude can resume it to continue."
  - resume 保留完整历史（"Resumed subagents retain their full conversation history"）；Explore/Plan 是一次性的，无法 resume。
  - 嵌套深度默认 3 层（`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`），到限则撤掉 Agent 工具，"does its delegated work itself"。
  - 对"任务太大"本身：没有超时/token 预算字段；只有 `autoCompactWindow`（100k–1M）控制子代理压缩时机。
- (4) 过大时的出口：未找到子代理侧的显式"任务过大"出口。teammate 层面：lead 收到 teammate 的计划批准请求（plan approval）可在动手前把关；teammate 卡住由 lead 重新分配（"lets the lead reassign work if someone gets stuck"）。推断：Claude Code 把"拆分"责任放在 lead/用户一侧，而不是 worker 自报。
- (5) 防提前停止/谎报：这是它最完整的一块，全是 hook（运行时由宿主执行，不靠提示词）：
  - `SubagentStop` hook：表格列 "Prevents the subagent from stopping"；Stop/SubagentStop 返回 `decision: "block"` + `reason`，"The conversation continues so Claude can act on the feedback"。
  - `TaskCompleted`："Exit with code 2 to prevent completion and send feedback."；`TeammateIdle`："Exit with code 2 to send feedback and keep the teammate working."
  - 官方承认问题存在："Teammates may stop after encountering errors instead of recovering"；"The lead can stop early too, deciding the team is finished before all tasks are actually complete. If that happens, tell it to keep going."（处置是人工再提示/替换 teammate，不是自动机制）。

### 2. OpenAI Codex

来源：[Subagents 文档](https://developers.openai.com/codex/subagents)（现跳转 learn.chatgpt.com）；源码 `openai/codex` main 分支 commit `55c099a142eb302188fee00ab9e9062f2db1c359`（2026-10-30 读取）：`codex-rs/core/src/tools/handlers/multi_agents_spec.rs`、`codex-rs/core/assets/agent/builtins/awaiter.toml`。

- (1) 派工前判断：spawn_agent 工具描述内置一整节 "When to delegate vs. do the subtask yourself"，是本次调研里**唯一把"派工前判断"写进工具提示词**的产品：
  - "explicitly decide what immediate task you should do locally right now. Do this planning step before delegating"
  - "Use a subagent when a subtask is easy enough for it to handle and can run in parallel with your local work."
  - "Keep work local when the subtask is too difficult to delegate well and when it is tightly coupled, urgent, or likely to block your immediate next step."
- (2) 提示词粒度：同一描述里的 "Designing delegated subtasks"：
  - "Subtasks must be concrete, well-defined, and self-contained."
  - "Narrow the delegated ask to the concrete output you need next."
  - "For coding tasks, prefer delegating concrete code-change worker subtasks ... when the subagent can make a bounded patch in a clear write scope."
  - "For code-edit subtasks, decompose work so each delegated task has a disjoint write set."
  - 工具首句："Spawn a sub-agent for a well-scoped task."
  - 文档侧："they make larger-shaped tasks more tractable by breaking them into bounded pieces"。示例 worker 角色（`ui_fixer`）写 "Make the smallest defensible change ... validate only the behavior you changed"。无数值阈值。
- (3) 运行时限制：`agents.max_concurrent_threads_per_session`（并发上限）；`wait_agent` 带超时（"Returns empty status when timed out"）；`close_agent` 描述 "Completed agents remain open and count toward the concurrency limit until closed"。未找到子代理 turn/时间/token 上限字段。内置 `awaiter` 角色设了 `background_terminal_max_timeout = 3600000`（仅等命令用）。
- (4) 过大时的出口：未找到"子代理报告任务过大"的机制。有 `send_input`/`followup_task`/`interrupt_agent`：父代理可中断重定向；"You should reuse the agent by send_input if you believe your assigned task is highly dependent on the context of a previous task."；`resume_agent` 复活已关闭的 agent。
- (5) 防提前停止/谎报：对子代理侧未找到；对父代理侧有 "Do not redo delegated subagent tasks yourself"、"When a delegated coding task returns, quickly review the uploaded changes, then integrate or refine them."（验收责任在父代理）。`awaiter` 内置提示词有反谎报措辞，可借鉴：
  - "Do not hallucinate completion."；"Only exit awaiting when: The task completes successfully, OR The task fails, OR You receive an explicit stop instruction."
  - 推断：这是针对"等待型"角色的专用措辞，不是通用 worker 的提前收尾防护。

### 3. Factory Droid

来源：[Custom droids (subagents)](https://docs.factory.com/harness/subagents.md)、[Missions overview](https://docs.factory.com/missions/overview.md)、[Missions planning](https://docs.factory.com/missions/planning.md)（2026-10-30 读取）。

- (1) 派工前判断：Task 工具有可选 `complexity`: `light`/`medium`/`heavy`，用来按配置路由模型（不是判断能不能做，是选多强的模型）。Missions 在"大任务"层有明确门槛："Use a normal session when the work is straightforward ..."；"About 1–500 features: Start a new Mission"；">500 features: Split the work into multiple Missions"。
- (2) 提示词粒度：subagent 文档只说 "hand off a focused task"、Task 的 `prompt` 是 "the full task"。Missions 规划页强调 "A well-scoped plan with clear milestones produces dramatically better results"，并给出估算式 `total runs ≈ #features + 2 * #milestones`（"Feature workers: roughly one run per feature"），即**一个 worker 一次运行 = 一个 feature**。feature 的具体大小阈值：未找到。
- (3) 运行时限制：Task 支持 `run_in_background`、`resume`（"keeps its full prior context"）、`TaskStop`（SIGTERM 再 SIGKILL）。subagent 不能再派 subagent（"the Task tool is not available to it"）。未找到 turn/token 上限。Missions 有 "A feature retry limit warning" 排障项（具体次数未写）。
- (4) 过大时的出口：官方记载 "If something is unclear or blocked, the subagent reports back instead of prompting."（AskUser 对子代理禁用）。"worker is taking too long" 的处置是人让 orchestrator "mark the current item as complete and move on"——人工，不是自动拆分。orchestrator 可 "create additional fix features"。
- (5) 防提前停止/谎报：Missions 用独立验证 worker："Validation workers run at the end of each milestone, verifying its work"（每 milestone 2 次验证运行，"assuming that validation passes on the first go"）。即 worker 自报不被采信，由独立角色验收。普通 Task 子代理侧：未找到。

### 4. Amp（Sourcegraph）

来源：[Modes & Models](https://ampcode.com/docs/models-and-subagents)（2026-10-30 读取）。

- (1) 派工前判断：定性。"Subagents are most useful for multi-step tasks that can be broken into independent parts, operations producing extensive output not needed after completion, parallel work across different code areas ..."；"Amp chooses subagents automatically for suitable tasks, mostly in medium mode"。
- (2) 提示词粒度：Task 子代理定义为 "carries out delegated work end to end and reports back"。无粒度措辞或阈值。他们明确子代理看不到全对话："they start with the instructions and context the main agent gives them rather than the full conversation"，推断：简报必须自足。
- (3) 运行时限制：未找到 turn/时间上限。子代理上下文满时自动压缩："When a Task subagent's context fills up, Amp compacts it ... so it can keep working and keep taking new tasks."
- (4) 过大时的出口：未找到。父代理可追加任务："It can give a Task subagent another task, for example to fix something it reported"，运行中追加则作为额外指令即时送达。
- (5) 防提前停止/谎报：未找到。Oracle 作为独立审查者（"reviews code and advises on hard decisions"）可视为独立验证，但文档未把它与防提前收尾挂钩。
- 备注：Amp manual 主页现为重定向，实际内容在 /docs/*；未找到 oracle 之外的任务粒度专页。

### 5. OpenHands

来源：[Task Tool Set](https://docs.openhands.dev/sdk/guides/task-tool-set.md)（SDK 文档，2026-10-30 读取）。旧的 AgentDelegateAction/microagents 源码未去读（GitHub 源码在本环境无法 git clone，只能走 API；时间所限）。

- (1) 派工前判断：未找到。仅列适用场景："Isolating sub-task complexity from the parent agent's context"、"Breaking a problem into sequential steps handled by different experts"。
- (2) 提示词粒度：未找到。
- (3) 运行时限制：同步阻塞（"the parent blocks until the sub-agent finishes"）；返回 `status` 为 `completed` 或 `error`；任务对话落盘，可 `resume`（"preserving their full conversation context"）。无 turn/时间上限的文档化字段。
- (4) 过大时的出口：未找到；只有 `error` 状态。
- (5) 防提前停止/谎报：未找到。

### 6. GitHub Copilot coding agent / Devin / Jules

#### 6a. GitHub Copilot coding agent
来源：[Best practices for using Copilot to work on tasks](https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results)。
- (1)(2) 官方最明确的"事前筛选"清单："GitHub Copilot provides better results when assigned clear, well-scoped tasks. An ideal task includes: A clear description of the problem ... Complete acceptance criteria ... Directions about which files need to be changed." 不适合交给它的：Complex and broadly scoped tasks、"Large changes to a codebase requiring design consistency"、Ambiguous tasks。无数值阈值。
- (3)(4)(5)：此页未找到（运行时限制/出口/防早停）。

#### 6b. Devin
来源：[When to use Devin](https://docs.devin.ai/essential-guidelines/when-to-use-devin.md)、[Instructing Devin effectively](https://docs.devin.ai/essential-guidelines/instructing-devin-effectively)。
- (1) 派工前判断：清单第 3 问 "Would breaking this down help? For very large projects, split the work into focused sessions that build on each other."；还提供 Ask Devin 在开工前"scope the approach"。
- (2) **唯一给出时间阈值的产品**："As a rule of thumb: if a task would take you three hours or less, Devin can most likely do it. For longer tasks, break them into smaller sessions."（阈值是"人类做需要的时间"，不是模型 token）。另："Split tasks into verifiable sub-tasks, and start one Devin session for each sub-task." 及 "Splitting large requests into smaller, manageable chunks helps Devin stay on track"；"Breaking down complex tasks into smaller checkpoints helps Devin stay focused and reduces errors."
- (3) 运行时限制：本次未查（ACU 计费与会话上限未核对）。
- (4)(5)：未找到。

#### 6c. Google Jules
官方站点 jules.google 从本环境无法访问（连接失败）。全部机制：未找到（未核实）。

### 7. Cline / Kilo Code

来源：[Cline Subagents](https://docs.cline.bot/features/subagents)。
- (1)(2) 官方措辞："Give each subagent one focused question." 适用场景为"broad context from multiple areas of a codebase at once"，即只读调研。
- (3) 未找到上限；子代理 "can start subagents of its own"；token 成本计入会话。
- (4)(5) 未找到。`new_task` 文档页 404，Kilo Code 未查。

---

### 共性与差异

1. **没有一家用硬阈值拦截"任务太大"。** 数值只出现在两处：Claude agent teams 的"每个 teammate 5–6 个任务"，和 Devin 的"人类三小时内"。其余都是定性词（well-scoped、self-contained、bounded、focused）。
2. **"事前把关"落在两个位置**：(a) 委派者的工具提示词，Codex 最系统（先决定本地做什么、阻塞路径不外包、"too difficult to delegate well" 就留本地）；(b) 人或规划阶段，Copilot/Devin/Factory Missions 的"先写清范围、验收标准再开工"。
3. **粒度定义的共同词是"自足 + 可验证的交付物"**：Claude "clear deliverable, such as a function, a test file, or a review"；Codex "concrete, well-defined, and self-contained" 加 "disjoint write set"；Devin "verifiable sub-tasks"；Copilot "acceptance criteria"。推断：任务大小由"能否独立验收"而非字数界定，这与本仓库"三件可独立测试的事不应合并"一致。
4. **运行时限制只有 turn 上限（Claude `maxTurns`）和并发/深度上限，没有"时间或 token 预算 + 自报资源不足"协议。** 到限时的处理最值得参考：返回标记为 partial 的输出，父代理可 resume 且保留完整历史（Claude、Factory、OpenHands、Codex 的 resume_agent 同类）。说明业界把"没做完"当作可续跑的正常状态，而非失败。
5. **子代理发现任务过大的出口：基本未找到。** Factory 只有 "reports back instead of prompting"；Claude 靠 teammate plan approval 和 lead 重新分配；其余没有。没有任何一家文档规定"子代理应在开工前拒绝/建议拆分"。推断：这是真正的空白，我们若要加"开工前评估 + 出口格式"，属于超出现有产品的做法，需自行验证。
6. **防早停/谎报主要靠宿主 hook 与独立验证，不靠提示词。** Claude 的 SubagentStop/TaskCompleted/TeammateIdle（退出码 2 打回）是最直接的机制；Factory Missions 用独立 validation worker；Codex 让父代理"review the uploaded changes"。提示词层的反谎报措辞只在 Codex awaiter 角色出现（"Do not hallucinate completion"）。
7. **官方自己承认早停会发生，处置多为人工**：Claude "Teammates may stop after encountering errors instead of recovering"、"The lead can stop early too"，解法是再发指令或换人。没有一家宣称自动解决。
8. **并发/并行写的规则（disjoint write set、先读后写）被写进了提示词**（Codex），但这与粒度的关系是间接的：切成不重叠写集本身就迫使任务变小。可作为 Root 侧"拆分检查"的现成措辞来源。

### 未查到或证据薄弱的对象

- Jules：站点不可访问，未核实。
- OpenHands：只读了 SDK 的 Task Tool Set 文档；旧 AgentDelegateAction / microagents 源码未读（GitHub 源码 clone 与 raw 域名在本环境不可达，仅 API 可用）。
- Claude Code 的 Agent/Task 工具系统提示词和内置 general-purpose/Plan 的提示词原文：闭源，文档未载，未找到。
- Amp：无专门的任务粒度页；Kilo Code、Cline `new_task`：未查到。
- Devin 的会话时长/ACU 上限、Copilot coding agent 的运行时长限制：本次未核对。
- 所有"一手来源"均为官方文档站与官方仓库；未使用第三方文章作为依据。


---

## 附录 B：规划工具与模型厂商提示指南


读取日期：2026-10-30。只用一手来源（官方文档、官方仓库、官方工程博客）。源码固定到 commit：openai/codex `55c099a1`、eyaltoledano/claude-task-master `c0c98d36`、github/spec-kit `2a23a848`、obra/superpowers（本机副本）`2ce8aa15`。文档页无 commit，按读取日期记。

标注约定：【记载】= 页面原文明确写了；【推断】= 本文作者的解读，不是来源的话。

已有调研（`docs/research-root-task-decomposition-2026-09-28.md`）覆盖的 Superpowers plan/implementer、GSD、Aider、Roo、CrewAI、LangGraph、Anthropic 多代理系统的“目标/输出格式/边界”不再重复，只补新信息。

---

### 一、任务粒度规则

#### 1.1 Superpowers（本机副本，补充）

- 【记载】`writing-plans/SKILL.md` 的 Task Right-Sizing：“A task is the smallest unit that carries its own test cycle and is worth a fresh reviewer's gate.” 并要求“fold setup, configuration, scaffolding, and documentation steps into the task whose deliverable needs them; split only where a reviewer could meaningfully reject one task while approving its neighbor.”
- 【记载】任务内部每步“one action with a checkable result”（写失败测试、跑失败、实现、跑通过、提交）。
- 【记载】计划长度自检：“A plan several times longer than the spec it implements is a transcript of the program, not a plan.”
- 【记载】`implementer-prompt.md`：“If a file you're creating is growing beyond the plan's intent, stop and report it as DONE_WITH_CONCERNS”；状态集合 `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`。升级后“The controller can provide more context, re-dispatch with a more capable model, or break the task into smaller pieces.”
- 【未找到】本机副本（2ce8aa15）中没有“每步 2–5 分钟”的阈值原文；该版本已改用“可独立测试 + 值得单独复核”作为任务边界，不用时间。父任务若引用 2–5 分钟，需另核旧版本。
- 注意：implementer-prompt 写了“It is always OK to stop and say 'this is too hard for me.' Bad work is worse than no work.”——这是一条**允许停下**的规则，但必须以 BLOCKED/NEEDS_CONTEXT 状态加具体卡点回报，不是静默交部分结果。【推断】与下文 Fable 5.1 的“被阻塞部分之外要全部做完”组合使用才不会放大提前收尾。

#### 1.2 OpenAI GPT-5 prompting guide

- 【记载】“we observe peak performance when distinct, separable tasks are broken up across multiple agent turns, with one turn for each task.” 链接：<https://cookbook.openai.com/examples/gpt-5/gpt-5_prompting_guide>（Reasoning effort 一节）。这是厂商对“可分离任务应拆开、每个任务一个回合”的直接建议，没有给大小的数字。
- 【记载】Codex `base_instructions/default.md` 的 Planning 节：计划应“break the task into meaningful, logically ordered steps that are easy to verify as you go”，每步“no more than 5-7 words each”；低质量计划示例是“Create CLI tool / Add Markdown parser / Convert to HTML”这类过粗步骤。链接：<https://github.com/openai/codex/blob/55c099a142eb302188fee00ab9e9062f2db1c359/codex-rs/protocol/src/prompts/base_instructions/default.md>
- 【记载】`gpt_5_codex_prompt.md` 的 Plan tool：“Skip using the planning tool for straightforward tasks (roughly the easiest 25%). Do not make single-step plans.”

#### 1.3 Anthropic 官方文章

- 【记载】Effective harnesses for long-running agents：失败模式之一是“the agent tended to try to do too much at once—essentially to attempt to one-shot the app. Often, this led to the model running out of context in the middle of its implementation”。对策：初始化 agent 写 200+ 条端到端 feature 清单（全部先标 failing），后续每个会话“asked to work on only one feature at a time. This incremental approach turned out to be critical”。链接：<https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>
- 【记载】Prompting best practices：“focusing on incremental progress, making steady advances on a few things at a time rather than attempting everything at once.” 链接：<https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>
- 【记载】How we built our multi-agent research system 的“Scale effort to query complexity”（旧调研未写）：“Agents struggle to judge appropriate effort for different tasks, so we embedded scaling rules in the prompts.” 例：简单查找 1 个 agent、3–10 次工具调用；直接比较 2–4 个子代理、各 10–15 次调用；复杂研究 10 个以上子代理。链接：<https://www.anthropic.com/engineering/multi-agent-research-system>
- 【记载】同文还说：多代理不适合“all agents to share the same context or involve many dependencies”，“most coding tasks involve fewer truly parallelizable tasks than research”。
- 【记载】Building effective agents：orchestrator-workers 适用于“complex tasks where you can't predict the subtasks needed (in coding, for example, the number of files that need to be changed and the nature of the change in each file likely depend on the task)”；prompt chaining 适用于“the task can be easily and cleanly decomposed into fixed subtasks”，目的是“making each LLM call an easier task”。链接：<https://www.anthropic.com/engineering/building-effective-agents>
- 【未找到】以上均无“占上下文百分之几”之类的数值。Anthropic 的粒度单位是“一个端到端可验证的功能/一个会话”。

#### 1.4 Taskmaster AI（claude-task-master）

- 【记载】`analyze-complexity` 系统提示：“analyzing task complexity. Your analysis should consider implementation effort, technical challenges, dependencies, and testing requirements.” 输出每个任务：`complexityScore`（1–10）、`recommendedSubtasks`（“0 if no expansion needed”）、`expansionPrompt`、`reasoning`。<https://github.com/eyaltoledano/claude-task-master/blob/c0c98d367c55296bfe69e65680625b6db437af02/src/prompts/analyze-complexity.json>
- 【记载】`analyze-task-complexity.js`：阈值默认 `parseFloat(options.threshold || '5')`；统计分档为 `>=8` 高、`5–<8` 中、`<5` 低；模型漏评时回填 `complexityScore: 5, recommendedSubtasks: 3`。<https://github.com/eyaltoledano/claude-task-master/blob/c0c98d367c55296bfe69e65680625b6db437af02/scripts/modules/task-manager/analyze-task-complexity.js>
- 【记载】提示里没有给 1–10 分各档的客观评分细则，分数由模型自评；本文件内阈值仅写入报告元数据并用于统计，下一步建议是 `expand --id` / `expand --all`。【未核对】expand-all 是否按阈值过滤。
- 【记载】`expand-task` 提示：“Break down high-level tasks into specific, actionable subtasks that can be implemented sequentially.” 子任务字段含 `dependencies`、`details`、`testStrategy`；子任务数可固定也可“an appropriate number of”。<https://github.com/eyaltoledano/claude-task-master/blob/c0c98d367c55296bfe69e65680625b6db437af02/src/prompts/expand-task.json>
- 【推断】Taskmaster 的“需要再拆”是“LLM 自评分 ≥ 阈值 → 展开”，信号弱；对本仓库的借鉴价值在于“拆分建议要附 expansionPrompt 和理由”，不在阈值本身。

#### 1.5 GitHub Spec Kit

来源：`templates/commands/tasks.md`、`templates/tasks-template.md`（commit 2a23a848）。<https://github.com/github/spec-kit/blob/2a23a848f888de05f0107061d45232c485d6bae0/templates/commands/tasks.md>

- 【记载】“The tasks.md should be immediately executable - each task must be specific enough that an LLM can complete it without additional context.”
- 【记载】每条任务格式：`- [ ] [TaskID] [P?] [Story?] Description with file path`；`[P]` 仅在“different files, no dependencies on incomplete tasks”时标；错误示例包含缺文件路径的任务。
- 【记载】组织单位是用户故事：“Each phase should be a complete, independently testable increment”；每个故事有 Goal 和 Independent Test；模板 Notes：“Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence”。
- 【记载】数据模型里的约束要“quote the constraint verbatim in the task description so it is not left to implementation-time discretion”。
- 【未找到】没有任务个数、时长或上下文占比阈值。

#### 1.6 AWS Kiro

- 【记载】官方文档只说 tasks.md 提供“discrete, trackable tasks”“Trackable tasks with clear outcomes”；Run all Tasks 时按依赖图分“waves”并发。建议多个小 spec：“creating multiple specs for different features ... rather than attempting to just have a single one for your entire codebase”。<https://kiro.dev/docs/specs/>、<https://kiro.dev/docs/specs/best-practices/>
- 【未找到】官方文档页没有 tasks.md 的粒度规则、“引用 requirements”“增量可测试”的措辞。这类措辞只在非官方转载的内部系统提示里见过，属二手，未采用。

#### 1.7 Gemini

- 【记载】Prompt design strategies 的“Break down prompts into components”：“Break down instructions ... Chain prompts ... Aggregate responses”。<https://ai.google.dev/gemini-api/docs/prompting-strategies>
- 【未找到】无任务粒度、拆分判据的数值或规则。

#### 1.8 “子任务应在一个上下文窗口/会话内完成”的官方原则

- 【记载】Anthropic harness 文章：一次一个 feature，是为了避免“running out of context in the middle of its implementation, leaving the next session to start with a feature half-implemented and undocumented”。会话结束要留下“clean state”（可合并到主干的代码）。
- 【记载】Anthropic best practices：“it's encouraged to spend your entire output context working on the task - just make sure you don't run out of context with significant uncommitted work.”
- 【未找到】没有任何官方来源把“单任务不超过上下文 X%”写成规则（GSD 的 10–30% 在旧调研里已标为启发式）。【推断】官方共识是“一个会话内能到达可提交、可验证的检查点”，而不是比例。

---

### 二、防提前收尾与预算焦虑

背景：触发案例里模型的 thinking 先说 “time is not a constraint”，后说 “limited resources”，而调用里没有任何预算。下列来源说明：这种行为是已知失效模式，厂商的对策都是**明确写出“没有预算限制/不要因此停下”，并规定真正允许停下的条件**。

#### 2.1 Anthropic：上下文感知与 token 预算

- 【记载】Sonnet 5 / 4.6 / Haiku 4.5 具有 context awareness，能追踪剩余上下文；“Otherwise, Claude might sometimes naturally attempt to bring its work to a close as it approaches the context limit.” 给出的提示：

> Your context window will be automatically compacted as it approaches its limit, allowing you to continue working indefinitely from where you left off. Therefore, do not stop tasks early due to token budget concerns. As you approach your token budget limit, save your current progress and state to memory before the context window refreshes. Always be as persistent and autonomous as possible and complete tasks fully, even if the end of your budget is approaching. Never artificially stop any task early regardless of the context remaining.

- 【记载】另一句：“It's encouraged to spend your entire output context working on the task - just make sure you don't run out of context with significant uncommitted work. Continue working systematically until you have completed this task.”
- 【记载】Sonnet 5.5 页：harness 在每个 tool result 后加 token 倒计时，会让模型把它当作可疑注入；建议“don't add your own token or budget countdown after tool results”。来源：<https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5>
- 【推断】“预算焦虑”在 Claude 上是有文档的、由上下文感知触发；本案例的 GPT 模型没有同类文档，不能直接套用，但对策（明说“没有预算限制 + 不要因此停”）类型一致。

#### 2.2 Anthropic：Fable 5.1 的 “Finish the whole task”

来源：<https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1>

- 【记载】问题描述：模型有时“describes what it would do next instead of doing it”或“stops to ask permission for a step the original request already covered”。
- 【记载】可直接借用的原文（节选）：

> You are operating autonomously. The user is not watching in real time and cannot answer questions mid-task ... Stop only for destructive actions or genuine scope changes the user must decide.
>
> Before ending your turn, check your last paragraph. If it is a plan, an analysis, a question, a list of next steps, or a promise about work you have not done ('I'll…', 'let me know when…'), do that work now with tool calls. ... Do not stop because the context or session is long. End your turn only when the task is complete or you are blocked on input only the user can provide.

- 【记载】与本案例最贴的一句：

> If one part turns out to be blocked, complete every other part in full and say exactly what you left out and why — the whole task is the deliverable, and scaling it down is the user's call, not yours.

- 【记载】同页说明开头“the user isn't watching”那句“carries much of the effect. Keep it as written”，并提醒该块“can also make the model less likely to ask about ambiguous requests”。

#### 2.3 Anthropic：Sonnet 5.5 / Haiku 5.5 的提前收尾

- 【记载】Sonnet 5.5：在 low/medium effort 的长 agent 任务里，“It might pause to confirm a plan, ask a question it could answer itself, or stop after one part of a multipart task to ask whether to continue.” 先试提高 effort，或加：

> Keep working until everything the user asked for is done, and only stop to ask when you can't go on without the user or before a risky step.
> When the work the user asked for is done and checked, stop and report. Don't add features, tests, files, docs or refactors that weren't asked for.

- 【记载】Haiku 5.5：长 agent 提示下 low effort 会“stops early and hands the task back”；同一段提示；“moving from low to medium effort roughly halved early stopping. It also more than doubled the output tokens”。来源：<https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5>
- 【推断】这两条说明提前收尾与 effort 档位相关，本案例 medium thinking 仍出现，说明单靠 effort 不够，需提示 + 任务设计。

#### 2.4 Anthropic：长时 agent 的“过早宣布完成”

- 【记载】harness 文章：“a later agent instance would look around, see that progress had been made, and declare the job done.” 对策是结构化 feature 清单（JSON，只改 `passes` 字段）：“It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality.”；以及“Only mark features as 'passing' after careful testing”。
- 【推断】对委派场景：用可枚举的验收清单（三个可独立测试部分各自一项）充当“没做完就看得见”的锚点。

#### 2.5 OpenAI GPT-4.1 / GPT-5 prompting guide

- 【记载】GPT-4.1：三条 agent 提醒之一 Persistence：“You are an agent - please keep going until the user's query is completely resolved, before ending your turn and yielding back to the user. Only terminate your turn when you are sure that the problem is solved.” 称三条提醒使内部 SWE-bench Verified 提升约 20%，并让模型从 chatbot 变成更“eager”的 agent。<https://cookbook.openai.com/examples/gpt4-1_prompting_guide>
- 【记载】GPT-4.1 SWE-bench 示例提示：“NEVER end your turn without having solved the problem, and when you say you are going to make a tool call, make sure you ACTUALLY make the tool call, instead of ending your turn.” 以及 “Take your time and think through every step”。
- 【记载】GPT-5 guide 的 `<persistence>`（“Prompting for more eagerness”）：

> - Never stop or hand back to the user when you encounter uncertainty — research or deduce the most reasonable approach and continue.
> - Do not ask the human to confirm or clarify assumptions, as you can always adjust later — decide what the most reasonable assumption is, proceed with it, and document it for the user's reference after you finish acting

  并建议“increasing `reasoning_effort`”配合；还说应“clearly state the stop conditions of the agentic tasks, outline safe versus unsafe actions, and define when, if ever, it's acceptable for the model to hand back”。<https://cookbook.openai.com/examples/gpt-5/gpt-5_prompting_guide>
- 【记载】同 guide（minimal reasoning 节）的子任务完成提醒，最贴合“三部分只做一个”：

> Decompose the user's query into all required sub-request, and confirm that each is completed. Do not stop after completing only part of the request. Only terminate your turn when you are sure that the problem is solved.

  并指出“agentic persistence reminders ... are particularly critical at minimal reasoning ... to prevent premature termination”。
- 【记载】反例：同 guide 附录 Terminal-Bench 提示含 `<efficiency>Efficiency is key. you have a time limit.</efficiency>`，同时又有 `<persistence>`。【推断】提示里写“time limit”是主动给模型提供时间压力的来源；委派提示里要避免出现“尽快/时间有限/别花太久”之类措辞，除非真有限制。
- 【记载】与“少 eager”相对的 `<context_gathering>` 把“Early stop criteria”写成具体条件（“You can name exact content to change”）并给“escape hatch”。【推断】允许停下的条件应写成可观察的具体条件，而不是留给模型自己权衡资源。

#### 2.6 OpenAI Codex CLI 系统提示

- 【记载】`default.md` Task execution：“You are a coding agent. Please keep going until the query is completely resolved, before ending your turn and yielding back to the user. Only terminate your turn when you are sure that the problem is solved. Autonomously resolve the query to the best of your ability, using the tools available to you, before coming back to the user.”
- 【记载】`gpt_5_codex_prompt.md` 中没有 persistence/keep going 措辞（只有 Plan tool、编辑约束、展示规则）。【推断】较新的 codex 模型把持续性训练进模型，提示里不再重复；若 worker 是新模型，仍可能在非 Codex harness 下需要显式提醒。
- 【记载】`templates/persistent_mode.md`（后续跟进工作）：“Bound a follow-up by its purpose, scope, and outcome, not an arbitrary number of checks.” “Never invent an early stopping point for monitoring the user explicitly asked to continue.” “A pending, running, inconclusive, or unchanged result is not by itself completion.”  <https://github.com/openai/codex/blob/55c099a142eb302188fee00ab9e9062f2db1c359/codex-rs/prompts/templates/persistent_mode.md>
  - 这是对“自己编造停止点”的直接禁令，可借用其句式。

#### 2.7 Google Gemini

- 【记载】官方 agentic 系统指令模板第 8 条：“Persistence and patience: Do not give up unless all the reasoning above is exhausted. Don't be dissuaded by time taken or user frustration.” 并限定：瞬时错误要重试，“unless an explicit retry limit (e.g., max x tries) has been reached. If such a limit is hit, you must stop.”；其他错误“you must change your strategy or arguments, not repeat the same failed call.” <https://ai.google.dev/gemini-api/docs/prompting-strategies>
- 【记载】该页把 Persistence and Recovery 列为可调维度：“High persistence increases success rates but risks higher token costs or loops.”
- 【推断】Gemini 的做法与 OpenAI 一致：持续 + 显式停止条件（重试上限），而不是由模型自行估计资源。

---

### 三、共性（可操作）

1. **厂商都把“该不该停”写成显式规则，而不是让模型自评资源。** OpenAI（persistence、stop conditions）、Anthropic（Never artificially stop）、Gemini（显式重试上限）均如此。【推断】委派提示应写“没有时间/token 预算限制”与“允许停下的唯一条件”。
2. **允许停下的条件要窄而可观察：** 被只有用户能解决的输入阻塞、破坏性操作、真实的范围变更（Fable 5.1）；其余情况继续。其中“被阻塞时先做完其余部分，并写明遗漏及原因”是对部分交付的直接约束。
3. **多部分任务要有可枚举的完成清单并在收尾前逐项核对。** 来源：GPT-5 的 “Decompose ... confirm that each is completed”、Anthropic 的 feature 清单、Fable 5.1 的“检查最后一段是不是计划/承诺”。
4. **粒度的官方判据是“可独立测试/可验证的交付”，不是时长或比例。** Superpowers（自带测试周期 + 值得单独复核）、Spec Kit（independently testable increment、LLM 无需额外上下文即可完成）、Anthropic（一次一个 feature）、OpenAI（可分离任务各占一个回合）。未发现官方的上下文百分比规则。
5. **拆的方向是“一次一个可验证单元，会话结束留下干净检查点”。** 这是对“任务太大”的官方应对：不是让 worker 缩小范围交部分，而是由 orchestrator 拆开分多次委派（Superpowers 的 BLOCKED → “break the task into smaller pieces”；Anthropic 的 initializer + 逐功能推进）。
6. **别制造预算压力源。** 避免“you have a time limit”“尽快”“别花太久”（GPT-5 附录的反例）、避免每步注入预算倒计时（Sonnet 5.5 页）。若确有限制，写成具体数字和到期后的动作。
7. **提前收尾与 effort 档位相关，提示与 effort 要配合。** Haiku 5.5/Sonnet 5.5 的数据显示 medium 比 low 少停；GPT-5 guide 也建议提高 reasoning_effort 配合 persistence。但提升 effort 增加成本，不能替代任务拆分。
8. **“复杂度评分”类机制信号弱。** Taskmaster 的 1–10 自评加阈值 5 没有客观细则；Anthropic 也承认“Agents struggle to judge appropriate effort”，所以给出显式规模规则。【推断】本仓库的“是否过大”应由 Root 按可验证单元数判断（例如含 3 个可独立测试部分即拆成 3 次委派，或在同一委派里要求逐项勾选），而非让 worker 自评。

---

### 可直接借用的提示句（英文，来自官方原文，需按本仓库语境裁剪）

```
You are operating autonomously. The user is not watching in real time and cannot answer questions mid-task. (Fable 5.1)
Decompose the user's query into all required sub-request, and confirm that each is completed. Do not stop after completing only part of the request. (GPT-5 guide)
If one part turns out to be blocked, complete every other part in full and say exactly what you left out and why — the whole task is the deliverable, and scaling it down is the user's call, not yours. (Fable 5.1)
Before ending your turn, check your last paragraph. If it is a plan, an analysis, a question, a list of next steps, or a promise about work you have not done, do that work now with tool calls. (Fable 5.1)
Never artificially stop any task early regardless of the context remaining. (Anthropic context awareness)
Never invent an early stopping point. (Codex persistent_mode, 原句为 “Never invent an early stopping point for monitoring the user explicitly asked to continue.”)
```

【推断】增补一句本仓库专用（非来源原文）：“本任务没有时间或 token 预算限制；若你认为内容太多，请逐项完成并按清单报告每项状态，不要因资源假设而省略。”

### 未查到或仅二手

- Kiro tasks.md 的粒度规则、引用 requirements、增量可测试的官方措辞：官方文档页未写，未找到一手来源（二手系统提示转载未采用）。
- Superpowers “每步 2–5 分钟”：本机 2ce8aa15 无此原文。
- OpenAI platform.openai.com 的 GPT-5-codex 专页、GPT-5.1 以上专页：未单独抓取；仅用 cookbook 的 GPT-4.1/GPT-5 指南与 codex 仓库提示。
- Anthropic “Effective context engineering” 博客：未读取。
- 对 gpt-6.1-terra 的官方提示指南：未找到；以上 OpenAI 结论基于 GPT-4.1/5 时代指南，对新模型是否仍适用属推断。
- 没有一手来源讨论“模型在无预算时自行假想资源受限”的专门章节；最接近的是 Anthropic context awareness 与 Fable 5.1 “Finish the whole task”。
- Taskmaster 的 expand-all 是否按阈值过滤：未核对。

