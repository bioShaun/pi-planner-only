# 45: TaskSpec `validation` 判据不一致，且 validator 拒绝不可行动（不带修复包）

**What to build:** 让 `validation` 形状只有**一套判据**，并让被拒的委派**可行动**。

1. **判据合一。** `required === true` 而 `commands` 缺失或为空时，该 TaskSpec 在 schema 层即为**非法**。现在 `validValidation()`（`task.ts:707-713`）把 `commands` 当可选字段，于是同一形状先被判合法、再由 validator 守卫拒绝。两者只能留一套，以守卫的语义为准（见背景第 2 条）。
2. **构造器不得制造非法形状。** `createTaskSpec()`（`task.ts:461-469`）现在会产出 `{ required: true }` 且无 `commands`（`required ?? false` 保留 true，`commands` 仅在非空时写入）。schema 收紧后构造器必须同步：不得再产出 schema 层非法的 TaskSpec。是「拒绝」还是「要求调用方补 commands」，由实现者按 IS-02「不静默丢弃 validation 意图」裁定并在回执说明——但**不得**静默降级为 `required: false`。
3. **拒绝必须带修复包。** `orchestrate.ts:2675-2677` 只返回裸字符串 `{ block: { reason: ... } }`；紧邻的非法 spec 分支（`orchestrate.ts:2657-2672`）却调用 `appendTaskSpecRepair` + `buildTaskSpecRepair` 附带可粘贴的修复 JSON。validator 这条同样必须给出结构化 `code` 与修复包，否则操作者只能靠猜。
4. **拒绝文案指名缺失项。** 不得再用不点名的通用串 `需补充验证定义`（`roles.ts:70`）作为唯一信息；必须写明缺的是 `commands`。
5. **修复渲染器不得自相矛盾。** `repairSubmittedValidation()` 把 `{ required: true }` 原样保留为 `kept the submitted validation definition`（`task.ts:769-779`），而 `unresolved` 提示又把 `commands` 标成可选（`task.ts:813`）。前者不得再把一个会被守卫拒绝的形状判为 valid；后者必须写明 `required: true` 时 `commands` 必填且非空。
6. **回退到已入库 spec 时要引导到正确的下一步。** validator 委派的 spec 取值序是 `specDetails.spec ?? spec ?? target?.task?.spec`（`orchestrate.ts:2675`）。这不是死结——嵌入带 `commands` 的 spec 即可绕过——但它是个**隐藏逃生口**，且会造成「让 validator 去跑一套 worker 从未被要求覆盖的 commands」。因此不能只靠操作者发现这个口子：当命中的是**已入库** Task 的不完整 spec 时，拒绝文案必须指明是哪个 Task、并给出「新建 Task 携带完整 validation」的方向。

**Background / 证据：**

- **判据 A（schema / 构造器 / 修复器）：** `validValidation()`（`task.ts:707-713`）只要求 `required` 是 boolean、`commands` 若存在则是字符串数组 → `{ required: true }` 合法。`createTaskSpec()`（`task.ts:461-469`）据此产出该形状。`repairSubmittedValidation()`（`task.ts:765-814`）在 `validValidation` 为真时原样保留（`769-779`），兜底文案把 `commands` 写成 `commands?`（`813`）。
- **判据 B（validator 守卫）：** `hasMissingRequiredValidationCommands()`（`roles.ts:72-74`）＝ `required === true && (!commands || commands.length === 0)`；由 `orchestrate.ts:2675-2677` 直接 block，理由 `MISSING_VALIDATION_DEFINITION_REASON`（`roles.ts:70`）；`roles.ts:696-698` 另有一处早退。
- **`{ required: true, commands: [...] }` 两套判据都放行** —— `roles.ts:72-74` 的第二项为 false，`validValidation` 也接受。所以 TaskSpec 本身**可构造**，缺陷不是「无解」，而是判据不一致 + 拒绝不可行动。
- **运行时自产自销（比操作者实测更硬）：** `index.ts:388-396` 的 `automaticOracleDispatch` 把 worker 的 spec 原样 `{ ...task.spec, role: "validator", taskId }` 作为 oracle 建议发出去，`validation` 一字不改；而触发条件是 `orchestrate.ts:5124` 的 `task.spec?.validation.required === true` —— **只看 required，不看 commands**。于是一个 `required: true` 无 commands 的 worker spec 会让运行时**先建议 oracle、再自己把该 oracle 拦下**。而且 `orchestrate.test.mjs:183-208` 已经把这条路径固化成测试：行 194 的 worker 委派**成功**，行 199-206 的 task-id-only validator 委派被拒。
- **矛盾被写成绿断言：** `task.test.mjs:85` 断言 `validateTaskSpec(createTaskSpec({ validation: { required: true } }))` 返回 `[]`（零错误）。也就是说「schema 放行该形状」是**被显式断言过**的行为，不是疏忽。收紧 schema 必须反转这条断言，而不是绕过它。
- **操作者实测（2026-09-14 host-validation，root 复核扩展时发现）：** 连续 4 次向 oracle 下发只读复核全部被拒，提示在三种之间打转：`需补充验证定义`（判据 B）→ `validation must be an object when present`（`task.ts:594`）→ `validation.required must be a boolean`（`task.ts:597`）；按修复提示补齐 `required: true` 后又回到 `需补充验证定义`——因为缺的是 `commands`，而扩展自己的修复提示把 `commands` 标成了可选。**结果不是造不出 TaskSpec，而是拒绝不可行动、且提示把人引向错误字段。**
- 与本票**无关**、勿混为一谈的两件事见 Comments。

