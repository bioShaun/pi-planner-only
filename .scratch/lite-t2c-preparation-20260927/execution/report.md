# 四次对照停止报告

Status: stopped — 第1条结束后触发质量门槛；独立核对确认停止决定，剩余3条未启动。
Campaign: opus-cross-task-t1-t2c-20260927
Date: 2026-09-27

用户在离线准备交付后要求“下一步”，本轮按已冻结四次／$10 actual运行间检查点方案推进，实际只执行 **T1 native** 一次。没有重试、补样本、付费健康请求或人工修复产物。原准备记录保持不变，执行授权另存于 [authorization.json](authorization.json) 和 [plan.json](plan.json)。

## 结果与费用

| 项目 | 结果 |
|---|---|
| Pi / runner退出 | 0 / 0；不等于质量验收通过 |
| 统一目标测试 | 30 passed，退出0 |
| masked suite | 1093 passed、30 failed，退出1 |
| 与冻结基线比较 | 保留12项既有失败；修复1项既有超时失败；新增18项失败 |
| 计费与终态 | 有效、完整；3个worker均终态退出0 |
| Root费用 | $1.27002325 |
| 3个child费用 | $0.02822278 |
| 已发生合计 | **$1.29824603** |
| 模型执行耗时 | 609秒，不含外部评测与审核 |
| Root完成事件 / 首次委派前事件 | 19 / 11 |

费用按冻结actual价格计算，包含三轮worker及返工，不冒充供应商账单。已低于$10检查点，但质量门槛先触发停止。原始 `eval.pass=false` 和 `eval.valid=true` 分别代表质量失败与计费有效，不混为一个结论。Root写入了[停止决策](after-attempt-1.json)及campaign STOP；T1 lite、T2c lite、T2c native均未启动。

## 新增失败的解释

独立核对发现，18个新增失败节点在worker的未改源码对照中**也全部失败**，共同堆栈包含 `OSError: AF_UNIX path too long`，继而导致pandarallel worker的 `EOFError`。本次TMPDIR字符串已有83字符，multiprocessing还会追加socket目录和文件名。这支持环境路径长度问题，不能据此将18项全部归为模型实现退化。

对照日志和关联结果已复制到 [environment-evidence](environment-evidence/reconciliation.json)。worker的 `before2.log` 是完整套件对照，不是同口径的统一masked评测；本轮只核对18个失败节点与错误堆栈，不直接比较该对照的总失败数。尚未在短路径环境重跑，因此不追认本次质量PASS、不放行剩余三条。

下一步应先在隔离副本中，使用短且仍位于 `/project/tmp` 的TMPDIR，对未改源码和本次产物分别离线复验，确认环境因素并检查是否还剩真正新增失败。原始运行、费用、STOP和产物只读保留。见[后续票](../issues/01-t1-socket-path-limit.md)。

## 证据与限制

- [逐次审计](attempt-1-audit.json)、[完整费用汇总](after-1-actual.json)、[child终态关联](attempt-1-children.json)。当前native冻结产物采集在这次三条正常完成路径通过；本条没有新的detached/intercom恢复场景。
- [完整克隆归档](evidence/T1-native-opus-calibration-1/manifest.json)保留六个改动文件、全部before/after及binary diff，HEAD与BASE一致，无未跟踪文件；四个目标测试字节保持不变。克隆仍保留，便于后续隔离复现。
- [独立核对](independent-validation.txt)确认计费、测试、环境线索与停跑决定。审查命令未发现实际 `/tmp` 输出或slot绕过；文本中的 `/tmp` 为禁止指引。Landlock保护为本地后代进程范围，不外推到全机或外部服务。
- [原始文件哈希](all-raw.sha256.json)覆盖18个新文件（含STOP及7个native-evidence文件）；82个冻结源码、106个历史文件和10个入口文件未漂移。
- 本轮只有一个计费有效但未通过质量门槛的尝试，没有native/lite配对结果，不发布节省比例或任务能力排序。
