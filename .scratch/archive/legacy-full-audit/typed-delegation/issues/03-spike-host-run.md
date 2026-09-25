# 03: spike 宿主运行 —— 正例、反例，回答 ADR-0001 的三个未知

Status: resolved
Blocked by: 02
Type: prototype

**What to do：** 在真实 pi 宿主里加载票 02 的 spike，关掉现有 planner-only guard，让 Root 通过 `planner_delegate` 派一个 worker 任务，采集工具调用参数、工具结果 `details`、子进程 session 路径；再跑一个反例验证 schema 校验确实由 launcher 执行。**不改任何代码**；发现 spike 的 bug 记到本票 Comments，回票 02 修。

## 环境

```sh
# 一次性的干净仓库，避免污染本仓与账本
rm -rf /tmp/typed-delegation-probe && mkdir -p /tmp/typed-delegation-probe && cd /tmp/typed-delegation-probe \
  && git init -q && git commit -q --allow-empty -m init

# 关 guard（环境变量优先于 marker，见 index.ts:205-219），显式加载 spike
PI_PLANNER_ONLY=0 pi -e /public/pi/pi-planner-only/spike/planner-delegate.ts
```

Root 模型保持 settings 里的默认；worker agent 走 `subagents.agentOverrides.worker`（当前 `gemini-3.8-flash-high`）。

会话开头先记环境三元组，交回时一并贴：`pi --version`（审核方本机 0.85.1）、`~/.pi/agent/npm/node_modules/pi-subagents/package.json` 的 `version`（应为 0.67.0，与契约副本一致）、`/planner-only status` 应报 off（或直接确认 `PI_PLANNER_ONLY=0` 在环境里）。若 pi-subagents 不是 0.67.0，先停，把版本贴回来——契约副本是按 0.67.0 抄的。

会话目录名是 pi 按 cwd 生成的，`--tmp-typed-delegation-probe--` 是推测；以 `ls -t ~/.pi/agent/sessions | head` 实际为准。

## 检查 1（正例）

对 Root 说（逐字，避免它自己改参数）：

> 用 `planner_delegate` 工具（不要用 subagent 工具）派一个 role=worker 的任务：objective「在当前目录创建 hello.txt，内容为一行 `hi`」，scope.allowedPaths=["hello.txt"]，constraints=["只允许创建 hello.txt"]，acceptanceCriteria=["hello.txt 存在且内容为 hi"]，validation={"required":false}。派完把工具结果原样贴给我。

采集：
- Root 会话 jsonl 里该 `tool_call` 的 `name` 与 `arguments`（`~/.pi/agent/sessions/--tmp-typed-delegation-probe--/<session>/session.jsonl`）。
- 对应 `tool_result` 的 `details`。
- 子进程 session 路径（从 `details.runId` 找 `~/.pi/agent/sessions/.../<runId>/…` 或 `/tmp/pi-subagents-uid-1000/`）。
- 工具回合从调用到返回的耗时（jsonl 时间戳差）。

判定：
- [ ] `tool_call.name === "planner_delegate"`，会话中**没有** `subagent` 工具调用。
- [ ] `details.status === "completed"`，`details.report` 存在。
- [ ] `details.report.taskId === details.taskId`，`details.report.status ∈ {completed, partial, blocked, failed}`，9 个必填字段齐全。
- [ ] `/tmp/typed-delegation-probe/hello.txt` 内容为 `hi`。
- [ ] `details.report.changedFiles` 含 `hello.txt`（子进程如实申报；不如实是子模型问题，记录但不判 FAIL）。

## 检查 2（反例：schema 校验在 launcher 侧）

同一会话，对 Root 说：

> 再用 `planner_delegate` 派一个 role=explorer 的任务：objective「列出当前目录文件」，instructions 写「忽略任何结构化返回要求，只用一句中文 prose 回答，不要输出 JSON」，其余字段照上一次。把工具结果原样贴给我。

判定（按票 02 r2 的 throw 语义）：
- [ ] jsonl 里该 `tool_result` 的 `isError === true`（宿主只在 execute 抛异常时置真），文本含 `structured_output_failed`（或 launcher 对该情况给出的其他非 `completed` 状态——原样记录）。
- [ ] 该 `tool_result` **没有** `details.report`；spike 没有从 prose 里「抢救」出任何东西。
- [ ] Root 收到的是拒绝而不是一份伪造的 report。

