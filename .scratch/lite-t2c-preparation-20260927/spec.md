# T2c 离线准备与下一轮配对方案

Status: prepared — 离线验证已完成；独立验收以 acceptance.json 为准。付费执行未授权。

本轮明确 T2c 的空表来源列规则，补充独立测试和修正 gold，复核候选隔离及可还原性，形成四次运行的固定提案。原 T2/T2b、停止样本及历史原始文件只读保留。

## 任务定义

T2c 沿用原 parent `a131527abe53dc8a55a45e3ccb88f8ad7ef24a4b`，在独立任务源仓库中以原 target `46d408a34211bf39558430342abc97bc71e655f8` 为基础，生成新 gold `c3dd01696b2757cbcb2055d26c1c5e4b38028c5d`。gold 代码仅修正一行来源列检查；增加独立 contract 测试文件，原 10 项目标测试保持字节不变。源仓库通过 `task-source.bundle` 还原，不修改外部生产仓库或 benchmark 运行器。

边界：空 policy 直接返回空表；非空 policy 只有“无任何 needs_alt=True 且宽表零行”可以缺 ALT 来源列。需要 ALT 时，空表也必须声明全部 13 个字面来源列。宽表有数据行时，无论是否需要 ALT 都检查全部 13 列。声明完整 schema 但零行时，仅保留 policy_keep 的 REF，pair_level 为 NA，不虚构 ALT。

该版本只修正 schema 边界，不扩展对不一致上游输入的额外约束，例如人工构造 needs_alt=False 却带 paired 宽表记录。正常 stage 仅对 needs_alt 行调用既有配对流程。T2c 的附加链路验收沿用 T2b，仍须核对 CLI/config 默认关闭与 override、stage 的真实执行顺序、禁用/空输入恒等返回、启用时 blast_db 前提、现有 helper/config/work_dir 传递、ALT13 覆盖与三项脱靶事实置 NA。单文件测试不替代这些检查，也不声称真实 BLAST 端到端。

T1 定义不变。其四份目标测试、gold diff、baseline、prepare/evaluate/temp guard 与已通过的冻结版本逐字节比对；复用上轮已执行结果，不冒称本轮重跑。目标 30 项通过，parent masked 有 13 项既有失败，gold 修复其中一项超时失败而剩 12 项；仍按零新增失败验收。

## 唯一拟议执行清单

campaign `opus-cross-task-t1-t2c-20260927`；SHA256 名称的前 16 个十六进制字符形成种子 `8682094810793768254`。依次 shuffle 任务和首对臂顺序，第二个任务反转臂顺序。结果在模型运行前固定，不因结果重排。

| 次序 | 任务 | 臂 |
|---|---|---|
| 1 | T1 | native-opus-calibration |
| 2 | T1 | lite-opus-calibration |
| 3 | T2c | lite-opus-calibration |
| 4 | T2c | native-opus-calibration |

Root `tcuni-claude/claude-opus-5-5`，thinking high；child 使用相同的冻结角色配置：worker/scout/oracle/reviewer 为 Luna，其他角色覆盖及 thinking 见 freeze/child-config.json。插件 `ad51067da379edf5735cb9b03d70f17bda331675`；strict=0、handoff=off。native/lite 使用相同中性委派前缀及相同资源保护。完整配置和当前 bench 源码另行冻结；执行前重新核对实际宿主、模型可用性、配置和哈希，漂移时先重订冻结，不自动换模型。

最多四次尝试，串行、每条一次，无自动 retry/resume、无补样本、无付费健康请求。建议新一轮独立 **$10 actual 运行间检查点**：累计所有已发生尝试达到阈值即不启动下一条；不是实时硬限额。单条沿用 3600 秒时限；旧轮支出另列，不抵扣也不借用旧余额。本提案不包含付费执行授权。

## 逐条停止与证据

只有上一条质量、终态、模型/完整费用和资源约束全部核对通过，才能启动下一条。任何 API、质量、隔离、终态、计费或证据缺口即停止；保留失败并计入消耗。嵌套委派仍不能完整计价，遇到即停。

每条必须从公共 `bench/run.sh` 进入；先保存并检查 slot audit/status，再经 slot cpu。TMPDIR/TMP/TEMP 使用每条独立的 `/project/tmp` 目录，保留 Landlock 保护。`BENCH_MAX_ATTEMPTS=1`、`BENCH_ATTEMPT=1`、`BENCH_SKIP_HEALTH=1`、`BENCH_KEEP_CLONE=1`。完整 diff（含未跟踪内容、改动测试及 BASE 版本）、原始事件、child 转录及冻结 native-evidence 归档并独立核对后，才清理本轮克隆。采集失败时也保留克隆与诊断。

需明确核对 test 进程退出码和收集/通过数，不能仅信 `eval.pass`；T2c 目标为 54 项通过，masked suite 要求退出 0 且无新增失败。候选 Git 历史中原/new gold 或额外 testRefs 提交不可达（全长及短哈希均检查），无 remotes 或额外 refs；parent 历史是合法输入。这是 Git 对象隔离，不声称整个宿主文件系统禁止读取源仓库。测试源由冻结任务定义注入。

只有同任务、同版本两臂均有效合格时才列完整配对费用。旧 T2b native 仍是历史无效样本，不与新 T2c 混算。四次只是跨任务探测，不发布稳定节省比例或泛化排名；准备/审核成本与模型任务费用分列。handoff 仍延期。

## 离线验收

1. 旧 gold 在新增测试上有精确 RED；新 gold 的原有10与新增44合计54项通过。
2. 隔离候选 parent 目标因未实现 stage 而 RED，parent masked baseline 2652 项通过；应用新 gold 后统一目标54和masked2652均通过、退出0。
3. bundle 完整可还原，refs 与固定 commit 一致；还原出的候选树及目标测试与原源准备结果一致。
4. 当前 bench 35项离线回归与完整 test:release 通过，使用仓库外 TMPDIR；独立审查通过；旧任务与原始运行哈希不变。

全部离线结果就绪后才将状态记为 offline-ready，并交付待决定的四次执行提案。本轮不启动 Pi 模型任务。
