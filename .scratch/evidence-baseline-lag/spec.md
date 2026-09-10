# Evidence 三采样与无效重验证止损

**Status:** ready-for-agent

修订：2026-09-10。替代本目录原先的 first-parent lag 分区与 identical-reasons 不计轮次方案。实施顺序：01 Evidence 语义与 Reviewer 证据闭环 → 02 重试分类与止损 → 后续独立的 Root Idle Policy。原 issue 文件名保留以维持链接。

## Problem Statement

用户希望让高成本的 Root（例如 GPT Astra）专注规划、指引和验收，把执行交给较低成本的 Worker（例如 GPT Luna），降低完成一个 Task 的总费用。当前最紧急的问题是完成后的无效协调：旧 Task 基线与报告后的状态变化混用，导致已完成的工作重复验证，Root 重读报告、重新 Delegation，最终耗尽纠正轮次而 blocked。

本目录记录的 2026-09-10 事故中，Task 旧基线为 `4dd63ca`，Worker 仅提交 `.scratch/root-idle-phase/`，结果为 `8bab410`；中间早已存在的无关提交被卷入 Evidence 判断，连续三轮 Validator 没有解决基线问题。当前 Orchestration 会保存 Task 基线、在结果到达时采样并绑定报告，但验收仍通过 Task 基线参与的统一比较判断，未建立独立、可持久化的每次执行归因与报告后新鲜度契约。

旧 spec 以 WorkerReport 的声明文件寻找最早相关提交，把更早的不相交提交排除为 lag。这会让先提交漏报文件、后提交声明文件的 Worker 隐藏修改。修复需要可信采样时点，而不是从 Worker 自报内容反推执行起点。

## Solution

每次实际 Worker 执行保存 Root 自己采集的执行前 Evidence（`A_run`）和结果接收时 Evidence（`C_report`）；复核和验收时重新采集 `C_now`。分别回答两个问题：

- Truth / scope：`A_run` 到 `C_report` 发生了什么，是否如实报告且符合 TaskSpec？
- Freshness：`C_report` 到 `C_now` 是否变化，当前状态是否仍是被验证和复核的状态？

保留 Task 多轮执行的归因链，避免每轮重设基线抹掉此前漏报、越界或尚未审查的工作。Validator 验证已有结果，report-only 修正修复报告；两者都不能覆盖原执行证据。

Review loop 将“可通过具体行动修复”与“相同条件下再次委派无效”分开。需要改代码时交给 Worker，需要修报告时走 report-only，需要验证新状态时才委派 Validator；无法验证或缺少条件时明确 blocked，并给出恢复条件。停止无效重试不代表放宽 PASS。

## User Stories

