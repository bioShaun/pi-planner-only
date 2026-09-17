# planner_verdict recovery 拒绝调查（2026-09-17）

## 结论

确切拒绝由 `index.ts:1094–1099` 的跨字段检查触发：**只要传了 `recovery`，`verdict` 就必须为 `blocked`**。普通 `request_changes` 应省略整个 recovery 对象，不能用 `reason:"not applicable"` 表示不适用。改为 blocked 也未必正确：只有当前 `task.recovery.required=true` 时才能提交 abort RecoveryDecision。

本地实际记录可访问，找到指定 run `5238d98c-553d-42e7-af01-bd9687f7f6f8`。需要按 Task 和取证截止点区分“两次同一报错”：**T-20260917-002 内精确 `requires verdict=blocked` 工具错误只有一次**（S:117），其后六次是另一条 `recovery is only admissible ... Task ... does not`（S:142/145/148/151/154/157）；但同一 Root 会话继续在 T-20260917-003 出现四次精确错误（S:176/179/182/196），在 T-20260917-006 又出现一次（S:238）。因此截至 S:238（2026-09-16T23:44:11.822Z），该 Root JSONL 共六条精确错误，不能再表述为整个会话仅一次。若用户界面所说的“两次”特指哪两个调用，仍需时间戳或 toolCallId 对齐。

直接原因已证实为 **普通审核调用仍携带不适用的 RecoveryDecision**；工具表面允许表达非法组合、多个 recovery 概念混用、只改措辞的重试未触发全局语义熔断，是有源码支持的易误用因素。没有证据表明本次是并发竞争或生产代码异常。

## 范围、版本与取证

- 仓库 HEAD：`de2cdbd0466070f6f8b6ea9350bf523b4696cdfd`。实际会话版本记录 S:4：package 0.6.0、diskHead 同上、loadedFingerprint `bd9c45846d58035dae97e4974c2d397d6699d507e8864102373eacb0814118a8`，加载路径为 `/home/tcuni/.pi/agent/git/github.com/bioShaun/pi-planner-only/index.ts`。该安装仓库当前 HEAD 也相同；这不等同于逐字证明进程已加载模块与当前文件完全相同，故以会话实际错误补强。
- 已读 `AGENTS.md:1–13`、`docs/agents/domain.md:5–9`、`CONTEXT.md` 和两份 ADR。
- `CONTEXT.md:58,65–74` 定义 recovery/review/delegation；ADR-0001:59–66 记录 P0-B；ADR-0002:8–15,65–66 明确将旧 `planner_delegate.recovery` 改为 `planner_redelegate.recovery`。旧 ADR 的入口不能独立照抄。
- 仅列举 `~/.pi/agent`、sessions 顶层目录，按本仓库 workspace 与日期查 Root JSONL，并按完整 runId 查 artifact；未递归扫描全部用户 sessions 或巨大工作目录。
- 使用 JSON 结构化提取公开 toolCall/toolResult，不引用 thinking/签名内容。未读取凭证文件。
- 会话 JSONL 在调查期间仍会追加；次数结论以 S:238（2026-09-16T23:44:11.822Z）为固定截止点，避免把较早中间快照误写成最终会话统计。
- 仅新增本报告；临时 harness 位于 `/tmp/opencode`。未编辑生产代码、测试或已有用户文件，包括 `.scratch/worker-token-limit-research.md`。

### 本地一手记录别名（行号指原始文件）

- **S** = `/home/tcuni/.pi/agent/sessions/--public-pi-pi-planner-only--/2026-09-16T23-13-55-911Z_01a0ac7f-8ec6-71a9-9456-f87e583eaa14.jsonl`
- **M** = 同目录 `subagent-artifacts/5238d98c-553d-42e7-af01-bd9687f7f6f8_worker_0_meta.json`
- **L** = `/home/tcuni/.pi/agent/planner-only/ledger/T-20260917-002.json`（单行 JSON，所有字段均在第 1 行）。这是可变 snapshot，不能用其当前状态倒推所有历史时点。

## 实际时间线：runaway 是上游事件，verdict 错误发生在恢复之后

时间均为 UTC（当地日期/Task ID 为 20260917）。

