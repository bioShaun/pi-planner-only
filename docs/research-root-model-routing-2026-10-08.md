# Root 模型分工调研：Opus 定方向、Sonnet 编排（2026-10-08）

**要回答的问题**：Root 能否让 Opus 负责规划和整体方向、Sonnet 负责编排执行，并且用户不用手动切换模型？

**资料范围**：只用一手资料，即官方文档、源码和本机实测。原始克隆和抓取内容在 `/project/tmp/orch-research/`。标“推测”的是判断，其余是事实。

## 1. 各家怎么做

### 1.1 Claude Code `opusplan`

- **规则**：按会话的 permission mode 选模型。plan mode 下用 `opus`，其他模式用 `sonnet`。两边可以分别用 `ANTHROPIC_DEFAULT_OPUS_MODEL` 和 `ANTHROPIC_DEFAULT_SONNET_MODEL` 固定版本。来源：https://code.claude.com/docs/en/model-config.md 的 opusplan 一节。
- **谁触发切换**：用户。用 Shift+Tab 或 `/plan` 进入 plan mode；模型调用 `ExitPlanMode` 提交计划后，需要用户批准才离开 plan mode。计划留在同一会话的上下文里。来源：permission-modes.md。
- **已知问题**：
  - anthropics/claude-code#65512：上下文超过 200k 后，plan mode 会静默降级为 Sonnet，状态栏不提示原因。
  - #8358：v2.0 把它从 `/model` 菜单移除，但仍可写在 settings 里使用。issue 中没有官方给出的原因。
- **启示**：
  - 按工作流状态自动选模型，用户只需选一次。
  - 降级或切换必须可见。
  - 进入和退出 plan mode 仍然靠用户操作，所以只能算半无感。

### 1.2 Anthropic advisor tool 与 Claude Code `/advisor`

- **机制**：执行模型（如 Sonnet）把 advisor 当工具调用，参数为空。服务端把完整对话（system、工具定义、历史、工具结果）交给顾问模型（如 Opus）推理，建议以 `advisor_tool_result` 返回，执行模型接着干。整个过程在同一个 `/v1/messages` 请求内完成。来源：https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool.md 。
- **何时咨询由执行模型决定**。官方承认“the executor tends to under-call the advisor … particularly coding tasks”，并给出建议的系统提示词，要求在以下时机调用：
  - 定方案之前（先完成定位文件、读资料这类摸底，再调用）；
  - 宣布完成之前；
  - 卡住时；
  - 想换思路时。
- **模型组合**：Sonnet 5.5 执行配 Opus 5.5 顾问是合法组合。但 Opus 5.5 的建议是加密的 `advisor_redacted_result`，客户端看不到明文；Sonnet 5.5 执行模型也不支持用 `tool_choice` 强制调用。
- **计费与缓存**：顾问按顾问模型的价格单独计费。每次调用重读完整对话，顾问侧缓存默认关闭，可以用 `caching` 开关打开。执行侧缓存不受影响。
- **实测数据**（https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence.md ）：
  - GPQA 上，Sonnet 5.5 单独跑和 Opus 5.5 单独跑同为 91%。
  - 不加提示词时，Sonnet 5.5 和 Haiku 5.5 在 198 题里一次都没调用 Opus 5.5 顾问，而工具定义本身让 Sonnet 每题的费用增加 25%。
  - 官方结论：执行模型越接近顾问模型，收益越小。
- **本环境不可用（实测）**：
  - `tcuni-claude` 代理（`http://117.176.220.47:1989`）对 `advisor_20260301` 返回 HTTP 400，报错为 tag 不在允许列表内。
  - pi-ai 的 `anthropic-messages.js` 在 `content_block_start` 只处理 text、thinking、redacted_thinking、tool_use 四种块，`server_tool_use` 和 `advisor_tool_result` 会被丢掉，多轮对话无法原样回传。

### 1.3 oh-my-opencode / oh-my-openagent（omo）

