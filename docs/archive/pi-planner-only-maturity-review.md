# pi-planner-only 成熟度评估：致命问题与设计笔记评审

**日期：** 2026-09-10
**范围：** GitHub `main`（README、CONTEXT.md、index.ts、orchestrate.ts、evidence.ts、roles.ts、policy.ts、git-audit.ts）+ 下午 oracle 事故 + `.scratch/` 两份笔记（Root Idle Policy、Evidence baseline lag）
**局限：** 未读到 task.ts / review.ts / report.ts / types.ts / docs/；本地版本领先 GitHub main（已有 `planner_verdict`、ledger restore、0.4.1），涉及这些模块的判断需对照本地代码确认。

---

## 1. 优先级总览

| 优先级 | 问题 | 为什么致命 | 状态 |
|---|---|---|---|
| P0 | Evidence 模型把 truth 和 freshness 混在一个 A↔C 比较里 | 每次都可能烧光 3 轮 correction；当前归因方案存在 worker 可绕过的漏洞 | 笔记方案需调整 |
| P0 | 环境/契约失败（oracle 事故）被当作 worker 失败处理 | 必然重复失败并消耗预算；只有看子进程日志才能发现 | 未处理 |
| P0 | Idle policy 没有操作者逃生口；cwd 匹配语义未定义 | 一旦误判 Root 只剩 delegate，无法自诊断 | 笔记未覆盖 |
| P1 | launch 后不验证子进程实际工具集 | 任何第三方插件都能悄悄改掉安全边界 | 未处理 |
| P1 | bg / `tasks` / `chain` 路径未接 | WorkerReport 丢失或错配，Task 悬挂 | 需确认本地 |
| P1 | 子目录 cwd 路径归一化（monorepo） | 永久 stale；会传染到 Idle policy 的 `activeForCwd` | 需确认本地 |
| P1 | `workerRunId` 身份校验 worker 无法满足 | 假 reject，白烧一轮 | 需确认本地 |
| P1 | 默认 warn 模式下 writer lock 不生效；scope 未执行 | 文档承诺与代码不一致 | 需确认本地 |
| P2 | `probeGit` 无 `--no-ext-diff` / `core.fsmonitor` 防护 | 有 bash 的 worker 可让 Root 进程执行任意命令 | 未处理 |
| P2 | Idle 下 schema 切换与 prompt cache / `suppressedTools` 恢复的交互 | reload 后工具丢失类偶发 bug | 设计阶段 |
| P2 | 非 Git 目录被判 `fresh` | 零证据可通过 PASS 路径 | 未处理 |

---

## 2. 事故复盘：oracle 子代理被剥离 shell 工具

### 事实

- runId `c9de54d8-…`，validator 角色 remap 到 `oracle`，声明工具 `read, grep, find, ls, bash`。
- 子进程实际只见到 `contact_supervisor`；`status.json` 中 `toolBudget.block = [read, grep, find, ls]`。
- 根因：另一个插件在同一个 `subagent` payload 上写入了 `toolBudget`，覆盖了本插件的 remap 结果。
- 后果：子进程自报 blocked，review loop 将其视为 worker 失败 → revalidate → 再派 validator → 再失败。

### 暴露的结构性弱点

**2.1 能力契约在启动时未被验证**

`applyRoleDelegation` 只改 `input.agent` / `input.context` / `input.task`，然后信任 pi-subagents 会按 agent 名字配工具。payload 被多个 `tool_call` hook 依次就地修改，顺序不可控。

修复：
- 不只靠 agent 名字，显式写 `tools` / `toolBudget.allow` 字段，把 `ROLE_TOOL_PROFILES[role]` 直接写进 payload。
- 在 `tool_result`（或 `subagent_wait` 返回）时读子进程 `status.json`，把实际工具集与 `ROLE_TOOL_PROFILES[role]` 做集合比较；不一致 → 不进 review loop，直接标环境错误。

**2.2 “基础设施失败”与“worker 失败”没有分类**

blocked 理由是“没有 bash”与“测试挂了”在 `advanceReview` 中被同等对待，都消耗 correction round、都触发 revalidate。前者重派任意次结果相同。

修复：
- 引入 `failureClass: worker | environment | contract`（判据：工具集不匹配、子进程启动失败、`--no-extensions` 未生效、超时）。
- 环境类失败不消耗 round、不 revalidate，直接 blocked + 明确诊断信息交给操作者。
- 与 baseline-lag 笔记的 spin guard 合并为通用机制（见 §6）。

**2.3 已知冲突没有探测**

