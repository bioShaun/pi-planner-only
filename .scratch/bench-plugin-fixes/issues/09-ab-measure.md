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
