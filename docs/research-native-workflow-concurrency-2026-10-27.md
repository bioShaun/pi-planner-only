# Native pi-subagents workflow 的并发能力与本轮使用

## 判定

经常只看到一个任务，并不意味着 Native 被设计成只能串行，也不能仅凭本轮判断过去大多数任务是否使用不当。它是由父代理编写控制流的顺序、并行组合容器，不会自动从自然语言任务发现依赖图并拆出并发任务。一个真正不可拆分的任务只有一个 child 是正常的；本轮则存在一处可重新设计的阶段屏障。已安装的 `pi-subagents` 版本为 **0.83.0**（`/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/package.json:3-5`）。

证据与分析仅基于已有本地一手文档、源码和本轮工件；没有运行模型对照、测试或修改实现配置。下文使用绝对路径，行号对应本次读取的文件状态。

## 1. workflow 实际如何调度

- 上游建议单个有界 child 直接 `{agent, task}`；需要稳定 key、顺序、fanout、重试或聚合时才用 workflow。脚本是普通 JavaScript，`await runs.all([...])` 显式表达并行，返回按输入顺序排列的数组；串行则由先 await 前项、再启动后项表达（`/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/docs/workflows.md:68-70,191-195`）。`runs.run` 调用即启动 keyed child，保存 promise 并最终 await 或 `Promise.all` 也可重叠；不能读取未 await promise 的 output（同文件 `:303-315`）。上游 README 也明确由 Pi 决定调用和组合方式，安装本身不自动启动 reviewer（`/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/README.md:35-47`）。因此它不是自动并行发现器。
- 顶层 workflow 的 `async:true` 与 child 自身 `async:true` 不是同一件事。前者让多阶段工作后台运行、父会话可处理交互；上游对此推荐一个顶层 workflow（`docs/workflows.md:15-17,82`）。child 未显式设置 `async` 时，`await runs.run` 等待其最终结果，即使 child 实际在后台。若 child 显式 `async:true`，await 得到的是启动 receipt：`state: running`、`ok: false`、空 `output`，不是完成或失败判定；必须随后消费终态，不能将 receipt 当完成结果，也不能靠同 key 重读刷新（`docs/workflows.md:84-90`；以上 `docs/` 指安装目录 `/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/docs/`）。
- 当前安装版本的并发上限名称是 **`globalConcurrencyLimit`，不是 `maxConcurrency`**。它限制一个 run 内同时运行的 child，包含 `runs.run`/`runs.all`；超额排队、释放容量后按 stable key 启动，默认 20，inline/file workflow 可单次覆盖为正安全整数（`/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/docs/configuration.md:456-464`）。实现校验该值并构造 semaphore（`/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/src/workflows/scripted-workflow.js:957-960`）。所以即使 fanout 写在一起，上限为 1、容量占满或其他准入限制仍可能使其排队；不能由脚本形状单独证明实际时间重叠。未读取当前运行的有效配置，不能把默认值当本轮实测值。

## 2. 推荐链与实际并发

上游的 `clarify → scout → worker → fresh reviewers → worker` 明确是给父代理的指导，不是强制 runtime 模式（`/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/docs/workflows.md:5-15`）。确有输入依赖时顺序合理，例如 reviewer 需要 worker 产出的代码；多个独立视角可在固定输入上以 `runs.all` 并发（同文件 `:168-174`）。独立任务真的同时启动并占有可用容量才是运行上的并发；单个 workflow 或后台运行本身都不足以证明多个 child 重叠。

## 3. 本轮依赖图与可改进边界

实际脚本先 await `prepare` 且要求 `PREPARATION_PASS`，然后 `runs.all` 启动 standards/spec 两 reviewer，最后在两者通过后启动 integrator（`/project/tmp/pi-1000/reviewer-range-integration-20261027/workflow.js:3-22`）。prepare 的任务包含建立组合 worktree、冻结证据以及完整 release 测试；只有测试成功才发通过标记。两 reviewer 的 brief 和脚本又明确要求读取 release 日志、manifest 和测试覆盖证据（`/project/tmp/pi-1000/reviewer-range-integration-20261027/integration-brief.md:9-16`；`workflow.js:10-14`）。因此在**当前任务定义下** reviewer 等完整测试是明确依赖，不是 runtime 强迫的串行；把源码审查必须等测试结果视为普遍技术依赖则是不必要的人工阶段屏障。

可供未来任务采用的最小调整：