来源：github.com/code-yeongyu/oh-my-openagent，HEAD `ab811699`。

- **当前架构**：主会话负责规划和编排；实现交给按 category 派出的 worker，category 有 `quick`、`deep-*`、`ultrabrain`、`architect` 等。另有只读子 agent：`explore`、`librarian`、`plan-consultant`、`plan-reviewer`。旧版的 Sisyphus、Prometheus、Atlas、Oracle 这些角色名已不再对应现有实现。见 `docs/guide/overview.md:86-122`、`packages/senpi-task/src/agents/builtin/index.ts:14-32`。
- **主会话模型不会自动切换**。category 和 agent 按配置的模型链选第一个可用模型，见 `fallback-chains.ts`。
- **规划与执行是两个显式命令**：
  - `/ulw-plan`：主会话做摸底和访谈，然后调用 consultant，写出 `.omo/plans/<slug>.md`，由 reviewer 审查，最多 5 轮。
  - `/ulw-execute`：读计划里的 checkbox 和 `.omo/boulder.json`，并行派发 worker，通过 5 道验证门，结果写入 ledger。续跑最多 8 回合。
  - 见 `docs/guide/orchestration.md:85-178`。
- **成本原则**：稀缺的强模型放在低频、高杠杆的 consultant 和 reviewer 上，高频的执行 worker 用便宜模型。见 manifesto:66-72、agent-model-matching:121-127。
- **启示**：
  - 主会话模型保持稳定，强模型只放在关键决策点。
  - 计划要落成可续跑的文件。
  - 但它的规划到执行需要用户手动下命令，不是无感切换。

### 1.4 Cline Plan/Act

- **配置**：开启 `planActSeparateModelsSetting` 后，`planModeApiModelId` 和 `actModeApiModelId` 可以分别配置。
- **切换**：模型不能自己切到 Act，必须用户点按钮。同一任务的上下文会延续。
- 来源：cline/cline 仓库的 `apps/vscode/src/core/prompts/responses.ts:259-261`、`src/sdk/sdk-api-handler.ts:121`。
- **启示**：这是显式的人工阶段门，不满足无感。

### 1.5 Aider architect/editor

- **机制**：architect 模型输出方案文本，作为一轮新消息交给 editor 模型（`run(with_message=content)`），editor 不继承历史。代码里显式关闭了 prompt cache。见 `aider/coders/architect_coder.py:19-41`。
- **启示**：用文本交接，所以计划必须写成自包含的。

### 1.6 opencode、Roo Code

- 每个 agent 或 mode 绑定自己的模型。主 agent 通过 `task`（opencode）或 `new_task`（Roo）开子会话，结果以工具结果回传给父会话。
- 主会话模型由用户选择。
- 来源：anomalyco/opencode 的 `packages/opencode/src/agent/agent.ts:45-51`、`src/tool/task.ts`；RooCodeInc/Roo-Code 的 `src/core/task/Task.ts`。

### 1.7 pi 自带的能力（本机 pi 1.1.0）

- **Virtual model**（`docs/virtual-models.md`）：
  - 扩展用 `pi.registerVirtualModel()` 注册后，可以在 `/model` 和 settings 里像普通模型一样选。
  - 每次请求前调用 `route(request, ctx)`。`request` 里有：
    - `reason`：`user`、`continuation`、`retry` 或 `direct`；
    - `messages`：含工具结果；
    - `previous`：上一次实际用的模型；
    - `state`：路由状态，跟着会话分支走，压缩后仍保留。
  - 底栏显示实际路由到的模型，`/session` 按实际模型分别统计费用。
  - 官方建议 `continuation` 请求沿用 `previous`，以保住 prompt cache 和 thinking 签名。跨模型重放的效果等同于手动切换模型。
