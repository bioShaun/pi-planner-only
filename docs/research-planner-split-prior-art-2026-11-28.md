# 规划/执行拆分的同类做法：对照与可借鉴项

日期：2026-11-28。目的：对照 [编排演进](orchestration-evolution.md) 的阶段三（规划抽离：最强模型只规划，中等模型 Root 只编排），看其他产品怎么做、哪些可借、哪些已在本仓库评估过。只引用一手资料（官方文档、官方仓库）；读取的是当日滚动文档，未锁版本，未运行任何被调研的工具。事实与推断分开标注。

**时效说明（有修订）**：初稿主要参照 Aider（2024）和 Roo（页面无日期），偏旧。查证后：Roo Code 已于 2026-05-15 停止维护（仅找到多个二手来源引述官方公告，未取到官方原文）；Aider 未归档但基本停更（第三方追踪：最后一次提交 2026-05-22，PyPI 最新 0.86.2 为 2026-02-12）。因此主参照改为第 2 节的 2026 年一手资料（Cursor、Factory、Amp），第 1 节中的 Aider/Roo 仅作思路来源。

早前调研覆盖：Claude Code / Codex / Cursor / Aider 测试闭环 / 会话级并行管理器（[2026-10-01](research-orchestration-tools-2026-10-01.md)）、LangGraph / OpenAI Agents SDK / CrewAI（[2026-10-26](research-orchestration-frameworks-2026-10-26.md)）。本文只补它们没写的“规划与编排分离”这一条线，不重复。

## 1. 各家做法

### 1.1 Aider architect/editor（思路来源，2024；项目已基本停更）

