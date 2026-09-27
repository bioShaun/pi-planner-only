# T2c 两臂对照完成

Status: completed — 两次均有效且质量通过，独立证据核对通过；不追加模型试跑。
Campaign: opus-t2c-pair-20260927
Date: 2026-09-27

按用户“效果优先，但考虑预算”的选择，保留Opus Root与冻结Luna子角色配置，只执行T2c lite/native各一次。用户已明确允许任务相关源码、测试和工具输出发送到配置的模型接收端，见[授权记录](authorization.json)。原清单中的T1 lite未运行，原T1 native环境失败不补跑、不追认通过。

**本次lite费用与模型执行时间较低，两臂都达到冻结的质量门槛。** 这是一个任务、每臂一次的观察，不证明稳定节省或跨任务能力差异。当前建议保留已验证的最小委派核心，停止付费扩样本，不消耗剩余预算来凑更多次数。

## 结果

| 指标 | Lite | Native |
|---|---:|---:|
| 目标测试 | 54 passed | 54 passed |
| masked suite | 2654 passed | 2653 passed |
| 新增失败 | 0 | 0 |
| Root费用 | $1.08781875 | $1.40573175 |
| child费用 | $0.05186936 | $0.05340022 |
| 本条完整费用 | **$1.13968811** | **$1.45913197** |
| 模型执行耗时 | 759秒（12分39秒） | 1136秒（18分56秒） |
| Root完成事件 | 16 | 17 |
| 首次实际委派前完成事件 | 5 | 9 |
| 实际child | 2个worker＋1个oracle | 2个worker |

目标测试和suite均退出0；Pi和runner也均退出0。masked基线2652项，两臂分别增加2项和1项CLI测试，故总数不同；不是删掉失败或减少验收。原有54项目标文件均保持字节不变。

两条模型任务共 **$2.59882008**。加上此前T1环境失败的 **$1.29824603**，本轮计入预算的全部三次尝试累计 **$3.89706611**，低于$10运行间检查点。已到达缩减后两次新增尝试的上限，停止新增调用。没有自动重试、补样本或付费健康请求。

费用是记录用量乘冻结价格表，不是供应商结算凭证；离线修复、外层审核等不混入模型任务成本。模型耗时不含外部统一评测、slot排队与逐次审计等待。原T1保留原eval/STOP，只计已发生费用，不进入本次T2c配对。

## 行为与证据

两臂使用同一T2c任务、相同Opus high Root、相同运营者child配置和中性委派前缀，strict/handoff关闭。两个候选的初始tree均为 `32aa84a57baee303cb35d93d38dcb63d64c4e8a7`；commit ID因准备时间不同而不同，内容一致。

lite将stage/config与CLI/pipeline接线分成两个worker步骤，再用oracle验证。native由主要worker完成大部分工作，另有一个短worker修正；capabilities列表调用未算作委派。首次实际委派前的事件数按tool_execution_start之前已完成的assistant message_end计数，不含糊地称为“第几轮”。本次费用差主要在Root，child费用接近；这些观察不能单独建立工具界面或角色安排的因果结论。

独立源码检查确认两臂的CLI/config默认与覆盖、stage位于REF脱靶事实/特异性契约/self-hit检查之后且postprocessor之前、禁用/空输入恒等返回、blast_db前提、needs_alt过滤与helper/config/work_dir传递、ALT13来源覆盖及NA3处理、REF/ALT标识与行序、澄清后的空表规则。

两个新增非目标CLI测试文件均已人工复核并归档。lite覆盖正开关及TOML字段装配，native的一项测试覆盖默认关闭和正开关；负开关叠加true配置文件、流水线完整执行顺序仍以源码核对为证据，没有声称它们都有独立运行测试，更没有真实BLAST端到端结论。

实际记录的工具命令未发现受保护目标测试改写、gold引用、/tmp输出或slot绕过。两个克隆HEAD保持各自BASE，full/7位/12位gold提交不可达，无remote或refs。该检查证明Git对象隔离，不等同于宿主文件系统完全禁止访问原源库。Landlock为本地后代进程提供/tmp写入保护，不外推到已有外部服务。

## 归档与收尾

- [逐条结果与总额](results.json)、[最终停止继续决定](after-attempt-2.json)、[完成状态](completion.json)。
- [Lite独立核对](attempt-1-independent-validation.json)、[Native独立核对](attempt-2-independent-validation.json)；这是实际运行证据验证，不是发布级代码审查或严格只读隔离声明。
- [Lite完整diff和文件](evidence/T2c-lite-opus-calibration-1/manifest.json)、[Native完整diff和文件](evidence/T2c-native-opus-calibration-1/manifest.json)；两份克隆保留，未提交到原源码仓库。
- [全部原始文件哈希](all-raw.sha256.json)覆盖23份campaign/run/native终态产物；[最终完整性](final-integrity.json)确认11份入口、82份源码和161份历史文件无漂移。五个child的转录和用量均已归档并核对。

后续若要发布稳定收益结论，需要另定跨任务样本与预算；本轮不再扩展。handoff仍等待自然长会话与同检查点隔离恢复证据。
