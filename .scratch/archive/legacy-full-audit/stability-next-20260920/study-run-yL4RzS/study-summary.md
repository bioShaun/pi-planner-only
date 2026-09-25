# P3 token、完成率与延迟

Root: tcuni-agy/gemini-3.8-flash-high; child: tcuni-luna/gpt-5.6-luna; thinking: low.

三组 × 词数、JSON、小修改 × 三次重复；预先固定交错顺序，27 次全部保留。

| 组 | 完成 | 总 token | 每次完成 token | 延迟中位数（秒） | 失败 child 尝试 |
|---|---:|---:|---:|---:|---:|
| direct | 9/9 | 54524 | 6058 | 7.56 | 0 |
| baseline | 9/9 | 815498 | 90611 | 35.59 | 0 |
| optimized | 9/9 | 846506 | 94056 | 34.88 | 0 |

总 token 为 Root + child 的 input/output/cacheRead/cacheWrite 之和，包含失败尝试；缓存分量和逐尝试明细在 JSON 中。没有按价格加权，monetaryCost 全部为 null。

From slot submission through host process exit; includes any queue, startup, model/tool work and plugin quiescence/review. Not pure provider latency.

Private agentOverrides for builtins; public runtime-agent-register:v1 model/thinking fields for planner-scout, applied before launcher. Baseline source and tools unchanged.

每次创建独立本地 session 和工作区；远端缓存不可控，按返回 usage 如实记录。最终文件快照及重新计算的质量结果在 quality-audit.json。这里的完成率验证答案、JSON 内容和文件范围，不等同真实项目交付质量。

这组小任务只能描述当前配置。它不证明十分钟优于五分钟，也不支持直接扩展 Root 的读取或写入政策。

| 任务 | 组 | 完成 | 总 token | 延迟中位数（秒） |
|---|---|---:|---:|---:|
| count | direct | 3/3 | 15449 | 5.36 |
| count | baseline | 3/3 | 233957 | 35.59 |
| count | optimized | 3/3 | 267271 | 34.58 |
| json | direct | 3/3 | 10175 | 5.39 |
| json | baseline | 3/3 | 174626 | 24.16 |
| json | optimized | 3/3 | 200876 | 34.48 |
| edit | direct | 3/3 | 28900 | 11.87 |
| edit | baseline | 3/3 | 406915 | 65.90 |
| edit | optimized | 3/3 | 378359 | 60.99 |
