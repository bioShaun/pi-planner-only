# T2b 空表边界澄清

本记录不改写 T2/T2b、gold、目标测试或已停止样本。证据是 `boundary-check.py` 对不可变 target `46d408a34211bf39558430342abc97bc71e655f8` 与归档校准产物的离线函数调用，输出见 `boundary-check.json`。AST 只提取 fold 与常量，使用真实 pandas/枚举/异常；不等同 stage、CLI 或 BLAST 端到端验证。

| 非空 policy 输入 | gold | 归档校准产物 | 下一版本明确口径 |
|---|---|---|---|
| 无任何 ALT 需求，宽表零行零列 | REF | REF | 允许；仅保留 policy_keep 的 REF，pair_level 为 NA |
| 需要 ALT，宽表零行零列 | REF | ValidationError | 必须声明 13 个来源列，缺列报错 |
| 需要 ALT，完整 schema 的零行宽表 | REF | REF | 允许无配对记录，仅 REF，不虚构 ALT |
| 需要 ALT，零行且缺 alt_tm | REF | ValidationError | 缺列报错 |
| 宽表有数据行且缺 alt_tm（有/无 ALT 需求） | ValidationError | ValidationError | 始终检查全部 13 列 |

目标测试 `test_both_sides_ref_produces_no_alt_rows` 的 helper 对空列表实际返回零列表。因此“无条件检查 13 列”与既有目标测试冲突，不能把本次 supervisor 裁定认定为模型缺陷。gold 的全部零行豁免更宽；现有目标测试没有裁定“需 ALT＋空表缺列”，新增口径不能冒称旧 gold 已满足。

下一版本建议文字：空 policy 返回空表。非空 policy 中，只有“needs_alt 全假且宽表零行”允许缺少 ALT 来源列；其他情况均要求全部 13 个字面 alt_* 来源列，缺任一列抛 ValidationError。完整 schema 但零行表示没有配对记录，只保留 policy_keep 为真的 REF；ALT 仅由 needs_alt 且 pair_status=paired 的匹配记录产生。来源值逐列覆盖，三项 REF 脱靶事实置 NA；关联键与行序沿用原要求。

完整 fixture schema 共 22 列，除 13 个 alt_* 还包括 pair_id、target_id、probe_id、pair_status、allele_ref、allele_alt、allele_orientation、variant_offset_in_probe、pair_level；“13 列齐全”不是对非空表关联键的豁免。

执行决定：旧三条清单不续跑。若继续 REF/ALT 对照，使用新任务版本（建议 T2c），先增加上述独立边界用例并修正/验证新 gold，再同时冻结两臂相同提示词与验收；不得与旧 T2b native 配对。T1 可保留原定义，纳入新清单。新清单的预算、顺序及源码冻结待该准备完成后决定；本轮没有启动付费试跑。
