# Lite 增量价值复核（2026-09-26）

> 本文是校准前的离线分析。三次现已执行，结果及 /tmp 规程失败见 [校准报告](calibration-report.md)；后续付费工作暂停。

结论：保留现有委派核心与保护机制，暂停继续堆叠 cpass-ds 样本。下一项有信息价值的验证是目标 Root 的最小三臂校准。
六次 T3 说明了测量链路可用；它们没有稳定证明 lite 的成本增量，也没有测试出取消或写锁在真实事故中的收益。
本次仅分析既有证据和准备配置，没有发起新的付费 benchmark。

## 现有轨迹比均值更值得关注

| 运行 | 首次实际委派所在 Root 轮 / 总轮数 | 截至该轮 Root 费用（opus） | 全部 Root 费用（opus） | Root edit/write 调用数 |
|---|---:|---:|---:|---:|
| T3-native-pds-1 | 24 / 39 | $1.280990 | $2.227005 | 0 |
| T3-native-pds-2 | 17 / 27 | $0.958029 | $1.421500 | 2 |
| T3-lite-pds-head-1 | 16 / 47 | $0.709020 | $2.324219 | 7 |
| T3-lite-pds-head-2 | 15 / 19 | $0.844325 | $1.058234 | 0 |

“截至该轮”包含发起委派本身的那轮，不是纯阅读成本，也不是可直接删除的开销。native 的 capabilities 管理查询不算实际委派。
四条委派臂都在 Root 第 15–24 轮才发起首个子任务。两次 direct 全任务只有 24/25 轮。
这使“目标 Root 是否也先自行做大量调查”成为比继续跑相同替身模型更有价值的问题。

lite-1 的 bash/read 终端返回文本分别为 98,886/22,679 字符，delegate 为 11,612 字符；
lite-2 分别为 85,695/9,254 与 3,459 字符，另有 git_audit 摘要。
这些是每条 tool_execution_end 的文本字符数，只计一次，不是 token 或费用，也不能估算每轮上下文实际重复量。
它们支持优先检查 Root 自身的信息获取，而不是继续缩短已经不长的 child 报告。

lite-1 有 worker/validator/reviewer/validator 四次调用，lite-2 只有 worker/validator 两次；
lite-1 的 Root 另有七次 edit 调用，其中一次失败，包括 benchmark fixture 的额外处理。
从首次 benchmark edit（第 41 轮）到结束的 Root 费用为 $0.386277，但这包含正常收尾检查，不能全归因于 fixture 修改，也不能从原费用中扣除。
因此不能仅靠工具定义长度解释两次 lite 的差异，也不应据此强化固定多角色流程。

计算脚本与逐运行数据见 [analyze.py](analyze.py)、[behavior.json](behavior.json)。计价复用冻结表价，逐轮加总与原汇总的 Root 费用一致；原始 48 个文件未改写。

## 插件实际增加了什么

| 能力 | 归属与限制 | 本轮能支持的结论 |
|---|---|---|
| 小接口和角色收口 | lite 把调用收敛到 role/task/cwd，隐藏原生大工具面并附角色说明；模型来自运营者配置 | 确有接口区别，但不能直接换算为节省 |
| 取消和 wall timeout | 底层由原生 structured delegation 提供；lite 负责转发取消及处理回执 | 不能把完整取消能力当作插件独有收益 |
| 同 cwd 写入排斥 | lite 按 Git root/规范化 cwd 持锁；未确认停止时保留锁，晚到终态再释放 | 是真实附加行为；本轮无触发，不等于可以删除 |
| token 上限 | lite 按 progress update 观察消耗后发取消 | 不是硬 token 或实时金额限额 |
| 摘要和失败恢复 | lite 附 Git 摘要、报告长度要求、裁剪和失败 transcript 尾部；状态/用量来自宿主 | 本轮没有截断或未确认停止，收益未被真实样本触发 |

原生 public subagent 的 single-dispatch guard 与 lite 写锁并不等价：public guard 拒绝正在进行中的另一调用；
structured delegation 走 executeDelegated → execute，桥接层主要检查请求/节点身份重复。不能因为 native 曾拒绝重复调用就认定 lite 的 cwd 锁重复。
上述行为已有确定性测试；它们证明机制契约，不能替代产品收益证据。

源码对照见 [mechanism-evidence.md](mechanism-evidence.md)。本轮不删保护机制、不加新角色、不改默认 strict/handoff。

## 选择下一步

推荐一个独立预算的目标 Root 校准：Opus 同一 T3，direct/native/非 strict lite 各一次，保留现有中性指引和相同 child 配置。
只回答：目标 Root 的前置自查、委派选择和验收路径，是否与 cpass-ds 的轨迹明显不同；插件是否出现值得进一步验证的独特帮助。

若三臂均通过但 lite 相对 native 仍没有可解释的增量，停止扩大成本收益实验，保留已验证的最小核心与保护机制；
若目标 Root 行为明显不同或出现明确增量线索，再单独设计固定扩样本，不能把这组三个结果当作收益证明。
质量、API、计费或证据出现缺口则停在当前尝试，不自动重试。handoff 仍等待自然长会话与恢复隔离证明。

[具体校准方案](spec.md) 已备好；新预算尚待确认，不能沿用已完成六次试跑的剩余额度。
