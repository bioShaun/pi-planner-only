# 19: `validation.commands` 接受散文 —— 守卫只查"非空字符串"，不查"像一条命令"

Status: done（2026-09-16；task.ts 单谓词 isExecutableCommandShape + 新 code TASKSPEC_VALIDATION_COMMAND_NOT_EXECUTABLE，schema/构造器/修复渲染共用；delegate.test.mjs 边界用例 + orchestrate.test.mjs 恢复回归）

## 现象

session `01a0a9cc-7abb-7362-b5d6-d309ab6212a6` 中 Root 两次 `planner_delegate` 调用的实发参数：

```json
"validation": {
  "required": true,
  "commands": ["按工单和 package.json 选择相关回归测试及必要检查，并在报告中记录准确命令和退出码"]
}
```

这是一句给 worker 的指令，不是可执行命令。该调用因 `TASK_UNKNOWN` 被拒（票 13/17 范围），所以未进入 spec 构造；但若 `taskId` 正确，`createTaskSpec` 会**放行**——票 45 的 `isValidationDefinitionIncomplete`（`task.ts:727-734`）只问"有没有非空白字符串"，`validateTaskSpec`（`task.ts:587-588`）只问"是不是字符串数组"。

## 后果链

`validation.commands` 是 typed 契约中**唯一会被机器逐字消费**的字段，散文进入后每个消费者都失效：

- **worker packet**：worker 收到一条无法执行的"命令"，要么报 `not-run` / `failed`，要么自行改写成真实命令去跑。
- **完成判定**：`missingTaskSpecValidationCommands`（`roles.ts:36-48`）把 spec commands 与 WorkerReport `validation[].command` **逐字**比对。worker 跑的真实命令永远匹配不上散文 → `renderTaskStatus` 的 `Validation: passed` 行（`orchestrate.ts:1682-1698`）永远不出现，Task 无法按正常路径宣告验证完成。
- **更坏的分支**：worker 若把散文原样填回 `command` 字段并标 `passed` / `exitCode: 0`，逐字比对反而**通过**——一条从未执行的"命令"被记为已验证。这是契约被伪造而非降级。
- **validator 角色**：oracle 要执行 spec commands，散文不可执行。

与票 15 的关系：票 15 修的是 `required: true` 且 commands **缺失**；本票是 commands **存在但不是命令**。同一守卫的相邻缺口。

## 要求

### R1. 单一谓词 `isExecutableCommandShape(command: string): boolean`（`task.ts`）

沿用票 45 "一个问题只在一处回答" 的原则，所有消费点共用。判定规则（保守，只拦明显不是命令的）：

1. `trim()` 后非空（空白已由票 45 处理，此处直接 `false` 即可）。
2. 不含换行（`\n` / `\r`）。
3. 去掉前导环境变量赋值（`^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*`）后，**首个空白分隔 token** 匹配 `^[A-Za-z0-9_./~-]+$`（程序名或路径，如 `node` / `npx` / `./scripts/x.sh` / `~/bin/x`）。
4. 首 token 之后的内容不做限制（参数里允许任意字符，包括 CJK、引号、`&&`、`|`）。

明确**不**做的事：不判断程序是否存在、不解析 shell 语法、不限制长度。

### R2. 接入点

- `createTaskSpec`（`task.ts:424` 起）：`validation.commands` 中任一项 `isExecutableCommandShape` 为假 → 抛 `TaskSpecContractError`，新 code `TASKSPEC_VALIDATION_COMMAND_NOT_EXECUTABLE`（加入 `TaskSpecContractErrorCode` 联合）。消息回显违规项（每项截断 120 字）与其索引，并给两条出路：

  ```
  validation.commands[0] does not look like an executable command (received: "按工单和 package.json 选择相关回归测试及必要检查，并在报告中记录准确命令和退出码"). Each entry must start with a program name or path (e.g. "node --experimental-strip-types delegate.test.mjs", "npx tsc --noEmit"). Move instructions into acceptanceCriteria or constraints, and either supply real commands or set validation.required to false.
  ```

- `validateTaskSpec`（`task.ts:580-595` 附近）：同谓词，错误文案 `validation.commands[<i>] is not an executable command shape`。
- `repairSubmittedValidation`（`task.ts:861-872` 两个"完整定义"分支）：`every(item => typeof item === "string" && item.trim())` 改为同时要求 `isExecutableCommandShape`；不满足的进入 `unresolved`，措辞与 R2 一致。**不得**静默丢弃违规项——那会把 `required: true` 变成实际无命令的定义，正是票 45 关闭的缺口。
- `PLANNER_DELEGATE_PARAMETERS.validation.commands` 描述（`delegate.ts:214-216`）追加：`Each entry is a shell command starting with a program name or path, not an instruction sentence.`