| 时间 / 证据 | 事实 |
|---|---|
| 23:25:21，S:95–96 | 指定 run 因 `worker_runaway` 取消，tokens observed=128226，limit=120000，confirmed=true、terminal+quiet-worktree；Task blocked、recovery.required。M:5–18 同时记录 exitCode=1、input=126896、output=1330、12 turns、aborted。126896+1330=128226。 |
| 23:25:51，S:102 | Root 正确用 `planner_redelegate` + `retry_same_plan`，executionId 取原 tool execution 的完整 `call_YsXh…|fc_…`，提高 envelope 并缩小工作。 |
| 23:26:48，S:103 | 新 run `197c5d1a-02f3-4ed3-bf49-9f8447a72cde` 返回报告；短 SHA 与完整 SHA 的 freshness 比较导致 `changes_requested`，提示 `Automatic recovery attempt 1 of 3`。 |
| 23:27:12，S:116–117 | Root 提交 `verdict:"request_changes"` 和两个具体 finding，但多传 `recovery:{action:"abort",executionId:"197c5d1a-…",reason:"not applicable",worktreeDecision:"keep",evidenceRefs:[]}`。准确触发用户所述拒绝。 |
| 23:27:29，S:119；23:30:40，S:121 | Root 改走普通 correction redelegate，但仍携带以 runId 为 executionId 的 recovery。当前非 final 状态下该字段未进入 recovery gate；新执行确实启动，后因 wall envelope 取消，再置 recovery.required。 |
| 23:31:19，S:131；23:31:55，S:132 | Root 用匹配的异常 executionId 提交 retry_same_plan，成功恢复；run `eebde8c8-226b-49e7-82d8-c93617389d80` 返回正常报告，Task reviewing。 |
| 23:32:08–49，S:141–157 | 六次 `blocked + abort recovery`，executionId 填正常 run `eebde8c8-…`；此时 requirement 已被恢复执行消费，均拒绝 `recovery is only admissible ... does not`。summary/reason 多次换措辞，S:147 与150 参数相同，S:151 追加 Repeat notice。 |
| 23:34:25–23:38:29，S:176/179/182/196 | T-20260917-003 的普通 `pass` 四次携带不适用 recovery，均触发精确 `requires verdict=blocked`；其中 S:179 是与前次参数相同的 Repeat notice，随后改 summary/reason 又绕开相同参数 key。 |
| 23:44:11，S:238 | T-20260917-006 的普通 verdict 再次携带 recovery，出现第六条精确 `requires verdict=blocked`。这证明该易误用模式跨 Task 重复，不是 T-002 的单次孤例。 |

L:1 在 S:157 后的一次读取状态为 reviewing、recovery.required=false、两条已消费的 retry_same_plan 历史；当时 executions 的 endedReason 顺序为 runaway / normal / runaway / normal。L 是可变 snapshot，后续执行会继续追加，不能把这组四条顺序当作报告完成时的最终长度。`verdictRefusals:[]` **不能说明没有拒绝**，原因见下节。

## 实际约束与校验次序

1. `index.ts:1070–1089` 先解析 Task，再调用 `rootVerdictRefusal`。`orchestrate.ts:1925–1980` 会先拒绝 terminal、pending child、无报告、fresh review 未完成等条件。
2. 之后才是 `index.ts:1094–1099`：`recovery !== undefined && verdict !== "blocked"` 直接抛确切错误，**尚未检查 recovery.required、executionId、action 是否有效**。所以这条错误本身不证明 Task 真需要恢复。
3. blocked+recovery 才进入 `delegate.ts:148–189`：当前 requirement 必须为 true；executionId 必须匹配异常执行（不是 child runId）；未被消费；action 在允许集合；reason 非空；没有相同 action/worktree/evidence 的历史决策。verdict 的 allowedActions 仅 abort（`index.ts:64`）。
4. 真正记录 verdict 在 `index.ts:1103–1108`；消费 recovery 在1109–1111。拒绝发生在它们之前。generic refusal 会在1088记录 `verdictRefusals`，recovery 分支1099直接 throw，没有同等记账，故本次 L 的空数组符合代码。
5. redelegate 只在 final state 的 blocked+required 分支验证 recovery（`delegate.ts:586–601`）。普通 correction 上传入无效 recovery 可能被忽略；不能用“这次 redelegate 成功”证明 recovery 参数正确。
6. RecoveryDecision 在新 execution 获准时即消费（`delegate.ts:718–722`），`task.ts:1748–1763` 清 required、写 consumedBy/history；不等到 Root 最终审查才消费。

## schema / description / prompt：已证实的表面问题与推断

### 已证实

