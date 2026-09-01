# pi-planner-only

[English](README.md) · 中文

[Pi](https://pi.dev) 扩展：把 **root 会话** 限制为规划与审核。改文件、跑 shell、跑测试一律交给 subagent。

守卫开启时，父进程的工具 schema 里不会出现 `bash`、`edit`、`write`。`tool_call` 策略是第二道门，挡住过期或恢复会话里的调用。子进程以 `--no-extensions` 启动；扩展在 `PI_SUBAGENT_CHILD=1` 时直接 no-op。

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
# 或本次运行试用、不安装
pi -e ./index.ts
```

## 命令

- `/planner-only status`
- `/planner-only on`
- `/planner-only off`
- `/planner-only task [taskId]` — 任务生命周期
- `/planner-only review [taskId] [root|fresh|pass|request_changes|blocked] [summary]`

非交互关闭：`PI_PLANNER_ONLY=0 pi`。持久关闭标记：`~/.pi/agent/planner-only.off`。

`/planner-only off` 只恢复本扩展拿掉的工具。`session_shutdown` 时会还原工具集，方便 reload 重新采集完整列表。

## 父进程可用工具

存在则保留：`read`、`grep`、`find`、`ls`、`git_audit`、`subagent`、`bg_wait`、`subagent_wait`、`subagent_supervisor`、`contact_supervisor`、`question`、`questionnaire`。

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

拦截 `subagent`：登记任务、采样工作区；同一 cwd 上第二个声明为 `worker` 的委托会被拦住（one writer per cwd）。受限角色会 remap 到工具面匹配的 builtin agent：

| 角色 | Builtin agent | 子进程工具 |
|---|---|---|
| `worker` | 不改 | agent 自己的 allowlist |
| `explorer` / `reviewer` | `reviewer` | read, grep, find, ls |
| `validator` | `oracle` | read, grep, find, ls, bash |

`reviewer` 子进程一律 `context: "fresh"`，任务包只有 TaskSpec + WorkerReport + evidence，不会 fork 父会话。任务包是 `ReviewRequest`：对 Task 的一次调用，绝不是新的 TaskSpec。Task 的原始 role、objective、spec 在 worker / reviewer / validation 各轮中保持不变。

Worker 必须返回带 version 的 `WorkerReport`。父进程抽取、超过 12k 字符则压缩、检查 evidence 新鲜度，并附上下一步 review 动作。畸形输出只允许一次 report-only 修正，第二次直接 blocked。

### 任务身份与 PASS 边界

两份子契约都要与所属委派对账：

- `WorkerReport` 只有在 `taskId`、`evidence.taskId` 以及（存在时的）`evidence.workerRunId` 与被委派任务和 subagent 调用一致时才被接受。结构合法但属于别的任务的报告按畸形处理：不存储，只给一次 report-only 修正。
- `ReviewResult` 只有在 `taskId` 与被评审任务一致时才被记录；不匹配的裁决不落库、任何状态都不变。

证据只在接受边界权威。Root 每次 `pass` 都在接受前重新采样工作区并与最新报告比对——worker 返回时的新鲜度说明不了现在。证据过期则强制 `revalidate` 而非完成；fresh reviewer 的 `evidenceFresh: true` 永远绕不过这道 Root 侧检查。

### 严格委派（可选）

默认允许没有内嵌 `TaskSpec` 的 worker 委派，但会告警。设 `PI_PLANNER_ONLY_STRUCTURED_DELEGATION=strict` 则直接阻断。explorer 始终宽松；validator 两种模式都只告警。

Reviewer 没有 `git_audit`（子进程以 `--no-extensions` 启动，该工具属于父扩展）。Root 自己采样 Git，把有界证据包——HEAD、status、变更文件、diff stat、diff check——放进 `ReviewRequest`；reviewer 只用 `read`/`grep`/`find`/`ls`。默认不传全量 diff。

Review 状态：`planning → executing → reviewing → completed | changes_requested | blocked`。最多 3 轮修正（`MAX_REVIEW_ROUNDS`）。范围内 stale evidence 不能直接 PASS。Root 可以覆盖 reviewer，覆盖记录只留在内存。

### git_audit

仅父进程可用的只读 Git：`status`、`diff-stat`、`diff-names`、`diff-check`、`head`、`log`。固定 argv，不走 shell，mutating 子命令一律拒绝。

## 测试

```bash
npm test          # 单元 + 进程内集成
npm run test:e2e  # 真实 pi-subagents 契约（未安装则跳过）
```

E2E 套件针对已安装的 `pi-subagents` 包运行——builtin agent 工具面、子进程启动 argv（`--no-extensions`、工具上限、fresh 会话）、以及 planner 改写的负载字段——不发起任何模型调用。

## 模块

| 文件 | 职责 |
|---|---|
| `types.ts` | `TaskSpec`、`WorkerReport`、`EvidenceRef`、`ReviewResult`、`ReviewRequest` |
| `policy.ts` | 父进程工具白名单与 `tool_call` 决策 |
| `task.ts` | 校验、压缩、状态机、写锁 |
| `report.ts` | `WorkerReport` 抽取、压缩、身份校验 |
| `review.ts` | 裁决、review 循环、fresh-review 任务包 |
| `roles.ts` | TaskRole 画像与 agent remap |
| `evidence.ts` | Git 探测、新鲜度、review 证据包 |
| `git-audit.ts` | `git_audit` 解析与输出上限 |
| `orchestrate.ts` | 委派启动、review 循环、Task 存储写入 |
| `index.ts` | hook、工具、命令 |

不做后台 Advisor、持久化、队列或 telemetry。