### R3. 恢复路径不受影响

`createTaskSpec` 的调用方（`delegate.ts:461`、`orchestrate.ts:911/919/927/930`）中，实现者须逐处核对哪些用于**从 ledger 恢复既有记录**。已落账的 Task 若含散文 commands，恢复时**不得**因本检查失败而丢记录。若恢复路径经过 `createTaskSpec`，通过 `CreateTaskSpecInput` 上的显式选项（如 `{ trustStoredShape: true }`）跳过该检查，并在测试中用一条含散文 commands 的旧记录锁定"可恢复、状态渲染不崩"。

### R4. 与票 16 的配合

本票新增一个 refusal code，票 16 的熔断按 `error.code` 计数，自动覆盖，无需额外接线。

## 验收标准

- `task.test.mjs`：
  - `isExecutableCommandShape` 正例：`node --experimental-strip-types x.mjs`、`npx tsc --noEmit`、`./scripts/run.sh --flag`、`FOO=1 npm test`、`cd sub && npm test`、`grep -r "中文" src/`（CJK 在参数里）。
  - 反例：`按工单和 package.json 选择…`、`Run the test suite and record exit codes`、`"quoted first token"`（可接受为反例或正例，实现者定并锁定）、含 `\n` 的多行文本。
  - `createTaskSpec({ validation: { required: true, commands: ["按工单…"] } })` 抛 `TASKSPEC_VALIDATION_COMMAND_NOT_EXECUTABLE`，消息含 `received:` 与违规原文、`acceptanceCriteria`、`required to false` 三个锚点。
  - 混合数组（一条合法 + 一条散文）仍拒绝，消息只点名散文项的索引。
  - `required: false` + 散文 commands：**行为由实现者定**（建议同样拒绝，因为 `required: false` 时 commands 仍可能被 validator 读取），在测试中锁定。
  - `repairSubmittedValidation` 对散文 commands 返回 `unresolved`，不返回 `validation`。
  - 恢复路径用例（R3）。
- `delegate.test.mjs`：真实 `runDelegation` 边界，散文 commands → 拒绝，launcher 0 次、Task 0 铸造，`code` 为新值。
- 票 15 / 45 既有断言逐字不变；`{"required": true}` 无 commands 仍走 `TASKSPEC_VALIDATION_INCOMPLETE`，不被本票 code 抢先。
- `node --experimental-strip-types task.test.mjs`、`delegate.test.mjs`、`orchestrate.test.mjs` 与 `npx tsc --noEmit` 全绿。

## 非目标

- 不校验命令是否真的可执行或程序是否安装。
- 不改 `missingTaskSpecValidationCommands` 的逐字比对语义。
- 不处理 WorkerReport 侧 `validation[].command` 的形状（那是 report 契约，另议）。

## 关联

- 票 45（`planner-only-cost-control`）与票 15：同一守卫的相邻缺口，本票补"存在但不可执行"。
- 票 16：新 code 自动纳入熔断。
- 票 17：`taskId` 修好后，这条散文 commands 的调用会真正进入 `createTaskSpec`——本票是 17 落地后立刻会暴露的下一层。

## Comments

- 2026-09-16（开票）：证据为 session `01a0a9cc` 两次 toolCall 的实发 `validation.commands`；后果链依据 `roles.ts:36-48` 逐字比对与 `orchestrate.ts:1682-1698` 状态渲染逐行核对。
- 2026-09-16（落地）：三处实现者裁量，均已锁进测试。
  1. R1 规则的字面 regex `^[A-Za-z0-9_./~-]+$` 会放行 `Run`（首 token 形态合法），与验收反例 `Run the test suite and record exit codes` 冲突——补一条保守规则：首 token 为单个首字母大写英文单词（`^[A-Z][a-z]+$`，Run/Check/Verify/Please）判为散文；`MSBuild` 这类多字母大写的程序名不受影响。`"quoted first token"` 锁定为反例（去掉引号再提交即可）。已知的残余漏判：全小写英文祈使句（`please verify …`）与小写程序名不可区分，属谓词明文"不解析 shell 语法"的边界。
  2. `required: false` + 散文 commands 同样拒绝（采纳建议，validator 仍可能读取列表）；repair 路径不静默丢弃，进 `needs-input`。
  3. R3 核实：恢复路径 `LedgerSnapshotStore.readAll()` 只做 `JSON.parse` 后进 `store.restore()`，**不经过** `createTaskSpec`——`trustStoredShape` 选项不需要；`orchestrate.test.mjs` 用含散文 commands 的旧快照锁定"可恢复、渲染不崩"。
  - 顺带：空白项保持票 45 语义（归一化丢弃而非拒绝），本检查只作用于非空白项。
