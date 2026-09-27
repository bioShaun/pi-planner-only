# 受保护的目标 Root 三臂校准

Date: 2026-09-26
Status: done — 三次运行完成，独立证据核对通过（限制如下）

本轮三次均有效，任务质量和完整计费检查通过。按冻结模型价格计算共 $3.80569241，低于 $10 运行间检查点；已达到三次上限，停止新增模型调用。新一轮使用已验收的共同临时目录保护，旧三次规程 FAIL 保留，不与本轮合并统计。

## 条件与结果

同一 T3，Root `tcuni-claude/claude-opus-5-5`、high thinking，child 采用运营者既有 Luna 配置；插件固定 `ad51067da379edf5735cb9b03d70f17bda331675`，strict=0、handoff=off。native/lite 使用同一中性委派前缀。三臂共享 Landlock 入口及临时目录说明，分别使用独立 `/project/tmp` 子目录。

| 顺序 / 臂 | 有效 / 质量 | Root 费用 | child 费用 | 本条总费用 | 模型执行秒数 | Root 完成事件 | 首次委派前完成事件 | 实际 child |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 lite | PASS / PASS | $0.79059800 | $0.01916764 | $0.80976564 | 400 | 12 | 6 | worker + oracle（validator 角色） |
| 2 native | PASS / PASS | $1.07887825 | $0.02653502 | $1.10541327 | 567 | 16 | 11 | 两个 worker，含返工 |
| 3 direct | PASS / PASS | $1.89051350 | $0 | $1.89051350 | 391 | 31 | 不适用 | 无 |

费用来自记录用量和冻结价格表，不是供应商账单；本轮 Root actual 表恰与 opus 权重相同，child 始终按其实际模型价。三条 actual 与 opus 合计因此相等。上表秒数仅为模型任务段，不含外部评测和逐次审计等待。首次委派指标严格计数 `tool_execution_start` 前已观察到的 assistant `message_end`，不使用含糊的“第几轮”。

## 验证依据

- 执行前受保护 goldcheck 通过；答案提交在隔离克隆不可达、无 remote/ref，目标测试来源一致。当前模型列表和版本 dry-run 通过，无付费健康请求。
- 三条均为目标测试 30 passed；masked suite 的 14 个失败 ID 与既定基线完全相同。suite 退出 1 是已知基线失败，不称全量测试全绿。
- Root/child 实际模型、用量、退出、工具起止与费用逐项核对。四个 child 都正常结束，无嵌套计费缺口、悬挂调用、API 错误或未知费用；native 的列表调用未计作委派。
- 三条元数据记录 Landlock ABI 7 和各自专属临时目录。命令检查中 `/tmp` 字样仅出现在 native/lite 的禁止写入指引；已记录的实际工具命令未使用该路径输出。child 指令传递临时目录，未显式 export 的命令依赖继承环境与内核限制。
- 保护范围是本地后代进程；元数据和命令检查不等同于全机文件系统审计，不外推到既有外部服务或远程执行。原保护验收的限制仍适用。
- 24 项冻结源码哈希与历史 72 个原始文件哈希未变；本轮 24 个原始文件另立哈希清单。三个任务克隆已按既定入口自动清理，原始日志及四份 child 转录保留。
- 本轮未修改 bench/插件行为；复用同哈希版本已验收的 29 项离线测试与完整发布测试记录，不冒称本轮重新运行了这些测试。

三条均由独立 `astra_validator_complex` 从原始事件核对通过；独立核对也确认串行时序、累计费用、历史 72 个文件与冻结源码哈希。该核对没有重跑测试，不是额外的正式代码审查 gate。

## 实际改动与证据限制

lite 改动五个克隆文件，其中 benchmark 两处 `regions.bed` 改为 `cds.bed`；原始 git_audit 返回保留完整测试 diff，断言未改。native 改动四个源代码/文档文件，没有测试变更。

direct 改动十个克隆文件。记录的唯一测试写命令将 benchmark 两处 `regions.bed` 改为 `transcript.bed`，对应 diff stat 为四行变动，没有删除或修改断言的命令。克隆已自动清理，未额外保存这一文件最终完整 diff，因此该判断依据是命令和 diff-stat 记录，证据强度与 lite 的完整 diff 不同。direct 的 benchmark 命令实际报告 skipped，不记作 benchmark 测试通过；统一目标测试及 masked suite 是质量验收依据。

中间 RED、工具错误、格式检查失败、既有 mypy/完整套件失败均保留，没有删除失败记录或追加补样本。最终质量通过不表示这些中间检查全部通过，也不代表模型产出的全部额外改动已经过发布级代码审查。

## 结论与下一步

本轮取得了共同资源保护下的三个可计费、质量合格样本，修复后的入口在这些真实路径上可用。lite 本条较早委派、Root 完成事件较少；native 本条经历一次 worker 返工。direct 本条模型执行稍快，但 Root 用量较多。这些是本次行为观察，不发布节省比例、稳定成功率或跨任务优劣结论。

下一步先做离线的跨任务样本设计：选择区别于 T3、具备可隔离 parent/target 和独立质量验收的真实任务，再冻结 native/lite 成对清单及新预算。优先验证相同委派指引之外的插件增量，暂不扩展当前 T3 或全模型矩阵。新的付费实验另定范围；不消耗本轮未用预算自动追加。handoff 仍缺自然长会话与同检查点恢复证据，继续延后。

票 02 的保护代码和既有计费修复仍在工作树，未在本轮提交或发布。票 03 本次三条执行范围已关闭。

## 证据索引

- [运行清单](plan.json)、[完整冻结包](freeze/)、[真实预检](preflight-complete.json)
- [完整计价结果](after-3-actual.json)、[opus 兼容核对](after-3-opus.json)
- [lite 审计](attempt-1-audit.json)、[native 审计](attempt-2-audit.json)、[direct 审计](attempt-3-audit.json)
- [lite 独立核对](independent-attempt-1.txt)、[native 独立核对](independent-attempt-2.txt)、[direct 与整体独立核对](independent-attempt-3.txt)
- [源码及历史完整性](final-integrity.json)、[本轮原始文件哈希](all-runs.sha256.json)
- [逐次停止决策](after-attempt-3.json)、[旧轮规程失败报告](../calibration-report.md)

原始 runs：`/project/tmp/ppo-bench/results/target-root-t3-opus-guarded-20260926/runs`。`after-*`、`attempt-*-commands.json` 和 `child-evidence/` 均为派生核对材料，不改写原始记录。
