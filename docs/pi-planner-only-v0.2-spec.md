# pi-planner-only v0.2 Specification

> 目标：把当前 `pi-planner-only` 从“Planner-only tool guard + prompt policy”升级为一个**轻量、可靠、可验证的 Pi orchestration layer**。  
> 核心原则：**Root 只负责 Plan / Delegate / Inspect / Review；所有执行工作交给 Subagent。**  
> 本版本只吸收 `pi-advisor` 类项目中已经证明有价值的控制面机制，不引入其完整 background Advisor runtime。

---

## 1. 背景

当前 `pi-planner-only` 已经具备一个很好的最小架构：

```text
User
  │
  ▼
Root Pi
  ├── Plan
  ├── Delegate
  ├── Read-only Inspect
  └── Review
        │
        ▼
     Subagent
       ├── edit
       ├── write
       ├── bash
       ├── test
       └── validate
```

Root 通过两层机制被限制为 Planner / Reviewer：

1. 在模型调用前，从 active tool schema 中移除 `bash`、`edit`、`write` 等 mutating tools。
2. 在 `tool_call` 阶段再次执行 fail-closed policy，防止 stale/resumed/dynamic tool exposure 绕过限制。

这个设计应继续保留。

当前需要补足的问题主要不是“Root 会不会误执行”，而是：

- Worker 返回结果缺少稳定协议；
- Root Review 没有显式生命周期；
- Worker evidence 可能在 review 前失效；
- Worker 输出可能污染 Root context；
- 缺少标准化的 read-only Git 审计能力；
- 高风险任务缺少真正 fresh-context reviewer；
- 多轮 Worker ↔ Reviewer 修正缺少明确上限；
- 后续并行 Worker 时缺少 task identity / repo state tracking。

---

# 2. 设计目标

## 2.1 Goals

v0.2 应实现：

1. **结构化任务下发**
   - Root 向 Worker 发送标准 `TaskSpec`。
2. **结构化 Worker 回报**
   - Worker 返回标准 `WorkerReport`。
3. **显式 Review 状态机**
   - `PLAN → RUN → REVIEW → DONE/FIX/BLOCKED`。
4. **Evidence freshness 检测**
   - Review 前确认 Worker evidence 仍对应当前工作区状态。
5. **Context governor**
   - Worker 不应把完整 reasoning / shell log / test log 注入 Root。
6. **安全 Git 审计工具**
   - Root 可使用 `git_audit`，但仍不获得通用 `bash`。
7. **Optional Fresh Reviewer**
   - 高风险任务可使用独立 Reviewer subagent。
8. **有界 Review loop**
   - 防止无限 Worker ↔ Reviewer 循环。
9. **保持 extension 薄层化**
   - 不实现 background watcher、复杂持久化、nested long-lived AgentSession 等重型机制。

---

## 2.2 Non-goals

v0.2 **不实现**：

- 常驻后台 Advisor；
- 自动观察每个 Executor turn；
- 完整 review queue；
- lifecycle persistence；
- cost accounting system；
- telemetry；
- memory suggestion；
- background idle follow-up；
- 跨 session 长期 Reviewer conversation；
- 通用 workflow engine；
- DAG scheduler；
- 完整 multi-agent framework。

如果未来需要这些能力，应独立做新 extension，而不是继续膨胀 `pi-planner-only`。

---

# 3. 核心架构

```text
                             User
                               │
                               ▼
                        ┌──────────────┐
                        │   ROOT PI    │
                        │              │
                        │ Plan         │
                        │ Delegate     │
                        │ Inspect      │
                        │ Review       │
                        └──────┬───────┘
                               │
                            TaskSpec
                               │
                               ▼
                       ┌───────────────┐
                       │    Worker     │
                       │               │
                       │ edit/write    │
                       │ bash/test     │
                       │ validation    │
                       └──────┬────────┘
                              │
                         WorkerReport
                              │
                              ▼
                    ┌──────────────────┐
                    │ Evidence Fresh?  │
                    └───────┬──────────┘
                            │
                    ┌───────┴────────┐
                    │                │
                   yes              no
                    │                │
                    ▼                ▼
             Optional Fresh       Re-inspect /
                Reviewer          re-delegate
                    │
                    ▼
                 Root Review
                    │
             ┌──────┴─────────┐
             │                │
           PASS       REQUEST_CHANGES
             │                │
            DONE           Worker
```

