# 02: spike —— `planner_delegate` 类型化工具 + pi-subagents 结构化委派 API（零 prompt 解析）

Status: verified
Blocked by: 01
Type: prototype

**What to build：** 一个**独立的** Pi 扩展文件 `spike/planner-delegate.ts`（不加入 `package.json` 的 `pi.extensions`，不被 `index.ts` import），只做一件事：注册工具 `planner_delegate`，把参数按 TypeBox schema 组成 TaskSpec，通过 `pi-subagents/delegation` 的结构化委派 API 启动一个子进程，要求子进程按 WorkerReport 的 JSON schema **结构化返回**，把 launcher 校验过的 WorkerReport 原样放进工具结果的 `details`。

这是 ADR-0001 的可行性验证，不是产品代码：不接 ledger、不接 evidence、不接 review loop、不接 policy guard。

## 接线

- 参考已有写法：`index.ts:975-1009`（`git_audit` 的 `pi.registerTool` + `Type.Object`）。
- API 与事件常量：`~/.pi/agent/npm/node_modules/pi-subagents/src/api/delegation.ts`；用法：`~/.pi/agent/npm/node_modules/pi-subagents/docs/extension-api.md` 第 280 行起「Structured delegation API」。`import { SUBAGENT_DELEGATION_REQUEST_EVENT, SUBAGENT_DELEGATION_RESPONSE_EVENT, SUBAGENT_DELEGATION_CANCEL_EVENT, type SubagentDelegationRequest, type SubagentDelegationResponse } from "pi-subagents/delegation"`。本仓 `node_modules` 没有 `pi-subagents`。**定：`npm i -D pi-subagents@0.67.0`**（与宿主已装版本一致，也是 npm 当前 latest）。理由：spike 是被 `pi -e` 从本仓路径加载的，运行时的 `import "pi-subagents/delegation"` 会从本仓 `node_modules` 解析，绝对路径 import 只能让 tsc 过、不保证 pi 运行时过；devDependency 两边都覆盖。`package-lock.json` 会跟着变，属预期；`peerDependencies` 不加。
- 角色 → agent 名映射沿用 `orchestrate.ts:603-606`：`worker→"worker"`、`explorer→"explorer"`、`validator→"oracle"`。spike 只需支持 `worker` 与 `explorer`。

## 工具参数（TypeBox）

镜像 `types.ts:323` 的 `TaskSpec`，去掉调用期字段（`budget`、`cumulativeBudget`、`contextPack`、`readFirst`、`reportOnly`、`parentTaskId`、`commitOf`、`additionalWorktreeRoots`）。spike 最小集合：

| 字段 | 类型 | 说明 |
|---|---|---|
| `taskId` | `Optional(String({ pattern: "^T-\\d{8}-\\d{3}$" }))` | 缺省时由工具铸一个（`T-YYYYMMDD-` + 3 位随机数即可，spike 不查重） |
| `role` | `Union([Literal("worker"), Literal("explorer")])` | |
| `objective` | `String({ minLength: 1 })` | |
| `cwd` | `Optional(String)` | 默认 `ctx.cwd` |
| `scope` | `Object({ allowedPaths: Optional(Array(String)), forbiddenPaths: Optional(Array(String)) })` | |
| `constraints` | `Array(String)` | |
| `acceptanceCriteria` | `Array(String)` | |
| `validation` | `Object({ required: Boolean, commands: Optional(Array(String)) })` | |
| `instructions` | `Optional(String)` | 给子进程的补充 prose；**只向下透传，永不回读** |

## execute 的步骤