- `session_start` 时枚举 pi-subagents 的 agent 注册表，校验 `reviewer` / `oracle` 存在且工具集符合预期；不符合则状态栏标红、首次 delegation 时告警。
- README 增加“已知不兼容”一节。

---

## 3. Root Idle Policy 笔记评审

**方案摘要：** gather 阶段由 Task store 推导；`activeForCwd` 为空时 Root 只能 delegate / question / `planner_verdict`（后者仅对 blocked/failed 且有 WorkerReport 的 Task）；inspect、Git-read、shell 被拒并附可复制 TaskSpec；Task live 时恢复 inspect/review 工具。

### 必须在实现前定下来的

**A. Idle 判定本身没有操作者逃生口**

所有逃生口都是给 Task 的，没有给 Idle 判定的。`activeForCwd` 依赖 Task store、ledger restore、cwd 匹配三个环节，任一出 bug（ledger 损坏、cwd 归一化错、子进程仍在跑但 store 已 final），Root 只剩 delegate/question，连 `read` 都没有。

- 增加 `/planner-only gather live|idle|auto` 操作者覆盖。
- Idle 拒绝信息中打印推导依据：cwd、store 内各 Task 的 state。

**B. cwd 匹配语义未定义**

Root `ctx.cwd = /repo`，Task cwd = `/repo/packages/foo`：精确匹配 → Root Idle，无法 read 正在 review 的文件；前缀匹配 → 必须与 writer lock 共用同一路径归一化（`git rev-parse --show-toplevel`）。与 §5 的子目录归一化是同一根问题，应做成单一 `normalizeCwd`。

**C. 工具从 schema 移除，还是只在 `tool_call` 拒绝？**

- 只在 `tool_call` 拒绝：`read` 仍在 schema 中，模型会调 → 照样烧一轮，目标未达成。
- 按 store 状态在 `before_agent_start` 切 `setActiveTools`：
  - Task 状态在 turn 中途变化时 schema 下一 turn 才同步，两层判定必须用同一快照，否则又出现“schema 有、调用被拒”。
  - 每次切 schema 打掉 prompt cache。
  - 现有 `suppressedTools` 快照/恢复按“开/关”设计，加“Idle/live”维度后 `session_shutdown` 恢复与 `/planner-only off` 恢复需重推，否则 reload 后工具丢失。

### 需要想清楚的取舍

**D. 可被“钥匙化”绕过**

Explorer Task 算不算 `activeForCwd`？算 → Root 学会“先派 Explorer 开锁再自己 read”；不算 → Explorer 运行期间 Root 读不了、完成后无法验证输出。建议：算，但 Explorer completed 后立即 Idle，并配合 E。

**E. `completed` 后立刻 Idle，Root 失去事后审查能力**

worker 完成 → terminal → cwd Idle → Root 连 `git_audit log` 都不能跑；操作者问“刚改了什么”只能再派 Explorer。建议 completed Task 在同一 user turn 内仍视为 live，下一条用户消息才 Idle。

**F. Skills 只写在 constraints 里，Root 如何知道有哪些 skill？**

若 skill 目录靠 `read`/`ls` 发现，Idle 下 Root 不知道能写什么名字。需要 Idle 下可用的只读 skill 目录（名字 + 一句话描述），或由 system prompt 注入。

**G. 从被拒调用自动生成 TaskSpec 的边界**

`read foo.ts` → Explorer spec 可行；`bash npm test` → validator spec 可行；`edit` 被拒时生成的 worker spec `acceptanceCriteria` 只能为空——“过校验但语义为空”。对 worker 角色只给模板，不声称已通过校验。

---

## 4. Evidence baseline lag 笔记评审

**方案摘要：** C 采样携带 `A..C` 的 first-parent 名单（上限 200）；`compareEvidence` 将其切分为 Worker-attributed T2 与 baseline lag；lag 进 `lagPaths` 而非 `reasons[]`，lag-only 保持 `fresh: true`；Reviewer patch 以最早归因 commit 的 parent 为 base；覆盖不全/merge 洞 fail closed 到今天的未切分 T2；identical verifiable revalidate reasons 不消耗 round。

### 结论：方案在解症状，根因是 A 的语义混淆

事故本质是用 A↔C 判定 freshness，而 A 是 Task 级、可能很旧的基线。报告之前发生的事情无论如何都不是“changed after the report”。

### 更干净的分解：三采样，两个纯函数

Root 已在三个时刻采样，只是没都存下来：