**Acceptance:**

- `{ required: true }`（无 `commands` 或空数组）在 `validateTaskSpec` 层返回错误，且错误文本中出现 `commands`。
- 代码库内不存在任何路径（含 `createTaskSpec`）能产出该形状。
- `{ required: true, commands: [...] }`、`{ required: false }`、`{ required: false, commands: [...] }`、无 `validation` 四种形状行为**逐字不变**。
- **新增被拒形状（行为变更，需明列）：** schema 收紧对**所有角色**生效，包括 worker。目前 `required: true` 无 commands 的 worker spec **可准入并执行**（`orchestrate.test.mjs:183-208` 行 194 即此路径），改后在准入即被拒。这符合 issue 11 语义，但它是对 worker 委派的行为变更，不得当作副作用悄悄发生。
- **守卫 `orchestrate.ts:2675` 改后仍然保留**，用于已入库的遗留 spec（`orchestrate.test.mjs:183-208` 覆盖的正是这条），但其拒绝改为结构化且可行动（要求 3、6）。
- validator 拒绝带结构化 `code` + 修复包；修复包中的示例必须是 schema 层合法的形状。
- 回归测试同步更新，且**不得**只为了让测试变绿而删除断言：
  - 必须**反转**（断言值本身要改，因为它固化的正是被取代的契约）：`task.test.mjs:85`（现断言 `validateTaskSpec` 零错误）、`task.test.mjs:83-84`（现断言构造器保留 `required: true` 且 `commands` 为 undefined）。
  - 必须**只换构造方式，断言值不变**：`roles.test.mjs:37-38`。守卫改后**仍要对遗留/已入库 spec 返回 true**（要求 6），所以 `hasMissingRequiredValidationCommands(...) === true` 保持不动；不能再用 `createTaskSpec` 造该形状，改用手写字面量。**不要把这两条翻成 `false`** —— 翻成 false 等于顺手取消了遗留拦截本身。
  - 必须**更新形状构造**（经 `createTaskSpec` 或展开覆盖制造该形状）：`orchestrate.test.mjs:170, 190, 2201`。
  - `orchestrate.test.mjs:183-208` 保留其覆盖意图（已入库 spec 的 task-id-only 拦截）。构造器收紧后该形状**不再能从 `createTaskSpec` 进入**：用**手写字面量**交给 `store.create` / `createTask`（二者都不做 spec 校验，`task.ts:1399-1432`），无需手写整条 raw record。若实现者顺带收紧了 `TaskValidation` 类型（`types.ts:149-153`，当前 `commands?` 可选）使 `required: true` 下 `commands` 必填，则该字面量需要显式 cast。**不得因为"造不出被拦场景"而删掉这段覆盖。**
  - 必须**改断言形式**：这几处断言的是裸字符串/中文提示，要求 3、4 加修复包与改名后会破 —— `orchestrate.test.mjs:177, 206, 2203`、`index.test.mjs:3226`。
  - `task.test.mjs:601`（`validation.required` 为字符串 `"true"` → schema 报错）**不受影响**，不需要改。
- `npm run typecheck` 与 `npm test` 绿。