---

# 4. 核心数据结构

建议新增：

```text
src/
  index.ts
  policy.ts
  task.ts
  review.ts
  git-audit.ts
  types.ts
```

当前项目规模较小，也可以先保持 flat layout。

---

## 4.1 TaskSpec

Root 创建并传给 Worker 的标准任务描述。

```ts
export interface TaskSpec {
  taskId: string;

  objective: string;

  cwd: string;

  role: "worker" | "explorer" | "validator" | "reviewer";

  scope: {
    allowedPaths?: string[];
    forbiddenPaths?: string[];
  };

  constraints: string[];

  acceptanceCriteria: string[];

  validation: {
    required: boolean;
    commands?: string[];
    expected?: string[];
  };

  expectedEvidence: {
    changedFiles?: boolean;
    diffStat?: boolean;
    gitRef?: boolean;
    tests?: boolean;
  };

  stopConditions: string[];

  parentEvidenceRef?: EvidenceRef;
}
```

### 要求

- `taskId` 必须唯一；
- Worker prompt 必须包含整个 `TaskSpec`；
- Worker 不应自行扩大 scope；
- 如果任务超出 scope，应返回 `blocked`，而不是自行修改不相关代码；
- Root 可以生成多个 TaskSpec，但默认同一 cwd 只允许一个 writer。

---

# 5. WorkerReport

Worker 返回 Root 的唯一标准输出。

```ts
export interface WorkerReport {
  version: 1;

  taskId: string;

  status:
    | "completed"
    | "partial"
    | "blocked"
    | "failed";

  summary: string;

  changedFiles: string[];

  validation: ValidationResult[];

  evidence: EvidenceRef;

  risks: string[];

  unresolved: string[];

  notes?: string[];
}
```

---

## 5.1 ValidationResult

```ts
export interface ValidationResult {
  command?: string;

  type:
    | "test"
    | "build"
    | "lint"
    | "typecheck"
    | "manual"
    | "other";

  status:
    | "passed"
    | "failed"
    | "not-run";

  exitCode?: number;

  summary: string;
}
```

---

## 5.2 EvidenceRef

```ts
export interface EvidenceRef {
  cwd: string;

  taskId: string;

  workerRunId: string;

  baseGitRef?: string;

  finalGitRef?: string;

  gitStatusHash?: string;

  changedPaths?: string[];

  diffStat?: string;

  generatedAt: string;
}
```

### 说明

`EvidenceRef` 不要求工作区一定有 commit。

对于 dirty worktree，可以使用：

```text
baseGitRef = HEAD
gitStatusHash = hash(git status --porcelain=v2)
changedPaths = [...]
```

必要时进一步加入：

```text
diffHash = sha256(git diff ...)
```

v0.2 可以先不实现完整 diff hash。

---

# 6. Worker 输出约束

Root context 不应接收：

- Worker chain-of-thought；
- 完整 shell transcript；
- 完整测试 log；
- 大段 diff；
- 无关探索过程；
- 多次失败尝试的原始日志。

Root 应只收到：

```text
WorkerReport
+
必要的短 evidence summary
```

建议默认限制：

```ts
maxWorkerReportChars = 12000
```

或：

```ts
maxWorkerReportTokens ≈ 3000
```

如果 Worker 产生超大输出：

1. Worker 自行压缩；
2. 保留错误核心；
3. 保留 test command + exit code；
4. Root 必要时通过 read / grep / git_audit 自行验证。

---

# 7. Task State Machine

新增显式生命周期：

```ts
export type TaskState =
  | "planning"
  | "executing"
  | "reviewing"
  | "changes_requested"
  | "blocked"
  | "completed"
  | "failed";
```

正常流：

```text
PLANNING
   │
   ▼
EXECUTING
   │
   ▼
REVIEWING
   │
   ├── PASS ───────────────► COMPLETED
   │
   ├── REQUEST_CHANGES ────► EXECUTING
   │
   └── BLOCKED ────────────► BLOCKED
```

---

## 7.1 Review round limit

配置：

```ts
maxReviewRounds = 3
```

定义：

```text
Worker initial run       = round 0
First requested fix      = round 1
Second requested fix     = round 2
Third requested fix      = round 3
```

超过最大次数：

