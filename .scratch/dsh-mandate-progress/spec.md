# Native：Mandate ≠ Assignment + progress 状态枚举（对照 dsh，不落账本）

状态：用户已确认两件优先落地；实施票 [01](issues/01-mandate-status-prompt.md)。基线 `a664a35`，分支 `cloud-backlog-2-dsh-mandate-progress-2026-10-31`。

对照：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 的 Mandate ≠ Ticket ≠ Assignment 与 Report 状态枚举。本仓只抄领域语义进 **native** prompt / handoff 约定与可校验的 handoff 字段；**不**复活 TaskSpec / WorkerReport ledger，不引入 Source / Policy / Engine。

## 目标行为

### A. Mandate ≠ Assignment（prompt / brief / handoff 文案）

- **Mandate（用户授权）**：目标、范围、验收标准；来源是用户消息或用户指定文档；不可被 Root 决定或插件通知改写。
- **Assignment（执行器）**：当前 Root 会话与子代理可换；换会话不重新签发 Mandate。
- **已授权跟进**：仍落在 Mandate 内的续聊 / 交接后下一步，继承授权，不重新评估「是否获准」；超出 Mandate 才当作新请求。
- 落点：`NATIVE_PROMPT`、handoff `brief` 参数说明、`handoffPrompt` 继承句。不做运行时授权引擎。

### B. handoff `status` 小枚举（约束 progress / 终态用语）

保留现有必填 `progress`（1–600，三行用户可见叙述）。新增必填 `status`：

`progress` | `waiting` | `ready` | `blocked` | `failed` | `dropped`

- 工具 schema + execute 入口校验；非法值拒绝，不削弱既有 progress 长度/类型断言。
- `PendingHandoff` 携带 `status`；投递给下一任 Root 的 progress 段前缀 `status: <value>`。
- 文案约定：子代理终态汇报与 handoff `status` **共用同一套用语**；不落账本、不写 WorkerReport schema。

### 明确不做

- TaskSpec / WorkerReport / 持久工单账本
- 把 Root 改成 dsh Main Session；Source / Policy / Engine / Outbox
- mode 变更不杀飞、工人槽给人 follow-up（观望）
- 削弱或删除既有测试断言

## 验证

- 新增/更新断言：schema 含必填 `status`；非法枚举拒绝；合法六值通过；投递提示含 `status:`；`NATIVE_PROMPT` / brief / handoffPrompt 含 Mandate 句。
- 故障注入：去掉 status 校验后对应拒绝断言必须失败（或等价：错误枚举不被拒则失败）。
- `TMPDIR` 在仓库外跑 `npm run test:release`；contract 可 SKIP。
