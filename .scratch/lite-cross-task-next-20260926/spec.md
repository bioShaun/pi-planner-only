# 跨任务 native/lite 最小对照

Status: stopped
Scope: 已授权四次范围；第 1 条因计费终态缺口停止，剩余三条未启动。见 execution/report.md。

本轮回答：相同 Opus Root、Luna child 和中性委派指引下，lite 在不同代码任务上是否出现值得继续验证的增量。旧 T3 已结束，不复用其次数或剩余预算。

## 固定任务与抽样理由

| 任务 | 内容 | 验收及限制 |
|---|---|---|
| T1 | 外部子进程超时、异常类型及调用方接线 | 四份目标测试共 30 项，包括真实挂起进程；固定后续提交提供的 caller mock 修正 |
| T2b | REF/ALT stage、行折叠与 CLI/config/pipeline 接入 | 10 项现有 contract，加下述强制链路审查；测试本身不证明完整 CLI/BLAST 链路 |

按实现表面差异选择，未以本轮模型成功率或费用筛选任务。两项来自同一仓库，因此是跨任务探测，不代表跨项目泛化。T4 仍属另一条接入工作，需要独立环境与验证，本轮不扩入。

T2b 保留 T2 的 parent、target、测试、baseline，唯一提示词变更是“且必须在这三步之前”改为“且必须在这三步之后”。标准答案将 AllelePairStage 放在 REF 脱靶事实合并、SpecificityEvidenceContract、self-hit 检查之后、post_processor.run 之前；原文与实现及自身解释矛盾。旧 T2 不改、不合并新旧结果，差异见 T2-to-T2b.prompt.patch。

T1 的第四份测试固定来自 `cee4c0f074bd43efebc76942d2682f152caeb074`；它把两个旧 subprocess mock 改为 ExternalTool.run mock。该测试来源是既有任务定义，不在本轮修改断言。答案提交与这个 testRefs 提交都必须在任务克隆不可达。

## 唯一运行清单与预算提案

campaign `opus-cross-task-t1-t2b-20260926`；实际顺序和确定性种子见 plan.json：

1. T2b native
2. T2b lite
3. T1 lite
4. T1 native

每任务每臂一次，相邻成对、两任务反转臂内顺序。先按 campaign 名的 SHA256 种子确定任务及第一对顺序，再反转第二对，冻结后不因结果重排。

Root `tcuni-claude/claude-opus-5-5` high，child 沿用现有 Luna 配置，插件固定 `ad51067da379edf5735cb9b03d70f17bda331675`，strict=0、handoff=off。沿用 native-opus-calibration / lite-opus-calibration 两个 arm 的相同中性前缀和共同资源保护。

最多四次，串行、无自动重试或 resume、无额外付费健康请求。所有已尝试任务按冻结 actual 价格累计达到 **$10** 时，不启动下一条；这是运行间检查点，不是实时硬限额。单次沿用 3600 秒限制。旧实验支出独立保留，不计入本轮，也不借用旧授权。

## 逐次执行与证据

执行前重新核对冻结源码、Root/child 配置、当前模型列表和安全目录布局；每次重任务先存 slot audit/status、人工判断冲突，再经 slot cpu 调用公共 bench/run.sh。只在新付费范围获确认后创建执行授权记录。禁止直接运行内部 run-body.sh。

每条设置 BENCH_MAX_ATTEMPTS=1、BENCH_ATTEMPT=1、BENCH_SKIP_HEALTH=1、**BENCH_KEEP_CLONE=1**，TMPDIR/TMP/TEMP 使用各 run 独立 `/project/tmp` 子目录。上一条完整验收并确认累计费用后才能启动下一条。

保留克隆直到证据归档及审查完成。记录运行开始时 BASE；结束后保存：

- HEAD、完整 `git diff --binary BASE`、status、未跟踪文件列表及内容哈希；完整保存变更测试文件及其 BASE 版本，检查原断言；无未申报的提交或重置。
- 逐条原始事件、评测输出、退出、模型、Root 与所有 child 用量/终态、child 原始转录和指令、入口保护元数据。
- 记录全部实际执行、失败、跳过与收集数。命令被调用不等于测试运行通过；benchmark skip 如实单列。
- 独立核对后再清理属于本轮的克隆，原始证据只读保存。

统一评测会把受保护目标测试恢复为 canonical 版本，因此最终 diff 只证明评测后的文件状态；还须审查事件中的目标测试写操作。不得把最终干净目标测试推断成模型从未改过它们。

## 预先固定的质量门槛

两项均要求 parent 加测试出现与未实现功能一致的 RED、gold 通过、答案不可达；模型任务必须目标测试退出 0、零新增 masked-suite 失败。收集错误、异常终止不能仅因没有 FAILED 行而判通过。

T1 parent masked baseline 为 13 个失败；gold 为 12 个，因为已有 `test_run_command_timeout_raises_alignment_error` 被正确修复。预算试跑沿用既有“无新增失败”规则，消失的每项失败都需核实，不能强行要求修复前后的失败集合完全相同。T2b baseline 为空，目标 10 项通过之外 masked suite 必须退出 0。

**T2b 附加链路审查（两个臂完全一致）：**

1. `annotate-one --allele-pair` 和 AnnotateConfig 默认关闭；CLI override（包括配置文件路径）正确传递该开关。
2. AnnotatePipeline 在 REF 脱靶事实合并、SpecificityEvidenceContract、自比对失配检查之后，post_processor.run 之前调用新 stage；检查源码中真实执行位置。
3. 禁用或空输入保持原 AnnotateResult；启用且非空时要求 blast_db，按 policy 的 needs_alt 调用现有配对/比对函数，正确传递配置与工作目录。
4. REF id 保持，ALT id 加 `_ALT`，13 列逐项来自 alt_*，三项 REF 脱靶事实置 NA，缺列抛错，位点属性保留。
5. 仅通过现有单文件 contract 不能替代前四项检查。该审查仍不等同于真实 BLAST/生物数据端到端验证，结论明确限定。

任一质量、模型/费用完整性、子任务终态、资源约束、答案引用或证据缺口即停止后续付费尝试；保留失败并计入已发生费用，不补样本。T2b 链路审查失败也触发停止。

## 结果解释与范围外

逐任务并列 native/lite 的质量、所有尝试费用、耗时、首次实际委派前完成事件、返工与人工介入。只有两个臂都有效且合格的任务才展示完整配对费用，失败费用仍列在总支出，不能静默剔除。人工核对/离线预检开销与模型任务费用分列，不混作供应商账单。

四次只用于决定是否值得设计更多任务，不发布稳定节省比例、置信区间或跨项目能力排序。无信号则暂停扩样本；有一致线索也先提出新的固定范围，不自动追加。direct、strict、handoff、T4 和全模型矩阵均不在本轮。

离线结果和证据限制见 readiness.md；运行授权状态以 plan.json 为准。