```text
status = blocked
```

Root 应向用户报告：

- 已完成内容；
- 当前未解决问题；
- 已执行的修正次数；
- 最后的 evidence；
- 为什么停止自动修正。

---

# 8. ReviewResult

```ts
export interface ReviewResult {
  taskId: string;

  verdict:
    | "pass"
    | "request_changes"
    | "blocked";

  summary: string;

  findings: ReviewFinding[];

  evidenceFresh: boolean;

  reviewedEvidenceRef?: EvidenceRef;
}
```

---

## 8.1 ReviewFinding

```ts
export interface ReviewFinding {
  severity:
    | "blocker"
    | "major"
    | "minor"
    | "info";

  category:
    | "correctness"
    | "scope"
    | "test"
    | "safety"
    | "regression"
    | "maintainability"
    | "other";

  description: string;

  requestedChange?: string;

  evidence?: string[];
}
```

默认规则：

- `blocker` / `major` → `request_changes`
- 只有 `minor/info` → Root 可自行决定 PASS
- Reviewer 不修改代码

---

# 9. git_audit Tool

## 9.1 Motivation

Root 需要进行 review，但不应重新获得通用：

```text
bash
```

因此新增：

```text
git_audit
```

作为受控 read-only Git tool。

---

## 9.2 API

```ts
interface GitAuditInput {
  operation:
    | "status"
    | "diff-stat"
    | "diff-names"
    | "diff-check"
    | "head"
    | "log";

  cwd?: string;

  staged?: boolean;

  maxEntries?: number;
}
```

---

## 9.3 内部允许的命令

仅允许固定模板：

```bash
git status --porcelain=v2 --branch
git diff --stat
git diff --name-status
git diff --check
git rev-parse HEAD
git log --oneline -n N
```

可选 staged：

```bash
git diff --cached --stat
git diff --cached --name-status
git diff --cached --check
```

---

## 9.4 禁止

`git_audit` 不允许：

```text
git commit
git add
git reset
git checkout
git switch
git restore
git clean
git rebase
git merge
git cherry-pick
git push
git pull
git fetch
git config
```

也不得允许：

- shell metacharacters；
- command substitution；
- arbitrary args；
- arbitrary subcommands。

---

# 10. Evidence Freshness

这是 v0.2 的关键可靠性机制。

Worker 完成时：

```text
baseGitRef
finalGitRef
gitStatusHash
changedPaths
```

Root Review 前再次采样当前状态。

---

## 10.1 最小 stale 判断

```ts
function isEvidenceStale(
  report: WorkerReport,
  current: EvidenceRef
): boolean
```

满足以下任一条件 → stale：

1. `cwd` 不一致；
2. 当前 `HEAD !== finalGitRef`；
3. 当前 changed paths 与 Worker report 显著不同；
4. `gitStatusHash` 不一致；
5. 用户 / 另一个 worker 在 Worker 完成后修改了相关文件；
6. task 已被 superseded。

---

## 10.2 stale 后行为

不要直接把旧 report 判 PASS。

流程：

```text
WorkerReport
    │
    ▼
Evidence stale?
    │
   yes
    │
    ▼
Root re-inspect
    │
    ├── changes unrelated
    │      └── continue review
    │
    └── changes overlap task scope
           └── re-delegate validation
```

默认策略：

```text
overlapping stale evidence
→ request fresh validation
```

---

# 11. Fresh Reviewer

## 11.1 原则

Fresh Reviewer **不是默认常驻 Advisor**。

它是：

```text
on-demand isolated review subagent
```

用于减少 Root 同时 Plan + Review 带来的 confirmation bias。

---

## 11.2 Review Mode

```ts
export type ReviewMode =
  | "root"
  | "fresh";
```

默认：

```text
reviewMode = root
```

---

## 11.3 自动启用 fresh review 的建议条件

未来可以支持：

```ts
freshReviewWhen = {
  highRisk: true,
  largeDiff: true,
  securitySensitive: true,
  repeatedFailure: true
}
```

v0.2 可以先手动指定：

```text
reviewMode: fresh
```

---

## 11.4 Fresh Reviewer 权限

建议仅允许：

```text
read
grep
find
ls
git_audit
```

禁止：

```text
edit
write
bash
subagent
```

Reviewer 必须是：

```text
fresh context
```

