# 48: 绑定已入库 Task 的 validator 委派不得被提交的 spec 覆盖其 validation 定义（语义洞）

**What to build:** validator 委派一旦绑定到一个**已入库**的 Task，该 Task 的 stored spec 就是被验收的定义。提交的 spec 若给出**不一致**的 validation，必须 fail-closed 拒绝，而不是让它顶掉 stored 定义。

1. **判据**：绑定已入库 Task 时，若提交的 spec 带有 validation，且与 `target.task.spec.validation` **不一致**（`required` 不同，或 `required === true` 时命令集合不同），拒绝；结构化 code（例如 `VALIDATOR_SPEC_CONFLICT`），文案指明冲突字段与双方取值。
2. **一致或未给**：提交的 validation 与 stored 相等、或提交方根本没给 validation → 行为不变（现有取证与 packet 逻辑不受影响）。
3. **两个取值序都要审视**：守卫是 `specDetails.spec ?? spec ?? target?.task?.spec`，packet 是 `target.spec ?? target.task?.spec`（`roles.ts:686`）—— 两处都让**提交的** spec 优先，所以「拒绝失效」与「用另一套定义验收」是同一个根因的两面。
4. 未绑定 Task 的 validator（声明的 absent id、p12-r058 那条未绑定路径）**不在本票范围**，不得因此回归。

**Background / 证据：**

- 这不是文案问题，是语义洞：嵌入一份 `required:true + commands:[…]` 的 spec，就能（i）让工单 45 的 stored-task 拒绝失效，（ii）让 validator 在一套**worker 从未被要求覆盖的 commands** 下被判「验收」。
- 工单 45 的要求 6 已把它明确记为**隐藏逃生口**并选择保留（当时只要求「引导到新建 Task」），所以洞本身仍在。
- 现场证据：2026-09-14 工单 47 的宿主复跑**第一轮未复现**，原因正是 operator 的委派嵌了完整 spec 对 `T-20260912-016`（stored `{required:true}` 无可用 commands）发起校验 —— 委派**未被拒**、正常放行。见 [工单 47](47-validator-named-task-unresolved-falls-back-to-active.md) 的 Comments 与「宿主复跑」段。

**Acceptance:**

- 绑定已入库 Task + 提交 spec 的 validation 与 stored 不一致 → 被拒，code 结构化、文案含冲突字段与双方取值；不起 run。
- 提交 validation 与 stored 一致、或未提交 validation → 行为与今天逐字不变。
- 回归用例覆盖 `T-20260912-016` 的两种形状（嵌一致 spec / 嵌不一致 spec），并断言不一致那次的拒绝文案。
- 未绑定 validator（`orchestrate.test.mjs:1275-1299` 的 p12-r058 族）保持通过。
- `npm run typecheck` 与 `npm test` 绿。

**Blocked by:** 无。**优先级**：46 之后、49 之前（用户定：46 → 48 → 49）。

**实现记录（2026-09-14，本机）：**

- **判据**：`task.ts` 新增 `describeValidationConflict(submitted, stored)` —— `required` 必须相等；`required === true` 时再比较**可用命令集合**（`uniqueNonEmpty`，与其余归一化一致）；`required === false` 的命令不比较（无义务）。返回不一致的描述串，或 `undefined` 表示一致。
- **落点**：`orchestrate.ts` 中置于 45 的守卫**之前**（`specDetails` 可用处）：`target.role === "validator"`、提交方**显式带了 `validation` 键**（`specDetails.candidate` 含该键）、且已绑定 `target.task.spec` 时，不一致 → `VALIDATOR_SPEC_CONFLICT`，文案含 `validation.required/commands differ`、双方取值与 Task id。
- **为什么必须按「显式键」判定**：提取路径（`extractTaskSpec` → `createTaskSpec`）总把 `validation` 物化成 `{ required: false, … }`，所以「未提交 validation」与「显式 false」在这一层**不可分**。直接比较会误伤「嵌了 spec 但没提 validation」的常规用法，违背票面「未提交 validation → 行为逐字不变」。故以原始候选（`specDetails.candidate`）是否含该键为准。
- **为什么放在 45 守卫之前**：48 与 45 是同一个「validator 的有效定义」问题的两面；48 先拦，45 的 stored-task 拒绝就不再能被提交 spec 绕过。
- **本票不覆盖（需单独定）**：stored spec **没有** `validation` 字段、而提交方显式给了一个（如 `required:true` + commands）——按本票「双方都需有 validation」的字面判据**不算冲突**，该形状仍按今天的行为放行。是否把「stored 无 validation」视作 `{required:false}` 参与比较，留待决定。

