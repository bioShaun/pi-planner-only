# 02: abort RecoveryDecision 走独立工具面，`planner_verdict` 不再有 `recovery` 键

Status: done
实现状态：代码与有界验证已完成；自然模型宿主验收已观察完成并通过。
Type: feature（契约变更）
Blocked by: —
来源：../spec.md §2；R2 §结论、§schema/description/prompt、§建议.1/3/6；ADR-0002 §Why

**What to build：** 让「普通 verdict」与「abort 恢复决策」在工具表面上互斥不可混填。首选方案 A：新增专用工具（暂名 `planner_abort`），`planner_verdict` 的 schema 删掉 `recovery`；`planner_verdict` 收到 passthrough 的 `recovery` 键按 ADR-0002 mint 路径同款处理——剥离并在 `warnings` 中披露，绝不因此拒绝。

## 现状（写票时核过）

1. `index.ts:1005–1057` `planner_verdict` 是平坦 `Type.Object`：`verdict` 三选一，`recovery` 可选对象，两者无条件绑定；`recovery.action` 是 `Type.String({minLength:1})`，只在 description 写「Only abort」；实际允许集 `VERDICT_RECOVERY_ACTIONS = {"abort"}`（`index.ts:64`）。
2. `index.ts:1094–1099`：`recovery !== undefined && verdict !== "blocked"` 直接 throw `requires verdict=blocked`，此时**尚未**看 `recovery.required`/executionId/action；该分支不走 `recordRootVerdictRefusal`（1088 只记 generic refusal），所以 ledger `verdictRefusals:[]` 不代表没被拒。
3. 真实事故：同一 Root 会话截至 S:238 共六条精确 `requires verdict=blocked`（S:117 T-002；S:176/179/182/196 T-003；S:238 T-006），另六条 `recovery is only admissible ...`（S:142–157）。模型在普通 `request_changes`/`pass` 上填 `reason:"not applicable"` 而不是省略对象；把 child runId 当 executionId；改 summary/reason 绕开 breaker 的全参数 hash。
4. ADR-0002:23–33 的经验直接适用：「An optional X on a single tool is an invitation to fill it in … the fix is structural」。
5. 相关文案要一起改：`delegate.ts:169`（"abort goes through planner_verdict (verdict=blocked)"）、`delegate.ts:1537` 与 runaway 结果 details 的恢复指引、`index.ts:951` redelegate promptGuidelines、`PLANNER_PROMPT`（`index.ts:196–212`）、README、`CONTEXT.md:58,65–74` recovery 术语、ADR-0001:59–66 / ADR-0002:65–66 的入口说明。
6. **未证实的关键分岔**（R2 §推断及边界）：宿主/provider 是否把 optional 字段倾向填满、是否支持顶层 `anyOf` 判别联合。会话里没保存下发给模型的完整 tool schema。方案 B 的可行性完全依赖这一点。

## 前置步骤（落地前必做，结果写入本票 Comments）

- 捕获一次实际下发给模型的 `planner_verdict` tool schema（pi 层 registerTool → provider 请求体）。记录：Optional 是否保留、`anyOf`/`oneOf` 是否被扁平化或拒绝、对当前 provider（事故模型 `gemini-3.8-flash-high`）的 function declaration 限制。
- 若判别联合不被可靠支持 → 直接走方案 A，不再纠结 B。

## 设计（方案 A，首选）

### 新工具 `planner_abort`（名字可议，须读作 Root 正在做的操作）

参数：
```ts
Type.Object({
  taskId: Type.String({ minLength: 1 }),        // 必填，canonical，和 redelegate 同规则
  executionId: Type.String({ minLength: 1 }),   // 异常 execution，不是 child runId
  reason: Type.String({ minLength: 1 }),
  worktreeDecision: Type.Union([Type.Literal("keep"), Type.Literal("manual")]),
  evidenceRefs: Type.Optional(Type.Array(Type.String())),
  summary: Type.Optional(Type.String({ maxLength: 2000 })),  // 落到 verdict summary；缺省由 reason 生成
})
```
没有 `action` 字段——这个工具就是 abort，literal 由工具身份承担。

