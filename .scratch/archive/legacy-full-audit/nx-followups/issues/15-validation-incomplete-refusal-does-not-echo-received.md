# 15: `TASKSPEC_VALIDATION_INCOMPLETE` 拒绝不回显实收形状 —— 模型幻觉"已发送 commands"原地重试

Status: done

## 现象

宿主观测（2026-09-16，session `~/.pi/agent/sessions/--public-pi-pi-planner-only--/2026-09-16T09-55-05-484Z_...jsonl`）：planner-only Root 派 worker Task（实现票 14），连续 3 次调用 `planner_delegate` 均被拒：

```
createTaskSpec refused: validation.commands must be a non-empty array of strings
when validation.required is true. Supply the commands, or set validation.required
to false when no validation is mandatory.
```

每次拒绝之间模型都在叙述中声称"这次我把 commands 写进去了"，但会话 JSONL 记录的**实发参数**三次逐字相同：`"validation": {"required": true}`，`commands` 键根本不存在。模型随后得出"`commands` 被 harness 丢弃"的错误结论，改用 `required: false` + 把验证命令写进 acceptanceCriteria 散文绕过，任务虽派出但验证契约被降级。

## 机制与证据

- **拒绝本身正确，是票 45 的落地行为。** `createTaskSpec` 对 `isValidationDefinitionIncomplete`（`required === true` 且 commands 缺失/全空白，`task.ts:727-734`）抛 `TaskSpecContractError`（`task.ts:428-432`）。
- **管线不丢字段，已用同会话正例证伪。** 同 session 内较早一次调用（toolCall `e7ef42d7`）发出 `{"required": true, "commands": ["node --experimental-strip-types delegate.test.mjs", "npx tsc --noEmit"]}` 并成功委派（T-20260916-031）。链路逐段无剥离：schema 声明 `commands`（`delegate.ts:212-215`）；`execute` 原样透传 params（`index.ts:788-805`）；`specFromParams` 原样复制 `params.validation.commands`（`delegate.ts:470-473`）。
- **循环的成因是拒绝只点名缺失、不回显实收。** 模型陷入了"叙述与发射分叉"：它认为上一轮已发出 commands，而拒绝文本只说"commands 缺失"——这与它脑内"我发了但丢了"的解释**兼容**，无法证伪其幻觉，于是反复重发同一参数对象。若拒绝里带上 `received validation: {"required":true}`（或 `received keys: [required]`），实据直接戳破"我明明发了"的幻觉。
- **绕过的代价是契约降级。** `required: false` 时 commands 只是散文：自动 oracle 派发只认 `validation.required === true`（`index.ts` `automaticOracleDispatch` / `orchestrate.ts` 触发条件），typed commands 也是 validator 实际执行的对象。把命令挪进 acceptanceCriteria 不会进入该通路。

## 改进方向

1. **拒绝文案回显实收 validation**（可直接派活）：`TaskSpecContractError` 消息（`task.ts:429-432`）附加调用方实发的 validation 形状，如 `…when validation.required is true (received: {"required":true})`。注意该常量 `VALIDATION_COMMANDS_REQUIRED_ERROR` 同时被 `validateTaskSpec`（`task.ts:593-594`）复用——回显适合加在构造器/委派边界一侧，schema 校验错误路径可只列键名或不动，由实现者裁定并在回执说明。
2. **schema 描述写明必填关系**（顺手，低成本）：`PLANNER_DELEGATE_PARAMETERS` 的 `validation` 对象（`delegate.ts:212-215`）目前对 `commands` 无任何 description。补一句 "commands is required and must be non-empty when required is true" 可让模型在首次发射时就配对两个字段，从源头减少触发。
3. **可选：重复拒绝检测。** 同一 refusal code + 逐字相同参数重发 N 次时追加一句"上一次调用的实收参数与本次逐字相同"。属于更强的熔断提示，是否做由维护者定；方向 1 已能覆盖大部分场景。

## 验收标准

- `{"required": true}`（无 commands 或全空白）的委派拒绝文案包含实收 validation 的可读回显（含 commands 缺失这一事实），且仍点名 `validation.commands` 与两条合法出路（补 commands / 改 `required: false`）。
- `delegate.test.mjs` / `task.test.mjs` 相应断言更新；`node --experimental-strip-types delegate.test.mjs` 与 `npx tsc --noEmit` 绿。
- 不改变拒绝语义与错误 `code`；`required: false`、`required: true` 带合法 commands 等正常形状行为逐字不变。

## 关联

- 票 45（`planner-only-cost-control`）：本票观察到的是该守卫的正确触发，拒绝逻辑无缺陷；缺的是反馈面。
- 票 13 同族：守卫拒绝正确，但拒绝文本没有给调用方足以打破重试循环的信息。
- 模型侧"叙述与发射分叉"本身不在本仓可修范围——本票只要求拒绝成为 loop-breaker。

## Comments