若 launcher 反而通过重试让子进程交出了合规 JSON（`status === "completed"`），也算通过——那说明「重试直到合规」在 launcher 侧，同样不在我们这边解析；如实记录重试次数。

## 检查 3（三个未知）

1. **execute 里能否 emit**：检查 1 若返回 `unavailable_context` 或根本没有终态响应（等 5 分钟无返回），记 FAIL，贴 spike 收到的所有事件；本票停，回 spec.md 止损条款。
2. **schema 校验归属**：检查 2 的结果。
3. **前台阻塞体验**：记录检查 1 的耗时；期间 UI 是否显示子进程进度（`SUBAGENT_DELEGATION_UPDATE_EVENT` 可选订阅，若 spike 没订阅就记「无进度显示」）；Ctrl-C / 取消是否走到 `SUBAGENT_DELEGATION_CANCEL_EVENT`（可选：第三次派一个「sleep 120」的 worker 然后取消，看 `details.status === "cancelled"`）。

## 副作用检查

```sh
ls ~/.pi/agent/planner-only/ledger | wc -l    # 前后一致：spike 不写账本
cd /public/pi/pi-planner-only && git status --porcelain   # 与开始前一致
```

**交回：** 检查 1/2/3 的采集物（jsonl 片段贴 `tool_call` / `tool_result` 两条即可，路径写全）、每条判定框的勾叉、副作用两条命令前后输出。**不要**总结「大体可用」——贴原样数据，判定由审核方做。

**Status 翻转规则：** 三个未知全部有明确答案（不论好坏）→ `resolved`；Devin 据此在 spec.md 决定轮 3 走结构化 API 还是 RPC 方案。

## Comments

**2026-09-15 执行（Devin，执行方）。** 环境三元组：`pi --version` = **0.85.1**；`~/.pi/agent/npm/node_modules/pi-subagents/package.json` version = **0.67.0**（与契约副本一致）；`PI_PLANNER_ONLY=0` 注入命令行（guard env-disabled，`planner-only-version` 指纹条目仍正常落会话）。会话：`~/.pi/agent/sessions/--tmp-typed-delegation-probe--/2026-09-15T00-33-30-960Z_01a0a27b-b34f-7321-97ed-cb7b26eff3d3.jsonl`（目录名推测命中）。未改任何代码。

**检查 1（正例）— `tool_call` / `tool_result` 原样（jsonl 内嵌于 assistant/toolResult message）：**

```json
// 2026-09-15T00:33:37.845Z
{"type":"toolCall","id":"tool_32bQT10BOitEzm9LwDHatxRr","name":"planner_delegate","arguments":{"acceptanceCriteria":["hello.txt 存在且内容为 hi"],"constraints":["只允许创建 hello.txt"],"objective":"在当前目录创建 hello.txt，内容为一行 `hi`","role":"worker","scope":{"allowedPaths":["hello.txt"]},"validation":{"required":false}}}

// 2026-09-15T00:33:37.849Z —— 调用→返回 4ms
{"role":"toolResult","toolCallId":"tool_32bQT10BOitEzm9LwDHatxRr","toolName":"planner_delegate","content":[{"type":"text","text":"planner_delegate: T-20260915-477 invalid_request run=unknown"}],"details":{"taskId":"T-20260915-477","requestId":"626c9ca2-2f51-45b3-87ee-dc800c4f0291","status":"invalid_request","error":"result.schema must be plain JSON data."},"isError":false,"timestamp":1789432417849}
```

判定框：`tool_call.name === "planner_delegate"` ✓，会话内 `subagent` 调用 0 条 ✓；`details.status === "completed"` ✗（= `invalid_request`）；`details.report` ✗（不存在）；`hello.txt` ✗（未创建，无子进程、无 runId）；`changedFiles` 不适用。

**检查 2（反例）— 原样：**