Reviewer 输入只包括：

1. TaskSpec
2. WorkerReport
3. Acceptance criteria
4. Relevant evidence refs
5. 必要文件路径

不要把 Root 的完整 reasoning transcript 传给 Reviewer。

---

# 12. Root Arbitration

Fresh Reviewer 返回后，Root 仍然负责最终决策。

```text
Worker
  │
  ▼
Fresh Reviewer
  │
  ▼
ReviewResult
  │
  ▼
Root
  ├── accept PASS
  ├── request changes
  └── override reviewer with evidence
```

Root override 时，建议在内部状态记录：

```ts
{
  reviewerVerdict: "request_changes",
  rootVerdict: "pass",
  overrideReason: "..."
}
```

v0.2 不必持久化到磁盘。

---

# 13. Role Capability Profiles

建议逐步将 subagent 角色显式化。

---

## 13.1 Explorer

```text
read
grep
find
ls
```

用途：

- repo exploration；
- architecture discovery；
- locating relevant files。

不能写代码。

---

## 13.2 Worker

```text
read
grep
find
ls
edit
write
bash
```

用途：

- implementation；
- tests；
- builds；
- fixes。

需要 cwd / scope boundary。

---

## 13.3 Validator

```text
read
grep
find
ls
bash
```

用途：

- test；
- build；
- lint；
- benchmark；
- runtime validation。

不能修改文件。

---

## 13.4 Reviewer

```text
read
grep
find
ls
git_audit
```

不能修改文件。

---

# 14. One Writer Per CWD

当前 prompt 已有：

```text
Keep one writer per cwd.
Use isolated worktrees for concurrent writers.
```

v0.2 应把这条规则从 prompt policy 升级为 orchestration invariant。

---

## 14.1 规则

同一时刻：

```text
cwd A
→ max 1 Worker with write capability
```

允许：

```text
cwd A → 1 writer + N readers/reviewers
```

并行 writers 必须：

```text
different worktrees
```

---

## 14.2 v0.2 实现

如果当前 `pi-subagents` runtime 已经能识别 active children：

```ts
assertNoActiveWriter(cwd)
```

如果 API 不方便：

v0.2 可先保持 prompt + TaskState bookkeeping。

---

# 15. Parent Tool Policy

Root 当前工具设计继续保留：

```text
read
grep
find
ls
subagent
subagent_wait
bg_wait
subagent_supervisor
contact_supervisor
question
questionnaire
```

新增：

```text
git_audit
```

Root 永远不暴露：

```text
edit
write
bash
```

除非用户显式：

```text
/planner-only off
```

---

# 16. Prompt Contract

现有 `PLANNER_PROMPT` 应升级，但保持短小。

建议：

```text
[PLANNER-ONLY MODE]

You are the root orchestrator.

You may:
- plan
- delegate
- inspect using read-only tools
- review
- arbitrate

You may not:
- edit files
- write files
- execute general shell commands
- implement fixes directly

For executable work, create a bounded TaskSpec and delegate it.

Every worker must return a WorkerReport containing:
- status
- concise summary
- changed files
- validation and exit codes
- evidence references
- risks
- unresolved items

Before accepting work:
1. verify WorkerReport task identity
2. verify evidence freshness
3. inspect relevant files / git state
4. evaluate acceptance criteria
5. PASS or REQUEST_CHANGES

Never fix rejected work yourself.
Delegate a bounded correction.

Stop automatic correction after maxReviewRounds.
```

---

# 17. Commands

保留：

```text
/planner-only status
/planner-only on
/planner-only off
```

建议新增：

```text
/planner-only task
/planner-only review
```

---

## 17.1 `/planner-only task`

显示当前 task：

```text
Task: T-20260831-001
State: reviewing
Worker round: 1/3
Review mode: root
Evidence: fresh
Changed files: 4
```

如果没有 task：

```text
No active planner-only task.
```

---

## 17.2 `/planner-only review`

可选参数：

```text
/planner-only review root
/planner-only review fresh
```

作用：

切换当前 task 的 review mode。

v0.2 如果实现复杂，可暂缓。

---

# 18. 配置

建议配置文件：

```text
~/.pi/agent/planner-only.yml
```

示例：

```yaml
version: 1

enabled: true

maxReviewRounds: 3

workerReport:
  maxChars: 12000

review:
  mode: root

gitAudit:
  enabled: true

freshReviewer:
  enabled: true
```

