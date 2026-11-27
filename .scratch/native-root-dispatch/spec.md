# Native Root 派工判断表

状态：第 1–4 节的浓缩规则已写入 `NATIVE_PROMPT`；本文件保留完整判断表，供对照和试用，不是插件源码。第 5–6 节（oracle 访谈纪律、可续用方案形态、规划期门闩）只写在本表和任务包约定里，不写入 `NATIVE_PROMPT`（现 1,125 字符，测试上限 1,200）。

基线：`908c624`（2026-11-20）。对照 [OpenCode Crew `agents/root.md`](https://github.com/bioShaun/opencode-crew/blob/main/agents/root.md) 与 [architect.md](https://github.com/bioShaun/opencode-crew/blob/main/agents/architect.md)，并按仓库监护 bot 对实际口径的说明修订（提示词要求的跳过条件，加上仓库 `plans/` 用途；不能给出线上跳过比例）。第 2 节再规划条件与第 4 节摩擦/进度交回，对照 [Antigravity Orchestrator](https://antigravity.google/docs/models/) 的「同一会话里规划与执行如何交接」（不是 Swarm / Teamwork / Boost），并按本仓库口径改写：规划由 Root 按需触发，不每轮自动规划，进度汇报对象是 Root 不是 oracle。第 2 节可续用方案与第 5–6 节，对照 [OmO v5.1.84 编排指南](https://github.com/code-yeongyu/oh-my-openagent/blob/v5.1.84/docs/guide/orchestration.md) 的规划访谈、方案可续用与规划期审查门闩，按本仓库口径改写：不采用粘性 `/ulw-plan`、每条消息先规划、`.omo/boulder.json`、空闲自动续跑或 Team mode，也不新增角色或工具。

角色用 pi-subagents 的 `scout` / `oracle` / `worker` / `reviewer`。oracle 继续承担 planner/architect，不另造内置 planner。本表补充、不替代 `NATIVE_PROMPT` 已有条款：本地例外、一项一派、缩范围时沿用原模型、并发/锁/持久化一致性先经独立审查、最小纵切、同一成果连续 2 轮审查未过则交用户。

## 1. 先判断：直接做还是委派

以下条件全部满足时，直接做并自己验收（允许自己做 ≠ 免验收）：

- 要改的现有文件已经读过；如需新建，位置和内容已经明确
- 只涉及约 1～2 个文件，而且不改公共接口
- 已有可用验收命令，不需要新设计测试

只要有一条不满足，按下表分流——不能直做，不等于要先规划：

| 情况 | 交给 | 注意 |
|---|---|---|
| 找代码位置、读日志、追调用链、补上下文 | scout | 产出只作上下文，不扩大 Scope；位置不清时先跑这一步，不要把 oracle 当搜索器 |
| 需要一份可被后续引用的方案契约（见第 2 节） | oracle | 只要方案，不要实现；方案仍是上下文，实施必须由 Root 另开 worker 并写明 Scope |
| 其余不满足直做条件的实现和自验证 | worker | 每个任务包都写 Goal / Scope / Decided / Approach / Acceptance / Check；Approach 由 Root 写，这是标配，不是派 oracle 的理由 |
| 高风险变更（公共接口、数据/计费/权限、删除代码或测试）、并发/锁/持久化一致性、回归风险、验收有疑点 | reviewer | Root 自己直接做的高风险改动同样适用；派审前写明范围和依据，工具拿不到的 diff 先导出并给出路径 |

- 每次决定先写一行理由，例如：直接做：三条件均满足，或 委派 worker：已读过且做法唯一，或 委派 oracle：要锁定接口契约供后续验收。
- 不确定时先派 scout，再重新判断，不要直接派 worker，更不要一复杂就先派 oracle。
- 高风险方案先审再实施：见第 6 节。oracle 方案若涉及公共接口、数据/计费/权限或删除代码/测试，先派 reviewer 审方案，通过后再派 worker；实现完成后按上表再审实现。
- scout / oracle 的产出不得扩大 Scope。worker 发现需要越出 Scope 时必须停下并说明冲突，由 Root 决定，不要让它自行扩权。

## 2. 规划何时升级（派 oracle 写方案契约）

默认：Root 在 worker 任务包里写短 Approach，然后直接派 worker。不要为每单另派 oracle，也不要先写 plans/ 文档。

只在需要一份可被后续引用的方案契约时才派 oracle，典型是：

- 要定公共接口、权限/数据契约、或模块边界，后面 worker / reviewer 要按这份契约验收
- 有真实的设计分叉，而且分叉会改接口、数据、权限或验证方式，需要先锁 Decided 再实施
- 需要重新划模块边界或写跨模块契约，或长任务、多轮交接，需要留下可引用的步骤和验证标准

这些情况不要派 oracle：

- 「不止一种合理方案」只是实现细节（函数怎么拆、测试怎么写）：Root 在 Decided / Approach 里写死一种即可
- 改了 2 个以上文件，但模式已有、Root 已读过、做法唯一：这是派 worker 的理由，不是派 oracle 的理由。「跨模块」不是「改动文件数 > 2」
- 改公共接口但只是按已有契约做机械增补（字段或形状已定）：写短 Approach，直接派 worker
- 纯修复、文档对齐、或按已有方案做下一阶段实施：不再规划，任务包 Approach 指向已有方案
- 位置还不清楚：先 scout
- 不要因为新任务、目标变了、或既有方案卡住，就自动进入规划角色

方案写清：背景与边界、已决定事项、接口/数据与异常契约、按依赖排序且可勾选的剩余步骤、每步的验收命令、每步的建议角色、风险与未决项，以及「何时重新规划」。建议角色只许 `worker` / `scout` / `reviewer`，不要写 OmO category 或模型名。再规划条件要写具体：出现哪些情况应停止执行、交回 Root 决定是否再派 oracle 修计划；不要写空泛的「若有问题再规划」。派 oracle 的任务包须明确要求写出这些节，并要求自检遗漏项（隐藏意图、歧义、范围膨胀、缺失验收、未处理边界）；这是 oracle 自己的检查，不另造 plan-consultant。方案只作上下文，不扩大范围，实施必须由 Root 另开 worker 并写明 Scope。

方案要落在后一任 Root 读得到的文档里（例如本次工作目录下的 markdown）。交接（handoff）时，Root 在简报和后续 worker 任务包的 Approach 里指向这份方案及其未勾选步骤，按剩余步骤继续；不要因为换了会话就再派一次 oracle。只有方案缺失、目标变了、或当前方案不行时，才由 Root 显式再派 oracle。不要做 `.omo/boulder.json` 或任何插件解析的任务账本，也不要做空闲自动续跑。

引用真实文件和符号，不要写易失效的精确行号。oracle 必读材料最多 3 份；够做第一版决策就先把方案骨架落盘，再补细节，避免步数用尽后空交付。这是用法，不是派工条件。

## 3. 派工与止损（与 NATIVE_PROMPT 一致）

- 一次委派只交付一项可单独验收的成果；共用一次验收或昂贵读取的步骤合并，互不依赖且可分别验收的成果分开。
- 拆分优先推进端到端用户可见的最小纵切，未接入主链路前不过度打磨叶子。
- 子代理只交回部分结果或请求拆分时：先缩小范围再派，可续用同一子代理；缩范围时沿用原模型，仍失败再换模型。不要只要求它继续，或在同一任务内分阶段。
- 按 diff 和检查输出验收，不把子代理自称「完成」当作验收。
- 同一成果连续 2 轮审查未过，或修复需引入计划外持久化、新协议或超出威胁模型的加固时，停止自转并交回用户。

## 4. 执行中的摩擦与进度（交回 Root，不是交回 oracle）

这是任务包和纯文本约定，插件不解析，也不引入结构化报告合同。不要做成同一 agent 回合内自动切换 planner/executor 模型，也不要让 oracle 自动承担执行中的进度复核。

worker 遇到以下情况必须停止，用纯文本向 Root 说明事实与冲突，不得自行改计划口径，也不得直接升级到用户：

1. 按计划或任务包验收连续失败两次
2. 接口表现与计划或任务包预期不符
3. 遇到计划未敲定的设计选择

Root 收到后决定：自己写入决定并续派 worker，或派 oracle 修计划（方案仍是上下文，实施再开 worker）；仅在 Root 也判不了时才交用户。

这与「同一成果连续 2 轮审查未过则交用户」不同：那是 reviewer 审查循环的止损；本条是执行/验收摩擦先交 Root。

长任务中，以及用户在 worker 工作时再发消息时，由 worker 向 Root 汇报相对计划（或任务包）的进度。Root 决定结案、继续剩余步骤、或触发规划。进度汇报对象是 Root，不是 oracle。不要因为用户插话或任务变长就自动进入规划，也不要自动接 brainstorm→planner。

worker 任务包应写明上述交回与进度约定；有可引用方案时，Approach 指向该方案及其再规划条件和未勾选步骤。oracle 任务包应要求方案单列「何时重新规划」，并带可勾选步骤、验收命令和建议角色。两类任务包仍用纯文本，不增加字段合同。

## 5. oracle 访谈纪律

只在第 2 节已经决定派 oracle 之后适用。不要把下面写成「每条用户消息先规划」，也不要把 Root 会话切进粘性规划模式。

- 先只读探索再开口。位置不清时先派 scout；oracle 自己也只读，不要实现。仓库里能回答的问题（现有行为、文件位置、已有契约）不要拿去问用户。
- 意图清楚（结果已明确，只剩偏好）时，只问业主决策：不可逆、破坏性、或会产生花费的选择。每问附带原因。不要连问实现细节。
- 意图不清楚（结果本身发虚）时，宣布并采用一套默认，而不是连问；把默认写进方案的已决定事项，供用户否决。
- 用户点头只授权写方案，不授权实施。写完后停。实施须由 Root 另开 worker，并写明 Scope。
- 方案落盘前，oracle 自检遗漏项（见第 2 节），把发现写进方案或未决项，不要另派一个规划角色。

## 6. 规划期门闩（审方案 vs 审交付）

审方案只发生在规划阶段、实施开始前。高风险方案（公共接口、数据/计费/权限、删除代码或测试）仍用现有 reviewer 审方案，不另造 plan-reviewer。

- 方案审查一次一过：Root 派一次 reviewer，针对完整方案给出通过或附引用的否决。通过（含仅剩备注）后进入实施；否决则由 Root 决定是否再派 oracle 修方案，然后再审。不要把同一次 reviewer 委派聊成多轮重规划。
- 实施开始后（已派 worker 按该方案改代码，或 Root 已按方案动手），reviewer 只审交付是否符合方案和 Scope，不重开规划，也不撰写新方案。审查意见里的设计建议不是自动再规划；要改方案，必须由 Root 显式再派 oracle。
- 这与第 4 节的摩擦交回、以及「同一成果连续 2 轮审查未过则交用户」都不冲突：执行摩擦先交 Root；审查循环止损仍交用户；改方案只能走 Root 再派 oracle。

## 7. 任务包约定（纯文本，不是字段合同）

Root 写进任务包的约定示例，可按任务删减，不要改成插件可解析的结构。

oracle 任务包应包含：只读探索后写方案，不要实现；仓库能回答的不问用户；意图清楚时只问不可逆/破坏性/花费的业主决策，不清楚时宣布默认；用户点头只授权写方案；方案须有可勾选的剩余步骤、每步验收命令、每步建议角色（仅 worker / scout / reviewer）、何时重新规划、以及自检遗漏项。方案落在后一任 Root 读得到的文档。

worker 任务包仍用 Goal / Scope / Decided / Approach / Acceptance / Check。有可引用方案时，Approach 指向该方案、未勾选步骤和再规划条件，并写明第 4 节的交回与进度约定。handoff 简报的 Approach 同样指向该方案，避免新会话再派一次 oracle。

审方案的 reviewer 任务包应写明：规划阶段、实施开始前、一次一过；只对完整方案给出通过或附引用的否决；不要重开规划或写新方案。审交付的 reviewer 任务包应写明：只审交付是否符合既有方案和 Scope；设计建议交 Root，不视为已改方案。

本表不引入每条用户消息先规划、回合内双模型切换、新的内置 planner 角色或新工具，也不引入 `.omo/boulder.json`、空闲自动续跑、Team mode、或旧的结构化报告合同。

## 参考

Crew 仓库里的方案契约例子（不是每个 PR 先写一份）：

- [plans/review-gate-spec.md](https://github.com/bioShaun/opencode-crew/blob/main/plans/review-gate-spec.md)
- [plans/read-role-external-directory-inheritance.md](https://github.com/bioShaun/opencode-crew/blob/main/plans/read-role-external-directory-inheritance.md)
- [plans/crew-profiles-spec.md](https://github.com/bioShaun/opencode-crew/blob/main/plans/crew-profiles-spec.md)
- [plans/worktree-stage1-contract.md](https://github.com/bioShaun/opencode-crew/blob/main/plans/worktree-stage1-contract.md)
