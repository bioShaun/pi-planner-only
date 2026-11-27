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

### 0.1 机制台账

新机制合入 main 时在下表加一行。答不出 §0 的，回答类型写「无」，建议处置标为「暂定-待证」。表格是 §0 回答的唯一位置。日常 review 发现缺行时补行，或在跟踪 issue 留言，不再每波另开新 issue。最终处置只由用户填写；新行先写「待用户」。2026-11-16 用户按 #54 的建议填写了现有各行。

2026-11-27 增量取证（#54 到期复核）：对 4 行到期暂定机制重跑 `scan2.py`（原样复制、仅改输出名，保证与 2026-11-16 同脚本可比）并补 phase 拆分，覆盖 `~/.pi/agent/sessions` 3,217 个 jsonl / 978 个根会话，新窗口（`2026-11-16T03:23:52Z` 之后）130 个根会话、其中 native 127 个。数字与逐行结论写在各行「证据指针」；原始证据与脚本含客户路径，留在本机 `/home/tcuni-claw/pi/s0-evidence-20261127/`（`summary.md`、`findings-baseline.txt`、`findings-incr.txt`），不公开。

| 机制 | 提交/PR | 来源 issue | §0 回答类型 | 证据指针 | 建议处置 | 最终处置 |
|---|---|---|---|---|---|---|
| per-call `timeoutSeconds` | 0ea2671 / #32；d1ee6b3 / #33 | #35 | 无 | issue #35；`docs/adr/0008-default-execution-wall-clock-ten-minutes.md:4`；`CONTEXT.md:42-43`。ADR 0008:4 写「heavy-worker envelope not revived」并加注允许单次 `timeoutSeconds`；最长 24h 的单次时限是否等于复活 envelope，待用户裁定 | 暂定-待证 | 保留（用户 2026-11-16）；ADR 0008:4 已写明只覆盖单次 `timeoutMs`，token 与取消限制不变，不算复活 envelope |
| per-role 统计 | 0ea2671 / #32 | #35 | 无 | issue #35 | 保留-仅工程 | 保留（用户 2026-11-16） |
| 上下文警告改 steer，并扩大 handoff 建议 | 187f687 | #35 | 无 | issue #35；日志行为证据（未测轮次/成本）：警告后同会话交接 旧 18/29 → 新 135/140（#54） | 保留-仅工程 | 保留（用户 2026-11-16，依据 #54 日志取证） |
| `planner-validator` | fa03a63 / #36 | #40 | 无 | issue #40；`delegate.ts:60`；日志取证：未见劫持事故，落地后未运行；属 agent 打包，不占每轮提示词（#54） | 保留-仅工程 | 保留（用户 2026-11-16，依据 #54 日志取证） |
| Native handoff 与共享上下文警告 | 2886105 / #37 | #40 | 无 | issue #40；`.scratch/native-context-handoff/spec.md`（证据为隔离探针复现，不是真实事故） | 暂定-待证 | 保留（用户 2026-11-16）；证据弱于其它保留行，出现反例时重议 |
| Native usage 状态 | 7085aac / #38 | #40 | 无 | issue #40 | 保留-仅工程 | 保留（用户 2026-11-16） |
| reviewer `base` | 7085aac / #38 | #40 | 无 | issue #40；`delegate.ts:509`；与 `git_review` 互补（≤32 KiB 内联路径） | 保留-仅工程 | 保留（用户 2026-11-16） |
| `test:release:isolated` 与 host 1.4.0 / Node 引擎 pin | 7085aac / #38 | #40 | 无 | issue #40 | 保留-仅工程 | 保留（用户 2026-11-16） |
| Root prompt / 批处理重写 | 7085aac / #38 | #40 | 无 | issue #40；`docs/planner-optimization-plan-2026-10-26.md` | 保留-仅工程 | 保留（用户 2026-11-16：不安排 bench，由 1,500 字符上限把关） |
| handoff retention / origin | 53499d7 / #42 | #43 | 防事故（真实发生） | issue #43；`.scratch/handoff-retention-origin/spec.md`「问题」1–2（旧简报堵住新简报）；`docs/superpowers/specs/2026-10-30-native-handoff-chain-convergence-design.md:19`、`:23` | 保留-已证明 | 保留（用户 2026-11-16） |
| brief 字段扩展 | 84e3519 | #43 | 无 | issue #43；`index.ts:620`。2026-11-27 增量：新窗口 33 次 handoff 中 10 次 brief 含 ruled out / pitfall / unverified / 已排除 / 未验证，23 次不含（旧期 29 / 114，比例未改善）；含词样本都是「未验证」状态词，不是已排除路线 / 坑栏目；没有「brief 写了已排除路线，新会话因此没重走」的片段 | 建议撤回（到期：字段大多不填且无挡重走实例） | 暂定（用户 2026-11-16：2026-12-15 前无证据则撤回，见 #54） |
| Native local-task 例外 | 8db3e6c | #43 | 无 | issue #43。2026-11-27 增量：新窗口 11 个 native 根会话是 1–3 次编辑且零子代理、3 个 ≥8 次编辑且零子代理（旧期 26 / 5）；逐条看过，多是 Root 写咨询答复、进度笔记与配置小改，既无「省掉一次委派且无返工」的干净片段，也无借例外做本该委派的大改动的反例 | 建议保留-仅工程（用法真实；撤回会把明确局部的活也强制委派，与 lite 目标相反；但仍无轮次 / 成本测量） | 暂定（用户 2026-11-16：2026-12-15 前无证据则撤回，见 #54） |
| auto handoff 链上限 | be287c3 | #46 | 防事故（真实发生） | issue #46；`docs/superpowers/specs/2026-10-30-native-handoff-chain-convergence-design.md:5`、`:36`（SSR 会话链：11 个 Root、9 次无用户输入的自动交接） | 保留-已证明 | 保留（用户 2026-11-16） |
| 必填 progress 与停止措辞 | c335408、f1c64d4 | #46 | 无 | issue #46；日志取证：落地后 99/99 次 handoff 带具体进度（#54） | 保留-仅工程 | 保留（用户 2026-11-16，依据 #54 日志取证） |
| Native 任务粒度 | f363b30 | #46 | 无 | issue #46。2026-11-27 增量：新窗口 0 次 INCOMPLETE（全期唯一一次「落地后」命中是小节标题误报，见 2026-11-16 取证）；落地 28 天里机制前提（子代理只交回部分结果）没有再现 | 建议撤回（到期：0 次触发，无法验证收益） | 暂定（用户 2026-11-16：2026-12-15 前无证据则撤回，见 #54） |
| 先合并依赖性 review / 并发修复 | e44bdef | #46 | 无 | issue #46。2026-11-27 增量：新窗口 56 次引用「独立 reviewer」，但 0 次 reviewer 任务真在审锁 / 并发——全库 20 次关键词命中里，11 次真正提到锁 / 并发的都在 2026-10-02～10-10（早于 e44bdef 落地），新窗口 9 次是 `target-id-trace` 里 `race` 的误报；无「审查在依赖工作开工前抓到并发 / 锁缺陷」的片段 | 建议保留-仅工程（规则被引用但从未命中目标；操作者全局 `AGENTS.md` 已强制同一口径，插件侧撤回并不改变实际行为，留作观察） | 暂定（用户 2026-11-16：2026-12-15 前无证据则撤回，见 #54） |
| reviewer `git_review` | 157e51fd | #49 | 防事故（真实发生） | issue #49；`.scratch/reviewer-git-tool/log.md:181`（A15：审查 116,538 字节的范围，超出 `base` 内联 32 KiB 上限） | 保留-已证明 | 保留（用户 2026-11-16） |
| explorer 共享锁 | f2fe050 | #28 | 无 | `docs/adr/0012-explorer-read-only-is-prompt-enforced.md`；`delegate.ts:54` | 保留-仅工程 | 保留（用户 2026-11-16） |
| Native 按角色分流（scout / oracle / worker） | 07f776f / #55 | 未注明（cloud backlog 2） | 无 | `index.ts` `NATIVE_PROMPT`；判断表 `.scratch/native-root-dispatch/spec.md` 第 1–3 节；本行由 #55/#56 的 main review 补记，随本 docs PR 在 #54 留言请用户裁定。两条提示把 `NATIVE_PROMPT` 从 565 增到 1,125 字符，现由 `index.test.mjs` 的 1,200 字符上限断言（含故障注入）守住 | 暂定-待证 | 待用户 |
| Native 再规划条件与执行摩擦交回 Root | ef87a05 / #56 | 未注明（cloud backlog 2，基于 #55） | 无 | `index.ts` `NATIVE_PROMPT`；`.scratch/native-root-dispatch/spec.md` 第 2、4 节。纯提示与任务包约定：不解析报告、不新增角色或工具、不每轮自动规划 | 暂定-待证 | 待用户 |
| Native oracle 访谈分工、可续用方案与规划期门闩（仅 spec 约定） | #60 | 未注明（cloud backlog 2，基于 #56） | 无 | `.scratch/native-root-dispatch/spec.md` 第 2、5–7 节；纯判断表与任务包约定，未改动 `NATIVE_PROMPT`（仍 1,125 字符，上限 1,200）或运行时代码；`oracle` 保持只读不直连用户、由 Root 负责提问/落盘/勾选步骤；待本机试用并由用户裁定 | 暂定-待证 | 待用户 |

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
| `index.ts` | 2,362 | ~250 | 注册工具、一个 strict 开关、一段 <1,500 字符的指引注入、`message_end` 记录 Root usage |
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