**测试**（`orchestrate.test.mjs`）：提交 commands 与 stored 不一致（45 的 stored-task 形状 + 提交 `{required:true, commands:["npm test"]}`）→ `VALIDATOR_SPEC_CONFLICT`，文案含 `validation.commands differ`、`npm test` 与 Task id，且无 run；`required` 不一致 → 文案含 `validation.required differs`；两者一致、以及**完全省略** `validation` 键 → 均不按本票拒绝。

**回归证据**（本轮新验证）：临时关掉本票检查 → `orchestrate.test.mjs:1522` 失败（`expected: 'VALIDATOR_SPEC_CONFLICT'`、`actual: undefined`）；恢复后全绿。

**门禁**：`npm run typecheck` exit 0；`npm test` exit 0（35 个测试文件无失败）。日志 `.scratch/planner-only-cost-control/p48-impl/`。


**2026-09-14 宿主复跑：FAIL（未复现本机行为，待诊断）。** operator 在构建 `aacd59a`（loaded=50c0f30e66f2，步骤 0 已核）上跑了严格探针：对 `T-20260912-016` 嵌入不一致 validation（`{required:true, commands:["npm test"]}` vs stored `{required:true}` 无命令）→ **未被拒**，返回 `Async delegation … has started`，oracle 子进程真实执行了 `npm test` 并 passed。证据：会话 `2026-09-14T11-53-56-917Z` 的 tool_call `tool_JUwBAttqE3w4MdLTLqURQnsG`（输入已逐字提取，确认含不一致 validation）与 12:04:11 的 tool_result。

- 本机无法复现：`task.test` 全绿；ledger-backed store + 超上限记录 + 活跃 046 + `prepareRoleDelegation` 前置的完整复现脚本（`p48-impl/repro-host.mjs`）**正确拒绝**（`VALIDATOR_SPEC_CONFLICT`，文案与单测一致）。
- 另注意：operator 引用的 oracle 报告（`86296c17`，mtime 17:21–17:22）运行于 `59d9ee3` —— **早于 46/48/49/50 的实现提交**（18:13–19:25），其内容是对**票 47 文档状态**的审计（其 criteria 即 47 的验收项、typecheck/test 标注 reused），**不是**对本批行为的观测。「48 号洞在 aacd59a 上仍敞开」的结论因此不成立；但 operator 会话内 12:04 的放行是真实的，需要诊断。
- 诊断方向：需要带插针的复跑（在 48 检查处打印 `target.role` / `submittedValidationExplicit` / `target.spec?.validation` / `target.task?.spec?.validation` 与最终判定），或 operator 提供该次委派的完整 tool_call/tool_result 之外的 orchestrator 决策记录。
- 同时记录的 operator 披露：门禁取证委派的文本含 016 文件名，被账本感知绑定到 016 并启动（016 的 mtime 基线因此变更）；未点名委派 4/4 次落到 active Task `T-20260913-046`（文档化的 active 兜底）；嵌入 spec 的 `T-p46-pos` 未生效（validator 的被审对象解析不消费 spec 声明 —— 与 46/51 的语义一致）。

**2026-09-14 补充结论：`T-20260912-016` 被双重拦截是设计使然，其宿主复跑不可能出现 stored-task 拒绝或放行二选一以外的结果。** 该 Task 的 stored 定义是遗留不完整形状（`{required:true}` 无可用 commands，base `e7a4247` = RS-03，objective 为 Batch-4 RS-04+RS-05）。因此：

