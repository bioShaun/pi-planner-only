# 15: `TASKSPEC_VALIDATION_INCOMPLETE` 拒绝不回显实收形状 —— 模型幻觉"已发送 commands"原地重试

Status: needs-triage（改进方向可直接派活；本质是拒绝文案加固，非契约变更）

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
