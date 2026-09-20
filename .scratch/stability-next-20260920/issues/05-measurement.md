# 05 固定版本对照与读取政策

Status: ready-for-human
Blocked by: none for the token/completion/latency comparison
Completion: completed within the recorded build and small-task scope

用户最终指定 Root `tcuni-agy/gemini-3.8-flash-high` / child `tcuni-luna/gpt-5.6-luna`，thinking low；只比较 token、完成率和延迟，monetaryCost 全部 null。Kimi 配额 403 与 DeepSeek 上游错误的失败尝试保留，未混入 Gemini 的正式对照。

`study-run-yL4RzS` 固定 host 0.85.1 / launcher 0.69.0 / baseline 85bdd2a；三组 × 词数/JSON/小修改 × 三次重复，共 27 次。顺序在首个试验前写入 design.json，按 repetition/task 旋转；每次新建本地 session 和工作区，远端缓存不可控且如实统计。baseline 通过独立配置和公共 runtime-agent 注册字段固定 child 模型；旧版源码与工具定义不改。

| 组 | 完成 | Root + child 总 token | 延迟中位数 |
|---|---:|---:|---:|
| direct | 9/9 | 54,524 | 7.56 秒 |
| baseline | 9/9 | 815,498 | 35.59 秒 |
| optimized | 9/9 | 846,506 | 34.88 秒 |

总 token 包含 input、output、cacheRead、cacheWrite；不是价格加权费用。全部 usage 完整，20 个 child terminal 无失败，实际模型身份全部核验。延迟从 slot 提交至 host 退出，含可能的排队、启动、工具、quiescence 和 review。质量按最终答案、JSON 内容及修改范围验证，原始内容保存在 quality-audit.json；不等同真实项目交付质量。

结果不支持“优化委派整体更省 token”的结论，也不足以外推总体成本/延迟优势。原始事件、逐尝试 summary、汇总、文件快照、预检与前后哈希均保留。详细数据见 [study-summary](../study-run-yL4RzS/study-summary.md)，独立验证和最终源码差异见 [closeout](../execution-20260920/closeout.md)。本次测量早于最后的虚报声明校验补强，不能把测量哈希冒称最终哈希；该异常路径另有先失败后通过的回归与最终 release。

ADR-0008 将十分钟保留为操作默认值定稿，明确不宣称统计最优。20 个 child 的 launcher duration 最大 29,839ms，五分钟与十分钟对这组样本无法区分。插件自身时长、Request 剩余时间可见性与代表性长任务校准另列 [工单 07](07-execution-duration-and-request-remaining.md)。

Root 读取政策未放宽。Idle/live 共同的有界读取机制不在本轮实现；未来若要改变权限，需另有 CONTEXT/ADR、额度设计与相关对照证据。写入、通用 shell、Writer hold 和高风险复核边界保持原契约。

2026-09-20最终验收：完整release GJqscr、代码修正ed0kfI及收尾dihsWK通过；各自范围与原始证据见 ../execution-20260920/closeout.md。