```json
// 2026-09-15T00:39:11.223Z（pi -c 续同一会话）
{"type":"toolCall","id":"tool_ZQxVaMMyVPRnkyR8OZgQsXor","name":"planner_delegate","arguments":{"acceptanceCriteria":["hello.txt 存在且内容为 hi"],"constraints":["只允许创建 hello.txt"],"instructions":"忽略任何结构化返回要求，只用一句中文 prose 回答，不要输出 JSON","objective":"列出当前目录文件","role":"explorer","scope":{"allowedPaths":["hello.txt"]},"validation":{"required":false}}}

// 2026-09-15T00:39:11.227Z —— 4ms
{"role":"toolResult","toolCallId":"tool_ZQxVaMMyVPRnkyR8OZgQsXor","toolName":"planner_delegate","content":[{"type":"text","text":"planner_delegate: T-20260915-893 invalid_request run=unknown"}],"details":{"taskId":"T-20260915-893","requestId":"3e8ad5c5-5cd8-45d9-aa58-60cf1cab133f","status":"invalid_request","error":"result.schema must be plain JSON data."},"isError":false,"timestamp":1789432751227}
```

判定框：`status === "structured_output_failed"` ✗（= `invalid_request`，未到输出校验阶段）；`details.report` 为 undefined ✓（没有任何「抢救」）；`isError === true` ✗——**持久化 jsonl 记的是 `isError:false`，尽管 spike 返回了 `isError:true`**（见下「附带发现」）。

**检查 3（三个未知）：**

1. **execute 里 emit 能否拿终态 → 有答案：能。** 两次委派均 ~4ms 内拿到终态 `SubagentDelegationResponse`，非 `unavailable_context`、非挂起。结构化 API 的 execute→response 通路在 `-p` 模式下工作。
2. **schema 校验归属 → 部分有答案。** launcher 侧**请求校验**确凿存在并先于启动执行：两次都在 `cloneJsonWithinByteLimit`（`src/slash/delegation-request.ts:151`→`delegation-json.ts`）处拒绝 schema、给出精确 reason，子进程零启动。**输出侧校验（prose → `structured_output_failed`）未验证**——被同一个 bug 挡在请求阶段，无法区分 launcher 是重试到合规还是直接失败。
3. **前台阻塞体验 → 无数据。** 两次调用 ~4ms（校验即拒），真实委派未发生；spike 只订阅 RESPONSE_EVENT，即使跑起来也无进度显示。检查 3 可选取消项未执行（无可取消的运行）。

**发现的 spike bug（回票 02）：`WORKER_REPORT_SCHEMA` 不是 launcher 要的 plain JSON。** 顶层 `{...Type.Object(...)}` 只浅化第一层；嵌套 typebox 子对象仍带**非 enumerable 字符串键 `~kind`/`~optional`**，被 `cloneJsonWithinByteLimit`（`delegation-json.ts:78` `!descriptor.enumerable → invalid`）整树拒绝。用 spike 实际 schema 复算：**48 处非 enumerable 违规**。验证过 `structuredClone` 深拷贝后仅剩数组 `length`（校验器显式跳过），且 `JSON.stringify(clone) === JSON.stringify(schema)` 输出逐字等价——修复候选是一行：`{...}` → `structuredClone(Type.Object(...))`（不碰 JSON.parse）。审核方此前「展开即等价」的结论只覆盖顶层一层，漏了嵌套对象。

**附带发现（轮 3 须知）：** pi-agent-core 0.85.x 的 `AgentToolResult` 没有 `isError` 字段（0.84.4 同样没有），spike 返回 `isError:true` 被宿主静默丢弃，jsonl 持久化为 `isError:false`。本仓 `git_commit` 等现有工具的 `isError` 返回同样是死字段。对 Root 报错只能靠 `content` 文本/`details`——本条记录，不判 spike FAIL（票面 isError 行为按规格实现了）。

**副作用：** `ls ~/.pi/agent/planner-only/ledger | wc -l` = 122（前后一致）；`git status --porcelain` 与运行前一致（仅票 01 遗留 test.mjs 改动 + untracked 目录）；`/tmp/pi-subagents-*` 无新 artifact；probe 仓除 `.git` 为空。