- 嵌**与 stored 一致**的定义（`{required:true}` 无命令）→ 45 的 stored-task 守卫以「定义不完整」拒绝，指引 create a new Task；
- 嵌**不一致**的定义（如补上 commands）→ 48 的 `VALIDATOR_SPEC_CONFLICT` 拒绝；
- 不嵌 spec、task-id-only → 同样命中 45 的 stored-task 守卫。

三条路都指向同一指引：**新建一个携带完整 validation 定义的 Task** 来承接该交付物的验收（016 本身留 blocked 或 abandon → failed 清账均可）。operator 的「复验 016」选项因此不可行——不是缺陷，是 45+48 的设计合力。

**2026-09-14 根因定位并修复（插针诊断命中）。** operator 的复跑采集显示：宿主实况委派有 `enter`/`exit` 但 `reachedCheck=false | block=none | task=T-20260912-016` —— 即委派走了**未绑定 validator 路径**（`resolveValidatorReviewedTask` 返回 undefined → 占位绑定 → 放行），**48 检查从未到达**。

**根因：48 检查的落点错误。** 它被放在 `beginDelegationInner` 的未绑定 validator 提前返回**之后**（为取 `specDetails` 而后移），所以任何「被审对象未解析」的 validator 委派都会走该路径被放行，永远到不了检查。而单测直接调 `beginDelegation` 且 Task 已在 store 里，所以单测过了 —— 测试与实况的路径差异掩盖了落点错误。

**修复**（commit `144ed9e`，分支 `fix/tickets-46-48-49-50`）：48 检查移回**早期位置**（47 的目标解析之后、未绑定提前返回之前），`prompt`/`specDetails` 一并上提（提取为纯函数、无副作用，提前调用等价）；45 的守卫与 architecture C37-3 不变量不变。

**复验**：宿主形状复现脚本（ledger-backed + 超上限记录 + 活跃 046 + prepare 前置）现到达检查并拒绝（`VALIDATOR_SPEC_CONFLICT`）；全套件 exit 0。

**2026-09-14 23:30 更正：上面的「根因」是错的，`144ed9e` 没有修到宿主路径。** 证据：`144ed9e` 于 22:35:45 落到 pin checkout 之后，operator 在 22:39 与 22:54 新开的两个会话里又跑了 3 次检查 2 形状的探针（tool_4SRz…、tool_78TM…、tool_QtMO…），`diag48.log` 仍是 `reachedCheck=false | block=none | task=T-20260912-016`。

**真实根因（本机已按宿主接线精确复现）：**