来源：[Separating code reasoning and editing](https://aider.chat/2024/09/26/architect.html)。

- **事实**：每个任务两步：Architect 描述怎么解，Editor 把方案转成具体编辑。Architect 输出原样交给 Editor。
- **事实**：动机是 o1 擅长推理但难以输出合规的编辑格式，所以让它“按自己习惯描述方案”，再交给传统模型落地。
- **事实**：在 Aider 自己的代码编辑基准上，o1-preview 单独 79.7%；配 o1-mini 或 DeepSeek 做 Editor 为 85.0%（whole 格式，作者称太慢不实用），配 Sonnet（diff）为 82.7%。同一模型自配也有增益：Sonnet 77.4→80.5，GPT-4o 71.4→75.2。
- **与本插件的差异**：Aider 的拆分是固定流水线，每个任务都走；本插件按需才派 architect。Aider 的 Editor 只做格式化编辑，不是能探索、能跑测试的 agentic worker。
- **推断**：支持“规划单独交给强模型、方案文档原样传下去”这个方向；基准是 2024 年的单文件编辑任务，增益大小不能直接外推到本插件的多步任务。

### 1.2 Claude Code opusplan

来源：[Model configuration](https://code.claude.com/docs/en/model-config)。

- **事实**：`opusplan` 别名在 plan mode 用 opus，进入执行后自动切 sonnet。两个模型由环境变量分别指定。
- **事实**：同一会话内切换；切模型会影响继承主会话模型的 subagent。
- **与本插件的差异**：它是“同一个主会话换模型”；本插件是 Root 常驻中等模型，规划另派 fresh 只读 architect。前者规划时能直接看到完整对话，后者要靠任务包传上下文，但 Root 上下文更干净、常驻成本低。

### 1.3 oh-my-openagent（omo）

来源：[docs/guide/orchestration.md](https://github.com/code-yeongyu/oh-my-openagent/blob/master/docs/guide/orchestration.md)（官方仓库文档，描述的是产品设计，不是效果实测）。

- **事实**：只有一个编排者，即主 agent；没有单独的“规划 agent”，`/ulw-plan` 是把主 agent 切进规划模式（只读，批准只授权写方案），`/ulw-execute` 再在同一会话里执行。
- **事实**：规划流程先只读探索，再判断意图 CLEAR/UNCLEAR：CLEAR 只问仓库答不了的 owner-decision（不可逆、破坏性、花钱），UNCLEAR 采用并声明默认值。本插件 #60 已吸收这一条。
- **事实**：方案写入 `.omo/plans/<slug>.md`，每项是 `- [ ] N.` 复选框，带参考、验收标准、QA 场景和推荐执行类别；草稿 `.omo/drafts/` 作为压缩后可恢复点。
- **事实**：`plan-reviewer` 偏向批准，只因“查证过的阻塞项”驳回，只剩备注的批准算批准；某轮既无新问题也未批准时停下问用户。方案复核只在规划阶段开放（plan-gate）。
- **事实**：执行时主 agent“从不自己写产品代码”，实现、测试、QA、审查全部委派；每个复选框要由独立 reviewer 验过才勾；证据写入 `ledger.jsonl`；`boulder.json` 记录进度，空闲轮自动续跑最多 8 次。
- **事实**：worker 按“类别”（quick / deep / ultrabrain 等）选，类别到模型的映射在 `omo.json`，类别任务不允许直接传 model。
- **事实**：另有 team mode（成员间中途通信）和 Kibitzer（常驻只读旁路会话，向主 agent 推记忆提示）。

### 1.4 Roo Code Orchestrator（Boomerang）（项目已于 2026-05 停服，仅作设计思路）

来源：[Boomerang Tasks](https://docs.roocode.com/features/boomerang-tasks)。

- **事实**：Orchestrator 是内置 mode，**默认不能读文件、写文件、调 MCP 或跑命令**，官方理由是读文件会让其上下文被文件内容填满、影响编排，并造成 context poisoning。
- **事实**：子任务上下文完全隔离，信息只能通过创建时的指令下传、完成时的 summary 上传，“parent 只拿到 summary”。
- **事实**：可通过自定义 mode 给 Orchestrator 加 `read`，官方提醒要慎重。
- **旁证**：issue [RooCodeInc/Roo-Code#5518](https://github.com/RooCodeInc/Roo-Code/issues/5518) 报告引入 todo list 后 Orchestrator 不再派子任务、所有工作留在单个上下文里（用户报告，已关闭，未核实根因）。

### 1.5 OpenCode

来源：[Agents](https://opencode.ai/docs/agents/)。

- **事实**：内置 `plan`（主 agent，不改普通项目文件，可在被要求时写 plan 文件）与 `build`（默认）；切主 agent 不改会话模型。
- **事实**：subagent 在 child session 中，**始终后台运行**，父 agent 在子 agent 空闲时收到报告；父 agent 用 `subagent` 权限控制能启动谁。
- **事实**：权限是工具层规则（`edit`/`shell`/`subagent` 等的 allow/ask/deny，后匹配者优先），`steps` 到上限时移除工具并要求文字总结。

### 1.6 pi 生态

来源：[pi-mono extensions README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/README.md)、[pi-subagents](https://github.com/nicobailon/pi-subagents)。

- **事实**：pi 核心有意不带 subagent 和 plan mode，由扩展提供；官方示例有 `subagent/`（single / parallel / chain，每个 subagent 一个独立 `pi` 进程）和 `preset.ts`（命名预设，切换模型、thinking 和工具）。
- **事实**：本插件依赖的 pi-subagents（npm 0.90.0，2026-11-22）是生态里最主要的编排包。
- **未覆盖**：本次检索一次被限流，没有穷尽其他 pi 编排扩展。不能据此断言“没有别的”。

## 2. 2026 年的一手资料（补查）

### 2.1 Cursor：从独立 planner 到“根 planner 不写代码”

来源：[Scaling long-running autonomous coding](https://cursor.com/blog/scaling-agents)（2026-01-14）、[Towards self-driving codebases](https://cursor.com/blog/self-driving-codebases)（2026-02-05）、[Dynamic planning with agents](https://cursor.com/blog/dynamic-planning-agents)（2026-01-30）、[long-running agents](https://cursor.com/blog/long-running-agents)（2026-02-12）。

- **事实（演进过程）**：无结构的共享协作→加锁后争用严重、agent 只做小而安全的改动→ planner / executor / 独立 judge。它们自己总结：一次性全部规划太僵化，发现新问题时难以调整。
- **事实**：去掉独立 planner、让 executor 同时规划和派活后，“连续 executor”出现病态行为：随机 sleep、停掉 agent、**自己下场干活**、拒绝规划并只派几个窄任务、不正确合并、过早声称完成。归因：角色过多（规划、探索、研究、派活、监工、review、改代码、合并、判完成）。
- **事实（最终设计）**：根 planner 拥有全部范围、**不写代码**；可递归派 subplanner；worker 在自己的 repo 副本里工作，完成后写一份 handoff（可含关注点、偏差、发现、反馈）回传给请求它的 planner。
- **事实**：要求每次提交 100% 正确会导致严重串行化，所以有意接受一定错误率，再用定期的“绿色分支”修补。规模是一周、约 1,000 次提交/小时，与本插件的交互式场景不同。
- **事实（Plan Mode）**：计划保存在 `.cursor/plans/`，纳入 git；跑偏时“回退改动、修订计划、重跑”，而不是执行中途追加提示。
- **推断**：“编排者负载过多角色会自己下场干活、过早宣布完成”与本仓库阶段三的动机一致；也对应 om36 诊断里 Root 追逐自身工具打磨、目标漂移的现象。但 Cursor 的判断来自他们的大规模自治场景，不能直接当作本插件的数据。

### 2.2 Factory Missions

来源：[How Missions Work](https://factory.com/news/missions-architecture)（2026-04-10）、Factory 公告（2026-02-26）。

- **事实（角色分离）**：orchestrator 规划、拆解并引导执行，“避免累积过细的上下文”，调查和实现全部委派；**不自己驱动验证**，由系统在里程碑处注入独立 validator。worker “认为对了”后交出，但最终正确性由独立 validator 判定；validator 不修，只把问题交给 orchestrator，由它建修复项。
- **事实（新思路）**：先写“验证合约”（一组可测试的行为断言），再拆 feature，理由是先定义正确性可避免契约被已规划的实现影响；validator 用黑盒方式验证。每个 feature 用新鲜上下文的 worker，先写测试。
- **事实**：按角色选模型（公告列出 orchestrator 用 Opus 4.6、worker 用 Sonnet 4.6/Opus 4.6、验证用 GPT-5.3-Codex）。受阻时 orchestrator 停下任务并把控制权交还用户。
- **推断**：“验收断言先于实现拆分、由 architect 写、独立于实现”这点本仓库没有：目前计划里的“逐步检查”是和步骤一起写的。这是可实验的约定，不需要新机制。
- **限制**：这是厂商对其重型长任务系统的自述，没有公开对照实验。

### 2.3 Amp：oracle 是顾问，且在减少可配置项

来源：[GPT-5.4, The New Oracle](https://ampcode.com/news/gpt-5.4-the-new-oracle)（2026-03-05）、[Customize Your Dial](https://ampcode.com/news/build-your-own-dial)（2026-09-10，含 2026-10-23 更新）。

- **事实**：主 agent（如 Opus 4.6）加 oracle 子 agent（GPT-5.4），oracle 负责架构建议、代码 review、棘手 bug，把建议带回主上下文；官方内部评测数据是 oracle 回答质量 60.8%（GPT-5.2）→68.2%（GPT-5.4）。这是其内部评测，口径未公开。
- **事实**：2026-10-23 更新说明 Tune Modes 现在每个 mode 只剩 Main Agent 一个角色，**不再能为 Oracle 或子 agent 单独指定模型**；Task 和 Read Thread 子 agent 与发起它们的线程用相同模型和推理档。
- **推断**：“强模型作顾问、主 agent 小而快”和本仓库的 architect 分工相近，但 Amp 的 oracle 是顾问，决策权在主 agent，不是“最终规划者”。另外 Amp 在把按角色指定模型的配置收回，简化趋势与本仓库“做减法”一致，也提示 `subagents.agentOverrides` 的每角色覆盖值得定期复核是否仍有用。

### 2.4 Codex CLI plan mode

- **事实（二手来源）**：LeanOps 博客（2026-11-15）称 Codex 有 `plan_mode_reasoning_effort`，让规划阶段用独立的推理档；子 agent 默认继承父的模型和推理档。另一来源说明 plan mode 的只读约束在提示层，没有运行时沙箱。
- **未核实**：官方配置文档抓取返回 403，上述内容未经一手核对，只作线索。

### 2.5 这些资料的共性

- **收敛的部分**：规划、编排、执行、独立验证四类职责要分开（Cursor、Factory、omo）；编排者不应同时承担太多角色（Cursor 的反例、Factory、Roo 的设计理由）；worker 的完成声明不算验收（Factory）。
- **分歧的部分**：规划者是独立角色还是同一个 agent 的模式（Cursor 最终有独立 planner，omo 和 Codex 是同一 agent 切模式）；规划者有否决策权（Amp 是顾问，Factory/Cursor 是负责人）；是否按角色指定模型（Factory 是，Amp 正在收回）。本仓库的选择（独立、只读、按需、交方案给用户确认）落在这些选项的中间。
- 这些公司的目标多为长时间自治或云端任务（Cursor 的周级运行、Factory 的六小时到六天），和本插件“交互式、省 token”的场景不完全同类，借鉴时要按场景取舍。

## 3. 与本仓库已有结论的对照

| 参照做法 | 本仓库状态 | 判断 |
|---|---|---|
| 规划交强模型、方案原样下传（Aider） | 阶段三已做；方案文档加 worker `Approach` 指向它 | 已一致 |
| 规划期访谈 CLEAR/UNCLEAR、可恢复方案（omo） | #60 已吸收为 brief 约定 | 已吸收 |
| 按类别分 worker 档位（omo） | 2026-10-06/07 评估过：简单任务全换廉价模型只省总花费约 2%，低于预设 5% 线，保持单档（[证据](worker-tiers-evidence-2026-10-06.md)） | 已评估，不重开；除非 worker 占比或单价显著变化 |
| boulder / 证据台账 / 空闲自动续跑（omo） | CHANGELOG 明确不做 boulder 注册表和空闲自动续跑；整体路线是做减法（[subtraction plan](pi-planner-only-subtraction-plan.md)） | 有意不借 |
| team mode、Kibitzer（omo） | 无对应；收益无本地证据 | 不借 |
| Root 禁止自己写产品代码（omo、Roo；Cursor 最终设计中根 planner 不写代码，其连续 executor 方案因为“自己下场干活”等病态行为被放弃） | 本插件保留 Native“局部任务例外”；§0 台账记 2026-11-27 增量证据：用法真实但仍无轮次/成本测量；建议处置“保留-仅工程”（撤回会把明确局部的活也强制委派），最终处置为暂定，2026-12-15 前无证据则撤回（用户 2026-11-16，见 #54） | 与台账待裁定项同一问题，见 §4-2 |
| Root 不读文件、只收摘要（Roo） | 本插件要求 Root 检查 git diff 与测试结果，不能照搬 | 有取舍，见 §4-3 |
| 独立 validator 负责最终正确性、worker 自述不算验收（Factory、omo） | 本插件已有：Root 看 diff 和检查输出而不信 child 自述，独立 reviewer；没有“验收断言先于拆分”的顺序约定 | 大部分已一致，顺序约定见 §4-2 |
| worker handoff 带关注点/偏差/发现（Cursor）、受阻时停下交还用户（Factory） | Native 的摩擦交还规则：两次验证失败、接口与预期不符、计划未定的设计选择，纯文本交回 Root | 已一致 |
| 规划阶段用单独的推理档（Codex `plan_mode_reasoning_effort`，未一手核实） | architect 的模型和 thinking 已由 `subagents.agentOverrides` 单独配置 | 已有等价手段 |
| 按角色指定模型的配置项（Factory 用，Amp 在2026-10 收回） | 本插件用 `agentOverrides` 按角色覆盖 | 不动；可在下次复核时查实际用了哪些覆盖 |
| 权限在工具层而非提示词（Roo、OpenCode；Codex plan mode 反例：只读仅在提示层） | Lite strict 有工具层限制；Native 靠提示词；`architect` 的只读靠 agent 定义 | 部分已有 |

## 4. 可借鉴项（按成本和证据排序）

1. **方案复核的“偏批准”规则**（omo plan-reviewer）。约定：复核只因“查证过的阻塞项”驳回，仅剩备注即批准。对应本仓库“同一成果连续 2 轮审查未过就交回用户”规则，可减少复核无限返工；om36 诊断（[diagnosis-om36-native-convergence](diagnosis-om36-native-convergence-2026-10-29.md)）里也出现过无边界验收导致反复重开。落点：`.scratch/native-root-dispatch/spec.md` 的 brief 约定，不动 `NATIVE_PROMPT`（1,125/1,200 字符）。**成本最低，建议先做。**
2. **验收断言先于实现拆分**（Factory 的“验证合约”）。约定 architect 方案中先列出可检查的完成断言，再拆步骤；理由是避免验收标准被已选定的实现带偏。仅改方案模板的顺序，不加机制；可在下一个真实需要 architect 的任务上试，再看是否减少验收阶段的漂移。
3. **“Root 是否应禁止自写产品代码”转成待证问题。** omo、Roo 和 Cursor 最终设计都用硬约束或分工，本插件用例外；两者各有取舍但本地没有对照数据。该行已在 §0 台账，2026-12-15 到期复核时一并用；不在此改行为。
4. **Roo 和 Factory 的 Root 上下文论据**：Root 读文件会占满上下文。本插件 Root 必须看 diff 和测试，但可考虑“让 worker 或 reviewer 先给 diff 摘要，Root 只看摘要和结论性输出”是否降低 Root 上下文。**仅为假设**，需用真实会话的 Root 上下文占比验证后再议。
5. **工具层只读而非提示词只读**：与 ADR 0012（explorer 只读靠提示词）相关；OpenCode 的 per-agent 权限规则是工具层。pi-subagents 是否支持类似的 per-agent 工具白名单属于既有 `reviewer` 的做法，可顺势评估 explorer，但 ADR 0012 已有明确取舍，不推荐无新事故时重开。

## 5. 不确定与限制

- 以上大多是厂商对自己设计的描述，效果数据只有 Aider 的基准表和 Amp 的内部评测数字；omo、Cursor、Factory 没有公开对照实验被本次读到。Cursor 的设计演进是定性观察。
- Aider 基准为 2024 年模型与单文件编辑，仅作方向参照。Aider 和 Roo 的“停更/停服”状态来自第三方追踪和二手转述，未直接核对 GitHub 和 Roo 官方公告。
- Roo issue 为用户报告。Codex 的配置项未能从官方文档核实。
- 没有运行任何被调研工具；没有核对各工具的当前版本差异。
- 本文不修改运行代码、配置、ADR 或台账。
