# 2026-09-11 planner-only 运行审计

## 范围与版本

- 主会话：`/home/tcuni/.pi/agent/sessions/--project-glx-panel_design-TC-Uni-Triticum-durum-100K-260903--/2026-09-11T03-53-52-517Z_01a08e99-b285-72d8-a9b6-b638768a6a49.jsonl`，下文 L 为该文件物理行号。
- 项目：`/project/glx/panel_design/TC-Uni-Triticum-durum-100K-260903`，非 Git 工作区。
- 审计仓库与当前加载仓库的 HEAD 均为 `a9167a6a8ddb9a231b54d7776c726c4ea76e645d`，package version 为 0.4.1。加载目录只有 package-lock.json 存在工作区修改。
- 当前安装 pi-subagents 为 0.67.0，处于插件声明的 `>=0.65 <0.70` 范围内。日志没有完整启动版本清单，不能仅凭当前安装情况证明所有运行时依赖始终未变。
- 检查了主会话、8 个 Task ledger、关键 run 回执与输出、Step 2 和交接任务子会话的实际输入，以及插件实现与测试。

## 核心结论

这是任务包传递和异步摄取的可靠性问题；严格 verdict 校验只是暴露了上游故障。当前 ledger 的 8 个 Task 全部 `reports=[]`、`reviews=[]`，没有任何正式验收记录。业务层面的“已完成/已验收”描述与插件状态不一致。

现有解析器可以成功解析 48a662d5、882dbe86、ff35f510、deb9402c、c8e08f46、873bcc27 的磁盘报告。无需 worker 重写这些报告。

## P0-1：产物路径协议漂移与过早消费

证据：

- L19、L28、L76 的 bg_wait completion 含 `outputState: "present"`、`artifactPaths.outputPath`、`archivePath`；插件却返回 `worker returned no output`。
- 实际报告位于主会话父目录的 `subagent-artifacts/<runId>_<agent>_output.md`。并非每个 async run 目录都有 worker_output.md。
- `notify.ts:167–198` 只在旧路径 `<tempRoot>/artifacts/outputs/<runId>/` 取最大的文件。
- `orchestrate.ts:2405–2435` 在读取正文前执行 processedRunIds.add 和 endDelegation；读取不到时将空字符串交给报告解析器。
- `index.ts:1007–1023` 的 bg_wait 生命周期分支调用 recoverPendingRun(event.input, cwd)，没有把 completion 的产物定位信息交给摄取器。

后果：基础设施读取失败被错误归类为 WorkerReport 合同失败，消耗补报告次数；正常通知迟到后原始 run 已失去登记。

建议：建立统一 CompletionReceipt/OutputResolver，使用绑定到已登记 run 的宿主 outputPath/archive 定位正文，旧目录仅作为兼容回退。区分 execution-terminal、output-pending、output-loaded、report-invalid、report-recorded；执行结束可确认停止写入，但不等于报告已消费。只有正文与处理结果持久化后才确认摄取完成。不要按“最大文件”推测报告身份。

验收：复放本次 L19/L76 的原始 completion，必须读取实际报告；产物延迟出现时保持可恢复状态、不增加 reportCorrections；重复通知只记录一次。

## P0-2：通知身份冲突后按 agent 回退，串错 Task

证据：

- T-003 ledger 报 status 非法，而 882dbe86 自己的磁盘报告是可解析的 partial。
- T-004、T-008 ledger 的错误明确写着收到 `T-explore-bt2-50k-snp`，即最早 T-001 的身份。
- `orchestrate.ts:2887–2901`：taskIdHint 存在但找不到 pending task 时，仍会按 agent 唯一候选回退。
- `orchestrate.ts:2795–2799` 在后续报告身份验证之前就消费所匹配的 delegation。
- 最小运行复现：pending 只有 T-new/reviewer 时，带 T-old taskIdHint 的 reviewer 通知被匹配到 T-new。

建议：明确的 runId/taskId 冲突必须禁止弱匹配；优先使用结构化宿主 runId，保存 orphan/late receipt 供诊断。去重结果、通知替换结果和 run-to-task 关系应跨 reload 保留。对旧消息的 context 重放不得重新绑定新 Task。

验收：A 被消费后启动同名 agent 的 B，重放 A 通知，B 的状态、登记、预算、报告数量必须全部不变。覆盖 message_end/context/bg_wait 多通道和不同到达顺序。

## P0-3：TaskSpec 外的任务正文被丢弃

证据：

- L79 Root 给出详细建库步骤、路径、软链要求、冒烟命令和已验证事实。
- 子会话 `40612efa-f72e-4c04-a0d0-679089363aa3/run-0/session.jsonl:5` 实际只有简化 TaskSpec 与 Worker Contract，没有上述正文。
- L106 的交接任务包含完整文档提纲、数字、用户确认参数和“注释全量 SNP+INDEL”的要求；子会话 `4e294e15-9acd-4256-ae27-3419becf8522/run-0/session.jsonl:5` 同样只收到简化 JSON。
- `roles.ts:670–685` 以 JSON.stringify(packetSpec) 重建 worker packet，替代原始任务正文。

后果：worker 必须重新探索已经提供的信息，交接内容偏离。Step 2 的软链要求没有传入，不能把改用大文件拷贝简单归因于 worker 不服从指令。交接任务消耗 30 turns，completion usage 为 input 84,602 / output 44,485 / cacheRead 1,863,947；这些是累计宿主计数，不能全归为可节省开销。

