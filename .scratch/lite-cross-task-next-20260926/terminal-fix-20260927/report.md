# 终态采集修复与离线重算

Status: completed — 独立审查 PASS (final)，2026-09-27。

票 03 的终态采集与离线重算已完成；票 04 的空表边界已澄清。原停止报告、票据要求、原始 eval/STOP 与冻结证据均保留，本目录的 [completion.json](completion.json) 记录本轮后续状态。没有启动新的付费试跑。

## 修复及核算

native runner 在有效性检查前复制并冻结主转录所声明的 child metadata 和完整 transcript；冻结包绑定主转录哈希、实际 runId/index、agent、文件名和来源路径。解析时核对完整 token 累计、模型、终态及嵌套委派。detached 中间累计用量由同次 run 的可靠终态替换，不重复相加；不同 run 分别计费。缺身份/产物、文件变动、冲突、失败、未完成或未知模型不放行。

runcheck 与汇总共用模型名称/后缀解析，防止“有效但无法定价”。采集失败保留诊断并停止 runner。改动位于 `bench/native_results.py`、`runcheck.py`、`summarize.py`、`run-body.sh`、`test_native.py` 和 `README.md`，本轮未修改插件源码。

| 项目 | 冻结 actual 价格下的离线重算 |
|---|---:|
| Root | $1.80496475 |
| 两个 child | $0.08401762 |
| 已发生合计 | **$1.88898237** |

[独立输出](offline-reprice.json) 将费用计入 attempt_spend，但保留历史 `valid=false`，`runs` 为空，不生成配对或节省比例。新解析器能够核实费用，不追认旧冻结采集流程有效。价格表与原冻结版本一致；10 份原始运行文件和 96 份历史文件哈希均未改变。

## T2b 边界与续跑决定

[边界记录](t2-boundary.md) 与 [12 个离线调用结果](boundary-check.json) 确认：无 ALT 需求且宽表零行零列时应返回 REF。需要 ALT 且空表缺列时，旧 gold 返回 REF，校准产物报错，旧目标测试没有覆盖这一分歧。完整 schema 的零行表，两者都只返回 REF、不虚构 ALT。

下一版本明确为：仅“needs_alt 全假且宽表零行”允许缺 ALT 来源列；其他情况要求 13 个字面来源列齐全；完整 schema 但没有配对记录时仅保留 REF。该口径需要新任务版本及独立边界测试，不能直接沿用旧 gold 并宣称一致。

**旧三条清单不续跑。** 若继续，先准备并冻结新版本 T2c 的提示词、边界测试与修正 gold，再让 native/lite 两臂使用同一定义；T1 可保留原任务定义进入新执行清单。不能以新 T2c lite 配旧 T2b native。新清单的顺序、预算和执行决定留待该准备完成后制定，本轮不借用旧清单启动运行。

## 验证与限制

- 原始归档直接重放可复现 `total=None`；修复后完整核算，故障注入保留 red/green 证据。
- 35 项 native 离线测试通过，`npm run test:release` 通过；后者经 slot cpu，TMPDIR 为仓库外 `/project/tmp/ppo-terminal-fix-20260927`，资源预检已归档。最终命令和退出状态见 [final-validation.json](final-validation.json)。
- 两轮审查要求修正身份缺失、模型后缀和 agent 归属；第三位 fresh reviewer 独立核对 48 个冻结文件、原始哈希、金额和 12 个边界调用后给出 [PASS (final)](reviewer-result-3.txt)。[验收状态](acceptance.json) 已通过契约工具接收。
- 审查为 ordinary 独立审查，不声称宿主强制只读隔离。测试套件由实现者执行，审查者读取日志并独立运行只读核算/边界探针。边界矩阵只覆盖提取的 fold 函数，不代表 stage/CLI/BLAST 端到端；新采集入口尚无新增真实模型试跑。

本轮所有冻结审查输入保持不变；旧票据正文中的状态属于修复前归档要求，当前完成情况以本报告及 completion.json 为准。
