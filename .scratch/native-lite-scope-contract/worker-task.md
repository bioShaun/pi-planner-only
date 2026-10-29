# Root交接：输入范围与验收契约一致化，并继续受控比较

用户已要求“继续推进”，实现和测试交子代理，交互Root拆分、检查真实diff与原始测试结果。你是唯一写者，cwd /home/tcuni-claw/pi/pi-planner-only，当前HEAD e45b9d843acaa79ebbb914325b5a1033592b3f48（先核实）。不要清理既有dirty/untracked文件，不提交、推送、安装或reload。

## 决策和输入

先读 AGENTS.md、CONTEXT.md、.scratch/native-lite-budget-scope/final-acceptance.md、compare-c5-closeout.md、launch-gate-compare-c5-s1-native.md、.scratch/native-lite-comparison/protocol.md，以及 .scratch/native-lite-reopen/S1-brief.md、S2-brief.md、.scratch/native-lite-budget-scope/{prepare-batch.mjs,verify-batch.mjs,freeze-contract.mjs,preflight-consistency.test.mjs}、.scratch/native-lite-lifecycle/offline-batch-template.md。历史控制报告 /project/tmp/pi-native-lite-budget-scope/worker-report.md 可只读参考。

Root已选择保留原候选仓库内研究范围：不加入仓库外pi-subagents实现。明确S1验收表：候选内数据来源、调用/快照/增量与重复计数边界、Root/child与token/cache覆盖、缺失usage/cost行为都要有文件/符号证据；外部RPC实现、真实运行和账单若无法由候选证明应明确unknown且给出边界。不得仅因未研究输入外依赖拒绝，也不能把候选内可回答的漏项包装成unknown获得通过。未知项不等于免费或已证明无重复。两臂同字节brief，任务与实验Root评审指令共享明确标准。旧批次拒绝及报告保持原样；新协议版本单独冻结，旧批不追认为通过。

本次目标是先解决协议遗漏，再在已有授权内继续原S1/S2比较。先审计S2是否有类似输入/验收冲突；只作必要澄清，不扩大任务。保留候选 f818cc91c98d6129a152fb28161e00d2f601e494、既有Root/child模型与thinking、S1 exactly one worker及S2角色、顺序 S1-native→S1-lite→S2-lite→S2-native，20分钟/臂。正常失败即停；不因想得到通过而循环重跑。

## 编辑边界和验证

仅在 .scratch/native-lite-scope-contract/ 新增本次协议、brief模板、准备/验证工具和证据入口；新批次在 /project/tmp/pi-native-lite-<唯一timestamp>/。尽量复用已验收controller、guard、准备工具；不修改历史brief/配置/证据、产品源码、全局依赖和配置。若控制器确实必须变更，先向Root报告理由和精确范围，不直接改。

任何新增或修改脚本若改变行为，必须先只写测试并运行，保存因缺少目标行为而失败的原始红灯（不得是语法/导入失败），再实现并保存绿灯；guard加fault injection，不能删弱已有断言。针对本次问题应覆盖旧brief/新brief、paired规则不一致、范围内证据缺失不能被unknown豁免、外部未知不自动拒绝等可执行契约检查；不要用关键词匹配假装能证明LLM语义评审正确。离线检查应注明只能验证冻结/传递/结构；真实Root是否遵守仍须真实臂证据。不要重放旧报告给新实验Root，防止答案泄漏。

纯文字澄清不需要造实现镜像测试，但应提供逐项范围/验收映射与矛盾检查。离线测试由你运行；产品controller未变可绑定并复用已通过release，只有修改或新问题要求时补跑相应检查。所有证据绑定实际hash/命令/cwd/env/exit，不只给总结。

禁止临时文件放/tmp；所有TMPDIR/TMP/TEMP使用仓库外 /project/tmp/pi-native-lite-scope-contract/tmp。预计超过1分钟、2G或大量/data_0 IO：先读 ~/.config/agents/slot.md，每次启动前 slot audit 和 slot status 并保存项目日志，再 slot cpu|io -- 命令（长任务可后台-b），不补审计、不改容量、不杀其他进程。最多4个并行工具调用。不要另启控制子代理；仅经下述授权harness运行实验Root/children。

## 预算

累计USD30仅测试运行；交互Root排除，你及实验Root/children计入。已有known reported USD6.67280288，含旧控制worker最终1.12088280，不能重复累计旧session快照；这不是账单。请求停止线26，余量4。原共享ledger /project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json，Root本轮核对59事件/reserved16.204782395、sha256 e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d，lock不存在。保留所有原事件，不归零、退款、复制新账本或手改预留。reported与reserved不相加。

先审计现有控制分配可用余额与本次控制会话计量入口，列出控制/实验分账；控制本轮以USD1.50增量为检查点，达到前停向Root汇报，不能默默超过。此为工作检查点，不用会阻断取证的硬tool预算。若无法可靠获取本会话费用，提前报告而非视0。预算需要追加事件时仅提出精确plan，等Root审查，禁止自批。共享账本新锁一律停止，不自动清除/隔离。

## 阶段及Root门禁

A：离线先完成协议、最小实现/测试、四臂新批次准备、manifest/runtime-lock冻结、精确启动命令、预检和预算检查，写 preflight.md。通过 contact_supervisor(reason:"need_decision") 向交互Root请求审查，并保持等待；该阶段不启动付费实验。用户已授权继续，不必再向用户询问，这里是Root自身证据验收。若工具不可用，报告并结束，不切换CLI。

B：只在Root明确给出具体首臂launch gate后执行一次。原RPC harness是已授权实验入口，不是子代理失败后的CLI替代。每臂执行前保存新的slot audit/status并核对所有冻结hash、ledger、锁、输出空；执行后交真实session、payload fingerprints↔ledger事件对应、Root/child usage与终态、Root acceptance、报告hash、候选/config不变、exit/wallclock。每臂都通过contact_supervisor等Root验收后才启动下一臂；任一failure/timeout/stop即停整个批次，不自动修复重跑、不启动后续臂。

最终保留有效样本数、完整pair数、各项质量/费用/时间及unknown，不推断普遍优劣。保存准确控制session路径用于Root最终按assistant entry id去重计费，报告已退出/无运行实验/是否有lock。持久输出由launch output绑定；仓库内preflight与最终记录只放本次.scratch目录。