语义 = 现有 `planner_verdict(blocked) + consumeRecovery(..., "planner_verdict", "abort")` 的原子组合：
- 解析 Task（复用 `resolveVerdictTask`，`TASK_UNKNOWN` 走 ticket-13/14 的角色感知文案）。
- 门：先 `rootVerdictRefusal(task, "blocked")`，再 `validateRecoveryDecision(task, {executionId, action:"abort", ...}, {"abort"})`——现有 `delegate.ts:148–189` 全部生效（required、executionId 匹配、未消费、reason 非空、结构去重）。
- 通过 → `recordRootVerdict(blocked)` → `consumeRecovery` → `worktreeDecision === "manual"` 解 hold。与现有 `index.ts:1103–1112` 一致。
- 拒绝要可操作：回显 received executionId、Task 当前 state、`recovery.required`/`consumedBy` 状态、下一步（「Task 不需要恢复：用 planner_verdict blocked 或 planner_redelegate 纠正」/「executionId 应取 details.executionId，不是 runId」）。
- **拒绝统一记账**：abort 工具与 verdict 的每条拒绝都走 `recordRootVerdictRefusal`（或同级结构化字段），补上现状.2 的账本盲区。
- 加入 `IDLE_TOOLS`/`ROOT_TOOLS`（blocked+required 是 final，workspace 读 Idle）；接 `withRefusalBreaker`。

### `planner_verdict` 收窄

- schema 删除 `recovery`；execute 若收到 `recovery` 键 → 剥离 + `warnings: ["recovery is not a planner_verdict key; abort goes through planner_abort"]`，verdict 正常落地。这与 ADR-0002 mint 路径剥离 `taskId` 同款。
- description/promptGuidelines 加一句：三个 verdict 都不带恢复决策；放弃异常 execution 用 `planner_abort`。
- `recovery.required` 的 Task 收到普通 `blocked` verdict：维持现状行为（由 `rootVerdictRefusal` 决定），本票不改。

### 文档与契约

- ADR-0003：记录选择 A 的理由、B 的否决证据（前置步骤结果）、supersede ADR-0002:65–66 与 ADR-0001 P0-B note 里「`planner_verdict` blocked+abort」入口。
- `package.json` minor bump（对齐 ADR-0002 §Consequences）。
- 现状.5 列出的全部文案同步；`CONTEXT.md` 把 evidence revalidation（`review.ts:667–705` 的 `recoveryAttempts`）与异常 RecoveryDecision 两个词区分开（顺带完成 R2 §建议.7，不单独开票）。

## 方案 B（条件联合，仅当前置步骤证明宿主可靠支持）

`parameters` 改为 `Type.Union([ VerdictWithoutRecovery, BlockedWithAbortRecovery ])`，后者 `verdict: Literal("blocked")`、`recovery.action: Literal("abort")`。优点少一个工具；缺点依赖 provider 对 `anyOf` 的支持且错误信息更差。触发条件不满足即弃。

## 测试

- 普通 pass/request_changes/blocked + 多余 `recovery` → verdict 落地、`warnings` 含披露、requirement 未被消费。（翻转票 04 对应断言，改票时注明。）
- `planner_abort`：有效 required + 匹配 executionId → Task blocked、`recovery.required=false`、`nextAction="abort"`、`recoveryHistory` 追加；`manual` 解 hold。
- `planner_abort` 拒绝：无 requirement / executionId 用了 runId / 已消费 / 结构重复 / reason 空 → 各自文案；无 verdict 落地、无消费；拒绝已记账。
- 事故序列 fixture（票 04）上跑：runaway → retry_same_plan 消费 → changes_requested → `request_changes` + 多余 recovery → 现在成功且带 warning。
- runaway 终止结果的 guidance 文本指向 `planner_redelegate.recovery` 或 `planner_abort`，不再出现「planner_verdict blocked+abort」。
- `withRefusalBreaker` 在新工具上生效（byte-identical 重发出 Repeat notice）。

## 验收

1. `npm run typecheck && npm test` exit 0；`git diff --check` 空。
2. `planner_verdict` 的 schema 中 grep 不到 `recovery`；`VERDICT_RECOVERY_ACTIONS` 只被新工具引用或删除。
3. 宿主轮一次（参考 `../../worker-runaway-controller/host-02/` probe-s）：低 envelope 跑飞 → Root 用 `planner_abort` 放弃 → Task blocked 交人工；采集 toolcalls 证明模型在普通 verdict 上不再构造 recovery。
4. ADR-0003 落 `docs/adr/`，ADR-0001/0002 相应行加 superseded 指针。

## Comments

