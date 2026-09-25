# 52: validator 的 validation 判定统一按「有效提交定义」执行；`submitted` 渲染参数改读嵌套 spec（原「文案归因缺陷」前提不成立）

**2026-09-14 立案时的前提已被推翻。** 立案依据是宿主检查 1（20:03，`tool_2efQQUInS5R6mMGYctb0fwt9`，task-id-only 委派「Validate T-20260912-016」）返回「Task T-20260912-016 is stored with validation.required = true but no usable validation.commands」，而 23:33 时账本里 016 的 stored validation 是 `{"required":false}`。复盘会话记录后确认：**20:03 那条文案是准确的**，当时 stored 就是 `{required:true}` 无 commands；是 22:13:32 的一次 root 发起的 report-only 纠正委派（`tool_1NQkH65wpljhCBCrM8l42LKM`，agent=worker，嵌入 objective 为「Report-only correction: submit an amended WorkerReport declaring the complete 91-path changed-file set…」、`validation` 未给、role worker 的 TaskSpec）经 `beginDelegationInner` 的 `if (existing) this.store.bindSpec(existing.taskId, persisted)` 把 016 的 stored spec 整个替换掉了（objective / scope / constraints / validation 全部变成纠正委派的内容）。该缺陷另立 **工单 53**。

**本票实际落地的两项（commit 见分支 `fix/ticket-52-refusal-attribution`）：**

1. **省略 `validation` 的判定统一。** 48 门不再要求「显式提交了 validation 键」：提交 spec 经提取物化后的 `validation`（省略即 `{required:false}`，这也正是子进程 packet 里拿到的定义）直接与 stored 比较。省略 validation 而 stored 要求 commands → `VALIDATOR_SPEC_CONFLICT`（`validation.required differs (submitted false, stored true)`），直接调用路径与宿主打包路径一致；stored 也是 `{required:false}` 则放行。理由：fail-closed，且子进程实际执行的就是物化后的定义，按它判才诚实；文案已指明出路（不嵌 spec、只点名 Task）。
2. **`submitted` 渲染参数改读 `specDetails.submitted`**（R01 无效 spec 拒绝与 45 守卫两处）。packet 直接提交时 `candidate` 是外层对象，渲染器会拿不到 objective/role；非 packet 时两者相同，无行为变化。

**测试**（`orchestrate.test.mjs`）：省略 validation vs stored 要求 commands，直接路径与 `prepareRoleDelegation → beginDelegation` 宿主路径各一例 → 冲突；省略 validation vs stored `{required:false}` 宿主路径 → 放行。原 933 例改为上述预期。`npm run typecheck` / `npm test` exit 0。

**宿主验收（待 operator）：** 对一个 stored 为 `{required:true, commands:[…]}` 的 Task 嵌入不含 `validation` 的 validator TaskSpec → 预期同步拒绝 `validation.required differs (submitted false, stored true)`，无 run。

**2026-09-15 07:02 宿主验收：PASS。** 构建 `bd784c0`（pin checkout，会话 `2026-09-14T23-01-42-828Z`）。root 对 046（stored validation 6 条命令）发起 agent=oracle 委派，嵌入 `{taskId, objective, cwd, role:"validator"}`、无 `validation`（root 未逐字转发，加了「TaskSpec (echo this taskId in your report):」前缀，四个字段原样）。同步拒绝，无 run，回执逐字：`Planner-only guard: the submitted TaskSpec disagrees with Task T-20260913-046's stored validation — validation.required differs (submitted false, stored true). A Validator is judged against the Task's stored definition: resubmit with that definition, or name the Task without embedding one.` 回执不含 `VALIDATOR_SPEC_CONFLICT` 字面量——该码只在 `block.code` 上，宿主只渲染 `block.reason`（会话 jsonl 中该字符串 0 次），验收以措辞为准。

披露：root 被拒后自行重试 5 次（补 `{required:true}` → 拒「commands 为空」；补两条 git 命令 → 拒「commands 与 stored 不同」；照抄 stored 六条 → 放行），实际拉起两个 046 validator run（`dad7a18b…`、`9a91bd53…`，六条命令均 exit 0），046 由 changes_requested 转 blocked（evidence-no-progress）。属 root 自主行为，与本票判定无关。

**Status:** verified（2026-09-15 宿主验收 PASS on `bd784c0`。原「文案归因」前提不成立，见上；真实缺陷转 53，已一并 verified。）