1. 组 `TaskSpec`（`expectedEvidence`、`stopConditions` 给默认值），`taskId` 缺省则铸。
2. 渲染下行 `task` 文本：固定头一行 + `JSON.stringify(spec, null, 2)` + `instructions` + 一段固定说明「完成后按要求的结构化结果返回 WorkerReport，`taskId` 必须等于 `<taskId>`」。这是**单向渲染**，允许；ADR 禁的是反向解析。
3. 构造 `SubagentDelegationRequest`：`requestId = crypto.randomUUID()`，`ownerRunId` 用会话 id（`ctx.sessionManager.getSessionId()`）或一个进程内固定 uuid，`nodeId = taskId`，`agent` 按映射，`context: "fresh"`，`cwd`，`result: { kind: "structured", schema: <WorkerReport JSON schema> }`。
4. WorkerReport schema 用 TypeBox 构造再传 JSON（TypeBox 的 `Type.Object(...)` 本身就是 JSON Schema 对象）。镜像 `types.ts:401`：`version`(integer)、`taskId`(string)、`status`(`completed|partial|blocked|failed`)、`summary`、`changedFiles: string[]`、`validation: Array({ command?, type, status, exitCode?, summary })`、`evidence: { cwd, taskId, workerRunId, baseGitRef?, finalGitRef?, gitStatusHash?, changedPaths? }`、`risks: string[]`、`unresolved: string[]`、`notes?: string[]`；`required` 列全 9 个必填字段，`additionalProperties: false`。
5. 先 `pi.events.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, …)` 按 `(requestId, ownerRunId, nodeId)` 三元组过滤，再 `pi.events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request)`。用 Promise 等终态；`signal.aborted` 时 emit `SUBAGENT_DELEGATION_CANCEL_EVENT`（携带同一三元组）并 reject。
6. 返回：
   - `content`：一行文本 `planner_delegate: <taskId> <status> run=<runId>` + 若有 `result.value` 则附 `summary`。
   - `details`：`{ taskId, requestId, runId, status, error, agent, model, usage, report: result?.kind === "structured" ? result.value : undefined, launchContractDigest }`。
   - `isError`：`status !== "completed"`。
7. **不做任何**：`JSON.parse`、正则、字符串包含判断去读子进程输出；不 import `task.ts` / `report.ts` / `orchestrate.ts` / `roles.ts`；`types.ts` 只允许 `import type`。

## 本地验收（宿主运行是票 03）

```sh
# 1. spike 文件被 tsconfig 的 include: ["*.ts"] 漏掉，单独编一次
npx tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext \
  --target ES2022 --skipLibCheck --allowImportingTsExtensions --verbatimModuleSyntax \
  --types node spike/planner-delegate.ts              # 期望：exit 0

# 2. 零反向解析、零旧模块依赖
grep -nE 'JSON\.parse|matchAll|\.match\(|RegExp|new RegExp|\.includes\(|\.indexOf\(' spike/planner-delegate.ts
                                                        # 期望：无输出
grep -nE 'from "\./(task|report|orchestrate|roles)\.ts"|from "\.\./(task|report|orchestrate|roles)\.ts"' spike/planner-delegate.ts
                                                        # 期望：无输出
grep -nE 'from "\.\./types\.ts"' spike/planner-delegate.ts
                                                        # 期望：若有，只能是 import type

# 3. 主套件不受影响（spike 不在 package.json 里）
git diff --stat -- package.json index.ts orchestrate.ts task.ts report.ts   # 期望：空（devDependency 例外，见上）
npm run typecheck && npm test                            # 期望：exit 0
```

**交回：** `spike/planner-delegate.ts` 全文、上面 3 组命令的原样输出、一句话说明 `pi-subagents` 的 import 方式。若第 1 步因 `pi-subagents/delegation` 的类型解析失败，贴完整报错，不要用 `any` 绕。

## Comments

**2026-09-15 执行（Devin，执行方）。** 产物：`spike/planner-delegate.ts`（独立扩展，`export default function plannerDelegateSpike(pi)`，注册工具 `planner_delegate`）；`package.json` devDependencies 增加 `pi-subagents ^0.67.0`；`package-lock.json` 变动（预期）。**第 1 步落在票预告的失败分支：`pi-subagents/delegation` 的类型解析失败**，未用 `any` 绕，完整报错见 `.scratch/typed-delegation/02-tsc-output.log`（288 行，exit 2）。

验收命令原样结果：

