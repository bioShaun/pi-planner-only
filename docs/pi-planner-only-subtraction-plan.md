# pi-planner-only 删减计划（lite 重写）

**日期：** 2026-09-24　**基线：** main `1b5e9ef`　**状态：** 提案

## 0. 为什么删

原始目标：执行交给便宜模型，贵模型只规划和审核，**省钱**。

实测结果与这个目标相反：

- P3 对照（小任务，27/27 完成）：直接做 54.5k token；走委派 815k–847k token，**多约 15 倍**。
- 0.3 基线：Root 占总成本 60–78%。每个 Task 要 11–18 轮 Root，每轮重读 30–50k 缓存 token。

成本主要来自 **Root 轮数 × Root 上下文**，不在执行 token。现有协议的每一步都在增加 Root 轮数：委派 → 证据 → 纠正 → verdict → commit，外加报告纠正、revalidate、recovery。注入 Root 上下文的证据块和决策块，每一轮都会被重读。

这些机制大多用来兑现"对子代理零信任、全程审计"，而宿主并不执行其中关键的几项：usageBudget 不生效、停止无法确认、工具集可能被其他插件改写。插件只能靠推断和记账去补，这是反复出现 P0 的结构性原因。

**判断标准（以后每个机制都要回答）：它让一个真实大任务少了几轮 Root，或者防住了哪个真实发生过、代价很大的事故？** 答不出来的机制就不要。

## 1. 现状规模

源码 23,241 行 TS + 998 行 Python，测试 21,568 行，ADR 10 份，spec/audit 文档 28 份，环境开关 26 个，Root 工具 7 个。`delegate.ts` 里的 `runDelegation` 单个函数就有 1,658 行，`orchestrate.ts` 的 `PlannerOrchestrator` 有 2,597 行。`task.ts` 被 9 个模块引用，`types.ts` 被 13 个模块引用。

耦合到这个程度，**逐块删比重写更贵**。建议在新分支上写 lite 版，只从旧代码里摘取少数经过验证的片段（见 §3）。

## 2. 模块处置表

### 2.1 整块删除（约 15,000 行）

| 模块 | 行数 | 在做什么 | 删除后由什么兜底 |
|---|---|---|---|
| `closeout-*` ×8 + `closeout-*.py` | 2,494 + 998 | 一次性收尾能力、journal、沙箱、快照、broker | 不需要：worker 直接返回文本 |
| `evidence.ts` | 2,094 | A_run/C_report/C_now 三点采样，Truth/scope/freshness 判定 | 委派结束时附一次 `git diff --stat <launchHEAD>` 加工作区状态，由 Root 自己看 |
| `workspace-snapshot.ts` | 280 | PASS 边界的内容哈希清单 | 同上 |
| `task.ts` | 2,236 | Task 生命周期状态机、TaskSpec 校验/修补、id 分配 | 不设 Task 概念；一次委派就是一次工具调用 |
| `ledger-store.ts` | 548 | Task 快照落盘、reload 回放 | 不跨 reload 保存状态（子代理本来就是进程内的，Root 退出它们也随之结束） |
| `review.ts` + `report.ts` | 1,098 | WorkerReport schema、ReviewResult、decideReview | worker 返回文本；需要独立审核时，就用 reviewer 角色再委派一次，返回文本 |
| `orchestrate.ts` | 3,038 | 把以上模块串起来的协调器 | 随上面各模块一起删 |
| `request-control.ts` + `request-events.ts` | 601 | 跨 reload 的 Request 额度与关闭、失败链 | 不需要 |
| `refusal-breaker.ts` | 186 | 模型反复发同样被拒参数时熔断 | 参数面缩到 2 个之后，拒绝本身就少了 |
| `floors.ts` + `execution-defaults.ts` | 362 | 会话预算、执行封套、Request 余量上限 | 宿主的 `timeoutMs` + `toolBudget`，加上按 update 事件里的 `tokens` 超限取消（几行代码） |
| `policy.ts`（Idle/live 两种模式） | 126 | 按 Task 状态推导 Root 可用的工具 | 一个开关：`strict` 模式下拦截 Root 的 edit/write/bash，否则不拦 |

同时删除以下 Root 工具：`planner_redelegate`、`planner_abort`、`planner_tasks`、`planner_verdict`。ADR 0002–0006、0009、0010 标记为 superseded。

### 2.2 重写成小模块