1. As an 操作者, I want 正常完成的 Task 一次进入复核, so that 旧基线不会消耗额外 Root 回合和子进程费用。
2. As an 操作者, I want 优先修复错误重验证再收紧 Root gather Policy, so that 委派更多任务时完成闭环已经可靠。
3. As Root, I want 每次 Worker 执行开始前有独立 Evidence, so that Task 创建或恢复时间不会冒充本次执行起点。
4. As Root, I want 真正结果到达时由自己保存 Evidence, so that Worker 自报字段不能决定可信基线。
5. As Root, I want async 启动回执与最终结果明确区分, so that 启动时状态不会被误存为报告时状态。
6. As Root, I want 重复结果只绑定一次执行记录, so that 通知重放不会移动证据时点。
7. As Root, I want Truth 与 Freshness 分开表示, so that 报告漏报不会被错误描述为报告后漂移。
8. As Root, I want 执行前已有的无关提交不计入该次修改, so that baseline-lag 事故能正常完成。
9. As Root, I want 执行期间漏报的独立提交仍进入归因, so that Worker 不能靠提交顺序隐藏文件。
10. As Root, I want 空声明与实际修改不一致时拒绝 PASS, so that 空报告不会洗掉已提交工作。
11. As Root, I want 已提交、暂存和未暂存修改均被纳入, so that clean tree 不会使真实修改消失。
12. As Root, I want 执行前脏文件内容不变时不算本次修改、内容变化时仍被发现, so that pre-existing dirt 不会误报或掩盖工作。
13. As Root, I want scope 由原 TaskSpec 决定, so that Worker 如实声明越界文件也不能自行扩大授权。
14. As Root, I want 多轮修改与未解决 finding 连续可追溯, so that 下一轮基线不会擦除前轮问题。
15. As a Reviewer, I want 看见 Task 尚待验收的累积结果及各轮归因, so that 最后一轮小修不会遮住此前大改。
16. As a Worker, I want report-only 修正复用原工作归因并生成新报告 revision, so that 修复 schema 不必重新编辑已完成的文件。
17. As Root, I want 无效报告到达时也保留对应执行的 Root Evidence, so that 稍后的报告修正不会失去原修改窗口。
18. As Root, I want report-only 执行发生文件变化时被识别, so that 报告修正不会成为隐藏写入的通道。
19. As a Validator, I want 检查绑定明确的报告和当前 Evidence, so that 验证成功只证明实际检查过的状态。
20. As Root, I want Validator 结果不能覆盖 Worker 的执行前证据, so that 验证不会重新定义工作归因。
21. As Root, I want 报告后 HEAD、内容、路径或工作区身份变化使旧复核失效, so that 陈旧 PASS 不会被接受。
22. As Root, I want 对重新验证后的状态显式绑定新验证和复核证据, so that 可恢复漂移能完成且旧报告不被静默刷新。
23. As Root, I want 缺失历史采样被标为不可验证, so that ledger restore 不会凭当前 HEAD 伪造过去。
24. As an 操作者, I want blocked 原因说明具体缺失条件和恢复动作, so that 无需猜测该改代码、修工具还是重做工作。
25. As Root, I want declared worktree roots 使用各自身份和采样, so that 主仓库正常不会掩盖另一个工作区不可读。
26. As Root, I want 并发变化保留为未知归因或漂移, so that 一个写锁不会被误当成外部修改不存在的证明。
27. As Root, I want 相同输入条件的无效 Validator 重派被拒绝, so that 不计轮次不会变成无限重试。
28. As Root, I want 故障分类基于结构化原因和恢复条件, so that 文案相同不会永久禁止已经恢复的验证。
29. As a Worker, I want 真正可修复的实现失败仍有有界纠正机会, so that 止损不会取消正常修复流程。
30. As an 操作者, I want 环境和契约失败不吞掉代码纠正轮次, so that 工具缺失不会被误算成三次代码修复失败。
31. As Root, I want 中止重试后仍必须通过 Evidence 和验收门槛, so that 节约 token 不以错误完成为代价。
32. As an 操作者, I want 对同一任务比较 Root Usage、子进程次数及总费用, so that Astra/Luna 分工收益来自实际测量。

## Implementation Decisions

### 01 — 先完成 Evidence 与验收闭环

- 在现有 Orchestration、Task 持久化、Evidence 比较和 Reviewer packet 边界实现，不新增独立调度服务。Root 继续只规划、Delegation、Git-read、复核与 Verdict；采样使用固定只读 argv，不赋予通用 shell。
- 每个执行记录绑定 canonical Task 身份、WorkerRun 身份、角色、报告 revision、cwd 和所有声明工作区根。`A_run` 在写锁与身份检查通过、实际执行开始前采集；`C_report` 在接收该执行的最终结果时采集。启动失败与 async 回执没有完成结果；重复/迟到结果不得覆盖已绑定采样，身份不符的结果不纳入其他 Task。
- 即使报告解析失败，也保存该已知执行的结果时 Evidence，供 report-only 修正引用。绑定必须由 Root 建立；报告声明仅参与一致性检查，不能创建或替换可信采样。
- 分开保存 Truth / scope 的可验证性、实际变更、声明差异、越界 finding，以及 Freshness 的可验证性、漂移与原因。比较保持纯函数，Git 采样留在边界。下游 review、状态显示、bounded validation、Root Verdict 全部消费一致语义；仅 Freshness 为真不足以 PASS。
- Truth 以完整执行窗口比较已提交与工作树变化，并保留各轮修改记录。执行前脏文件须比较内容，不能按路径集合直接减去；删除、重命名、暂存内容和未跟踪文件也须有明确结果。无法完整采样、内容被截断或路径覆盖不足时标不可验证。规范化以各 Git 根为依据，正确处理子目录 cwd 和带引号/非 ASCII 路径。
- scope 只来自 TaskSpec 授权边界；报告声明越界工作不构成授权。一个执行窗口中的外部写入无法仅靠时间区间证明作者，遇已知并发或来源不明变化须保留 finding，禁止按提交作者、声明交集或相交提交之前的位置自动排除。
- Task 保存各轮不可变采样链与 finding 状态。最终报告声明本 Task 累积交付结果；每轮记录本轮变化并链接前轮。下一轮基线之前的本 Task 修改仍需审查。后轮修复或还原必须由 Evidence 和复核证明；净 diff 消失不自动关闭曾发生的越界 finding。轮间外部变化单独记录，不归到下一轮 Worker 也不静默忽略。
- report-only 是报告 revision 修正，关联原执行链；可重述此前文件而不误判为本轮空操作。它保留旧 `C_report`；修正时新采样只检查期间漂移。若期间发生工作树变化，不能标记为单纯报告修正通过，必须回到显式工作/漂移处理。
- Explorer 与 Validator 不重设 Worker 归因基线。Validator 输出绑定所检查的报告 revision 和 Evidence；若验证产生文件变化，旧 freshness 失效，不能用验证结束状态自动洗掉修改。现有按实际写能力协调的锁仍保留。
- 在 prepare-review 和 PASS 接受边界采集 `C_now`。完整工作区 fingerprint 比较包含声明根、HEAD、内容和身份，不能只哈希 Worker 声明文件。`C_report` 与 `C_now` 不一致时旧 ReviewResult 不可接受。
- Reviewer packet 覆盖该 Task 累积交付，包括提交与工作树修改，并提供分轮归因和未解决 finding；不能简单使用最后一轮 `A_run` 或旧 Task HEAD 的单一 diff 代替。若历史基线含脏文件或轮间外部改动，须依据保存的证据材料构建限定内容；材料不足、不能分离或 packet 截断时拒绝 PASS。完整 diff 留在 Reviewer 边界，Root 只接收有界摘要。
- 漂移恢复必须显式记录新 revision：保留原 `C_report` 与漂移 finding，对新增变化先确认来源、scope 与报告，再让 Validator 和 Reviewer 对同一当前 Evidence 验证和复核。接受时重新比较该 revision 的绑定 Evidence；不能仅重新采样并称作已验证。
- Ledger 序列化上述关联与版本，恢复后校验完整性。旧记录缺 `A_run`、`C_report` 或分轮材料时标不可验证并阻止自动 PASS；仅从已有可信材料恢复，不能用当前状态或 Worker 自报补造历史。新 WorkerRun 可以建立自己的证据，但不能使旧缺口变得可验证；如需重新交付，创建明确的新 Task，并保留旧 Task blocked 记录。
- 每个声明工作区根分别采样和归一化；任一根不可读、身份改变或证据不完整，整项验收不可验证。历史被改写时尝试现有只读能力能证明的端点比较；不能证明则给出结构化原因，不退回旧 lag 猜测或无条件 Validator 重派。

