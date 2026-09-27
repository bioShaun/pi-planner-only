# 目标 Root 的最小三臂校准

Status: done (旧轮规程 FAIL 保留；票 02 修复、票 03 受保护校准均完成)
Type: task
Date: 2026-09-26
Execution: 三次均已执行，任务/计费通过；全部出现 /tmp 规程违规，残留已清理。未追加模型调用，整体不记 PASS。

旧轮结果：[校准报告](calibration-report.md)。旧轮累计 $3.73554521；[运行约束缺口](issues/02-runtime-temp-boundary.md) 已修复。用户已明确允许新一轮限定范围执行，当前进度见 [票 03](issues/03-guarded-target-root-calibration.md) 和 [新计划](guarded-calibration-20260926/plan.md)。以下三次方案和结论保留为旧轮历史。

前置结果：[增量复核](assessment.md)、[六次 cpass-ds 首轮](../bench-plugin-fixes/trialrun-cont-20260926/report.md)。
旧票 09 和其六次额度已经结束，不重开旧 campaign，不转用剩余预算。

## 要回答的问题

在同一 T3 和相同 child 配置下，目标 Root 是否也先花 15–24 轮自行调查才首次委派；
换成目标 Root 后，lite 相对相同指引的 native 是否出现值得继续验证的额外帮助。
这轮只校准行为与测量链路，不估计节省比例或稳定通过率。

## 已准备的唯一方案

| 条件 | 固定值 |
|---|---|
| Root | `tcuni-claude/claude-opus-5-5`，沿用仓库原有目标 Root 路由 |
| 任务 | 同一个 T3，parent/target、提示词正文、目标测试与 masked baseline 不变 |
| 三臂 | `direct-opus-calibration`、`native-opus-calibration`、`lite-opus-calibration` |
| 前缀 | direct 无委派前缀；native/lite 与既有 pds 对照使用同一中性前缀 |
| child | 运营者现有配置，默认与 worker/scout/oracle/reviewer 仍为 `tcuni/gpt-6-luna`；不随 Root 更换 |
| 插件 | 固定 `ad51067da379edf5735cb9b03d70f17bda331675`，strict=0、handoff=off |
| 次数 | 每臂一次，最多三次尝试；失败与无效也占用次数 |
| 顺序 | direct → native → lite；按新 campaign 名确定性洗牌一次，种子见 order.json |
| 执行 | 串行，每次结束后 Root 查证据再决定下一次；无自动重试、无 resume |
| 预算提案 | 全部新尝试累计按冻结 actual 模型价达到 $10 后，不启动下一次 |
| 单次上限 | 沿用 3600 秒 wall timeout；$10 仍是运行间检查点，不是单次硬限额或供应商额度 |
| 健康请求 | 不发额外付费健康请求；首个真实任务本身检验路由 |
| campaign | `target-root-t3-opus-calibration-20260926`，使用新输出目录 |

三份 arm JSON 已写入 bench/arms。原 lite-opus 配置保持不变，因为它的专用工具名前缀不适合这组中性对照。
bench/prices.json 已补齐目标 Root 的 actual 价格项：input/output/cacheRead/cacheWrite 每百万分别为 5/25/0.5/6.25。
来源是运营者当前 models.json 的选定模型配置，见 pricing-and-model-provenance.json；不是外部市场报价或账单保证。
现有其他模型价格未改变。当前该 Root 的 actual 表与 opus 权重恰好相同，child 始终按实际模型价。

配置差异可查 calibration.patch；源码与配置哈希见 prepared-source.sha256.json。
这份提案的准备不代表 API 已试用、账户额度已确认或三次均可完成。

## 执行前与逐次验收

1. 预算获确认后，登记授权和新 campaign，核对本提案源码/arm/计价哈希、Root thinking 设置、宿主版本及 child 配置。
2. 使用不发生成请求的模型列表检查；实际 API 可用性在首个任务中确认，失败占一次并停止。
3. 复核 T3 parent/target、评测来源和 Python 环境；已有 goldcheck 与隔离证明仅在能证明条件一致时复用，发生漂移则重做独立检查，不覆盖旧证据。
4. 保存基线、完整 bench patch、新增文件与全部输入哈希；原六次 runs、STOP、freeze 保持只读。旧样本不混入本次的预算或均值。
5. 每次重任务前记录并判断 slot audit/status，再经 slot cpu 执行单次 run.sh；TMPDIR 使用仓库外 /project/tmp。保存日志、退出码、终态、用量与实际改动，不只依赖 pass 字段。
6. 每次同时核对 runcheck、目标测试退出 0、masked suite 无新增失败、child 终态与计价、Root/child 模型、完整 transcript 与元数据。
7. 出现 API/额度错误、质量失败、答案引用、未确认终态、缺失模型或费用、嵌套计价缺口或无法确认资源冲突，即停止后续任务。未知费用不能当零；任何已发生尝试均保留。

设置 `BENCH_MAX_ATTEMPTS=1`、`BENCH_ATTEMPT=1`、`BENCH_SKIP_HEALTH=1`、`BENCH_KEEP_CLONE=0`。
actual 为本轮预算主口径，opus 作为兼容核对。原始记录与子转录都保存；有非目标测试改动时按实际差异审查，不能仅因提示字段非空就自行添加新的停止规则，也不能忽略改动。

## 预先约定的结论分支

- 任一计价/质量/环境问题：停止并交付原因与已发生费用，不增加重试或补样本。
- 三次有效，但 lite 相对 native 没有可解释的增量：停止扩大成本收益实验，保留已验证的最小核心和保护机制，重新收敛产品承诺。
- 目标 Root 行为明显不同，或 lite 出现值得验证的增量线索：只据此决定是否设计下一组固定样本；样本、任务、预算另定，不自动追加。

观察首个实际委派时点、Root 自身读取/执行工作、真实角色调用、质量、所有尝试费用与耗时。字符长度只作描述，不折算成确定 token 或收益。
不把前置自查全部视作浪费，也不把当前 cpass-ds 与目标模型价格重算的差别当成行为校准结果。

## 范围外

不恢复 54 次矩阵，不切换 strict，不更换 child，不调小上下文阈值，不新增角色或调度器。
不删除写锁/取消/恢复保障，不更改 handoff 行为，不启动无自然长会话样本的交接实验。
只在新预算确认后执行三次付费任务；本次准备阶段没有模型生成请求。

## 执行结论（2026-09-26）

三次上限已用完。质量通过不替代运行规程合规；本次发现 TMPDIR 环境变量不能阻止模型硬编码 /tmp。
原始费用与行为观察保留，禁止静默重跑、删除违规样本或消耗未使用预算追加任务。

## 运行入口修复完成

票 02 已完成并独立验收。旧三次的规程失败不追认；未追加付费模型。未来计划必须重新冻结新增保护与公共说明，并另定预算。

## 受保护校准完成

[票 03 报告](guarded-calibration-20260926/report.md)：新一轮三次有效、质量通过，累计 $3.80569241，独立核对通过；最终测试 diff 和 benchmark skipped 的证据限制见报告。新旧条件分开，不追认旧 FAIL，不发布节省比例。下一步先离线设计跨任务固定样本与独立预算，handoff 继续延后。
