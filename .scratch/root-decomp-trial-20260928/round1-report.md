# 第 1 轮报告：Root 任务拆分 prompt 配对试验（2026-09-29）

base = 旧 prompt（ccfedcd），treat = 新 prompt（3f58416）。两组 Root 都用 deepseek-v4.1-flash，strict、handoff=off，子 agent 用 Luna（medium）。

## 覆盖范围和局限

- **有有效数据**：T3（修复单个行为）、T2b（跨文件集成），每个 arm 每个任务 2 次（r1c、r1d）。
- **没有有效数据**：
  - "需要先探索"（T2）：T2-treat-1 两次都因 Root 网关报错判为无效，T2-base-1 没跑。本轮已去掉 T2。
  - "机械批量修改"：没有现成的测试任务。
- 每个格子 n=2，只能用来发现明显的退步，**不能据此说新 prompt 更好**。
- 网关报错和 Root 延迟波动与 prompt 效果分开列，不混在一起分析。

## 结果

| run | 结果 | 花费 | 总耗时 | 委派数 | 返工 |
|---|---|---|---|---|---|
| r1c T3 base | pass | $0.106 | 922s | 6 | 0 |
| r1c T3 treat | pass | $0.111 | 1866s | 9 | 1 |
| r1d T3 base | pass | $0.087 | 753s | 7 | 1 |
| r1d T3 treat | pass | $0.085 | 617s | 9 | 1 |
| r1c T2b base | pass | $0.184 | 1920s | 6 | 0 |
| r1c T2b treat | pass | $0.184 | 1863s | 10 | 2 |
| r1d T2b base | pass | $0.170 | 1094s | 6 | 1 |
| r1d T2b treat | pass | $0.136 | 1105s | 5 | 1 |

汇总：

| arm | 通过 | 花费均值（T3 / T2b） |
|---|---|---|
| base | 4/4 | $0.097 / $0.177 |
| treat | 4/4 | $0.098 / $0.160 |

- 花费：T3 两组几乎相同；T2b treat 略低，主要来自 r1d 的一次。n 太小，只能说没有变差。
- 返工：treat 并没有稳定减少返工。T3 treat 两次各返工 1 次；T2b treat 分别是 2 次和 1 次，base 分别是 0 次和 1 次。
- 委派数：treat 在 T3 上略多（9 对 6–7）。reviewer 或 validator 多跑了几次，T3 treat 两次都有 reviewer 查出问题后返工。这是 treat 的正常行为，还是多花了功夫，样本无法区分。
- 耗时：r1c 的 T3 treat 慢（1866s 对 922s），其中一轮 Root 卡了 376s，属于 Root 延迟尖峰，不是 prompt 效果。r1d 里 treat 反而更快。

## 耗时拆分

来自 `timesplit.py`。

| run | wall | 子 agent | Root 有效 | Root 单轮中位数 / 最大 |
|---|---|---|---|---|
| r1c T3 base | 922 | 657 | 245 | 12s / 72s |
| r1c T3 treat | 1866 | 817 | 1057 | 9s / 376s |
| r1c T2b base | 1920 | 1394 | 513 | 13s / 117s |
| r1c T2b treat | 1863 | 1373 | 475 | 11s / 99s |
| r1d T3 base | 753 | 553 | 191 | 10s / 36s |
| r1d T3 treat | 617 | 492 | 156 | 6s / 49s |
| r1d T2b base | 1094 | 685 | 391 | 11s / 53s |
| r1d T2b treat | 1105 | 838 | 236 | 9s / 74s |

- 这 8 个 run 里没有网关报错（`root_err=0`）。
- 子 agent 占总耗时的 55–75%（r1c T3 treat 除外，那次 Root 尖峰占了大头）。
- r1d 整体比 r1c 快约 40%。可能是网关当时负载不同，无法判断，所以不宜跨批次比较耗时。

## 定性观察（explorer 读 jsonl 得出）

- **Root 不亲自改文件**：8 个 run 里 Root 都没有 edit/write，全部通过 delegate。
- **BLOCKED 报告**：只有 1 次，在 r1c T2b treat。worker 认为校验要求空 frame 带列，而契约 fixture 恰好不带列。这是不必要的 BLOCKED（worker 可以自行调整），不是缺信息。没有出现确有必要的 BLOCKED。
- **范围外改动**：测试文件都没动。只有 r1d T2b treat 的 worker 改了 `CODEMAP.md`（超出"代码、配置、CLI、流水线"范围，但 worker 在报告里写明了）。
- **委派 brief 质量**：treat 的 brief 对接口和约束描述得更具体，尤其是 T2b 的第一次实现委派，且会把空 frame 的边界情况单独拆出。但这没有换来更少的返工。
- **探索前置**：两组 Root 都会先跑 2–3 个 explorer 再派 worker，T2b 需要的探索多于 T3。

## 结论

1. treat 没有出现明显退步：通过率相同，花费不高于 base。
2. 没有证据表明 treat 提高了第一次委派通过率或减少了返工。
3. treat 的 brief 在文字上更具体，这是唯一比较一致的差异，但对结果没有可见的影响。
4. 第 1 轮不能给出更多结论。"需要先探索"和"机械批量修改"两类没有有效数据。

## 累计花费

约 $1.45（r1c 及作废重跑）加 r1d 约 $0.48，合计约 $1.9，远低于 $30 上限。

## 建议的第 2 轮

都用新 prompt，比较子 agent Luna 的思考强度 medium 和 high。Root 延迟这轮不是瓶颈，可以保留 T3 和 T2b 各 2 次。

- 如果要补"需要先探索"的数据，需要先确认网关稳定，再单独重跑 T2 的 base 和 treat；这需要用户决定。
- 提速办法：并发数调到 2（两组共用网关会互相干扰）。