### 02 — 再完成重试分类与有界恢复

- Review loop 单点决定下一动作、是否消耗代码纠正轮次及恢复条件。增加结构化 failure class（实现、环境、契约、证据）与原因码；可重试性描述某个明确动作在当前条件下能否产生新信息，不描述错误永远能否修复。
- 漏报/错误报告走 report-only；真实代码缺陷或越界修复走 Worker；已确认来源和 scope 的当前状态缺验证时走 Validator；不可恢复历史缺口、缺失工具或不可读工作区走 blocked。若现有宿主结果已经提供可靠启动/工具失败信息，在同一分类中处理；Worker 自报缺工具只能作为待核实诊断，不能据此豁免证据门槛。
- 环境、契约及无进展重验证不消耗代码纠正轮次，但必须停止自动重派，返回明确 blocked 与恢复条件。可恢复的探测/验证重试另设有限次数，默认同一状态最多一次；同一 Task 自动恢复探测/验证重试累计最多三次，与代码纠正计数分离并持久化，修改原因文案或重启不能重置。正常 Worker 纠正保留现有轮次上限。
- 无进展判断至少绑定 Task、报告 revision、目标 Evidence、结构化原因、拟执行动作和相关环境条件。应在覆盖上一比较前读取旧记录；reason 文本相等既非必要也非充分条件。
- 恢复条件由新的可信采样、已验证工具恢复或明确的新报告/修复结果证明。达到上限后不自动循环；Root 可在记录恢复条件成立后发起明确恢复，保留此前失败与 Usage。旧 Validator PASS 不可复用给新 Evidence。
- 输出简短、可执行的下一步及证据缺口，停止提示“再派 Validator 会移动基线”。Root Verdict 保留既有入口；本功能的自动完成和 PASS 仍要求完整可验证 Evidence、有效复核与接受时 fingerprint 匹配，不增加跳过检查的 override。

## Testing Decisions

已与用户确认：以现有 Orchestration 完整 Task 生命周期为主要测试 seam，驱动 Delegation → 最终结果/报告 → 复核 → Verdict，断言 Task 状态、Reviewer 可见内容、是否新增子进程、纠正计数与 PASS 接受/拒绝。只测试外部行为，不以内部 helper 名称、完整提示语或原因字符串相等作为正确性依据。

