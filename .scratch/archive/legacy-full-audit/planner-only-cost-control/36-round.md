[轮次] round_id=PLACEHOLDER

# 工单 36 / F1：把 §F 接到宿主真实的预算参数 schema 上

你是本轮唯一的写入者。规划者在 herdr pane **`w2E:pD`**，做完必须把回执发回那个 pane
（`herdr agent prompt --target w2E:pD --message '<回执>'`），否则我收不到。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`（git 仓库，分支 `planner-only-cost-control`）。

## 你必须遵守的环境规则（不要跳过，你的全局规则文件可能没被加载）

- **禁止**在 `/tmp` 或其子目录下创建任何中间文件、临时目录、缓存、构建暂存或任务产物。
  任务内的中间文件放当前工作目录下一个明确命名的可丢弃子目录；需要放到工作目录之外时用 `/project/tmp`。
  这条对 shell 命令、脚本、工具、子进程、以及你委派的子代理同样生效。
- **重活必须走 slot 排队**：预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，
  一律用 `slot cpu -- <命令>` 提交（本轮验收命令见下）。
- **启动重任务前必须先运行 `slot audit` 和 `slot status`**，并把输出写进
  `.scratch/planner-only-cost-control/p14-r064-slot-preflight.log`。
  `slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；等待、降低并发或在回执里报告资源冲突。
  禁止先启动重活、事后再补查。不要用 `slot slots` 调大槽位给自己插队。
- `.agent-dir/models.json` 和 `.agent-dir/auth.json` 含 API key：**不许读取、不许回显、不许提交**。

## 允许改的文件（fence）

- **只允许改 `e2e.pi-subagents.test.mjs`。**
- 所有 `*.ts` 源码、所有其它 `*.mjs` 测试、`package.json`、`tsconfig.json`：**只读**。
- `.scratch/` 下除本轮日志外**只读**（不要勾任何工单复选框，不要改 `spec.md`，不要改工单文件）。
- **不要 `git commit`、`git add`、`git stash`、切分支。** 提交由规划者做。

## 背景（这些事实我已经实跑核验过，直接用，不要再自己推翻）

pi-subagents 0.66.0 的 `package.json` `exports` 有 14 个子路径，**没有一个能走到委派工具的参数 schema**。
但宿主**确实**接受每次委派带的 `toolBudget` / `usageBudget` —— 它们声明在包内
`src/extension/schemas.ts` 的 `SubagentParamProperties` 里，由 `createSubagentParamsSchema()` 导出的
`SubagentParams` 承载。这是个**非导出的内部路径**，这一点必须在测试里写明。

我在暂存树里实跑得到的形状（逐字）：

```
toolBudget: {"type":"object","required":["hard"],"properties":{"soft":{"type":"integer","minimum":1},"hard":{"type":"integer","minimum":1},"block":{...}},"additionalProperties":false,...}
usageBudget: {"type":"object","properties":{"tokens":{"type":"object","required":["hard"],"properties":{"soft":{"type":"number","exclusiveMinimum":0},"hard":{"type":"number","exclusiveMinimum":0}},"additionalProperties":false},"costUsd":{同 tokens}},"additionalProperties":false,...}
```

`e2e.pi-subagents.test.mjs` 现在已经把整个包 `cpSync` 到 `workDir/pi-subagents`（变量 `pkgCopy`），
并把兄弟依赖软链到 `workDir/node_modules`。**因为拷贝出来的副本不在 `node_modules` 下，
`node --experimental-strip-types` 可以直接 `import()` 它的 `.ts`** —— 我已实跑验证：

```
import(pathToFileURL(join(pkgCopy, "src", "extension", "schemas.ts")).href)
→ exports: SubagentParams, SubagentWaitParams, createSubagentParamsSchema
```

另外我已实跑验证：用**本仓库自己的** `typebox`（`peerDependencies` + `devDependencies` 都声明了）
的 `Check` 去校验宿主 schema 是可行的，跨小版本没问题（本仓库 1.3.7 / 宿主 1.1.38）：

```
Check(schema, 由 applyRoleDelegation 生成的 validator 载荷) → true
Check(schema, 由 applyRoleDelegation 生成的 bounded worker 载荷) → true
Check(schema, {...worker, toolBudget: {soft: 5}})                  → false
Check(schema, {...worker, toolBudget: {hard: 0}})                  → false
Check(schema, {...worker, usageBudget: {tokens: {soft: 1}}})       → false
Check(schema, {...worker, usageBudget: {tokens: {hard: 1}, nope: 1}}) → false
Check(schema, {...worker, __floorLimits: {...}})                   → **true**（顶层不禁额外键）
```

**最后一条很重要**：宿主的顶层对象不禁止额外属性，所以 `Check` 抓不到 `__floorLimits` 泄漏。
不许在测试里写「Check 能挡住内部键泄漏」这类话 —— 那是假的。内部键要单独断言（见下）。

## 本轮要做的事

把 `e2e.pi-subagents.test.mjs` 里现有的 §F 段（现在是找 `exports["./budget"] ?? exports["./preflight"]`
里的 `resolveSubagentBudgetContract`，找不到就 `markContractUnverified("F", ...)`）整段替换掉。
位置、`// §F` 段头注释的形式、它夹在 §E 和 §G 之间的顺序都保持不变。

新的 §F 必须做到：