- **官方示例 `examples/extensions/jev-router.ts`**：强模型负责探索、规划，并完成第一次 edit/write；之后同一轮的下一个请求切到便宜模型，并一直留在那里。整个会话只换一次模型，只付一次 cache miss。
- **pi-subagents 内置 `oracle`**（别名 `advisor`）：
  - 只读，`defaultContext: fork`：子会话从父会话当前位置真实分叉，签名的 thinking 块会被剥掉。
  - 配置 `forkContext: "pruned"` 后，上下文压到 64 KiB 以内。
  - 来源：`agents/oracle.md`、`docs/tool-reference.md:77,120-126`、`docs/configuration.md:239-254`。
  - 这相当于 pi 版的 advisor。但 pi-planner-only 的 `delegate` 写死了 `context: "fresh"`（`delegate.ts:527`），而且 validator 角色已经占用了 oracle。

## 2. 四种范式

| 范式 | 代表 | Opus 是否有实权 | 是否无感 | 缓存与成本 |
|---|---|---|---|---|
| ① 同一会话按阶段换模型 | opusplan、Cline、jev-router、pi virtual model | 有，Opus 直接写计划和委派任务 | 规则触发时完全无感；opusplan 和 Cline 需要用户切模式 | 每次换模型都会让新模型的缓存失效 |
| ② 主模型加顾问 | advisor tool、Claude Code `/advisor`、pi oracle fork | 弱，建议要经 Sonnet 转述执行 | 无感，但依赖 Sonnet 主动调用，而 Sonnet 倾向少调 | 主会话缓存不受影响；每次咨询重读全文 |
| ③ 计划文件加执行命令 | omo、Aider | 有，计划文件就是契约 | 不无感，需要用户下命令 | 规划和执行上下文分开 |
| ④ 编排者加按角色绑模型的子 agent | omo category、Roo、opencode、本插件现状 | 无，主模型就是编排者 | 无感 | 已在用（worker 是 Sonnet，reviewer 是 gpt-sol） |

## 3. 本环境的约束

- **价格**（`~/.pi/agent/models.json`，美元/百万 token）：
  - Opus 5.5：输入 5、输出 25、缓存读 0.5、缓存写 6.25；
  - Sonnet 5.5：输入 2、输出 10、缓存读 0.2、缓存写 2.5。
- **缓存**：两个模型都只声明了 `promptCache.short: 300`，即 5 分钟。一次委派常常超过 5 分钟。
- **Root 对照数据**（`docs/root-model-compare-progress-2026-10-08.md`，R1 任务）：
  - Opus Root 每次 Root 费用 $1.73、$2.34；
  - Sonnet Root 每次 $0.62–0.91；
  - Sonnet 有 2/3 的运行一次都没委派，全部自己做了。这正是方向判断的缺口。
- **方案②的现成通道走不通**：advisor tool 在本代理上不可用，pi-ai 也不支持这类块（见 1.2）。
- **handoff**：会带上 `ctx.model`。选的是虚拟模型时，带过去的是虚拟模型本身，还需要实测 `setModel` 是否接受。

## 4. 候选方案评估

### 方案 A：virtual model 阶段路由（范式①，推荐）

把 Root 的默认模型设为一个虚拟模型，`route()` 按以下规则选模型：

| 规则 | 条件 | 路由到 |
|---|---|---|
| R1 | `reason=user`：用户每次发言后的第一个请求 | Opus |
| R2 | `continuation`，且本轮从用户上次发言起，还没有成功的 `delegate`、`edit`、`write` | Opus |
| R3 | 本轮出现第一个成功的 `delegate`、`edit` 或 `write` 之后 | Sonnet，本轮剩余部分都留在 Sonnet |
| R4（可选） | 上一条工具结果是 `delegate` 的失败、超时、BLOCKED 或 reviewer 报告 | Opus 处理这一步；等它再派出委派后回到 Sonnet |
| R5 | `retry` | 沿用 `failed` 的模型 |
| R6 | `direct`（压缩摘要等） | Sonnet |