如果不想增加配置复杂度，v0.2 第一版也可以 hard-code 默认值。

建议优先级：

```text
correctness > configurability
```

---

# 19. Failure Handling

## 19.1 Worker failed

WorkerReport：

```json
{
  "status": "failed"
}
```

Root：

- 不直接修；
- 判断是否需要 retry；
- retry 必须是新的 bounded TaskSpec；
- review round +1。

---

## 19.2 Worker blocked

例如：

```text
missing dependency
missing credentials
unclear API
scope conflict
```

Root：

- 可重新规划；
- 不把 blocked 当 failed；
- 如需要用户输入则询问用户。

---

## 19.3 Malformed WorkerReport

如果 Worker 未按 schema 返回：

```text
do not accept
```

Root 可做一次：

```text
report-only correction
```

要求 Worker：

```text
Do not modify files.
Return only a valid WorkerReport for task <id>.
```

---

## 19.4 Evidence unavailable

如果 repo 不是 Git：

```text
EvidenceRef.git* fields optional
```

退化到：

```text
changed paths
file mtimes/hash
validation summary
```

v0.2 可以只报告：

```text
git evidence unavailable
```

不阻止使用。

---

# 20. Security Requirements

必须满足：

1. Parent mutating tools 不进入 model schema；
2. `tool_call` policy 保持 defense-in-depth；
3. `git_audit` 不接受 arbitrary shell；
4. Fresh Reviewer 无 mutating tools；
5. Worker 的 cwd / allowedPaths 明确；
6. 不信任 Worker 自报 PASS；
7. Root 必须 independently inspect evidence；
8. stale WorkerReport 不可直接作为 final acceptance 依据；
9. unknown tool 默认 blocked；
10. child privilege 不应无意继承 parent extension policy。

---

# 21. Implementation Plan

## Phase 1 — Structured reports

### 实现

- [ ] `types.ts`
- [ ] `TaskSpec`
- [ ] `WorkerReport`
- [ ] `ValidationResult`
- [ ] `EvidenceRef`
- [ ] 更新 Planner prompt
- [ ] Worker report size limit

### Acceptance

给 Worker 一个简单代码修改任务后：

Root 最终拿到：

```text
taskId
status
summary
changedFiles
validation
evidence
risks
unresolved
```

而不是自由文本长日志。

---

## Phase 2 — Review state machine

### 实现

- [ ] `TaskState`
- [ ] `ReviewResult`
- [ ] review round counter
- [ ] `maxReviewRounds`
- [ ] blocked exit path

### Acceptance

模拟：

```text
Worker → fail review → Worker → pass
```

状态必须严格：

```text
executing
→ reviewing
→ changes_requested
→ executing
→ reviewing
→ completed
```

---

## Phase 3 — git_audit

### 实现

- [ ] register `git_audit`
- [ ] fixed operations
- [ ] cwd validation
- [ ] output bounds
- [ ] tests for injection rejection

### Acceptance

允许：

```text
git_audit(status)
git_audit(diff-stat)
git_audit(diff-check)
git_audit(head)
```

不允许构造任何 mutating Git operation。

---

## Phase 4 — Evidence freshness

### 实现

- [ ] capture evidence before Worker
- [ ] capture evidence after Worker
- [ ] compare before Review
- [ ] stale → revalidate

### Acceptance

场景：

1. Worker 完成修改；
2. 外部再修改同一文件；
3. Root Review；
4. 系统必须标记 stale；
5. 不允许直接 PASS。

---

## Phase 5 — Fresh Reviewer

### 实现

- [ ] reviewer role
- [ ] read-only tool profile
- [ ] bounded reviewer prompt
- [ ] `ReviewResult`
- [ ] root arbitration

### Acceptance

Reviewer：

- 没有 Root 原 reasoning；
- 没有 Worker reasoning；
- 只能读 evidence；
- 不可 edit；
- 返回 PASS / REQUEST_CHANGES；
- Root 负责最终 verdict。

---

# 22. Tests

当前项目已经有：

```text
index.test.mjs
policy.test.mjs
naming.test.mjs
```

建议新增：

```text
task.test.mjs
review.test.mjs
git-audit.test.mjs
evidence.test.mjs
```

---

