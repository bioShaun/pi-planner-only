# Opus 目标 Root 校准执行记录

用户以“下一步”确认上一轮提出的三次 / $10 actual 运行间检查点预算，见 authorization.json。
独立 campaign，不混入此前六次样本费用。顺序 direct → native → lite，各一次，无健康请求、重试或 resume。
源配置、Root high thinking/compaction、child 配置及价格在 freeze/ 中保留，启动前与准备版本一致。

## 运行前

当前 14 项离线测试与完整发布测试已通过，源码哈希匹配，复用通过证据。
新独立 goldcheck 与隔离条件已通过，gold 克隆已清理，旧证据未覆盖。模型列表可见目标 Root 和 child；未请求付费健康检查。

## attempt 1：direct-opus-calibration

Pi exit 0、wall 303s、runcheck 有效；目标 30 项通过，masked suite 的 14 项失败与基线一致。
Root 29 轮、无委派、read 1、bash 27。新增非目标单元回归测试未弱化断言，已记录红绿验证；
额外文档/测试工作计入成本。单次及累计 actual = opus $1.87451425。
源码与原六次记录哈希不变，无 API 错误、悬挂调用或 stderr 输出。决定继续 native。

## attempt 2：native-opus-calibration

Pi exit 0、wall 548s、runcheck 有效；目标通过，masked suite 与原 14 项失败基线完全一致。
Root 14 轮，首次实际委派在第 10 轮；一次 capabilities 管理查询另记，不计实际委派。
两次 worker 调用均 exit 0，模型 tcuni/gpt-6-luna:medium；无嵌套或悬挂调用，stderr 为空。
单次 actual = opus $1.13578547，其中 Root $1.10454325、child $0.03124222。
两次累计 $3.01029972；源配置及原 48 个文件哈希不变。决定继续最后一次 lite。

## attempt 3：lite-opus-calibration

Pi exit 0、wall 379s、runcheck 有效；目标 30 passed，masked suite 与同一 14 项失败基线相符。
Root 11 轮，首次实际委派在第 6 轮，worker + validator 两次均 completed；validator 正常映射到 oracle。
单次 actual = opus $0.72524549（Root $0.70365475 + child $0.02159074）；三次累计 $3.73554521。
最多三次已用完，没有再发起模型任务。

## 结束后发现的共同规程违规

三臂原始命令及 child 转录均发现硬编码 /tmp 写入，违反用户规则。独立核验结论为：
任务质量与费用 PASS，执行规程 FAIL。当前 runcheck.valid 未覆盖这项规程，不能改写成整体通过。
Direct Root 写入脚本和结果列表；native worker 建立基线工作树；lite oracle 建立基线目录并写日志。
两个目录已由原任务删除；七个残留文件经内容/时间/命令/inode/hash 核实后，先归档再清理。已确认无本轮已知残留。
证据：tmp-path-scan.json、tmp-cleanup-manifest.json、tmp-cleanup-result.json、recovered-tmp/。
最终报告 ../calibration-report.md；所有新付费样本受 ../issues/02-runtime-temp-boundary.md 阻塞。