```sh
# 1.
npx tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext \
  --target ES2022 --skipLibCheck --allowImportingTsExtensions --verbatimModuleSyntax \
  --types node spike/planner-delegate.ts
# → exit 2；246 个 error TS，全部位于 node_modules/pi-subagents/**/*.ts，
#   spike/planner-delegate.ts 自身 0 错误。错误分类：
#     TS2353 ×203  'isError' 不在 AgentToolResult<Details> 上（对象字面量）
#     TS2339 ×15   .isError 属性访问不存在于 AgentToolResult
#     TS7006 ×10   pi-subagents 源码内 implicit any 参数
#     TS2550 ×7    findLast/findLastIndex 需要 ES2023 lib（命令锁定 ES2022）
#     TS2322 ×6    两份 pi-agent-core 的 AgentMessage 不兼容
#                  （根 0.85.1 经 pi-server vs pi-coding-agent 嵌套 0.84.4，
#                   BranchSummaryMessage.fromId: string|null vs string）
#     TS2307 ×5    Cannot find module '@earendil-works/pi-tui'
#                  （optional peer，只在 pi-coding-agent 嵌套 node_modules 下）
#   完整输出：02-tsc-output.log

# 2.
grep -nE 'JSON\.parse|matchAll|\.match\(|RegExp|new RegExp|\.includes\(|\.indexOf\(' spike/planner-delegate.ts
# → 无输出
grep -nE 'from "\./(task|report|orchestrate|roles)\.ts"|from "\.\./(task|report|orchestrate|roles)\.ts"' spike/planner-delegate.ts
# → 无输出
grep -nE 'from "\.\./types\.ts"' spike/planner-delegate.ts
# → 26:import type { TaskSpec, WorkerReport } from "../types.ts";   （仅 import type）

# 3.
git diff --stat -- package.json index.ts orchestrate.ts task.ts report.ts
# →  package.json | 1 +    （仅 devDependency 一行；其余四个文件 0 改动）
npm run typecheck && npm test
# → exit 0；typecheck 干净，35 个测试文件全部 PASS（日志 02-npm-test.log）
```

**import 方式一句话：** `import { SUBAGENT_DELEGATION_*_EVENT, type SubagentDelegationRequest, type SubagentDelegationResponse, type SubagentDelegationCancel, type SubagentDelegationJsonSchemaObject } from "pi-subagents/delegation"`，按票面定的 `npm i -D pi-subagents@0.67.0` devDependency 解析——事件常量是运行时值，必须真包在场。

**第 1 步失败的结构原因（给审核方的判读材料）：** `pi-subagents` 的 exports 把 `./delegation` 映射到裸 `.ts` 源码（`./src/api/delegation.ts`），NodeNext 解析时把 `delegation.ts → src/shared/types.ts →` 约 26 个传递源码文件全部拉进编译；这批源码只在 pi-subagents 私有 dev 环境下编译——ES2023 lib、`AgentToolResult.isError` 存在于其测试 shim（`@earendil-works/pi-coding-agent: file:./test/fixtures/pi-coding-agent-shim`，真实发布的 0.84.4/0.85.1 `AgentToolResult` 均无 `isError`）、pi-tui 在场。任何 `pi-subagents/delegation` 的 import（含 `import type`）都会拉入同一图源，无更窄的 canonical specifier；tsc 对 node_modules 内被 import 的 `.ts` 文件照常做语义检查，`skipLibCheck` 只豁免 `.d.ts`。spike 用到的 API 面本身（事件常量、Request/Response/Cancel 类型、TypeBox schema → `SubagentDelegationJsonSchemaObject`）类型解析是成功的——失败的是整包源码在本仓 flags 下的语义检查，不是 delegation 契约形状。对票 03 的含义：pi 运行时经 jiti 加载 `.ts` 不做 typecheck，宿主路径不受此失败影响；但「消费方独立 tsc 能过」这一 ADR 隐含前提被否证，可能需要 pi-subagents 侧提供 `.d.ts` 出口或消费方另行声明模块类型。

**2026-09-16 审核（Devin）：第 2/3 步 verified；第 1 步的失败判读成立，并追加一个新事实；spike 代码一处小修。Status 回到 ready-for-human 做一次修订，修订范围如下。**

复核：三条 grep 与 `git diff --stat` 与执行方交回一致；我本机重跑第 1 步 tsc 得 246 个 error，全部在 `node_modules/pi-subagents/src/**`，`spike/` 0 错——与交回一致。执行方对结构原因的判读（exports 指向裸 `.ts`，图源整体进入 program，`skipLibCheck` 不豁免）正确。

