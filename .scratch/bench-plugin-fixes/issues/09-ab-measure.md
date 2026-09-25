# 09：A/B 测量

Status: ready-for-human (paused 2026-09-25: maintainer asked to hold testing)
Type: task
Blocked by: 01, 02, 03, 04, 05, 06

用 cpass-ds 做 Root，对比 `297b065` 和修复后的 HEAD。任务用 T2、T3（和 08 的新任务），每格至少重复 6 次。
主要看 refused、detached、truncated、root_reads、root_cache_read，其次看费用和通过率。受 ClinePass 额度限制。

## Comments

- 2026-09-25 冒烟测试：campaign `smoke-head-t3`，T3 × `lite-pds-strict-head` × 1。插件被冻结在 a59588e，运行结果 pass，runcheck 判为有效，费用 $0.92（按 opus 价）。机制指标：refused=0、detached=0、truncated=1/6、Root 读文件 12 次。
  explorer 报告仍有 6063 和 6159 字符，超过了 3000 的要求。scout 自己的系统提示规定了一套较长的输出格式（Files Retrieved/Key Code/Architecture/Start Here），任务文本里的长度要求没压住它。A/B 时重点看这项；如果效果不明显，下一步可以改写 explorer 的结尾说明，或者换一个输出格式更短的 agent。
- 待维护者确认后再启动（会消耗 ClinePass 额度，约 4–5 小时）：
  `bench/campaign.sh ab-head-vs-297 6 T1,T2,T3 lite-pds-strict,lite-pds-strict-head,direct-pds --parallel 3`
  共 54 条 run。汇总命令：`python3 bench/summarize.py .../ab-head-vs-297/runs --baseline lite-pds-strict --metric <cost|root_cache_read|root_reads|truncated|refused|detached>`。
- 2026-09-25 方向评估（[§2.4、§4 第三/四步](../../../docs/lite-direction-review-2026-09-25.md)）补充计划，票仍暂停，未启动任何付费运行：
  - 一次只回答一个问题：先验证当前修复是否减少返工和总成本；handoff 另做长会话实验，不放进本票。
  - 加第三臂 **native**：原生 pi-subagents，加一句"实现交给子代理"的指引，不加载本插件。09-24 的 lite 提示词本身就带这句话，这一臂用来隔离插件在指引之外的贡献，回答插件有没有存在理由。需要先在 bench 里支持该模式（run.sh 加载方式、runcheck 与机制指标对 `subagent` 工具的口径），再定任务与次数。
  - 固定日常回归模型（cpass-ds），少量目标 Root 实测用于校准；不扩大到全部模型和全部组合。
  - 09-24 的 0.48 降级为历史参考；"lite 相对 direct 省多少"等本票用干净克隆重跑后再写。