- `index.ts:993–1004` 的工具 description、promptSnippet、promptGuidelines 只介绍三个 verdict 和 findings，没有把“不适用就省略 recovery”放在显眼位置。
- `index.ts:1005–1056` 是平坦 Type.Object：verdict 三选一、recovery optional，两者未编码成条件联合。`recovery.action` 为任意非空 string；只有 description 写 “Only abort”。recovery 对象 description 确实写了 verdict must be blocked，因此不是完全没有文档，而是强约束只在文字和 execute 分支中。
- `PLANNER_PROMPT`（`index.ts:196–212`）区分 delegate/redelegate，要求提交 verdict，但未解释 WRC RecoveryDecision 的生效/消费条件或普通审核应省略该对象。
- 实際异常结果已有正确指引：`delegate.ts:1537` 与 S:96 明确列出 redelegate.recovery 或 verdict blocked+abort。因此“不知道任何正确入口”不能解释全部行为。
- review 的自动证据恢复使用另外的 `recoveryAttempts/recoveryStates`（`review.ts:667–705`）；S:103 的 `Automatic recovery attempt` 并非 WRC 的 `task.recovery.required`。这是两个不同状态机制。
- S:116 直接填 `reason:"not applicable"` 但没有省略对象；S:141 起将“宿主证据尚缺”作为 abort recovery reason。runId/executionId 也混淆，尽管 S:96/103 的 details 分别提供两个字段。
- breaker 的 key 是 toolName+**全部 params** 的 canonical JSON hash（`refusal-breaker.ts:108–120`）；第二次相同参数提示、第三次 STOP、第四次 hook 拦截（17–22,143–153）。改 reason/summary 就变 key。S:151 的 Repeat notice 与机制一致。

### 推断及边界

- **高可信推断**：Root 在普通审核中把可选 recovery 当作需要填完整的通用字段，沿用了之前恢复/abort 模板；`not applicable` 与后续不删除对象是直接行为证据，但不能断言模型内部心理过程。
- **中可信推断**：“automatic recovery”措辞、恢复成功后不显式提醒清 requirement，以及 blocked 同时表示普通阻塞和异常 abort，增加概念混淆。
- **未证实**：宿主/provider 是否将 optional 字段转换为某种严格 schema、是否强迫填写所有字段。现有会话没有保存本轮发给模型的完整工具 schema；不能归咎于 strict JSON 或 provider 强制行为。
- **已否定的简单解释**：不是只将 verdict 改 blocked 就可修复本次审核调用；harness 与 S:142 证明还会落入 no-requirement 拒绝。
- **“第二次”的具体 UI 对齐仍未证实**：截至 S:238，同一 Root JSONL 已确认六条精确结果，但只有 S:117 属于 T-002；其余分属 T-003 和 T-006。没有第二次时间戳/toolCallId 时，不能断言用户所见“两次”具体对应哪两条。

## 最小复现与测试

### 执行命令

在仓库根目录执行：

```sh
node --experimental-strip-types /tmp/opencode/planner-verdict-recovery-repro.mjs
node --experimental-strip-types index.test.mjs
node /tmp/opencode/planner-recovery-evidence.mjs
```

第一个是临时 harness，复用现有 `index.test.mjs:1–132` 的隔离宿主 fixture、1218–1265 的 token breach，再调用**真实注册工具 execute**；没有复制拒绝逻辑，没有访问真实 ledger 写入路径。所有 state/ledger 操作隔离在临时目录。通过添加较早报告满足 non-blocked verdict 的前置报告门禁；随后再设置已消费 recovery+changes_requested，匹配实际 incident 的关键状态。恢复 fixture 通过真实 session_start 加载。Task ID 自动生成，输出为 `T-20260917-001`，与生产 `…002` 只是标识差异。

首次尝试仅 breach、没有历史 report，未到达目标分支，被更早门禁挡住，目标断言失败；据 `orchestrate.ts:1953–1957` 修正 fixture 后成功。此差异很重要：只在全新 runaway Task 上测试 non-blocked，不足以覆盖本事件。

最终实际输出（exit 0）：

```text
planner_verdict refused (recovery, task=T-20260917-001): a recovery decision on planner_verdict requires verdict=blocked
planner_verdict refused (recovery, task=T-20260917-001): a recovery decision on planner_verdict requires verdict=blocked

Repeat notice: these arguments are byte-identical to refused call probe-0 (same refusal planner_verdict refused (recovery, task=T-20260917-001): a recovery decision on planner_verdict requires verdict=blocked). The change you described was not emitted — read back the arguments you actually sent before calling again.
PASS: two refusals; task ledger unchanged
PASS: blocked + abort consumed recovery; state=blocked
planner_verdict refused (recovery, task=T-20260917-001): a recovery decision on planner_verdict requires verdict=blocked
planner_verdict refused (recovery, task=T-20260917-001): recovery is only admissible while the Task flags recovery.required (Task T-20260917-001 does not)
PASS: ordinary blocked verdict WITHOUT recovery succeeded
```