| 现有 | 行数 | lite 目标 | 保留什么 |
|---|---|---|---|
| `delegate.ts` | 3,120 | ~300 | 发出 request、等待 response、处理 cancel；读取 `response.usage/model/status` |
| `index.ts` | 2,362 | ~250 | 注册工具、一个 strict 开关、一段 ≤300 token 的指引注入、`message_end` 记录 Root usage |
| `usage.ts` | 1,718 | ~200 | Root 用量取自 `message_end`，子代理用量直接取自 `response.usage`；按 pricing.json 算钱，一行状态栏显示 |
| `types.ts` | 1,085 | ~100 | 只保留上述几类的类型 |
| `role-models.ts` + `delegation-model.ts` | 453 | ~80 | 一张配置表：role → agent、model、thinking、tools；响应里 `model` 与请求不一致时在结果中标一行 |
| `roles.ts` | 135 | ~60 | 角色工具档：worker、explorer（只读）、validator（能跑 shell，不能编辑） |
| `concurrency.ts` | 244 | ~40 | 内存里每个 cwd 最多一个 writer，全局 N 个并发 |
| `git-audit.ts` | 485 | ~150 | **保留加固过的只读 argv**（`--no-ext-diff`、`--no-textconv`），只留 diff/stat/log/show 几种。**需要补上**：现有代码没有 fsmonitor 防护（成熟度评审 P2 至今未修），lite 统一加 `-c core.fsmonitor=false` |

`subagent-delegation-contract.ts`（150 行）保持原样，连同"事件名与已安装包比对"的那条测试一起保留。

**lite 总量目标：约 1,500 行源码，约 1,500 行测试。**

## 3. lite 的形态

**Root 工具（3 个）**

1. `delegate({ role, task })`：同步等待子代理完成。返回内容：
   - `status`（直接透传宿主状态）
   - 子代理的文本摘要（截断到 ~2k 字符）
   - `git diff --stat` 与未跟踪文件列表（从启动时的 HEAD 算起，截断）
   - 一行用量（`model · tokens · $`），模型不符时加警告行
2. `git_audit({ op, args })`：只读 Git，沿用加固过的 argv。
3. `git_commit({ message })`：保留，strict 模式下 Root 没有 bash 时用得上。

**注入给 Root 的指引**（一次性，≤300 token）：

- 预计 ≤2 个文件、≤10 分钟的小事自己做；更大的任务委派给 worker。
- 验收要看 diff 和测试输出，不要只看 worker 的自述；需要跑测试时委派给 validator。
- 需要返工时，再调一次 `delegate`，把上一次的摘要和要改的点写进 task。

**子代理的 task 包**：任务文本 + cwd + 一句"结束时用 3–10 行写：改了什么、怎么验证的、还有什么没做"。不要求 JSON，不要求报 Git 事实。

## 4. 被删机制与接受的风险

| 风险 | 旧机制 | lite 的做法 |
|---|---|---|
| worker 谎报完成 | Truth/scope 判定 + reviewer | Root 看 diff stat，并委派 validator 跑测试。只在结束时核验一次 |
| 两个 writer 同时改一个目录 | writer lock + writer hold 持久化 | 内存锁；进程重启后锁消失，接受 |
| 子代理失控烧 token | 封套、floors、Request 余量 | 宿主 `timeoutMs`/`toolBudget`；`update.tokens` 超过上限就发 cancel |
| 停止未确认、有 shell 进程残留 | writer hold + recovery.required | 在结果里写明"停止未确认"，由人处理 |
| reload 时正有委派在跑 | ledger 回放 + recovery | 子代理随 Root 一起结束；看 git 状态即可 |
| 其他插件改写 payload | —（事故后未修） | 核对响应里的 `agent`/`model`，不一致就标出来 |
| worker 利用 Git 配置让 Root 执行命令 | 加固 argv（缺 fsmonitor 防护） | **保留**，并补上 `core.fsmonitor=false` |

## 5. 迁移步骤

1. 在当前 main 打标签 `legacy-full-audit`，留作参照，不再往上加功能。
2. 新分支 `lite`：按 §2.2 写新模块，§2.1 的文件直接删除。测试只保留：契约事件名、git argv 加固、一次端到端冒烟（真实委派一个小改动，断言 diff stat 与 usage 行存在）。
3. 按 §6 测量，结果出来再决定 main 指向哪条线。
4. 文档：README 重写成一页；CONTEXT.md 缩到 5 个词条（Root、Worker、Explorer、Validator、Delegation）；旧 spec 移到 `docs/archive/`。

## 6. 测量设计（决定这个插件还要不要做下去）

> 2026-09-24 结果：lite 通过门槛（总体 0.476 / 0.463 / sol 0.516，12/12 通过），见 `docs/lite-measurement-2026-09-24.md`。

P3 只测了小任务，按上面的指引，小任务本来就不该委派。需要补测大任务。

- **任务**：3 个真实项目里的大任务，每个预计 ≥30 分钟、改动 ≥5 个文件，并写好固定的验收命令。
- **三组对照**：direct（Root 独自完成）、lite、legacy（可选，只作参照）。每组重复 2 次。
- **数据来源**：宿主会话记录，包括子代理自己的记录（`session-X/<sess>/<uuid>/run-0/*.jsonl`）。不读插件的 usage.jsonl，也不计 `type=custom` 的镜像条目。按 pricing.json 算钱。
- **指标**：总花费、Root 占比、Root 轮数、验收命令是否通过。
- **决策规则**：
  - lite 的总花费 ≤ direct 的 70%，且通过率不降 → 继续做 lite，main 切到 lite。
  - 否则说明在这类工作上"便宜模型执行"本身不省钱。插件只保留 `delegate` 作为可选工具，不再做强制委派。