1. 宿主 `index.ts:1380-1381` 先调 `prepareRoleDelegation(event.input)` 再调 `beginDelegation(event)`。prepare 会把合法的嵌入 spec 改写成 oracle **TaskPacket**（`[PLANNER-ONLY ORACLE] … {"version":1,"spec":{…},"instructions":…}`），原来的 ```json 围栏块从 prompt 里消失（子进程会话 `2026-09-14T14-54-13-293Z/f4dd2640…/run-0/session.jsonl` 的首条 user 消息可证）。
2. `extractTaskSpecDetails` 对 packet 是透明的（`spec` 读的是嵌套的 `parsed.spec`），**但 `candidate` 仍是 packet 外层对象**（键为 `version|spec|instructions|knownFacts|artifactRefs`）。
3. 48 的显式判定 `"validation" in specDetails.candidate` 在 packet 外层上永远为 false → `submittedValidationExplicit=false` → 检查整体跳过 → 45 守卫看到的是提交 spec（有 commands）→ 放行，绑定到 016 并启动。
4. 单测和 `p48-impl/repro-host.mjs` 都没复现的原因相同：单测直接调 `beginDelegation`（不打包）；复现脚本调的是 `orch.prepareRoleDelegation(delegationInput, BASE)`——传的是外层 event 而不是 `event.input`，prepare 对没有 `task` 字段的对象直接 no-op，prompt 从未被打包。把参数改成 `delegationInput.input` 后本机立刻复现放行（`p48-impl/repro-host-flow.mjs`）。

**顺带纠正两个一直被当作事实的假设：**

- 宿主账本（`~/.pi/agent/planner-only/ledger/T-20260912-016.json`）里 016 的 stored `spec.validation` 是 **`{"required":false}`**，不是「`{required:true}` 无 commands」。所谓「遗留不完整形状」来自检查 1 的拒绝文案「Task T-20260912-016 is stored with validation.required = true but no usable validation.commands」——那条文案把**提交的**（无效）定义说成了**存储的**定义（`storedTaskId` 在 `specDetails.spec` 与 `target.spec` 都为 undefined 时被置为被审 Task，而 packet 外层恰好让两者都 undefined）。这是 45/50 文案的归因缺陷，另立工单 52。因此「016 三条路都堵死、只能 abandon」的结论不成立：task-id-only 委派会按 stored `{required:false}` 放行；嵌 `{required:true, commands:[…]}` 才应被 48 拒（`validation.required differs`）。
- 「未绑定 validator 路径」不是宿主走的路径：016 在宿主里通过 ledger-aware lookup 正常解析（run-state 记录 `taskId: T-20260912-016, role: validator`）。`144ed9e` 把检查提前是无害的，保留。

**修复**（本提交）：`task.ts` 的 `ExtractedTaskSpecResult` 新增 `submitted`（packet 时为嵌套 spec，否则为 candidate 本身）；`orchestrate.ts` 的显式判定改读 `specDetails.submitted`。DIAG48 插针额外在门口记录 `gate48: … candidateKeys=… submittedKeys=…`，宿主若再 miss 可直接从日志读出是哪个条件为 false。回归测试：`orchestrate.test.mjs` 新增两例走 `prepareRoleDelegation → beginDelegation` 的宿主路径（打包后的不一致定义 → `VALIDATOR_SPEC_CONFLICT`；打包后的一致定义 → 放行）。`npm run typecheck` / `npm test` 均 exit 0。

**行为变化须知：** 宿主路径下，嵌入 spec **省略** `validation` 时，packet 里的 spec 会物化为 `{required:false}`，与 stored 的 required 定义判冲突。2026-09-14 工单 52 已把这条规则统一到直接调用路径（省略 = 按物化值判定），不再区分「显式/省略」。另：016 的 stored validation 在 22:13 被一次 report-only 纠正委派改写为 `{required:false}`（工单 53），所以 23:33 的宿主复跑命中的是 `validation.required differs` 而非 `commands differ`；两者都是 48 的拒绝分支。

**2026-09-14 23:33 宿主复跑：PASS。** 构建 `54a0dd5`（pin checkout 23:29 更新，新会话 `2026-09-14T15-30-59-307Z`）。检查 2 委派 `tool_53FabCHnDbCDTOkkGaurx3K3`（agent=oracle，嵌入 `{required:true, commands:["npm test"]}`）同步拒绝，无 run 启动。回执逐字：`Planner-only guard: the submitted TaskSpec disagrees with Task T-20260912-016's stored validation — validation.required differs (submitted true, stored false). A Validator is judged against the Task's stored definition: resubmit with that definition, or name the Task without embedding one.` 门口日志：`explicit=true candidateKeys=version|spec|instructions|knownFacts|artifactRefs submittedKeys=…|validation|… targetTask=T-20260912-016 storedValidation={"required":false}` → `decision=refused(VALIDATOR_SPEC_CONFLICT)`。

正向对照（同会话 root 按指引改为 stored 的 `{required:false}` 重提，`tool_6OE31…`、`tool_EyBUX…`）：`conflict=none decision=passthrough`，放行并绑定 016 启动 run —— 一致定义放行，符合设计。

DIAG48 插针已随本次记账一并移除（`orchestrate.ts` 无残留；`p48-impl/diag48.log` 留作证据）。

**Status:** verified（2026-09-14 宿主复跑 PASS on `54a0dd5`；插针已移除。）