- 2026-09-17 开票。R2 §已否定的简单解释：只把 verdict 改 blocked 不能修复事故调用（会落入 no-requirement 拒绝）；所以拒绝文案建议「删除 recovery」而非「改 blocked」——方案 A 落地后这条文案只在 passthrough warning 里出现。
- 2026-09-17 前置步骤完成，**结论：方案 B 否决，走方案 A**。
  - 宿主侧（pi-coding-agent bundle `chunks/chunk-U6ZMQKGD.js` `convertTools` + `chunk-AXIIZGTV.js` `getJsonSchemaToolParameters`）：`tool.parameters` 经 `parametersJsonSchema` 原样下发（`convertTools(context.tools, false, …)`，`useParameters=false`；工具未设 `constrainedSampling` 时不走 `makeStrictJsonSchema`）。`Type.Optional` → `required` 数组保留；`Type.Union` → `anyOf` 保留，无扁平化。
  - provider 侧实测（事故同款 `tcuni-agy` gateway，`gemini-3.8-flash-high`，`streamGenerateContent?alt=sse`）：top-level `anyOf` 联合 `parametersJsonSchema` 被接受（HTTP 200），普通 pass 走无-recovery 分支、abort 场景走 blocked+recovery 分支均正确。**但**诱导 request_changes+recovery 时，模型 3/3 次产出非法组合（两分支均不满足）——schema 被接受却**不约束生成**，联合只提供虚假的结构安全。
  - 证据即结论：判别联合不可靠 → 方案 A。