**注入给 Root 的指引**（一次性。初稿目标 ≤300 token；3f58416 曾把上限放宽到 1,700 字符且未经收益验证（issue #25）；2026-10-01 压缩回非 strict 1,481 字符、strict 1,496 字符（约 375 token），测试上限 1,500 字符，有实测收益才放宽。下面三条是初稿，现行文本以 `index.ts` 的 `plannerPrompt` 为准）：

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

> 2026-09-24 结果：lite 通过门槛（总体 0.476 / 0.463 / sol 0.516，12/12 通过），见 `docs/lite-measurement-2026-09-24.md`。2026-09-25 起该结果仅作历史参考（Root 为 sol 按价重算、克隆早于泄漏修复），见 `docs/lite-direction-review-2026-09-25.md` §2.4。

P3 只测了小任务，按上面的指引，小任务本来就不该委派。需要补测大任务。

- **任务**：3 个真实项目里的大任务，每个预计 ≥30 分钟、改动 ≥5 个文件，并写好固定的验收命令。
- **三组对照**：direct（Root 独自完成）、lite、legacy（可选，只作参照）。每组重复 2 次。
- **数据来源**：宿主会话记录，包括子代理自己的记录（`session-X/<sess>/<uuid>/run-0/*.jsonl`）。不读插件的 usage.jsonl，也不计 `type=custom` 的镜像条目。按 pricing.json 算钱。
- **指标**：总花费、Root 占比、Root 轮数、验收命令是否通过。
- **决策规则**：
  - lite 的总花费 ≤ direct 的 70%，且通过率不降 → 继续做 lite，main 切到 lite。
  - 否则说明在这类工作上"便宜模型执行"本身不省钱。插件只保留 `delegate` 作为可选工具，不再做强制委派。