**对既有验收的改动（需显式确认）：** 本票**取代** issue 11 的 checkbox「required 为真但 commands 为空：委派返回需补充验证定义的原因」，以及 `task.test.mjs:85` 所固化的「schema 接受该形状」——改为在 schema 层拒绝。理由：让非法形状在最早、信息最全的位置失败，而不是先判合法再由下游守卫拒绝。issue 11 其余四条不变。

**Blocked by:** 无。与 03（`validation.required` 非布尔）、11（验证状态五分法）、27/28（WorkerReport `validation` 元素形状）同族但**不是同一缺陷**：那几条管的是**报告**契约，本票管的是**委派**契约与 `commands` 在 `required: true` 下的地位。

**Status:** verified（2026-09-14：本机 `npm run typecheck` / `npm test` exit 0；宿主终验 A–E/G PASS，检查 F 在工单 47 落地后由 operator 于构建 `59d9ee3` 上以严格 task-id-only 的 `Validate T-20260912-016` 复跑并通过。要求 1–6 均有宿主或本机回归证据支撑。）

## Comments

2026-09-14 立案（host-validation 复核扩展故障复盘）。定位到 `validValidation` / `createTaskSpec` / `repairSubmittedValidation` / `hasMissingRequiredValidationCommands` 四处不一致；已确认当前 `main`（`091fa28`，等于运行中 clone 的 HEAD）仍存在，且 `.scratch/*/issues/` 下无对应工单。

2026-09-14 一轮复核修订（本机 `091fa28` 逐处核对）：

- 原标题「无法构造出任何可被接受的 TaskSpec」**过强，已撤**。`{ required: true, commands: [...] }` 两套判据都放行，标题改为「判据不一致且拒绝不可行动」。
- 第 6 条原写「死结」**不准确，已改**：嵌入带 commands 的 spec 可绕过，它是隐藏逃生口而非不可达；保留的只是「引导到新建 Task」的方向。
- 补入两处遗漏证据：`index.ts:388-396` 自动 oracle 建议原样透传 spec；`orchestrate.ts:5124` 触发条件只看 `required` 不看 `commands`。
- 补入遗漏的构造器 `createTaskSpec`（`task.ts:461-469`）与 `task.test.mjs:83-85`（把矛盾断言成绿）。
- 明确对 worker 委派的行为变更（现可准入，改后在准入被拒）。

2026-09-14 二轮复核修订（验收测试清单的两处实现提示）：

- `roles.test.mjs:37-38` 从「必须反转」改归「只换构造方式，断言值不变」。守卫改后仍要对遗留 spec 返回 `true`，翻成 `false` 会把要求 6 的遗留拦截一并取消。
- `orchestrate.test.mjs:183-208` 点明构造器收紧后该形状只能以手写字面量经 `store.create` / `createTask` 注入（二者不校验 spec），并提示若同时收紧 `TaskValidation` 类型则需显式 cast；防止实现者因「造不出被拦场景」而删除覆盖。

2026-09-14 同时排除的两种误判（避免重复立案）：

1. **不是跨任务污染。** 另一台主机（`/Users/chunchunmaomao`）的 `T-20260914-001` 其 `cwd` 与 `spec.cwd` 均为 `.../finance-check-workspace`，且是唯一声称 alias `T-20260910-005` 的任务，也不存在 canonical `T-20260910-005.json`。报告内容是它**自己的** workspace。两台主机同日各自铸出同名 `T-YYYYMMDD-NNN`（`task.ts:442`）——对笔记时的重号错觉。
2. **`evidence.cwd=undefined` / `freshness cannot be verified` 另有其因。** 该记录 `reports=1` 而 `executions=0`；`recordReport()`（`task.ts:1850-1858`）不要求 execution 存在。零 execution 时 `latestAttributionExecution()`（`orchestrate.ts:1666-1672`）为 undefined，没有 per-execution A_run/C_report 可绑，故命中 `orchestrate.ts:2026` / `review.ts:627` / `evidence.ts:1216,1789`。该记录尚未定因，需该机的报告本体与 `run-state/` 记录。

2026-09-14 另记（非本票范围，同意独立立案）：`Store.get()`（`task.ts:1489-1496`）先直接命中 canonical id、再按 `aliases` 遍历，**全程无 workspace 过滤**；`insertNew()`（`task.ts:1346-1348`）注册 alias 时不检查是否撞上已存在的 canonical id；唯一的 workspace 守卫 `TASK_WORKSPACE_MISMATCH` 只在 `continueTask()`（`task.ts:1466-1487`），**不在委派路径**（`orchestrate.ts:2233`）。本次未命中，但属潜在缺陷。

