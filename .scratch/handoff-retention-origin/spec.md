# Root handoff：拒绝不留稿、新稿替换旧稿、按发起方决定是否确认

状态：用户已确认（含三处既有断言改写授权），实施票 [01](issues/01-handoff-retention-origin.md)。基线 `d9c44aa`，分支 `fix/handoff-retention-origin`。

本 spec 修订 `.scratch/native-context-handoff/spec.md`“活动检查”一节中“busy 和 unknown 都拒绝切换……保留简报”的约定，仅修订提交时（`schedule`）的行为，派发时（`#dispatch`）的行为不变。

## 问题

1. **旧简报堵住新简报（Native）。** `#scheduleNative` 查询 pi-subagents 状态，结果为 busy 或 unknown 时，调用 `#defer` 把简报留作 `manualOnly`（`handoff.ts:164`）。之后 Root 再调用 handoff，会被 `#refusal` 以 “one is already pending” 拒绝（`handoff.ts:250`）。Root 没有丢弃旧简报的手段，只能等用户执行 `/planner-only handoff drop`，旧简报在等待期间逐渐过时。
2. **派发失败留下的简报同样会堵住新简报（Lite 和 Native）。** 派发时检查不通过、模型或模式恢复失败、`newSession` 被取消或抛错时，简报都会被留作 `manualOnly`，随后同样拒绝所有新简报。
3. **用户主动要求的交接在 confirm 模式下仍需回车。** `schedule` 一开始就清掉了 `#requested`（`handoff.ts:147`、`handoff.ts:153`），派发时无从得知发起方，只能按 `handoffMode()` 决定（`handoff.ts:307`）。结果是：用户主动要求的交接在 off 模式下自动发送，在 confirm 模式下却要等用户回车，confirm 比 off 还严。

## 目标行为

### A. Native 提交时被拒，不保留简报

- `#scheduleNative` 得到 busy 或 unknown 时，若该简报仍归本次调用所有，清空 `#pending`，不调用 `#defer`。工具结果写明“简报未保留”。Root 的上下文里仍有这份简报，等条件满足后可以再次提交。
- 本次调用开始时会把 `#requested` 置为 false；被拒后恢复为调用前的值。用户通过 `/planner-only handoff` 发起的请求不会因为一次被拒而失效，否则 Root 重新提交时会被当成自行发起（off 模式下低于阈值会被拒）。
- busy 和 unknown 的工具结果要分开写：
  - busy：`Handoff refused: Native subagents are still running; the brief was not kept. Wait for them to finish, then call handoff again with the full brief.`
  - unknown：`Handoff refused: Native subagent status could not be confirmed (query failed or timed out); the brief was not kept. Call handoff again later with the full brief, or tell the user.`
- 原有的取消路径不变：等待状态回复期间如果遇到 drop、reset、off、shutdown 或会话变化，仍然返回 “Handoff cancelled…”，且不得撤销这些操作（现有的 `late schedule reply cannot undo …` 测试继续适用）。
- Lite 提交时的拒绝本来就不保留简报，不需要改。

### B. 新简报替换失败后保留的旧简报（Lite 和 Native）

- `#refusal` 中原来的 `if (this.#pending)` 改为：只有在已保留简报**不能**被替换时才拒绝。能替换必须同时满足以下三条：
  - `#pending.manualOnly === true`；
  - `#dispatching === false`；
  - `#scheduleInFlight !== #pending`。
- 不满足时仍返回 “one is already pending”。这包括：尚未派发的正常简报、正在查询状态的简报、正在派发的简报。
- 替换只在 `#refusal` 的**全部**检查都通过之后才生效，包括子代理锁、委派计数、自行发起策略、阈值和长度。任何一项不通过，旧简报原样保留，之后仍可重试或 drop。
- 替换时 `#revision++`，使属于旧简报的迟到异步续程失去所有权。新简报不是 `manualOnly`，由 `settled()` 正常派发；模型选择在派发时重新捕获，不沿用旧简报的 `selection`。
- 替换成功时，工具结果要说明已替换，例如 `Handoff scheduled; it replaces the earlier brief kept after a failed delivery. …`（后半句沿用现有的 “Stop working now…”）。
- Native 下，替换后的新简报如果在提交时检查被拒，按 A 处理，新旧简报都不保留。这一点要写进文档。
- 派发失败时给用户的提示（`handoff.ts:272/286/317/322/329`）在原有的 retry/drop 说明之外加一句：Root 的下一次 handoff 调用会替换这份简报。

### C. 按发起方决定新会话是否需要确认

- `PendingHandoff` 新增 `origin: "user" | "root"`。`schedule` 在清掉 `#requested` 之前记录它：`#requested` 为 true 时记为 `user`，否则记为 `root`。
- “用户发起”只认 `/planner-only handoff [goal]` 命令设置的 `#requested`。用户在对话里口头要求的交接无法验证，不算用户发起，本 spec 不改这一点。
- `#defer`、`withSession` 内的重新保留、以及用户手动重试，都保持 `origin` 不变。用户对一份 Root 自行发起的简报执行 `/planner-only handoff` 重试，仍然算 `root`，仍然进编辑框。
- 新会话的发送规则：

  | handoff 模式 | origin=user | origin=root |
  | --- | --- | --- |
  | off | 自动发送（不变） | 不会出现（`#refusal` 已拒绝） |
  | confirm | **自动发送（新）** | 填入编辑框，等用户回车（不变） |
  | auto | 自动发送（不变） | 自动发送（不变） |