| 采样 | 时刻 | 说明 |
|---|---|---|
| `A_run` | `beginDelegation` | 每个 WorkerRun 一份，不是 Task 一份 |
| `C_report` | `handleWorkerResult` | worker 返回时 Root 自己的采样 |
| `C_now` | review / pass 边界 | 当下采样 |

两个独立的纯函数：

1. **Freshness** = `diff(C_report, C_now)`。只回答“报告之后有没有人动过”。无历史、无 lag 概念、无法被 worker 报的字段影响。
2. **Truth / scope** = `diff(A_run, C_report)` vs `report.changedFiles`。回答“worker 干的和说的是否一致、有没有越界”。lag 天然不存在——A_run 之前的东西不在这个 diff 里。

Validator 重派不改 A_run 没有影响，因为它不参与 freshness；只需提供新的 C。

事故场景在此分解下：A_run = `09c5955`（派发时 HEAD），C_report = `8bab410`，truth diff 只有 `.scratch/root-idle-phase/`，与报告一致；freshness diff 为空 → fresh。三轮 validator 不会发生。

无需 blame、无需 200 上限、worker 不可操纵；restored Task 若无 A_run → truth 标 `unverifiable`，而非 stale。

### 若坚持归因方案，以下洞是致命的

1. **“Worker-attributed” 判定机制未定义，而它决定整个方案的安全性。**
   - 按 committer 时间戳：rebase/amend 后失效。
   - 按“commit 路径 ⊆ report.changedFiles”：循环论证。worker 少报文件 → 该 commit 未归因 → 按“strictly before oldest attributed”归为 lag → 不进 `reasons`、不进 `undeclaredPaths`、reviewer 包不展示。worker 先单独 commit 未申报文件、再 commit 申报文件，前者被静默放过——恰恰漏掉 `undeclaredPaths` 要抓的东西。
   - 唯一可靠锚点仍是 Root 派发时看到的 HEAD（即 A_run）。
2. **A 不是 C 的祖先时**（worker rebase / force-push / 切分支）：first-parent walk 无结果，“fail closed to unsplit T2” = 退回今天的行为，事故原样重演。需显式检测 `merge-base` 为空 → `historyRewritten` → 一次 revalidate 带说明，而非无声退回。
3. **200 commit 上限 + fail closed**：繁忙 monorepo 上跨天 Task 轻松超限，又退回旧行为。
4. **Spin guard 终止条件缺失**：“相同 reason 不消耗 round”之后是无限循环。且 validator 重派不会改变 A/C，对 HEAD-changed / missing-paths 类 reason 必然得到相同结果——正确做法是这类 reason 直接跳过 revalidate、进 Root 仲裁。
5. **Reviewer patch base**：worker 既有 commit 又有未提交改动时，patch 应为 `parent(oldest)..working-tree`，而非 `..HEAD`。README “No full diff crosses the seam” 需同步，并定 size bound。
6. **A 时刻已存在的脏工作树**：派发时已在 `git status` 中的文件在 C 中仍在，今天会被判 unrelated/undeclared。`A_run.changedPaths` 应作为 pre-existing dirt 减掉，笔记未提。
7. **时序**：`decideReview` 取 `setLastComparison` 之前的 `previousComparison` 正确，但 `recordRootVerdict` 在 stale 时仍把 `pass` 写进 `task.reviews`，`previousComparison` 与 `reviews` 时序不一致会让 override 判定错位。

---