2026-09-14 实现（基于 `091fa28`，本机；未 commit）：

**改动**

- `task.ts`：新增单一判据 `isValidationDefinitionIncomplete()`（`required === true` 且 `commands` 缺失或空）与 schema 错误常量 `VALIDATION_COMMANDS_REQUIRED_ERROR`；`validateTaskSpec` 据此报错（要求 1）；`validValidation` 复用同一判据；`createTaskSpec` 拒绝该形状并抛 `TaskSpecContractError`（`code: TASKSPEC_VALIDATION_INCOMPLETE`）（要求 2）；`repairSubmittedValidation` 新增 `required: true` 分支 → needs-input（不再原样保留），`unresolved` 文案去掉 `commands?` 可选（要求 5）。
- `roles.ts`：`hasMissingRequiredValidationCommands` 改为复用同一判据 —— 两处判据从此在代码上不可能分叉（要求 1）。
- `orchestrate.ts`：validator 拒绝改为 `validatorValidationRefusal()`：结构化 `code: VALIDATION_DEFINITION_INCOMPLETE` + `buildTaskSpecRepair` 修复包；文案指名 `validation.commands`；命中已入库 Task 时给出 Task id 与「新建 Task 携带完整 validation」的下一步（要求 3、4、6）。**守卫本身保留**，服务遗留 spec。

**实现者裁定**（要求 2 留给实现者的选项）：构造器选择**拒绝**（结构化抛错），不走「静默要求调用方补 commands」，更不降级为 `required: false`。理由：`required: true` 与「无命令」本身矛盾，任何自动修补都是发明意图——补命令即伪造验收，降级即丢弃必填。

**测试**（按票的三类迁移，未删除任何断言）

- 反转：`task.test.mjs` 原 83-85 → 现断言构造器抛 `TASKSPEC_VALIDATION_INCOMPLETE`、schema 报错含 `validation.commands`。
- 只换构造方式、断言值不变：`roles.test.mjs:37-38` 改为手写字面量，仍断言 `=== true`（遗留拦截未被取消）。
- 换构造 + 保留并加强覆盖：`orchestrate.test.mjs` 两个 Ticket 11 块改为注入原始记录；已入库 spec 块新增断言 `code`、Task id、`create a new Task`、`validation.commands`。
- 改断言形式：`orchestrate.test.mjs` 原 2203（bare equality → schema 文案）、`index.test.mjs:3226`。
- 新增覆盖：worker 角色同形状如今在准入即被拒（本次行为变更）；修复渲染器对该形状必须 needs-input 且不得出现 `resubmitted as-is`（防静默降级）；四种不变形状逐一断言。

**门禁**：`npm run typecheck` exit 0；`npm test` exit 0（35 个测试文件全部执行，无 fail）。日志 `.scratch/planner-only-cost-control/p45-impl/{typecheck,npm-test}.log`（gitignored）。

**本次未做**

- **宿主终验**：未在真实 host 上复跑。
- **运行中的插件尚无此修复**：pi 加载的是 clone `~/.pi/agent/git/github.com/bioShaun/pi-planner-only`（当前 HEAD = `091fa28`），不随仓库 commit 变化；要生效需更新/pin 该 ref 后重启 session。
- `orchestrate.ts:5124` 的自动 oracle 触发仍只看 `validation.required === true`、不看 `commands`：对**遗留**已入库 spec，运行时仍会先发 oracle 建议、再由加固后的守卫拒绝（现在拒绝是结构化且可行动的）。未改，属本票范围外；建议单独评估是否让触发条件也要求定义完整。
- 工单 43 / 12 两条按约定压后，待本票定案一并看。

2026-09-14 复核修订一：空白命令绕过新判据（**已修**）

复核者在本机复现出验收明令禁止的那类形状又回来了：

```
输入 validation: { required: true, commands: ["  "] }
validateTaskSpec                          → []        （schema 放行）
createTaskSpec                            → { required: true, commands: [] }（构造器写出空数组）
isValidationDefinitionIncomplete(结果)     → true      （守卫必拒）
```