- “Thinking level was not carried over” 的提示在两种发送方式下都保留。
- 上下文提醒中 confirm 的文案（“brief in the editor for the user to submit”）只针对 Root 自行发起的交接，仍然准确，不改。

## 代码入口

- `handoff.ts`
  - `PendingHandoff`：新增 `origin`，并更新 `manualOnly` 的注释。
  - `schedule` / `#scheduleNative`：记录 `origin`；实现 A 的“不保留”和恢复 `#requested`；区分 busy 和 unknown 的文案。
  - `#refusal`：实现 B 的可替换判断；替换在全部检查通过后执行，并递增 revision。
  - `#dispatch`：发送规则改为 `mode === "confirm" && handoff.origin === "root"` 时填编辑框，其余情况自动发送；各条失败提示补充替换说明。
- `index.ts`：预计不需要改。
- 文档：
  - `CONTEXT.md` 的 **Root handoff** 条目，改为：提交时被拒不保留简报；投递失败、不确定或取消时保留简报，供重试或丢弃，也可以被新简报替换；用户发起的交接在 confirm 模式下也自动提交。
  - `README.md` 与 `README.zh-CN.md`：handoff 命令行、`PI_PLANNER_ONLY_HANDOFF` 中 confirm 的说明，以及 “Native handoff queries pi-subagents status…” 一段。
  - `CHANGELOG.md`。

## 测试（先写测试，贴红灯，再实现）

红灯必须是因为缺少目标行为而失败，语法或导入错误不算。

### 获授权的既有断言改写

这三处改写由契约变更授权。除此之外，不删除、不放宽任何断言。

1. `native-handoff.test.mjs` 中的 `Native ${name} retains brief for retry and drop` 循环（10 种响应）：改为断言提交被拒且不保留。具体是：`agent_settled` 后不派发；状态改为 idle 后执行 `/planner-only handoff`，不创建会话，而是要求 Root 调用 handoff 工具（`Call the handoff tool`）。另外按响应类型断言 busy 或 unknown 文案。
2. `index.test.mjs` 中 `confirm` 用例（约 343–351 行）：改成 Root 自行发起（confirm 模式、上下文超过阈值、不先执行命令），编辑框和未发送的断言保持不变。
3. `index.test.mjs` 中 `unknownConfirm` 用例（约 366–374 行）：同第 2 条处理。

### 新增

- **A1**：Native 下由 `/planner-only handoff` 发起，第一次提交得到 busy 被拒。状态变为 idle 后再提交，结果是 ok，不会因为被当成自行发起而拒绝（handoff 模式为 off、上下文低于阈值的情况下也成立）。
- **A2**：unknown 和 busy 的工具结果文案不同，且都包含 “not kept”。
- **A3**：派发时复查不通过仍然保留简报（现有 `Native dispatch rechecks activity` 继续通过），提示中包含替换说明。
- **B1**：以下三种来源保留下来的 `manualOnly` 简报，Root 再次调用 handoff 时都返回 ok 并带替换说明，最终发送的是新简报，不含旧简报：
  - Native 派发时 busy；
  - 模型恢复失败（替换后的实例）；
  - `newSession` 被取消。
- **B2（故障注入，验证保护条件）**：
  - 提交时状态回复被挂起，第二次调用返回 “already pending”；
  - 派发中 git 被挂起，此时调用返回 “already pending”；
  - 尚未派发的正常简报，返回 “already pending”（现有 `handoff.test.mjs:55` 保持不变）。
  - 去掉 `#dispatching` 或 `#scheduleInFlight` 中任一条件，至少一条 B2 用例应变红。在报告中贴出这次临时注入的失败输出，注入代码不提交。
- **B3**：存在 `manualOnly` 旧简报时提交不足 200 字的简报，返回被拒，旧简报保留，`/planner-only handoff` 仍然派发旧简报。
- **C1**：confirm 模式下由 `/planner-only handoff` 发起，新会话自动发送，编辑框为空。Lite 和 Native 各一例。
- **C2**：confirm 模式下由 Root 自行发起，内容进编辑框，未发送（即上面改写后的第 2、3 条）。
- **C3**：
  - 用户发起的简报派发失败后重试（confirm 模式），仍然自动发送；
  - Root 自行发起的简报派发失败后，用户执行 `/planner-only handoff` 重试，仍然进编辑框。
- **C4**：auto 模式和 off 模式下，用户发起的简报自动发送的行为不变（现有用例继续通过）。

### 回归

运行 `TMPDIR=/project/tmp npm run test:release`，全部通过。

## 验收

- 红灯输出（新增用例，以及改写后的三处）、B2 的故障注入失败输出、实现后的绿灯输出齐全。
- `test:release` 通过。
- `git diff` 只涉及 `handoff.ts`、测试文件、`CONTEXT.md`、两份 README 和 `CHANGELOG.md`。

## 不做的事

- 不给 Root 增加丢弃交接的工具，也不给 handoff 工具增加 `replace` 参数。
- 不自动轮询 pi-subagents 状态，不在子任务结束后自动重新提交。
- 不把对话里的口头请求当作用户发起。
- 不改变 off 和 auto 模式的语义，不改上下文提醒的文案，不改派发时（第二次）活动检查的保留行为。
- 不修改 Pi 或 pi-subagents。