**新事实（审核方探针，决定了修法）：** Node 的 `--experimental-strip-types` 拒绝剥离 `node_modules` 下的 `.ts`：

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently unsupported
for files under node_modules, for "file:///…/node_modules/pi-subagents/src/api/delegation.ts"
```

本仓的测试跑法是 `node --experimental-strip-types *.test.mjs`，所以**任何**从 `pi-subagents/*` 导入运行时值的模块，在本仓测试进程里根本加载不起来——这不只否掉 spike 的 import，也提前否掉轮 3 生产代码走同一 import 的路。pi 宿主用 jiti 加载不受影响，但「测试与宿主走同一路径」正是 ADR-0001 要修的病，不能再制造一处分叉。

另试过 tsconfig `paths` 把 `pi-subagents/delegation` 映射到本地 `.d.ts`：tsc 通过、program 里 0 个 pi-subagents 文件，但它只解决 tsc，不解决上面的运行时加载；故不采用。

**定（修订范围，只改 spike 与 package.json）：**

1. 新建 `spike/subagent-delegation-contract.ts`：文件头注明「抄自 `pi-subagents@0.67.0` `src/api/delegation.ts`，事件名是其文档称的 established 跨扩展传输契约」；内容只放 spike 用到的部分——5 个 `SUBAGENT_DELEGATION_*_EVENT` 字符串常量（值逐字：`prompt-template:subagent:request|started|update|response|cancel`）、`SubagentDelegationRequest`、`SubagentDelegationResponse`（含 `SubagentDelegationTerminalResponse` / `SubagentDelegationInvalidResponse` / `SubagentDelegationStatus` / `SubagentDelegationValue` / `SubagentDelegationUsage`）、`SubagentDelegationCancel`、`SubagentDelegationJsonSchemaObject`。不抄 `IntercomBridgeConfig`，`intercomBridge` 字段声明为 `unknown` 或直接省略。
2. `spike/planner-delegate.ts` 的 import 改指 `./subagent-delegation-contract.ts`；其余不动。
3. 回退 `package.json` / `package-lock.json` 的 `pi-subagents` devDependency（`git checkout -- package.json package-lock.json` 后 `npm i` 校验 lock 不再变）。不再需要真包在本仓 node_modules。
4. `waitForDelegation` 小修：`signal?.aborted` 的提前返回目前发生在 `pi.events.on(...)` **之后**，该分支没有调 `cleanup()`，会泄漏一个 response 监听器。把 aborted 检查挪到订阅之前（或在该分支里调 `cleanup()`）。
5. 审核方已验：本仓 typebox 生成的 schema 对象无 symbol 键、`JSON.stringify` 与原对象等价，`WORKER_REPORT_SCHEMA` 的展开写法不需要再 `structuredClone`；不改。

**修订后的验收（替换原第 1 步与第 3 步的 diff 断言）：**

```sh
# 1a. spike 独立 tsc 通过，且 program 里没有任何 pi-subagents 文件
npx tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext \
  --target ES2022 --skipLibCheck --allowImportingTsExtensions --verbatimModuleSyntax \
  --types node --listFiles spike/planner-delegate.ts | grep -c pi-subagents   # 期望：0，且 tsc exit 0
# 1b. spike 能在本仓测试进程的加载器下 import（这正是原 import 会炸的地方）
node --experimental-strip-types -e 'import("./spike/planner-delegate.ts").then(m=>console.log(typeof m.default))'
                                                                             # 期望：function
# 1c. 抄来的事件名与真包逐字一致（真包在 ~/.pi/agent/npm/node_modules）
diff <(grep -o '"prompt-template:subagent:[a-z]*"' ~/.pi/agent/npm/node_modules/pi-subagents/src/api/delegation.ts | sort) \
     <(grep -o '"prompt-template:subagent:[a-z]*"' spike/subagent-delegation-contract.ts | sort)   # 期望：无输出
# 2. 原三条 grep 不变（对 spike/ 下两个文件都跑）
# 3. package.json / lock 回到 HEAD
git diff --stat -- package.json package-lock.json index.ts orchestrate.ts task.ts report.ts   # 期望：空
npm run typecheck && npm test                                                                  # 期望：exit 0
```

**交回：** 1a/1b/1c/2/3 原样输出 + `spike/subagent-delegation-contract.ts` 全文。

**2026-09-16 修订执行（Devin，执行方）。** 新增 `spike/subagent-delegation-contract.ts`（抄自 `pi-subagents@0.67.0` `src/api/delegation.ts`：5 个事件名常量逐字 + Request/Response/Cancel/Usage/JsonSchemaObject 等类型；`IntercomBridgeConfig` 不抄，`intercomBridge` 字段声明为 `unknown`；另省略 spike 与票面清单均未用的 `SubagentDelegationUpdate`）。`spike/planner-delegate.ts` 的 import 改指 `./subagent-delegation-contract.ts`；`waitForDelegation` 的 `signal?.aborted` 提前返回挪到 `pi.events.on(...)` 订阅之前（原顺序在该分支泄漏一个 response 监听器），其余不动。`git checkout -- package.json package-lock.json` + `npm i` 回退 devDependency（removed 104 packages，`node_modules/pi-subagents` 已不在）。

验收原样结果：

```sh
# 1a.
npx tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext \
  --target ES2022 --skipLibCheck --allowImportingTsExtensions --verbatimModuleSyntax \
  --types node --listFiles spike/planner-delegate.ts | grep -c pi-subagents
# → 0，且 tsc exit 0（program 1252 个文件：本仓 *.ts + pi-coding-agent .d.ts
#   + typebox + node types，完整清单 02-tsc-listfiles.txt）

# 1b.
node --experimental-strip-types -e 'import("./spike/planner-delegate.ts").then(m=>console.log(typeof m.default))'
# → function

# 1c.
diff <(grep -o '"prompt-template:subagent:[a-z]*"' ~/.pi/agent/npm/node_modules/pi-subagents/src/api/delegation.ts | sort) \
     <(grep -o '"prompt-template:subagent:[a-z]*"' spike/subagent-delegation-contract.ts | sort)
# → 无输出（exit 0，5 个事件名逐字一致）

# 2. 三条 grep（对 spike/ 下两个文件都跑）
grep -nE 'JSON\.parse|matchAll|\.match\(|RegExp|new RegExp|\.includes\(|\.indexOf\(' spike/planner-delegate.ts spike/subagent-delegation-contract.ts
# → 无输出
grep -nE 'from "\./(task|report|orchestrate|roles)\.ts"|from "\.\./(task|report|orchestrate|roles)\.ts"' spike/planner-delegate.ts spike/subagent-delegation-contract.ts
# → 无输出
grep -nE 'from "\.\./types\.ts"' spike/planner-delegate.ts spike/subagent-delegation-contract.ts
# → spike/planner-delegate.ts:26:import type { TaskSpec, WorkerReport } from "../types.ts";   （仅 import type）

# 3.
git diff --stat -- package.json package-lock.json index.ts orchestrate.ts task.ts report.ts
# → 无输出（六个文件全部回到 HEAD）
npm run typecheck && npm test
# → exit 0；typecheck 干净，35 个测试文件全部 PASS（日志 02-npm-test-r2.log）
```

**2026-09-16 审核（Devin）：verified。** 5 条验收本机独立重跑全部一致：1a tsc exit 0 且 program 内 pi-subagents 文件 0；1b `typeof m.default === "function"`；1c 事件名 diff 无输出；2 三条 grep 干净，spike 两文件的 import 只有 node 内建、typebox、pi-coding-agent 类型、本地契约、`../types.ts` 的 `import type`；3 package.json / lock / 四个源文件零 diff，`node_modules` 无 pi-subagents，`npm test` 35 文件 PASS。代码复核：aborted 提前返回已在 `pi.events.on` 之前，泄漏消除；`intercomBridge?: unknown` 可接受。**省略 `SubagentDelegationUpdate` 批准**——票 03 若要订阅进度事件再补，不在本票范围。

**2026-09-16 票 03 回流 → 修订 r2（Devin）。Status 回到 ready-for-human。**

审核方认错：上一轮我写「schema 展开无 symbol 键、不需要 structuredClone」——我的探针只查了 `getOwnPropertySymbols`，没查**非枚举的字符串键**。复现（`Reflect.ownKeys` + descriptor）：`{...Type.Object(...)}` 只浅化顶层，嵌套的 `properties.a.~kind`、`properties.b.~kind` / `~optional` 都还在；`structuredClone` 之后只剩 `required.length`（数组固有，launcher 校验器显式跳过），`JSON.stringify` 前后逐字相等。执行方在票 03 的根因判读正确。

**r2 修订范围（只改 `spike/planner-delegate.ts`）：**

1. `WORKER_REPORT_SCHEMA` 改为 `structuredClone(Type.Object(...))`，去掉展开写法；注释改为说明 typebox 子对象带非枚举 `~kind` 键、launcher 要求 plain JSON。
2. **`isError` 是死字段**（票 03 附带发现，审核方已在 `pi-agent-core` `agent-loop.js:455-478` 确认：`isError` 只在 `execute` **抛异常**时为 true，返回值里的 `isError` 被丢弃；`AgentToolResult` 类型里根本没有这个字段）。spike 改为：`response.status !== "completed"` 时 `throw new Error(\`planner_delegate ${taskId} ${status}: ${error ?? "no error text"} (run=${runId ?? "none"})\`)`；`completed` 时照旧返回 `content + details`（含 `report`）。去掉返回对象里的 `isError`。
   - 轮 3 须知（先记在这里）：本仓 `index.ts` 现有 4 个工具共 16 处 `isError: true` 全是死代码，宿主实际把它们当成功结果持久化。这是独立工单，不在 spike 范围。
3. `PARAMETERS` 不动；`waitForDelegation` 不动。

**r2 验收：** 原 1a/1b/2/3 五条不变，追加

```sh
# 1d. schema 是 plain JSON：深度遍历无非枚举键（数组 length 除外）
node --experimental-strip-types -e '
import("./spike/planner-delegate.ts").then(async () => {
  const { Type } = await import("typebox");
  // 与 spike 同构造方式的最小样本；真 schema 不导出，此处只验构造方式
  const s = structuredClone(Type.Object({ a: Type.String(), b: Type.Optional(Type.Integer()) }, { additionalProperties: false }));
  const bad = []; const walk = (o, p) => { if (o && typeof o === "object") for (const k of Reflect.ownKeys(o)) { const d = Object.getOwnPropertyDescriptor(o, k); if (!d.enumerable && !(Array.isArray(o) && k === "length")) bad.push(p + "." + String(k)); walk(o[k], p + "." + String(k)); } };
  walk(s, "s"); console.log(bad.length === 0 ? "plain" : bad.join(","));
})'                                                      # 期望：plain
grep -n "isError" spike/planner-delegate.ts             # 期望：无输出
grep -n "structuredClone(Type.Object" spike/planner-delegate.ts   # 期望：1 行
```

修完直接进票 03 重跑（票 03 已按 r2 的 throw 语义改了检查 2 的判定口径）。

**2026-09-16 r2 执行（Devin，执行方）。** 改动只有 `spike/planner-delegate.ts` 两处：① `WORKER_REPORT_SCHEMA = structuredClone(Type.Object(...)) as unknown as SubagentDelegationJsonSchemaObject`（去掉展开写法；`TObject`→`Record` 直接赋值与单层 `as` 分别报 TS2322/TS2352，`as unknown as` 是唯一能过 tsc 且不用 `any` 的桥接——它断言的只是 clone 已保证的 plain-data 事实，注释里写明了）；② 非 `completed` 时 `throw new Error(\`planner_delegate ${taskId} ${status}: ${error ?? "no error text"} (run=${runId ?? "none"})\`)`，completed 照旧返回 `content + details`（含 `report`），返回对象里的 `isError` 已删。`PARAMETERS` / `waitForDelegation` 未动；注释避开了 `isError` 字面量（验收 grep 会抓）。

r2 验收原样结果：

```sh
# 1a. tsc --listFiles | grep -c pi-subagents
→ 0，tsc exit 0
# 1b.
node --experimental-strip-types -e 'import("./spike/planner-delegate.ts").then(m=>console.log(typeof m.default))'
→ function
# 1c. 事件名 diff vs pi-subagents@0.67.0
→ 无输出
# 1d. plain-JSON 深度遍历（构造方式样本）
→ plain
# 新 grep
grep -n "isError" spike/planner-delegate.ts                     → 无输出
grep -n "structuredClone(Type.Object" spike/planner-delegate.ts → 81:const WORKER_REPORT_SCHEMA = structuredClone(Type.Object(   （1 行）
# 2. 三条 grep（两文件）
→ 反向解析无输出；旧模块无输出；../types.ts 仅 import type
# 3.
git diff --stat -- package.json package-lock.json index.ts orchestrate.ts task.ts report.ts → 无输出
npm run typecheck && npm test → exit 0（35 文件全 PASS，日志 02-npm-test-r3.log）
```

可以进票 03 重跑。

**2026-09-16 审核（Devin）r2：verified。** 本机重跑 1a（exit 0，pi-subagents 0）、1b（function）、`isError` grep 无、`structuredClone(Type.Object` 1 处（81 行）、反向解析 grep 无、六文件 diffstat 空，全部一致；另用 stub `pi` 加载模块确认只注册 `planner_delegate` 一个工具。`as unknown as SubagentDelegationJsonSchemaObject` 接受：它桥接的是 TObject 到 Record 的名义类型差，且已被 1d 的运行时事实覆盖，注释说明到位。放行票 03 重跑。