## 22.1 Required test cases

### Tool guard

- Root `edit` blocked
- Root `write` blocked
- Root generic `bash` blocked
- Root `git_audit` allowed
- Child not incorrectly restricted by planner-only extension

### WorkerReport

- valid report accepted
- missing taskId rejected
- mismatched taskId rejected
- oversized report rejected / compacted

### State machine

- normal pass
- one correction then pass
- max review rounds
- worker blocked
- malformed report

### Evidence

- unchanged evidence → fresh
- HEAD changed → stale
- status changed → stale
- unrelated file change policy
- overlapping file change → stale

### git_audit security

reject:

```text
; rm -rf
&&
|
$()
backticks
git reset
git checkout
git commit
git clean
```

---

# 23. Recommended v0.2 Scope

为了避免 scope creep，建议 v0.2 最终只包含：

```text
1. TaskSpec
2. WorkerReport
3. ReviewResult
4. TaskState
5. maxReviewRounds
6. git_audit
7. Evidence freshness
8. Optional fresh reviewer
```

不要加入：

```text
background advisor
persistent reviewer session
complex queues
telemetry
cost engine
memory
DAG workflow
```

---

# 24. Design Philosophy

最终 `pi-planner-only` 应保持：

```text
Small policy layer
not
Another agent framework
```

其职责是强制：

```text
Root = Think + Coordinate + Verify

Worker = Execute

Reviewer = Verify independently when needed
```

而不是把所有 Agent 行为都吸收到 extension 内部。

---

# 25. Target End State

```text
                          ┌─────────────┐
                          │    User     │
                          └──────┬──────┘
                                 │
                                 ▼
                       ┌──────────────────┐
                       │     ROOT PI      │
                       │                  │
                       │ Plan             │
                       │ Delegate         │
                       │ Inspect          │
                       │ git_audit        │
                       │ Arbitrate        │
                       └────────┬─────────┘
                                │
                             TaskSpec
                                │
                                ▼
                       ┌─────────────────┐
                       │     Worker      │
                       │                 │
                       │ edit/write/bash │
                       │ test/validate   │
                       └────────┬────────┘
                                │
                           WorkerReport
                                │
                                ▼
                       Evidence freshness
                                │
                     ┌──────────┴──────────┐
                     │                     │
                   fresh                  stale
                     │                     │
                     ▼                     ▼
          optional Fresh Reviewer      revalidate
                     │
                     ▼
                  Root Review
                     │
            ┌────────┴─────────┐
            │                  │
           PASS        REQUEST_CHANGES
            │                  │
          Final             Worker
```

---

# 26. Definition of Done

`pi-planner-only v0.2` 可以认为完成，当且仅当：

- [ ] Root 无法直接修改文件；
- [ ] Root 无法执行通用 shell；
- [ ] 所有执行工作均由 subagent 完成；
- [ ] Root 下发结构化 TaskSpec；
- [ ] Worker 返回结构化 WorkerReport；
- [ ] Root 只接收 bounded evidence；
- [ ] Review 有显式状态；
- [ ] Review loop 有最大次数；
- [ ] Root 可以安全执行 Git read-only audit；
- [ ] Worker evidence 可以被 freshness 检查；
- [ ] stale evidence 不可直接 PASS；
- [ ] Fresh Reviewer 可选启用；
- [ ] Fresh Reviewer 无 mutating tools；
- [ ] Root 保留最终 arbitration 权；
- [ ] 原有 `/planner-only on/off/status` 正常工作；
- [ ] 原有 policy tests 全部通过；
- [ ] 新增核心 lifecycle / security tests 全部通过。

---

# 27. 建议版本路线

```text
v0.1
Planner-only guard
    ↓
v0.2
Structured orchestration
    ↓
v0.3
Role profiles + worktree-aware concurrency
    ↓
v0.4
Optional richer workflow policies
```

建议不要在 v0.2 之后自然演变成一个“大而全 Agent framework”。

如果未来确实需要：

```text
Planner → Worker → Fresh Reviewer → Retry → Final
```

作为严格工作流引擎，可以在 `pi-planner-only` 之上再做一层：

```text
pi-workflow
```

其中：

```text
pi-planner-only
= safety / role boundary

pi-workflow
= orchestration lifecycle
```

这种分层会比把两者合成一个 extension 更容易长期维护。