**优点**
- Opus 亲自完成理解需求、做取舍和写第一份委派任务，有实权。
- “委派还是自己做”也由 Opus 决定，能补上 Sonnet 不委派的问题。
- 完全无感，pi 原生支持，不依赖代理开通新功能。
- 规则是确定性的，不靠模型自觉。

**代价（推测，待实测）**
- 每次用户发言多出一段 Opus。Opus 缓存通常已冷，要按 6.25/M 重新写入整个上下文：上下文 6 万 token 约 $0.38，15 万约 $0.94。
- 加上 Opus 的输出，按 R1 任务的规模估算，每个任务的 Root 费用约 $1.0–1.4，介于 Sonnet（约 $0.7）和 Opus（约 $2）之间。

**可选的优化**
- 用户只回了“好”“提交吧”这类短确认时，不走 R1，沿用上一个模型。
- 测试代理是否支持 1 小时缓存。如果支持，可以给 Opus 配 `promptCache.long`，让多次规划段之间保持缓存。

**风险**
- 跨模型时 thinking 块的处理：pi 文档说等同于手动切换，需要实测。
- Opus 窗口是 500k，加上 `compaction.modelOverrides` 预留的 200k，路由到 Opus 时上下文约 300k 就会触发压缩。
- `cacheWarming: idle` 大概率只给最后用过的模型保温。

### 方案 B：Sonnet 当 Root，加一个 fork 上下文的 Opus 顾问（范式②）

- **做法**：给 `delegate` 加一个只读的 advisor 角色，使用 pi-subagents 的 `oracle`，fork 上下文，模型设为 Opus。系统提示词要求在以下时机调用：定方案之前、第一次委派之前、委派失败时、宣布完成之前。
- **优点**：Root 的缓存始终稳定；Opus 只出现在关键点。
- **缺点**：
  - Anthropic 的数据表明 Sonnet 倾向少调顾问；
  - 建议要经 Sonnet 转述和取舍；
  - 每次咨询都是一个子会话，要重读全文，启动还有延迟；
  - 要改 `delegate` 的 context 写死逻辑，以及 Lite 合约中“child 看不到对话”这一条；
  - 不能真正让 Opus 负责方向。
- **适合的位置**：作为 A 的补充，在长执行段中途做一次方向复核。不适合当主方案。

### 方案 C：计划文件门（范式③）

Opus 把计划写进 `.scratch/<feature>/`，Sonnet 按计划执行。交接靠文件，但需要用户手动切模型或下命令，不满足无感。可以吸收进 A：让 Opus 段在大任务时先产出 `.scratch` 计划，再派第一份委派任务，这一点写进 Root 规则即可。

## 5. 结论与下一步

> **2026-10-08 用户决定：先观望。** 日常 Root 改回 Opus（`settings.json` 中 `defaultModel: claude-opus-5-5`），暂不实施下面的方案 A。观望期间顺带记录两件事，作为以后重新评估的依据：
> - 用 `/session` 记下典型任务的 Root 费用；
> - 记下哪些时候 Opus 的方向判断明显起了作用。

**推荐**：以方案 A 为主，吸收 C 的做法（大任务由 Opus 段先写计划文件）；方案 B 暂不做，等 A 上线后看执行中途是否还会跑偏，再决定。

**实现前先做技术验证（spike）**：不改仓库，在 `/project/tmp` 写一个约 50 行的本地扩展，确认：
1. 虚拟模型能正确路由到 `tcuni-claude` 下的两个模型；
2. 底栏和 `/session` 的显示正确；
3. 先 Opus 再 Sonnet 的切换不报 thinking 签名错误；
4. handoff 后虚拟模型保持；
5. 实测切换前后的缓存写入量；
6. 代理是否支持 1 小时缓存。

**需要用户定的事**
1. 第一版是否包含 R4（失败或 reviewer 意见回到 Opus）。
2. 是否让短确认消息跳过 Opus。
3. 实现放在 pi-planner-only 里（模型 ID 可配置、有测试，推荐），还是放在 `~/.pi/agent/extensions` 当本地扩展。
