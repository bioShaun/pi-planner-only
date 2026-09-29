# 第 2 轮报告：worker 思考强度 medium 对 high（2026-09-29）

只改一个变量：worker（Luna）的 thinking，medium 对 high。其余相同：新 prompt（3f58416）、Root 用 deepseek-v4.1-flash、strict、handoff=off。这一点已用两组 run 的 `meta.json` 中 `childOverrides` 核对。除 `worker.thinking` 外，其余 override（reviewer=high、oracle/scout=low 等）完全一致。

## 覆盖范围和局限

- 任务：T3（修复单个行为）和 T2b（跨文件集成）。每个格子只有 **n=1**。
- 只能用来发现明显差别，不能证明"没有差别"。
- 没有 T2（需要先探索）和"机械批量修改"的数据，原因同第 1 轮。
- 每组内 T3 和 T2b 是两条 lane 并行跑的。耗时可能受同时运行的影响，不宜精确比较。
- 之前的 effort 探测（`effort-check.log`）显示，Luna 的 effort 设置与实际推理量没有稳定关系。所以"high"是否真的让 worker 推理更多，未经验证。

## 结果

| run | 结果 | 总花费 | Root 花费 | 子 agent 花费 | 总耗时 | Root 轮数 | 委派数 |
|---|---|---|---|---|---|---|---|
| r2m T3 | pass | $0.0599 | $0.0364 | $0.0235 | 436s | 13 | 4 |
| r2h T3 | pass | $0.0762 | $0.0410 | $0.0352 | 562s | 14 | 5 |
| r2m T2b | pass | $0.1619 | $0.0827 | $0.0792 | 1523s | 19 | 7 |
| r2h T2b | pass | $0.1598 | $0.0896 | $0.0702 | 1583s | 23 | 7 |

本轮花费：medium $0.2218，high $0.2361。4 个 run 全部通过，没有网关报错，也没有触发 STOP。

## 观察

- **T3**：high 花费高约 27%，耗时长约 29%。其中一半来自子 agent 花费上升（$0.0235 到 $0.0352），另一半来自多 1 次委派。
- **T2b**：两者相差不到 2%（$0.1619 对 $0.1598）。high 的子 agent 花费略低，Root 花费略高，Root 多了 4 轮。
- **合计**：high 比 medium 高约 6%。这个差别在噪声范围内，尤其 n=1，不宜解读为趋势。
- **没有质量收益**：两边都一次通过，没有 high 换来更好结果的证据。
- **"truncated"计数**（medium 1、high 3）：统计口径是 delegate 返回文本里含 "chars omitted" 的次数，即 Root 看到的子 agent 报告被截短。T3 两边都是 0，全部出现在 T2b。原始 jsonl 里 "chars omitted" 字样 medium 出现 5 次、high 出现 15 次，多于汇总计数，我猜是被截短的文本在后续轮次的上下文里重复出现，未逐条核对。这是工具输出被截短，不是模型输出被截断，也不代表内容丢失。high 的报告更长、被截短更多，这与"high 写得更详细"一致，但无法在此判断是否有好处。

## 结论

1. 在这两个任务上，high 没有比 medium 更好：通过率相同，花费不低于 medium。
2. 没有理由把 worker 默认改成 high。保持 medium。
3. 由于 n=1 且 effort 与推理量的关系不稳定，这只是"没看出差别"，不是"确认无差别"。

## 补充：T2（需要先探索）的 base 对 treat（rdt-r2t）

**这一节回答的是第 1 轮缺的问题，不是第 2 轮的 medium 对 high。** 变量是 prompt：base = 旧 prompt（ccfedcd），treat = 新 prompt（3f58416）。worker 两边都是 medium（已用 `meta.json` 核对），Root 用 deepseek-v4.1-flash，strict，handoff=off。T2 没有 high 的数据，所以本轮 medium 对 high 的结论**不涵盖 T2**。

2026-09-29 11:08 启动，两条 lane 并行，1 次尝试，不自动重跑。两个 run 均有效：`valid=true`，无 STOP，`root_err=0`（没有 Root 网关报错）。网关问题是第 1 轮 T2 无效的原因，这次没有复现。仅限这一次，不能说明网关已稳定。

| run | 结果 | 总花费 | Root 花费 | 子 agent 花费 | 总耗时 | Root 轮数 | 委派数 | 改动文件数 |
|---|---|---|---|---|---|---|---|---|
| T2 base | pass | $0.1814 | $0.0994 | $0.0820 | 1555s | 28 | 10 | 8 |
| T2 treat | pass | $0.2759 | $0.1512 | $0.1247 | 1994s | 30 | 10 | 11 |

目标测试 10 项全过，全套件无新增失败，评测口径为 masked-suite。

