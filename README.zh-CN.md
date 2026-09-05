# pi-planner-only

[English](README.md) · 中文

[Pi](https://pi.dev) 扩展：把 **root 会话** 限制为规划与审核。改文件、跑 shell、跑测试一律交给 subagent。

守卫开启时，父进程的工具 schema 里不会出现 `bash`、`edit`、`write`。`tool_call` 策略是第二道门，挡住过期或恢复会话里的调用。前台子进程不加载 ambient 扩展；后台子进程可能会加载。本扩展在 `PI_SUBAGENT_CHILD=1` 时直接 no-op。

v0.2 在守卫之上加了一层薄编排：结构化 `TaskSpec` / `WorkerReport`、有界 review 循环、只读 `git_audit`、evidence 新鲜度，以及隔离的 Fresh Reviewer。v0.2.x 加固序列收紧了生命周期接缝：两份子契约都做任务身份校验、每次 PASS 在接受边界由 Root 重新采样证据、reviewer 调用不再改写 Task、可选的严格委派模式。

## 安装

```bash
pi install https://github.com/bioShaun/pi-planner-only    # 用户级
# 或
pi install https://github.com/bioShaun/pi-planner-only -l # 项目级
```

然后重启 Pi，或执行 `/reload`。

SSH 也可以：`pi install git:git@github.com:bioShaun/pi-planner-only`。

```bash
pi update https://github.com/bioShaun/pi-planner-only
pi remove https://github.com/bioShaun/pi-planner-only
```

**不要**再把本仓库拷进 `~/.pi/agent/extensions/`，否则 Pi 会加载两次。

本地开发：

```bash
pi install /path/to/pi-planner-only
# 或本次运行试用整个包、不安装
pi -e .
```

`typebox` 和 `@earendil-works/pi-coding-agent` 是 peerDependencies：由 Pi 运行时提供，不要放进 `dependencies`。

## 命令

- `/planner-only status`
- `/planner-only on`
- `/planner-only off`
- `/planner-only task [taskId]` — 任务生命周期
- `/planner-only task abandon|reset <taskId>` — 放弃活跃或指定任务
- `/planner-only review [taskId] [root|fresh|pass|request_changes|blocked] [summary]`
- `/planner-only usage [taskId | session | reload]`

单次会话覆盖：`PI_PLANNER_ONLY=1`（亦支持 `true`、`on`）无论是否存在标记均强制开启；`PI_PLANNER_ONLY=0`（`false`、`off`）禁用。持久关闭标记：`~/.pi/agent/planner-only.off`。

`/planner-only off` 只恢复本扩展拿掉的工具。`session_shutdown` 时会还原工具集，方便 reload 重新采集完整列表。

## 父进程可用工具

存在则保留：`read`、`grep`、`find`、`ls`、`git_audit`、`planner_verdict`、`subagent`、`bg_wait`、`subagent_wait`、`subagent_supervisor`、`contact_supervisor`、`question`、`questionnaire`。

拦截：`edit`、`write`、通用 `bash`、未知 mutator，以及 `subagent` 的宿主机命令路径（如 `workflow: "run-ci"`、`gate`）。

`tool_call` 策略里仍有一小段 git/`pwd` 白名单，只防过期调用。模型 schema 里不会出现 `bash`。

## v0.2 编排

父进程把 `TaskSpec` JSON 嵌进 subagent 任务：

```json
{
  "taskId": "T-20260831-001",
  "objective": "Add a CSV parser",
  "cwd": "/repo",
  "role": "worker",
  "scope": { "allowedPaths": ["src/parser.ts"] },
  "constraints": ["no new dependencies"],
  "acceptanceCriteria": ["empty input returns []"],
  "validation": { "required": true, "commands": ["npm test"] },
  "expectedEvidence": { "changedFiles": true, "tests": true },
  "stopConditions": ["ask if the schema is ambiguous"]
}
```

拦截 `subagent`：登记任务、采样工作区；同一 cwd 上第二个声明为 `worker` 的委托会被拦住（one writer per cwd）。taskId 若缺失、格式不对或日期不是当天，扩展会替换为生成的 id，原 id 作为 alias 保留，委派结果里会告知。受限角色会 remap 到工具面匹配的 builtin agent：

| 角色 | Builtin agent | 子进程工具 |
|---|---|---|
| `worker` | 不改 | agent 自己的 allowlist |
| `explorer` / `reviewer` | `reviewer` | read, grep, find, ls |
| `validator` | `oracle` | read, grep, find, ls, bash |

`reviewer` 子进程一律 `context: "fresh"`，任务包只有 TaskSpec + WorkerReport + evidence，不会 fork 父会话。任务包是 `ReviewRequest`：对 Task 的一次调用，绝不是新的 TaskSpec。Task 的原始 role、objective、spec 在 worker / reviewer / validation 各轮中保持不变。validator 委派是对被审 Task 的调用，不会新建 Task，其报告记录在该 Task 的 validatorReports。

Worker 必须返回带 version 的 `WorkerReport`。父进程抽取、超过 12k 字符则压缩、检查 evidence 新鲜度，并附上下一步 review 动作。常见偏差会被自动规范化，修补项以 `Report normalised:` 行回显。畸形输出只允许一次 report-only 修正，第二次直接 blocked。

### 任务身份与 PASS 边界

两份子契约都要与所属委派对账：

- `WorkerReport` 只有在 `taskId`、`evidence.taskId` 以及（存在时的）`evidence.workerRunId` 与被委派任务和 subagent 调用一致时才被接受。结构合法但属于别的任务的报告按畸形处理：不存储，只给一次 report-only 修正。
- `ReviewResult` 只有在 `taskId` 与被评审任务一致时才被记录；不匹配的裁决不落库、任何状态都不变。

证据只在接受边界权威。Root 在委派开始时采样 Git（A），在结果处理或 Root `pass` 时再采一次（C）。A 到 C 的差集是 scope 分母；Worker 的 `changedFiles` 和 Git 指纹只是声明，交叉核对但不作权威。Worker 缺 `gitStatusHash` / `finalGitRef` 不会关掉 Root 归因。证据过期或不可验证则强制 `revalidate` 而非完成；fresh reviewer 的 `evidenceFresh: true` 永远绕不过这道 Root 侧检查。cwd 写锁只做精确路径相等：重叠 worktree 是已知的归因限制。

### 严格委派（可选）

默认允许没有内嵌 `TaskSpec` 的 worker 委派，但会告警。设 `PI_PLANNER_ONLY_STRUCTURED_DELEGATION=strict` 则直接阻断。explorer 始终宽松；validator 两种模式都只告警。

Reviewer 没有 `git_audit`（前台子进程不加载 ambient 扩展，该工具属于父扩展）。Root 自己采样 Git，把有界证据包——HEAD、status、当前变更文件、A-to-C 归因/漏报/多报路径、diff stat、diff check——放进 `ReviewRequest`；reviewer 只用 `read`/`grep`/`find`/`ls`。默认不传全量 diff。

Review 状态：`planning → executing → reviewing → completed | changes_requested | blocked`。Root 使用 `planner_verdict` 记录裁决：blocked / failed 的 Task 只要有已记录的报告就可以直接 pass；completed 是唯一终态。最多 3 轮修正（`MAX_REVIEW_ROUNDS`）。范围内 stale evidence 不能直接 PASS。Root 可以覆盖 reviewer，覆盖记录只留在内存。

### 复合工作流

执行型 `subagent` 调用若带有非空的 `workflowScript`、`workflowScriptPath`、
`workflow`，或非空的 `tasks` / `chain` 数组，会在启动前被拒绝。planner-only
无法审计或改写这些内部步骤，也不会解析 JavaScript `workflowScript`。每个生命
周期阶段必须是独立的直接 `{agent, task}` 调用：先等待 worker 的
`WorkerReport`，再直调 reviewer，确保它拿到最新的 TaskSpec、WorkerReport 和
Root Git 证据。带 `action` 的管理或 `validate` 调用保持不变。

### git_audit

仅父进程可用的只读 Git：`status`、`diff-stat`、`diff-names`、`diff-check`、`head`、`log`。固定 argv，不走 shell，mutating 子命令一律拒绝。

### 用量核算

Token 数为准，美元/人民币金额是推导值。扩展跟踪 Root 各生命周期阶段（`planning`、`executing`、`reviewing`）的轮次与 Token、子进程各委派运行的消耗、审核期间只读工具产生的审查泄漏字节（review leak bytes），以及注入 prompt 的字节数。

成本按以下优先级解析：
1. 模型供应商/平台原生上报（Pi core 的 `usage.cost` 或 `pi-subagents` 的 `cost`）；
2. 插件定价表 `~/.pi/agent/planner-only/pricing.json`（可通过 `PI_PLANNER_ONLY_PRICING` 覆盖）；
3. 若均无对应费率，则标记为成本未知（`cost unknown`，绝不展示为 `$0.00`）。

定价表格式：

```json
{
  "version": 1,
  "currency": "USD",
  "rates": {
    "example-provider/expensive-root-model": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 },
    "example-provider/cheap-worker-model":   { "input": null, "output": null, "cacheRead": null, "cacheWrite": null }
  }
}
```

- 键为 `provider/model` 或单独的 `model` 名称。
- 费率为 `currency`（`USD` 或 `CNY`）下每百万 Token 的价格。
- 费率为 `null` 表示费率未知（展示为 `cost unknown`）；`0` 表示免费。
- 以 `_` 开头的键会被忽略（可用于注释）。
- 可在会话内通过 `/planner-only usage reload` 重新加载费率表。

**替代方案：** 推荐直接在 `~/.pi/agent/models.json` 里配置 `cost`。这样 Pi 和 `pi-subagents` 的原生命令（如 `/subagent-cost`）都能直接计价。插件自带的定价表仅作为不需要改动 `models.json` 时的备用与覆盖机制。

## 设计规范

- [v0.2 规范](docs/pi-planner-only-v0.2-spec.md)：核心协议与架构。
- [Evidence Authority 规范](docs/pi-planner-only-evidence-authority-spec.md)：Root 负责委派归因的证据语义。
- [P0/P1 加固规范](docs/pi-planner-only-p0-p1-hardening-spec.md)：证据、生命周期与信任边界加固。

## 测试

```bash
npm test          # 单元 + 进程内集成（不包含 E2E）
npm run typecheck # tsc --noEmit（Pi 直接加载 .ts；这是本地类型检查）
npm run test:e2e  # 真实 pi-subagents 契约（需要已安装，否则会明确跳过）
```

`npm test` 不验证运行时角色降权映射。该覆盖仅由 `test:e2e` 执行；未安装
`pi-subagents` 时，角色降权仍未验证。

E2E 套件针对已安装的 `pi-subagents` 包运行——builtin agent 工具面、公开子路径 `child-tool-plan` 的启动映射（工具上限、前台子进程与 ambient 扩展隔离）、以及 planner 改写的负载字段——不发起任何模型调用。缺包或版本不在声明范围内会打印 SKIP 行并以 0 退出。

## 模块

| 文件 | 职责 |
|---|---|
| `types.ts` | `TaskSpec`、`WorkerReport`、`EvidenceRef`、`ReviewResult`、`ReviewRequest` |
| `policy.ts` | 父进程工具白名单与 `tool_call` 决策 |
| `task.ts` | 校验、压缩、状态机、写锁 |
| `report.ts` | `WorkerReport` 抽取、压缩、身份校验 |
| `review.ts` | 裁决、review 循环、fresh-review 任务包 |
| `roles.ts` | TaskRole 画像与 agent remap |
| `evidence.ts` | Git 探测、A-to-C 归因、review 证据包 |
| `git-audit.ts` | `git_audit` 解析与输出上限 |
| `orchestrate.ts` | 委派启动、review 循环、Task 存储写入 |
| `notify.ts` | 异步 subagent 通知与子进程元数据解析 |
| `usage.ts` | 纯用量账本、Token 与成本核算、报告渲染 |
| `index.ts` | hook、工具、命令 |

不做后台 Advisor、持久化、队列或 telemetry。