1. 单一写者先完成组合、冻结源码和 diff，并发布可校验的 manifest；完成前不让审查读尚在变化的候选。冻结是审查共同输入的真实依赖，用户的每 cwd 单写者规则继续有效（`integration-brief.md:7,9-11`）。
2. 对冻结的同一版本并发启动 release 验证和一个或确有不同视角的源码 reviewer；reviewer 不读取、等待或评价尚未产生的测试结果，测试不修改冻结的源码。测试输出、临时目录位于隔离外部位置；如命令不能保证源码只读或需修代码，改用隔离副本，重新冻结后重新评估对应证据。此并发是任务重定义，而不是声称当前两 reviewer 已不依赖日志。
3. Root 最后汇总测试退出码、review findings 和同一 manifest 的匹配，才决定是否接受或进入集成；若审查要求核对测试证据，保留一个小的最终证据核对，而不是要求源码审查等到测试完成才启动。存在修复时，相关审核和验证须针对新冻结版本重新检查。单写者规则不允许同 cwd 并发写者；验证产生源码写入或第二个 writer 时不能照此并行。

本轮 preparation 实际记录了组合树、192 个文件 manifest、release exit 0，但也说明快照前后检查不能排除瞬间修改后恢复（`/project/tmp/pi-1000/reviewer-range-integration-20261027/preparation.md:3-13`）。因此仅有哈希或「只读」提示本身不等于强制不可变；执行时需确保快照与检查过程不受写入干扰。最终 Root 接受及 integrator 写入前的人为审批也是本次要求，不应与可以调整的测试前审查屏障混为一谈（`integration-brief.md:19-21`）。

## 4. Lite 也支持受约束并发

本仓库 Lite 的 `delegate` 描述明确建议批量执行独立且锁兼容任务：多个 explorer、reviewer 与其他角色，以及实现后不依赖检查结果且检查不改源码的 reviewer + validator（`/home/tcuni-claw/pi/pi-planner-only/index.ts:66-76,555-562`）。实际角色锁为 worker/validator exclusive、explorer shared、reviewer none；reviewer 绕过锁申请，其他角色冲突被拒绝（`/home/tcuni-claw/pi/pi-planner-only/delegate.ts:40-67,117-128,529-536`）。不要把 exclusive 注释中的「alone」误读成包括无锁 reviewer。固定 committed review patch 也不保证 live checkout 源文件不可变（`delegate.ts:519-522`）。

测试证据的范围需要分清：宿主测试明确验证两个 explorer 的 delegate 实际重叠、结果顺序，以及 worker/validator 冲突时只有一个启动（`/home/tcuni-claw/pi/pi-planner-only/host-runtime.test.mjs:107-152`）；`/home/tcuni-claw/pi/pi-planner-only/index.test.mjs:168` 断言 reviewer + validator 的工具描述；角色锁源码支持此组合，但上述引用的宿主重叠测试并非该特定组合的端到端验证。本次没有重新运行测试。Lite 也能并行，不能把「并行」本身当成 Native 独有优势；Native 的差异是其脚本化 keyed 组合、生命周期等能力，见上游 `docs/workflows.md:68-90`。

## 5. 本轮接口成本，不是天生串行

已有首次结果记录 `runs.run has an invalid key`（`/project/tmp/pi-1000/reviewer-range-integration-20261027/workflow-result.json:1-4`）；它只证明这次调用报错，不能仅凭该文件重建首次调用参数或确定其根因。后续 receipt 列出 prepare、standards、spec 已完成，integrate 为 rejected，整个 workflow failed（`/home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/ef5aac96-491a-41af-bcdf-33539aa6cdba/workflow-receipt.json:3-4,75-106`）。receipt 的状态不是时间线，不证明两个 reviewer 的实际重叠时长，也不等于所有阶段失败。

integrator 之前按 brief 需通过 supervisor 获取 Root 决定；本轮 Root 记录 supervisor reply 入口不可用，并记录了暂停后采用同一管理协议恢复和书面决定（`/project/tmp/pi-1000/reviewer-range-integration-20261027/integration-brief.md:19-20`；`/project/tmp/pi-1000/reviewer-range-integration-20261027/root-decision.md:3-9`）。另一个结果文件记录 integrator 因 interrupt 暂停（`/project/tmp/pi-1000/reviewer-range-integration-20261027/workflow-result-r2.json:1-2`）。这些反映本轮调用、协调和接口成本，不是 Native 天生串行的证据；本研究不排查或修复 supervisor 工具缺失，也不以这份工件推断其更深层原因。

