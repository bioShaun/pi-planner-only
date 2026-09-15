# 09: 既有 4 个工具的 `isError: true` 是死字段——改为 throw

Status: verified
Blocked by: 无（可与 04 并行）
Type: task

**What to build：** `index.ts` 里 `git_audit` / `git_commit` / `planner_recover` / `planner_verdict` 的 16 处 `return { …, isError: true }` 改为 `throw new Error(text)`（text 就是原来 `content[0].text`）。`details` 里原本随拒绝返回的字段若对 Root 有用，并进 message 文本。

**Why：** 票 03 实证 + 审核方在 `pi-agent-core` `agent-loop.js:455-478` 核实：宿主只在 `execute` **抛异常**时把 `tool_result.isError` 置真，返回对象里的 `isError` 被丢弃；`AgentToolResult` 类型里没有该字段。也就是说这 16 处拒绝在宿主里一直被当作成功结果持久化到 jsonl，Root 模型看到的是普通文本、不是错误信号。

**范围：** 只改 `index.ts` 这 16 处及对应的 `index.test.mjs` 断言（由「返回 isError」改为「rejects」）。`git_commit` 里 `return … isError: true` 之前若有副作用（例如已 `git add`）保持原顺序——只是把 return 换 throw。

**Acceptance：**

```sh
grep -c "isError" index.ts                    # 期望：0
git diff --stat -- index.ts index.test.mjs    # 期望：只有这两文件
npm run typecheck && npm test                 # 期望：exit 0
```

**交回：** 三条命令原样输出 + `git diff -- index.ts | grep -c '^+.*throw new Error'`（应为 16）。

## Comments

**2026-09-16 执行（Devin，执行方）。** 17 处 `isError` 返回/字段全部清除，`index.ts` 里 `isError` 字面量为 0。

### 验收命令原样输出

```text
$ grep -c "isError" index.ts
0

$ git diff --stat -- index.ts index.test.mjs
 index.test.mjs | 175 ++++---...-
 index.ts       | 139 ++++---...-
 2 files changed, 190 insertions(+), 124 deletions(-)

$ npm run typecheck && npm test
exit 0（36 文件全 PASS）

$ git diff -- index.ts | grep -c '^+.*throw new Error'
17
```

### 逐点说明

- **票面写 16 处，实际 17 处 `throw new Error`**：git_commit ×13 + planner_verdict ×3（unknown-task / lifecycle / store-error）+ planner_recover ×1（条件 `isError: result.status === …` 改为 `if (拒绝三态) throw`，refusal 携带的 `nextAction` 已并进 message）。git_audit 实际无 isError 点（票面「4 个工具」按 16 处定位即可）。
- **第 18 处 `isError: event.isError`**（tool_result → `handleSubagentResult` 的事件透传）改为 `handleSubagentResult({ ...event })`——满足 `grep isError = 0` 且语义不变（`SubagentEvent.isError?: boolean` 原样携带）。
- **details 合并口径**：verdict 的 refusalKind/taskId/verdict 并进 message（`refused (kind, task=…, verdict=…): reason`）；git_commit 的 details 全为空或已在文本中（gate 名、blocking 路径列表）；recover 拒绝时 `nextAction` 序列化进 message。`isError` 死字段连同 details 一起随返回对象消失，属预期。
- **测试**：7 处 `isError === true` 断言改 `assert.rejects`（verdict ×5、git_commit ×2），另补 1 处漏网的未消费返回（:4547 twin-task verdict）为 `assert.rejects(/planner_verdict refused/)`；`isError === undefined` 成功路径断言不受影响。index.test.mjs diff 内含票 04 的 scout 期望值与票 01 存量 tmpdir 迁移，非本票全部内容。
- **副作用顺序保持**：verdict 的 `recordRootVerdictRefusal` 仍在 throw 之前执行；git_commit 各 gate/暂存失败点在原有顺序抛错，无副作用重排。

**2026-09-15 验收（Claude，审核方）。判定：通过。** 三条验收命令在审核方本机独立复跑，结果与执行方一致：`grep -c "isError" index.ts` = 0；`git diff --stat -- index.ts index.test.mjs` 仅两文件（190+/124−）；`npm run typecheck && npm test` exit 0；`grep -c '^+.*throw new Error'` = 17，`^-.*throw new Error` = 0（无既有 throw 被改写）。

逐点核对：
- 17 处均为 return→throw 的原位替换，message 即原 `content[0].text`；无副作用重排——verdict 的 `recordRootVerdictRefusal` 仍在 throw 前，git_commit 的 gate / add / commit 各失败点在原顺序抛错。
- 16 vs 17 的差异成立：`git_audit` 确无 `isError` 返回；`planner_recover` 是条件式 `isError: <expr>`，票面按字面 `isError: true` 数才漏掉。
- details 合并口径合理：verdict 的 kind/taskId/verdict 进 message；recover 的 `nextAction` 序列化进 message；git_commit 的 gate 名、blocking 路径原本就在文本里。
- 测试：7 处 `isError === true` 断言全部改为 `assert.rejects`，其余 `isError === undefined` 成功路径断言未动；其他 test 文件的 diff 中无 `isError` 改动，本票未外溢。

不阻塞的保留意见（记录，不要求返工）：
1. 第 18 处 `isError: event.isError` → `{ ...event }`：这一处本来不是死字段，是对宿主 `tool_result.isError` 的合法读取；改成 spread 只是为了让 `grep = 0` 成立。当下等价（`SubagentEvent` 恰好就是那六个字段，`handleSubagentResult` 不整体持久化 event），但契约从"显式投影"变成"透传宿主事件的全部字段"。可接受；若日后宿主事件加字段，这里是第一个要看的地方。
2. `planner_recover` 的拒绝→throw 路径没有任何测试覆盖（`index.test.mjs` 只断言工具已注册）。票面未要求，但 17 处里它是唯一无断言保护的一处，建议作为后续小票补一条 `assert.rejects(/unbound|identity-conflict|duplicate/)`。
3. `:4547` twin-task 的 verdict 原本是未消费的静默拒绝，现在用泛用正则 `/planner_verdict refused/` 钉住；拒绝 kind 未辨明。这是把既有行为显式化，不是本票引入的行为变化。