## 5. 代码审阅遗留问题（基于 GitHub main，需确认本地状态）

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 5.1 | `tool_result` 只处理 `toolName === "subagent"`；bg 启动时立即返回 handle，此刻抽不到 WorkerReport → 白烧一轮；真正结果经 `bg_wait` 回来被忽略，`delegations` 泄漏 | orchestrate.ts | Task 悬挂在 executing |
| 5.2 | `tasks` / `chain` payload：`delegationPrompt` 拼成一串，只抽一个 spec，一个 toolCallId 对一个 Task | roles.ts | N 个 child 输出混在一起只抽一个 report |
| 5.3 | `delegations` 查不到时直接 `return`，worker 结果不经检查进入 Root 上下文，无告警 | orchestrate.ts | 保证静默失效（ledger 若已覆盖此场景则降级为 P2） |
| 5.4 | `git status --porcelain` 路径相对 repo root，但 `normalizeEvidencePaths` 用 `resolve(cwd, path)`；cwd 为子目录时永远对不上；`core.quotePath` 引号路径未 unquote | evidence.ts | monorepo 永久 stale |
| 5.5 | `validateWorkerReportIdentity` 要求 `evidence.workerRunId === toolCallId`，但 TaskSpec 嵌入 prompt 时 toolCallId 尚不存在 | orchestrate.ts / report.ts | 填了该字段必被 reject |
| 5.6 | worker commit 后工作树干净 → `reportedPaths` 全进 `missingPaths` → revalidate；行为取决于 worker 是否把 `evidence.changedPaths` 写成 `[]` | evidence.ts | 常见指令“完成后 commit”必 stale（三采样方案可解） |
| 5.7 | 默认 warn 模式下无 TaskSpec 的 worker `conflict = false`，writer lock 不生效；锁按 cwd 精确匹配 | orchestrate.ts | “one writer per cwd” 仅 strict 成立 |
| 5.8 | `scope.allowedPaths` 只用于漂移分类；worker 改了 scope 外文件并如实上报，`reportedPaths` 并入 `scopePaths`，无 finding | evidence.ts | 编辑边界只是 prompt |
| 5.9 | `gitAvailable: false` 时 `reasons` 为空 → `fresh: true` | evidence.ts | 非 Git 目录零证据通过 |
| 5.10 | `probeGit` / `git_audit` diff-* 未加 `--no-ext-diff`、未禁 `core.fsmonitor` / `core.pager`；有 bash 的 worker 写 `.git/config` 即可在 Root 进程执行命令 | evidence.ts / git-audit.ts | 取决于威胁模型；防护免费 |
| 5.11 | `validator` remap 到 `oracle` 后有 bash，“may not edit files” 只靠 prompt | roles.ts | 应明确为信任边界而非执行边界 |
| 5.12 | 依赖 `tool_call` hook 对 `event.input` 就地修改被 host 采纳；remap 目标 agent 名硬编码，不存在时静默失效 | roles.ts | 与 §2 同源 |
| 5.13 | 每次 worker 返回 / review / pass 在 hook 内同步跑 4–5 条 git（各 15s 超时）；大仓库阻塞整个回合 | evidence.ts | 可并行、复用 probe、`status -uno` |
| 5.14 | `handleSubagentResult` 用 decision block 整体替换 worker 原始输出；`/planner-only off` 为用户级 marker，一关全关且泄漏 pending delegation | orchestrate.ts / index.ts | 可观测性 / 操作性 |

---

## 6. 统一抽象建议：`retryable`

两份笔记里的 spin guard 与 §2 的“环境失败不计费”是同一个需求。建议在 `advanceReview` 的输出上抽一个字段：

```ts
interface ReviewOutcome {
  action: "pass" | "request_changes" | "revalidate" | "blocked" | "arbitrate";
  /** 重派是否有可能改变结果。false 时不消耗 round、不 revalidate、直接 arbitrate。 */
  retryable: boolean;
  failureClass?: "worker" | "environment" | "contract";
}
```

`retryable = false` 的情形：工具集不匹配、子进程启动失败、HEAD-changed / missing-paths 类无法由 validator 改变的 stale reason、`historyRewritten`、identical reason 重复出现。由 `advanceReview` 单点决定，evidence 与 delegation 两处不再各做特判。

---

## 7. 建议实施顺序

1. **Evidence 三采样分解**（§4）：存 `A_run` / `C_report`，`compareEvidence` 拆成 `freshness()` 与 `truth()` 两个纯函数；同时顺带解决 5.4（用 `--show-toplevel` 归一化）、5.6、5.9。
2. **`retryable` / `failureClass`**（§6）+ **launch 后工具集校验**（§2.1）：把 oracle 事故这一类失败从 review loop 里剥离。
3. **Idle policy 的逃生口与 cwd 语义**（§3 A/B/C）先定，再实现 gather 阶段。
4. bg / `tasks` / `chain`：要么支持，要么 `tool_call` 阶段显式 block（5.1、5.2）。
5. 5.5、5.7、5.8：要么实现，要么改 README 使文档与代码一致。
6. 5.10 git 防护参数；5.13 并行化。

---

## 8. 待确认清单（本地版本）

- [ ] `planner_verdict` 是否已进 `PLANNER_SAFE_TOOLS`，且 pass 时走 Root 重采样
- [ ] ledger restore 是否覆盖 `delegations`（toolCallId → task）而不只是 Task store
- [ ] bg / `tasks` / `chain` 当前是支持、block 还是未处理
- [ ] `workerRunId` 校验是否仍在
- [ ] cwd 归一化是否已用 `--show-toplevel`
- [ ] `beginDelegation` 是否每个 WorkerRun 都重设 A（事故中 A 停在 `4dd63ca` 说明至少 restored / rebound 路径没有）
- [ ] `/planner-only off` 是否已改为项目级