## 6. 实用建议与证据限制

优先按真实依赖组织：简单任务用一个 child；有独立输入的审查或验证才 fanout；必须使用前一步结果时 await；确需多步和聚合再使用 workflow。单一实现任务不应为了制造并发而拆碎。并发受容量、资源竞争、模型调用和收集证据开销影响；本研究没有对成本、墙钟时间或质量做对照，无法断言任何模式更快或更便宜。上游推荐和当前源码说明可行性，不代表本轮的实测并发或全部历史任务的普遍分布；具体时间线和后续验收由 Root 独立核对。


## 7. Root 独立核验：实际时间线与调度判断

Root 读取了下列 run 的 status.json 中 steps[0].startedAt 和 durationMs，用开始时间加 durationMs 得到阶段结束时间。原始状态目录为 `/home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/<run-id>/status.json`；仅摘录本任务时间，不复制其他任务或资源信息。

| 阶段 | run-id | 时长（秒） |
|---|---|---:|
| 组合准备与完整 release | 3aa2e8bb-f310-4dbf-a1e1-d89a22687f43 | 167.622 |
| Standards 审查 | f4fdfc57-3ada-4ff2-81b0-a55f9da6eca7 | 89.381 |
| Spec 审查 | f488a0f3-c185-456e-aa7d-16e02a225287 | 107.502 |
| 集成 child，等待验收后暂停 | 6d3487f4-fd14-4479-beaa-903ccf52700e | 157.506 |
| 恢复后的集成 child | e6c89493-1a1e-499c-84ea-9a2e0edbb8e7 | 85.604 |

两 reviewer 分别在本机时间 17:09:21.275 和 17:09:21.333 启动，启动差约 58ms；区间重叠 89.323 秒。首个准备 child 从 17:06:32.151 开始，恢复的集成 child 在 17:16:00.245 结束，跨度 568.094 秒；其中约 15.7% 的时间有两个 child 重叠。这证明本轮确有并行，也证明大部分时间没有并行。此统计不含首次失败工作流、早期 scout 和 Root 最终提交阶段，不代表整轮用户端耗时。child 存活区间不等于模型计算时间；等待验收的 157.506 秒包含 Root 读取证据和等待，不能全部归因为工具故障，更不能据此宣称可节省同等时长。

Root 独立读了上游 workflows.md:68-90、configuration.md:456-464 和 scripted-workflow.js:951-960，确认显式控制流与 semaphore 限流；当前有效并发上限未读取，但实测 reviewer 重叠排除了本轮被强制限制为一个 child 的解释。独立读了本仓库 host-runtime.test.mjs:107-152、delegate.ts:40-67 和 index.ts 的 delegate 描述，确认 Lite 的独立调用并发已有宿主测试，特定 reviewer/validator 组合的支持来自角色规则和工具契约，未把它误称为本次新跑的端到端测试。

本轮可改进项由 Root 承担：

- prepare 将冻结源码和完整 release 合在一起，reviewer 又被要求读取 release 证据，形成父代理定义的阶段等待。未来改为先冻结候选，再并发验证与只读源码审查，最后 Root 聚合；若复审必须核对测试日志，保留最终证据检查。
- Root 验收是必需的，但无需预先启动一个仅等待 Root 决定的集成 child。在 Root 接受结果后再启动/恢复写者，可避免空等待及本次 supervisor 入口不稳定带来的协调环节；不会减少必须完成的 Root 审查本身。
- 本轮首次 runs.run 参数形状错误来自父调用，后续已通过同协议修正；这是具体使用错误，不是并发能力不足。
- 单个有界任务直接委派即可；多步骤 workflow 可以合理地以串行为主，是否值得取决于其依赖管理、恢复和聚合价值。不要用 workflow 数量或 child 数量当收益指标。

建议的依赖结构：组合并冻结候选 →〔完整 release ∥ Standards 源码审查 ∥ Spec 源码审查〕→ Root 汇总同一版本证据 → 单一写者集成。只有独立审查视角确有价值才保留两名 reviewer；保持同目录一个写者，验证不得改候选源码。任何测试/审查发现需要修改源码时，先结束旧候选审查，再更新、重新冻结并验证相关部分。

最终判断：工作流原本不会自动发掘并行，存在单任务/顺序阶段是正常设计；但这次没有充分利用可行的测试与审查重叠，并增加了不必要的协调等待。Native 是否更快或更便宜仍需同条件比较；本次没有修改运行配置、提高并发上限或运行付费对照实验。