1. **在段头注释里显式写明**：pi-subagents 0.66.0 没有任何导出子路径能到达委派参数 schema，
   所以这里断言的是**包内非导出的内部路径** `src/extension/schemas.ts`；断言绑定在
   `package.json` 的 `pi-planner-only.piSubagents` 声明范围上，上游重构挪走或改形状时
   **这道闸门要变红，而不是悄悄变绿**。
2. **同一段注释里留痕**：本段只证明「宿主接受我们发的预算参数形状」，
   **运行时子代理是否真的在 `hard` 处停下来，本段没有证明**（那是另一件事，本轮不做）。
3. 从 `pkgCopy` 导入 `src/extension/schemas.ts`，取 `createSubagentParamsSchema()`。
   文件不存在、`import()` 抛错、或拿不到函数时，**仍然走
   `markContractUnverified("F", <说明具体是哪一种>)`**，不许直接 `throw`、不许静默跳过。
4. 结构断言（对 `schema.properties.toolBudget` 与 `schema.properties.usageBudget`）：
   - `toolBudget`：`required` 含 `"hard"`；`properties.hard.type === "integer"` 且 `minimum === 1`；
     `additionalProperties === false`。
   - `usageBudget`：`additionalProperties === false`；`tokens` 与 `costUsd` 两支各自
     `required` 含 `"hard"`、`properties.hard.type === "number"`、`properties.hard.exclusiveMinimum === 0`、
     `additionalProperties === false`。
5. 真实载荷校验：`import { Check } from "typebox/value";`（加到文件顶部的 import 区），
   用**本仓库自己的** `applyRoleDelegation`（文件里已经 import 过了）加 `stripDelegationKeys`
   （从 `./roles.ts` 追加导入）造两个真载荷 —— 一个 `role: "validator"`，一个带
   `reportsCount: 1` 的 bounded `role: "worker"` —— 各断言 `Check(schema, payload) === true`，
   并断言它们确实带上了 `toolBudget.hard` 和 `usageBudget.tokens.hard` / `usageBudget.costUsd.hard`
   （否则「校验通过」可能只是因为载荷里压根没有预算字段，那是空转）。
6. 四条否定用例，各断言 `Check(...) === false`：`toolBudget` 缺 `hard`、`toolBudget.hard === 0`、
   `usageBudget.tokens` 缺 `hard`、`usageBudget` 多一个未知键。
7. 单独断言 `stripDelegationKeys` 之后载荷里**没有** `__floorLimits`，并在紧邻注释里写明
   宿主顶层不禁额外键、所以这条不能靠 `Check` 保证。

## 不许动的东西

- `markContractUnverified` 函数本身、`reportUnavailable`、以及 §E / §G 的闸门分支与措辞：**一律不动**。
- §A–§E、§G 的任何断言：**一律不动**。
- 文件末尾 `process.exitCode === 1` 那段 PASS/FAIL 收尾逻辑：**不动**。
- 不许放宽任何已有断言来让测试变绿。

## 验收（四条闸门 + §F 转绿）

先做 slot 前置检查并写日志，然后：

```bash
slot cpu -- npm run typecheck
slot cpu -- npm test
slot cpu -- npm run test:e2e
git diff --check
PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e
```

全部退出码 0。最后一条现在是**红的**（基线逐字如下），你改完必须变绿：

```
planner-only pi-subagents E2E: §F 预算宿主契约未验证 (pi-subagents 未暴露无模型调用的 budget 契约公开接口)
planner-only pi-subagents E2E: FAIL — release gate requires §F contract coverage: pi-subagents 未暴露无模型调用的 budget 契约公开接口
```

不带闸门变量时，基线 stdout 逐字是：

```
planner-only pi-subagents E2E: §F 预算宿主契约未验证 (pi-subagents 未暴露无模型调用的 budget 契约公开接口)
planner-only pi-subagents E2E: PASS
```

改完之后，不带闸门变量的 stdout 必须**只剩** `planner-only pi-subagents E2E: PASS` 一行
（§F 那行消失，不许新增任何 §E / §G 的未验证行）。

## 必须随回执交付的失败证明（这条最重要）

上一轮有人交来一条「循环两个模型」的断言，实际循环变量根本没被用上，等于拿结果跟自己比，
永远绿、什么也没证明。所以本轮要求：**下面每一组新断言，各给一份失败证明**，
做法是临时改坏一处、跑出红、把红的输出逐字贴进回执、然后**把临时改动还原**：

- A. 结构断言组（第 4 条）：例如把 `toolBudget` 的断言改成期望 `minimum === 2`，贴红。
- B. 真实载荷正向组（第 5 条）：例如临时把 validator 载荷的 `toolBudget.hard` 改成 `0` 再 Check，贴红。
- C. 否定用例组（第 6 条）：例如把「缺 hard」那条的期望从 `false` 改成 `true`，贴红。
- D. 内部键断言（第 7 条）：例如临时跳过 `stripDelegationKeys` 再断言，贴红。

回执里必须能看出**改动已还原**（贴 `git diff --stat` 或说明还原后重跑的退出码）。

## 回执格式（发到 `w2E:pD`）

```
round_id=<本轮 round_id>
改动文件：<清单>
四条闸门退出码：typecheck=? test=? test:e2e=? git-diff-check=?
闸门变量下 test:e2e 退出码：?
不带闸门变量的 stdout（逐字）：
<...>
失败证明 A / B / C / D：<各自的命令、红输出逐字、已还原的证据>
slot 前置检查：<audit/status 摘要，含是否发现绕过 slot 的重进程；日志路径>
```

有任何一处你觉得工单写错了、或者做不到，**停下来在回执里说**，不要自己换个说法糊过去。
