# 05 固定版本对照与读取政策

Status: ready-for-agent
Blocked by: actual-provider measurements

固定版本、模型与质量要求，比较隔离环境直接 Root、当前委派与 P1 优化委派。逐尝试保留 Root/child usage、失败重试、延迟和完成率，价格未知时不报费用节省。先跑小型有界任务组，保留异常样本，再决定是否扩大。

有界 Root 读取需以单次输出、Request 累计字节、连续探索数统一约束 Idle/live，不能通过新 Task 或改措辞刷新。仅当与真实廉价 child 对照支持时再决定默认政策；写入、通用 shell、Writer hold 与高风险复核不放宽。政策决定必须有 CONTEXT/ADR 和验证证据。

Completion: partial — 一个真实 optimized smoke 和一个真实 TUI 场景已通过；三组完整对照、价格、默认值校准与读取政策决策待办。

run-study.mjs 固定 baseline=85bdd2a、host=0.85.1、launcher=0.69.0；三组×词数/JSON/小修改，逐失败尝试保留 usage，未知价格 null，模型配置必填。study-summary.test.mjs exit 0 验证失败计费、terminal 去重、missing usage 与 child CANCEL 不等于 Root closure。JS 语法/Python AST 通过；未声称完整 harness 已运行。

单格一个样本只用于 smoke。正式成本决策还需预先固定交错顺序/重复次数、缓存条件与实际价格，再比较质量、成功率、总 token/费用/延迟。Idle/live 共用有界读取预算尚未实现，须由上述结果支持单独政策决策；当前严格读取规则未放开。

## Comments

2026-09-20：study-run-D1Lacq/ 与 study-run-g9NOIF/ 已保留真实 Kimi/Luna 的 usage、身份和成功/取消尝试。未运行三组九格对照；monetaryCost 仍为 null。ADR-0008 的十分钟默认值保持 provisional，启动时间/耗时口径、Request 剩余时间可见性及三项联合校准仍待实施。