**根因**：谓词只看 `commands.length`，而 `createTaskSpec` 与 `repairSubmittedValidation` 之后都经 `uniqueNonEmpty()`（`task.ts:88-90`，trim + 滤空 + 去重）归一化，`["  "]` → `[]`。于是「schema 合法、守卫拒绝」在长度判据下重新可表示。修复渲染器同样中招：该输入被判 valid 后原样保留，渲染出的模板是 `commands: []`，schema 再拒。

**修法**：谓词改为数**可用**命令 —— 经 `isStringArray` 把关后要求 `commands.every((c) => c.trim() === "")` 才算 incomplete。与文案里已经写下的 "no usable validation.commands" 一致，四个调用点自动跟上。`["  ", "npm test"]` 不算 incomplete（归一化会丢掉空白项，留下可满足的定义）。

**回归证据**（本轮新验证，非历史 RED 声明）：把谓词临时改回 `commands.length === 0` 后，`task.test.mjs` 报 `the schema must reject {"required":true,"commands":["  "]}`、`roles.test.mjs` 报 `actual: false, expected: true`；恢复后 `npm run typecheck` 与 `npm test` 均 exit 0。新增断言覆盖 schema 拒绝、构造器拒绝（`TASKSPEC_VALIDATION_INCOMPLETE`）、守卫返回 true、修复渲染器 needs-input 且无 `resubmitted as-is`，以及 `["  ", "npm test"]` 的正向对照。

2026-09-14 复核修订二：`code` 到不了宿主边界（**既有行为，未改**）

要求 3 写的「结构化 code」只能在 orchestrator 层断言 —— `index.ts:1379` 把 `outcome.block` 压成 `{ block: true, reason: outcome.block.reason }`，`code` 与 `details` 都丢在这一层。**所有** block code 皆如此，并非本票引入。操作者实际收到的是 `reason` 文本；修复包是拼进 `reason` 的，故要求 3、4、6 的**可行动性不受影响**。是否让 host 边界透传 `code`/`details`，另立小票评估。

2026-09-14 宿主终验（`.scratch/planner-only-cost-control/p45-host/summary.md`，被验构建 clone HEAD `bfc70e9`）：A/B/C/D/E/G PASS，**F FAIL**。F 的根因不在本票代码：点名的 `T-20260911-001` 排在会话恢复上限之外（rank 100 > `MAX_LEDGER_RESTORE_PER_SESSION` = 64），validator 解析按 §5 第五级退到本 cwd 的 active Task `T-20260913-046`，stored-task 守卫因此未触及。已立 [工单 47](47-validator-named-task-unresolved-falls-back-to-active.md)。本票状态保持 done；转 verified 需在 47 落地后复跑检查 F。

2026-09-14 实现补充（随工单 47 一并落地，追加于上段之后）：要求 1 的「判据合一」当时漏了**第五处副本** —— `orchestrate.ts` 的 `embeddedTaskLooksInvalid` 闭包内仍是旧的 length 判据（`required === true && (!Array.isArray(commands) || commands.length === 0)`，不 trim）。现改走 `isValidationDefinitionIncomplete()`；malformed `commands` 仍留在本地判断，因为那是 shape 错误、共享谓词刻意不管。另：检查 F 的宿主复跑目标已由工单 47 定为 **`T-20260912-016`**（原因见 47 的 Acceptance：`T-20260911-001` 属别的 workspace，在 47 §2 的 workspace 校验下必然拒绝采纳，拿不到 stored-task 拒绝）。

2026-09-14 宿主复跑检查 F（operator 会话，被验构建 `59d9ee3`，`loaded=629b4b6133e9`）：**PASS**。严格 task-id-only 的 `Validate T-20260912-016` 触发了本票的 stored-task 拒绝，逐字含 `Task T-20260912-016 is stored with validation.required = true but no usable validation.commands, so no Validator delegation for it can start. The stored TaskSpec is not editable: create a new Task that carries a complete validation definition.`，reason 同时含 `validation.required is true, but validation.commands is missing or empty`（要求 4）并附修复包（要求 3）；**无 run、无警告、无 active 兜底**。同轮次另有 `Validate T-20260911-001` → 47 的 `VALIDATOR_TARGET_UNBOUND` + `belongs to workspace` 说明（测的是 47 的引用判据）。门禁 `npm run typecheck` / `npm test` 在 `59d9ee3` 上均 exit 0。至此要求 1–6 全部有宿主证据或本机回归证据支撑。

