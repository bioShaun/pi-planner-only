# Pi Planner-only 费用对照记录规范

## 记录文件

`/planner-only usage record [<taskId>] [--arm <name>]` 在一次 Task 结束后写入 `AGENT_DIR/planner-only/runs/<runId>.json`。`arm` 使用 `isolated-baseline`（隔离基线）或 `role-split`（模型分工方案）；同一批比较必须保持命名一致。

记录包含：

| 字段 | 类型 | 来源 | 缺失时 |
|---|---|---|---|
| `version` | `1` | 记录格式 | 不适用 |
| `runId` / `recordedAt` / `arm` | string | 运行命令和记录时刻 | 命令生成，arm 默认 `unspecified` |
| `task.taskId` / `task.objective` / `task.acceptanceCriteria` | string/string/string[] | Task 的 `spec` | 目标缺失保留为缺失，验收要求为空数组 |
| `task.baseGitRef` / `finalGitRef` / `gitStatusHash` | string | Task `baseEvidence` | 保留缺失；缺少 `baseGitRef` 时不可比 |
| `models.root` / `models.children` | string/object[] | Usage 的 root model 和 child 的 kind、agent、model、thinking | 对应值缺失 |
| `pricing.path` / `version` / `currency` / `loadedAt` | string/number/string/string | `pricingPath()`、PricingTable 和读取时刻 | 缺失费率使记录不可比 |
| `cache.cacheRead` / `cacheWrite` | number | 实际 Usage 计数 | 缺失数据按不可比处理，不声明缓存命中 |
| `tokens` | object | root 与 children 的实际 token 计数 | root 零 token turn 会标记不可比 |
| `cost` | object | root、children 的实际费用 | 未解析费率不按零计；`costDebtUsd` 单列为估算债并使记录不可比 |
| `outcome.state` / `completed` | string/boolean | Task state | 非 `completed` 为失败 |
| `task.reviewRounds` | number | Task `reviewRound` | 保留当前值 |
| `durationMs` | number | `updatedAt - createdAt` | 时间戳不可导出时缺失并不可比 |
| `comparable` / `incomparableReasons` | boolean/string[] | 纯逻辑判定 | 说明每个不可比原因 |

## 两个对照 arm

隔离基线 arm 在相同初始仓库状态下运行单一规划/执行配置，并记录该 Task 的完整 Usage。模型分工方案 arm 在相同基线和 Task 目标下运行约定的 worker、reviewer、validator 分工，并记录相同字段。每次运行结束后用对应名称执行 `usage record --arm <name>`；不要把不同初始仓库状态混进同一可比集合。

## 汇总口径

`/planner-only usage summary [<dir>]` 读取目录中的 JSON 记录并输出可读汇总。通过率在全部记录上计算，失败运行仍计入总支出；不可比记录排除在 `totalSpendUsd` 和 `costPerSuccessUsd` 外，并按原因计数。`totalSpendUsd` 包含可比失败运行的实际费用。`costPerSuccessUsd` 是总支出除以“可比且完成”的运行数；没有该分母时明确显示“无可比成功样本”，不显示 `$0.00`。平均返工按全部记录计算，平均耗时按可导出的记录计算。本文不预设任何节省比例或收益。