- **花费**：treat 比 base 高约 52%（$0.2759 对 $0.1814），Root 和子 agent 两边都更高。委派数相同（10 对 10），treat 的 Root 输入和输出 token 更多（输出 72.7k 对 45.9k）。
- **耗时**：treat 慢约 28%。拆分：子 agent 1259s 对 1133s，Root 有效耗时 706s 对 494s，Root 单轮中位数 16s 对 8s。差别主要在 Root 一侧，且没有网关报错，但只有一对 run，无法判断是 prompt 造成还是 Root 延迟波动。
- **改动范围**：treat 改了 11 个文件，base 改了 8 个。explorer 从 delegate 报告推断，多出的部分是文档同步（`docs/USER_GUIDE.md`、`src/tc_probe_design/orchestration/AGENTS.md`、`CODEMAP.md`、`docs/README.md`），由 Root 在第 22 轮的 worker 指令里明确要求，依据是项目 AGENTS 的文档同步规则。r2t 的克隆目录已不存在，无法用 `git diff --stat` 核对实际文件清单，以上是间接证据。
- **机制计数**：treat 有 1 次 delegate 被拒（因上一个仍在运行），base 为 0。被截短的报告 treat 2 次，base 1 次。
- **对照第 1 轮**：T3、T2b 上 treat 花费与 base 持平或略低。T2 上 treat 更贵，方向不同，但 T2 是 n=1，T3 和 T2b 是 n=2，**不能据此说 treat 在探索类任务上更差**，只能说没有看到 treat 更省。
- **质量与返工**：两边一次通过评测，且**两边都有 1 次 reviewer 发现问题、worker 修复的返工**（treat 是 fold 与 off-target merge 的顺序问题，reviewer 判为 P1；base 的具体缺陷未逐条核对）。treat 多做了 1 次文档同步 worker 和 1 次复审 reviewer。
- **treat 多花的钱**（explorer 读 jsonl 的结论，n=1）：混合原因，不全是浪费。(a) 有用的额外工作：文档同步、复审。(b) Root 输出更长：treat 有多轮 2.6–4.4 万字符的长规划/审查消息，Root 输出 token 72.7k 对 45.9k。(c) treat 一次广域 explorer 花了 $0.0581/231s，是 base 单次 explorer 的 2–3 倍。(d) 第 2 轮 treat 重复发起 explorer 被拒，没有记到成本，但推迟到第 9 轮才重试。

结论：T2 上没有发现新 prompt 的收益，花费和耗时的方向都对 treat 不利，但 n=1，只作为需要更多重复的信号。

## 补充：T2 重复 n=3（r3t、r4b、r5b、r5s）

为判断上面 r2t 的 treat 偏贵是真实代价还是噪声，又补跑了几轮。Root 用 deepseek-v4.1-flash，strict，handoff=off，worker thinking=medium 不变；每个 run 1 次尝试，不自动重跑。

| run | arm | 结果 | 总花费 | 用时 | 有效性 |
|---|---|---|---|---|---|
| r2t | base | pass | $0.1814 | 1555s | 有效 |
| r4b-1 | base | pass | $0.1795 | 1387s | 有效（root $0.1062 + child $0.0732，19 Root 轮，6 委派） |
| r5b | base | pass | $0.4029 | 3301s | 有效（root $0.1546 + child $0.2483，31 Root 轮，19 委派） |
| r2t | treat | pass | $0.2759 | 1994s | 有效 |
| r3t-1 | treat | pass | $0.1488 | 1155s | 有效，`root_err=0` |
| r5s | treat | pass | $0.1990 | 1381s | 有效（root $0.0972 + child $0.1018，22 Root 轮，8 委派） |

**不计入的 run**

- r3t-1 base：通过，1644s，但 Root 网关 `Request timed out`，无效。
- r4b-2 base：未执行。启动前健康检查遇到 403 `Authentication failed`，写了 STOP。同一命令随后复测两次均 OK，判断为网关瞬时故障。
- `rdt-r4s/` 是 15:39 试运行留下的空目录，忽略。

**汇总（每边 n=3，全部通过，均为有效 run）**

| arm | 中位数花费 | 均值花费 | 用时 |
|---|---|---|---|
| base | $0.1814 | $0.2546 | 1555 / 1387 / 3301s |
| treat | $0.1990 | $0.2079 | 1994 / 1155 / 1381s |

- **对照商定标准**：treat 没有三次都比 base 贵 30% 以上，只有 r2t 那一次贵（约 +52%），r3t-1 和 r5s 与 base 持平或更便宜。按标准算噪声，可以继续用新 prompt。
- **r5b 是 base 里的离群值**：19 个委派、55 分钟，是所有有效 run 里最贵最慢的一次，拉高了 base 均值。只看均值会高估 base 的成本，所以中位数更有参考价值。
- **不下结论**：n=3 且波动大（同一 arm 内最高与最低相差 2 倍以上），花费和耗时差异都不显著。这里不能说新 prompt 更好或更差，只能说没有看到 treat 稳定地更贵。
- **网关**：r5 两个 run 的 `root_err=0`。网关的超时和 403 是偶发的，已使 2 次计划中的 base run 无效或未执行。若 403 反复出现，可能是 token 轮换，需用户处理。
- worker thinking 保持 medium，`settings.json` 没有改动。

## 累计花费

约 $1.93（到第 1 轮 r1d）加第 2 轮 $0.458，再加 rdt-r2t 的 $0.457，合计约 **$2.85**。之后 r3t、r4b 到 $3.44，再加 r5b $0.4029 和 r5s $0.1990，合计约 **$4.04**，远低于 $30 上限。（按日志数字估算，不是汇总文件的值。）

## 遗留问题

- T2 现在 base 和 treat 各有 3 个有效 run（见上方补充）。结论是没有稳定差异，不是有差异的证据。若还要更强的结论，要更大的 n 并控制 Root 委派数的波动，预计每对 $0.4–0.6。
- T2 上没有 medium 对 high 的数据。
- "机械批量修改"仍无数据（没有现成任务）。
- worker thinking 已恢复为 medium，`settings.json` 已还原（见 `trial.log` 最后一行）。r2t 全程使用 medium，没有改动 `settings.json`。