建议：使用结构化 TaskPacket，分开保存 spec、instructions、knownFacts、artifactRefs；保留本次委派正文，并明确 spec 为约束权威。若正文超预算，返回可操作的精简错误，不能静默丢弃。统一 taskId 与 alias 的展示。

验收：在 TaskSpec 外放置关键步骤和事实，断言实际启动子进程收到这些内容；回放本次两份真实任务包，确保软链要求、全量表注释范围和交接参数完整。

## P1-1：resume 创建新 run，但未纳入编排

证据：L129–130 resume c8e08f46，宿主创建新 run 873bcc27；其磁盘报告可解析。L137 再次 verdict 仍无 WorkerReport。`orchestrate.ts:433–436` 将所有含 action 的调用排除为非 delegation，`index.ts:975–996` 因而不登记 resume，handleSubagentResult 又要求 toolCallId 有 delegation。

建议：区分只读 management 与会产生新执行的 resume；为后者维护 previousRunId/newRunId/taskId/executionId，进入写锁、预算、报告关联和持久化路径。报告修复优先本地重新摄取；确需模型修复时用显式 reportOnly 和无写入能力的修复执行。

验收：resume 的新 run 可被等待、计费、摄取并关联原 Task；模拟原 run 晚到通知不得覆盖新修订。

## P1-2：拒绝原因与恢复指引不准确

- verdict 实际拒绝 4 次：L118、L121、L127、L137。canonical id 与 alias 都解析到同一 Task，换 taskId 不是解决办法。
- `index.ts:885` 已在 verdict 检查前 reconcile，所以“加一个 verdict 前 reconcile”并不足以修复本次问题。
- L38 成功启动 ff35f510，L41 却因没有 pending 登记而拒绝 exact-id wait。这是登记被错误消费后的次生症状。
- bash 拒绝及 Idle 下 all/prefix wait 拒绝符合当前 policy；应修复登记和恢复路径。
- `orchestrate.ts:2737–2739` 一律要求 bg_wait，与宿主原生通知“返回用户、完成后唤醒”的指引冲突。本次 L95 是长达 30 分钟的阻塞等待；日志不能确定用户暂停请求的实际键入时间。

建议：增加结构化错误码与一次性恢复动作，如 OUTPUT_UNAVAILABLE、FOREIGN_RECEIPT、RUN_UNBOUND、REPORT_SCHEMA_INVALID。显示 task/run、最后收据、尝试过的产物位置、摄取状态；相同输入与状态的重复 verdict 应返回恢复指令，避免模型猜测。按宿主能力选择 native notify 或 bounded wait。

## P1-3：模型可用性预检

L103、L143 为 `tcuni-luna/gpt-5.6-luna` 不在 registry 的启动失败。L153 显示来源为宿主默认/agent 配置，不能全部归为 planner-only 模型策略错误。

建议：委派前输出 resolved provider/model/thinking 与配置来源，使用宿主 registry 预检；未知模型时给出有效候选，显式 fallback 策略决定是否自动切换。launch failure 后成功重试应更新陈旧 stateReason；T-007 ledger 仍保留先前启动失败原因。

## P2：报告合同、领域适配与可观测性

1. `completed_with_limits` 确有一份出现在 4a6bbe25 报告里；应在运行提示中列出合法枚举。`workerReportShapeReminder` 源码注释里的枚举不会自动进入 prompt。可将明确有限完成别名保守映射为 partial 并留 repair 记录，不能自动当作 completed。
2. `report.ts:450–467` 的通用样例写着 npm test、not-run、exitCode=0，应改成自洽且领域中性的例子。
3. 本次 scope={}、acceptanceCriteria=[]、validation.required=true 却无 commands 的 TaskSpec 被接受。重要边界只留在自然语言里；应提供适合数据流程的输出路径、验证命令与前置任务字段。
4. 当前项目非 Git，ledger evidence 为 gitAvailable=false；workspace-snapshot 默认总字节 8 MiB、文件数 500，不跟随树外 symlink。对 11 GB 基因组、ref 共享软链及 mamba 外部环境，应设计显式 artifact/process evidence。此项是修复摄取后需要验证的适配缺口，不是本次 no-report 的直接原因。
5. 增加 session 级导出：task/run 对照、时间线、receipt source、output path/digest、模型与版本、摄取错误、预算来源、最终状态。当前 8 个业务 run 之外，定位日志的 T-008 还启动了 ea1f6e0f 和 9beec9fc。

## 验证与实施顺序

本次未改动插件实现。已运行 notify.test.mjs、report.test.mjs、roles.test.mjs，全部通过；另用现有解析器检查 7 份真实输出，并最小复现跨 Task 弱匹配与 resume 不被识别。未运行全量测试、typecheck 或在线模型 E2E。

现有测试通过而真实故障存在，说明需要补宿主协议与时序 fixture。当前 E2E 重点覆盖工具能力、预算、模型启动等契约，不能替代本次异步全链路回放。

建议顺序：

1. 将本次 receipt/输出/输入包精简脱敏为回归 fixture。
2. 同批修复 OutputResolver、延迟确认摄取、通知身份严格匹配。
3. 修复任务正文保留和 resume 登记。
4. 加上可解释恢复、模型预检、非 Git 数据任务证据能力。

第一阶段成功标准是：已有报告直接摄取、旧通知不影响新 Task、摄取失败不消耗 worker 修复预算、传给 worker 的任务事实完整。正式 pass 仍需原有证据和验证条件满足，不能把 process complete 当作验收成功。
