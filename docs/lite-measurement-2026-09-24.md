# lite 大任务测量结果（2026-09-24）

对应删减计划 §6（`docs/pi-planner-only-subtraction-plan.md`）。结论：**通过门槛，保留 lite**。

## 设置

- 回放仓库：`/public/scripts/tc-probe-design-v2`（只读克隆）。每个任务从目标提交的父提交开始，并放入目标提交里的测试文件。
  - T1 = 978392f `fix(tools): bound all external subprocess calls with timeouts`
  - T2 = 46d408a `feat(annotate): REF/ALT 配对接入主流水线，--allele-pair 开关（默认关）`
  - T3 = e927077 `fix(annotation): fail closed on explicit unusable BED evidence`（原选 124e28f 的目标测试在 base 已全过，作废）
- 两种模式，同一份任务提示词：
  - direct：`pi -ne --model tcuni/gpt-6-sol`，不加载任何插件。
  - lite：`PI_PLANNER_ONLY=1 pi -ne -e <pi-subagents> -e index.ts --model tcuni/gpt-6-sol`，提示词最前面多一句"你是规划与审核者：实现和跑测试交给 delegate，自己负责拆分、检查 git diff 与测试结果"。
- 子代理模型（`~/.pi/agent/settings.json` 的 `subagents.agentOverrides`）：worker、oracle（validator）都是 `tcuni-luna/gpt-6-luna`。
- 判定：目标测试全过，且快速套件（排除目标测试文件）的失败集合 ⊆ base 上同口径的失败集合。
- 成本：Root 按运营者要求假定为 opus（A）或 astra（B）价，另给 sol 实价；子代理按 luna 价。数据取自宿主 json 输出（Root 的 message usage 与 delegate 结果里的 `details.usage`），不用宿主报告的 cost 字段。

| 价表（美元/百万 token） | input | output | cacheRead | cacheWrite |
|---|---|---|---|---|
| A = opus | 5 | 25 | 0.5 | 6.25 |
| B = astra | 10 | 50 | 1 | 12.5 |
| sol 实价 | 2 | 10 | 0.2 | 2.5 |
| luna | 0.10 | 0.50 | 0.01 | 0.125 |

## 结果（3 任务 × 2 模式 × 2 次）

| 运行 | 通过 | Root 轮数 | 委派次数 | A 成本 | B 成本 | sol 成本 |
|---|---|---|---|---|---|---|
| T1 direct 1 | 是 | 63 | – | $3.7585 | $7.5170 | $1.5034 |
| T1 direct 2 | 是 | 36 | – | $1.9171 | $3.8343 | $0.7669 |
| T1 lite 1 | 是 | 17 | 6 | $1.0870 | $2.1254 | $0.4640 |
| T1 lite 2 | 是 | 16 | 5 | $1.0462 | $2.0437 | $0.4476 |
| T2 direct 1 | 是 | 35 | – | $3.6794 | $7.3588 | $1.4718 |
| T2 direct 2 | 是 | 58 | – | $4.6922 | $9.3844 | $1.8769 |
| T2 lite 1 | 是 | 15 | 5 | $1.5088 | $2.9006 | $0.6737 |
| T2 lite 2 | 是 | 22 | 7 | $2.0092 | $3.8808 | $0.8862 |
| T3 direct 1 | 是 | 21 | – | $1.1974 | $2.3949 | $0.4790 |
| T3 direct 2 | 是 | 32 | – | $1.8383 | $3.6766 | $0.7353 |
| T3 lite 1 | 是 | 16 | 7 | $1.3467 | $2.6366 | $0.5727 |
| T3 lite 2 | 是 | 16 | 6 | $1.1331 | $2.2172 | $0.4826 |

- 通过率：direct 6/6，lite 6/6。36 次委派全部 completed，全部运行在 luna 上。
- 总体 lite/direct：**A 0.476，B 0.463，sol 0.516**（A 价合计 lite $8.131，direct $17.083）。
- 按配对：T1 0.29 / 0.55，T2 0.41 / 0.43，T3 **1.12** / 0.62（A 价）。

## 观察

- 子代理几乎不花钱（每次运行约 $0.03–0.1），lite 的成本几乎全在 Root。省下来的是 Root 轮数：direct 21–63 轮，lite 15–22 轮。
- 小任务不划算：T3 的 direct 只要 21–32 轮，lite 的固定编排开销（约 15–20 轮）吃掉了差额，第一次反而更贵。注意 lite 提示词强制"实现交给 delegate"，盖过了插件默认的"小事自己做"。
- lite 墙钟更长：747–2086 秒，direct 278–1652 秒。
- 两种模式都会改目标以外的测试文件（给 fake 补参数、加新测试）。lite 的 6 次运行没有删除任何断言；direct 的 T1 第 1 次删了 3 条。
- 同一 T1 lite 用 gemini-3.8-flash-high 当 worker 时，子代理花 $1.75，ratio_A 0.75；换成 luna 后降到 $0.05。worker 模型是最大的成本杠杆。
- 样本小：一个仓库、3 个任务、各 2 次，同任务两次之间差异很大（T1 0.29 对 0.55）。

## 插件改动

- 子代理 token 上限默认值 200000 → 1500000（`delegate.ts`）。进度事件里的 tokens 是累计的非缓存 input+output；200k 让 worker 在大仓库里 90 秒左右就被取消。

测量脚本与原始输出在 `.handoff/p20-r098/`、`.handoff/p21-r099/`、`.handoff/p21-r100/`（本地，不入库）。