- 2026-09-16（落档）：证据取自该 session JSONL 的实发 toolCall arguments（三次 `{"required":true}` 无 commands 的调用 id：`3d068803` / `9f45605d` / `d93d9a9c`；正例 `e7ef42d7`），非模型自述。定性为可用性/防幻觉加固。
- 2026-09-16（实现）：`createTaskSpec` 的 `TASKSPEC_VALIDATION_INCOMPLETE` 消息现回显实收 validation JSON；`planner_delegate` schema 同时注明 `required: true` 时 `commands` 必须含非空命令。`delegate.test.mjs` 在真实 `runDelegation` 边界断言消息、零 launcher 调用和零 Task 铸造，`task.test.mjs` 覆盖缺失、空数组和全空白数组。
- 2026-09-16（复发辨析）：session `01a0a9cc-7abb-7362-b5d6-d309ab6212a6` 的两次原始 toolCall arguments 均仍含 `"taskId":"T-20260918-015"` 且逐字相同，第二次并未按模型叙述省略。票 13/14 已加载（新恢复指引出现在拒绝中），宿主也未补回字段；这是 `TASK_UNKNOWN` 的同参数重发，且该拒绝本来已回显实收 taskId，不属于本票 validation 回显修复可消除的路径。若要在工具侧继续加固，需另做“相同 code + 相同参数重复拒绝”检测。
- 2026-09-16（立项）：上述检测已正式立项为票 16（通用重复拒绝熔断）；创建路径上 `taskId` 幻觉的结构性根治立项为票 17（拆分 `planner_delegate` / `planner_redelegate`）；票 13 方向 2 的枚举工具立项为票 18；同一守卫的相邻缺口"commands 存在但是散文"立项为票 19。本票范围不变，仍只负责 validation 回显。
- 2026-09-17（验收通过与收口）：
  - HEAD: `de2cdbd0466070f6f8b6ea9350bf523b4696cdfd`（复用 T-20260917-004 typecheck 与全量测试通过记录；定向核查源码与测试用例）。
  - 验证命令与结果：
    - 定向测试：`TMPDIR="$(pwd)/.scratch/nx-followups/15-closeout/tmp" node --experimental-strip-types task.test.mjs`（通过，退出码 0，未向 `/tmp` 写入临时文件）。
    - 格式检查：`git diff --check`（通过，无空白异常）。
    - 历史全量测试与类型检查继承：同 HEAD 上 `npm test`、`npm run typecheck`（`tsc --noEmit`）均通过。
  - 核心实现与覆盖核验：
    - 错误文案回显实收形状（`task.ts:452-457`）：`createTaskSpec` 在 `isValidationDefinitionIncomplete(input.validation)` 触发时抛出 `TaskSpecContractError("TASKSPEC_VALIDATION_INCOMPLETE")`，消息明确带出 `(received validation: ${JSON.stringify(input.validation)})`，直接戳破模型“以为 commands 已发送”的幻觉，并保留补 commands 与设 `required: false` 两条合法出路。
    - Schema 描述约束（`delegate.ts:212-214`）：`PLANNER_DELEGATE_PARAMETERS.validation.commands` 补全字段描述，明确提示 `validation.required` 为 `true` 时必填且必须包含非空 shell 命令，从源头减少漏发。
    - 拒绝边界与用例断言（`task.test.mjs:80-96`）：断言 commands 缺失（`{ required: true }`）、空数组（`{ required: true, commands: [] }`）、全空白数组（`{ required: true, commands: ["  "] }`）均触发 `TASKSPEC_VALIDATION_INCOMPLETE`，且消息精确匹配 `received validation: ...` 回显。
    - 委派执行边界防护（`delegate.test.mjs:224-245`）：真实 `runDelegation` 边界下对缺省 commands 触发拒绝，断言精确错误文案、拒绝 code `TASKSPEC_VALIDATION_INCOMPLETE`，且验证 `launches.length === 0`（零 launcher 调用）、`deps.store.list().length === 0`（零 Task 铸造）。
    - 语义保持与正常路径无回归：拒绝 code 保持 `TASKSPEC_VALIDATION_INCOMPLETE` 不变；`required: false` 及合法 commands 正常委派路径行为与结构无任何回归。
  - 衍生问题与后续票据承接：
    - 票 16（`repeated-refusal-breaker.md`）：在框架层实现相同拒绝 code 与逐字相同参数重复触发时的机器熔断，防止文案回显仍无法唤醒的模型死循环。
    - 票 17（`split-delegate-creation-from-rebinding.md`）：拆分 `planner_delegate`（纯新建，无 taskId 入参）与 `planner_redelegate`（按 canonical taskId 绑定），从根源消除新建任务时的 ID 幻觉。
    - 票 18（`planner-tasks-readonly-listing.md`）：引入只读 `planner_tasks` 工具提供 live Task 状态与 canonical ID 自查。
    - 票 19（`validation-commands-accept-prose.md`）：针对相邻缺口“commands 存在但填入散文句子”增加可执行命令格式检查与 `TASKSPEC_VALIDATION_COMMAND_NOT_EXECUTABLE` 拒绝。
  - 结论：票 15 预期改动已完整落地并经双层测试（构造器 + 委派边界）充分覆盖，满足验收标准，收口关闭此票。
