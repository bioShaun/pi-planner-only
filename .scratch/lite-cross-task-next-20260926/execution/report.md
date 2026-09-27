# 跨任务试跑停止报告

Status: stopped — 第 1/4 条结束，独立核对确认停止条件成立
Campaign: opus-cross-task-t1-t2b-20260926
Execution date: 2026-09-26 至 2026-09-27（Asia/Shanghai）

已按冻结规则停在第一条 **T2b native**，其余 T2b lite、T1 lite、T1 native 均未启动。原因是 native worker 经 intercom 暂时脱离后，当前主转录没有可供计费守卫使用的完整终态回执。没有重试、补样本或修改冻结的 bench/插件源码。

## 任务结果与费用

| 项目 | 结果 |
|---|---|
| Pi / runner 退出 | 0 / 4（计费有效性守卫停止） |
| 统一目标测试 | 10 passed |
| masked suite | 2654 passed，0 failed，退出 0；比原基线多两项新增测试 |
| 原始有效性 | valid=false：failed child result、nonterminal child result |
| 冻结汇总器完整费用 | 未知（null）；已知费用下界为 Root $1.80496475 |
| 产物辅助核算 | Root $1.80496475 + child $0.08401762 = **$1.88898237** |
| Root / child | 22 个 Root 完成事件；两个 worker，第二个承担返工 |
| 首次委派前完成事件 | 11 |
| 模型执行耗时 | 1384 秒，不含外部统一评测 |

产物辅助核算使用 Root 原始用量和两个 child 的最终完整转录/metadata，按冻结 actual 价格计算，不将中间累计快照再相加。该数不冒充供应商账单，也不把原始无效运行改成有效样本；原始 eval、STOP 和汇总结果保留。

## 停止原因

第二个 worker 请求 Root 解决实现决策，native 工具先返回 `exitCode=-2, detached=true` 和 partial usage。Root 回复后，bg_wait 返回空的 management results；最终完成通知只含文字报告和 session 路径。最终 child 文件确有 exit 0、完整用量，但冻结解析器只从主事件结果收集数据，仍保留中间非终态并拒绝完整总额。

因此这是尚未覆盖的终态采集/计费路径，不能仅凭测试通过或完成通知放行下一次。修复方向见 [票 03](../issues/03-native-intercom-terminal-evidence.md)。

## 已保存的证据与待核对项

- 原始 runs、campaign 和 STOP 共十个文件已哈希；两个 child 的完整产物已复制归档。
- 克隆经独立核对及逐文件归档校验后已清理，原始 runs/child 产物保留。完整 tracked diff、两个未跟踪新文件、变更测试及 BASE 版本均已归档到 evidence/T2b-native-opus-calibration-1/；HEAD 与 BASE 一致。
- 临时目录保护为 Landlock ABI 7。独立命令核对只见 `/tmp` 禁止说明或引用，未见以该路径输出或绕出本地保护的 daemon/slot 调用。
- 三项必需判断分开：统一测试已通过；T2b 附加链路审查通过（源码级，不等同真实 BLAST 端到端）；冻结计费有效性失败。没有用测试通过替代计费有效性。
- 独立核对确认“无 ALT 且空宽表”的目标测试和 gold 允许返回 REF 行，原提示词的无条件 13 列要求存在边界歧义。模型按 supervisor 裁定保留测试行为，不认定为模型缺陷。见 [票 04](../issues/04-t2-no-alt-contract-wording.md)，原任务和本次结果不改写。

下一步先解决终态证据采集并离线验证，澄清任务边界后再决定剩余清单；不直接运行剩余三条，不发布配对费用或节省比例。

证据：[逐次审计](attempt-1-audit.json)、[冻结汇总](after-1-actual.json)、[产物辅助费用](artifact-cost-reconciliation.json)、[child 核对](attempt-1-children.json)、[原始文件哈希](all-raw.sha256.json)、[停止决策](after-attempt-1.json)。

[独立核对](independent-validation.txt)确认上述测试、接线、辅助费用与停跑决定；78 个冻结源码文件、96 个历史原始文件及本轮十个原始文件均未漂移。该轮只有一个无效样本，不具备任何 native/lite 配对结论。