已有先例为 Orchestration 的 report-only、异步完成、snapshot PASS/漂移、L-4 blocked→pass 与 ledger restore 场景；Git 边界复用 Evidence 的 RF-1 committed/dirty/hash、bounded Reviewer packet 和额外 worktree fixtures。仅难以从生命周期覆盖的 Git 情况补真实临时 Git 仓库测试，不新建平行测试接口。

| 场景 | 验收结果 |
|---|---|
| 旧 Task 基线 → 无关历史 → 新 Worker 仅修改声明文件 | 正常进入复核并 completed；无无效 Validator；Reviewer 不见无关 release diff |
| Worker 先提交漏报文件再提交声明文件；或空声明但有修改 | 漏报与 scope finding 保留，不因提交顺序/空声明 PASS |
| clean tree 已提交、暂存、未暂存、重命名/删除、预先脏文件不变/再改 | 正确交付内容可见；不变旧 dirt 不误归因，变化不能被路径集合抹掉 |
| 两轮修复，首轮越界/漏报，第二轮仅改另一文件或还原首轮 | 首轮证据仍存在；未解决问题拒绝 PASS；真正修复经复核后可完成 |
| 无效报告后 report-only；期间无文件变化/有变化 | 前者复用原执行归因；后者显式处理漂移，不能重设基线通过 |
| Reviewer 前及 PASS 前 HEAD/内容/根身份变化 | 旧 PASS 拒绝；显式恢复后重新验证和复核同一 revision 才完成 |
| Validator 未写入/产生文件变化 | 不覆盖 Worker 基线；变化不被当作无害验证自动接受 |
| 新 ledger 完整恢复/旧记录缺采样/损坏根/重放 async 结果 | 可信记录复用；缺口阻止 PASS；重放不覆盖采样或花第二轮 |
| 同状态反复请求验证；故障文案变化；重启后再试 | 自动重派次数有界，无无限免费循环，计数持久化 |
| 工具恢复或 Evidence 已实际变化但原因文案相同 | 可按可信恢复条件进入有界新验证，不永久锁死 |
| 正常 Worker 修复反复失败 | 保留既有纠正上限，环境失败不挤占代码纠正轮次 |
| 子目录 cwd、非 ASCII 路径、额外 worktree、改写历史、截断 packet | 可证明的正常情况正确处理，证据缺口明确且 fail closed |

发布验收再通过真实 Pi 宿主执行一条 baseline-lag 形状的成功任务和一条无进展验证失败任务，记录实际 Delegation 次数、完成通知、最终状态与错误恢复。宿主或模型不可用时标为未验证，不能把模拟结果当真实成本结论。

成本回归使用同一输入、验收标准和模型配置，对比 Root 输入/输出及缓存 Usage、各角色子进程次数、Validator 次数、重试、完成率和整个 Task 的总费用。记录定价口径与可用字段；无历史基线或真实 Usage 时只报告调用变化，不声称固定省额或比例。

## Out of Scope

- Root Idle gather Policy 的实现、TaskSpec sentinel 修复；由已有独立 spec 承担，安排在本 spec 两步之后。Idle 是没有 live Task 时的 gather Policy，不是 Worker 运行期间等待机制。
- 新建宿主能力握手平台、改写 async 调度、拓展 composite 工作流。上述能力需后续真实宿主验证；已知结构化失败可接入本次止损分类。
- 自动选择 Astra/Luna、修改用户模型配置、承诺某个节省比例。
- 放宽 write lock、身份绑定、Reviewer 上下文隔离、scope、packet 上限或 stale PASS 门槛。
- 按声明文件猜最早归因 commit、引入 lagPaths/first-parent 200-commit 扫描方案、提高纠正上限来掩盖失败。
- 全量重写历史账本，或证明执行期间每次外部修改的作者身份。

## Further Notes

全仓库当前优先级：**先做本 spec 的 01，再做 02，再做 Root Idle Policy，最后针对子进程实际工具和异步通知做宿主兼容性验证。** 本 spec 两步可以分别交付，但 01 不应继续发布已知无解的基线重派指引，02 不能以免计轮次代替停止重派。

来源：[成熟度评审](../../docs/pi-planner-only-maturity-review.md)、[Root Idle Policy](../root-idle-phase/spec.md)。评审标明基于较旧 GitHub main，部分条目本地已有修复，本 spec 不把整张问题表视为未修复事实。

实施入口：[01 Evidence 与 Reviewer 闭环](issues/01-t2-lag-partition.md)，完成后处理 [02 重试分类与止损](issues/02-reviewer-baseline-and-revalidate-spin.md)。本文件是方案唯一权威来源；issue 保留拆分范围、依赖和完成标准。
