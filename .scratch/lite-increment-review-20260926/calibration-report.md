# Opus 三臂校准：结果与执行违规

**三次任务质量与计费核验通过，但执行规程不通过，本轮不记作整体通过。**
三臂内部都出现了违反用户全局规则的硬编码 `/tmp` 写入；已归档并清理确认属于本轮的七个残留文件，两个临时目录已由原任务删除。清理不追认执行合规。

决定：**暂停新的付费试跑，先修复运行入口的临时目录约束。** 保留本轮全部费用和行为数据作为有明确限制的观察，不剔除违规样本、不重跑凑数。

## 任务与费用结果

| 臂 | 目标/基线验收 | 总费用（actual） | Root | child | wall 秒 | Root 轮数 | 首次实际委派所在轮 | 委派调用 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| direct | 通过 | $1.87451425 | $1.87451425 | $0.00000000 | 303 | 29 | — | 0 |
| native | 通过 | $1.13578547 | $1.10454325 | $0.03124222 | 548 | 14 | 10 | 2 |
| lite | 通过 | $0.72524549 | $0.70365475 | $0.02159074 | 379 | 11 | 6 | 2 |

累计 **$3.73554521**，低于新 $10 运行间检查点；最多三次已用完，剩余额度不自动用于新任务。
Root 配置为 tcuni-claude/claude-opus-5-5，high thinking 设置及 compaction 配置冻结；这些是请求配置，不是对供应商内部实现的独立证明。
child 为既有 Luna 配置；native 使用两次 worker，lite 使用 worker + validator（安装 agent 名为 oracle，属于正常映射）。
Root actual 价格表恰好等于 opus 权重，child 始终按实际模型价格，因此本轮 actual/opus 汇总一致。金额是用量乘冻结表价，不是结算凭证。
wall 为 Pi 执行时长，不含外层准备与最终评测；所有运行内追加工作、验证和返工均已计入。

三次均 Pi exit 0、目标 30 passed，masked suite 均保留同一 14 项已知失败。direct 为 1117 passed，native/lite 为 1116 passed。
独立证据核验确认了费用、终态、顺序及哈希；数值/质量 PASS 与规程 FAIL 分开记录，见 [核验记录](execution-20260926/independent-validation.txt)。

## 对校准问题的有限回答

在这一次目标 Root 观察中，native 首次实际委派发生在第 10 轮，lite 在第 6 轮；此前 cpass-ds 对应 native 为第 24/17 轮、lite 为第 16/15 轮。
两组时点都按启动事件与真实终态对应核对，管理查询和拒绝回执不算实际委派。
这支持“代理模型的行为不能仅靠价格重算代替目标 Root 校准”的判断。

本次 lite 的观测费用、Root 轮数及 wall 均低于 native，属于值得后续验证的增量线索；direct wall 仍最短。
但每臂仅一次，且实际追加工作不同：direct 添加回归和文档，native 包含第二次 worker 重构/验证，lite 使用 validator。
不能将差异全部归因于工具接口，也不能发布节省比例、稳定通过率或广泛产品收益。当前又有共同的运行规程缺口，付费扩样本应先暂停。

## 必须保留的质量细节

Direct 修改 tests/unit/test_compute_stages.py 是新增一个显式缺失 BED 目录的回归测试和 pytest import，没有删除既有断言。
记录顺序是先在修改后的实现上 9 项通过，再 stash 分类实现做故障注入，新增用例失败，然后恢复实现并完成最终评测；不把它写成测试先行开发。
目标三份冻结测试没有被纳入这次额外修改。原始补丁见 [测试改动证据](execution-20260926/attempt-1-test-change-evidence.json)。

Native 两次 worker 分别执行实现和追加小重构/基线验证，全部费用保留。Lite 两条委派均 completed；refused/detached/truncated 均为 0，本轮没有验证这些保护机制的事故收益。

## 运行规程失败与清理

| 臂 | 已确认的违规 |
|---|---|
| direct | 模型 Root 写入 /tmp/region_patch.py、/tmp/after.txt、/tmp/before.txt |
| native | 模型 Root 指示 worker 建立 /tmp/stab15-baseline 工作树；worker 实际创建并随后删除 |
| lite | 模型 Root 指示基线比较使用 /tmp；oracle 创建 /tmp/stab15_base、before/after 日志与列表；目录被删除，日志曾残留 |

运行入口设置了仓库外 TMPDIR，但这不能阻止模型及 child 使用硬编码绝对路径。外层执行没有可靠落实用户的全局禁止 /tmp 规则，这是本轮运行控制的缺口。
违规在三次结束后的 child 转录审查中被发现；之后没有发起新模型任务。现有 runcheck 的 valid 只覆盖其既有质量/计费证据检查，不能冒称它已经验证资源目录合规。

七个残留文件在删除前逐项核对创建命令、内容、时间、inode 和 SHA256，先归档到项目证据目录，再删除；共 87,524 字节。
两个临时目录已经由原任务移除。未动其他进程或无归属的 /tmp 文件。证据见 [路径扫描](execution-20260926/tmp-path-scan.json)、[清理清单](execution-20260926/tmp-cleanup-manifest.json)、[清理结果](execution-20260926/tmp-cleanup-result.json)、[归档文件](execution-20260926/recovered-tmp/)。
这些字节数只是发现时的文件残留，不代表执行期间峰值空间。

## 后续入口

先处理 [02：运行内临时目录约束](issues/02-runtime-temp-boundary.md)：对所有 arm 的 Root 与 child 使用相同资源约束，并验证硬编码路径会被拒绝；单设 TMPDIR 或一句提示不能宣称强制保护。
约束验证完成后再决定新的固定重复样本和预算。旧三次保留为存在协议违规的历史，不覆盖、不自动补跑，也不偷偷使用本轮未花完的预算。
handoff 仍无合适自然长会话与隔离恢复证据，继续延后；插件核心与保护机制不因本轮数据而删除或扩张。

证据入口：[逐次记录](execution-20260926/runs-log.md)、[actual](calibration-final-actual.json)、[opus](calibration-final-opus.json)、[24 个原始文件哈希](execution-20260926/all-runs.sha256.json)。原六次的 48 个文件哈希及本轮 22 项源码哈希均未漂移。

## 后续修复更新

[票 02 的共同入口修复](temp-guard-fix-20260926/report.md)现已通过 29 项回归、三臂 dry-run、完整发布检查和独立最终审查。
本报告中的历史规程 FAIL 保留，修复只约束后续运行；本轮没有补跑，未来样本需另定预算并重新冻结。