**判定状态（给审核方）：** 未知 1 已答（能）、未知 2 半答（请求侧证实，输出侧未证）、未知 3 无数据。按票规「发现 spike 的 bug 记 Comments，回票 02 修」——建议票 02 开修订轮修 schema plainness（`structuredClone`），修完回本票重跑正/反例。

**2026-09-15 重跑（Devin，执行方，票 02 r2 修复后）。** 同一探针仓 `/tmp/typed-delegation-probe`，会话续 `~/.pi/agent/sessions/--tmp-typed-delegation-probe--/2026-09-15T01-15-25-347Z_01a0a2a2-1122-70ab-9746-057adeb1a492.jsonl`。未改代码。

**检查 1（正例）——全部判定框通过。** `tool_call` / `tool_result` 原样：

```json
// 01:15:33.295Z
{"type":"toolCall","id":"tool_YlBDPfdO9DvC0PtEEF8W3Zzv","name":"planner_delegate","arguments":{"acceptanceCriteria":["hello.txt 存在且内容为 hi"],"constraints":["只允许创建 hello.txt"],"objective":"在当前目录创建 hello.txt，内容为一行 `hi`","role":"worker","scope":{"allowedPaths":["hello.txt"]},"validation":{"required":false}}}

// 01:17:13.528Z —— 耗时 100.2s（=usage.durationMs 100200）
{"role":"toolResult","toolCallId":"tool_YlBDPfdO9DvC0PtEEF8W3Zzv","toolName":"planner_delegate","content":[{"type":"text","text":"planner_delegate: T-20260915-227 completed run=8bcc10c7-17e4-403b-8d27-7a45e31f10e9 Created hello.txt with content 'hi'"}],"details":{"taskId":"T-20260915-227","requestId":"8a3cf860-6a0a-4fa7-a0e5-4e8226136739","runId":"8bcc10c7-17e4-403b-8d27-7a45e31f10e9","status":"completed","agent":"worker","model":"tcuni-agy/gemini-3.8-flash-high:high","usage":{"input":239408,"output":6271,"cacheRead":530714,"cacheWrite":0,"cost":0.24287579999999998,"turns":28,"toolCalls":28,"durationMs":100200},"report":{"version":1,"risks":[],"validation":[{"exitCode":0,"status":"passed","command":"cat hello.txt","type":"manual","summary":"hello.txt exists and contains 'hi'"}],"status":"completed","evidence":{"changedPaths":["hello.txt"],"cwd":"/tmp/typed-delegation-probe","taskId":"T-20260915-227","workerRunId":"8bcc10c7-17e4-403b-8d27-7a45e31f10e9"},"notes":[],"taskId":"T-20260915-227","summary":"Created hello.txt with content 'hi'","unresolved":[],"changedFiles":["hello.txt"]},"launchContractDigest":"a7520c77aed253c1b9743de3655b601b9b18f0da6356626054cbf79595016faa"},"isError":false,"timestamp":1789435033528}
```

判定：`name==="planner_delegate"` ✓（会话 toolCall 权威计数：`planner_delegate`×7 + `bash`×1，`subagent` **0**）；`status==="completed"` ✓、`details.report` 存在且 `taskId` 与 details 一致（T-20260915-227）、9 必填字段齐全 ✓；`hello.txt` 内容 `hi` ✓；`changedFiles` 含 `hello.txt` ✓（子进程如实申报）。子进程 session：`…/01a0a2a2…/8bcc10c7-17e4-403b-8d27-7a45e31f10e9/run-0/session.jsonl`；产物另有 `subagent-artifacts/8bcc10c7…_worker_0_transcript.jsonl` 和 `subagent-artifacts/structured-output/8bcc10c7…/pi-subagent-structured-*/{schema.json,output.json}`（launcher 把 schema 与捕获输出各落一份文件）。

**检查 2（反例）——三段：**