`index.test.mjs`：exit 0，无 stdout。现有测试覆盖 blocked+abort 成功、missing recovery 拒绝、retry_same_plan 恢复（1212–1379）；`delegate.test.mjs:1860–1999` 覆盖错误 executionId、路由、action、去重和 consume。检索未找到现有测试直接断言本次 `requires verdict=blocked` 错误，因此新增的临时 harness 补了此次研究的验证，不应把现有全绿当作错误组合已被测试。

取证脚本在较早的 S:157 中间快照曾输出 `exact-error-records 1`；会话继续追加后，截至固定截止点 S:238 输出 `exact-error-records 6`。六个候选均已按 JSON 结构核对为 `planner_verdict` toolResult，分别位于 S:117/176/179/182/196/238。脚本只扫描指定 workspace 顶层两天的 JSONL，不进入 subagent transcript 树。后续若将脚本固化，应直接按 `message.role=toolResult`、`toolName=planner_verdict` 和结果文本筛选，而不是只对原始行做字符串 `includes`。

## 正确调用

### 实际 S:116 的审核意图：要求修正

应省略 recovery 和与本次审核无关的 drift acknowledgement：

```json
{
  "taskId": "T-20260917-002",
  "verdict": "request_changes",
  "summary": "新增结论含未证实环境断言及缺项覆盖问题，需修正并绑定完整 HEAD。",
  "findings": [{
    "severity": "major",
    "category": "correctness",
    "description": "环境断言未经核验，宿主缺项覆盖不完整。",
    "requestedChange": "删除无依据断言，明确验证边界，并使用完整 HEAD。"
  }]
}
```

仍需正常 evidence/lifecycle 门禁；本示例修正调用契约，不许诺未经重采样即可验收。S:103 已处于 changes_requested，也可按返回 guidance 直接 `planner_redelegate` 普通纠正/验证，省略 recovery。

### 后续只是宿主证据不足：普通 blocked

```json
{
  "taskId": "T-20260917-002",
  "verdict": "blocked",
  "summary": "文档已纠错，但宿主验收证据尚未完成，保留待处理。"
}
```

### 仅在确有未消费异常 requirement 时

- 继续执行：`planner_redelegate` 携完整 TaskSpec、匹配 `details.executionId` 的 recovery，action=`retry_same_plan` 或 `fix_environment`，以及合适的明确 envelope。
- 放弃恢复：`planner_verdict` 使用 blocked，recovery.action=`abort`，executionId 必须取**当前异常 execution**，reason 给具体依据，worktreeDecision=`keep` 或在人工解决后使用 `manual`。
- 不要用 UUID runId 替代 executionId，不要复用已消费的 decision，不要把普通证据 revalidation 当作异常恢复。此处只研究，不对实际 Task 发这些调用。

## 建议（未实施）

1. **优先改工具表面**：让普通 verdict 与 abort recovery 成为互斥的可表达契约（条件联合或独立 abort 恢复工具，需先验证宿主 schema 支持）；将 action 收窄为 literal `abort`。遵循 ADR-0002:25–33 的经验：单靠拒绝文字不足以阻止模型重复构造错误参数。
2. **低成本说明改进**：description/promptGuidelines 显式写“普通 pass/request_changes/blocked 不传 recovery；不要填 not applicable；仅 recovery.required 时可 abort”，说明 executionId 与 runId 不同；恢复结果显式提示 requirement 已消费。
3. **拒绝可操作化**：当前错误应给 received verdict、恢复状态和下一步；对普通审核建议删除 recovery，而非仅要求 blocked，避免把审核意图错误变为 abort。
4. **补真实边界测试**：有报告+已消费 recovery+request_changes+多余对象；仅改 blocked 仍拒绝；删除对象正常；有效 requirement 的 blocked+abort 正常；确保拒绝不落 verdict、不消费 requirement。
5. **一致校验 redelegate**：研究普通非 final Task 携多余 recovery 应拒绝还是明确 warning，避免“错误参数在某条路径成功”强化错误模板。
6. **诊断与熔断**：为 recovery refusal 统一结构化记账；考虑以 task+失败约束+关键控制字段聚合语义重复，保留目前参数去重，但不要因仅换 summary/reason 无限绕开提醒。需避免误封真正改变执行依据的合法恢复。
7. **术语消歧**：在 guidance 中区分 evidence revalidation 与异常执行 RecoveryDecision，不将二者都只称 automatic recovery。

研究完成时 `git status --short` 仍包含原有用户修改/未跟踪项；本 agent 新增内容仅本报告。最终检查还发现其他执行方新增了 `issues/14-task-unknown-guidance-must-be-role-aware.md` 修改及 `.scratch/nx-followups/05-closeout/`，本 agent 未触碰它们。期间真实 ledger 也有后续更新，因此以带时间戳的会话记录为事件事实依据。未提交 git。
