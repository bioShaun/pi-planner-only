# T2c 离线准备完成

Status: completed — 2026-09-27，独立验证与审查通过；仅离线准备，无新增付费试跑。

T2c 已明确空表来源列规则，新增独立边界测试并修正 gold。四次对照提案已冻结，可供下一步决定是否执行。原 T1/T2/T2b、原停止样本及原始证据保持不变。

## 已交付

- [T2c 任务定义](../../bench/tasks/T2c.json)与[提示词](../../bench/tasks/T2c.md)：仅“无 ALT 需求且宽表零行”允许缺来源列；空 policy 直接返回空表；需要 ALT 时即使零行也必须列齐；完整 schema 的零行表仅输出保留的 REF。
- 新 gold `c3dd01696b2757cbcb2055d26c1c5e4b38028c5d`：基于原 target，仅修正一行 guard，原有10项目标测试字节不变，新增44项独立测试。
- [完整任务源 bundle](task-source.bundle)、[还原说明](RESTORE.md)、[源码与任务冻结](freeze/)、[验证汇总](validation-summary.json)。外部生产仓库和 benchmark 运行器未修改，主仓库未提交。
- [独立审查](reviewer-result.txt)为 PASS (final)，[正式验收状态](acceptance.json)已接收。审查为 ordinary 独立审查，不声称宿主强制只读隔离。

## 验证结果

| 检查 | 结果 |
|---|---|
| 旧 gold 执行新增边界测试 | 14 failed、30 passed，精确暴露空表缺列问题 |
| parent 执行目标测试 | 预期 RED：缺少未实现的 stage 模块 |
| parent masked suite | 2652 passed，退出0 |
| 新 gold 原有10＋新增44项目标 | 54 passed，退出0 |
| 新 gold masked suite | 2652 passed，退出0，无新增失败 |
| 当前 bench 离线回归 | 35 tests，通过 |
| test:release | typecheck及五个套件全部通过 |
| 还原及隔离 | bundle refs一致；重建候选tree及测试字节一致；无remote/ref，原/new gold全长与短哈希不可达 |

完整运行证据在 [validation.ClpWPYWF](validation.ClpWPYWF/)。测试使用仓库外 TMPDIR、slot资源预检和排队；T2c完整验证安装 Landlock ABI7。首次包装器和host回归因沙箱无法写入外部临时目录而失败，原始失败保留；相同命令经授权重跑后通过，没有为通过而修测试或脚本。

T1 本轮未重跑套件。[复用记录](T1-reuse.json)核对了四份测试、gold补丁、baseline和评测入口与原冻结版本一致；沿用原有30项目标通过、masked基线13项失败由gold修复一项后剩12项的已执行结果，不宣称全量无失败。

## 待决定的四次执行提案

按预先固定种子排列：**T1 native → T1 lite → T2c lite → T2c native**。详细条件见 [spec](spec.md) 和 [plan.json](plan.json)。

使用相同 Opus Root/high、相同冻结child角色配置和中性委派前缀，strict/handoff关闭。最多四次、串行、不自动重试或补样本、无额外付费健康请求。建议新的 **$10 actual 运行间检查点**，单条3600秒；累计所有已尝试费用达到阈值即不启动下一条，非实时硬限额。旧轮费用单列，旧T2b不与T2c配对。

付费执行仍未授权，已启动次数为0。执行前需重新核对动态宿主/模型配置和所有冻结输入；任一质量、终态、计费、隔离或资源问题即停止。保留克隆及完整测试diff至归档、独立核对后再清理。这里交付执行提案，不自动启动四次试跑。

本轮证明的是离线任务定义与评测可复现性，不是新的模型收益或真实BLAST端到端结果。隔离验证针对Git对象，不等同于宿主文件系统禁止读取源仓库。handoff继续延期。