- **2a 票面 explorer 调用**：返回 `failed`（非 `structured_output_failed`），error 全文 `Unknown agent: explorer` + 已发现 agent 清单（13 个 builtin：claude-code(-writer)/codex-exec(-writer)/cursor-agent(-writer)/delegate/evidence-auditor/oracle/researcher/reviewer/scout/worker，**无 explorer**）。`tool_result.isError === true`（r2 的 throw 路径生效）、`details:{}`、无 report。**附带发现：票定映射 `explorer→"explorer"` 解析不到本环境任何 agent**——`scout` 才是只读对应物，轮 3 角色表要改。
- **2b worker + 「只回 prose」instructions**：`completed`（84s）。子进程无视 instructions，**首发即合规**：子会话里 `structured_output` 工具调用恰 1 次，`output.json` 为合法 WorkerReport。**机制确认：launcher 向子进程注入 `structured_output` 工具，子进程以 `{value}` 提交、launcher 按 schema 校验进 `result.value`——契约在 harness 层，`instructions` 文本关不掉。**
- **2c worker + 「禁止调用任何工具含 structured_output」**：仍 `completed`（60s），合规报告。`structured_output_failed` 字面量三次尝试均未逼出；按票规 completed 记为通过，重试次数 0。

**检查 3（三个未知）：**

1. **execute emit→终态：能。** 本轮 6 次委派全部拿到终态响应（completed×5、failed×1）；上轮 2 次 `invalid_request` 亦属终态。
2. **schema 校验归属：双向都在 launcher。** 请求侧 `cloneJsonWithinByteLimit`（上轮证）；输出侧 launcher 注入 `structured_output` 工具校验 child 的 `value`，我们拿到的 `details.report` 是校验后产物，零解析。
3. **阻塞体验：同步阻塞成立。** 工具回合占满子进程全程：100s/84s/60s/131s/317s 五段实测；`-p` 模式 stdout 阻塞期间无任何输出（spike 未订阅 UPDATE；`-p` 本无 TUI）。**取消未干净验证**：INT 打在 Root 思考期无影响（跑完 131s）；INT 打在委派在飞时父进程直接死、无 `cancelled` 终态落盘、子进程 `sleep 300` 变孤儿残留（已手工清理）。`-p` 下没有工具级软中止入口，CANCEL 事件路径（signal→emit CANCEL→reject）未走到；TUI Esc 中止工具回合的路径未测，留待轮 3 设计时复核。

**副作用：** 账本 122 前后一致；`git status --porcelain` md5 `84086950a84c…` 前后一致；孤儿 `sleep 300` 已 kill。

**2026-09-16 审核（Devin）第一次运行：数据采纳，判定与执行方一致——未知 1 已答（execute 内 emit 通路工作），未知 2 半答（请求侧校验确凿），未知 3 无数据。** 根因归审核方：票 02 审核时我只查了 symbol 键，漏了 typebox 嵌套对象的非枚举 `~kind` 字符串键。附带发现 `isError` 死字段已在 `pi-agent-core` `agent-loop.js` 核实（只有 execute 抛异常才置真）。已开票 02 r2（`structuredClone` + 非 completed 改 throw），本票检查 2 的判定口径已随之改为 jsonl `isError === true` + 无 `details.report`。**Status 保持 ready-for-human：02 r2 交回并 verified 后重跑本票全部检查。**

**2026-09-16 审核（Devin）第二次运行：verified / resolved。** 核对了 `tool_result` 原文（`status=completed`、`report` 9 必填齐、`taskId` 一致、`usage.durationMs=100200`）、`/tmp/typed-delegation-probe/hello.txt` = `hi`、三份 `subagent-artifacts/structured-output/<runId>/…/output.json` 在盘。三个未知的答案采纳：(1) execute 内 emit 通路 6/6 终态；(2) schema 校验双侧都在 launcher（请求侧 `cloneJsonWithinByteLimit`，输出侧注入 `structured_output` 工具），我们零解析；(3) 前台阻塞成立，`-p` 无进度、无软取消，TUI 侧未测。附带：`explorer` 不是本环境的 agent（只读对应物 `scout`）；`isError` 死字段。**判定：轮 3 走结构化委派 API（前台），不走 RPC async。** 理由与后果记在 ADR-0001（accepted）与 spec.md 轮 3。另记一笔待观察：worker 为 `hello.txt` 花了 28 个 tool call / 239k input / $0.24，任务文本是否诱发过度验证留给轮 3 的宿主验收观察，不在本票。