- 2026-09-17 落地。新工具 `planner_abort`（`index.ts`）：taskId/executionId/reason/worktreeDecision 必填 + evidenceRefs/summary 可选，无 `action` 字段；门序为 `resolveVerdictTask` → `rootVerdictRefusal(task,"blocked")` → `validateRecoveryDecision`（同 redelegate 门）→ `recordRootVerdict(blocked)` → `consumeRecovery(consumedBy="planner_abort")`；`worktreeDecision:"manual"` 走 `resolveWriterHold` 解 hold。拒绝全部记账：recovery 类以 `kind:"recovery-invalid"` 入 `verdictRefusals`（`types.ts` 新增枚举值），回显 received executionId / Task state / required/consumedBy，补齐事故盲区。`planner_verdict` schema 删除 `recovery`，passthrough 键剥离并进 `details.warnings` + 文本 `warning:` 行。`planner_abort` 入 `IDLE_TOOLS`/`ROOT_TOOLS`（`policy.ts`）、breaker 模式与 store-error 排除（`refusal-breaker.ts`）、`tool_call` 归属（`index.ts`）。文案全换：`validateRecoveryDecision` 的 RECOVERY_REQUIRED 提示、`renderDelegationOutcome` 的 recovery.required 行、redelegate/tasks guidelines、`PLANNER_PROMPT`（压回 1784B ≤1800 上限）。ADR-0003 落 `docs/adr/`，ADR-0001/0002 加 superseded 指针，`package.json` 0.6.0→0.7.0，CHANGELOG 更新。测试：index.test.mjs 既有 P0-B e2e 与票 04 fixture 翻转（剥离+warning、breaker 移到 abort、recovery-invalid 记账、有效 abort 消费）；验收 `npm run typecheck && npm test` 全绿、`git diff --check` 空。
- 2026-09-17 复审修复（REQUEST_CHANGES）：`orchestrate.ts` renderTaskStatus 的 recovery 指引残留 `planner_verdict blocked+abort` 文案 → 改 `planner_abort`，`orchestrate.test.mjs` 覆盖该渲染路径（live 指引 + aborted 归因 + fallback）。测试补齐（`index.test.mjs` 新增块）：pass/blocked 携带多余 recovery → 剥离+warning+落地且 requirement 不消费；有效 requirement 下错误 executionId（含 child runId 形态回显）、空 reason、消费后重复调用（consumedBy 回显 + Repeat notice）均拒绝且除 verdictRefusals 审计行外无账本变化；`worktreeDecision:"manual"` 经 stop_unconfirmed→writerHold 真实路径解持久 hold（新增 `PI_PLANNER_ONLY_CANCEL_GRACE_MS` env 覆盖）。文档：README 双语补 `RECOVERY_NOT_APPLICABLE` 语义；CONTEXT.md RecoveryDecision 词条区分 evidence revalidation。
- 2026-09-17 验收 3 宿主轮已跑（真实 e2e）：隔离 `PI_CODING_AGENT_DIR=/tmp/pi-e2e-agent` 装本地扩展 + pi-subagents，`pi -p --mode json` 驱动 `planner_delegate(envelope.maxTokens=1)` → 真子进程 run=a4b69fe5 在 3641 tokens 越线 → CANCEL 确认停止 → `worker_runaway` + `recovery.required` + blocked；Root 随后 `planner_abort{taskId, executionId=tool_nBik0pYue71kNKlW5caAbPTJ, reason, worktreeDecision:"keep"}` → blocked 落账、`consumedBy="planner_abort"`、`nextAction:"abort"`。证据存 `evidence/planner-abort-e2e-toolcalls.json` + `planner-abort-e2e-ledger.json`；原始事件流 `/tmp/pi-e2e-run1.jsonl`。
- 2026-09-17 审计更正：上一条应定性为**指令式宿主集成验证**，而不是模型自主选择工具的验收 3。原始 user prompt 明确要求“Do exactly these two tool calls”并给出 `planner_delegate` / `planner_abort` 参数模板；它证明的是 CONTEXT.md 所述的进程内 child-agent 执行、envelope 越线、恢复要求和 abort 消费链路。它没有证明模型会自主选择 `planner_abort`，也没有覆盖模型自然生成普通 `planner_verdict` 时是否避免 `recovery`。不降低原验收标准：这两项宿主/模型行为仍待独立验证。本次只整理既有记录，没有宣称新跑宿主测试。完整且去敏的相关事件（精确原 prompt、两个完整 tool call/result、session identity、原始文件 SHA-256）存 `evidence/planner-abort-instructed-host-trace.json`；旧 `planner-abort-e2e-toolcalls.json` 的 `textHead` 截断版不再作为完整 guidance 证据。
- 2026-09-17 普通 verdict 宿主补测 **BLOCKED**，未形成验收证据。自然 prompt 为 `Read fixture.txt in the current workspace and report its word count. Make no changes.`；修正本地 pi-subagents 引用后，Pi 进程 exit 0，但 provider 初始请求及 3 次自动重试均返回 `Connection error.`，因此 toolCallCount=0、ledgerCount=0，没有观察到自主委派或普通 `planner_verdict`。原验收 3 保持 pending。去敏摘要存 `evidence/ordinary-verdict-host-blocked.json`；没有复制原始 transcript 或凭据。
- 2026-09-17 最终审计：实现与有界代码验收 **PASS**，fresh Reviewer 未发现缺陷，前述代码、测试和双语文档 findings 均已关闭。独立验证：`npm run typecheck` exit 0，完整 `delegate.test.mjs` exit 0，`git diff --check` exit 0；`index.test.mjs` 的最终新增块使用原样代码与既有 fixture 在 `/tmp/planner-index-followup-harness.mjs` 定向运行 exit 0（日志 `/tmp/planner-index-followup-harness.log`），这不是完整 index/full npm suite。完整套件仍受既有 nested spawn 空 stdout / `EPERM` 阻塞。自然 prompt 宿主验收仍因 provider 初始请求 + 3 次重试均 `Connection error.` 而 BLOCKED，零 tool call、零 ledger；原验收 3 保持 pending。严格 readonly launcher 初始化失败；fresh Reviewer 使用行为只读 fallback，未证明运行时强制隔离。证据汇总见 `../evidence/final-review.md`。本票因此转 `ready-for-human`：代码完成，外部 connected-host 验收待人工环境补跑。

- 2026-09-17 应用户要求重试；阻塞现由 socket `EPERM` 证据支持，provider 健康状态未评估，亦非 Pi subagent 故障；验收仍 pending。详见 [重试证据](../evidence/ordinary-verdict-host-retry.json)。

- 2026-09-17 审计验收：严格只读 launcher PASS、无 findings；完整 release 验证与自然 A2/B 场景均观察通过。A 初次 exit125、B 初次 bash 拒绝、A2 两次未携带 recovery 的 Root verdict 拒绝均保留为历史证据；A2 由 Reviewer 接受完成，Neither Root verdict was recorded。详见 [最终审计](../evidence/final-review.md)、[网络验收复审](../evidence/network-acceptance-review.md)、[网络主机证据](../evidence/network-host-verification.json) 和 [release 日志](../evidence/network-release-validation.log)。有限场景观察不构成普遍模型保证。
